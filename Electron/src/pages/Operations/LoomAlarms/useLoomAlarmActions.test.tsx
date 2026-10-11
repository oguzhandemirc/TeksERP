// `clientToken` MANTIKSAL DENEME başına bir kez: belirsiz hatada (ağ · 5xx) aynı token yeniden
// gider; kesin 4xx'te ve başarıda yeni deneme yeni token alır; farklı eylem farklı denemedir.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const ack = vi.fn<(id: string, token: string) => Promise<unknown>>();
const snooze = vi.fn<(id: string, m: number, token: string) => Promise<unknown>>();
vi.mock("./service", () => ({
  loomAlarmService: {
    ack: (id: string, t: string) => ack(id, t),
    snooze: (id: string, m: number, t: string) => snooze(id, m, t),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useLoomAlarmActions } from "./useLoomAlarmActions";

const ok = { success: true, data: {}, message: "Alarm üstlenildi" };
const network = { message: "Network Error" };
const http = (status: number) => ({ response: { status, data: { message: "x", details: { code: "LOOM_ALARM_ALREADY_ACKED" } } } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useLoomAlarmActions("alarm-1"), { wrapper });
}

const tokenOf = (fn: { mock: { calls: unknown[][] } }, i: number, pos = 1) => fn.mock.calls[i]?.[pos] as string;

describe("useLoomAlarmActions — deneme token'ı", () => {
  beforeEach(() => {
    ack.mockReset();
    snooze.mockReset();
  });

  it("⭐ belirsiz hata (ağ) → yeniden denemede AYNI token", async () => {
    ack.mockRejectedValueOnce(network).mockResolvedValueOnce(ok);
    const { result } = setup();
    await act(() => result.current.ack());
    await act(() => result.current.ack());
    expect(tokenOf(ack, 0)).toMatch(/^[0-9a-f-]{36}$/);
    expect(tokenOf(ack, 1)).toBe(tokenOf(ack, 0));
  });

  it("⭐ 5xx de belirsizdir → AYNI token", async () => {
    ack.mockRejectedValueOnce(http(503)).mockResolvedValueOnce(ok);
    const { result } = setup();
    await act(() => result.current.ack());
    await act(() => result.current.ack());
    expect(tokenOf(ack, 1)).toBe(tokenOf(ack, 0));
  });

  it("⭐ kesin 4xx (409) → sonraki gönderim YENİ token", async () => {
    ack.mockRejectedValueOnce(http(409)).mockResolvedValueOnce(ok);
    const { result } = setup();
    await act(() => result.current.ack());
    await act(() => result.current.ack());
    expect(tokenOf(ack, 1)).not.toBe(tokenOf(ack, 0));
  });

  it("başarıdan sonra yeni deneme yeni token", async () => {
    ack.mockResolvedValue(ok);
    const { result } = setup();
    await act(() => result.current.ack());
    await act(() => result.current.ack());
    expect(tokenOf(ack, 1)).not.toBe(tokenOf(ack, 0));
  });

  it("farklı süreyle susturmak ayrı denemedir (aynı token taşımaz)", async () => {
    snooze.mockRejectedValue(network);
    const { result } = setup();
    await act(() => result.current.snooze(15));
    await act(() => result.current.snooze(30));
    await act(() => result.current.snooze(15));
    expect(tokenOf(snooze, 1, 2)).not.toBe(tokenOf(snooze, 0, 2));
    expect(tokenOf(snooze, 2, 2)).toBe(tokenOf(snooze, 0, 2));
  });

  it("hata yutulur (toast hook'ta) → çağıran `undefined` alır; başarıda sonuç", async () => {
    ack.mockRejectedValueOnce(http(409)).mockResolvedValueOnce(ok);
    const { result } = setup();
    let r1: unknown = "x";
    let r2: unknown;
    await act(async () => { r1 = await result.current.ack(); });
    await act(async () => { r2 = await result.current.ack(); });
    expect(r1).toBeUndefined();
    expect(r2).toEqual(ok);
  });
});
