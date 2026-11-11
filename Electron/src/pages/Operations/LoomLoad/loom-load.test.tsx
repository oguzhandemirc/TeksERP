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
import { assumptionText, freeAtCell, hoursText, jobHoursHint, summaryText } from "./loom-load-text";

const get = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ loomLoadService: { get } }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
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
    expect(screen.getByTestId("loom-load-assumption")).toHaveTextContent("Vardiya, duruş ve bakım hesaba katılmaz");
    expect(screen.getByLabelText(/bilinmiyor: Süre hesaplanamadı: atkı sıklığı/)).toBeInTheDocument();
    expect(screen.getByText("Tezgâh bekleyen işler (1)")).toBeInTheDocument();
    expect(screen.getByTestId("loom-load-unassigned-job")).toHaveTextContent("DI-0003");
    expect(screen.getByLabelText(/bilinmiyor: İşin plan metresi yok/)).toBeInTheDocument();
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
