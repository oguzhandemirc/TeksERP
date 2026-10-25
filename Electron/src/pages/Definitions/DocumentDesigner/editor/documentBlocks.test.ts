import { describe, expect, it } from "vitest";
import { loadFixture } from "../binding/testContract";
import { BASIC_BLOCKS } from "./blocks";
import { DATA_CATEGORY, documentBlocks, PAGE_CATEGORY } from "./documentBlocks";
import { PAGE_REGION_ATTR } from "./documentComponents";

const { contract, settings } = loadFixture();

describe("blok paleti (plan §4)", () => {
  const blocks = documentBlocks({ contract, settings, internalFields: [] });
  it("bütün belge blokları var", () => {
    const labels = [...BASIC_BLOCKS, ...blocks].map((b) => b.label);
    for (const l of ["Metin", "Veri alanı", "Kalem tablosu", "Toplam kutusu", "Logo", "Barkod", "QR", "İmza alanı", "Üst bilgi", "Alt bilgi", "Sayfa no", "Sayfa kesmesi", "Kutu", "Çizgi", "Görsel"]) {
      expect(labels).toContain(l);
    }
  });
  it("üst/alt bilgi ve sayfa no kanvasa HTML koymaz, sayfa ayarına yönlenir", () => {
    for (const id of ["page-header", "page-footer", "page-number"]) {
      const b = blocks.find((x) => x.id === id)!;
      expect(b.category).toBe(PAGE_CATEGORY);
      expect((b.content as { attributes: Record<string, string> }).attributes[PAGE_REGION_ATTR]).toBeTruthy();
    }
  });
  it("veri blokları sınıf CSS'ini taşır (avoidInlineStyle)", () => {
    const table = blocks.find((x) => x.id === "item-table")!;
    expect(table.category).toBe(DATA_CATEGORY);
    expect(String(table.content)).toContain("<style>.kalem-tablosu{");
    expect(String(table.content)).not.toMatch(/style="/);
  });
  it("sözleşme yokken kalem tablosu yönlendirici iskelet", () => {
    const empty = documentBlocks({ contract: null, settings: {}, internalFields: [] });
    expect(String(empty.find((x) => x.id === "item-table")!.content)).toContain("Önce belge türü seçin");
  });
});
