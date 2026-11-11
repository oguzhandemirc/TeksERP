import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSyncExternalStore } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { PanoBoxDef } from "./box-types";
import type { PanoHareket, PanoKpi } from "./types";

// =============================================================================
// AÇILIŞ PANOSU (kutu düzeni) — davranış bekçisi: yalnız ekli kutular istenir, eklenen kutu tek başına
// istenir, null kutu çizilmez, düzen tercihe yazılır/okunur, bilinmeyen anahtar düşer, ajanda günü yalnız
// ajandayı ister, para birimleri toplanmaz; tıklama hedefleri izin + modül kapısından geçer.
// =============================================================================

let permissions: string[] = [];
const has = (p: string) => permissions.includes(p) || permissions.includes("admin:*");
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: has, hasAnyPermission: (ps: string[]) => ps.some(has) }),
}));

let regime: Partial<OperationsVisibilityContext> = {};
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false,
    dokumaEnabled: true, machineStopEnabled: false, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: true,
    gelenBelgeEnabled: true, emanetEnabled: false, reportsClosedKeys: [], isReportOpen: () => true,
    flagsReady: true, flagsFailed: false, financeEnabled: true, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false,
    ...regime,
  }),
}));

vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: { username: "ayse" } }) }));

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive }) }));

// Tercih deposu: bütün kancalar aynı kopyayı görür (gerçek sağlayıcı gibi); yazımlar casusa da düşer.
type Dash = { donem?: string; boxes?: string[] };
let prefs: { dashboard?: Dash } = {};
const listeners = new Set<() => void>();
const setPreference = vi.fn();
vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => {
    const p = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => prefs);
    return {
      prefs: p,
      setPreference: (fn: (cur: typeof prefs) => typeof prefs) => {
        const patch = fn(prefs);
        setPreference(patch);
        prefs = { ...prefs, ...patch };
        listeners.forEach((l) => l());
      },
    };
  },
}));

vi.mock("./PanoGrafik", () => ({
  PanoGrafik: ({ etiket }: { etiket: string }) => <div data-testid="grafik">{etiket}</div>,
  saydam: (r: string) => r,
}));

const fetchPanoCatalog = vi.fn();
const fetchPanoBoxes = vi.fn();
vi.mock("../dashboardService", () => ({
  fetchPanoCatalog: () => fetchPanoCatalog(),
  fetchPanoBoxes: (q: unknown) => fetchPanoBoxes(q),
  fetchStationLiveState: () => Promise.resolve([]),
}));

const { DashboardPage } = await import("../DashboardPage");
const { movementTarget } = await import("./pano-hedefler");

const k = (deger: number, degisimYuzde: number | null): PanoKpi => ({ deger, onceki: 0, degisimYuzde });
const box = (anahtar: string, boyut: PanoBoxDef["boyut"], varsayilan: boolean, donemli = true): PanoBoxDef => ({
  anahtar, baslik: anahtar, aciklama: `${anahtar} açıklaması`, grup: "uretim", donemli, varsayilan, boyut,
});

const CATALOG: PanoBoxDef[] = [
  box("uretim", "kpi", true), box("sevk", "kpi", true), box("siparis", "kpi", true), box("ciro", "kpi", false),
  box("egilim", "genis", true), box("tezgah", "kucuk", true, false), box("finans", "orta", false, false),
  box("ajanda", "genis", false, false), box("sonHareketler", "orta", true, false),
];
const DEFAULT_KEYS = ["uretim", "sevk", "siparis", "egilim", "tezgah", "sonHareketler"];

const hareket = (tur: PanoHareket["tur"], hedef: PanoHareket["hedef"], belgeNo: string): PanoHareket => ({
  tur, belgeNo, cari: "Müşteri A", miktar: 100, birim: "m", zaman: new Date().toISOString(), hedef,
});

