// Kırmızı şerit: FAIL-CLOSED (bayrak/izin yoksa hiç çizilmez, ses/bildirim yok); yeni alarmda bir kez
// ses + bildirim; kapatılan şerit aynı kademede geri gelmez, yeni kademede yeniden açılır.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LoomAlarmItem, LoomAlarmListResult } from "./types";

const state = { flag: true, perms: ["loom:alarm-view", "loom:alarm-ack"] as string[], sound: true };
const list = vi.fn<(...a: unknown[]) => Promise<LoomAlarmListResult>>();
const navigateActive = vi.fn();

vi.mock("@/hooks/usePricingEnabled", () => ({
  useTezgahAlarmEnabled: () => state.flag,
  useFeatureFlags: () => ({ data: { data: { tezgahAlarmRenotifyMinutes: 10 } } }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => state.perms.includes(p) }) }));
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: { navigateActive: typeof navigateActive }) => unknown) => sel({ navigateActive }) }));
vi.mock("./useLoomAlarmSoundPref", () => ({ useLoomAlarmSoundPref: () => ({ on: state.sound, toggle: vi.fn() }) }));
vi.mock("./service", () => ({ loomAlarmService: { list: (...a: unknown[]) => list(...a), ack: vi.fn() } }));

import { LoomAlarmStrip } from "./LoomAlarmStrip";
import { useAuthStore } from "@/store/auth";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";

function alarm(over: Partial<LoomAlarmItem> = {}): LoomAlarmItem {
  return {
    id: ID, kind: "STOP_OVERDUE", state: "OPEN", tier: 1,
    machine: { id: "m1", code: "TZ-12", name: "TZ-12", hallId: "h1", hallName: "Hol A" },
    stop: { id: "s1", startedAt: new Date(NOW - 23 * 60_000).toISOString(), endedAt: null, reasonCode: "IP", reasonLabel: "İp atlama", lossClass: "UNPLANNED", source: "OPERATOR" },
    targetMinutes: 10, graceMinutes: 0, k1DueAt: new Date(NOW - 60_000).toISOString(), k2DueAt: null,
    ackedBy: null, ackedAt: null, snoozedBy: null, snoozedUntil: null, closedAt: null, totalSec: null, overdueSec: null, cancelReason: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

const result = (items: LoomAlarmItem[]): LoomAlarmListResult => ({
  items, nextCursor: null,
  summary: { total: items.length, open: items.filter((i) => i.state === "OPEN").length, acked: 0, resolved: 0, cancelled: 0, escalated: 0 },
});

const outputs = () => ({ playTone: vi.fn(), notify: vi.fn() });

function setup() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    useAuthStore.setState({ user: { userId: "u1" } as never });
  });
  afterEach(() => {
    state.flag = true;
    state.perms = ["loom:alarm-view", "loom:alarm-ack"];
    state.sound = true;
    list.mockReset();
    navigateActive.mockReset();
    vi.useRealTimers();
  });
}

describe("LoomAlarmStrip — kapı ve ilk çalma", () => {
  setup();

  it("⭐ bayrak kapalı → şerit yok, yoklama yok, ses/bildirim yok", async () => {
    state.flag = false;
    const out = outputs();
    const { container } = renderWithProviders(<LoomAlarmStrip outputs={out} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe("");
    expect(list).not.toHaveBeenCalled();
    expect(out.playTone).not.toHaveBeenCalled();
    expect(out.notify).not.toHaveBeenCalled();
  });

  it("⭐ yeni alarm: şerit (tezgah · sebep · süre) + BİR ses + BİR bildirim; Alarmı aç sayfaya gider", async () => {
    list.mockResolvedValue(result([alarm()]));
    const out = outputs();
    renderWithProviders(<LoomAlarmStrip outputs={out} />);
    const strip = await screen.findByTestId("loom-alarm-strip");
    expect(strip.textContent).toContain("TZ-12");
    expect(strip.textContent).toContain("İp atlama");
    expect(strip.textContent).toContain("23 dk / hedef 10 dk");
    await waitFor(() => expect(out.notify).toHaveBeenCalledTimes(1));
    expect(out.playTone).toHaveBeenCalledTimes(1);
    expect(out.notify.mock.calls[0]?.[0]).toMatchObject({ alarmId: ID });
    expect(screen.getByRole("button", { name: "Üstlen" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Alarmı aç" }));
    expect(navigateActive).toHaveBeenCalledWith(`/operations/loom-alarms/${ID}`);
  });

  it("⭐ ses tercihi kapalı → ses çalmaz (şerit ve bildirim sürer)", async () => {
    state.sound = false;
    list.mockResolvedValue(result([alarm()]));
    const out = outputs();
    renderWithProviders(<LoomAlarmStrip outputs={out} />);
    await screen.findByTestId("loom-alarm-strip");
    await waitFor(() => expect(out.notify).toHaveBeenCalledTimes(1));
    expect(out.playTone).not.toHaveBeenCalled();
  });

});

describe("LoomAlarmStrip — kapatma, kademe, izin", () => {
  setup();

  it("⭐ kapatılan şerit aynı kademede gelmez; yeniden açılışta (sayfa yenileme) da çift ses yok", async () => {
    list.mockResolvedValue(result([alarm()]));
    const out = outputs();
    const first = renderWithProviders(<LoomAlarmStrip outputs={out} />);
    await screen.findByTestId("loom-alarm-strip");
    fireEvent.click(screen.getByRole("button", { name: /Şeridi kapat/ }));
    expect(screen.queryByTestId("loom-alarm-strip")).toBeNull();
    first.unmount();
    renderWithProviders(<LoomAlarmStrip outputs={out} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByTestId("loom-alarm-strip")).toBeNull();
    expect(out.playTone).toHaveBeenCalledTimes(1);
    expect(out.notify).toHaveBeenCalledTimes(1);
  });

  it("⭐ kapatılmış şerit 2. kademede yeniden açılır ve bir kez daha çalar", async () => {
    list.mockResolvedValue(result([alarm()]));
    const out = outputs();
    const first = renderWithProviders(<LoomAlarmStrip outputs={out} />);
    await screen.findByTestId("loom-alarm-strip");
    fireEvent.click(screen.getByRole("button", { name: /Şeridi kapat/ }));
    first.unmount();
    list.mockResolvedValue(result([alarm({ tier: 2, k2DueAt: new Date(NOW).toISOString() })]));
    renderWithProviders(<LoomAlarmStrip outputs={out} />);
    expect((await screen.findByTestId("loom-alarm-strip")).textContent).toContain("Kademe 2");
    await waitFor(() => expect(out.playTone.mock.calls).toEqual([[1], [2]]));
  });

  it("üstlenme izni yoksa Üstlen düğmesi çizilmez", async () => {
    state.perms = ["loom:alarm-view"];
    list.mockResolvedValue(result([alarm()]));
    renderWithProviders(<LoomAlarmStrip outputs={outputs()} />);
    await screen.findByTestId("loom-alarm-strip");
    expect(screen.queryByRole("button", { name: "Üstlen" })).toBeNull();
  });

  it("üstlenilmiş alarm şerit açmaz", async () => {
    list.mockResolvedValue(result([alarm({ state: "ACKED" })]));
    renderWithProviders(<LoomAlarmStrip outputs={outputs()} />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByTestId("loom-alarm-strip")).toBeNull();
  });
});
