// AYNA BEKÇİSİ: panel `tanit/fieldTargets.ts` ↔ backend `Teks-Erp/src/lib/gelen-belge/alan-hedef.ts` (anahtar, sıra, İE adı, grup,
// varsayılan görünürlük). Backend kataloğa alan ekleyince (ör. `toplamKg`) panel aynası da eklenmeden bu test kırmızıdır.
// Tanıtma seçenekleri (`teachDraft.FIELD_OPTIONS`) ↔ backend `ASSIGNABLE_FIELDS` anahtarları da aynı kümedir (öneri ucu strict enum).
// Negatif sonda: panel aynasından (fieldTargets ya da FIELD_OPTIONS) `toplamKg` çıkarılınca kırmızı.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIELD_TARGETS, FIELD_GROUP_ORDER } from "../tanit/fieldTargets";
import { FIELD_OPTIONS } from "../tanit/teachDraft";

const SRC = readFileSync(resolve(process.cwd(), "../Teks-Erp/src/lib/gelen-belge/alan-hedef.ts"), "utf8");
const ROW = /^\s*(\w+): \{ woTarget: "[^"]+", woLabel: "([^"]+)", group: "(\w+)", defaultVisible: (true|false),/gm;

describe("alan → İE karşılığı kataloğu aynası", () => {
  it("⭐ backend kataloğu ile birebir (sıra dahil)", () => {
    const backend = [...SRC.matchAll(ROW)].map((m) => ({ key: m[1], woLabel: m[2], group: m[3], defaultVisible: m[4] === "true" }));
    expect(backend.length).toBeGreaterThan(10);
    const panel = Object.entries(FIELD_TARGETS).map(([key, v]) => ({ key, woLabel: v.woLabel, group: v.group, defaultVisible: v.defaultVisible }));
    expect(panel).toEqual(backend);
  });

  it("grup sırası aynı", () => {
    const m = /FIELD_GROUP_ORDER: readonly FieldGroup\[\] = \[([^\]]+)\]/.exec(SRC);
    expect(m?.[1]?.split(",").map((s) => s.trim().replace(/"/g, ""))).toEqual([...FIELD_GROUP_ORDER]);
  });

  it("⭐ tanıtma alan seçenekleri = backend atanabilir alanlar = katalog anahtarları", () => {
    const suggest = readFileSync(resolve(process.cwd(), "../Teks-Erp/src/lib/gelen-belge/motor/suggest.ts"), "utf8");
    const block = /export const ASSIGNABLE_FIELDS = \{([\s\S]*?)\n\} as const/.exec(suggest)?.[1] ?? "";
    const backend = [...block.matchAll(/^\s*(\w+): \{ label:/gm)].map((m) => m[1]).sort();
    expect(backend).toContain("toplamKg");
    expect(FIELD_OPTIONS.map((f) => f.key as string).sort()).toEqual(backend);
    expect(Object.keys(FIELD_TARGETS).sort()).toEqual(backend);
  });
});
