#!/usr/bin/env node
// Validates dist/vocadesk.min.js stays under the gzip budget.
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// pipecat path loads livekit-client from CDN at runtime, so the bundle
// only carries the core SDK. 50 KB gz comfortably accommodates the
// current ~10 KB while flagging any accidental large additions.
const LIMIT_GZIP_BYTES = 50 * 1024;

const file = resolve(process.cwd(), "dist/vocadesk.min.js");
const buf = readFileSync(file);
const raw = statSync(file).size;
const gz = gzipSync(buf, { level: 9 }).length;

const pct = ((gz / LIMIT_GZIP_BYTES) * 100).toFixed(1);
console.log(`vocadesk.min.js: ${raw} bytes raw, ${gz} bytes gzipped (${pct}% of ${LIMIT_GZIP_BYTES} budget)`);

if (gz > LIMIT_GZIP_BYTES) {
  console.error(`bundle exceeds ${LIMIT_GZIP_BYTES} byte gzip budget`);
  process.exit(1);
}
