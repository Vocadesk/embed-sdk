# Vocadesk embed SDK

A drop-in JavaScript snippet that turns any HTML element into a voice call button. Visitors click, talk to your AI agent, and hang up — no accounts, no extensions, no second tab.

## 30-second integration

```html
<script
  src="https://cdn.vocadesk.com/embed/v0.1.0/vocadesk.min.js"
  integrity="sha384-PLACEHOLDER_REPLACE_WITH_RELEASE_HASH"
  crossorigin="anonymous"
  defer
></script>

<button data-vocadesk-embed="emb_abc123" style="width:220px;height:60px">
  Talk to us
</button>
```

That's it. Drop in the `<script>` tag, drop in a `<button>` (or any element) with `data-vocadesk-embed`, and the SDK auto-binds on `DOMContentLoaded`.

## What you get

- **One script tag.** ~25 kB gzipped, zero dependencies, no third-party network calls.
- **Shadow DOM rendering.** The SDK can't break your CSS and your CSS can't break it.
- **Vanilla.** No React, no Vue, no jQuery — drop it into anything.
- **Mic permission only on click.** No spooky page-load permission prompts.
- **One live call per browser.** Enforced server-side; the SDK surfaces it as a clean error.

## Theming

Theme via CSS custom properties on the host element:

```html
<button data-vocadesk-embed="emb_abc123"
        style="--vocadesk-bg:#16264f;
               --vocadesk-accent:#7ee787;
               --vocadesk-fg:#ffffff">
  Talk to us
</button>
```

| Variable             | Default     | Purpose                          |
| -------------------- | ----------- | -------------------------------- |
| `--vocadesk-bg`      | `#0b1d36`   | Button background                |
| `--vocadesk-fg`      | `#ffffff`   | Text + icon colour               |
| `--vocadesk-accent`  | `#4f8cff`   | Hover tint + meter bars          |
| `--vocadesk-danger`  | `#ff5a5a`   | Error / active pulse             |
| `--vocadesk-muted`   | rgba(...)   | Timer / muted text               |

Width and height are inherited from the host element — set them on the `<button>` (or wrapping element).

The default label is whatever text content you put inside the host element ("Talk to us" in the example above). The SDK clears that text on mount and renders inside a closed shadow root.

## Programmatic mount

For SPAs where the button doesn't exist on initial HTML, use the JS API:

```js
const handle = window.Vocadesk.mount("#my-button", {
  embedId: "emb_abc123",
  label: "Speak to support",   // optional — overrides the host element's text content
});

// Tear down later:
handle.destroy();
```

`mount` accepts either a CSS selector or an `HTMLElement`. It returns an `EmbedHandle = { destroy(): void }`.

## Events

The SDK fires these `CustomEvent`s on the host element. They bubble, so you can also listen on `document`.

| Event              | `detail`                       |
| ------------------ | ------------------------------ |
| `vocadesk:start`   | `{}`                           |
| `vocadesk:end`     | `{ durationMs: number }`       |
| `vocadesk:error`   | `{ code: string, message: string }` |

```js
document.addEventListener("vocadesk:start", () => console.log("call started"));
document.addEventListener("vocadesk:end",   (e) => console.log("ended after", e.detail.durationMs, "ms"));
document.addEventListener("vocadesk:error", (e) => console.warn(e.detail.code, e.detail.message));
```

`vocadesk:error` codes: `mic_denied`, `mic_unavailable`, `token_failed`, `ws_failed`, `concurrent_call_active`, `network`, `unknown`.

## Browser support

| Browser  | Minimum |
| -------- | ------- |
| Chrome   | 88+     |
| Edge     | 88+     |
| Safari   | 14.1+   |
| Firefox  | 76+     |

Older browsers see a non-functioning button (no microphone API). No polyfills are bundled — keeping the script tiny is the priority.

## Network destinations

The SDK only ever talks to:

- `cdn.vocadesk.com` — the script itself (you load it from here).
- `embed.vocadesk.com` — `POST /v1/tokens` to mint a short-lived JWT.
- `voice.vocadesk.com` — the WebSocket carrying audio + transcripts.
- `challenges.cloudflare.com` — only if your embed has `requiresCaptcha=true`.

No analytics, no Sentry, no third-party fonts, no images from CDNs.

## Local dev

```bash
npm install
npm run dev          # Vite dev server + mock backend on :8799
npm test             # Vitest unit tests
npm run e2e:install  # First time only — installs Chromium for Playwright
npm run e2e          # Playwright against the mock server
npm run build        # Production bundle into dist/
npm run build:check-size  # Build + verify ≤25 kB gzipped
```

The mock backend (`tests/e2e/mock-server.mjs`) implements just enough of the embed-gateway + voice-runtime contract to drive the SDK end-to-end without any real infra. Both `npm run dev` and `npm run e2e` use it.

## Releasing

Cutting a release publishes an immutable, SRI-pinned copy of the SDK to Cloudflare R2.

1. Bump `version` in `package.json`. Open a PR; merge to `main`.
2. Tag the merge commit:
   ```bash
   git tag v0.1.0
   git push --tags
   ```
3. The `release.yml` workflow builds the bundle, computes the SRI hash, uploads `vocadesk.min.js` + `.map` to `r2://$R2_BUCKET_NAME/embed/v0.1.0/`, and prints the SRI hash in the workflow logs.
4. Copy the SRI hash into your release notes and into this README's snippet at the top.

### Required GitHub secrets

| Secret                  | Where to set it                              |
| ----------------------- | -------------------------------------------- |
| `R2_ACCOUNT_ID`         | Cloudflare account ID                         |
| `R2_ACCESS_KEY_ID`      | R2 token, "Object Read & Write" permission   |
| `R2_SECRET_ACCESS_KEY`  | (same)                                       |
| `R2_BUCKET_NAME`        | e.g. `vocadesk-cdn`                          |

Once these are configured the release workflow runs end-to-end on every `v*.*.*` tag push.

The `latest/` path is **not** updated by the workflow — customers must pin to a specific MAJOR.MINOR.PATCH. (Releasing without a pinned URL would break SRI integrity, which is the entire reason we use a CDN.)

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for the contributor-facing architecture overview (why Shadow DOM, why AudioWorklet, file map, audio pipeline contract, etc).
