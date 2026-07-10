# embed-sdk — Claude / contributor context

This is the browser-side SDK for Vocadesk voice embeds. It's the only piece of Vocadesk that runs inside a customer's website, so it has to be small, robust, and not break either us or them.

## Hard invariants

1. **Bundle stays ≤25 kB gzipped.** Checked by `scripts/check-size.mjs` (run via `npm run build:check-size`). If you're adding code that pushes this over, stop and reconsider — split a feature, remove dead code, or push the work server-side.
2. **Shadow DOM mode is `closed`.** Customers cannot poke into the shadow root, and the customer's CSS cannot leak into ours. Do not change to `open` for "debugging" — open shadow roots are accessible from any script on the page.
3. **No third-party network calls.** Only `cdn.vocadesk.com` (script load), `embed.vocadesk.com` (tokens), `voice.vocadesk.com` (WSS), and `challenges.cloudflare.com` when Turnstile is on. No analytics, no Sentry, no fonts, no CDN images. This is a security promise to our customers.
4. **AudioWorklets are inlined.** They're authored as `.js` files in `src/audio/worklets/` and imported via `?raw` so the bundler ships them as string literals. Customers never host a second file.
5. **Audio is PCM16 mono 24 kHz base64.** Same wire format as `/direct/test-call` in voice-runtime2. Any browser that gives us 48 kHz gets resampled inside the worklet.
6. **`defer`-safe.** The IIFE must work whether loaded before, during, or after `DOMContentLoaded`. The entry point checks `document.readyState`.
7. **No React/Vue/etc.** Customers' sites may have any framework or none. Vanilla DOM only.

## Why Shadow DOM

The host page's CSS is arbitrary and frequently hostile (`* { box-sizing: border-box }`, broken resets, global `button` rules with `!important`). A closed shadow root is the only reliable encapsulation primitive in the platform — `iframe` would work but is heavyweight, breaks A11y focus, and triggers third-party-cookie warnings.

## Why AudioWorklet (not ScriptProcessor)

`ScriptProcessorNode` runs on the main thread, blocks layout when busy, and is deprecated. AudioWorklets run on the audio render thread, are jitter-free, and let us do the PCM16 conversion + base64 encoding without dropping frames.

Trade-off: AudioWorklets require `https://` and a separate JS file. We sidestep the second problem by inlining the worklet source as a string blob and registering it via `URL.createObjectURL(new Blob([source]))`.

## File map

```
src/
  index.ts              entry — auto-bind + window.Vocadesk
  embed.ts              one Embed instance per host element
  api.ts                POST /v1/tokens
  ws.ts                 WebSocket client + frame parser
  state.ts              state machine (8 states, 8 events)
  browser-id.ts         localStorage UUID v4
  version.ts            VERSION constant injected by Vite define()
  config.ts             default API + WSS URLs
  types.ts              shared interfaces
  audio/
    capture.ts          getUserMedia + worklet wiring
    playback.ts         worklet output → speakers
    pcm.ts              Float32 ↔ PCM16, base64 codec
    meter.ts            RMS → bar level
    worklets/
      capture-processor.js    runs in AudioWorkletGlobalScope
      playback-processor.js   runs in AudioWorkletGlobalScope
  ui/
    render.ts           Shadow DOM mount + state-driven view
    meter-bars.ts       6-segment mic level bars
    styles.css          scoped to shadow root

tests/
  unit/                 vitest — pure logic, no DOM
  e2e/
    embed.spec.ts       Playwright + fake mic devices
    mock-server.mjs     mock embed-gateway + WSS

examples/
  plain.html            <button data-vocadesk-embed> snippet
  spa-programmatic.html window.Vocadesk.mount(...)
```

## State machine

```
idle
 └ click → requesting_mic
            ├ mic_granted → connecting
            │                ├ ws_open_and_started → active
            │                │                        └ hangup → ending → ws_closed → ended → reset → idle
            │                └ ws_failed → error → retry → idle
            └ mic_failed → mic_denied → retry → requesting_mic
```

`active → ended` may be triggered by the user (× button) or by the server (`end_call` frame). Both go through the same teardown.

## Wire protocol (mirrors voice-runtime2's `/direct/test-call`)

The embed-gateway endpoint speaks the exact same JSON-text frame protocol as `/direct/test-call`. The SDK doesn't care which it's talking to.

Client → server:
- `{"type":"start","agentId":"","promptOverride":null}` — agentId is ignored, the JWT carries it.
- `{"type":"audio","data":"<base64 PCM16 24kHz mono>"}`
- `{"type":"barge_in"}` — reserved for a future barge-in feature; currently never sent.
- `{"type":"stop"}` — user-initiated hangup.

Server → client:
- `{"type":"started","callId":"..."}` — handshake complete.
- `{"type":"audio","data":"..."}` — base64 PCM16 from agent.
- `{"type":"transcript","role":"user|assistant","text":"...","seq":N}` — currently swallowed; reserved.
- `{"type":"agent_ending"}` — stop sending mic audio; goodbye is still streaming.
- `{"type":"end_call"}` — clean shutdown.
- `{"type":"transfer_call","number":"..."}` — treated as hangup (embed does not place outbound PSTN calls).
- `{"type":"clear"}` — flush the playback jitter buffer (barge-in).
- `{"type":"error","message":"..."}`

## Common tasks

### Add a new error code

1. Add it to `ErrorCode` in `src/types.ts`.
2. Map a backend response or browser API failure to it in `src/embed.ts` or `src/api.ts`.
3. Document it in README's "Events" section.

### Re-style the active state

`src/ui/styles.css`. Look at the `[data-state="active"]` rule. Adding new visual state shouldn't add JS — prefer attribute selectors on `data-state` over more code.

### Add a captions UI

`onTranscript` in `src/embed.ts` is the no-op hook today. Wire it into a new shadow-DOM element. Watch the bundle size — captions are easy to balloon (text formatting, scroll buffer, dedup).

### Bump audio sample rate

Don't. The server expects 24 kHz on the direct path. If you change this, also change `voice-runtime2`'s `/direct/test-call` (and the rest of the audio pipeline) in the same PR — the audio bridge isn't designed to negotiate.

## CI

`.github/workflows/ci.yml` — runs lint + typecheck + unit + e2e on every PR.
`.github/workflows/release.yml` — on tag `v*.*.*` builds, uploads to R2, prints the SRI hash. See README "Releasing" for the secret setup.

## Code search — prefer CodeGraph

This repo has a local CodeGraph index at `.codegraph/codegraph.db`. **Prefer `mcp__codegraph__*` tools** (`search`, `context`, `callers`, `callees`, `impact`, `node`) over `Grep`/`Glob`/Explore agents for symbol lookup and call-graph queries. Fall back to grep only for content searches (strings, comments, log messages) or when CodeGraph returns nothing.


---

## Behavioral Guidelines (Karpathy)

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

*These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.*
