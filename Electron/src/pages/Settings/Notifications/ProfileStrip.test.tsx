// Profil şeridi: etkin profil çipte seçili ve adla yazılır ("Özel" = hiçbiri) · çip → uygula ucuna doğru gövde ·
// cevap tercih formuna yazılır · kaydet `clientToken`la · eski sunucu (404) → şerit yok · kirli taslakta önce onay ·
// tür satırında "Patron telefonu" anahtarı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { activeLabel, applyBody, profileChips } from "./profile-strip-model";

const d = vi.hoisted(() => ({ status: null as number | null }));
const kanal = (k: string, durum: string, kilit = false) => ({ kanal: k, durum, kilit, kaynak: "katalog", kapsam: null });
const HUCRELER = [
  { kind: "siparis.patron-siparisi", kanallar: [kanal("UYGULAMA", "ACIK"), kanal("OZET", "KAPALI"), kanal("MASAUSTU", "KAPALI"), kanal("PATRON_PUSH", "ACIK")] },
  { kind: "sistem.yedek-basarisiz", kanallar: [kanal("UYGULAMA", "ACIK", true), kanal("OZET", "KAPALI"), kanal("PATRON_PUSH", "ACIK")] },
];
const VIEW = {
  kanal: "UYGULAMA",
  turSayisi: 2,
  hazir: [
    { kod: "HEPSI", ad: "Her şey", aciklama: "Hepsi.", acik: ["siparis.patron-siparisi", "sistem.yedek-basarisiz"] },
    { kod: "SESSIZ", ad: "Sessiz", aciklama: "Yalnız alarmlar.", acik: [] },
  ],
  kisisel: [{ id: "11111111-1111-4111-8111-111111111111", ad: "Gece", acik: [], kapali: ["siparis.patron-siparisi"], olusturuldu: "", guncellendi: "" }],
  etkin: ["hazir:HEPSI"],
};
const svc = vi.hoisted(() => ({
  katalog: vi.fn(),
  tercihler: vi.fn(),
  tercihleriYaz: vi.fn(),
  ayarlar: vi.fn(async () => ({ sessizBaslangic: null, sessizBitis: null, sessizKanallar: [], ozetSaati: null, ses: true })),
  ayarlariYaz: vi.fn(),
  tercihOnizleme: vi.fn(async () => ({ haftalik: 1, enCok: [], kaynak: "tahmin" })),
  profiller: vi.fn(),
  profilUygula: vi.fn(),
  profilKaydet: vi.fn(),
  profilGuncelle: vi.fn(),
  profilSil: vi.fn(),
}));
vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: (e: unknown) => (e ? d.status : null),
  notificationErrorCode: () => undefined,
  notificationErrorDetail: () => undefined,
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: true } }, isSuccess: true }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

