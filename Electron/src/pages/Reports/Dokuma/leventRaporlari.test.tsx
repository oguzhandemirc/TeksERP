// =============================================================================
// BEKÇİ — S4a üç dokuma yaprağı: karo ↔ katalog panelYolu · devere kapalıyken levent karosu yok ·
//   "ölçülemedi" beyanı (0 değil) ekranda ve çıktıda · kaynak kırılımı + ufuk görünür
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { dokumaReportTiles, visibleDokumaTiles } from "./tile-config";
import { enYakinBitis, leadText, secenekOptions, spareText, warpSpecCellText, type BeamResultReport, type FinishForecastRow } from "./leventReportTypes";

const leventBitisTahmini = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), dokumaReportsApi: { leventBitisTahmini: (...a: unknown[]) => leventBitisTahmini(...a) } }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({ shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, machineStopEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false, financeEnabled: false, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
import { LeventBitisTahminiPage } from "./LeventBitisTahminiPage";

const YENI = ["levent-bitis-tahmini"];
const row = (over: Partial<BeamResultReport["kapananlar"][number]> = {}) => ({
  beamId: "b1", beamNo: "LV-7", physicalBeamNo: null, warpSpec: { id: "w1", code: "CZ-1", name: "Siyah", takeUpPct: null },
  sarilanM: 1000, sarilanKg: null, kgKaynak: null, beklenenKumasM: null, gercekKumasM: 190, gercekKaynak: { otomatik: 150, elle: 40 },
  kalanM: 0, fireM: null, firePct: null, status: "EXHAUSTED", kapanisAt: "2026-10-20T10:00:00Z", tezgahlar: ["T-07"], ...over,
});
beforeEach(() => { leventBitisTahmini.mockReset(); });

describe("karo ↔ katalog", () => {
  it("⭐ kalan levent karosu katalogda kendi panelYolu ile, üç segmentli", () => {
    for (const k of YENI) {
      const t = dokumaReportTiles.find((x) => x.key === k)!;
      expect(t.to).toBe(`/reports/dokuma/${k}`);
      expect(REPORT_CATALOG.find((r) => r.key === `dokuma/${k}`)?.panelYolu).toBe(`reports/dokuma/${k}`);
    }
  });
  it("⭐ devere kapalı → levent karosu gizli, karne görünür; açık → hepsi", () => {
    const kapali = visibleDokumaTiles(dokumaReportTiles, false).map((t) => t.key);
    expect(kapali).not.toContain("levent-bitis-tahmini");
    expect(kapali).toContain("karne");
    expect(visibleDokumaTiles(dokumaReportTiles, true)).toHaveLength(dokumaReportTiles.length);
  });
});

describe("saf yardımcılar", () => {
  it("seçenek etiketi 'KOD · Ad'; kodsuzsa ad", () => {
    expect(secenekOptions([{ id: "1", ad: "Tezgah 7", kod: "T-07" }, { id: "2", ad: "Yalın" }])).toEqual([{ id: "1", label: "T-07 · Tezgah 7" }, { id: "2", label: "Yalın" }]);
  });
  it("⭐ SY-B2 katman etiketi: katmanlı işte çözgü hücresine eklenir; katmansızda metin bugünkü", () => {
    expect(warpSpecCellText(row())).toBe("CZ-1 · Siyah");
    const leno = row({ katman: { rol: "LENO", beamMode: "SEPARATE_BEAM", etiket: "Döner çözgü" } });
    expect(warpSpecCellText(leno)).toBe("CZ-1 · Siyah — Döner çözgü");
  });
  it("en yakın bitiş: null'lar atlanır, hiç yoksa null", () => {
    const r = (g: string | null) => ({ tahminiBitisGun: g }) as FinishForecastRow;
    expect(enYakinBitis([r(null), r("2026-11-02"), r("2026-10-28")])).toBe("2026-10-28");
    expect(enYakinBitis([r(null)])).toBeNull();
  });
});

describe("sayfa render", () => {
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
  it("⭐ S1 devere zamanlaması: yedek yok + gün geldi → 'Devereye ver' rozeti; yedekli satırda rozet yok", async () => {
    const base = { machine: { id: "m1", code: "T-07", name: "Tezgah 7" }, position: 1, kalanM: 300, gunlukOrtM: 100, kaynak: { otomatik: 0, elle: 700 }, tahminiBitisGun: "2026-11-25", kalanGun: 3, hesaplanamadi: null, warpSpec: { id: "w1", code: "CZ-1", name: "Siyah" }, leadDays: 4, lead: { kaynak: "OLCUM", ornek: 3, devereci: "Devereci A" }, orderByDay: "2026-11-21", orderByGerekce: null };
    leventBitisTahmini.mockResolvedValue({ success: true, data: {
      satirlar: [
        { ...base, beamId: "b1", beamNo: "LV-1", spare: { count: 0, m: 0, yoldaM: 0, yoldaSiparis: 0 }, devereAcil: true },
        { ...base, beamId: "b2", beamNo: "LV-2", spare: { count: 1, m: 400, yoldaM: 0, yoldaSiparis: 0 }, devereAcil: false },
      ],
      ozet: { leventSayisi: 2, tahminli: 2, hesaplanamadi: 0, devereAcil: 1 },
      meta: { ufuk: "2026-09-14", ufukOncesiSatir: 0, pencereBaslangic: "2026-11-16", pencereGun: 7, secenekler: { machineId: [] } },
    } });
    renderWithProviders(<LeventBitisTahminiPage />);
    const acil = (await screen.findByText("LV-1")).closest("tr")!;
    expect(acil).toHaveTextContent("Devereye ver");
    expect(acil).toHaveTextContent("Yok");
    expect(acil).toHaveTextContent("son 3 siparişin ortancası");
    const yedekli = screen.getByText("LV-2").closest("tr")!;
    expect(yedekli).toHaveTextContent("1 hazır");
    expect(yedekli.textContent).not.toMatch(/Devereye ver/);
  });
  it("S1 yardımcıları: eski sunucu (alan yok) → '—'; ayar yedeği beyanlı", () => {
    expect(spareText(undefined, String)).toBe("—");
    expect(spareText({ count: 0, m: 0, yoldaM: 500, yoldaSiparis: 1 }, (m) => `${m} m`)).toBe("yolda 500 m (1 sipariş)");
    expect(leadText({ leadDays: 7, lead: { kaynak: "AYAR", ornek: 0, devereci: null } })).toBe("7 gün (ayardaki varsayılan)");
    expect(leadText({ leadDays: null, lead: undefined })).toBeNull();
  });
});
