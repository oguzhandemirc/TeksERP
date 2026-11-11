import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { PanoHareket, PanoKpi, PanoSummary } from "./types";

// =============================================================================
// AÇILIŞ PANOSU — davranış bekçisi: kapalı/izinsiz kutu (null) çizilmez, yüzde
// null → rozet yok, dönem değişimi yalnız /pano'yu yeniden ister, tıklama
// hedefleri izin + modül kapısından geçer, hareket satırı doğru ekrana gider.
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

vi.mock("@/store/auth", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: { username: "ayse" } }),
}));

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({
  useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive }),
}));

const setPreference = vi.fn();
vi.mock("@/providers/PreferencesProvider", () => ({
  // Dönem tercihi bileşen içi durumla taklit edilir; yazım ayrıca casus fonksiyona düşer.
  useOptionalPreferences: () => {
    const [donem, setDonem] = useState<string>("bugun");
    return {
      prefs: { dashboard: { donem } },
      setPreference: (fn: (cur: { dashboard?: { donem?: string } }) => { dashboard: { donem: string } }) => {
        const next = fn({ dashboard: { donem } });
        setPreference(next);
        setDonem(next.dashboard.donem);
      },
    };
  },
}));

vi.mock("@/components/insight/EChart", () => ({
  EChart: ({ label }: { label: string }) => <div data-testid="grafik">{label}</div>,
  withAlpha: (r: string) => r,
}));

const fetchPano = vi.fn();
const fetchPanoHareketler = vi.fn();
vi.mock("../dashboardService", () => ({
  fetchPano: (d: string) => fetchPano(d),
  fetchPanoHareketler: () => fetchPanoHareketler(),
  fetchStationLiveState: () => Promise.resolve([]),
}));

const { DashboardPage } = await import("../DashboardPage");
const { movementTarget } = await import("./pano-hedefler");

const k = (deger: number, degisimYuzde: number | null): PanoKpi => ({ deger, onceki: 0, degisimYuzde });

function ozet(over: Partial<PanoSummary> = {}): PanoSummary {
  return {
    donem: "bugun",
    aralik: { from: "", to: "" },
    oncekiAralik: { from: "", to: "" },
    olusturuldu: "",
    kpi: {
      uretim: { metre: k(1200, 12.5), top: k(30, 0) },
      sevk: { metre: k(800, null), irsaliye: k(4, null) },
      siparis: null,
      fason: null,
      stok: null,
    },
    egilim: { kova: "saat", noktalar: [{ anahtar: "9", uretimMetre: 10, sevkMetre: null }] },
    dagilim: null,
    enCok: { uretilen: null, sevkEdilen: null },
    tezgah: null,
    stokOzeti: null,
    fasonOzeti: null,
    emanet: null,
    bekleyen: { onayBekleyenBelge: null, sevkeHazir: null, uretimeGonderilmemisSiparis: null },
    finans: null,
    ...over,
  };
}

const hareket = (tur: PanoHareket["tur"], hedef: PanoHareket["hedef"], belgeNo: string): PanoHareket => ({
  tur, belgeNo, cari: "Müşteri A", miktar: 100, birim: "m", zaman: new Date().toISOString(), hedef,
});

/** "Üretim" eğilim toplamında da geçer; KPI şeridi DOM'da önce gelir. */
const kpiUretim = async () => (await screen.findAllByText("Üretim"))[0]!;

function renderPano() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DashboardPage /></QueryClientProvider>);
}

beforeEach(() => {
  permissions = ["admin:*"];
  regime = {};
  navigateActive.mockReset();
  setPreference.mockReset();
  fetchPano.mockReset();
  fetchPanoHareketler.mockReset();
  fetchPano.mockResolvedValue(ozet());
  fetchPanoHareketler.mockResolvedValue({ hareketler: [], turler: [] });
});

