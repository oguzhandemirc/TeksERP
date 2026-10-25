import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_THEME_COLORS } from "./codeTheme";

describe("kod editörü teması", () => {
  it("renkler panel CSS değişkenlerinden gelir (açık/koyu birlikte döner)", () => {
    for (const c of Object.values(CODE_THEME_COLORS)) expect(c).toMatch(/^hsl\(var\(--[a-z0-9-]+\)\)$/);
  });

  it("hazır koyu tema paketi kullanılmaz; çekirdek paketler tam sabit", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../../../../package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).some((k) => k.includes("theme-one-dark") || k === "@uiw/react-codemirror")).toBe(false);
    const cm = Object.entries(pkg.dependencies).filter(([k]) => k.startsWith("@codemirror/") || k === "@lezer/highlight");
    expect(cm.length).toBe(10);
    for (const [, spec] of cm) expect(spec).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
