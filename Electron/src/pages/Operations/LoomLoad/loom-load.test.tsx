// SY-3 L2 Tezgâh Yükü: metin yardımcıları (null nedeni, varsayım cümlesi, fabrika saati) + sayfa (tezgâh kartları,
// tezgâhsız işler, boş durum) + karo ↔ route izin/modül hizası.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { productionTiles } from "../tiles/production";
import type { LoomLoadJob, LoomLoadResponse, LoomLoadRow } from "./types";
import userEvent from "@testing-library/user-event";
import { assumptionText, freeAtCell, horizonDays, hoursText, jobHoursHint, jobSlots, loomMatches, summaryText } from "./loom-load-text";
import { timelineAxis } from "./loom-load-axis";

const get = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ loomLoadService: { get } }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, titleExtra, actions }: { title: string; titleExtra?: ReactNode; actions?: ReactNode }) => <header><h1>{title}</h1>{titleExtra}{actions}</header>,
}));
import { LoomLoadPage } from "./LoomLoadPage";

const job = (over: Partial<LoomLoadJob> = {}): LoomLoadJob => ({
  weavingOrderId: "w1", weavingOrderNumber: "DI-0001", status: "IN_PROGRESS", itemId: "i1", itemCode: "D2057", itemName: "Tül",
  plannedM: 1000, producedM: 200, remainingM: 800, plannedStartDate: null, picksPerCm: 24,
  assignment: "OPEN_RUN", runStartedAt: "2026-11-11T05:00:00.000Z", sharedAcrossLooms: false, estimatedHours: 30.5, ...over,
});
const loom = (over: Partial<LoomLoadRow> = {}): LoomLoadRow => ({
  machineId: "m1", code: "T-01", name: "Tezgâh 1", planRpm: 420, planEfficiencyPct: 85, jobs: [job()],
  totalEstimatedHours: 30.5, estimatedFreeAtIfContinuous: "2026-11-12T12:30:00.000Z", ...over,
});
const data = (over: Partial<LoomLoadResponse> = {}): LoomLoadResponse => ({
  generatedAt: "2026-11-11T06:00:00.000Z", assumption: "CONTINUOUS_24H_FROM_NOW", looms: [loom()], unassigned: [], ...over,
});

describe("loom-load-text", () => {
  it("varsayım açıkça yazılır; tanınmayan değer ham", () => {
    expect(assumptionText("CONTINUOUS_24H_FROM_NOW")).toMatch(/hiç durmadan, günde 24 saat/);
    expect(assumptionText("BASKA")).toBe("Boşalma varsayımı: BASKA");
  });
  it("saat: 24'ün altı yalın, üstü gün karşılığıyla; null '—'", () => {
    expect(hoursText(12.25)).toBe("12,3 sa");
    expect(hoursText(52)).toBe("52 sa · ≈2,2 gün");
    expect(hoursText(null)).toBe("—");
  });
  it("süre null nedeni: çok tezgâh önce; yoksa eksik terimler tek cümlede", () => {
    expect(jobHoursHint(job(), loom())).toBeNull();
    expect(jobHoursHint(job({ estimatedHours: null, sharedAcrossLooms: true }), loom())).toMatch(/birden çok tezgâhta/);
    expect(jobHoursHint(job({ estimatedHours: null, picksPerCm: null, remainingM: null }), loom({ planRpm: null })))
      .toBe("Süre hesaplanamadı: işin plan metresi yok, tezgâhın plan devri girilmemiş, atkı sıklığı bilinmiyor (işte ve üründe atkı kartı yok).");
  });
  it("boşalma: işsiz 'Boş'; toplam null '—' + neden; yoksa fabrika saati", () => {
    expect(freeAtCell(loom({ jobs: [], totalEstimatedHours: 0 }))).toEqual({ text: "Boş", hint: null });
    expect(freeAtCell(loom({ totalEstimatedHours: null, estimatedFreeAtIfContinuous: null })).hint).toMatch(/bilinmiyor/);
    expect(freeAtCell(loom()).text).toBe(fmtFactoryDateTime("2026-11-12T12:30:00.000Z"));
  });
  it("filtre: dolu/boş/süresi bilinmeyen; arama tezgâh, iş emri ve üründe (Türkçe harf duyarsız)", () => {
    const idle = loom({ machineId: "m2", code: "T-02", name: "İkinci", jobs: [], totalEstimatedHours: 0 });
    const unk = loom({ machineId: "m3", totalEstimatedHours: null });
    expect(loomMatches(loom(), "", "busy")).toBe(true);
    expect(loomMatches(idle, "", "busy")).toBe(false);
    expect(loomMatches(idle, "", "idle")).toBe(true);
    expect(loomMatches(loom(), "", "unknown")).toBe(false);
    expect(loomMatches(unk, "", "unknown")).toBe(true);
    expect(loomMatches(idle, "ikinci", "all")).toBe(true);
    expect(loomMatches(loom(), "di-0001", "all")).toBe(true);
    expect(loomMatches(loom(), "tül", "all")).toBe(true);
    expect(loomMatches(loom(), "yok", "all")).toBe(false);
  });
  it("iş yerleşimi: başlangıç önceki sunucu saatlerinin toplamı; bilinmeyen sonrası konumsuz", () => {
    const slots = jobSlots(loom({ jobs: [job({ estimatedHours: 10 }), job({ weavingOrderId: "w2", estimatedHours: null }), job({ weavingOrderId: "w3" })] }));
    expect(slots.map((s) => s.startH)).toEqual([0, 10, null]);
  });
  it("ufuk: otomatikte en geç boşalma + 1 gün, 3–30 arası", () => {
    expect(horizonDays([loom({ totalEstimatedHours: 30.5 })], "auto")).toBe(3);
    expect(horizonDays([loom({ totalEstimatedHours: 24 * 9 })], "auto")).toBe(10);
    expect(horizonDays([loom({ totalEstimatedHours: 24 * 90 })], "auto")).toBe(30);
    expect(horizonDays([loom()], "7")).toBe(7);
  });
  it("eksen bugünün fabrika günü başında açılır; şimdi çizgisi generatedAt", () => {
    const a = timelineAxis("2026-11-11T06:00:00.000Z", 3);
    expect(a.ticks.filter((t) => t.major)).toHaveLength(3);
    expect(a.spanH).toBe(72);
    expect(a.nowH).toBeGreaterThanOrEqual(0);
    expect(a.nowH).toBeLessThan(24);
  });
  it("özet şeridi tezgâhsız işi sayar", () => {
    expect(summaryText({ looms: [loom(), loom({ machineId: "m2", jobs: [] })], unassigned: [job()] })).toBe("2 tezgâh · 1 dolu · 1 boş · 1 iş tezgâh bekliyor");
  });
});

