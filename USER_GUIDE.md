# Vocadesk web-call embed — user guide (app.vocadesk.com)

A "web call" lets a visitor on any website press a button and have a live voice conversation with one of your AI agents — same kind of call as a phone call, just in the browser.

This guide takes you from zero to a working call on an external site in about 10 minutes. No coding required beyond pasting an HTML snippet.

> **Which dashboard am I on?** This guide is for the original Vocadesk dashboard at **https://app.vocadesk.com**. If you log in at `https://staging.vocadesk.com` (the new dashboard), use [USER_GUIDE_FUTURE.md](USER_GUIDE_FUTURE.md) instead. The customer-facing snippet, the SDK, and the call experience are identical between the two — only the operator dashboard differs.

---

## Before you start

You need:
- A **Vocadesk operator account** (log in at https://app.vocadesk.com).
- At least **one configured agent** — the one visitors will talk to.
- **The website** where you want the button to appear — you need permission to edit its HTML (or to add code via a CMS like WordPress, Webflow, Squarespace, etc.).
- The website must use **HTTPS** (browsers refuse to give microphone access on plain HTTP). Most modern hosts give you HTTPS automatically.

---

## Step 1 — Create an embed in the dashboard

1. Go to https://app.vocadesk.com and log in.
2. From the side menu choose **Clients** → click the client this embed is for.
3. Open the **Embeds** tab.
4. Click **New embed** (top right of the tab).
5. Fill in the form:
   - **Agent** — pick one of this client's agents (the dropdown shows only that client's agents).
   - **Allowed origins** — one per line, the exact URLs of the sites where the button can run. **Format: `https://yourwebsite.com`** — no path, no trailing slash, no `www` unless you want both. Examples:
     ```
     https://acme.com
     https://www.acme.com
     ```
   - **Require Turnstile (bot challenge)** — leave **off** for normal use. Only turn on if you start seeing bot abuse.
6. Click **Create**.

The page now shows your embed with a unique ID that looks like `emb_8sJ4kP3qXyZ…`.

⚠ **The allowed origins matter.** If the page that hosts the button is on a domain you did not add here, the button will refuse to make calls. You can add more origins later by editing the embed.

---

## Step 2 — Get the snippet

On the embed's detail page (or by clicking the embed in the list) you'll see a **Snippet** section. It looks like this:

```html
<script
  src="https://cdn.vocadesk.com/embed/v0.3.5/vocadesk.min.js"
  integrity="sha384-lQq2KYJjbP92RcQ72/t8iQ9lZyfHCXg6JppUjz4DybsfD6/sFeu1pMBglGVVb3jW"
  crossorigin="anonymous"
  defer
></script>

<div data-vocadesk-embed="emb_8sJ4kP3qXyZ…" style="width:220px;height:60px">
  Talk to us
</div>
```

Click **Copy snippet**. The `emb_…` value is already filled in for you — that's *your* embed ID.

---

## Step 3 — Paste it into your website

The snippet has two parts. They can be placed anywhere on the page, as long as both are present.

- **The `<script>` line** loads the Vocadesk code. Put it once per page — anywhere inside `<head>` or near the end of `<body>` is fine. If you have it on several pages, repeat it on each.
- **The `<div data-vocadesk-embed=…>` line** is the actual button visitors see (the SDK turns the div into a styled button at load time). Put it where you want the button to appear (a contact section, a sticky corner, a hero CTA — your call).

### Where to paste it, by host

| Host | Where |
|---|---|
| **Raw HTML / static site** | Open the .html file in your editor, paste both lines before `</body>` (the easiest), or split them between `<head>` (script) and the page body (button). |
| **WordPress** | Use the **Custom HTML** block in the page editor. Paste the snippet inside. |
| **Webflow** | Settings → Custom Code → "Before `</body>` tag" → paste the `<script>` line. Then on the page, add an **Embed** element and paste just the `<button>` line. |
| **Squarespace / Wix** | Insert a **Code** / **Custom HTML** block on the page and paste the whole snippet there. |
| **Notion** | Doesn't support arbitrary JS — won't work. |

Save and publish.

---

## Step 4 — Try it

