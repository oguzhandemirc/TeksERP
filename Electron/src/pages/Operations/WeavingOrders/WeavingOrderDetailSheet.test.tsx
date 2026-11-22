// =============================================================================
// BEKÇİ — Dokuma iş emri sağ paneli: PLANLANDI cümlesi · açık koşum satırı (tezgah + duruş + operatör,
// tık → Tezgah Salonu) · hata ≠ kayıt yok · eski backend (alan yok) çökmez · açık uçlu · kırpılmış sayaç
// · sayfada satır tıklaması paneli açar (kapalı işte de)
// =============================================================================
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WeavingOrder } from "./types";
import type { WeavingOrderOverview } from "./overview/types";

const overview = vi.fn();
const listCursor = vi.fn();
const construction = vi.fn();
const cardHtml = vi.fn();
vi.mock("./service", () => ({
  weavingOrderService: {
    overview: (...a: unknown[]) => overview(...a),
    listCursor: (...a: unknown[]) => listCursor(...a),
    construction: (...a: unknown[]) => construction(...a),
    cardHtml: (...a: unknown[]) => cardHtml(...a),
  },
}));
const printTracked = vi.fn();
vi.mock("@/lib/print", () => ({ printTracked: (...a: unknown[]) => printTracked(...a) }));
const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useOpenTarget: () => openTarget }));
let tezgahEnabled = true;
vi.mock("@/hooks/usePricingEnabled", async (orig) => {
  const m = await orig<typeof import("@/hooks/usePricingEnabled")>();
  return { ...m, useTezgahEnabled: () => tezgahEnabled };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/components/data-table/FilterBar", () => ({ FilterControl: () => null }));
vi.mock("./fason/FasonSheet", () => ({ FasonSheet: () => null }));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { density: "comfortable" }, ready: true, setPreference: vi.fn() }),
}));

import { WeavingOrderDetailSheet } from "./WeavingOrderDetailSheet";
import { WeavingOrdersPage } from "./WeavingOrdersPage";

const ROW: WeavingOrder = {
  id: "wo1", weavingOrderNumber: "DK-0007", itemId: "i1", colorId: null, warpSpecId: null, plannedM: 1000,
  executionKind: "IN_HOUSE", subcontractorId: null, status: "PLANNED", plannedStartDate: null, plannedEndDate: null,
  notes: null, closedAt: null, cancelledAt: null, cancelReason: null, createdAt: "2026-10-20T06:00:00Z", updatedAt: "2026-10-20T06:00:00Z",
  item: { id: "i1", code: "K1", name: "PATOS" }, color: null, warpSpec: null, subcontractor: null, openRunCount: 0,
};
const EMPTY = { items: [], total: 0, truncated: false };
const PROGRESS = { plannedM: 1000, rollCount: 2, rollMeters: 250, runMeters: 300, closedRunCount: 1, unmeasuredRunCount: 0, doffCount: 2, fasonReceivedM: null };
const ok = (data: WeavingOrderOverview) => Promise.resolve({ success: true, data });

function renderSheet(order: WeavingOrder = ROW) {
  const handlers = { onClose: vi.fn(), onEdit: vi.fn(), onCloseOrder: vi.fn(), onCancel: vi.fn(), onFason: vi.fn() };
  renderWithProviders(<WeavingOrderDetailSheet order={order} {...handlers} />);
  return handlers;
}

beforeEach(() => {
  overview.mockReset();
  openTarget.mockReset();
  construction.mockReset();
  construction.mockResolvedValue({ itemId: "i1", recipeId: null, variantCode: null, widthCm: null, groundWarp: null, warpLayers: [], weft: null, weaveDesign: null, warnings: [] });
  cardHtml.mockReset();
  printTracked.mockReset();
  tezgahEnabled = true;
  useAuthStore.getState().setUser({ userId: "u1", username: "planci", permissions: ["weavingorder:read", "weavingorder:write", "loom:live-view"] } as never);
});