let DATA: Record<string, unknown> = {};
function baseData(): Record<string, unknown> {
  return {
    uretim: { metre: k(1200, 12.5), top: k(30, 0) },
    sevk: { metre: k(800, null), irsaliye: k(4, null) },
    siparis: null,
    ciro: { tutarlar: [{ paraBirimi: "TRY", deger: 1000, onceki: 0, degisimYuzde: null }, { paraBirimi: "USD", deger: 50, onceki: 40, degisimYuzde: 25 }], fiyatsizSatir: 0 },
    egilim: { kova: "gun", noktalar: [{ anahtar: "2026-11-10", uretimMetre: 10, sevkMetre: null }] },
    tezgah: { toplam: 22, calisan: 1, duran: 0, izlenmeyen: 21, issiz: 21, suAnYuzde: 100 },
    finans: { alacaklar: [{ paraBirimi: "TRY", acikAlacak: 1000, vadesiGecmis: 0 }, { paraBirimi: "USD", acikAlacak: 50, vadesiGecmis: 10 }] },
    ajanda: agenda("2026-11-12"),
    sonHareketler: { hareketler: [hareket("SEVK", { tur: "shipment", id: "s1" }, "IRS-1")], turler: ["SEVK"] },
  };
}

function agenda(gun: string) {
  return {
    gun, ay: gun.slice(0, 7), kesildi: false, planliSevkiyat: null,
    isler: { alisTeslim: null, dokumaBaslangic: null, isEmriBaslangic: { toplam: 1, kalemler: [{ id: `w-${gun}`, no: `IE-${gun.slice(8)}`, durum: "PLANNED", hedefMetre: 500, zaman: null }] } },
    ayGunleri: Array.from({ length: 30 }, (_, i) => ({ gun: `2026-11-${String(i + 1).padStart(2, "0")}`, alis: 0, isEmri: i === 2 ? 1 : 0, dokuma: 0, toplam: i === 2 ? 1 : 0 })),
  };
}

/** İstenen kutu listeleri (çağrı sırasıyla). */
const requested = () => fetchPanoBoxes.mock.calls.map((c) => (c[0] as { kutular: string[] }).kutular);

function renderPano() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DashboardPage /></QueryClientProvider>);
}
const kpiUretim = async () => (await screen.findAllByText("Üretim"))[0]!;
const boxOrder = () => [...document.querySelectorAll("[data-box]")].map((e) => e.getAttribute("data-box"));

beforeEach(() => {
  permissions = ["admin:*"];
  regime = {};
  prefs = { dashboard: { donem: "bugun" } };
  DATA = baseData();
  navigateActive.mockReset();
  setPreference.mockReset();
  fetchPanoCatalog.mockReset().mockResolvedValue(CATALOG);
  fetchPanoBoxes.mockReset().mockImplementation(async (q: { kutular: string[]; gun?: string }) => ({
    kutular: Object.fromEntries(q.kutular.map((key) => [key, key === "ajanda" && q.gun ? agenda(q.gun) : DATA[key] ?? null])),
  }));
});

describe("Pano — yalnız ekli kutular istenir", () => {
  it("varsayılan düzen tek istekte, yalnız varsayılan kutularla", async () => {
    renderPano();
    await kpiUretim();
    expect(requested()).toEqual([DEFAULT_KEYS]);
    expect(fetchPanoCatalog).toHaveBeenCalledTimes(1);
  });

  it("kayıtlı düzen aynen gelir; katalogda olmayan anahtar sessizce düşer (istenmez)", async () => {
    prefs = { dashboard: { donem: "bugun", boxes: ["finans", "eskiKutu", "uretim"] } };
    renderPano();
    await screen.findByText("Alacaklar");
    expect(requested().map((r) => [...r].sort())).toEqual([["finans", "uretim"]]);
    expect(boxOrder()).toEqual(["uretim", "finans"]);
  });

  it("null kutu çizilmez (KPI dahil), termin/gecikme kutusu yok", async () => {
    renderPano();
    const serit = within(await screen.findByTestId("pano-kpi-seridi"));
    await kpiUretim();
    expect(serit.queryByText("Yeni sipariş")).toBeNull();
    expect(document.querySelector('[data-box="siparis"]')).toBeNull();
    expect(screen.queryByText(/Termin|Gecik/i)).toBeNull();
  });

  it("dönem değişince yalnız dönemli kutular tek istekte yeniden istenir; tercih yazılır", async () => {
    renderPano();
    await kpiUretim();
    fireEvent.click(screen.getByRole("radio", { name: "Hafta" }));
    await waitFor(() => expect(requested()).toHaveLength(2));
    expect(requested()[1]).toEqual(["uretim", "sevk", "siparis", "egilim"]);
    expect(fetchPanoBoxes.mock.calls[1]![0]).toMatchObject({ donem: "hafta" });
    expect(setPreference).toHaveBeenCalledWith({ dashboard: { donem: "hafta" } });
  });
});

