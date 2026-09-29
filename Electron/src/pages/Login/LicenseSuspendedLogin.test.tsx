import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { useLicenseSuspension } from "@/lib/license/suspension";
import type { LoginFormValues } from "./LoginForm";

const loginMethods = vi.fn();
vi.mock("@/services/authService", () => ({ authService: { getLoginMethods: () => loginMethods() } }));

const { LicenseSuspendedLogin } = await import("./LicenseSuspendedLogin");
const { useLoginLicenseSuspended } = await import("./useServerCompanyName");

function Probe() {
  const suspended = useLoginLicenseSuspended();
  return <span data-testid="k5">{suspended ? "evet" : "hayir"}</span>;
}

function K5Form() {
  const form = useForm<LoginFormValues>({ defaultValues: { username: "", password: "" } });
  return <LicenseSuspendedLogin form={form} submitting={false} onSubmit={() => undefined} />;
}

/**
 * GİRİŞ ÖNCESİ K5 (yönetici kararı d): login-methods `lisansDurduruldu` taşır (yalnız zorla ∧
 * DURDURULMUŞ). Panel giriş ekranında K5 dalını çizer ve sinyali oturum kabuğu kararına yazar —
 * giren yönetici kabuk yerine "verilerimi al" sayfasına gider. Eski backend alanı göndermez → false.
 */
describe("giriş öncesi K5", () => {
  beforeEach(() => {
    loginMethods.mockReset();
    useLicenseSuspension.setState({ suspended: false });
  });

  it("⭐ lisansDurduruldu:true → K5 dalı ve kabuk sinyali", async () => {
    loginMethods.mockResolvedValue({ success: true, data: { companyName: "X", lisansDurduruldu: true } });
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId("k5")).toHaveTextContent("evet"));
    expect(useLicenseSuspension.getState().suspended).toBe(true);
  });

  it("eski backend (alan yok) ya da false → giriş açık, önceki sinyal söner", async () => {
    useLicenseSuspension.setState({ suspended: true });
    loginMethods.mockResolvedValue({ success: true, data: { companyName: "X" } });
    renderWithProviders(<Probe />);
    await waitFor(() => expect(useLicenseSuspension.getState().suspended).toBe(false));
    expect(screen.getByTestId("k5")).toHaveTextContent("hayir");
  });

  it("K5 giriş dalı: durdurma cümlesi + 'verilerimi al' girişi", () => {
    renderWithProviders(<K5Form />);
    expect(screen.getByText("Program durduruldu")).toBeInTheDocument();
    expect(screen.getByText(/Verilerimi al — yönetici hesabıyla/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giriş yap ve verilerimi al" })).toBeInTheDocument();
  });
});
