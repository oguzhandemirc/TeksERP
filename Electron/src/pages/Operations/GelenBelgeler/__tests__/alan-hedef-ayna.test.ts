// AYNA BEKÇİSİ: panel `tanit/fieldTargets.ts` ↔ backend `Teks-Erp/src/lib/gelen-belge/alan-hedef.ts` (anahtar, sıra, İE adı, grup,
// varsayılan görünürlük). Backend kataloğa alan ekleyince (ör. `toplamKg`) panel aynası da eklenmeden bu test kırmızıdır.
// Negatif sonda: panel aynasından `toplamKg` çıkarılınca kırmızı.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIELD_TARGETS, FIELD_GROUP_ORDER } from "../tanit/fieldTargets";

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
});
