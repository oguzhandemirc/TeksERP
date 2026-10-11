// Alarm sayfası: canlı sayaç (sunucu saatine hizalı), eylem düğmeleri izne göre, zaman çizgisi
// fabrika saatinden, sunucu "kapalı" derse yetki hatası değil "kapalı" cümlesi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { LoomAlarmDetail } from "./types";

const state = { perms: ["loom:alarm-view"] as string[] };
const detail = vi.fn<(id: string) => Promise<LoomAlarmDetail>>();

vi.mock("@/hooks/usePricingEnabled", () => ({
  useTezgahAlarmEnabled: () => true,
  useFeatureFlags: () => ({ data: { data: { devereEnabled: false, devereMountTracking: false } } }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => state.perms.includes(p) }) }));
vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: "u-me" } }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("./service", () => ({ loomAlarmService: { detail: (id: string) => detail(id), mountedBeams: vi.fn() } }));

import { LoomAlarmDetailPage } from "./LoomAlarmDetailPage";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

function dto(over: Partial<LoomAlarmDetail["alarm"]> = {}): LoomAlarmDetail {
  return {
    alarm: {
      id: "a1", kind: "STOP_OVERDUE", state: "OPEN", tier: 1,
      machine: { id: "m1", code: "TZ-12", name: "TZ-12", hallId: "h1", hallName: "Hol A" },
      stop: { id: "s1", startedAt: iso(23), endedAt: null, reasonCode: "IP_ATLAMA", reasonLabel: "İp atlama", lossClass: "UNPLANNED", source: "OPERATOR" },
      targetMinutes: 10, graceMinutes: 10, k1DueAt: iso(13), k2DueAt: new Date(NOW + 2 * 60_000).toISOString(),
      ackedBy: null, ackedAt: null, snoozedBy: null, snoozedUntil: null, closedAt: null, totalSec: null, overdueSec: null, cancelReason: null,
      createdAt: iso(13),
      ...over,
    },
    nextDueAt: new Date(NOW + 2 * 60_000).toISOString(),
    timeline: [{ id: "e1", kind: "RAISED", at: iso(13), tier: 1, user: null, snoozedUntil: null, note: null, code: null, retractsEventId: null, retracted: false }],
    context: { job: { weavingOrderNumber: "DK1110260001", itemName: "Poplin", colorName: "Beyaz" } },
    similar: null,
    recentStops: [],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/operations/loom-alarms/a1"]}>
        <Routes>
          <Route path="/operations/loom-alarms/:id" element={<LoomAlarmDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoomAlarmDetailPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    state.perms = ["loom:alarm-view"];
    detail.mockReset();
  });

  it("⭐ canlı sayaç süreyi akıtır; hedef yanında", async () => {
    detail.mockResolvedValue(dto());
    renderPage();
    expect((await screen.findByTestId("alarm-timer")).textContent).toBe("23:00");
    expect(screen.getByText(/hedef 10 dk/)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("alarm-timer").textContent).toBe("23:05");
  });

  it("⭐ yalnız görme izni → eylem düğmesi yok; Tezgah Salonu izni yoksa o da yok", async () => {
    detail.mockResolvedValue(dto());
    renderPage();
    await screen.findByTestId("alarm-timer");
    expect(screen.queryByRole("button", { name: /Üstlen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sustur/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Not ekle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tezgah Salonunda göster/ })).toBeNull();
  });

  it("⭐ eylem izni → Üstlen · Sustur · Not; Salon izni → Tezgah Salonunda göster", async () => {
    state.perms = ["loom:alarm-view", "loom:alarm-ack", "loom:live-view"];
    detail.mockResolvedValue(dto());
    renderPage();
    await screen.findByTestId("alarm-timer");
    expect(screen.getByRole("button", { name: /Üstlen/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sustur/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Not ekle/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tezgah Salonunda göster/ })).toBeTruthy();
  });

  it("başkasının üstlendiği alarm → bırakma yalnız üst kademe izniyle", async () => {
    state.perms = ["loom:alarm-view", "loom:alarm-ack"];
    detail.mockResolvedValue(dto({ state: "ACKED", ackedBy: { id: "u-x", name: "Ahmet Usta" }, ackedAt: iso(5) }));
    const { unmount } = renderPage();
    await screen.findByTestId("alarm-timer");
    expect(screen.queryByRole("button", { name: /bırak/i })).toBeNull();
    unmount();
    state.perms.push("loom:alarm-escalation");
    renderPage();
    expect(await screen.findByRole("button", { name: /Üstlenmeyi bırak \(Ahmet Usta\)/ })).toBeTruthy();
  });

  it("zaman çizgisi ve bağlam fabrika saatinden / terimle", async () => {
    detail.mockResolvedValue(dto());
    renderPage();
    await screen.findByTestId("alarm-timer");
    expect(screen.getByText("10:37")).toBeTruthy();
    expect(screen.getByText("Görevliye bildirildi (1. kademe)")).toBeTruthy();
    expect(screen.getByText("~11:02")).toBeTruthy();
    expect(screen.getByText("Dokuma İş Emri")).toBeTruthy();
  });

  it("⭐ sunucu LOOM_ALARM_DISABLED → 'kapalı' cümlesi (yetki hatası değil)", async () => {
    detail.mockRejectedValue({ response: { status: 403, data: { details: { code: "LOOM_ALARM_DISABLED" } } } });
    renderPage();
    expect(await screen.findByText(/bu kurulumda kapalı/)).toBeTruthy();
  });
});