describe("Pano — düzenleme kipi", () => {
  it("kutu eklenince yalnız o kutu istenir ve düzen tercihe yazılır", async () => {
    renderPano();
    await kpiUretim();
    fireEvent.click(screen.getByRole("button", { name: /Panoyu düzenle/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kutu ekle/ }));
    const sheet = await screen.findByRole("dialog");
    const ciro = within(sheet).getByText("ciro").closest("button")!;
    expect(ciro.getAttribute("aria-pressed")).toBe("false");
    expect(within(sheet).getByText("uretim").closest("button")!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(ciro);
    expect(setPreference).toHaveBeenLastCalledWith({ dashboard: { donem: "bugun", boxes: [...DEFAULT_KEYS, "hizliIslemler", "istasyonDoluluk", "ciro"] } });
    fireEvent.keyDown(sheet, { key: "Escape" });
    // Düzenleme kipinde istek yok.
    expect(requested()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Bitti/ }));
    await screen.findByTestId("pano-para-ciro");
    expect(requested()).toEqual([DEFAULT_KEYS, ["ciro"]]);
  });

  it("× ile çıkar, varsayılana dön tercihi siler", async () => {
    prefs = { dashboard: { donem: "bugun", boxes: ["uretim", "finans"] } };
    renderPano();
    await screen.findByText("Alacaklar");
    fireEvent.click(screen.getByRole("button", { name: /Panoyu düzenle/ }));
    fireEvent.click(screen.getByRole("button", { name: "finans kutusunu kaldır" }));
    expect(prefs.dashboard?.boxes).toEqual(["uretim"]);
    fireEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    expect(prefs.dashboard?.boxes).toBeUndefined();
    expect(boxOrder()).toEqual([...DEFAULT_KEYS, "hizliIslemler", "istasyonDoluluk"]);
  });

  it("kip dışında ⋯ menüsünden kaldır", async () => {
    renderPano();
    await screen.findByText("Tezgâh salonu");
    const trigger = screen.getByRole("button", { name: "tezgah kutusu seçenekleri" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Panodan kaldır/ }));
    await waitFor(() => expect(screen.queryByText("Tezgâh salonu")).toBeNull());
    expect(prefs.dashboard?.boxes).not.toContain("tezgah");
  });

  it("sıralama tercih sırasını izler", async () => {
    prefs = { dashboard: { donem: "bugun", boxes: ["tezgah", "egilim", "sevk", "uretim"] } };
    renderPano();
    await kpiUretim();
    expect(boxOrder()).toEqual(["sevk", "uretim", "tezgah", "egilim"]);
  });
});

describe("Pano — yeni kutular", () => {
  it("ajanda gün seçimi yalnız ajandayı ister (gun parametresiyle)", async () => {
    prefs = { dashboard: { donem: "bugun", boxes: ["uretim", "ajanda"] } };
    renderPano();
    await screen.findByText("IE-12");
    fireEvent.click(screen.getByRole("button", { name: /^03\.11\.2026/ }));
    await screen.findByText("IE-03");
    expect(requested()).toEqual([["uretim", "ajanda"], ["ajanda"]]);
    expect(fetchPanoBoxes.mock.calls[1]![0]).toMatchObject({ gun: "2026-11-03", ay: "2026-11" });
  });

  it("para birimleri toplanmaz: ciro ve alacak birim başına satır", async () => {
    prefs = { dashboard: { donem: "bugun", boxes: ["ciro", "finans"] } };
    renderPano();
    const ciroEl = await screen.findByTestId("pano-para-ciro");
    const ciro = within(ciroEl);
    expect(ciro.getByText("1000 TRY")).toBeTruthy();
    expect(ciro.getByText("50 USD")).toBeTruthy();
    expect(ciro.queryByText(/Toplam/i)).toBeNull();
    const alacak = within((await screen.findByText("Alacaklar")).closest("section")!);
    expect(alacak.getByText("TRY")).toBeTruthy();
    expect(alacak.getByText("USD")).toBeTruthy();
  });
});

