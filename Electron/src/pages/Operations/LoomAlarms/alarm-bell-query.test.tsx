// Alarm yoklaması zil akışının sağlığına bağlı (plan §3.11): sağlıklı SSE → 60 sn yedek + `alarm` olayıyla
// anında tazeleme; akış yok (bayrak kapalı / düşüş) → bugünkü 15 sn.
// Negatif sonda (2026-10-25, md5 ile geri alındı): aralık hep 60 sn → 3 ❌; `alarmDegisti` bayrağı
// silindi → zil-istemcisi "alarm zili" ❌; Alarmlar sekmesi gün gruplarına döndü → BildirimZili ❌.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const zil = vi.hoisted(() => {
  const dinleyici = new Set<() => void>();
  const olaylar = new Set<(o: string) => void>();
  const st = { enabled: false, kip: "kapali", bagli: false };
  return {
    st,
    olaylar,
    ayarla(y: Partial<typeof st>) {
      Object.assign(st, y);
      dinleyici.forEach((f) => f());
    },
    client: {
      durum: () => ({ ...st }),
      dinle: (f: () => void) => (dinleyici.add(f), () => void dinleyici.delete(f)),
      olayDinle: (f: (o: string) => void) => (olaylar.add(f), () => void olaylar.delete(f)),
    },
  };
});
const list = vi.hoisted(() => vi.fn(async () => ({ data: [], meta: {} })));
vi.mock("@/lib/bildirim/hooks", () => ({ bellClient: zil.client }));
vi.mock("./service", () => ({ loomAlarmService: { list } }));

import { LOOM_ALARM_BELL_POLL_HEALTHY_MS, LOOM_ALARM_BELL_POLL_MS, loomAlarmPollMs, useLoomAlarmBellQuery } from "./alarm-bell-query";

function sarmala() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const tik = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("alarm yoklaması · zil sağlığı", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    list.mockClear();
    zil.ayarla({ enabled: false, kip: "kapali", bagli: false });
  });
  afterEach(() => vi.useRealTimers());

  it("sabitler: sağlıksız 15 sn (bugünkü), sağlıklı 60 sn", () => {
    expect(LOOM_ALARM_BELL_POLL_MS).toBe(15_000);
    expect(LOOM_ALARM_BELL_POLL_HEALTHY_MS).toBe(60_000);
    expect(loomAlarmPollMs(false)).toBe(15_000);
    expect(loomAlarmPollMs(true)).toBe(60_000);
  });

  it("zil akışı yokken (bayrak kapalı) yoklama 15 sn — bugünkü davranış", async () => {
    renderHook(() => useLoomAlarmBellQuery(true), { wrapper: sarmala() });
    await tik(0);
    expect(list).toHaveBeenCalledTimes(1);
    await tik(15_000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("SSE sağlıklı → 60 sn; akış koparsa 15 sn'ye döner", async () => {
    zil.ayarla({ enabled: true, kip: "sse", bagli: true });
    renderHook(() => useLoomAlarmBellQuery(true), { wrapper: sarmala() });
    await tik(0);
    await tik(15_000);
    expect(list).toHaveBeenCalledTimes(1);
    await tik(45_000);
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => zil.ayarla({ bagli: false }));
    await tik(15_000);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("`alarm` olayı alarm sorgusunu ANINDA tazeler; `degisti` tazelemez", async () => {
    zil.ayarla({ enabled: true, kip: "sse", bagli: true });
    renderHook(() => useLoomAlarmBellQuery(true), { wrapper: sarmala() });
    await tik(0);
    await tik(6_000);
    await act(async () => zil.olaylar.forEach((f) => f("degisti")));
    await tik(0);
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => zil.olaylar.forEach((f) => f("alarm")));
    await tik(0);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
