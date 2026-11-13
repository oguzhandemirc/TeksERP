// Turnstile (V1c): köken yalnız WEB derlemesinin CSP'sinde açılır (Electron index.html değişmez); betik bir kez,
// yalnız tarayıcıda yüklenir; giriş gövdesine belirteç yalnız widget ürettiyse girer.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TURNSTILE_ORIGIN, addTurnstileSources } from "@shared/turnstile-csp";
import { TURNSTILE_SCRIPT_URL, currentTurnstileToken, loadTurnstile } from "@/lib/turnstile";

const ROOT = resolve(__dirname, "../..");
const directive = (html: string, name: string) => new RegExp(`${name} ([^;"]*);`).exec(html)?.[1]?.split(/\s+/) ?? [];

describe("Turnstile CSP", () => {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
  it("Electron index.html Turnstile kökenini TAŞIMAZ", () => {
    expect(html).not.toContain(TURNSTILE_ORIGIN);
  });
  it("web dönüşümü script-src ve frame-src'ye ekler, connect-src'ye eklemez, idempotent", () => {
    const out = addTurnstileSources(html);
    expect(directive(out, "script-src")).toContain(TURNSTILE_ORIGIN);
    expect(directive(out, "frame-src")).toContain(TURNSTILE_ORIGIN);
    expect(directive(out, "connect-src")).not.toContain(TURNSTILE_ORIGIN);
    expect(addTurnstileSources(out)).toBe(out);
  });
  it("vite web yapılandırması dönüşümü uygular", () => {
    expect(readFileSync(resolve(ROOT, "vite.config.web.ts"), "utf8")).toContain("addTurnstileSources(");
  });
});

describe("Turnstile yükleyici (tarayıcı)", () => {
  it("widget belirteç üretmeden gövdeye belirteç girmez", () => {
    expect(currentTurnstileToken()).toBeUndefined();
  });
  it("betik tek kez, Cloudflare adresinden eklenir", () => {
    void loadTurnstile().catch(() => undefined);
    void loadTurnstile().catch(() => undefined);
    const scripts = Array.from(document.querySelectorAll("script")).filter((s) => s.src === TURNSTILE_SCRIPT_URL);
    expect(scripts).toHaveLength(1);
  });
});
