import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ReportTable } from "@/pages/Reports/_v2/ReportTable";
import type { RaporSunumu, TabloBlok } from "@/pages/Reports/_v2/sunum";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { V2_KEYS_WITH_OWN_PAGE } from "@/pages/Reports/_v2/routes";
import { visibleCategorySuggestions, SUGGESTION_CHIP_LIMIT } from "@/pages/Finance/CashTransactions/cashTxnRules";
import { EXPENSE_SUMMARY_KEY, expenseRowTarget } from "./ExpenseSummaryPage";

// Sunucu zarfının küçük kopyası (`expense-summary.sunum.ts` biçimi): iptal iptal ayında eksi.
const tablo: TabloBlok = {
  kolonlar: [
    { anahtar: "kategori", baslik: "Kategori" },
    { anahtar: "ay_2019_01", baslik: "Oca 2019", birim: "TRY", hiza: "sag" },
    { anahtar: "ay_2019_03", baslik: "Mar 2019", birim: "TRY", hiza: "sag" },
    { anahtar: "toplam", baslik: "Toplam", birim: "TRY", hiza: "sag" },
  ],
  satirlar: [
    { kategori: "Kira", ay_2019_01: 1000, ay_2019_03: 0, toplam: 1000 },
    { kategori: "Elektrik", ay_2019_01: 400, ay_2019_03: -400, toplam: 0 },
  ],
  toplam: { kategori: "Toplam", ay_2019_01: 1400, ay_2019_03: -400, toplam: 1000 },
};

const sunum = {
  anahtar: EXPENSE_SUMMARY_KEY, baslik: "Masraf Özeti", soru: "?", donem: { from: "", to: "", etiket: "Ocak–Mart 2019" },
  anaSayi: { olcu: "masraf.harcanan", ad: "Harcanan", deger: 1000, birim: "TRY" }, yanSayilar: [], anlati: [], uyarilar: [], tanimlar: [], parametreler: [], grafik: null, tablo,
} as unknown as RaporSunumu;

describe("Masraf Özeti satırından Kasa Hareketleri'ne geçiş (D4-KUC2 e)", () => {
  const linked: TabloBlok = {
    ...tablo,
    satirlar: [
      { kategori: "Kira", kategoriAnahtari: "CAT:Kira", ay_2019_01: 1000, ay_2019_03: 0, toplam: 1000 },
      { kategori: "Kategorisiz", kategoriAnahtari: "CAT:", ay_2019_01: 5, ay_2019_03: 0, toplam: 5 },
      { kategori: "Eski zarf", ay_2019_01: 1, ay_2019_03: 0, toplam: 1 },
    ],
  };

  it("hedef sunucu anahtarından kurulur (istemci anahtar üretmez); anahtarsız satır bağsız", () => {
    expect(expenseRowTarget(linked.satirlar[0]!)).toBe("/finance/cash-transactions?category=CAT%3AKira");
    expect(expenseRowTarget(linked.satirlar[2]!)).toBeNull();
    expect(expenseRowTarget(tablo.toplam!)).toBeNull();
  });

  it("satıra tıklama ve Enter kategoriyle süzülmüş Kasa Hareketleri'ni açar; anahtarsız satır tıklanmaz", () => {
    const opened: string[] = [];
    render(<ReportTable table={linked} rowLink={{ target: expenseRowTarget, open: (to) => opened.push(to), title: "aç" }} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    fireEvent.click(screen.getByText("Kira"));
    fireEvent.keyDown(links[1]!, { key: "Enter" });
    fireEvent.click(screen.getByText("Eski zarf"));
    expect(opened).toEqual(["/finance/cash-transactions?category=CAT%3AKira", "/finance/cash-transactions?category=CAT%3A"]);
  });

  it("gizli anahtar alanı kolon olarak basılmaz (Excel/PDF kolonları değişmez)", () => {
    render(<ReportTable table={linked} />);
    expect(screen.queryByText("CAT:Kira")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("Masraf Özeti (D4-H1)", () => {
  it("ekran tablosu iptal ayındaki eksiyi gösterir", () => {
    render(<ReportTable table={tablo} />);
    expect(screen.getByText("Elektrik")).toBeTruthy();
    expect(screen.getAllByText(/-400|−400/).length).toBeGreaterThan(0);
  });

  it("Excel/PDF tablosu ekranın kolonlarını, satırlarını ve toplamını AYNEN taşır (tek zarf)", () => {
    const t = buildExportSpec(sunum).tables.at(-1)!;
    expect(t.columns.map((c) => c.key)).toEqual(tablo.kolonlar.map((c) => c.anahtar));
    expect(t.rows).toEqual(tablo.satirlar);
    expect(t.totalRow).toEqual(tablo.toplam);
    const sum = t.rows.reduce((a, r) => a + Number(r.toplam), 0);
    expect(sum).toBe(sunum.anaSayi.deger);
  });

  it("katalog satırı v2 · para; kendi sayfası var (v2 yayılımı bu anahtarı atlar)", () => {
    const e = REPORT_BY_KEY.get(EXPENSE_SUMMARY_KEY)!;
    expect(e.panelYolu).toBe("reports/finance/masraf-ozeti");
    expect(e.izin).toBe("report:finance");
    expect(V2_KEYS_WITH_OWN_PAGE.has(EXPENSE_SUMMARY_KEY)).toBe(true);
  });

});

describe("Masraf formu kategori önerisi (D4-H1)", () => {
  const all = ["Kira", "Elektrik", "Yakıt", "İnternet", "kira aidatı", "a", "b", "c", "d", "e"];

  it("boş kutuda en çok 8 öneri, sunucu sırasıyla", () => {
    const v = visibleCategorySuggestions(all, "");
    expect(v.length).toBe(SUGGESTION_CHIP_LIMIT);
    expect(v[0]).toBe("Kira");
  });

  it("yazınca içerenler (harf duyarsız, Türkçe küçültme); kutudaki metnin aynısı önerilmez", () => {
    expect(visibleCategorySuggestions(all, "kir")).toEqual(["Kira", "kira aidatı"]);
    expect(visibleCategorySuggestions(all, "inter")).toEqual(["İnternet"]);
    expect(visibleCategorySuggestions(all, "Kira")).toEqual(["kira aidatı"]);
  });
});
