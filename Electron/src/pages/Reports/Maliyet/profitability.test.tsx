import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildExportSpec, parameterSentence } from "@/pages/Reports/_v2/export-spec";
import { ReportTable } from "@/pages/Reports/_v2/ReportTable";
import type { RaporSunumu, TabloBlok } from "@/pages/Reports/_v2/sunum";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { V2_KEYS_WITH_OWN_PAGE } from "@/pages/Reports/_v2/routes";
import { costTiles } from "@/pages/Cost/tile-config";
import { maliyetReportTiles } from "./tile-config";
import { PROFITABILITY_REPORT_KEY, settingsSummaryOf } from "./ProfitabilityReportPage";
import { chipSpecsOf, chipValueText, nextSearchOf } from "@/pages/Reports/_v2/ParamChips";
import type { ParametreBeyani } from "@/pages/Reports/_v2/sunum";

// Sunucunun `scopeParameter` beyanının kopyası (backend `profitability.sunum.ts`).
const scopeParam = (deger: "hizmet" | "kumas"): ParametreBeyani => ({
  ad: "kapsam", etiket: "Kapsam", tur: "secim", deger, secenekler: [{ deger: "hizmet", etiket: "Hizmet işleri" }, { deger: "kumas", etiket: "Kumaş satışı" }],
});

// Sunucu zarfının küçük kopyası (`profitability.sunum.ts` biçimi): eksikli grup katkısı BOŞ + rozet.
const tablo: TabloBlok = {
  kolonlar: [
    { anahtar: "ad", baslik: "Müşteri" },
    { anahtar: "gelir", baslik: "Kesinleşen gelir", birim: "TRY", hiza: "sag" },
    { anahtar: "katki", baslik: "Kalan (katkı)", birim: "TRY", hiza: "sag" },
    { anahtar: "durum", baslik: "Durum" },
  ],
  satirlar: [
    { ad: "Kaya Perde", gelir: 200.5, katki: 150.5, durum: "" },
    { ad: "Ay Tekstil", gelir: 100, katki: null, durum: "eksik: sarf normu" },
  ],
  toplam: { ad: "Toplam", gelir: 300.5, katki: null, durum: "eksik: sarf normu" },
};
const HESAP = "makine süresi iş oturumundan · genel gider dağıtılmıyor";
const sunum = {
  anahtar: PROFITABILITY_REPORT_KEY, baslik: "Kârlılık", soru: "?", donem: { from: "", to: "", etiket: "Mart 2023" },
  anaSayi: { olcu: "karlilik.katki", ad: "Kalan (katkı)", deger: null, birim: "TRY", olculemedi: "1 işte eksik girdi var" },
  yanSayilar: [{ olcu: "karlilik.gelir", ad: "Kesinleşen gelir", deger: 300.5, birim: "TRY" }], anlati: [], uyarilar: [], tanimlar: [], grafik: null, tablo,
  parametreler: [{ ad: "kirilim", etiket: "Kırılım", tur: "secim", deger: "musteri", secenekler: [{ deger: "musteri", etiket: "Müşteri" }] }, { ad: "hesap", etiket: "hesap", tur: "metin", deger: HESAP }],
} as unknown as RaporSunumu;

