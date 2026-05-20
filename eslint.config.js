import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        crypto: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
        AudioContext: "readonly",
        AudioWorkletNode: "readonly",
        AudioWorkletProcessor: "readonly",
        registerProcessor: "readonly",
        currentTime: "readonly",
        sampleRate: "readonly",
        MediaStream: "readonly",
        MediaStreamTrack: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        HTMLElement: "readonly",
        ShadowRoot: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        process: "readonly",
        Blob: "readonly",
        URL_: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
