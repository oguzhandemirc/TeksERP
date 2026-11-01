import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";

/**
 * GİRİŞTE SON KULLANICI (ayar `auth.rememberLastUser`, kullanıcı isteği 2026-11-01).
 *
 * ⭐ Kayıt yalnız iki ad alanı taşır (parola/token yok); sistem hesabı ASLA yazılmaz ve mevcut
 * kaydı değiştirmez; ayar kapalıyken giriş kaydı siler; kayıt sunucu başına.
 * ⭐ Hatırlanan görünüm yalnız parola alanını çizer; "Başka hesapla giriş yap" normal forma
 * döner; "Bu hesabı unut" kaydı siler.
 * jsdom'da `window.api` yok → depo webStore (localStorage) yoludur.
 * SONDA (2026-11-01): `syncRememberedLogin`deki `isSystemAccount !== false` kapısı kaldırılınca
 * "sistem hesabı yazılmaz" (2) + "eski backend" testleri KIRMIZI — 3 başarısız (geri alındı, md5 eşit).
 */
const getMe = vi.fn();
const getFlags = vi.fn();
let activeUrl = "https://fabrika-a.local:4443";
vi.mock("@/services/authService", () => ({ authService: { getMe: () => getMe() } }));
vi.mock("@/services/featureFlagService", () => ({ featureFlagService: { get: () => getFlags() } }));
vi.mock("@/lib/api-config", () => ({
  getActiveApiBaseUrl: () => activeUrl,
  onApiBaseUrlApplied: () => () => undefined,
}));

import { syncRememberedLoginAfterLogin } from "./syncRememberedLogin";
import { readRememberedLogin, REMEMBERED_LOGIN_STORE_KEY, writeRememberedLogin } from "@/lib/remembered-login";
import { useRememberedLogin } from "./useRememberedLogin";
import { RememberedLoginForm } from "./RememberedLoginForm";
import { LoginForm, type LoginFormValues } from "./LoginForm";

const RAW_KEY = `secure.${REMEMBERED_LOGIN_STORE_KEY}`;
const me = (over: Record<string, unknown> = {}) => ({
  data: { userId: "u1", username: "ayse", fullName: "Ayşe Yılmaz", permissions: ["*"], isSystemAccount: false, ...over },
});
const flags = (on: boolean) => ({ data: { rememberLastUser: on } });

beforeEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  window.localStorage.clear();
  getMe.mockReset();
  getFlags.mockReset();
  activeUrl = "https://fabrika-a.local:4443";
});

describe("girişten sonra kayıt senkronu", () => {
  it("⭐ ayar açık + normal kullanıcı → yalnız kullanıcı adı ve görünen ad yazılır", async () => {
    getMe.mockResolvedValue(me({ token: "jwt-xyz", password: "gizli" }));
    getFlags.mockResolvedValue(flags(true));
    expect(await syncRememberedLoginAfterLogin("ayse")).toBe("saved");
    const raw = window.localStorage.getItem(RAW_KEY) ?? "";
    const entry = (JSON.parse(raw) as Record<string, Record<string, unknown>>)[activeUrl];
    expect(entry).toEqual({ username: "ayse", displayName: "Ayşe Yılmaz" });
    expect(raw).not.toMatch(/jwt-xyz|gizli|password|token|permissions|u1/);
  });

  it("⭐ sistem hesabı girişi → kayıt yazılmaz, mevcut kayıt DEĞİŞMEZ", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: "Ayşe Yılmaz" });
    const before = window.localStorage.getItem(RAW_KEY);
    getMe.mockResolvedValue(me({ username: "superadmin", fullName: "Sistem", isSystemAccount: true }));
    getFlags.mockResolvedValue(flags(true));
    expect(await syncRememberedLoginAfterLogin("superadmin")).toBe("skipped");
    expect(window.localStorage.getItem(RAW_KEY)).toBe(before);
    expect(window.localStorage.getItem(RAW_KEY)).not.toContain("superadmin");
  });

  it("sistem hesabı + kayıt yok → hiçbir şey yazılmaz", async () => {
    getMe.mockResolvedValue(me({ username: "superadmin", isSystemAccount: true }));
    getFlags.mockResolvedValue(flags(true));
    await syncRememberedLoginAfterLogin("superadmin");
    expect(window.localStorage.getItem(RAW_KEY)).toBeNull();
  });

  it("isSystemAccount taşımayan eski backend → fail-closed, yazılmaz", async () => {
    getMe.mockResolvedValue(me({ isSystemAccount: undefined }));
    getFlags.mockResolvedValue(flags(true));
    expect(await syncRememberedLoginAfterLogin("ayse")).toBe("skipped");
    expect(window.localStorage.getItem(RAW_KEY)).toBeNull();
  });

  it("⭐ ayar kapalı → kayıt silinir", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: null });
    getMe.mockResolvedValue(me());
    getFlags.mockResolvedValue(flags(false));
    expect(await syncRememberedLoginAfterLogin("ayse")).toBe("cleared");
    expect(await readRememberedLogin()).toBeNull();
  });

  it("/auth/me ya da bayrak okunamazsa dokunulmaz", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: null });
    getMe.mockRejectedValue(new Error("ağ"));
    expect(await syncRememberedLoginAfterLogin("ayse")).toBe("skipped");
    getMe.mockResolvedValue(me());
    getFlags.mockRejectedValue(new Error("ağ"));
    expect(await syncRememberedLoginAfterLogin("ayse")).toBe("skipped");
    expect(await readRememberedLogin()).toEqual({ username: "ayse", displayName: null });
  });

  it("kayıt sunucu başına: başka sunucunun kullanıcısı görünmez", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: null });
    activeUrl = "https://fabrika-b.local:4443";
    expect(await readRememberedLogin()).toBeNull();
    await writeRememberedLogin({ username: "mehmet", displayName: null });
    activeUrl = "https://fabrika-a.local:4443";
    expect(await readRememberedLogin()).toEqual({ username: "ayse", displayName: null });
  });

  it("bozuk kayıt 'yok' sayılır", async () => {
    window.localStorage.setItem(RAW_KEY, "{bozuk");
    expect(await readRememberedLogin()).toBeNull();
  });
});