1. Open the page in a browser (Chrome, Edge, Firefox, or Safari ≥ 14.1 — recent versions of all of these are fine).
2. You should see a button labeled **Talk to us**.
3. Click it.
4. The browser will ask for **microphone permission**. Click **Allow**.
5. The button changes to **Connecting…**, then **active** with a tiny live timer and animated bars showing your mic level.
6. Talk to the agent. It will reply through your speakers.
7. End the call by clicking the **×** inside the button, by saying something that triggers a hangup ("goodbye, thanks"), or by closing the tab.

That's the whole experience for visitors. No app to install, no login required, no setup.

---

## Step 5 — See the call in your dashboard

After the call ends:

1. Go to **Calls** in the Vocadesk dashboard at https://app.vocadesk.com.
2. Filter by **Call type: web** (or just sort by date — your recent call will be near the top).
3. You'll see:
   - Caller (browser ID — anonymous, no PII)
   - Duration
   - Transcript
   - Recording (if recording is enabled on the agent)
   - Cost

Web calls show up alongside phone calls and test calls. They're tagged with the **embed ID** so you can group calls per website.

---

## Troubleshooting

### "Mic blocked — Retry"
The visitor (or you) denied microphone permission. To fix:
- Chrome: click the small lock icon in the address bar → Site settings → Microphone → **Allow**. Reload the page.
- Safari: Safari menu → Settings for This Website → Microphone → **Allow**.
- Firefox: click the camera/mic icon in the address bar → Allow.

### Button shows "Can't connect"
- Open the browser **devtools console** (right-click → Inspect → Console tab).
- Look for a red error.
- The most common: `403 origin_not_allowed`. That means the website's URL is not in your embed's "Allowed origins" list. Go back to **Step 1** and edit the embed to include the exact URL.

### Page works, but I get HTTP 409
You (or the same browser) already has a live call open in another tab. End that one first. (Each browser is limited to one concurrent call per embed.)

### Nothing happens when I click the button
- Did you include the `<script>` tag? It must be present **somewhere** on the page.
- Is the page on HTTPS? Browsers block microphone access from HTTP pages (except `localhost`).
- Did you paste the button HTML *as HTML*? Some site builders accidentally HTML-escape it.

### The agent never responds (silent after I speak)
- Browser may not have mic input — test the mic at https://mictest.com first.
- Background noise can be excessive — try a quieter room.
- The agent may be configured to wait for a specific prompt — talk for a few seconds, not a single word.

### Bigger issues
- Check the Calls page — if your call shows up there with a "failed" status, the agent or upstream provider had a problem.
- Check that the agent's voice provider (OpenAI / ElevenLabs / etc.) has credit and is reachable.
- Email mmeirovich@gmail.com with the embed ID and approximate call time.

---

## What about security?

- The embed ID in your HTML is **public on purpose**. Anyone can see it. It alone does nothing — calls only work if the request originates from one of your **allowed origins**.
- The page does not connect to anyone's database, does not store visitor PII, and only opens a microphone after the visitor clicks the button.
- All call audio and transcripts flow over TLS (`https://` / `wss://`).
- You can revoke an embed any time. Revoked embeds stop minting tokens within seconds — sites still showing the button will fail to connect.

---

## A complete minimal example

If you have your own static-html test setup (or you save this as `test.html` on a host that gives you HTTPS), paste your embed ID into the `data-vocadesk-embed` value and you're ready to try it:

```html
<!doctype html>
<meta charset="utf-8">
<title>Vocadesk embed test</title>

<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 1rem; }
  .demo { margin: 2rem 0; }
</style>

<h1>Try our voice assistant</h1>
<p>Click the button, allow your microphone, and ask anything.</p>

<div class="demo">
  <div data-vocadesk-embed="emb_REPLACE_ME" style="width:220px;height:60px">
    Talk to us
  </div>
</div>

<script
  src="https://cdn.vocadesk.com/embed/v0.3.5/vocadesk.min.js"
  defer
></script>
```

Replace `emb_REPLACE_ME` with your real embed ID from the dashboard, add the page's URL to your embed's "Allowed origins", and load it from any HTTPS-served host.

---

That's the whole guide. Refer back to **Troubleshooting** for any surprises.
