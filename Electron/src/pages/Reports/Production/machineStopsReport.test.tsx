import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ReportTable } from "@/pages/Reports/_v2/ReportTable";
import type { RaporSunumu, TabloBlok } from "@/pages/Reports/_v2/sunum";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { ROUTE_REGIME, isRouteModuleOpen } from "@/lib/route-modules";
import { resolveMachineStopEnabled } from "@/pages/Operations/MachineStops/stop-regime";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { V2_KEYS_WITH_OWN_PAGE } from "@/pages/Reports/_v2/routes";
import { productionReportTiles } from "./tile-config";
import { MACHINE_STOPS_REPORT_KEY } from "./MachineStopsReportPage";

// Sunucu zarfının küçük kopyası (`makine-duruslari.temel.ts` biçimi): açık duruş "Sürüyor", toplamda "1 sürüyor".
const tablo: TabloBlok = {
  kolonlar: [
    { anahtar: "makine", baslik: "Makine", hiza: "sol" },
    { anahtar: "tur", baslik: "Makine türü", hiza: "sol" },
    { anahtar: "adet", baslik: "Duruş sayısı", birim: "adet", hiza: "sag" },
    { anahtar: "dakika", baslik: "Süre", birim: "dakika", hiza: "sag" },
    { anahtar: "durum", baslik: "Şu an", hiza: "sol" },
    { anahtar: "metre", baslik: "Aynı dönemde çıkan", birim: "m", hiza: "sag" },
  ],
  satirlar: [
    { makine: "Kurşun-1", tur: "Kurşun", adet: 2, dakika: 90, durum: "Sürüyor", metre: 1200 },
    { makine: "Tambur-2", tur: "Tambur", adet: 1, dakika: 30, durum: "", metre: 0 },
  ],
  toplam: { makine: "Toplam", tur: "", adet: 3, dakika: 120, durum: "1 sürüyor", metre: 1200 },
};

const sunum = {
  anahtar: MACHINE_STOPS_REPORT_KEY, baslik: "Makineler neden durdu?", soru: "?", donem: { from: "", to: "", etiket: "Son 7 gün" },
  anaSayi: { olcu: "durus.dakika", ad: "Duruş süresi", deger: 120, birim: "dakika" }, yanSayilar: [], anlati: [], uyarilar: [], tanimlar: [], parametreler: [], grafik: null, tablo,
} as unknown as RaporSunumu;

const ctx = (over: Partial<OperationsVisibilityContext>): OperationsVisibilityContext =>
  ({ productionEnabled: true, dokumaEnabled: false, machineStopEnabled: false, ...over }) as OperationsVisibilityContext;

describe("Makine Duruşları raporu (D4-A4)", () => {
  it("ekran tablosu süren duruşu 'Sürüyor' diye işaretler", () => {
    render(<ReportTable table={tablo} />);
    expect(screen.getByText("Kurşun-1")).toBeTruthy();
    expect(screen.getByText("Sürüyor")).toBeTruthy();
  });

  it("Excel/PDF tablosu ekranın kolonlarını, satırlarını ve toplamını AYNEN taşır; toplam dakika = ana sayı", () => {
    const t = buildExportSpec(sunum).tables.at(-1)!;
    expect(t.columns.map((c) => c.key)).toEqual(tablo.kolonlar.map((c) => c.anahtar));
    expect(t.rows).toEqual(tablo.satirlar);
    expect(t.totalRow).toEqual(tablo.toplam);
    expect(t.rows.reduce((a, r) => a + Number(r.dakika), 0)).toBe(sunum.anaSayi.deger);
  });

  it("katalog satırı v2 · üretim izni; kendi sayfası var ve hub karosu aynı adrese gider", () => {
    const e = REPORT_BY_KEY.get(MACHINE_STOPS_REPORT_KEY)!;
    expect(e.panelYolu).toBe("reports/production/makine-duruslari");
    expect(e.izin).toBe("report:production");
    expect(V2_KEYS_WITH_OWN_PAGE.has(MACHINE_STOPS_REPORT_KEY)).toBe(true);
    expect(productionReportTiles.some((t) => t.to === `/${e.panelYolu}`)).toBe(true);
    expect(ROUTE_REGIME[e.panelYolu]).toBe("machineStopEnabled");
  });

  // NEGATİF SONDA (2026-10-30): ROUTE_REGIME'deki rapor satırı silindi → bu test kırmızı.
  it("⭐ görünürlük = dokuma ∨ (üretim ∧ makine duruşu takibi) — tek kaynak `resolveMachineStopEnabled`", () => {
    const path = "/reports/production/makine-duruslari";
    const of = (dokuma: boolean, production: boolean, tracking: boolean) =>
      isRouteModuleOpen(path, ctx({ dokumaEnabled: dokuma, productionEnabled: production,
        machineStopEnabled: resolveMachineStopEnabled({ dokumaEnabled: dokuma, productionEnabled: production, machineStopTrackingEnabled: tracking }) }));
    expect(of(true, true, false)).toBe(true);   // dokuma fabrikası: bugünkü gibi açık
    expect(of(false, true, true)).toBe(true);   // dokumasız, ayar açık (Gülkesim)
    expect(of(false, true, false)).toBe(false); // referans fabrika: ayar kapalı → karo/palet/route yok
    expect(of(false, false, true)).toBe(false); // üretim kapalı
  });
});
