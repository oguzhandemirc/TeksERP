import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ReportTable } from "@/pages/Reports/_v2/ReportTable";
import type { RaporSunumu, TabloBlok } from "@/pages/Reports/_v2/sunum";
import { costTiles } from "../tile-config";
import { excludedText, missingText, sourceBadges } from "./yarn-need-model";

// Sunucu zarfının küçük kopyası: iplik modülü kapalı → stok hücresi sunucudan "bilinmiyor" gelir.
const tablo: TabloBlok = {
  kolonlar: [
    { anahtar: "iplik", baslik: "İplik" },
    { anahtar: "ihtiyacKg", baslik: "İhtiyaç", birim: "kg", hiza: "sag" },
    { anahtar: "serbestStokKg", baslik: "Serbest stok", birim: "kg", hiza: "sag" },
    { anahtar: "eksikKg", baslik: "Eksik", birim: "kg", hiza: "sag" },
  ],
  satirlar: [{ iplik: "Ne 30/1 Pamuk", ihtiyacKg: "120.500", serbestStokKg: "bilinmiyor", eksikKg: "120.500" }],
} as TabloBlok;

const sunum = {
  anahtar: "maliyet/iplik-ihtiyaci", baslik: "İplik İhtiyaç Planı", soru: "?", donem: { etiket: "Bugün" },
  anaSayi: { ad: "Eksik", deger: 120.5, birim: "kg" }, yanSayilar: [], anlati: [], uyarilar: [], tanimlar: [], parametreler: [], tablo,
} as unknown as RaporSunumu;

describe("İplik İhtiyaç Planı (MAL-7)", () => {
  it("bilinmeyen hücre ekranda 0 değil 'bilinmiyor' yazar", () => {
    render(<ReportTable table={tablo} />);
    expect(screen.getByText("bilinmiyor")).toBeTruthy();
  });

  it("Excel tablosu ekranın kolonlarını aynı sırayla taşır; bilinmeyen hücre aynı metin", () => {
    const spec = buildExportSpec(sunum);
    const t = spec.tables.at(-1)!;
    expect(t.columns.map((c) => c.key)).toEqual(tablo.kolonlar.map((c) => c.anahtar));
    expect(t.rows[0]!.serbestStokKg).toBe("bilinmiyor");
  });

  it("kapalı kaynak rozeti 'bilinmiyor' der; dışlanan ürün yoksa şerit yok", () => {
    const b = sourceBadges({ stok: false, emanet: false, acikAlis: true, leventDusumu: true });
    expect(b.find((x) => x.key === "stok")!.label).toContain("bilinmiyor");
    expect(b.find((x) => x.key === "acikAlis")!.on).toBe(true);
    expect(excludedText({ yapisiEksik: [], olculemeyen: [] })).toBeNull();
    expect(excludedText({ yapisiEksik: [{ urunId: "u", urunKodu: "K", urun: "A", kalemSayisi: 1, metre: "10", eksikler: ["atkı"] }], olculemeyen: [] }))
      .toBe("İhtiyaca girmeyen ürünler (1) — listeyi gör");
    expect(missingText("WARP_SPEC_MISSING")).toMatch(/^Çözgü kartı bağlı değil/);
    expect(missingText("BILINMEYEN")).toBe("BILINMEYEN");
  });

  it("hub karosu sayfaya ve backend izniyle birebir", () => {
    const t = costTiles.find((x) => x.key === "yarn-need")!;
    expect(t.to).toBe("/cost/yarn-need");
    expect(t.permissionAny).toEqual(["report:yarn-need"]);
  });
});
