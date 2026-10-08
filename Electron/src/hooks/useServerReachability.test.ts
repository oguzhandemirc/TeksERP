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
import { applyApiBaseUrl, getActiveApiBaseUrl } from "@/lib/api-config";

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

  // ⭐ 2026-10-08 saha (panel 1.5.0): "Adresi Elle Gir" → test başarılı → Kaydet, ama giriş ekranı
  // eski adresin "Sunucuya ulaşılamadı" sonucunda kaldı — kayıt yeniden yoklamayı tetiklemiyordu.
  describe("adres değişince kendiliğinden yeniden yoklar", () => {
    const original = getActiveApiBaseUrl();
    afterEach(() => applyApiBaseUrl(original));

    it("⭐ yeni adres uygulanınca (kayıt) durum sıfırlanır ve yeni adres yoklanır", async () => {
      const probe = vi.fn(async (url: string) => (url === "https://deneme.etkiliyazilim.com" ? { baseUrl: url } : null));
      installBridge(probe as unknown as Probe);
      applyApiBaseUrl("http://10.0.0.99:4000");
      const { result } = renderHook(() => useServerReachability());
      await waitFor(() => expect(result.current.status).toBe("unreachable"));
      act(() => applyApiBaseUrl("https://deneme.etkiliyazilim.com"));
      await waitFor(() => expect(result.current.status).toBe("reachable"));
      expect(probe).toHaveBeenLastCalledWith("https://deneme.etkiliyazilim.com");
    });

    it("eski adresin geç gelen 'ulaşılamadı'sı yeni adresin sonucunu ezmez", async () => {
      let releaseOld: (v: null) => void = () => undefined;
      const probe = vi.fn((url: string) =>
        url === "http://10.0.0.99:4000" ? new Promise<null>((r) => (releaseOld = r)) : Promise.resolve({ baseUrl: url }),
      );
      installBridge(probe as unknown as Probe);
      applyApiBaseUrl("http://10.0.0.99:4000");
      const { result } = renderHook(() => useServerReachability());
      act(() => applyApiBaseUrl("https://deneme.etkiliyazilim.com"));
      await waitFor(() => expect(result.current.status).toBe("reachable"));
      await act(async () => releaseOld(null));
      expect(result.current.status).toBe("reachable");
    });
  });
});
