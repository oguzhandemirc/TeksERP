import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail } from "@/types/license";
import { licenseService } from "@/services/licenseService";
import { LicenseActivateCard } from "./LicenseActivateCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { pollNow: vi.fn(), detail: vi.fn() } }));

const detay = (paid: string): LicenseDetail =>
  ({ kurulum: { etkin: true }, durum: { odenmisTarih: { tarih: paid, kaynak: "ODEME", sozlesmeSonu: true } }, hak: null, kira: null }) as unknown as LicenseDetail;
const gate = { ready: true, reason: null };

/** K7 — "Şimdi yokla" başarıda ne olduğunu söyler: yalnız eşitleme, bitiş değişti mi. */
describe("Lisans ekranı — yoklama mesajı (K7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭐ bitiş değişmediyse 'Lisans yenilendi' DEĞİL, 'güncellendi … (değişmedi)' der", async () => {
    vi.mocked(licenseService.detail).mockResolvedValue(detay("2027-03-01T00:00:00.000Z"));
    vi.mocked(licenseService.pollNow).mockResolvedValue({ outcome: "BASARILI" });
    renderWithProviders(<LicenseActivateCard d={detay("2027-03-01T00:00:00.000Z")} gate={gate} />);
    fireEvent.click(screen.getByRole("button", { name: /Şimdi yokla/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const msg = vi.mocked(toast.success).mock.calls[0]?.[0];
    expect(msg).toContain("Lisans bilgisi güncellendi — bitiş: 01.03.2027 (değişmedi)");
    expect(msg).not.toContain("Lisans yenilendi");
  });

  it("bitiş uzadıysa 'uzadı' ve eski tarih yazılır", async () => {
    vi.mocked(licenseService.detail).mockResolvedValueOnce(detay("2027-03-01T00:00:00.000Z")).mockResolvedValueOnce(detay("2028-03-01T00:00:00.000Z"));
    vi.mocked(licenseService.pollNow).mockResolvedValue({ outcome: "BASARILI" });
    renderWithProviders(<LicenseActivateCard d={detay("2027-03-01T00:00:00.000Z")} gate={gate} />);
    fireEvent.click(screen.getByRole("button", { name: /Şimdi yokla/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toContain("(uzadı, eski: 01.03.2027)");
  });

  it("negatif sonda: yoklama başarısızsa başarı/güncellendi cümlesi çıkmaz, sebep yazılır", async () => {
    vi.mocked(licenseService.detail).mockResolvedValue(detay("2027-03-01T00:00:00.000Z"));
    vi.mocked(licenseService.pollNow).mockResolvedValue({ outcome: "ETKIN_DEGIL" });
    renderWithProviders(<LicenseActivateCard d={detay("2027-03-01T00:00:00.000Z")} gate={gate} />);
    fireEvent.click(screen.getByRole("button", { name: /Şimdi yokla/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const msg = vi.mocked(toast.success).mock.calls[0]?.[0] as string;
    expect(msg).toBe("Kurulum etkinleşmemiş; önce etkinleştirme kodu girin.");
    expect(msg).not.toContain("güncellendi");
  });
});
