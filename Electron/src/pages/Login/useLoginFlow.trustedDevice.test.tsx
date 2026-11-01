import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Barındırılan sunucu (Y1): masaüstü "bu cihazı hatırla" — belirteç gövdede döner, sunucu + kullanıcı
 * yuvasında saklanır, sonraki girişte gövdede gider; kod istenirse (belirteç geçmedi) yuva boşaltılır.
 */
const login = vi.fn();
const slots = new Map<string, string>();
vi.mock("@/services/authService", () => ({ authService: { login: (...a: unknown[]) => login(...a) } }));
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/api-config", () => ({ getActiveApiBaseUrl: () => "https://bulut.example" }));
vi.mock("@/lib/trusted-device-store", () => ({
  trustedDeviceStore: {
    get: vi.fn(async (k: string) => slots.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void slots.set(k, v)),
    clear: vi.fn(async (k: string) => void slots.delete(k)),
  },
}));
vi.mock("@/lib/server-identity", () => ({ pinServerIdentityAfterLogin: vi.fn(async () => undefined) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/store/auth", () => {
  const state = { setUser: vi.fn(), refreshSystemAccount: vi.fn(async () => undefined) };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  hook.getState = () => state;
  return { useAuthStore: hook };
});

import { useLoginFlow } from "./useLoginFlow";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const values = { username: "Ayse", password: "parola-1" };
const SLOT = "https://bulut.example\nayse";
const user = { userId: "u1", username: "ayse", permissions: ["*"] };
const hata = (status: number, code: string, days?: number) => ({
  response: { status, data: { details: { code, ...(days ? { trustDeviceDays: days } : {}) } } },
});
const sent = (i: number) => login.mock.calls[i]?.[0] as Record<string, unknown>;

beforeEach(() => {
  login.mockReset();
  slots.clear();
});

describe("masaüstü güvenilir cihaz (barındırılan sunucu)", () => {
  it("kod + hatırla → gövdedeki belirteç sunucu+kullanıcı yuvasına yazılır; sonraki giriş onu gönderir", async () => {
    login
      .mockRejectedValueOnce(hata(409, "TOTP_REQUIRED", 30))
      .mockResolvedValueOnce({ data: { token: "jwt", user, trustedDeviceToken: "cihaz-belirteci", deviceRemembered: true } })
      .mockResolvedValueOnce({ data: { token: "jwt", user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(result.current.totp?.trustDeviceDays).toBe(30);
    expect(sent(0).trustedDeviceToken).toBeUndefined();
    await act(() => result.current.performLogin(values, false, "123456", true));
    expect(sent(1)).toMatchObject({ totpCode: "123456", rememberDevice: true });
    expect(slots.get(SLOT)).toBe("cihaz-belirteci");
    await act(() => result.current.performLogin(values, false));
    expect(sent(2).trustedDeviceToken).toBe("cihaz-belirteci");
  });

  it("başka kullanıcının girişine belirteç gitmez", async () => {
    slots.set(SLOT, "cihaz-belirteci");
    login.mockResolvedValueOnce({ data: { token: "jwt", user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin({ username: "mehmet", password: "p" }, false));
    expect(sent(0).trustedDeviceToken).toBeUndefined();
    expect(slots.get(SLOT)).toBe("cihaz-belirteci");
  });

  it("belirteç geçmezse (409 TOTP_REQUIRED) yuva boşaltılır, kod adımı açılır", async () => {
    slots.set(SLOT, "eski");
    login.mockRejectedValueOnce(hata(409, "TOTP_REQUIRED", 30));
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(sent(0).trustedDeviceToken).toBe("eski");
    expect(slots.has(SLOT)).toBe(false);
    expect(result.current.totp).not.toBeNull();
  });
});
