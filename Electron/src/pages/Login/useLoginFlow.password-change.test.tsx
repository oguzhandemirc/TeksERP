import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * ZORUNLU PAROLA DEĞİŞİMİ — giriş akışının beşinci çıkışı (G20).
 *
 * Giriş 200 + `mustChangePassword: true` → token kalıcı depoya YAZILMAZ, kullanıcı
 * uygulamaya girmez; değişim adımı açılır. Değişim token AÇIKÇA verilerek yapılır,
 * başarıda sunucu bütün oturumları kapattığı için yeni parolayla yeniden giriş yapılır.
 */
const login = vi.fn();
const changePassword = vi.fn();
const logout = vi.fn(async () => undefined);
vi.mock("@/services/authService", () => ({
  authService: {
    login: (...a: unknown[]) => login(...a),
    changePassword: (...a: unknown[]) => changePassword(...a),
    logout: (...a: unknown[]) => logout(...(a as [])),
  },
}));
const tokenSet = vi.fn(async () => undefined);
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { get: vi.fn(async () => null), set: (...a: unknown[]) => tokenSet(...(a as [])), clear: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/server-identity", () => ({ pinServerIdentityAfterLogin: vi.fn(async () => undefined) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: (...a: unknown[]) => toastSuccess(...a), warning: vi.fn() } }));
const setUser = vi.fn();
vi.mock("@/store/auth", () => {
  const state = { user: null, setUser: (...a: unknown[]) => setUser(...a), refreshSystemAccount: vi.fn(async () => undefined) };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  hook.getState = () => state;
  return { useAuthStore: hook };
});

import { useLoginFlow } from "./useLoginFlow";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const values = { username: "yonetici", password: "kurulum-parolasi" };
const user = { userId: "u1", username: "yonetici", permissions: ["*"] };
const gecici = { data: { token: "gecici-token", user, mustChangePassword: true } };
const normal = { data: { token: "yeni-token", user, mustChangePassword: false } };
const hata = (status: number, code: string, message: string) => ({
  response: { status, data: { message, details: { code } } },
});

beforeEach(() => {
  login.mockReset();
  changePassword.mockReset();
  logout.mockClear();
  tokenSet.mockClear();
  setUser.mockClear();
  toastSuccess.mockClear();
});

describe("zorunlu parola değişimi — giriş akışı", () => {
  it("mustChangePassword=true: token depoya YAZILMAZ, kullanıcı girmez, değişim adımı açılır", async () => {
    login.mockResolvedValueOnce(gecici);
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(tokenSet).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(result.current.passwordChange.pending).toEqual({ token: "gecici-token", values, error: null });
  });

  it("değişim: doğru gövde + token AÇIKÇA gider, ardından YENİ parolayla normal giriş", async () => {
    login.mockResolvedValueOnce(gecici).mockResolvedValueOnce(normal);
    changePassword.mockResolvedValueOnce({ success: true, message: "ok" });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    await act(() => result.current.passwordChange.submit("yepyeni-parola-1"));

    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(changePassword.mock.calls[0]?.[0]).toEqual({
      currentPassword: "kurulum-parolasi",
      newPassword: "yepyeni-parola-1",
    });
    expect(changePassword.mock.calls[0]?.[1]).toBe("gecici-token");
    expect(toastSuccess).toHaveBeenCalledWith("Parolanız değiştirildi.");
    expect(login).toHaveBeenCalledTimes(2);
    expect(login.mock.calls[1]?.[0]).toMatchObject({ username: "yonetici", password: "yepyeni-parola-1" });
    // Depoya YALNIZ yeni girişin token'ı yazılır — geçici token hiçbir anda kalıcı olmaz.
    expect(tokenSet).toHaveBeenCalledTimes(1);
    expect(tokenSet).toHaveBeenCalledWith("yeni-token");
    expect(setUser).toHaveBeenCalledTimes(1);
    expect(result.current.passwordChange.pending).toBeNull();
  });

  it("sunucu reddederse (CURRENT_PASSWORD_INVALID) adımda KALIR, mesaj gösterilir, yeniden giriş yok", async () => {
    login.mockResolvedValueOnce(gecici);
    changePassword.mockRejectedValueOnce(hata(400, "CURRENT_PASSWORD_INVALID", "Mevcut parola yanlış."));
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    await act(() => result.current.passwordChange.submit("yepyeni-parola-1"));
    expect(result.current.passwordChange.pending?.error).toBe("Mevcut parola yanlış.");
    expect(login).toHaveBeenCalledTimes(1);
    expect(tokenSet).not.toHaveBeenCalled();
  });

  it("Vazgeç: geçici token'ın oturumu kapatılır (best-effort), adım kapanır", async () => {
    login.mockResolvedValueOnce(gecici);
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    act(() => result.current.passwordChange.cancel());
    expect(logout).toHaveBeenCalledWith("gecici-token");
    expect(result.current.passwordChange.pending).toBeNull();
    expect(tokenSet).not.toHaveBeenCalled();
  });

  it("mustChangePassword false/yok (eski backend): eski davranış — token yazılır, adım açılmaz", async () => {
    login.mockResolvedValueOnce(normal).mockResolvedValueOnce({ data: { token: "eski-token", user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    await act(() => result.current.performLogin(values, false));
    expect(tokenSet).toHaveBeenNthCalledWith(1, "yeni-token");
    expect(tokenSet).toHaveBeenNthCalledWith(2, "eski-token");
    expect(result.current.passwordChange.pending).toBeNull();
  });
});
