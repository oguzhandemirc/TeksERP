import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail } from "@/types/license";
import { licenseService } from "@/services/licenseService";
import { toast } from "sonner";
import { LicenseTransferCard } from "./LicenseTransferCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { drTakeover: vi.fn(), requestTransfer: vi.fn() } }));

// Kart yalnız `tasima` alanını okur; geri kalan ayrıntı bu testte anlamsız.
const d = { tasima: null } as unknown as LicenseDetail;
const ANA = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const MESAJ = "Lisans sunucusu ana sunucuyu kendiliğinden bulamadı (tesiste etkin üretim kurulumu yok ya da birden çok var); ana kurulum kimliğini portaldan ya da ana sunucunun Lisans ekranından alıp alana yazın.";

function belirsizHatasi(): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError("409", "ERR_BAD_REQUEST", { headers }, null, {
    status: 409,
    statusText: "Conflict",
    headers: {},
    config: { headers },
    data: { success: false, message: MESAJ, details: { code: "LICENSE_VENDOR_REJECTED", vendorCode: "DR_ANA_BELIRSIZ", tekrarDenenebilir: false } },
  });
}

const devralDugmesi = () => screen.getByRole("button", { name: "Üretimi bu sunucuya devral" });
const gerekceYaz = (v: string) => fireEvent.change(screen.getByLabelText("DR gerekçesi"), { target: { value: v } });
const kimlikYaz = (v: string) => fireEvent.change(screen.getByLabelText(/ana sunucunun kurulum kimliği/), { target: { value: v } });
async function onayla(): Promise<void> {
  fireEvent.click(devralDugmesi());
  fireEvent.click(await screen.findByRole("button", { name: "Devral" }));
}

/** PANEL DR FORMU (I6 kararı c): ana kurulum kimliği isteğe bağlı; boşsa satıcı çıkarır, çıkaramazsa alan istenir. */
describe("Lisans ekranı — DR devral formu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("kimlik BOŞ + gerekçe → devralınabilir; gövdeye kimlik girmez (null)", async () => {
    vi.mocked(licenseService.drTakeover).mockResolvedValue({} as LicenseDetail);
    renderWithProviders(<LicenseTransferCard d={d} />);
    expect(screen.getByTestId("lisans-dr-ana-ipucu").textContent).toMatch(/Boş bırakılırsa/);
    expect(devralDugmesi().hasAttribute("disabled")).toBe(true);
    gerekceYaz("ana sunucu yandı");
    expect(devralDugmesi().hasAttribute("disabled")).toBe(false);
    await onayla();
    await waitFor(() => expect(licenseService.drTakeover).toHaveBeenCalledWith(null, "ana sunucu yandı"));
  });

  it("biçimsiz kimlik → düğme kapalı, ipucu biçimi söyler", () => {
    renderWithProviders(<LicenseTransferCard d={d} />);
    gerekceYaz("ana sunucu yandı");
    kimlikYaz("abc");
    expect(devralDugmesi().hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("lisans-dr-ana-ipucu").textContent).toMatch(/biçimi geçersiz/);
  });

  it("409 DR_ANA_BELIRSIZ → Türkçe hata, alan istenir; kimlik girilince o kimlikle yeniden denenir", async () => {
    vi.mocked(licenseService.drTakeover).mockRejectedValueOnce(belirsizHatasi()).mockResolvedValueOnce({} as LicenseDetail);
    renderWithProviders(<LicenseTransferCard d={d} />);
    gerekceYaz("ana sunucu yandı");
    await onayla();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(MESAJ));
    expect(screen.getByTestId("lisans-dr-ana-ipucu").textContent).toMatch(/kendiliğinden bulamadı/);
    expect(devralDugmesi().hasAttribute("disabled")).toBe(true);
    kimlikYaz(ANA);
    expect(devralDugmesi().hasAttribute("disabled")).toBe(false);
    await onayla();
    await waitFor(() => expect(licenseService.drTakeover).toHaveBeenLastCalledWith(ANA, "ana sunucu yandı"));
  });
});
