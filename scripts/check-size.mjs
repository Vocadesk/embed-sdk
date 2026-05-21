#!/usr/bin/env node
// Validates dist/vocadesk.min.js stays under the gzip budget.
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Budget covers the @vapi-ai/web SDK because Vite IIFE format bundles
// dynamic imports into the main file (no code-splitting). 150 KB gz is
// roughly: ~20 KB core SDK + ~120 KB Vapi web client + headroom.
const LIMIT_GZIP_BYTES = 150 * 1024;

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