describe("Pano — null kutu çizilmez", () => {
  it("null KPI kartı ve null özet kutuları DOM'a girmez", async () => {
    renderPano();
    const seritEl = (await kpiUretim()).closest(".grid") as HTMLElement;
    const serit = within(seritEl);
    expect(serit.getByText("Sevk")).toBeTruthy();
    expect(serit.queryByText("Yeni sipariş")).toBeNull();
    expect(serit.queryByText("Fasona giden")).toBeNull();
    expect(serit.queryByText("Mamul stok")).toBeNull();
    expect(screen.queryByText("Alacaklar")).toBeNull();
    expect(screen.queryByText("Tezgâh")).toBeNull();
    expect(screen.queryByText(/Termin|Gecik/i)).toBeNull();
  });

  it("bütün KPI'lar null → KPI şeridi hiç yok; eğilim iki seri null → grafik yok", async () => {
    fetchPano.mockResolvedValue(ozet({
      kpi: { uretim: null, sevk: null, siparis: null, fason: null, stok: null },
      egilim: { kova: "saat", noktalar: [{ anahtar: "9", uretimMetre: null, sevkMetre: null }] },
    }));
    renderPano();
    await waitFor(() => expect(fetchPano).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("pano-kpi-iskelet")).toBeNull());
    expect(screen.queryByText("Üretim")).toBeNull();
    expect(screen.queryByTestId("grafik")).toBeNull();
  });

  it("alacak para birimi başına satır, toplam satırı yok", async () => {
    fetchPano.mockResolvedValue(ozet({
      finans: { alacaklar: [{ paraBirimi: "TRY", acikAlacak: 1000, vadesiGecmis: 0 }, { paraBirimi: "USD", acikAlacak: 50, vadesiGecmis: 10 }] },
    }));
    renderPano();
    const kutu = (await screen.findByText("Alacaklar")).closest("section")!;
    expect(within(kutu as HTMLElement).getByText("TRY")).toBeTruthy();
    expect(within(kutu as HTMLElement).getByText("USD")).toBeTruthy();
    expect(within(kutu as HTMLElement).queryByText(/Toplam/i)).toBeNull();
  });
});

describe("Pano — değişim rozeti", () => {
  it("degisimYuzde null → rozet yok; pozitif → yüzde ve kıyas metni", async () => {
    renderPano();
    await kpiUretim();
    // Rozet: renkli yüzde + gri kıyas; kesin pencere ipucunda.
    const rozetler = document.querySelectorAll("[data-trend]");
    // Sevk kartında yüzde rozeti yok (önceki dönem 0).
    expect(rozetler).toHaveLength(1);
    expect(rozetler[0]!.textContent).toBe("%12,5 düne göre");
    expect(rozetler[0]!.querySelector("[title]")?.getAttribute("title")).toBe("%12,5 düne göre");
  });
});

describe("Pano — dönem değişimi", () => {
  it("yalnız /pano yeni dönemle istenir, hareketler tekrar istenmez; tercih yazılır", async () => {
    renderPano();
    await kpiUretim();
    expect(fetchPano).toHaveBeenCalledTimes(1);
    expect(fetchPanoHareketler).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("radio", { name: "Hafta" }));
    await waitFor(() => expect(fetchPano).toHaveBeenLastCalledWith("hafta"));
    expect(fetchPano).toHaveBeenCalledTimes(2);
    expect(fetchPanoHareketler).toHaveBeenCalledTimes(1);
    expect(setPreference).toHaveBeenCalledWith({ dashboard: { donem: "hafta" } });
    await waitFor(() => expect(document.querySelector("[data-trend]")?.textContent).toBe("%12,5 önceki döneme göre"));
    expect(document.querySelector("[data-trend] [title]")?.getAttribute("title")).toBe("%12,5 önceki 7 güne göre");
  });
});

