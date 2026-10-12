// Salon koşum eylemlerinin ekrana bağlanışı (F3): seçim çubuğundan pencere açılır ve seçili tezgahların HEPSİNİ
// (süzgeçte görünmeyenler dahil) alır; örnek veride ve TV'de eylem yok; veri tazelenemiyorsa (C.15) pasif + neden;
// pencere açıkken Esc seçimi bırakmaz.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({ ...(await orig<object>()), useDokumaEnabled: () => true }));
const api = vi.hoisted(() => ({ context: vi.fn(), preview: vi.fn(), assign: vi.fn(), finish: vi.fn(), revoke: vi.fn() }));
vi.mock("./jobs/runService", () => ({ runService: api }));
const stopApi = vi.hoisted(() => ({ preview: vi.fn(), open: vi.fn(), close: vi.fn(), revoke: vi.fn() }));
vi.mock("./stops/stopService", () => ({ stopService: stopApi }));
vi.mock("@/pages/Operations/MachineStops/useStopReasonPresets", () => ({ useStopReasonPresets: () => ({ active: [], labelOf: (c: string | null) => c ?? "—", isLoading: false }) }));

import { WeavingFloorView } from "./WeavingFloorView";
import type { FloorState, LiveLoom } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");
const mk = (id: string, openRuns: LiveLoom["openRuns"] = []): LiveLoom => ({
  id, code: `T-${id}`, hall: "Hol A", monitored: false, stateSource: "elle", loomType: null, targetRpm: null, rpm: null, picksPerCm: null, shift: null,
  today: { runSec: 0, plannedSec: 0 }, stops: [], dayBreakdown: [], events: [], job: null, beams: [], source: "OPERATOR", openStop: null, lines: 1, openRuns,
});
const floorOf = (looms: LiveLoom[], bulkStops = true): FloorState => ({ shift: null, halls: ["Hol A"], looms, updatedAt: NOW, rng: 1, bulkStops });
const LOOMS = [mk("a"), mk("b", [{ id: "r1", line: 1, jobId: "w", jobNo: "DI-1", startedAt: NOW }])];

const card = (id: string) => document.querySelector<HTMLElement>(`[data-loom-id="${id}"]`)!;
const bar = () => screen.getByRole("toolbar", { name: "Seçim çubuğu" });

function view(p: { sampleData?: boolean; stale?: boolean; bulkStops?: boolean } = {}) {
  return renderWithProviders(<WeavingFloorView floor={floorOf(LOOMS, p.bulkStops)} now={NOW} sampleData={p.sampleData ?? false} stale={p.stale} />);
}

beforeEach(() => {
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions: ["*"] } as unknown as JwtPayload });
  api.context.mockResolvedValue({ weavingOrders: [], weavingOrderRequired: true });
  api.preview.mockResolvedValue({ action: "FINISH", weavingOrder: null, rows: [] });
});
afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null });
});

describe("Tezgah Salonu — koşum eylemleri", () => {
  it("⭐ çubuktan 'İş ver…' pencereyi seçili tezgahların HEPSİYLE açar", async () => {
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("b"), { ctrlKey: true });
    fireEvent.click(within(bar()).getByRole("button", { name: "İş ver…" }));
    expect(await screen.findByRole("heading", { name: "İş ver — 2 tezgah" })).toBeTruthy();
  });

  it("⭐ 'İşi bitir…' yalnız açık koşumlu hatları önizler", async () => {
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("b"), { ctrlKey: true });
    fireEvent.click(within(bar()).getByRole("button", { name: "İşi bitir…" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith({ action: "FINISH", targets: [{ machineId: "b", productionLineNo: 1 }] }));
  });

  it("⭐ örnek veride koşum eylemi YOK", () => {
    view({ sampleData: true });
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()).queryByRole("button", { name: "İş ver…" })).toBeNull();
    expect(within(bar()).queryByText("İş ver…")).toBeNull();
  });

  it("⭐ C.15 veri tazelenemiyorsa İş ver pasif ve nedenini söyler", () => {
    view({ stale: true });
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()).getByLabelText(/İş ver… — Sunucuya ulaşılamıyor/)).toBeTruthy();
  });

  it("⭐ pencere açıkken tazelemede seçim değişse de Esc önce pencereyi kapatır, seçimi BIRAKMAZ", async () => {
    const r = view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("b"), { ctrlKey: true });
    fireEvent.click(within(bar()).getByRole("button", { name: "İş ver…" }));
    await screen.findByRole("heading", { name: "İş ver — 2 tezgah" });
    r.rerender(<WeavingFloorView floor={floorOf([LOOMS[0]!])} now={NOW} sampleData={false} />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: /İş ver —/ })).toBeNull());
    expect(bar().textContent).toContain("1 tezgah seçili");
  });
});

describe("Tezgah Salonu — toplu duruş eylemleri (F2)", () => {
  it("⭐ çubuktan 'Duruş bildir…' pencereyi seçili tezgahların HEPSİYLE açar", async () => {
    stopApi.preview.mockResolvedValue({ action: "OPEN", at: null, rows: [] });
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("b"), { ctrlKey: true });
    fireEvent.click(within(bar()).getByRole("button", { name: "Duruş bildir…" }));
    expect(await screen.findByRole("heading", { name: "Duruş bildir — 2 tezgah" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect(stopApi.preview).toHaveBeenCalledWith({ action: "OPEN", machineIds: ["a", "b"], at: null }));
  });

  it("⭐ C.15 veri tazelenemiyorsa Duruş bildir pasif ve nedenini söyler", () => {
    view({ stale: true });
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()).getByLabelText(/Duruş bildir… — Sunucuya ulaşılamıyor/)).toBeTruthy();
  });

  it("⭐ eski sunucu (bulkStopActions yok) → Duruş bildir pasif, 'sunucu güncellenince'", () => {
    view({ bulkStops: false });
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()).getByLabelText(/Duruş bildir… — .*sunucu güncellenince/)).toBeTruthy();
  });

  it("⭐ örnek veride duruş eylemi YOK", () => {
    view({ sampleData: true });
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()).queryByText("Duruş bildir…")).toBeNull();
  });
});
