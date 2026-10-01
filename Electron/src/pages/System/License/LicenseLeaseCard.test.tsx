import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseDetail } from "@/types/license";
import { licenseService } from "@/services/licenseService";
import { toast } from "sonner";
import { LicenseLeaseCard } from "./LicenseLeaseCard";
import { LICENSE_FILE_MAX_BYTES } from "./LicenseFileUpload";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { licenseFile: vi.fn() } }));

const yaptirim = { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false };
const kira = {
  kiraId: "k1", verilis: "2026-10-01T09:00:00.000Z", bitis: "2026-10-31T09:00:00.000Z", sunucuSaati: "2026-10-01T09:00:00.000Z",
  ekSureGun: 30, zorlama: true, gecerlilikBitis: "2027-03-01T00:00:00.000Z", yaptirim, yoklamaAraligiDk: 60, devredildi: false,
  kanal: { kod: "adnansahin", guncelSurumler: {} },
};
const yoklama = {
  saticiYapilandirildi: true, saticiAdresi: "lisans.ornek", sonDeneme: null, sonBasari: null, sonBasarisizlik: null, sonHataKodu: null, sonrakiDeneme: null,
  zil: { bagli: false, sonBaglanti: null, sonZil: null, sonKalpAtisi: null, sonHataKodu: null },
};

// Kart yalnız `kira`, `yoklama`, `durum.odenmisTarih/baglanti` ve `kurulum.etkin` okur.
function detay(durum: Partial<LicenseDetail["durum"]> = {}, ek: Partial<LicenseDetail> = {}): LicenseDetail {
  return { kira, yoklama, kurulum: { etkin: true }, durum, ...ek } as unknown as LicenseDetail;
}

/** LİSANS EKRANI — kira kartı (L2-5): v2'de süre ödenmiş tarihten (P), kira bitişi yalnız güncellik; dosya yükleme. */
describe("Lisans ekranı — kira kartı (ödenmiş tarih + lisans dosyası)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("⭐ v2 belge: ödenmiş tarih görünür, kira 'güncellik' olur, eski vade satırı gizlenir", () => {
    renderWithProviders(<LicenseLeaseCard d={detay({ odenmisTarih: { tarih: "2027-03-01T00:00:00.000Z", kaynak: "ODEME", sozlesmeSonu: true } })} />);
    expect(screen.getByTestId("lisans-odenmis-tarih").textContent).toBe("01.03.2027");
    expect(screen.getByText("Kira (güncellik)")).toBeTruthy();
    expect(screen.queryByText("Vade")).toBeNull();
  });

  it("süresiz P ve ufuktan gelen P ayrı yazılır", () => {
    const { unmount } = renderWithProviders(<LicenseLeaseCard d={detay({ odenmisTarih: { tarih: null, kaynak: "SURESIZ", sozlesmeSonu: false } })} />);
    expect(screen.getByTestId("lisans-odenmis-tarih").textContent).toBe("Süresiz");
    unmount();
    renderWithProviders(<LicenseLeaseCard d={detay({ odenmisTarih: { tarih: "2027-03-01T00:00:00.000Z", kaynak: "UFUK", sozlesmeSonu: false } })} />);
    expect(screen.getByTestId("lisans-odenmis-tarih").textContent).toMatch(/çevrimdışı çalışma sınırı/);
  });

  it("⭐ eski backend / v1 belge (alan yok): bugünkü görünüm — 'Kira' + 'Vade', ödenmiş tarih ve son alışveriş satırı YOK", () => {
    renderWithProviders(<LicenseLeaseCard d={detay()} />);
    expect(screen.queryByTestId("lisans-odenmis-tarih")).toBeNull();
    expect(screen.queryByTestId("lisans-son-alisveris")).toBeNull();
    expect(screen.getByText("Kira")).toBeTruthy();
    expect(screen.getByText("Vade")).toBeTruthy();
  });

  it("son kira alışverişi 24 saatten eskiyse belirtilir", () => {
    renderWithProviders(<LicenseLeaseCard d={detay({ baglanti: { sonAlisveris: "2026-09-20T09:00:00.000Z", internetVar: false } })} />);
    expect(screen.getByTestId("lisans-son-alisveris").textContent).toMatch(/24 saatten eski/);
  });

  it("dosya yükleme yalnız yöneticiye (license:manage) ve etkin kurulumda", () => {
    const { unmount } = renderWithProviders(<LicenseLeaseCard d={detay()} />);
    expect(screen.queryByRole("button", { name: /Lisans dosyası yükle/ })).toBeNull();
    unmount();
    const { unmount: u2 } = renderWithProviders(<LicenseLeaseCard d={detay({}, { kurulum: { etkin: false } } as Partial<LicenseDetail>)} canManage />);
    expect(screen.queryByRole("button", { name: /Lisans dosyası yükle/ })).toBeNull();
    u2();
    renderWithProviders(<LicenseLeaseCard d={detay()} canManage />);
    expect(screen.getByRole("button", { name: /Lisans dosyası yükle/ })).toBeTruthy();
  });

  it("⭐ seçilen dosyanın METNİ servise gider; başarı toast'ı", async () => {
    vi.mocked(licenseService.licenseFile).mockResolvedValue({} as LicenseDetail);
    renderWithProviders(<LicenseLeaseCard d={detay()} canManage />);
    const icerik = '{"v":1,"kira":"a.b.c"}';
    // jsdom'un Blob'u `text()` taşımaz (Chromium taşır): okuma yolu aynı kalsın diye yalnız onu ekle.
    const dosya = new File([icerik], "uzatma.json", { type: "application/json" });
    Object.defineProperty(dosya, "text", { value: () => Promise.resolve(icerik) });
    fireEvent.change(screen.getByTestId("lisans-dosyasi-girdi"), { target: { files: [dosya] } });
    await waitFor(() => expect(licenseService.licenseFile).toHaveBeenCalledWith(icerik));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lisans dosyası kabul edildi."));
  });

  it("aşırı büyük dosya gönderilmez", async () => {
    renderWithProviders(<LicenseLeaseCard d={detay()} canManage />);
    const buyuk = new File(["x".repeat(LICENSE_FILE_MAX_BYTES + 1)], "buyuk.json");
    // Okuma yolu çalışır kalsın: sınır kalkarsa dosya GERÇEKTEN gönderilir ve test kırmızı verir.
    Object.defineProperty(buyuk, "text", { value: () => Promise.resolve("{}") });
    vi.mocked(licenseService.licenseFile).mockResolvedValue({} as LicenseDetail);
    fireEvent.change(screen.getByTestId("lisans-dosyasi-girdi"), { target: { files: [buyuk] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/büyük/)));
    expect(licenseService.licenseFile).not.toHaveBeenCalled();
  });
});
