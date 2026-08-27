// =============================================================================
// Bekçi: giriş öncesi erişilebilirlik yoklaması — FAIL-OPEN yönü
// =============================================================================
// NEDEN: bu hook `LoginPage`te giriş formunun ÇİZİLİP ÇİZİLMEYECEĞİNE karar
// veriyor. Yanlış yöne düşerse sonuç orantısız: "unreachable" hatası, ÇALIŞAN
// bir kurulumda giriş formunu tamamen gizler ve fabrika içeri giremez.
//
// Bu yüzden belirsizliğin her türü "reachable"a düşmek ZORUNDA:
//   • IPC köprüsü yoksa (tarayıcı derlemesi, birim testi) → reachable
//   • köprü hata fırlatırsa → reachable (köprü hatası sunucunun yokluğu DEĞİLDİR)
// Yalnız probun AÇIKÇA null dönmesi "unreachable"dır.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useServerReachability } from "./useServerReachability";

type Probe = () => Promise<unknown>;

function installBridge(probe: Probe | null): void {
  (window as unknown as { api?: unknown }).api = probe
    ? { discovery: { probe, state: vi.fn(), start: vi.fn(), pin: vi.fn() } }
    : undefined;
}

describe("useServerReachability", () => {
  beforeEach(() => {
    (window as unknown as { api?: unknown }).api = undefined;
  });
  afterEach(() => {
    (window as unknown as { api?: unknown }).api = undefined;
  });

  it("prob aday döndürürse reachable", async () => {
    installBridge(async () => ({ baseUrl: "http://x:4000", identity: null }));
    const { result } = renderHook(() => useServerReachability());
    await waitFor(() => expect(result.current.status).toBe("reachable"));
  });

  it("prob null dönerse unreachable (tek meşru unreachable yolu)", async () => {
    installBridge(async () => null);
    const { result } = renderHook(() => useServerReachability());
    await waitFor(() => expect(result.current.status).toBe("unreachable"));
  });

  it("⭐ IPC köprüsü YOKSA reachable — form gizlenmez", async () => {
    installBridge(null);
    const { result } = renderHook(() => useServerReachability());
    await waitFor(() => expect(result.current.status).toBe("reachable"));
  });

  it("⭐ köprü HATA fırlatırsa reachable — köprü hatası sunucu yokluğu değildir", async () => {
    installBridge(async () => {
      throw new Error("IPC koptu");
    });
    const { result } = renderHook(() => useServerReachability());
    await waitFor(() => expect(result.current.status).toBe("reachable"));
  });

  it("recheck durumu yeniden ölçer (aday bulunca forma dönülebilsin)", async () => {
    let alive = false;
    installBridge(async () => (alive ? { baseUrl: "http://x:4000" } : null));
    const { result } = renderHook(() => useServerReachability());
    await waitFor(() => expect(result.current.status).toBe("unreachable"));
    alive = true;
    await act(async () => {
      await result.current.recheck();
    });
    await waitFor(() => expect(result.current.status).toBe("reachable"));
  });
});
