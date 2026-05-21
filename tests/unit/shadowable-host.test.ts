/**
 * Regression test: the SDK must never call attachShadow on an element
 * type the W3C spec disallows it on (button, input, a, etc.). The
 * ensureShadowableHost helper swaps such hosts for a <div> at the same
 * DOM position before any shadow attach is attempted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ensureShadowableHost } from "../../src/embed";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ensureShadowableHost", () => {
  it("returns a <div> host unchanged", () => {
    const div = document.createElement("div");
    div.setAttribute("data-vocadesk-embed", "emb_x");
    document.body.appendChild(div);

    const result = ensureShadowableHost(div);

    expect(result).toBe(div);
    expect(result.tagName).toBe("DIV");
  });

  it("returns a <span> host unchanged", () => {
    const span = document.createElement("span");
    document.body.appendChild(span);
    expect(ensureShadowableHost(span)).toBe(span);
  });

  it("swaps a <button> host for a <div> with the same attributes", () => {
    const btn = document.createElement("button");
    btn.setAttribute("data-vocadesk-embed", "emb_x");
    btn.setAttribute("style", "width:200px;height:60px");
    btn.className = "custom-class";
    document.body.appendChild(btn);

    const result = ensureShadowableHost(btn);

    expect(result).not.toBe(btn);
    expect(result.tagName).toBe("DIV");
    expect(result.getAttribute("data-vocadesk-embed")).toBe("emb_x");
    expect(result.getAttribute("style")).toContain("width:200px");
    expect(result.classList.contains("custom-class")).toBe(true);
    // Original is removed from the DOM, replacement is in its place
    expect(document.body.contains(btn)).toBe(false);
    expect(document.body.contains(result)).toBe(true);
  });

  it("swaps an <a> tag (also unsupported) for a <div>", () => {
    const a = document.createElement("a");
    a.setAttribute("data-vocadesk-embed", "emb_x");
    document.body.appendChild(a);
    const result = ensureShadowableHost(a);
    expect(result.tagName).toBe("DIV");
  });

  it("strips form-control-only attributes (type, disabled) when swapping", () => {
    const btn = document.createElement("button");
    btn.setAttribute("data-vocadesk-embed", "emb_x");
    btn.setAttribute("type", "submit");
    btn.setAttribute("disabled", "");
    document.body.appendChild(btn);

    const result = ensureShadowableHost(btn);

    expect(result.hasAttribute("type")).toBe(false);
    expect(result.hasAttribute("disabled")).toBe(false);
  });

  it("allows custom elements (tag name contains a dash) through", () => {
    const ce = document.createElement("my-widget");
    ce.setAttribute("data-vocadesk-embed", "emb_x");
    document.body.appendChild(ce);
    const result = ensureShadowableHost(ce as HTMLElement);
    expect(result).toBe(ce);
  });
});
