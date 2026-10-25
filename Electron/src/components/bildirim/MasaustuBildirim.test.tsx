// Masaüstü köprüsü + tercih kartı (N3): bayrak kapalı → DOM yok, IPC yok · web (köprü yok) → çökmez, liste
// çekilmez · rozet = zil özeti (12 okunmamış + açık alarm) · OS bildirimi tıklaması doğru sayfayı açar ve okundu
// yapar · seçim boşken liste çekilmez · kart: tür seçimi kişisel tercihe yazılır, web'de açıklama görünür.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { AppPreferences } from "@/types/preferences";

const d = vi.hoisted(() => ({ bayrak: true, prefs: {} as AppPreferences, setPreference: vi.fn() }));
const svc = vi.hoisted(() => ({
  ozet: vi.fn(),
  bekle: vi.fn(() => new Promise(() => {})),
  liste: vi.fn(async () => ({ items: [], nextCursor: null, sayi: 0, epoch: 1, rev: 1, alarmRev: 0 })),
  katalog: vi.fn(async () => ({
    turler: [
      { kod: "siparis.patron-siparisi", ad: "Patron siparişi geldi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş", kilit: "YOK", kilitGerekcesi: null },
      { kod: "sistem.yedek-basarisiz", ad: "Gece yedeği alınamadı", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem", kilit: "YOK", kilitGerekcesi: null },
      { kod: "dokuma.tezgah-alarmi", ad: "Tezgah alarmı", sinif: "ALARM", altTur: null, grup: "Dokuma", kilit: "NOBETTE", kilitGerekcesi: null },
    ],
  })),
  okundu: vi.fn(async () => ({ degisti: true })),
  tercihler: vi.fn(async () => ({ hucreler: [], satirlar: [] as unknown[] })),
  tercihleriYaz: vi.fn(async () => ({ hucreler: [], satirlar: [] })),
}));
const TURLER = [
  { kod: "siparis.patron-siparisi", ad: "Patron siparişi geldi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş", kilit: "YOK", kilitGerekcesi: null },
  { kod: "sistem.yedek-basarisiz", ad: "Gece yedeği alınamadı", sinif: "BILDIRIM", altTur: "KOSUL", grup: "Sistem", kilit: "YOK", kilitGerekcesi: null },
];
const hucre = (kind: string, masaustu: "ACIK" | "KAPALI") => ({
  kind,
  kanallar: [
    { kanal: "UYGULAMA", durum: "ACIK", kilit: false, kaynak: "katalog", kapsam: null },
    { kanal: "MASAUSTU", durum: masaustu, kilit: false, kaynak: "katalog", kapsam: null },
  ],
});
vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: () => null,
  notificationErrorCode: () => undefined,
}));
vi.mock("@/lib/bildirim/headers", () => ({ openBellStream: () => new Promise(() => {}) }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { bildirimGelenKutusuEnabled: d.bayrak } }, isSuccess: true }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs: d.prefs, setPreference: d.setPreference }),
  usePreferences: () => ({ prefs: d.prefs, setPreference: d.setPreference }),
}));
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: { navigateActive: unknown }) => unknown) => sel({ navigateActive }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
let openCb: ((e: { bildirimId: string; yol: string }) => void) | null = null;
const bridge = {
  notify: vi.fn(async () => ({ shown: true })),
  rozet: vi.fn(async () => true),
  onOpen: vi.fn((cb: typeof openCb) => {
    openCb = cb;
    return () => undefined;
  }),
};

function masaustu(on: boolean) {
  (window as unknown as { api?: unknown }).api = on ? { bildirim: bridge } : undefined;
}

async function kopru() {
  vi.resetModules();
  const { MasaustuBildirimKoprusu } = await import("./MasaustuBildirimKoprusu");
  return renderWithProviders(<MasaustuBildirimKoprusu />);
}

beforeEach(() => {
  d.bayrak = true;
  d.prefs = {} as AppPreferences;
  d.setPreference.mockReset();
  navigateActive.mockReset();
  Object.values(svc).forEach((f) => f.mockClear());
  // Testin kurduğu katalog cevabı sonrakine sızmasın: varsayılan (hücresiz = eski sunucu) geri kurulur.
  svc.katalog.mockImplementation(async () => ({
    turler: [...TURLER, { kod: "dokuma.tezgah-alarmi", ad: "Tezgah alarmı", sinif: "ALARM", altTur: null, grup: "Dokuma", kilit: "NOBETTE", kilitGerekcesi: null }],
  }) as never);
  Object.values(bridge).forEach((f) => f.mockClear());
  openCb = null;
  svc.ozet.mockImplementation(async () => ({ enabled: true, okunmamis: 12, alarmAcik: 1, epoch: 1, rev: 1, alarmRev: 0 }));
  masaustu(true);
});

describe("MasaustuBildirimKoprusu", () => {
  it("bayrak kapalı → DOM üretmez, rozet/OS IPC'si ve liste çağrısı yok", async () => {
    d.bayrak = false;
    d.prefs = { bildirim: { masaustuTurler: ["siparis.patron-siparisi"] } } as AppPreferences;
    const { container } = await kopru();
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(container.innerHTML).toBe("");
    expect(bridge.rozet).not.toHaveBeenCalled();
    expect(svc.liste).not.toHaveBeenCalled();
  });

  it("web paneli (köprü yok) → çökmez, liste çekilmez", async () => {
    masaustu(false);
    d.prefs = { bildirim: { masaustuTurler: ["siparis.patron-siparisi"] } } as AppPreferences;
    const { container } = await kopru();
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(container.innerHTML).toBe("");
    expect(svc.liste).not.toHaveBeenCalled();
  });

  it("rozet zil özetinden: 12 okunmamış + açık alarm; seçim boşken liste çekilmez", async () => {
    await kopru();
    // Rozet zil durumunu izler; akışı zil bileşeni açar — burada özeti elle tazeleriz.
    const { bellClient } = await import("@/lib/bildirim/hooks");
    const birak = bellClient.abone();
    await waitFor(() => expect(bridge.rozet).toHaveBeenCalledWith({ okunmamis: 12, alarm: true }));
    expect(svc.liste).not.toHaveBeenCalled();
    birak();
  });

  it("seçili tür varsa taban için okunmamış listesi seçili türlerle çekilir", async () => {
    d.prefs = { bildirim: { masaustuTurler: ["siparis.patron-siparisi"] } } as AppPreferences;
    await kopru();
    await waitFor(() =>
      expect(svc.liste).toHaveBeenCalledWith({ sekme: "okunmamis", turler: ["siparis.patron-siparisi"], limit: 20 }),
    );
  });

  it("F4 sunucusu: hücrede MASAUSTU ACIK tür, eski anahtar boşken de listeye girer", async () => {
    svc.katalog.mockImplementation(async () => ({ turler: TURLER, hucreler: [hucre("sistem.yedek-basarisiz", "ACIK")] }) as never);
    await kopru();
    await waitFor(() =>
      expect(svc.liste).toHaveBeenCalledWith({ sekme: "okunmamis", turler: ["sistem.yedek-basarisiz"], limit: 20 }),
    );
  });

  it("OS bildirimi tıklaması: göreli yola gider + okundu; dış adres yok sayılır", async () => {
    await kopru();
    await waitFor(() => expect(openCb).not.toBeNull());
    act(() => openCb!({ bildirimId: ID, yol: "/operations/orders?focus=o1" }));
    expect(navigateActive).toHaveBeenCalledWith("/operations/orders?focus=o1");
    await waitFor(() => expect(svc.okundu).toHaveBeenCalledWith(ID));
    act(() => openCb!({ bildirimId: ID, yol: "https://saldirgan.example/" }));
    expect(navigateActive).toHaveBeenCalledTimes(1);
  });
});

describe("MasaustuBildirimKarti", () => {
  async function kart() {
    vi.resetModules();
    const { MasaustuBildirimKarti } = await import("./MasaustuBildirimKarti");
    return renderWithProviders(<MasaustuBildirimKarti />);
  }

  it("bayrak kapalı → yalnız açıklama, katalog çekilmez", async () => {
    d.bayrak = false;
    await kart();
    expect(screen.getByText(/Bildirimler kapalı/)).toBeTruthy();
    expect(svc.katalog).not.toHaveBeenCalled();
  });

  it("varsayılan hiçbiri; ALARM türü listelenmez; seçim kişisel tercihe yazılır", async () => {
    await kart();
    await screen.findByText("Patron siparişi geldi");
    expect(screen.getByTestId("masaustu-secili-sayi").textContent).toBe("Hiçbir tür seçili değil");
    expect(screen.queryByText("Tezgah alarmı")).toBeNull();
    expect(screen.getByText(/Tezgah alarmı kendi masaüstü bildirimini/)).toBeTruthy();
    // Eski sunucu (`hucreler` yok): yazım N3 anahtarına düşer, PUT yok.
    fireEvent.click(screen.getByLabelText("Gece yedeği alınamadı"));
    await waitFor(() => expect(d.setPreference).toHaveBeenCalledWith({ bildirim: { masaustuTurler: ["sistem.yedek-basarisiz"] } }));
    fireEvent.click(screen.getByText("Tümünü seç"));
    await waitFor(() =>
      expect(d.setPreference).toHaveBeenLastCalledWith({
        bildirim: { masaustuTurler: ["siparis.patron-siparisi", "sistem.yedek-basarisiz"] },
      }),
    );
    expect(svc.tercihleriYaz).not.toHaveBeenCalled();
  });

  it("F4 sunucusu: seçim hücreden okunur, yazım PUT /tercihler; N3 anahtarı yalnız kalanlarla budanır", async () => {
    svc.katalog.mockImplementationOnce(async () => ({
      turler: TURLER,
      hucreler: [hucre("siparis.patron-siparisi", "ACIK"), hucre("sistem.yedek-basarisiz", "KAPALI")],
    }) as never);
    svc.tercihler.mockImplementationOnce(async () => ({
      hucreler: [],
      satirlar: [{ id: "r1", tur: "siparis.patron-siparisi", kanal: "UYGULAMA", acik: true, kapsam: null }],
    }));
    d.prefs = { bildirim: { masaustuTurler: ["sistem.yedek-basarisiz"] } } as AppPreferences;
    await kart();
    await screen.findByText("Patron siparişi geldi");
    // sunucu ACIK (patron) ∪ eski anahtar (yedek) → ikisi seçili
    expect(screen.getByTestId("masaustu-secili-sayi").textContent).toBe("2 tür seçili");
    fireEvent.click(screen.getByLabelText("Gece yedeği alınamadı"));
    await waitFor(() =>
      expect(svc.tercihleriYaz).toHaveBeenCalledWith([
        { tur: "siparis.patron-siparisi", kanal: "UYGULAMA", acik: true },
        { tur: "siparis.patron-siparisi", kanal: "MASAUSTU", acik: true },
        { tur: "sistem.yedek-basarisiz", kanal: "MASAUSTU", acik: false },
      ]),
    );
    await waitFor(() => expect(d.setPreference).toHaveBeenCalledWith({ bildirim: { masaustuTurler: [] } }));
  });

  it("web panelinde 'yalnız masaüstü uygulamasında' açıklaması", async () => {
    masaustu(false);
    await kart();
    await screen.findByText("Patron siparişi geldi");
    expect(screen.getByText(/yalnız masaüstü uygulamasında çıkar/)).toBeTruthy();
  });
});
