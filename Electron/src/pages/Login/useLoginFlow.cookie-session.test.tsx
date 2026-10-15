import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * BULUT WEB PANELİ — çerez oturumu (sözleşme `docs/design/BULUT-WEB-PANELI.md`).
 *
 * ⭐ Panel kipinde giriş cevabı `token` TAŞIMAZ, `cookieSession: true` taşır: istemci token
 * beklemez, depoya hiçbir şey yazmaz, kullanıcıyı cevaptaki `user`dan kurar.
 * ⭐ Token gelirse (Electron ya da panel kipi kapalı backend) eski yol aynen: token depoya.
 */
const login = vi.fn();
const logout = vi.fn(async () => undefined);
vi.mock("@/services/authService", () => ({
  authService: { login: (...a: unknown[]) => login(...a), logout: (...a: unknown[]) => logout(...(a as [])) },
}));
const tokenSet = vi.fn<(t: string) => Promise<void>>(async () => undefined);
const tokenClear = vi.fn(async () => undefined);
vi.mock("@/lib/secure-token", () => ({ tokenStore: { set: (t: string) => tokenSet(t), clear: () => tokenClear() } }));
vi.mock("@/lib/server-identity", () => ({ pinServerIdentityAfterLogin: vi.fn(async () => undefined) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
const setUser = vi.fn();
vi.mock("@/store/auth", () => {
  const state = { setUser: (u: unknown) => setUser(u), refreshSystemAccount: vi.fn(async () => undefined) };
  const hook = (sel: (s: typeof state) => unknown) => sel(state);
  hook.getState = () => state;
  return { useAuthStore: hook };
});

import { useLoginFlow } from "./useLoginFlow";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const values = { username: "ayse", password: "parola-1" };
const user = { userId: "u1", username: "ayse", permissions: ["*"] };

beforeEach(() => {
  login.mockReset();
  logout.mockClear();
  tokenSet.mockClear();
  tokenClear.mockClear();
  setUser.mockClear();
  toastError.mockClear();
});

describe("çerez oturumu — giriş akışı", () => {
  it("⭐ cookieSession:true → token depoya YAZILMAZ, kullanıcı cevaptaki user'dan kurulur", async () => {
    login.mockResolvedValueOnce({ data: { cookieSession: true, user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(tokenSet).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(user);
  });

  it("cookieSession + masaüstü izni yok → oturum SUNUCUDA kapatılır (çerez silinsin), yerel token yolu koşmaz", async () => {
    login.mockResolvedValueOnce({ data: { cookieSession: true, user: { ...user, permissions: [] } } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(setUser).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(tokenClear).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("cookieSession + mustChangePassword → parola adımı token'sız (null) açılır", async () => {
    login.mockResolvedValueOnce({ data: { cookieSession: true, mustChangePassword: true, user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(result.current.passwordChange.pending).toMatchObject({ token: null, values });
    expect(tokenSet).not.toHaveBeenCalled();
  });

  it("token gelirse (Electron / panel kipi kapalı backend) eski yol: token depoya", async () => {
    login.mockResolvedValueOnce({ data: { token: "tok-1", user } });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(tokenSet).toHaveBeenCalledWith("tok-1");
    expect(setUser).toHaveBeenCalled();
  });
});
