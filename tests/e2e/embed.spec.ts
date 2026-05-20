import { test, expect } from "@playwright/test";

const PAGE_URL = "http://127.0.0.1:8799/examples/plain.html";

test.describe("embed full flow", () => {
  test.beforeEach(async ({ request }) => {
    await request.get("http://127.0.0.1:8799/__reset");
  });

  test("clicks button, walks idle → active → ended, fires events", async ({ page }) => {
    const log: { name: string; detail?: unknown }[] = [];
    await page.exposeFunction("__record", (name: string, detail?: unknown) => {
      log.push({ name, detail });
    });

    await page.addInitScript(() => {
      document.addEventListener("vocadesk:start", (e) =>
        (window as unknown as { __record: (n: string, d?: unknown) => void }).__record(
          "vocadesk:start",
          (e as CustomEvent).detail,
        ),
      );
      document.addEventListener("vocadesk:end", (e) =>
        (window as unknown as { __record: (n: string, d?: unknown) => void }).__record(
          "vocadesk:end",
          (e as CustomEvent).detail,
        ),
      );
      document.addEventListener("vocadesk:error", (e) =>
        (window as unknown as { __record: (n: string, d?: unknown) => void }).__record(
          "vocadesk:error",
          (e as CustomEvent).detail,
        ),
      );
    });

    await page.goto(PAGE_URL);

    // The host button is the only [data-vocadesk-embed] element.
    const host = page.locator("[data-vocadesk-embed]");
    await expect(host).toBeAttached();

    // The shadow-rendered button isn't directly queryable from page.locator,
    // but a click on the host element bubbles into the shadow root.
    await host.click();

    // Wait for vocadesk:start to fire (means we reached "active").
    await page.waitForFunction(
      () =>
        (
          (window as unknown as { __record: { lastName?: string } }).__record
        ) !== undefined,
    );
    await expect.poll(() => log.find((e) => e.name === "vocadesk:start")).toBeTruthy();

    // Mock server sends end_call after ~600ms.
    await expect
      .poll(() => log.find((e) => e.name === "vocadesk:end"), { timeout: 5000 })
      .toBeTruthy();

    const endEv = log.find((e) => e.name === "vocadesk:end");
    expect(endEv).toBeTruthy();
    expect((endEv?.detail as { durationMs: number }).durationMs).toBeGreaterThan(0);

    // Confirm the mock server saw start (and stop on close).
    const recv = await (
      await page.request.get("http://127.0.0.1:8799/__last-recv")
    ).json();
    expect(recv).toContain("start");
  });

  test("surfaces 409 concurrent_call_active as error event", async ({ page }) => {
    const log: { name: string; detail?: unknown }[] = [];
    await page.exposeFunction("__record", (name: string, detail?: unknown) => {
      log.push({ name, detail });
    });
    await page.addInitScript(() => {
      document.addEventListener("vocadesk:error", (e) =>
        (window as unknown as { __record: (n: string, d?: unknown) => void }).__record(
          "vocadesk:error",
          (e as CustomEvent).detail,
        ),
      );
    });

    // Inject a button with the magic "busy" embedId.
    await page.goto(PAGE_URL);
    await page.evaluate(() => {
      const orig = document.querySelector("[data-vocadesk-embed]");
      if (orig) orig.setAttribute("data-vocadesk-embed", "emb_busy");
      // Force a re-bind via the public API.
      const w = window as unknown as { Vocadesk?: { mount: (el: Element, o: object) => unknown } };
      w.Vocadesk?.mount(orig as Element, { embedId: "emb_busy" });
    });

    await page.locator("[data-vocadesk-embed]").click();

    await expect
      .poll(() => log.find((e) => e.name === "vocadesk:error"), { timeout: 5000 })
      .toBeTruthy();
    const err = log.find((e) => e.name === "vocadesk:error");
    expect((err?.detail as { code: string }).code).toBe("concurrent_call_active");
  });
});
