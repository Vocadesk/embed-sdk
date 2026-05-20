import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  // Inline assets (CSS, worklets) into the JS bundle so customers only
  // need to load a single <script>.
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: true,
    minify: "terser",
    cssCodeSplit: false,
    // External sourcemaps — emitted to disk but not referenced from the JS
    // bundle (keeps the customer-facing file clean and not 4× the size).
    sourcemap: "hidden",
    terserOptions: {
      compress: {
        passes: 2,
        pure_funcs: ["console.debug"],
      },
      format: {
        comments: false,
      },
    },
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["iife"],
      name: "Vocadesk",
      fileName: () => "vocadesk.min.js",
    },
    rollupOptions: {
      output: {
        // Single self-contained file — no chunk splitting.
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    "process.env.SDK_VERSION": JSON.stringify(pkg.version),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  server: {
    port: 5173,
    open: "/examples/plain.html",
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
