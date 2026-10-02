import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { FingerprintFactorReport, LicenseDetail } from "@/types/license";
import { licenseService } from "@/services/licenseService";
import { toast } from "sonner";
import { LicenseMachineCard } from "./LicenseMachineCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { reportHardwareChange: vi.fn() } }));

const okundu: FingerprintFactorReport = { kaynak: "okundu", durum: "OKUNDU", yol: "f1.kayit", sonOkuma: "2026-10-01T08:00:00.000Z", celiski: [], hatali: [] };

function detay(o: { etkin?: boolean; kayip?: string[]; f3?: FingerprintFactorReport } = {}): LicenseDetail {
  const f3 = o.f3 ?? okundu;
  return {
    kurulum: { kurulumId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", veritabaniKimligi: null, anahtarKimligi: "kur-x", etkin: o.etkin ?? true, ilkAcilis: null },
    depo: { dizin: "C:/TeksERP/lisans", sorun: null, bozukAnahtarKenaraAlindi: false },
    parmakIzi: {
      olculdu: "2026-10-01T09:00:00.000Z",
      olculen: { f1: true, f2: true, f3: f3.kaynak === "okundu", f4: true, f5: true },
      karar: "ESLESTI",
      eslesen: 4,
      olculebilen: 5,
      uyusmayan: o.kayip ?? [],
      okuma: { f1: okundu, f2: okundu, f3, f4: okundu, f5: okundu },
      kayip: o.kayip ?? [],
      onbellekBozuk: false,
    },
  } as unknown as LicenseDetail;
}

/** Parmak izi kartı (K8): etken kaynağı (önbellek · kayıp) ve "Donanım değişikliğini bildir". */
describe("Lisans ekranı — kurulum ve parmak izi kartı", () => {
  beforeEach(() => vi.clearAllMocks());

  it("önbellekten gelen etken son okumasıyla, kayıp etken kırmızı ve 'kayıp' notuyla görünür", () => {
    const { unmount } = renderWithProviders(<LicenseMachineCard d={detay({ f3: { ...okundu, kaynak: "onbellek", durum: "OKUNAMADI" } })} />);
    expect(screen.getByTestId("lisans-etken-f3").textContent).toMatch(/önbellekten/);
    unmount();
    renderWithProviders(<LicenseMachineCard d={detay({ kayip: ["f3"], f3: { ...okundu, kaynak: "yok", durum: "OKUNAMADI" } })} />);
    const satir = screen.getByTestId("lisans-etken-f3");
    expect(satir.textContent).toMatch(/kayıp/);
    expect(satir.className).toMatch(/destructive/);
  });

  it("yetkisiz ya da etkinleşmemiş kurulumda bildir düğmesi yok", () => {
    const { unmount } = renderWithProviders(<LicenseMachineCard d={detay()} />);
    expect(screen.queryByRole("button", { name: "Donanım değişikliğini bildir" })).toBeNull();
    unmount();
    renderWithProviders(<LicenseMachineCard d={detay({ etkin: false })} canManage />);
    expect(screen.queryByRole("button", { name: "Donanım değişikliğini bildir" })).toBeNull();
  });

  it("bildir → onay → gerekçeyle istek; sonuç cümlesi toast'ta", async () => {
    vi.mocked(licenseService.reportHardwareChange).mockResolvedValue({ talepId: "t", durum: "BEKLIYOR", kayip: [], lisans: {} as LicenseDetail });
    renderWithProviders(<LicenseMachineCard d={detay()} canManage />);
    fireEvent.change(screen.getByLabelText("Donanım değişikliği gerekçesi"), { target: { value: "anakart değişti" } });
    fireEvent.click(screen.getByRole("button", { name: "Donanım değişikliğini bildir" }));
    fireEvent.click(await screen.findByRole("button", { name: "Bildir" }));
    await waitFor(() => expect(licenseService.reportHardwareChange).toHaveBeenCalledWith("anakart değişti"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/onaylayınca/)));
  });
});