describe("Kârlılık raporu (D4-G3)", () => {
  it("ekran tablosu eksik rozetini ve boş katkıyı gösterir", () => {
    render(<ReportTable table={tablo} />);
    expect(screen.getAllByText("eksik: sarf normu").length).toBeGreaterThan(0);
  });

  it("Excel/PDF tablosu ekranın kolonlarını, satırlarını ve toplamını AYNEN taşır (tek zarf)", () => {
    const spec = buildExportSpec(sunum);
    const t = spec.tables.at(-1)!;
    expect(t.columns.map((c) => c.key)).toEqual(tablo.kolonlar.map((c) => c.anahtar));
    expect(t.rows).toEqual(tablo.satirlar);
    expect(t.totalRow).toEqual(tablo.toplam);
    expect(spec.bloklar?.[0]).toMatchObject({ tur: "anaSayi" });
  });

  it("\"hesap: <ayar özeti>\" ekran başlığında ve Excel/PDF parametre cümlesinde aynı beyandan", () => {
    expect(settingsSummaryOf(sunum.parametreler)).toBe(HESAP);
    expect(parameterSentence(sunum.parametreler)).toContain(`hesap: ${HESAP}`);
    expect(buildExportSpec(sunum).parametreCumlesi).toContain(`hesap: ${HESAP}`);
  });

  it("K1 dilim 2: kapsam çipi sunucu beyanından çizilir, \"Tümü\" taşımaz, uygulanan kapsamı gösterir", () => {
    const params = [scopeParam("hizmet"), ...sunum.parametreler];
    const chips = chipSpecsOf(params, new URLSearchParams());
    const scope = chips.find((c) => c.key === "kapsam")!;
    expect(scope).toMatchObject({ label: "Kapsam", allowAll: false, selected: ["hizmet"] });
    expect(chipValueText(scope)).toBe("Hizmet işleri");
    expect(chips.find((c) => c.key === "kirilim")?.allowAll).toBe(true);
    expect(chipSpecsOf(params, new URLSearchParams("kapsam=kumas")).find((c) => c.key === "kapsam")?.selected).toEqual(["kumas"]);
  });

  it("K1 dilim 2: kapsam değişince kırılım düşer (eski kırılım yeni kapsamda yok); aynı kapsam ya da kırılım değişimi dokunmaz", () => {
    const url = new URLSearchParams("from=2023-03-01&kirilim=islem");
    const toFabric = nextSearchOf(url, "kapsam", ["kumas"], ["hizmet"]);
    expect(toFabric.get("kapsam")).toBe("kumas");
    expect(toFabric.has("kirilim")).toBe(false);
    expect(toFabric.get("from")).toBe("2023-03-01");
    expect(nextSearchOf(url, "kapsam", ["hizmet"], ["hizmet"]).get("kirilim")).toBe("islem");
    expect(nextSearchOf(new URLSearchParams("kapsam=kumas"), "kirilim", ["ay"], ["desen"]).get("kapsam")).toBe("kumas");
  });

  it("K1 dilim 2: kumaş tablosunda al-sat satırı görünür, eksik değer 0 yazılmaz, rozet günlük dilde", () => {
    const fabric: TabloBlok = {
      kolonlar: [
        { anahtar: "ad", baslik: "Desen" }, { anahtar: "gelir", baslik: "Satış geliri", birim: "TRY", hiza: "sag" },
        { anahtar: "dokuma", baslik: "Dokuma (tezgâh)", birim: "TRY", hiza: "sag" }, { anahtar: "katki", baslik: "Kalan (katkı)", birim: "TRY", hiza: "sag" },
        { anahtar: "durum", baslik: "Durum" },
      ],
      satirlar: [{ ad: "Hazır Voal", gelir: 200, dokuma: null, katki: null, durum: "eksik: dokuma işi yok" }],
    };
    render(<ReportTable table={fabric} />);
    const row = screen.getByText("Hazır Voal").closest("tr")!;
    expect(row.textContent).toContain("eksik: dokuma işi yok");
    expect([...row.querySelectorAll("td")].map((td) => td.textContent?.trim())).not.toContain("0");
  });

  it("katalog v2 · maliyet modülü · cost:read; kendi sayfası; Maliyet hub'ı ve rapor karosunda bulunur", () => {
    const e = REPORT_BY_KEY.get(PROFITABILITY_REPORT_KEY)!;
    expect(e.panelYolu).toBe("reports/maliyet/karlilik");
    expect(e.izin).toBe("cost:read");
    expect(e.modul).toBe("maliyetEnabled");
    expect(V2_KEYS_WITH_OWN_PAGE.has(PROFITABILITY_REPORT_KEY)).toBe(true);
    expect(costTiles.find((t) => t.key === "karlilik")?.to).toBe("/reports/maliyet/karlilik");
    expect(maliyetReportTiles.some((t) => t.to === "/reports/maliyet/karlilik")).toBe(true);
  });
});
