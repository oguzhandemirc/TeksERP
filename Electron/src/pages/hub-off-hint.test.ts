// Kapalı modülün karosu yalnız modülü açabilene (süperadmin) soluk çizilir ve ayar yolunu söyler; diğer herkese
// hiç çizilmez (2026-11-01; iki rol render ölçümü `lib/off-module-visibility.test.tsx`). Bayrak yüklemli her karo
// `offHint` taşır; taşımayanlar REJİM istisnasıdır (karo o rejimde anlamsız — herkese gizli) ve burada beyanlıdır.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { qualityTiles } from "@/pages/Quality/tile-config";
import { documentTiles } from "@/pages/Documents/tile-config";

/** Rejim istisnaları: depoMulti (tek depoda transfer yok) · sevk onayı rejimi · finans cari takası · gelen belge + İçerideki İşler (fason işlemci olmayan fabrikada gürültü). */
const REJIM_ISTISNA = ["warehouse-transfers", "sack-store", "cariler", "customers", "subcontractors", "gelen-belgeler", "gelen-belge-sablonlari", "gelen-belge-varsayilan-urunler", "icerideki-isler"];

const KATALOG = [
  ["Operasyon", operationsTiles],
  ["Tanımlar", definitionTiles],
  ["Kalite Güvence", qualityTiles],
  ["Belgeler", documentTiles],
] as const;

describe("Kapalı karo ipucu", () => {
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

/** Kapalı girişi çizen her yüzey kararı TEK yüklemden alır (`offEntryMode`); eski "ipucu varsa göster" süzgeci dönmez. */
const OFF_ENTRY_SURFACES = [
  "../components/layout/Sidebar.tsx",
  "./Operations/OperationsHubPage.tsx",
  "./Definitions/DefinitionsHubPage.tsx",
  "./Quality/QualityHubPage.tsx",
  "./Documents/DocumentsHubPage.tsx",
];

describe("Kapalı giriş görünürlüğü — tek kaynak", () => {
  it.each(OFF_ENTRY_SURFACES)("%s: `offEntryMode` + `useCanSeeOffModules` kullanır, ipucuna tek başına bakmaz", (rel) => {
    const src = readFileSync(resolve(__dirname, rel), "utf8");
    expect(src).toMatch(/from "@\/lib\/off-module-visibility"/);
    expect(src).toContain("offEntryMode(");
    expect(src).toContain("useCanSeeOffModules()");
    expect(src).not.toMatch(/\|\|\s*Boolean\(t\.offHint\)/);
    expect(src).not.toMatch(/&&\s*!t\.offHint\)/);
  });
});
