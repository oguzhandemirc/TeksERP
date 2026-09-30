import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import type { LicenseAcceptanceView } from "@/types/license";
import { licenseService } from "@/services/licenseService";
import { LicenseAcceptanceCard } from "./LicenseAcceptanceCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({ licenseService: { accept: vi.fn() } }));

const OZET = "4fe1d14e24fafffafc203f7b4d1c2930ceaa76ee4ec50f7e116a9f780fec5daf";

function view(over: Partial<LicenseAcceptanceView> = {}): LicenseAcceptanceView {
  return {
    metin: {
      kimlik: "KM-2026.1-taslak",
      ozet: OZET,
      taslak: true,
      kutular: ["1", "2"],
      bloklar: [
        { tur: "paragraf", satirlar: ["**TeksERP Lisans Sözleşmesi**"] },
        { tur: "liste", maddeler: ["Yazılım bu kurulum için lisanslıdır."] },
        { tur: "kutu", no: "1", metin: "Lisans Sözleşmesi'ni okudum." },
        { tur: "alanlar" },
        { tur: "kutu", no: "2", metin: "Yetkili olduğumu beyan ederim." },
        { tur: "dugmeler" },
      ],
    },
    durum: "YOK",
    gecerli: null,
    kayitlar: [],
    anahtarKimligi: "kur-abc",
    oneri: { adSoyad: "Ayşe Yılmaz" },
    ...over,
  };
}

const q = (data: LicenseAcceptanceView) => ({ data, isLoading: false, error: null }) as unknown as UseQueryResult<LicenseAcceptanceView>;
const kabulDugmesi = () => screen.getByRole("button", { name: "Kabul ediyorum ve devam et" });
const kutu = (no: string) => screen.getByRole("checkbox", { name: `Onay ${no}` });

/** Ek-7 ekran kuralları: kutular önceden işaretli gelmez; düğme bütün kutular + ad + unvan dolmadan açılmaz. */
describe("Lisans ekranı — sözleşme kabulü", () => {
  beforeEach(() => vi.clearAllMocks());

  it("metin backend bloklarından çizilir; kutular işaretsiz, ad oturum önerisiyle dolu, düğme pasif", () => {
    renderWithProviders(<LicenseAcceptanceCard q={q(view())} canManage active={false} />);
    expect(screen.getByText("TeksERP Lisans Sözleşmesi")).toBeTruthy();
    expect(screen.getByText("Yazılım bu kurulum için lisanslıdır.")).toBeTruthy();
    expect(kutu("1").getAttribute("data-state")).toBe("unchecked");
    expect(kutu("2").getAttribute("data-state")).toBe("unchecked");
    expect((screen.getByLabelText("Ad Soyad") as HTMLInputElement).value).toBe("Ayşe Yılmaz");
    expect(kabulDugmesi().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Taslak metin")).toBeTruthy();
  });

  it("⭐ bütün kutular + ad + unvan dolunca açılır; gövde metin kimliği/özeti + bütün kutular + işlem kimliği taşır", async () => {
    vi.mocked(licenseService.accept).mockResolvedValue(view({ durum: "GECERLI" }));
    renderWithProviders(<LicenseAcceptanceCard q={q(view())} canManage active={false} />);
    // Ad + unvan dolu ama kutular işaretsiz: düğme her eksik kutuda KAPALI kalır.
    fireEvent.change(screen.getByLabelText("Unvan"), { target: { value: "  Genel Müdür " } });
    expect(kabulDugmesi().hasAttribute("disabled")).toBe(true);
    fireEvent.click(kutu("1"));
    expect(kabulDugmesi().hasAttribute("disabled")).toBe(true);
    fireEvent.click(kutu("2"));
    expect(kabulDugmesi().hasAttribute("disabled")).toBe(false);
    fireEvent.click(kabulDugmesi());
    await waitFor(() => expect(licenseService.accept).toHaveBeenCalledTimes(1));
    const govde = vi.mocked(licenseService.accept).mock.calls[0]![0];
    expect(govde).toMatchObject({ metinKimligi: "KM-2026.1-taslak", metinOzeti: OZET, kutular: ["1", "2"], adSoyad: "Ayşe Yılmaz", unvan: "Genel Müdür" });
    expect(govde.clientToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("ad silinirse düğme kapanır; Vazgeç kutuları temizler", () => {
    renderWithProviders(<LicenseAcceptanceCard q={q(view())} canManage active={false} />);
    fireEvent.click(kutu("1"));
    fireEvent.click(kutu("2"));
    fireEvent.change(screen.getByLabelText("Unvan"), { target: { value: "Genel Müdür" } });
    fireEvent.change(screen.getByLabelText("Ad Soyad"), { target: { value: " " } });
    expect(kabulDugmesi().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(kutu("1").getAttribute("data-state")).toBe("unchecked");
  });

  it("kabul edilmişse form yok; özet + kabul kaydı görünür", () => {
    const gecerli = { kabulId: "k1", metinKimligi: "KM-2026.1-taslak", metinOzeti: OZET, kutular: ["1", "2"], adSoyad: "Ayşe Yılmaz", unvan: "Genel Müdür", kabulEden: { id: "u1", ad: "Ayşe Y." }, anahtarKimligi: "kur-abc", lisansKimligi: null, istemciSurum: "1.5.0", sunucuSurum: "2.13.0", zaman: "2026-09-30T10:00:00.000Z" };
    renderWithProviders(<LicenseAcceptanceCard q={q(view({ durum: "GECERLI", gecerli, kayitlar: [gecerli] }))} canManage active={false} />);
    expect(screen.queryByRole("button", { name: "Kabul ediyorum ve devam et" })).toBeNull();
    expect(screen.getByText("Kabul edildi")).toBeTruthy();
    expect(screen.getByTestId("lisans-kabul-kayitlari").textContent).toMatch(/Ayşe Yılmaz · Genel Müdür/);
  });

  it("yetkisiz (yalnız görüntüleme) kullanıcıya form çizilmez", () => {
    renderWithProviders(<LicenseAcceptanceCard q={q(view())} canManage={false} active={false} />);
    expect(screen.queryByRole("button", { name: "Kabul ediyorum ve devam et" })).toBeNull();
  });
});
