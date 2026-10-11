import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { SEAL_COMMAND, SystemAccountSealBanner } from "./SystemAccountSealBanner";

/** Mühür bandı: pending/invalid metni + komut; ok ya da alan yoksa (eski backend) çizilmez. */
describe("SystemAccountSealBanner", () => {
  beforeEach(() => useAuthStore.getState().setUser(null));

  it("varsayılan ok: çizilmez (oturum sıfırlaması da ok'a döner)", () => {
    expect(useAuthStore.getState().systemAccountSealStatus).toBe("ok");
    renderWithProviders(<SystemAccountSealBanner />);
    expect(screen.queryByTestId("sistem-hesabi-muhur-bandi")).toBeNull();
  });

  it("pending: mühürlenmemiş metni + tek seferlik komut", () => {
    useAuthStore.setState({ systemAccountSealStatus: "pending" });
    renderWithProviders(<SystemAccountSealBanner />);
    const bant = screen.getByTestId("sistem-hesabi-muhur-bandi");
    expect(bant.getAttribute("role")).toBe("alert");
    expect(bant.textContent).toContain("Sistem hesabı mühürlenmemiş");
    expect(bant.textContent).toContain(SEAL_COMMAND);
    expect(bant.textContent).toContain("SUPERADMIN-KURULUM");
  });

  it("invalid: geçersiz mühür metni + pasife alma yönlendirmesi", () => {
    useAuthStore.setState({ systemAccountSealStatus: "invalid" });
    renderWithProviders(<SystemAccountSealBanner />);
    const bant = screen.getByTestId("sistem-hesabi-muhur-bandi");
    expect(bant.textContent).toContain("Mührü geçersiz");
    expect(bant.textContent).toContain("pasife alın");
  });

  it("alanı göndermeyen eski backend: refresh sonrası ok kalır", async () => {
    const { authService } = await import("@/services/authService");
    const orijinal = authService.getMe;
    authService.getMe = (async () => ({ data: { isSystemAccount: true, systemAccountExists: true } })) as typeof authService.getMe;
    try {
      useAuthStore.setState({ systemAccountSealStatus: "pending" });
      await useAuthStore.getState().refreshSystemAccount();
      expect(useAuthStore.getState().systemAccountSealStatus).toBe("ok");
    } finally {
      authService.getMe = orijinal;
    }
    renderWithProviders(<SystemAccountSealBanner />);
    expect(screen.queryByTestId("sistem-hesabi-muhur-bandi")).toBeNull();
  });
});