describe("LoomLoadPage", () => {
  beforeEach(() => get.mockReset());

  it("tezgâh kartı iş sırasını, kalan metreyi, süreyi ve boşalmayı çizer; tezgâhsız işler ayrı bölüm", async () => {
    get.mockResolvedValue(data({
      looms: [loom(), loom({ machineId: "m2", code: "T-02", jobs: [job({ weavingOrderId: "w2", estimatedHours: null, picksPerCm: null })], totalEstimatedHours: null, estimatedFreeAtIfContinuous: null })],
      unassigned: [{ ...job({ weavingOrderId: "w3", weavingOrderNumber: "DI-0003", remainingM: null }) }],
    }));
    renderWithProviders(<LoomLoadPage />);
    const cards = await screen.findAllByTestId("loom-load-card");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("DI-0001");
    expect(cards[0]).toHaveTextContent("800 m");
    expect(cards[0]).toHaveTextContent("30,5 sa · ≈1,3 gün");
    // Varsayım satırda değil ⓘ balonunda.
    expect(screen.queryByText(/Vardiya, duruş ve bakım/)).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Boşalma zamanı nasıl hesaplanır" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Vardiya, duruş ve bakım hesaba katılmaz");
    expect(screen.getAllByTestId("loom-load-job")).toHaveLength(2);
    expect(screen.getByLabelText(/bilinmiyor: Süre hesaplanamadı: atkı sıklığı/)).toBeInTheDocument();
    expect(screen.getByText("Tezgâh bekleyen işler (1)")).toBeInTheDocument();
    expect(screen.getByTestId("loom-load-unassigned-job")).toHaveTextContent("DI-0003");
    expect(screen.getByLabelText(/bilinmiyor: İşin plan metresi yok/)).toBeInTheDocument();
  });

  it("arama hiçbir tezgâha uymazsa ne yapılacağını söyler ve filtresi temizler", async () => {
    get.mockResolvedValue(data());
    renderWithProviders(<LoomLoadPage />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox"), "zzz");
    expect(screen.getByText("Aramaya ya da filtreye uyan tezgâh yok.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filtreyi temizle" }));
    expect(screen.getAllByTestId("loom-load-card")).toHaveLength(1);
  });

  it("tezgâh ve iş yoksa boş durum; tezgâhsız iş yoksa bölüm yok", async () => {
    get.mockResolvedValue(data({ looms: [], unassigned: [] }));
    renderWithProviders(<LoomLoadPage />);
    expect(await screen.findByText("Tanımlı dokuma tezgâhı yok")).toBeInTheDocument();
    expect(screen.queryByText(/Tezgâh bekleyen işler/)).toBeNull();
  });
});

describe("Tezgâh Yükü karosu", () => {
  it("adres, izin ve modül route ile birebir; dokuma kapalıyken çizilmez", () => {
    const t = productionTiles.find((x) => x.key === "loom-load")!;
    expect(t.to).toBe("/operations/loom-load");
    expect(t.permission).toBe("weavingorder:read");
    expect(ROUTE_MODULE["operations/loom-load"]).toBe("dokumaEnabled");
    expect(t.visibleWhen?.({ dokumaEnabled: false } as never)).toBe(false);
    expect(t.visibleWhen?.({ dokumaEnabled: true } as never)).toBe(true);
  });
});
