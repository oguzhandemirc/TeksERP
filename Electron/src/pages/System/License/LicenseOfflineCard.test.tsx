import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail, LicenseOfflineRequest } from "@/types/license";
import type { AcceptanceGate } from "@/lib/license/acceptance";
import { licenseService } from "@/services/licenseService";
import { LicenseOfflineCard } from "./LicenseOfflineCard";
import { failureLabel } from "./labels";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { offlineRequest: vi.fn(), offlineResponse: vi.fn() } }));

const HAZIR: AcceptanceGate = { ready: true, reason: null };
const detay = (etkin: boolean) => ({ kurulum: { etkin } }) as unknown as LicenseDetail;
const istek = (amac: LicenseOfflineRequest["amac"]): LicenseOfflineRequest => ({
  amac,
  zarf: "zarf-metni",
  gecerlilikSonu: "2026-10-01T10:00:00.000Z",
  hedefYol: "/v1/cevrimdisi",
  hedefUrl: "https://lisans.example/v1/cevrimdisi",
  istekGovdesi: { v: 1, zarf: "zarf-metni" },
  qrAdresi: "https://lisans.example/q#zarf-metni",
});

/** Çevrimdışı (QR) kartı — L2-7 B: etkin kurulum donanım değişikliğini de zarfla bildirir (aynı QR/yanıt kalıbı). */
describe("Lisans ekranı — çevrimdışı kart, donanım değişikliği zarfı", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭐ etkin kurulum: gerekçeyle `donanim` zarfı istenir, QR ve 'Donanım değişikliği bildirimi' satırı çizilir", async () => {
    vi.mocked(licenseService.offlineRequest).mockResolvedValue(istek("donanim"));
    renderWithProviders(<LicenseOfflineCard d={detay(true)} gate={HAZIR} />);
    fireEvent.change(screen.getByLabelText("Çevrimdışı donanım değişikliği gerekçesi"), { target: { value: " disk değişti " } });
    fireEvent.click(screen.getByRole("button", { name: "Donanım değişikliği isteği oluştur" }));
    await waitFor(() => expect(licenseService.offlineRequest).toHaveBeenCalledWith("donanim", undefined, "disk değişti"));
    expect(await screen.findByTestId("lisans-istek-qr")).toBeTruthy();
    expect(screen.getByText("Donanım değişikliği bildirimi")).toBeTruthy();
  });

  it("gerekçesiz bildirim null gönderir; yenileme düğmesi `yokla` ister ve donanım satırı çizmez", async () => {
    vi.mocked(licenseService.offlineRequest).mockResolvedValueOnce(istek("donanim")).mockResolvedValueOnce(istek("yokla"));
    renderWithProviders(<LicenseOfflineCard d={detay(true)} gate={HAZIR} />);
    fireEvent.click(screen.getByRole("button", { name: "Donanım değişikliği isteği oluştur" }));
    await waitFor(() => expect(licenseService.offlineRequest).toHaveBeenLastCalledWith("donanim", undefined, null));
    fireEvent.click(screen.getByRole("button", { name: "Yenileme isteği oluştur" }));
    await waitFor(() => expect(licenseService.offlineRequest).toHaveBeenLastCalledWith("yokla", undefined, undefined));
    await waitFor(() => expect(screen.queryByText("Donanım değişikliği bildirimi")).toBeNull());
  });

  it("etkinleşmemiş kurulumda donanım düğmesi YOK (bildirim lisans kimliği ister)", () => {
    renderWithProviders(<LicenseOfflineCard d={detay(false)} gate={HAZIR} />);
    expect(screen.queryByRole("button", { name: "Donanım değişikliği isteği oluştur" })).toBeNull();
    expect(screen.getByRole("button", { name: "Etkinleştirme isteği oluştur" })).toBeTruthy();
  });

  it("satıcının ISTEK_YOL reddi yoklama hatasında Türkçe etiketle görünür", () => {
    expect(failureLabel("ISTEK_YOL")).toMatch(/başka bir lisans sunucusu ucu/);
  });
});