describe("Pano — rozet, hedefler, kapılar", () => {
  it("degisimYuzde null → rozet yok; pozitif → yüzde ve kıyas metni", async () => {
    renderPano();
    await kpiUretim();
    const rozetler = document.querySelectorAll("[data-trend]");
    expect(rozetler).toHaveLength(1);
    expect(rozetler[0]!.textContent).toBe("%12,5 düne göre");
  });

  it("KPI tıklaması hedef ekrana gider; izin yoksa tıklanmaz", async () => {
    renderPano();
    fireEvent.click((await kpiUretim()).closest("button")!);
    expect(navigateActive).toHaveBeenCalledWith("/reports/quality/scorecard");
  });

  it("izin yoksa KPI düz metin, hızlı işlem kutusu yok", async () => {
    permissions = ["shipping:read", "report:sales"];
    renderPano();
    expect((await kpiUretim()).closest("button")).toBeNull();
    expect(screen.queryByText("Hızlı işlemler")).toBeNull();
  });

  it("pano uç izni yoksa katalog/kutu isteği atılmaz, dönem seçici yok", async () => {
    permissions = ["order:write"];
    renderPano();
    await screen.findByText("Hızlı işlemler");
    expect(fetchPanoCatalog).not.toHaveBeenCalled();
    expect(fetchPanoBoxes).not.toHaveBeenCalled();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("hareket satırı tıklanınca kaydın ekranına gider; cari ayrı satırda", async () => {
    renderPano();
    const satir = (await screen.findByText("IRS-1")).closest("button")!;
    expect(within(satir).getByText("Müşteri A")).toBeTruthy();
    fireEvent.click(satir);
    expect(navigateActive).toHaveBeenCalledWith("/operations/shipments/s1");
  });

  it("tezgâh yüzdesi izlenen tezgâh sayısıyla yazılır", async () => {
    renderPano();
    expect(await screen.findByText("İzlenen 1 tezgâhta çalışma %100")).toBeTruthy();
  });

  it("kutu isteği hata verirse kutu bazında tekrar dene", async () => {
    fetchPanoBoxes.mockRejectedValueOnce(new Error("ağ"));
    renderPano();
    const tekrar = await screen.findAllByRole("button", { name: "Tekrar dene" });
    expect(tekrar.length).toBeGreaterThan(0);
    fireEvent.click(tekrar[0]!);
    await kpiUretim();
  });
});

describe("movementTarget — yedi tür", () => {
  const cases: Array<[PanoHareket["hedef"], string]> = [
    [{ tur: "order", id: "o1" }, "/operations/orders?focus=o1"],
    [{ tur: "shipment", id: "s1" }, "/operations/shipments/s1"],
    [{ tur: "directShipment", id: "d1" }, "/operations/shipments/direct/d1"],
    [{ tur: "subcontractorDispatch", id: "f1", isEmriId: "w1" }, "/operations/work-orders/w1"],
    [{ tur: "subcontractorReceipt", id: "f2", isEmriId: null }, "/operations/fason-kokpiti"],
    [{ tur: "goodsReceipt", id: "g1" }, "/operations/goods-receipts?focus=g1"],
    [{ tur: "deliveryNote", id: "n1" }, "/operations/gelen-belgeler/n1"],
  ];
  it.each(cases)("%o → %s", (hedef, to) => {
    expect(movementTarget({ hedef }).to).toBe(to);
  });

  it("tercih yoksa / tanınmayan kayıt → varsayılan dönem hafta", async () => {
    const { validPeriod } = await import("./usePanoDonem");
    expect(validPeriod(undefined)).toBe("hafta");
    expect(validPeriod("ay")).toBe("ay");
  });
});