describe("Pano — tıklama hedefleri ve kapılar", () => {
  it("KPI tıklaması hedef ekrana gider", async () => {
    renderPano();
    fireEvent.click((await kpiUretim()).closest("button")!);
    expect(navigateActive).toHaveBeenCalledWith("/reports/quality/scorecard");
  });

  it("izin yoksa KPI tıklanmaz ve hızlı işlem kutusu çizilmez", async () => {
    permissions = ["shipping:read", "report:sales"];
    renderPano();
    const etiket = await kpiUretim();
    expect(etiket.closest("button")).toBeNull();
    expect(screen.queryByText("Hızlı işlemler")).toBeNull();
  });

  it("hızlı işlem yalnız izinli olanları gösterir", async () => {
    permissions = ["order:read", "order:write", "roll:read"];
    renderPano();
    const kutu = (await screen.findByText("Hızlı işlemler")).closest("section")!;
    expect(within(kutu).getByText("Yeni sipariş")).toBeTruthy();
    expect(within(kutu).getByText("Kumaş stoğu")).toBeTruthy();
    expect(within(kutu).queryByText("Mal kabul")).toBeNull();
    fireEvent.click(within(kutu).getByText("Yeni sipariş"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/orders?action=new");
  });

  it("izin var ama modül kapalı → o hızlı işlem gizlenir", async () => {
    permissions = ["order:write", "gelen-belge:read"];
    regime = { gelenBelgeEnabled: false };
    renderPano();
    const kutu = within((await screen.findByText("Hızlı işlemler")).closest("section")!);
    expect(kutu.getByText("Yeni sipariş")).toBeTruthy();
    expect(kutu.queryByText("Gelen belgeler")).toBeNull();
  });

  it("modül bayrakları yüklenmeden hiçbir hedef tıklanmaz", async () => {
    regime = { flagsReady: false };
    renderPano();
    expect((await kpiUretim()).closest("button")).toBeNull();
    expect(screen.queryByText("Hızlı işlemler")).toBeNull();
  });

  it("pano uç izni yoksa istek atılmaz ve dönem seçici çizilmez", async () => {
    permissions = ["workorder:read"];
    renderPano();
    await waitFor(() => expect(fetchPanoHareketler).toHaveBeenCalled());
    expect(fetchPano).not.toHaveBeenCalled();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("hareket satırı tıklanınca kaydın ekranına gider", async () => {
    fetchPanoHareketler.mockResolvedValue({
      hareketler: [hareket("SEVK", { tur: "shipment", id: "s1" }, "IRS-1")],
      turler: ["SEVK"],
    });
    renderPano();
    fireEvent.click((await screen.findByText("IRS-1")).closest("button")!);
    expect(navigateActive).toHaveBeenCalledWith("/operations/shipments/s1");
  });

  it("hareket hedefinin izni yoksa satır düz metindir", async () => {
    permissions = ["order:read", "report:sales"];
    fetchPanoHareketler.mockResolvedValue({
      hareketler: [hareket("SEVK", { tur: "shipment", id: "s1" }, "IRS-1")],
      turler: ["SEVK"],
    });
    renderPano();
    expect((await screen.findByText("IRS-1")).closest("button")).toBeNull();
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
});

describe("Pano — görsel cila sözleşmeleri", () => {
  it("tercih yoksa / tanınmayan kayıt → varsayılan dönem hafta", async () => {
    const { validPeriod } = await import("./usePanoDonem");
    expect(validPeriod(undefined)).toBe("hafta");
    expect(validPeriod("eski")).toBe("hafta");
    expect(validPeriod("ay")).toBe("ay");
  });

  it("tezgâh yüzdesi izlenen tezgâh sayısıyla yazılır (toplamın %100'ü sanılmasın)", async () => {
    fetchPano.mockResolvedValue(ozet({ tezgah: { toplam: 22, calisan: 1, duran: 0, izlenmeyen: 21, issiz: 21, suAnYuzde: 100 } }));
    renderPano();
    expect(await screen.findByText("İzlenen 1 tezgâhta çalışma %100")).toBeTruthy();
    expect(screen.queryByText(/Şu an çalışan/)).toBeNull();
  });

  it("boş dönemde eğilim grafiği iskelet olarak çizilir + kısa not", async () => {
    fetchPano.mockResolvedValue(ozet({ egilim: { kova: "saat", noktalar: [{ anahtar: "9", uretimMetre: 0, sevkMetre: 0 }] }, dagilim: { boyut: "kumas", dilimler: [] } }));
    renderPano();
    expect(await screen.findByText("Bu dönemde üretim ve sevk yok")).toBeTruthy();
    expect(screen.getByText("Üretim ve sevk eğilimi")).toBeTruthy();
    expect(screen.getByText("Üretilen kumaş dağılımı")).toBeTruthy();
    expect(screen.getByText(/Bu dönemde biten kumaş yok/)).toBeTruthy();
  });

  it("hareket satırında cari ayrı satırda tam metin olarak durur", async () => {
    fetchPanoHareketler.mockResolvedValue({ hareketler: [hareket("SIPARIS", { tur: "order", id: "o1" }, "SIP-1")], turler: ["SIPARIS"] });
    renderPano();
    const satir = (await screen.findByText("SIP-1")).closest("button")!;
    expect(within(satir).getByText("Müşteri A")).toBeTruthy();
  });

  it("uzun hızlı işlem adı simge altında kısalır, tam adı ipucunda kalır", async () => {
    permissions = ["workorder:write"];
    renderPano();
    const kutu = within((await screen.findByText("Hızlı işlemler")).closest("section")!);
    const dugme = kutu.getByRole("button");
    expect(dugme.getAttribute("title")).toMatch(/oluştur$/);
    expect(dugme.textContent).not.toMatch(/oluştur/);
  });
});
