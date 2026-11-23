import { describe, expect, it } from "vitest";
import { buildCategorySections, buildKalemSections, groupByOf, KALEM_CATALOG, type SummaryTab } from "./inventorySummary";
import { buildSectionSheets, buildSectionsHtml } from "@/lib/list-export-sections";
import { UnknownExportColumnError, defaultColumnSelection } from "@/lib/export-columns";
import type { RollGroupsResult } from "./service";

const tabs: SummaryTab[] = [
  { key: "FINISHED_STOCK", label: "Stokta" },
  { key: "PRODUCTION", label: "Üretimde" },
];

const groups: RollGroupsResult[] = [
  {
    key: "FINISHED_STOCK",
    totalCount: 3,
    totalQty: 150.125,
    groups: [
      { values: { item: "Tül A", color: "Beyaz", width: 280 }, count: 2, qty: 100.1 },
      { values: { item: "Tül A", color: null, width: 300.5 }, count: 1, qty: 50.025 },
    ],
  },
  { key: "PRODUCTION", totalCount: 0, totalQty: 0, groups: [] },
];

describe("Kumaş Stoğu Özeti bölümleri", () => {
  it("kategori toplamı tek bölüm ve TOPLAM satırı yok (kategoriler örtüşür)", () => {
    const sections = buildCategorySections(tabs, [{ key: "FINISHED_STOCK", totalCount: 3, totalQty: 150.125 }], ["count", "qty"]);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.noTotals).toBe(true);
    expect(sections[0]!.rows).toEqual([
      { label: "Stokta", count: 3, qty: 150.125 },
      { label: "Üretimde", count: 0, qty: 0 },
    ]);
    expect(buildSectionsHtml("Özet", sections)).not.toContain("TOPLAM");
    const sheet = buildSectionSheets("Özet", sections)[0]!;
    expect(JSON.stringify(sheet)).not.toContain("TOPLAM");
  });

  it("kalem kalem: kategori başına bölüm, boş değer '—', sayılar ekrandaki biçimle", () => {
    const sections = buildKalemSections(tabs, groups, ["item", "color", "width", "count", "qty"]);
    expect(sections.map((s) => s.title)).toEqual(["Stokta", "Üretimde"]);
    const html = buildSectionsHtml("Özet", sections);
    expect(html).toContain("—");
    expect(html).toContain("300,5");
    expect(sections[1]!.rows).toEqual([]);
  });

  it("ayrım seçilmezse bölüm sunucu toplamıyla tek satır", () => {
    const sections = buildKalemSections(tabs, groups, ["count", "qty"]);
    expect(sections[0]!.rows).toEqual([{ values: {}, count: 3, qty: 150.125 }]);
    expect(groupByOf(["count", "qty"])).toEqual([]);
  });

  it("varsayılan ayrım kumaş/renk/en; tanınmayan sütun fırlatır", () => {
    expect(groupByOf(defaultColumnSelection(KALEM_CATALOG))).toEqual(["item", "color", "width"]);
    expect(() => buildKalemSections(tabs, groups, ["item", "fiyat"])).toThrow(UnknownExportColumnError);
    expect(() => buildCategorySections(tabs, [], ["item"])).toThrow(UnknownExportColumnError);
  });
});
