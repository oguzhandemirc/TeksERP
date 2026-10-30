// =============================================================================
// BEKÇİ — S4a üç dokuma yaprağı: karo ↔ katalog panelYolu · devere kapalıyken levent karosu yok ·
//   "ölçülemedi" beyanı (0 değil) ekranda ve çıktıda · kaynak kırılımı + ufuk görünür
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { dokumaReportTiles, visibleDokumaTiles } from "./tile-config";
import { enYakinBitis, secenekOptions, type BeamResultReport, type FinishForecastRow } from "./leventReportTypes";
import { buildLeventSonucuExport } from "./leventExport";

const leventSonucu = vi.fn();
const leventBitisTahmini = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), dokumaReportsApi: { leventSonucu: (...a: unknown[]) => leventSonucu(...a), leventBitisTahmini: (...a: unknown[]) => leventBitisTahmini(...a) } }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({ shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, machineStopEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false, financeEnabled: false, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
import { LeventSonucuPage } from "./LeventSonucuPage";
import { LeventBitisTahminiPage } from "./LeventBitisTahminiPage";

const YENI = ["levent-sonucu", "kapasite-kullanimi", "levent-bitis-tahmini"];
const row = (over: Partial<BeamResultReport["kapananlar"][number]> = {}) => ({
  beamId: "b1", beamNo: "LV-7", physicalBeamNo: null, warpSpec: { id: "w1", code: "CZ-1", name: "Siyah", takeUpPct: null },
  sarilanM: 1000, sarilanKg: null, kgKaynak: null, beklenenKumasM: null, gercekKumasM: 190, gercekKaynak: { otomatik: 150, elle: 40 },
  kalanM: 0, fireM: null, firePct: null, status: "EXHAUSTED", kapanisAt: "2026-10-20T10:00:00Z", tezgahlar: ["T-07"], ...over,
});
const rapor: BeamResultReport = {
  kapananlar: [row()], acikLeventler: [],
  ozet: { leventSayisi: 1, sarilanM: 1000, beklenenM: 0, gercekM: 190, gercekKaynak: { otomatik: 150, elle: 40 }, fireM: 0, firePct: null, olculemedi: 1, acikLeventSayisi: 0 },
  meta: { ufuk: "2026-09-14", ufukOncesiSatir: 0, duzeltilmisTop: 2, kumasiOlculmeyenTuketim: 0, secenekler: { warpSpecId: [{ id: "w1", ad: "Siyah", kod: "CZ-1" }], machineId: [] } },
};

beforeEach(() => { leventSonucu.mockReset(); leventBitisTahmini.mockReset(); });

describe("karo ↔ katalog", () => {
  it("⭐ üç yeni karo katalogda kendi panelYolu ile, üç segmentli", () => {
    for (const k of YENI) {
      const t = dokumaReportTiles.find((x) => x.key === k)!;
      expect(t.to).toBe(`/reports/dokuma/${k}`);
      expect(REPORT_CATALOG.find((r) => r.key === `dokuma/${k}`)?.panelYolu).toBe(`reports/dokuma/${k}`);
    }
  });
  it("⭐ devere kapalı → levent karoları gizli, kapasite görünür; açık → hepsi", () => {
    const kapali = visibleDokumaTiles(dokumaReportTiles, false).map((t) => t.key);
    expect(kapali).not.toContain("levent-sonucu");
    expect(kapali).not.toContain("levent-bitis-tahmini");
    expect(kapali).toContain("kapasite-kullanimi");
    expect(visibleDokumaTiles(dokumaReportTiles, true)).toHaveLength(dokumaReportTiles.length);
  });
});

describe("saf yardımcılar", () => {
  it("seçenek etiketi 'KOD · Ad'; kodsuzsa ad", () => {
    expect(secenekOptions([{ id: "1", ad: "Tezgah 7", kod: "T-07" }, { id: "2", ad: "Yalın" }])).toEqual([{ id: "1", label: "T-07 · Tezgah 7" }, { id: "2", label: "Yalın" }]);
  });
  it("en yakın bitiş: null'lar atlanır, hiç yoksa null", () => {
    const r = (g: string | null) => ({ tahminiBitisGun: g }) as FinishForecastRow;
    expect(enYakinBitis([r(null), r("2026-11-02"), r("2026-10-28")])).toBe("2026-10-28");
    expect(enYakinBitis([r(null)])).toBeNull();
  });
  it("⭐ çıktı: beklenen/fire null → 'ölçülemedi' (0 değil); kaynak kırılımı + ufuk notu basılır", () => {
    const spec = buildLeventSonucuExport({ rapor, periodLabel: "x" });
    expect(spec.tables[0]!.rows[0]).toMatchObject({ beklenen: "ölçülemedi", fire: "ölçülemedi", firePct: "ölçülemedi", otomatik: 150, elle: 40 });
    expect(spec.meta!.join("\n")).toMatch(/Ölçülen \(top doğuşundan otomatik\)/);
    expect(spec.meta!.join("\n")).toMatch(/Ölçüm ufku: 2026-09-14/);
    expect(spec.meta!.join("\n")).toMatch(/Düzeltilmiş top: 2/);
  });
});

describe("sayfa render", () => {
  it("⭐ Levent Sonucu: şerit · ölçülemedi hücresi · kaynak kırılımı · ufuk · düzeltilmiş top notu", async () => {
    leventSonucu.mockResolvedValue({ success: true, data: rapor });
    renderWithProviders(<LeventSonucuPage />);
    const satir = (await screen.findByText("LV-7")).closest("tr")!;
    expect(within(satir).getAllByText("ölçülemedi").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Kapanan levent")).toBeInTheDocument();
    expect(screen.getByText(/Gerçek kumaş kaynağı/)).toBeInTheDocument();
    expect(screen.getByText(/Ölçüm ufku: 2026-09-14/)).toBeInTheDocument();
    expect(screen.getByText(/2 topun metresi tüketimden sonra düzeltildi/)).toBeInTheDocument();
  });
  it("⭐ Bitiş Tahmini: tarih süzgeci yok, tahmin yoksa gerekçe, uydurulmuş gün yok", async () => {
    leventBitisTahmini.mockResolvedValue({ success: true, data: {
      satirlar: [{ beamId: "b1", beamNo: "LV-9", machine: { id: "m1", code: "T-07", name: "Tezgah 7" }, position: 1, kalanM: 412, gunlukOrtM: null, kaynak: { otomatik: 0, elle: 0 }, tahminiBitisGun: null, kalanGun: null, hesaplanamadi: "son 7 günde tüketim yok" }],
      ozet: { leventSayisi: 1, tahminli: 0, hesaplanamadi: 1 },
      meta: { ufuk: "2026-09-14", ufukOncesiSatir: 0, pencereBaslangic: "2026-10-14", pencereGun: 7, secenekler: { machineId: [] } },
    } });
    renderWithProviders(<LeventBitisTahminiPage />);
    const satir = (await screen.findByText("LV-9")).closest("tr")!;
    expect(satir).toHaveTextContent("son 7 günde tüketim yok");
    expect(leventBitisTahmini).toHaveBeenCalledWith({ machineId: "" });
    expect(screen.queryByLabelText(/Başlangıç|Bitiş tarihi/)).toBeNull();
  });
});