describe("WeavingOrderDetailSheet", () => {
  it("⭐ PLANLANDI iş, açık koşum yok → 'Henüz tezgaha verilmedi' cümlesi", async () => {
    overview.mockReturnValue(ok({ order: ROW, executionKind: "IN_HOUSE", progress: PROGRESS, liveRuns: EMPTY, recentRuns: EMPTY, recentDoffs: EMPTY, beams: null }));
    renderSheet();
    expect(await screen.findByTestId("wo-ov-live-empty")).toHaveTextContent(
      "Henüz tezgaha verilmedi — koşum tabletten ya da Tezgah Salonu'ndan açılır",
    );
    expect(overview).toHaveBeenCalledWith("wo1");
    expect(screen.getByTestId("wo-ov-progress")).toHaveTextContent("25%");
    // Düzenle/Kapat/İptal açık işte ve yazma izniyle görünür.
    expect(screen.getByRole("button", { name: /Düzenle/ })).toBeTruthy();
  });

  it("⭐ açık koşum satırı: tezgah · hat · duruş sebebi · operatör; tık → Tezgah Salonu ?tezgah=", async () => {
    const live = {
      id: "r1", machine: { id: "m9", code: "T12", name: "Tezgah 12" }, productionLineNo: 2, startedAt: "2026-10-20T05:00:00Z",
      targetUnitsPerMin: null, doffCount: 3, operator: { name: "Ayşe Dokumacı", since: "2026-10-20T05:00:00Z" }, beams: null,
      openStop: { id: "s1", reasonCode: null, reasonLabel: null, lossClass: null, startedAt: "2026-10-20T07:00:00Z" },
    };
    overview.mockReturnValue(ok({ order: { ...ROW, status: "IN_PROGRESS" }, progress: PROGRESS, liveRuns: { items: [live], total: 1, truncated: false } }));
    const h = renderSheet({ ...ROW, status: "IN_PROGRESS" });
    const row = await screen.findByTestId("wo-ov-live-run");
    expect(row).toHaveTextContent("T12 · Tezgah 12");
    expect(row).toHaveTextContent("Hat 2");
    expect(row).toHaveTextContent("Operatör: Ayşe Dokumacı");
    expect(row).toHaveTextContent("3 indirme");
    expect(screen.getByTestId("wo-ov-open-stop")).toHaveTextContent("Sebep bekleniyor");
    fireEvent.click(row);
    expect(openTarget).toHaveBeenCalledWith("/operations/weaving-floor?tezgah=m9", expect.anything());
    expect(h.onClose).toHaveBeenCalled();
  });

  it("tezgah modülü kapalı → satır tıklanmaz (düz satır)", async () => {
    tezgahEnabled = false;
    const live = { id: "r1", machine: { id: "m9", code: "T12", name: "Tezgah 12" }, productionLineNo: 1, startedAt: "2026-10-20T05:00:00Z", targetUnitsPerMin: null, doffCount: 0, operator: null, beams: null, openStop: null };
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: { items: [live], total: 1, truncated: false } }));
    renderSheet({ ...ROW, status: "IN_PROGRESS" });
    const row = await screen.findByTestId("wo-ov-live-run");
    expect(row.getAttribute("role")).toBeNull();
    fireEvent.click(row);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("⭐ istek düşer → hata + 'Yeniden dene'; 'kayıt yok'/'tezgaha verilmedi' YAZILMAZ; başlık satırdan", async () => {
    overview.mockRejectedValueOnce(new Error("503"));
    renderSheet();
    expect(await screen.findByTestId("wo-ov-error")).toHaveTextContent("“kayıt yok” cevabı DEĞİLDİR");
    expect(screen.queryByTestId("wo-ov-live-empty")).toBeNull();
    expect(screen.getByText("DK-0007", { selector: ".wonum" })).toBeTruthy();
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY }));
    fireEvent.click(screen.getByRole("button", { name: /Yeniden dene/ }));
    await screen.findByTestId("wo-ov-live-empty");
  });

  it("eski backend (alanlar yok) → çökmez, canlı bölümler çizilmez", async () => {
    overview.mockReturnValue(ok({}));
    renderSheet();
    await waitFor(() => expect(screen.queryByTestId("wo-ov-loading")).toBeNull());
    expect(screen.queryByTestId("wo-ov-kpis")).toBeNull();
    expect(screen.queryByTestId("wo-ov-live-empty")).toBeNull();
    expect(screen.queryByTestId("wo-ov-error")).toBeNull();
    expect(screen.getByTestId("weaving-order-sheet")).toHaveTextContent("PATOS");
  });

  it("⭐ açık uçlu iş (hedef null) → 'açık uçlu', yüzde yok", async () => {
    overview.mockReturnValue(ok({ progress: { ...PROGRESS, plannedM: null }, liveRuns: EMPTY }));
    renderSheet({ ...ROW, plannedM: null });
    expect(await screen.findByTestId("wo-ov-progress")).toHaveTextContent("açık uçlu");
    expect(screen.getByTestId("wo-ov-progress")).not.toHaveTextContent("%");
    expect(screen.queryByTestId("wo-ov-remaining")).toBeNull();
  });


  it("kırpılmış liste → 'son N / toplam M'; kapalı işte eylem yok", async () => {
    const doff = { id: "d1", code: "IND-1", machine: { id: "m1", code: "T1", name: "T1" }, productionLineNo: 1, doffedAt: "2026-10-19T10:00:00Z", pieceCount: 1, rolls: [{ id: "r1", barcode: "TOP-1", initialQty: 120, status: "IN_STOCK" }] };
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY, recentDoffs: { items: [doff], total: 37, truncated: true } }));
    renderSheet({ ...ROW, status: "COMPLETED" });
    expect(await screen.findByText("son 1 / toplam 37")).toBeTruthy();
    expect(screen.getByTestId("wo-ov-doffs")).toHaveTextContent("TOP-1 · 120 m");
    expect(screen.getByTestId("wo-ov-live-empty")).toHaveTextContent("İş kapatıldı — tezgahta değil");
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
  });
});

