import { describe, it, expect, beforeEach } from "vitest";

// Polyfill localStorage for jsdom under Node 26 (which ships without it
// enabled by default). Must be set up before importing the module under test.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const mod = await import("../../src/browser-id.js");
const { getBrowserId, _resetBrowserId } = mod;

describe("browserId", () => {
  beforeEach(() => {
    _resetBrowserId();
  });

  it("generates a UUID on first call", () => {
    const id = getBrowserId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("persists across calls", () => {
    const a = getBrowserId();
    const b = getBrowserId();
    expect(a).toBe(b);
  });

  it("generates a fresh ID after reset", () => {
    const a = getBrowserId();
    _resetBrowserId();
    const b = getBrowserId();
    expect(a).not.toBe(b);
  });
});
