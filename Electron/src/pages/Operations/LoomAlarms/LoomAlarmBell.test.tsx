// Alarm zili: FAIL-CLOSED görünürlük (bayrak · izin · sunucunun "kapalı" 403'ü) + rozet ve kısa liste.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LoomAlarmItem, LoomAlarmListResult } from "./types";

const state = { flag: true, perms: ["loom:alarm-view"] as string[] };
const list = vi.fn<(...a: unknown[]) => Promise<LoomAlarmListResult>>();

vi.mock("@/hooks/usePricingEnabled", () => ({ useTezgahAlarmEnabled: () => state.flag }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => state.perms.includes(p) }) }));
vi.mock("./service", () => ({ loomAlarmService: { list: (...a: unknown[]) => list(...a) } }));

import { LoomAlarmBell } from "./LoomAlarmBell";

const NOW = Date.parse("2026-10-11T08:00:00Z");

function alarm(over: Partial<LoomAlarmItem> = {}): LoomAlarmItem {
  return {
    id: "a1", kind: "STOP_OVERDUE", state: "OPEN", tier: 2,
    machine: { id: "m1", code: "TZ-12", name: "TZ-12", hallId: "h1", hallName: "Hol A" },
    stop: { id: "s1", startedAt: new Date(NOW - 23 * 60_000).toISOString(), endedAt: null, reasonCode: "IP_ATLAMA", reasonLabel: "İp atlama", lossClass: "UNPLANNED", source: "OPERATOR" },
    targetMinutes: 10, graceMinutes: 0, k1DueAt: new Date(NOW - 13 * 60_000).toISOString(), k2DueAt: new Date(NOW - 13 * 60_000).toISOString(),
    ackedBy: null, ackedAt: null, snoozedBy: null, snoozedUntil: null, closedAt: null, totalSec: null, overdueSec: null, cancelReason: null,
    createdAt: new Date(NOW - 13 * 60_000).toISOString(),
    ...over,
  };
}

const result = (items: LoomAlarmItem[]): LoomAlarmListResult => ({
  items, nextCursor: null,
  summary: { total: items.length, open: items.filter((i) => i.state === "OPEN").length, acked: items.filter((i) => i.state === "ACKED").length, resolved: 0, cancelled: 0, escalated: items.filter((i) => i.tier >= 2).length },
});

describe("LoomAlarmBell", () => {
  afterEach(() => {
    state.flag = true;
    state.perms = ["loom:alarm-view"];
    list.mockReset();
    vi.useRealTimers();
  });

  it("⭐ bayrak kapalı → zil hiç çizilmez ve sunucu yoklanmaz", async () => {
    state.flag = false;
    const { container } = renderWithProviders(<LoomAlarmBell />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
    expect(list).not.toHaveBeenCalled();
  });

  it("⭐ izin yok → zil hiç çizilmez ve sunucu yoklanmaz", async () => {
    state.perms = [];
    const { container } = renderWithProviders(<LoomAlarmBell />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
    expect(list).not.toHaveBeenCalled();
  });

  it("⭐ sunucu 403 LOOM_ALARM_DISABLED → zil kaybolur (sessiz)", async () => {
    list.mockRejectedValue({ response: { status: 403, data: { details: { code: "LOOM_ALARM_DISABLED" } } } });
    renderWithProviders(<LoomAlarmBell />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(list.mock.calls[0]?.[1]).toBe(true);
  });

  it("aktif alarm sayısı rozette; liste tezgah · sebep · süre/hedef · kademe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    list.mockResolvedValue(result([alarm(), alarm({ id: "a2", state: "ACKED", tier: 1, machine: { id: "m2", code: "TZ-07", name: "TZ-07", hallId: "h1", hallName: "Hol A" }, targetMinutes: null })]));
    renderWithProviders(<LoomAlarmBell />);
    await waitFor(() => expect(screen.getByTestId("loom-alarm-badge").textContent).toBe("2"));
    expect(list.mock.calls[0]?.[0]).toMatchObject({ scope: "active" });
    fireEvent.click(screen.getByRole("button", { name: /Tezgah alarmları: 2 aktif/ }));
    expect(await screen.findByText("TZ-12")).toBeTruthy();
    expect(screen.getAllByText("İp atlama")).toHaveLength(2);
    expect(screen.getByText("23 dk")).toBeTruthy();
    expect(screen.getByText("23 dk / hedef 10 dk")).toBeTruthy();
    expect(screen.getByText("Kademe 2")).toBeTruthy();
    expect(screen.getByText(/Tümünü gör/)).toBeTruthy();
  });

  it("aktif alarm yokken zil durur, rozet çizilmez", async () => {
    list.mockResolvedValue(result([]));
    renderWithProviders(<LoomAlarmBell />);
    await waitFor(() => expect(screen.getByRole("button", { name: /aktif alarm yok/ })).toBeTruthy());
    expect(screen.queryByTestId("loom-alarm-badge")).toBeNull();
  });
});