describe("WeavingOrdersPage — satır tıklaması", () => {
  it("⭐ kapalı işin satırına tık → panel açılır (form değil)", async () => {
    const done = { ...ROW, id: "wo2", weavingOrderNumber: "DK-0099", status: "COMPLETED" as const };
    listCursor.mockResolvedValue({ success: true, data: [done], pagination: { nextCursor: null, hasMore: false, limit: 50 } });
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY }));
    renderWithProviders(<WeavingOrdersPage />);
    fireEvent.click(await screen.findByText("DK-0099"));
    expect(await screen.findByTestId("weaving-order-sheet")).toBeTruthy();
    expect(overview).toHaveBeenCalledWith("wo2");
  });
});

describe("WeavingOrderDetailSheet — kalan metre", () => {
  it.each([
    ["dolu", { producedM: 378, remainingM: 622 }, "Kalan: 622 m"],
    ["null", { remainingM: null }, null],
    ["alan yok (eski backend)", {}, null],
  ] as const)("kalan metre: %s", async (_ad, extra, text) => {
    overview.mockReturnValue(ok({ progress: { ...PROGRESS, ...extra }, liveRuns: EMPTY }));
    renderSheet(ROW);
    await screen.findByTestId("wo-ov-progress");
    if (text) expect(screen.getByTestId("wo-ov-remaining")).toHaveTextContent(text);
    else expect(screen.queryByTestId("wo-ov-remaining")).toBeNull();
  });
});

describe("WeavingOrderDetailSheet — Yapı (kart görseli)", () => {
  const YARN = { id: "y", code: "IP1", name: "75 den", linearDensityDen: "75" };
  const CONSTRUCTION = {
    itemId: "i1", recipeId: null, variantCode: null, widthCm: null, warnings: [], weavingOrderNumber: "DK-0007",
    groundWarp: {
      id: "w1", code: "Ç1", name: "UA6007-Ç", endsCount: 30, takeUpPct: null, wastePct: null, yarnItem: YARN,
      yarns: [{ yarnItemId: "y", endsCount: 20, sortOrder: 0, yarnItem: YARN }, { yarnItemId: "y2", endsCount: 10, sortOrder: 1, yarnItem: { ...YARN, name: "150 den" } }],
      sequenceNote: "2A 1B", endsSequence: { repeat: [1, 1, 2], repeatCount: 10, remainder: 0, totalEnds: 30, matchesYarnEnds: true },
    },
    warpLayers: [],
    weft: { weftSpecId: "f1", code: "A1", name: "Atkı 1", picksPerCm: null, sequenceCode: "A2 B1", weftProgramNo: null, picksInRepeatTotal: 3,
      yarns: [{ sortOrder: 0, letter: "A", picksInRepeat: 2, yarnItem: YARN, cardYarnItem: null }, { sortOrder: 1, letter: "B", picksInRepeat: 1, yarnItem: YARN, cardYarnItem: null }],
      pickSequence: [1, 1, 2] },
    weaveDesign: { id: "d1", code: "UA6007", name: "Döner", kind: "LENO", loomFileName: "X.DOP", frameCount: 4, liftPlan: [[1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 0, 0]], lenoFrames: [1] },
  };

  it("⭐ mini armür + seçici + çözgü bandı; ızgara tık → desen kartının Armür sekmesi; yazdır → DESEN_KARTI", async () => {
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY }));
    construction.mockResolvedValue(CONSTRUCTION);
    cardHtml.mockResolvedValue("<html>kart</html>");
    useAuthStore.getState().setUser({ userId: "u1", username: "planci", permissions: ["weavingorder:read", "warpspec:read"] } as never);
    const h = renderSheet();
    const lift = await screen.findByTestId("wo-construction-lift");
    expect(construction).toHaveBeenCalledWith("wo1");
    expect(lift.querySelector("svg")?.getAttribute("aria-label")).toContain("3 atkı, 4 çerçeve, atkı seçici");
    expect(screen.getByTestId("warp-ends-strip")).toHaveTextContent("Rapor 3 tel");
    fireEvent.click(lift.querySelector("button") ?? lift);
    expect(h.onClose).toHaveBeenCalled();
    expect(openTarget.mock.calls[0]![0]).toBe("/definitions/weave-designs/d1?tab=lift&fabric=i1");
    fireEvent.click(screen.getByTestId("wo-print-card"));
    await waitFor(() => expect(printTracked).toHaveBeenCalledWith({ subject: { kind: "DESEN_KARTI", no: "DK-0007" }, html: "<html>kart</html>" }));
  });

  it("desen kartı yoksa armür çizilmez, çözgü bandı kalır, yazdır kapalı", async () => {
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY }));
    construction.mockResolvedValue({ ...CONSTRUCTION, weaveDesign: null });
    renderSheet();
    await screen.findByTestId("warp-ends-strip");
    expect(screen.queryByTestId("wo-construction-lift")).toBeNull();
    expect(screen.getByTestId("wo-print-card")).toBeDisabled();
  });

  it("yapısız ürün → boş cümle, yazdır yok", async () => {
    overview.mockReturnValue(ok({ progress: PROGRESS, liveRuns: EMPTY }));
    renderSheet();
    expect(await screen.findByTestId("wo-construction-empty")).toBeTruthy();
    expect(screen.queryByTestId("wo-print-card")).toBeNull();
  });
});