/** LoginPage'in son dalının aynası: hook + iki görünüm. */
function Harness({ onSubmit }: { onSubmit: (v: LoginFormValues) => void }) {
  const form = useForm<LoginFormValues>({ defaultValues: { username: "", password: "" } });
  const r = useRememberedLogin(form);
  return r.remembered ? (
    <RememberedLoginForm
      account={r.remembered}
      form={form}
      submitting={false}
      onSubmit={onSubmit}
      onSwitchAccount={r.switchAccount}
      onForget={() => void r.forget()}
    />
  ) : (
    <LoginForm form={form} submitting={false} onSubmit={onSubmit} />
  );
}

describe("hatırlanan hesap görünümü", () => {
  it("kayıt yok → normal form (kullanıcı adı + parola)", async () => {
    render(<Harness onSubmit={vi.fn()} />);
    await act(async () => undefined);
    expect(screen.getByLabelText(/Kullanıcı adı/)).toBeTruthy();
    expect(screen.queryByTestId("remembered-login")).toBeNull();
  });

  it("⭐ yalnız parola alanı çizilir; gönderim hatırlanan kullanıcı adıyla gider", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: "Ayşe Yılmaz" });
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await screen.findByTestId("remembered-login");
    expect(screen.getByText("Ayşe Yılmaz")).toBeTruthy();
    expect(screen.queryByLabelText(/Kullanıcı adı/)).toBeNull();
    expect(screen.getAllByLabelText(/Şifre/)).toHaveLength(1);
    expect(document.activeElement?.id).toBe("password");
    fireEvent.change(screen.getByLabelText(/Şifre/), { target: { value: "parola-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Giriş Yap" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ username: "ayse", password: "parola-1" });
  });

  it("⭐ 'Başka hesapla giriş yap' normal forma döner (boş kullanıcı adı), kayıt kalır", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: null });
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Başka hesapla giriş yap" }));
    const user = screen.getByLabelText(/Kullanıcı adı/) as HTMLInputElement;
    expect(user.value).toBe("");
    expect(await readRememberedLogin()).toEqual({ username: "ayse", displayName: null });
  });

  it("⭐ 'Bu hesabı unut' kaydı siler ve normal forma döner", async () => {
    await writeRememberedLogin({ username: "ayse", displayName: null });
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Bu hesabı unut" }));
    await screen.findByLabelText(/Kullanıcı adı/);
    expect(await readRememberedLogin()).toBeNull();
    expect(window.localStorage.getItem(RAW_KEY)).toBeNull();
  });
});
