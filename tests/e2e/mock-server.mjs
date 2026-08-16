#!/usr/bin/env node
// Mock embed-gateway + voice-runtime/chat-runtime backend used by both
// Playwright tests and `npm run dev`. Two ports:
//
//   8799  HTTP   POST /v1/tokens          → returns a pipecat token {provider, token, dispatchUrl, expiresAt},
//                                            or a chat token when embedId starts with "emb_chat"
//                GET  /__ready            → 200 OK once both listeners are up
//                GET  /__last-recv        → last text WS frame the mock saw (voice)
//                GET  /__last-recv-chat   → text frame types the chat mock saw
//                GET  /  (any file)       → serves dist/ + examples/
//                everything else          → 404
//
//   8788  WSS    /embed/v1/call            → mirrors a tiny voice script:
//                                            started → (queued audio) → end_call
//                /embed/chat               → mirrors the chat protocol:
//                                            auth → ready → (message → turn_start/delta*/turn_end)* → stop/end_call
//
// The HTTP server also serves static files from the embed-sdk root so the
// Playwright tests can navigate to /examples/plain.html (or /examples/chat.html)
// and have the built vocadesk.min.js served from /dist/vocadesk.min.js.

import http from "node:http";
import { WebSocketServer } from "ws";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const HTTP_PORT = 8799;
const WSS_PORT = 8788;

let lastRecv = [];
let lastRecvChat = [];
const CHAT_REPLY = "Hello from the mock agent!";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

async function serveStatic(req, res, urlPath) {
  let p = urlPath === "/" ? "/examples/plain.html" : urlPath;
  // Strip query string
  p = p.split("?")[0];
  const file = resolve(ROOT, "." + p);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    await stat(file);
  } catch {
    res.writeHead(404); res.end("not found"); return;
  }
  const ext = extname(file);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  res.end(await readFile(file));
}

const httpServer = http.createServer(async (req, res) => {
  // CORS — Playwright loads the page from 127.0.0.1:8799 and the SDK posts
  // here too, so technically same-origin, but be permissive anyway for dev.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.url === "/__ready") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.url === "/__last-recv") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lastRecv));
    return;
  }
  if (req.url === "/__last-recv-chat") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lastRecvChat));
    return;
  }
  if (req.url === "/__reset") {
    lastRecv = [];
    lastRecvChat = [];
    res.writeHead(200); res.end("ok"); return;
  }
  if (req.method === "POST" && req.url === "/v1/tokens") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* */ }
      // 409 path for tests
      if (parsed.embedId === "emb_busy") {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: "concurrent_call_active", message: "busy" }));
        return;
      }
      if (typeof parsed.embedId === "string" && parsed.embedId.startsWith("emb_chat")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          provider: "chat",
          token: "mock-jwt-" + Math.random().toString(36).slice(2),
          dispatchUrl: `ws://127.0.0.1:${WSS_PORT}/embed/chat`,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        provider: "pipecat",
        token: "mock-jwt-" + Math.random().toString(36).slice(2),
        dispatchUrl: `http://127.0.0.1:${HTTP_PORT}/pipecat/embed`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }));
    });
    return;
  }

  if (req.method === "GET") {
    await serveStatic(req, res, req.url || "/");
    return;
  }

  res.writeHead(404);
  res.end();
});

// Both the voice and chat mock sockets share one plain http.Server (bound
// below) so they can coexist on the same WSS_PORT at different paths.
// NOTE: passing `{server, path}` to two WebSocketServer instances attached
// to the *same* http.Server does NOT route by path the way you'd hope —
// each instance's own 'upgrade' listener runs in registration order and
// unconditionally aborts (400) any request that doesn't match its own
// path, before the other instance's listener ever sees it. The documented
// fix is `noServer: true` on both, plus routing the upgrade ourselves.
const wssHttpServer = http.createServer();

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws) => {
  let callId = "call_" + Math.random().toString(36).slice(2);
  ws.on("message", (raw) => {
    let msg = {};
    try { msg = JSON.parse(raw.toString()); } catch { /* ignore */ }
    lastRecv.push(msg.type || "unknown");
    if (msg.type === "start") {
      ws.send(JSON.stringify({ type: "started", callId }));
      // Send a single tiny audio frame.
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          // 240 samples (10 ms) of PCM16 silence, base64-encoded.
          const samples = new Int16Array(240);
          const bytes = Buffer.from(samples.buffer);
          ws.send(JSON.stringify({ type: "audio", data: bytes.toString("base64") }));
        }
      }, 100);
      // Then end the call.
      setTimeout(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "end_call" }));
          ws.close();
        }
      }, 600);
    }
    if (msg.type === "stop") {
      try { ws.close(); } catch { /* ignore */ }
    }
  });
});

// Chat mock: auth → ready, then echo one scripted streamed reply per
// visitor message, and close on stop.
const chatWss = new WebSocketServer({ noServer: true });
chatWss.on("connection", (ws) => {
  const callId = "chatcall_" + Math.random().toString(36).slice(2);
  let authed = false;
  ws.on("message", (raw) => {
    let msg = {};
    try { msg = JSON.parse(raw.toString()); } catch { /* ignore */ }
    lastRecvChat.push(msg.type || "unknown");

    if (msg.type === "auth") {
      authed = true;
      ws.send(JSON.stringify({ type: "ready", callId }));
      return;
    }
    if (!authed) return; // protocol violation — ignore anything before auth

    if (msg.type === "message") {
      // Magic trigger so a test can exercise the fatal-error → error-state path.
      if (msg.text === "__trigger_fatal_error__") {
        ws.send(JSON.stringify({ type: "error", message: "mock fatal error", fatal: true }));
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: "turn_start" }));
      const words = CHAT_REPLY.split(" ");
      words.forEach((word, i) => {
        setTimeout(() => {
          if (ws.readyState !== ws.OPEN) return;
          ws.send(JSON.stringify({ type: "delta", text: (i > 0 ? " " : "") + word }));
          if (i === words.length - 1) {
            ws.send(JSON.stringify({ type: "turn_end" }));
          }
        }, 30 * (i + 1));
      });
      return;
    }
    if (msg.type === "stop") {
      try { ws.close(); } catch { /* ignore */ }
    }
  });
});

wssHttpServer.on("upgrade", (request, socket, head) => {
  const pathname = (request.url || "").split("?")[0];
  if (pathname === "/embed/v1/call") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (pathname === "/embed/chat") {
    chatWss.handleUpgrade(request, socket, head, (ws) => {
      chatWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

wssHttpServer.listen(WSS_PORT, "127.0.0.1", () => {
  console.log(`mock wss on ws://127.0.0.1:${WSS_PORT}/embed/v1/call and /embed/chat`);
});

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`mock http  on http://127.0.0.1:${HTTP_PORT}`);
});
