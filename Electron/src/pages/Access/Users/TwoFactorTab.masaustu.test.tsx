// @vitest-environment-options {"url":"file:///Applications/TeksERP.app/index.html"}
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";

/**
 * 2FA kurulumu MASAÜSTÜNDE — konum `file://`, web paneli yayınlanmaz.
 * Göreli `/#/2fa-kurulum?token=…` bağlantısı hiçbir yerde açılmaz; gösterilmemeli.
 * Çalışan yol: kurulum sayfası uygulama içinde token'la açılır. Başka kullanıcı
 * için açılırsa yöneticinin oturumu ÖNCE kapanır (ekran o kullanıcıya bırakılır).
 */
vi.mock("@/services/adminUserService", () => ({
  adminUserService: {
    getTotpStatus: vi.fn(async () => ({
      success: true,
      data: { enabled: false, enabledAt: null, remainingRecoveryCodes: 0 },
    })),
    openTotpWindow: vi.fn(async () => ({
      success: true,
      data: { token: "tok-1", expiresAt: "2026-10-10T09:15:00.000Z" },
    })),
    resetTotp: vi.fn(),
  },
}));

import { TwoFactorTab } from "./TwoFactorTab";

const hashAtLogout: string[] = [];
const logout = vi.fn(async () => {
  hashAtLogout.push(window.location.hash);
  useAuthStore.setState({ user: null });
});

function oturum(userId: string) {
  useAuthStore.setState({
    user: { userId, username: "yonetici", permissions: ["admin:users"] },
    logout,
  });
}

async function kurulumuBaslat() {
  fireEvent.click(await screen.findByRole("button", { name: /Kurulumu başlat/ }));
  return screen.findByRole("button", { name: /Bu bilgisayarda kurulumu aç/ });
}

describe("TwoFactorTab — masaüstü (file://)", () => {
  beforeEach(() => {
    window.location.hash = "";
    logout.mockClear();
    hashAtLogout.length = 0;
  });

  it("konum file:// — kullanılamaz göreli bağlantı ve Kopyala YOK, uygulama içi yol VAR", async () => {
    expect(window.location.protocol).toBe("file:");
    oturum("admin-1");
    renderWithProviders(<TwoFactorTab userId="u1" username="ayse" />);
    await kurulumuBaslat();
    expect(screen.queryByText(/2fa-kurulum/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Kopyala/ })).toBeNull();
  });

  it("kendi hesabı: oturum korunur, kurulum sayfası doğrudan açılır", async () => {
    oturum("u1");
    renderWithProviders(<TwoFactorTab userId="u1" username="yonetici" />);
    fireEvent.click(await kurulumuBaslat());
    expect(window.location.hash).toBe("#/2fa-kurulum?token=tok-1");
    expect(logout).not.toHaveBeenCalled();
  });

  it("başka kullanıcı: onaysız açılmaz; onayla ÖNCE oturum kapanır, SONRA kurulum açılır", async () => {
    oturum("admin-1");
    renderWithProviders(<TwoFactorTab userId="u1" username="ayse" />);
    fireEvent.click(await kurulumuBaslat());
    expect(window.location.hash).toBe("");
    expect(logout).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Oturumu kapat ve aç/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/2fa-kurulum?token=tok-1"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(hashAtLogout).toEqual([""]);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
