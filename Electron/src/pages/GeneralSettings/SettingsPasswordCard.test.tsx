// =============================================================================
// BEKÇİ — AYAR ŞİFRESİ KARTI YALNIZ SATICI (SÜPERADMİN) HESABINDA
// =============================================================================
// NEDEN VAR: yönetim uçları (`/api/admin/settings-password`) sistem hesabı
// olmayan kimlikte **404** döner (403 ucun varlığını doğrulardı). Kart bu
// kimlik kapısını AYNALAMAZSA fabrika yöneticisi çalışmayan bir düğme görür ve
// üstelik "böyle bir şifre var" bilgisi sızar. Ölçülenler:
//   §1 Fabrika yöneticisi (isSystemAccount=false) → kart HİÇ çizilmez ve
//      durum ucu SORULMAZ (404 gürültüsü üretilmez).
//   §2 Satıcı hesabı, şifre tanımsız → "Tanımla" (Kaldır YOK).
//   §3 Satıcı hesabı, şifre tanımlı → "Değiştir" + "Kaldır".
//   §4 Kaydet kapısı: kısa şifre / tekrar uyuşmazlığı → düğme pasif.
//   §5 "Kaldır" İKİ ADIMLI — tek tıkla kapı uyumaz.
//
// NEGATİF SONDA (ölçüldü, sonra geri alındı):
//   ① `if (!isSystemAccount) return null` silindi → §1 kırmızı (2 kontrol).
//   ② `repeat === password` koşulu düşürüldü → §4 kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";

const status = vi.fn();
vi.mock("@/services/systemSettingService", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    settingsPasswordAdminService: {
      status: () => status(),
      set: vi.fn(),
      revoke: vi.fn(),
    },
  };
});

import { SettingsPasswordCard } from "./SettingsPasswordCard";

beforeEach(() => {
  status.mockReset();
  status.mockResolvedValue({ success: true, data: { configured: false } });
  useAuthStore.setState({ isSystemAccount: true, systemAccountExists: true });
});

describe("Ayar şifresi kartı", () => {
  it("§1 fabrika yöneticisinde kart YOK ve durum ucu sorulmaz", async () => {
    useAuthStore.setState({ isSystemAccount: false });
    renderWithProviders(<SettingsPasswordCard />);
    expect(screen.queryByText("Ayar şifresi")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });

  it("§2 satıcı hesabı, şifre tanımsız → Tanımla (Kaldır yok)", async () => {
    renderWithProviders(<SettingsPasswordCard />);
    expect(await screen.findByText("Ayar şifresi")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Tanımlı değil")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Tanımla" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kaldır" })).toBeNull();
  });

  it("§3 şifre tanımlıysa → Değiştir + Kaldır", async () => {
    status.mockResolvedValue({ success: true, data: { configured: true } });
    renderWithProviders(<SettingsPasswordCard />);
    await waitFor(() => expect(screen.getByText("Tanımlı")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Değiştir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kaldır" })).toBeTruthy();
  });

  it("§4 kısa şifre / tekrar uyuşmazlığı → kaydetme pasif", async () => {
    renderWithProviders(<SettingsPasswordCard />);
    const kaydet = await screen.findByRole("button", { name: "Tanımla" });
    expect((kaydet as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "kisa" } });
    fireEvent.change(screen.getByLabelText("Tekrar"), { target: { value: "kisa" } });
    expect((kaydet as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Şifre"), { target: { value: "yeterince-uzun" } });
    fireEvent.change(screen.getByLabelText("Tekrar"), { target: { value: "baska-sey" } });
    expect(screen.getByText("Şifreler aynı değil.")).toBeTruthy();
    expect((kaydet as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Tekrar"), { target: { value: "yeterince-uzun" } });
    expect((kaydet as HTMLButtonElement).disabled).toBe(false);
  });

  it("§5 Kaldır iki adımlı (tek tıkla kapı uyumaz)", async () => {
    status.mockResolvedValue({ success: true, data: { configured: true } });
    renderWithProviders(<SettingsPasswordCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    expect(screen.getByRole("button", { name: /Evet, kaldır/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("button", { name: /Evet, kaldır/i })).toBeNull();
  });
});
