// =============================================================================
// Süzgeç kurucu — "veya" kökü · bir seviye iç grup · "arasında" (rapor küçükler, plan §3.2)
// =============================================================================
// §1 ağaç fikstürü (`filter-contract.fixture.json` agac*) kurucu çıktısına birebir; aynı gövdeyi Teks-Erp
//    `test_rapor_tanimi` §1j sunucuda derler · §2 saf ağaç işlemleri (grup ekle/sil, bağlaç, tavan) · §3 cümle
//    ("arasında", grup parantezi) · §4 kurucu: kök bağlacı tıklanınca değişir, grup korunur, "arasında" iki
//    sınırı modal seçiciyle yazar, "Grup ekle" iç grup açar.
//
// NEGATİF SONDALAR (2026-10-26 ÖLÇÜLDÜ; cp + md5 ile birebir geri alındı):
//   F1 `normalizeRule` "arasında"yı tek değere indirdi → §1 + §4a + §4c ❌ 3 · F2 `addGroup` dış bağlaçla aynı bağlacı açtı → §2 ❌ 1; taban 7/0
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CatalogCube } from "../custom-api";
import fixture from "./filter-contract.fixture.json";
import { FilterBuilder } from "./FilterBuilder";
import { addGroup, addRule, countRules, describeFilter, MAX_FILTER_RULES, removeRuleAt, toggleJoin, toQueryFilter, type FilterGroup } from "./filter-model";

const HOURS = Array.from({ length: 24 }, (_, h) => ({ deger: String(h), etiket: `${String(h).padStart(2, "0")}:00` }));
vi.mock("./dimension-values", () => ({
  useDimensionOptions: () => ({ data: HOURS, isLoading: false, isError: false }),
  useValueLabels: () => (_dim: string, v: string) => ({ COZGU: "Çözgü" })[v] ?? HOURS.find((h) => h.deger === v)?.etiket ?? v,
}));

const CUBE: CatalogCube = {
  kimlik: "hata",
  ad: "Kalite / hata",
  olculer: [{ kimlik: "kalite.hataAdedi", ad: "Hata adedi", aciklama: "", birim: "adet", boyutlar: null }],
  boyutlar: [
    { kimlik: "saat", ad: "Saat", tur: "kategori", islecler: ["=", "!=", "in", "notIn", "between"] },
    { kimlik: "hataGrubu", ad: "Hata grubu", tur: "kategori", islecler: ["=", "!=", "in", "notIn"] },
  ],
  notlar: [],
} as unknown as CatalogCube;

function open(initial: unknown, onApply = vi.fn()) {
  render(<FilterBuilder open cube={CUBE} measure="kalite.hataAdedi" dimensions={CUBE.boyutlar} initial={initial} seedField={null} onApply={onApply} onClose={() => undefined} />);
  return onApply;
}

describe("§1 ağaç sözleşmesi", () => {
  it("kurucu girdisi → beklenen süzgeç → sunucunun derlediği gövde (birebir)", () => {
    const out = toQueryFilter(fixture.agacKurucuGirdisi as FilterGroup);
    expect(out).toEqual(fixture.agacBeklenenSuzgec);
    expect(fixture.agacGovde.bloklar[0]!.sorgu.suzgec).toEqual(out);
  });
});

describe("§2 ağaç işlemleri", () => {
  const root: FilterGroup = { combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }] };
  it("grup dış bağlacın tersiyle açılır; bağlaç yalnız kendi grubunda değişir; boşalan grup düşer", () => {
    const g = addGroup(root);
    expect(g.rules[1]).toEqual({ combinator: "or", rules: [{ field: "", operator: "in", value: [] }] });
    const t = toggleJoin(g, 1);
    expect(t.combinator).toBe("and");
    expect((t.rules[1] as FilterGroup).combinator).toBe("and");
    expect(toggleJoin(g, null).combinator).toBe("or");
    expect(removeRuleAt(g, [1, 0]).rules).toHaveLength(1);
  });
  it("toplam koşul tavanı gruplar dahil aşılmaz", () => {
    let g: FilterGroup = addGroup(root);
    for (let i = 0; i < 20; i++) g = i % 2 ? addRule(g, 1) : addRule(g, null);
    expect(countRules(g)).toBe(MAX_FILTER_RULES);
    expect(addGroup(g)).toBe(g);
  });
});

describe("§3 cümle", () => {
  it("\"arasında\" ve grup parantezi", () => {
    const labels = { field: (id: string) => ({ saat: "Saat", hataGrubu: "Hata grubu" })[id] ?? id, value: (_f: string, v: string) => (v === "COZGU" ? "Çözgü" : `${v.padStart(2, "0")}:00`) };
    expect(describeFilter(fixture.agacBeklenenSuzgec as FilterGroup, labels)).toBe("Hata grubu: Çözgü veya (Saat: 22:00 ile 05:00 arası · Hata grubu: Çözgü dışında)");
  });
});

describe("§4 kurucu", () => {
  it("a) kök \"veya\" + iç grup görünür; kök bağlacı tıklanınca \"ve\" olur, grup korunur", () => {
    const onApply = open(fixture.agacBeklenenSuzgec);
    const group = screen.getByRole("group", { name: "Koşul grubu" });
    expect(within(group).getAllByTestId("suzgec-satiri")).toHaveLength(2);
    expect(within(group).getByRole("button", { name: /Bağlaç: ve/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bağlaç: veya/ }));
    fireEvent.click(screen.getByRole("button", { name: "Uygula" }));
    const out = onApply.mock.calls[0]![0] as FilterGroup;
    expect(out.combinator).toBe("and");
    expect(out.rules[1]).toEqual(fixture.agacBeklenenSuzgec.rules[1]);
  });

  it("b) \"Grup ekle\" iç grup açar; cümle parantezle yazılır", () => {
    open({ combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: "COZGU" }] });
    fireEvent.click(screen.getByRole("button", { name: /Grup ekle/ }));
    expect(screen.getAllByTestId("suzgec-grubu")).toHaveLength(1);
  });

  it("c) \"arasında\" iki sınırı modal seçiciden yazar (sondan başa: 22 → 5)", () => {
    const onApply = open({ combinator: "and", rules: [{ field: "saat", operator: "between", value: [] }] });
    const range = screen.getByTestId("suzgec-aralik");
    fireEvent.click(within(range).getByRole("button", { name: "Başlangıç" }));
    fireEvent.click(screen.getByRole("option", { name: "22:00" }));
    fireEvent.click(within(screen.getByTestId("suzgec-aralik")).getByRole("button", { name: "Bitiş" }));
    fireEvent.click(screen.getByRole("option", { name: "05:00" }));
    expect(screen.getByText(/Saat: 22:00 ile 05:00 arası/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Uygula" }));
    expect(onApply.mock.calls[0]![0]).toEqual({ combinator: "and", rules: [{ field: "saat", operator: "between", value: ["22", "5"] }] });
  });
});
