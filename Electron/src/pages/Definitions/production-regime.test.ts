// =============================================================================
// BEKÇİ — TANIMLAR'IN ÜRETİM KAROLARI `production.enabled`'a BAĞLI
// =============================================================================
// ⭐ ÜÇ İDDİA:
//   ① Modül kapalıyken üç karo da çizilmez.
//   ② Modül AÇIKKEN üçü de çizilir ("sıfır görünür fark" — fabrikada açık).
//   ③ DARALTMA KORUNUYOR: çekirdek ana veri karoları (istasyon · makine · hazır
//      sebep · hata tipi · kalite sınıfı · renk) ve belge karoları koşulsuz
//      kalır. Bu satır olmasaydı "hepsini üretime bağla" refleksi, üretim
//      kapalı bir kurulumda ana veri ekranlarını da yok ederdi.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  isProductRecipesVisible,
  isRoutesVisible,
  isTravelerCardVisible,
} from "./production-regime";
import { definitionTiles } from "./tile-config";

const YUKLEMLER = [
  ["isRoutesVisible", isRoutesVisible],
  ["isProductRecipesVisible", isProductRecipesVisible],
  ["isTravelerCardVisible", isTravelerCardVisible],
] as const;

describe("tanımlar — üretim rejimi", () => {
  it.each(YUKLEMLER)("%s: modül KAPALIYKEN false", (_ad, fn) => {
    expect(fn({ productionEnabled: false })).toBe(false);
  });

  it.each(YUKLEMLER)("%s: modül AÇIKKEN true", (_ad, fn) => {
    expect(fn({ productionEnabled: true })).toBe(true);
  });
});

describe("karolara bağlanma (kimlik)", () => {
  const tile = (key: string) => definitionTiles.find((t) => t.key === key);

  it.each([
    ["routes", isRoutesVisible],
    ["product-recipes", isProductRecipesVisible],
    ["traveler-card", isTravelerCardVisible],
  ] as const)("%s karosu yüklemi TAŞIR", (key, fn) => {
    expect(tile(key)?.visibleWhen).toBe(fn);
  });

  it("⭐ ÇEKİRDEK tanım karoları koşulsuz kalır (daraltma bilinçli)", () => {
    for (const key of [
      "stations",
      "reason-presets",
      "defect-types",
      "quality-grades",
      "colors",
      "fabric-properties",
      "warehouses",
      // Belge tarafı: kartın ŞABLONU üretim nesnesi değil, belge nesnesidir.
      "traveler-card-studio",
      "document-templates",
      "free-documents",
      "labels",
    ]) {
      const t = tile(key);
      expect(t, `${key} karosu yok`).toBeDefined();
      expect(t?.visibleWhen, `${key} beklenmedik şekilde koşullu`).toBeUndefined();
    }
  });
});