const TURLER = [
  { kod: "siparis.patron-siparisi", ad: "Yönetim bulutundan sipariş geldi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş", kilit: "YOK", kilitGerekcesi: null },
  { kod: "sistem.yedek-basarisiz", ad: "Gece yedeği alınamadı", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem", kilit: "HER_ZAMAN", kilitGerekcesi: "Veri kaybı riski" },
];

import { NotificationSettingsPage } from "./NotificationSettingsPage";

beforeEach(() => {
  vi.clearAllMocks();
  d.status = null;
  svc.katalog.mockResolvedValue({ turler: TURLER, hucreler: HUCRELER, yetkiDisi: 0 });
  svc.tercihler.mockResolvedValue({ hucreler: HUCRELER, satirlar: [] });
  svc.profiller.mockResolvedValue(VIEW);
});

describe("profil modeli", () => {
  it("etkin yoksa Özel; kişisel eşleşme hazırın önüne geçer; uygula gövdesi", () => {
    expect(activeLabel({ ...VIEW, etkin: [] } as never)).toBe("Özel");
    expect(activeLabel({ ...VIEW, etkin: ["hazir:HEPSI", `kisisel:${VIEW.kisisel[0].id}`] } as never)).toBe("Gece");
    const chips = profileChips(VIEW as never);
    expect(applyBody(chips[0]!, "UYGULAMA")).toEqual({ kanal: "UYGULAMA", hazir: "HEPSI" });
    expect(applyBody(chips[2]!, "PATRON_PUSH")).toEqual({ kanal: "PATRON_PUSH", kisisel: VIEW.kisisel[0].id });
  });
});

describe("ProfileStrip", () => {
  it("etkin profil seçili ve adla yazılır; çip → uygula ucu, cevap forma yazılır", async () => {
    const yeni = [{ ...HUCRELER[0], kanallar: [kanal("UYGULAMA", "KAPALI"), kanal("OZET", "KAPALI"), kanal("MASAUSTU", "KAPALI"), kanal("PATRON_PUSH", "KAPALI")] }, HUCRELER[1]];
    svc.profilUygula.mockResolvedValue({ hucreler: yeni, satirlar: [], profiller: { ...VIEW, etkin: ["hazir:SESSIZ"] } });
    renderWithProviders(<NotificationSettingsPage />);
    expect((await screen.findByTestId("etkin-profil")).textContent).toBe("Her şey");
    expect(screen.getByTestId("profil-hazir:HEPSI").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("profil-hazir:SESSIZ"));
    await waitFor(() => expect(svc.profilUygula).toHaveBeenCalledWith({ kanal: "UYGULAMA", hazir: "SESSIZ" }));
    await waitFor(() => expect(screen.getByTestId("etkin-profil").textContent).toBe("Sessiz"));
    const satir = screen.getByTestId("tur-siparis.patron-siparisi");
    await waitFor(() => expect(within(satir).getByRole("radio", { name: "Kapalı" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("eski sunucu (404) → şerit yok, tercih listesi çalışır", async () => {
    d.status = 404;
    svc.profiller.mockRejectedValue(new Error("404"));
    renderWithProviders(<NotificationSettingsPage />);
    await screen.findByTestId("tur-siparis.patron-siparisi");
    expect(screen.queryByTestId("profil-seridi")).toBeNull();
  });

  it("kirli taslakta çip önce onay ister; Profili kaydet kapalı", async () => {
    renderWithProviders(<NotificationSettingsPage />);
    const satir = await screen.findByTestId("tur-siparis.patron-siparisi");
    await screen.findByTestId("profil-seridi");
    fireEvent.click(within(satir).getByRole("radio", { name: "Kapalı" }));
    expect(screen.getByRole("button", { name: /Profili kaydet/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTestId("profil-hazir:SESSIZ"));
    expect(svc.profilUygula).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Uygula" }));
    await waitFor(() => expect(svc.profilUygula).toHaveBeenCalledTimes(1));
  });

  it("Profili kaydet adı ve clientToken'ı yollar", async () => {
    svc.profilKaydet.mockResolvedValue({ profil: { ...VIEW.kisisel[0], id: "x", ad: "Fuar" }, profiller: VIEW });
    renderWithProviders(<NotificationSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Profili kaydet/ }));
    fireEvent.change(screen.getByLabelText("Ad"), { target: { value: "Fuar" } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(svc.profilKaydet).toHaveBeenCalledTimes(1));
    const body = svc.profilKaydet.mock.calls[0]![0] as { ad: string; kanal: string; clientToken: string };
    expect(body.ad).toBe("Fuar");
    expect(body.kanal).toBe("UYGULAMA");
    expect(body.clientToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("tür satırında Patron telefonu anahtarı var", async () => {
    renderWithProviders(<NotificationSettingsPage />);
    const satir = await screen.findByTestId("tur-siparis.patron-siparisi");
    expect(within(satir).getByRole("switch", { name: /Patron telefonu/ })).toBeTruthy();
  });
});
