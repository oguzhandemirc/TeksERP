import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { DefaultSuperadminBanner } from "./DefaultSuperadminBanner";

/** Varsayılan süperadmin parolası bekliyorken kırmızı şerit; alan yoksa (eski backend) çizilmez. */
describe("DefaultSuperadminBanner", () => {
  beforeEach(() => useAuthStore.getState().setUser(null));

  it("varsayılan: çizilmez (oturum sıfırlaması bayrağı da sıfırlar)", () => {
    expect(useAuthStore.getState().defaultSuperadminPasswordPending).toBe(false);
    renderWithProviders(<DefaultSuperadminBanner />);
    expect(screen.queryByTestId("varsayilan-superadmin-bandi")).toBeNull();
  });

  it("bekliyor + yönetici: satıcıya yönlendiren metin", () => {
    useAuthStore.setState({ defaultSuperadminPasswordPending: true, isSystemAccount: false });
    renderWithProviders(<DefaultSuperadminBanner />);
    const bant = screen.getByTestId("varsayilan-superadmin-bandi");
    expect(bant.getAttribute("role")).toBe("alert");
    expect(bant.textContent).toContain("satıcınızdan");
  });

  it("bekliyor + hesabın kendisi: parola belirle metni", () => {
    useAuthStore.setState({ defaultSuperadminPasswordPending: true, isSystemAccount: true });
    renderWithProviders(<DefaultSuperadminBanner />);
    expect(screen.getByTestId("varsayilan-superadmin-bandi").textContent).toContain("kendi parolanızı");
  });
});
