// KALEM BİRİMİ TEK KAYNAK bekçisi (inceleme Not 9, 2026-11-25): ekranda birim her yerde aynı yazılır ("m", "kg", "adet")
// ve yalnız `lib/item-unit.ts`ten gelir. Kopya etiket haritası ya da ham kodu çeviren satır içi üçlü yeniden doğmasın.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEM_UNIT_LABEL, unitLabel } from "./item-unit";

const SRC = resolve(__dirname, "..");
const OWNER = "lib/item-unit.ts";
// Kopya harita (`MT: "m"`) ya da satır içi çeviri (`unit === "MT" ? "m"` / `=== "MT" ? ""`).
const COPY = /\bMT:\s*["'](?:m|mt|metre)["']|===\s*["']MT["']\s*\?\s*["'](?:m)?["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

describe("kalem birimi tek kaynak", () => {
  it("birim etiketleri: MT → m, KG → kg, ADET → adet; bilinmeyen kod olduğu gibi, boş → m", () => {
    expect(ITEM_UNIT_LABEL).toEqual({ MT: "m", KG: "kg", ADET: "adet" });
    expect([unitLabel("MT"), unitLabel("KG"), unitLabel("ADET"), unitLabel(null), unitLabel("XYZ")]).toEqual(["m", "kg", "adet", "m", "XYZ"]);
  });

  it("⭐ panelde kopya birim haritası ya da satır içi MT çevirisi yok (yalnız lib/item-unit.ts)", () => {
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => rel !== OWNER && COPY.test(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("sonda: desen gerçekten yakalar", () => {
    expect(COPY.test('const UNIT_TR = { MT: "m", KG: "kg" };')).toBe(true);
    expect(COPY.test('r.unit === "MT" ? "" : r.unit')).toBe(true);
    expect(COPY.test("unitLabel(r.unit)")).toBe(false);
  });
});
