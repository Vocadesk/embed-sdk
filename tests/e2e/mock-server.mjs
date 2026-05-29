#!/usr/bin/env node
// Mock embed-gateway + voice-runtime backend used by both Playwright tests and
// `npm run dev`. Two ports:
//
//   8799  HTTP   POST /v1/tokens          → returns pipecat token {provider, token, dispatchUrl, expiresAt}
//                GET  /__ready            → 200 OK once both listeners are up
//                GET  /__last-recv        → last text WS frame the mock saw
//                GET  /  (any file)       → serves dist/ + examples/
//                everything else          → 404
//
//   8788  WSS    /embed/v1/call            → mirrors a tiny script:
//                                            started → (queued audio) → end_call
//
// The HTTP server also serves static files from the embed-sdk root so the
// Playwright tests can navigate to /examples/plain.html and have the built
// vocadesk.min.js served from /dist/vocadesk.min.js.

import http from "node:http";
import { WebSocketServer } from "ws";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const HTTP_PORT = 8799;
const WSS_PORT = 8788;

let lastRecv = [];

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
  if (req.url === "/__reset") {
    lastRecv = [];
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

const wss = new WebSocketServer({ port: WSS_PORT, path: "/embed/v1/call" });
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

httpServer.listen(HTTP_PORT, "127.0.0.1", () => {
  console.log(`mock http  on http://127.0.0.1:${HTTP_PORT}`);
});
console.log(`mock wss on ws://127.0.0.1:${WSS_PORT}/embed/v1/call`);
