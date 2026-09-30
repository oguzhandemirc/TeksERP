import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * İSTEĞE BAĞLI 2FA — panel giriş akışı (kullanıcı kararı 2026-09-30).
 *
 * Sunucu yalnız hesabında 2FA açık kullanıcının parolalı girişinde `409 TOTP_REQUIRED`
 * döner. Panel önce KODSUZ dener; kod adımını yalnız bu cevapla açar ve kodu aynı
 * uca `totpCode` alanıyla geri gönderir. 2FA'sı kapalı hesap kod adımını hiç görmez.
 */
const login = vi.fn();
vi.mock("@/services/authService", () => ({
  authService: { login: (...a: unknown[]) => login(...a) },
}));
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { set: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) },
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
const values = { username: "ayse", password: "parola-1" };
const ok = { data: { token: "yok", user: { userId: "u1", username: "ayse", permissions: ["*"] } } };
const hata = (status: number, code: string) => ({ response: { status, data: { details: { code } } } });

beforeEach(() => login.mockReset());

describe("isteğe bağlı 2FA — giriş akışı", () => {
  it("2FA'sı kapalı hesap: tek deneme, kod adımı AÇILMAZ, gövdede kod yok", async () => {
    login.mockResolvedValueOnce(ok);
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0]?.[0]).toMatchObject(values);
    expect((login.mock.calls[0]?.[0] as { totpCode?: string } | undefined)?.totpCode).toBeUndefined();
    expect(result.current.totp).toBeNull();
  });

  it("2FA'sı açık hesap: 409 TOTP_REQUIRED kod adımını açar, kod `totpCode` ile gider", async () => {
    login.mockRejectedValueOnce(hata(409, "TOTP_REQUIRED")).mockResolvedValueOnce(ok);
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(result.current.totp).toEqual({ values, invalid: false });

    await act(() => result.current.performLogin(values, false, "123456"));
    expect(login).toHaveBeenCalledTimes(2);
    expect(login.mock.calls[1]?.[0]).toMatchObject({ ...values, totpCode: "123456" });
    expect(result.current.totp).toBeNull();
  });

  it("yanlış kod (401 TOTP_INVALID) adımda KALIR ve alanı kırmızıya çeker", async () => {
    login.mockRejectedValueOnce(hata(401, "TOTP_INVALID"));
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false, "000000"));
    expect(result.current.totp).toEqual({ values, invalid: true });
  });

  it("409 SESSION_EXISTS kod adımı sanılmaz (oturum çakışması ayrı ekran)", async () => {
    login.mockRejectedValueOnce({
      response: { status: 409, data: { details: { code: "SESSION_EXISTS", existingSession: { deviceType: "ELECTRON" } } } },
    });
    const { result } = renderHook(() => useLoginFlow(), { wrapper });
    await act(() => result.current.performLogin(values, false));
    expect(result.current.totp).toBeNull();
    expect(result.current.conflict).not.toBeNull();
  });
});
