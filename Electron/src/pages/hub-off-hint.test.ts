// UX-2 K3: kapalı modülün karosu GİZLENMEZ, soluk çizilir ve ayar yolunu söyler. Bayrak yüklemli her karo
// `offHint` taşır; taşımayanlar REJİM istisnasıdır (karo o rejimde anlamsız — gizlenir) ve burada beyanlıdır.
import { describe, expect, it } from "vitest";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { qualityTiles } from "@/pages/Quality/tile-config";
import { documentTiles } from "@/pages/Documents/tile-config";

/** Rejim istisnaları: depoMulti (tek depoda transfer yok) · sevk onayı rejimi · finans cari takası · gelen belge (fason işlemci olmayan fabrikada gürültü). */
const REJIM_ISTISNA = ["warehouse-transfers", "sack-store", "cariler", "customers", "subcontractors", "gelen-belgeler", "gelen-belge-sablonlari", "gelen-belge-varsayilan-urunler"];

const KATALOG = [
  ["Operasyon", operationsTiles],
  ["Tanımlar", definitionTiles],
  ["Kalite Güvence", qualityTiles],
  ["Belgeler", documentTiles],
] as const;

describe("UX-2 K3 — kapalı karo ipucu", () => {
  it.each(KATALOG)("%s: visibleWhen taşıyan her karo offHint taşır ya da beyanlı rejim istisnasıdır", (_ad, tiles) => {
    const eksik = tiles
      .filter((t) => t.visibleWhen && !t.offHint && !REJIM_ISTISNA.includes(t.key))
      .map((t) => t.key);
    expect(eksik).toEqual([]);
  });
  it("offHint ayar yolunu söyler (\"kapalı — …\")", () => {
    for (const [, tiles] of KATALOG) {
      for (const t of tiles) if (t.offHint) expect(t.offHint, t.key).toMatch(/^kapalı — /);
    }
  });
  it("istisna listesi bayat değil: her anahtar gerçekten yüklemli ve ipuçsuz bir karo", () => {
    const hepsi = KATALOG.flatMap(([, tiles]) => [...tiles]);
    for (const k of REJIM_ISTISNA) {
      const t = hepsi.find((x) => x.key === k);
      expect(t?.visibleWhen, k).toBeDefined();
      expect(t?.offHint, k).toBeUndefined();
    }
  });
});
