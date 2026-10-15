import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InternalAxiosRequestConfig } from "axios";

/**
 * ⭐ İSTEK BAŞLIKLARI — iki hedef, iki kimlik kanalı (sözleşme `docs/design/BULUT-WEB-PANELI.md`).
 *   • Web: kimlik httpOnly çerezde → Authorization YOK; GET/HEAD/OPTIONS dışında `X-TeksERP-CSRF: 1`.
 *   • Electron: `Authorization: Bearer` bayt-bayt aynı; CSRF başlığı GİTMEZ.
 * Gerçek interceptor zinciri koşar; yalnız ağ katmanı (adapter) yakalanır.
 */
const tok = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { get: async () => tok.value, set: vi.fn(), clear: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/client-info", () => ({ applyClientInfoHeaders: async () => undefined }));

async function sent(electron: boolean, method: string): Promise<Record<string, unknown>> {
  vi.resetModules();
  vi.doMock("@/lib/runtime-env", () => ({ IS_ELECTRON: electron }));
  const { default: apiClient } = await import("./apiClient");
  let captured: InternalAxiosRequestConfig | null = null;
  apiClient.defaults.adapter = async (config) => {
    captured = config;
    return { data: {}, status: 200, statusText: "OK", headers: {}, config };
  };
  await apiClient.request({ url: "/api/x", method });
  return { ...(captured as InternalAxiosRequestConfig | null)?.headers };
}

beforeEach(() => {
  tok.value = null;
});

describe("web hedefi (çerez oturumu)", () => {
  it("⭐ Authorization YOK; POST'ta CSRF başlığı VAR", async () => {
    const h = await sent(false, "post");
    expect(h.Authorization).toBeUndefined();
    expect(h["X-TeksERP-CSRF"]).toBe("1");
  });

  it("PUT/PATCH/DELETE de CSRF taşır", async () => {
    for (const m of ["put", "patch", "delete"]) expect((await sent(false, m))["X-TeksERP-CSRF"]).toBe("1");
  });

  it("GET/HEAD/OPTIONS CSRF taşımaz (sözleşme: yalnız durum değiştiren yöntemler)", async () => {
    for (const m of ["get", "head", "options"]) expect((await sent(false, m))["X-TeksERP-CSRF"]).toBeUndefined();
  });
});

describe("Electron hedefi (Bearer)", () => {
  it("⭐ Bearer VAR, CSRF YOK", async () => {
    tok.value = "tok-A";
    const h = await sent(true, "post");
    expect(h.Authorization).toBe("Bearer tok-A");
    expect(h["X-TeksERP-CSRF"]).toBeUndefined();
  });
});
