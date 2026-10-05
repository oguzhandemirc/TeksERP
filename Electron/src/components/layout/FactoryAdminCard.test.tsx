import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { AxiosError } from "axios";
import { useAuthStore } from "@/store/auth";

/**
 * K4 — "Fabrika yöneticisini aç" kartı + destek rozeti (kullanıcı kararları 2026-10-05):
 * kart yalnız destek hesabında ve sunucu "yönetici yok" derken; uyarır, engellemez;
 * geçici parola yalnız oluşturma cevabından, bir kez; pencere kapanınca /auth/me tazelenir.
 */
const api = vi.hoisted(() => ({ createFactoryAdmin: vi.fn() }));
vi.mock("@/services/adminUserService", () => ({ adminUserService: api }));

import { FactoryAdminCard, shouldShowFactoryAdminCard } from "./FactoryAdminCard";
import { SupportSessionBadge } from "./SupportSessionBadge";

const refresh = vi.fn(async () => undefined);
function hesap(isSystemAccount: boolean, factoryAdminExists: boolean) {
  useAuthStore.setState({ isSystemAccount, factoryAdminExists, refreshSystemAccount: refresh });
}

beforeEach(() => {
  api.createFactoryAdmin.mockReset();
  refresh.mockClear();
});

describe("shouldShowFactoryAdminCard", () => {
  it("yalnız destek hesabı + yönetici yok → görünür", () => {
    expect(shouldShowFactoryAdminCard({ isSystemAccount: true, factoryAdminExists: false })).toBe(true);
    expect(shouldShowFactoryAdminCard({ isSystemAccount: true, factoryAdminExists: true })).toBe(false);
    expect(shouldShowFactoryAdminCard({ isSystemAccount: false, factoryAdminExists: false })).toBe(false);
  });

  it("store varsayılanı (alanı bilmeyen eski backend) kartı ÇİZMEZ", () => {
    useAuthStore.getState().setUser(null);
    expect(useAuthStore.getState().factoryAdminExists).toBe(true);
  });
});

describe("FactoryAdminCard", () => {
  it("fabrika hesabında ya da yönetici varken hiçbir şey çizilmez", () => {
    hesap(false, false);
    const a = renderWithProviders(<FactoryAdminCard />);
    expect(screen.queryByTestId("fabrika-yoneticisi-karti")).toBeNull();
    a.unmount();
    hesap(true, true);
    renderWithProviders(<FactoryAdminCard />);
    expect(screen.queryByTestId("fabrika-yoneticisi-karti")).toBeNull();
  });

  it("açma akışı: parola bir kez gösterilir, kapanınca /auth/me tazelenir ve parola bellekten atılır", async () => {
    hesap(true, false);
    api.createFactoryAdmin.mockResolvedValue({
      user: { id: "u1", username: "mehmet", fullName: "Mehmet Yılmaz" },
      temporaryPassword: "Gecici7Parola9x",
    });
    renderWithProviders(<FactoryAdminCard />);
    fireEvent.click(screen.getByRole("button", { name: "Fabrika yöneticisini aç" }));
    fireEvent.change(screen.getByLabelText(/Kullanıcı Adı/), { target: { value: "mehmet" } });
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), { target: { value: "Mehmet Yılmaz" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı aç" }));
    expect((await screen.findByTestId("gecici-parola")).textContent).toBe("Gecici7Parola9x");
    expect(api.createFactoryAdmin).toHaveBeenCalledWith({ username: "mehmet", fullName: "Mehmet Yılmaz" });
    // Gövde parola/yetki TAŞIMAZ — ikisini de sunucu belirler.
    expect(Object.keys(api.createFactoryAdmin.mock.calls[0]![0] as object).sort()).toEqual([
      "fullName",
      "username",
    ]);
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Kapat" })[0]!);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Gecici7Parola9x")).toBeNull();
  });

  // Uç clientToken taşımaz (beyanlı istisna, token-replay-beyan TOKENSIZ_UCLAR): kaybolan 201'in yerine geçen
  // replay yok — ikinci deneme 409 alır ve panel parolayı "Şifre Sıfırla"dan yeniden verdirmeye yönlendirir.
  it("409 FACTORY_ADMIN_EXISTS → 'zaten açılmış' + Şifre Sıfırla yönlendirmesi, yeniden deneme düğmesi yok", async () => {
    hesap(true, false);
    api.createFactoryAdmin.mockRejectedValue(
      new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 409,
        data: { success: false, message: "Fabrika yöneticisi zaten açılmış.", details: { code: "FACTORY_ADMIN_EXISTS" } },
      } as never),
    );
    renderWithProviders(<FactoryAdminCard />);
    fireEvent.click(screen.getByRole("button", { name: "Fabrika yöneticisini aç" }));
    fireEvent.change(screen.getByLabelText(/Kullanıcı Adı/), { target: { value: "mehmet" } });
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), { target: { value: "Mehmet Yılmaz" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı aç" }));
    expect(await screen.findByText("Fabrika yöneticisi zaten açılmış")).toBeTruthy();
    expect(screen.getByText(/Şifre Sıfırla/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kullanıcılar ekranına git" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hesabı aç" })).toBeNull();
  });

  it("ağ hatası → 'Sonuç belirsiz' (ikinci hesap açılmaz, parola Şifre Sıfırla'dan)", async () => {
    hesap(true, false);
    api.createFactoryAdmin.mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    renderWithProviders(<FactoryAdminCard />);
    fireEvent.click(screen.getByRole("button", { name: "Fabrika yöneticisini aç" }));
    fireEvent.change(screen.getByLabelText(/Kullanıcı Adı/), { target: { value: "mehmet" } });
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), { target: { value: "Mehmet Yılmaz" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı aç" }));
    expect(await screen.findByText("Sonuç belirsiz")).toBeTruthy();
    expect(screen.queryByText("Fabrika yöneticisi zaten açılmış")).toBeNull();
    expect(screen.getByRole("button", { name: "Hesabı aç" })).toBeTruthy();
  });

  it("geçersiz kullanıcı adı sunucuya gitmez", () => {
    hesap(true, false);
    renderWithProviders(<FactoryAdminCard />);
    fireEvent.click(screen.getByRole("button", { name: "Fabrika yöneticisini aç" }));
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), { target: { value: "Ali" } });
    fireEvent.click(screen.getByRole("button", { name: "Hesabı aç" }));
    expect(api.createFactoryAdmin).not.toHaveBeenCalled();
  });
});

describe("SupportSessionBadge", () => {
  it("destek hesabında 'Destek hesabıyla girdiniz', fabrika hesabında hiçbir şey", () => {
    hesap(true, true);
    const a = renderWithProviders(<SupportSessionBadge />);
    expect(screen.getByTestId("destek-hesabi-rozeti").textContent).toBe("Destek hesabıyla girdiniz");
    a.unmount();
    hesap(false, true);
    renderWithProviders(<SupportSessionBadge />);
    expect(screen.queryByTestId("destek-hesabi-rozeti")).toBeNull();
  });
});
