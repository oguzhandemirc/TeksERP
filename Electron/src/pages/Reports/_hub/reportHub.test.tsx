// =============================================================================
// RAPOR MERKEZİ ANA SAYFASI (hedef görsel) — kategori kartı kapısı · süzgeç · boş durumlar · tıklama hedefi
// =============================================================================
// Kartlar ve liste görünürlüğü `centerGroups`tan okur (izin · yüzey · modül · rapor kapısı); burada
// ölçülen: kapalı kategori kart ÜRETMEZ, sayaç görünen rapor sayısıdır, kart SÜZMEZ (spot ışığı), açılır süzgeç daraltır,
// pano izni yokken analiz kutusu (ve isteği) yoktur, kişisel kutular yalnız görünen raporu çizer.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { isReportOpenWith } from "@/lib/report-gate";
import type { AppPreferences } from "@/types/preferences";
import type { PanoSummary } from "@/pages/Dashboard/pano/types";

let closed: string[] = [];
let perms: string[] = [];
let admin = false;
let prefs: Partial<AppPreferences> = {};
const setPreference = vi.fn();
const fetchPano = vi.fn();
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, machineStopEnabled: true,
  tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: true, gelenBelgeEnabled: false, emanetEnabled: false,
  financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true,
  reportsClosedKeys: closed, isReportOpen: (key: string) => isReportOpenWith(closed, key),
  reportsV2Enabled: true, flagsReady: true, flagsFailed: false,
});
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: admin,
    hasPermission: (c: string) => admin || perms.includes(c),
    hasAnyPermission: (cs: string[]) => admin || cs.some((c) => perms.includes(c)),
  }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs, setPreference, resetPreferences: vi.fn(), ready: true }),
  useOptionalPreferences: () => ({ prefs, setPreference, resetPreferences: vi.fn(), ready: true }),
}));
// Pano kutu uçları sekme defteri üzerinden modül grafiğine girer; bu testte çağrılmaz.
vi.mock("@/pages/Dashboard/dashboardService", () => ({ fetchPano: (d: string) => fetchPano(d), fetchPanoBoxes: vi.fn(), fetchPanoCatalog: vi.fn() }));
vi.mock("../_v2/custom/custom-api", async (orig) => ({
  ...(await orig<typeof import("../_v2/custom/custom-api")>()),
  useCustomReportList: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));
vi.mock("@/components/insight/EChart", () => ({
  EChart: ({ label }: { label: string }) => <div data-testid="chart">{label}</div>,
  withAlpha: (c: string) => c,
}));

import { ReportCenterPage } from "../_v2/ReportCenterPage";
import { narrowGroups, personasIn, visibleGroups } from "./hub-model";
import { SPOTLIGHT_DEFAULT_MS } from "@/components/insight/useSpotlight";

const READY = REPORT_CATALOG.filter((e) => e.kategoriV2 !== null && (e.nesil === "v1" || e.hazir));
const inCategory = (k: string) => READY.filter((e) => e.kategoriV2 === k);
const render = () => renderWithProviders(<ReportCenterPage legacyTiles={[]} />);
const categoryCards = () => within(screen.getByRole("group", { name: "Kategoriler" }));

const summary = (): PanoSummary => ({
  donem: "ay", aralik: { from: "", to: "" }, oncekiAralik: { from: "", to: "" }, olusturuldu: "",
  kpi: { uretim: { metre: { deger: 1200, onceki: 1000, degisimYuzde: 20 }, top: { deger: 30, onceki: 25, degisimYuzde: 20 } }, sevk: null, siparis: null, fason: null, stok: null },
  egilim: { kova: "gun", noktalar: [{ anahtar: "2026-11-10", uretimMetre: 500, sevkMetre: null }, { anahtar: "2026-11-11", uretimMetre: 700, sevkMetre: null }] },
  dagilim: { boyut: "kumas", dilimler: [{ itemId: "k1", ad: "Tül A", metre: 1200, yuzde: 100 }] },
  enCok: { uretilen: null, sevkEdilen: null }, tezgah: null, stokOzeti: null, fasonOzeti: null, emanet: null,
  bekleyen: { onayBekleyenBelge: null, sevkeHazir: null, uretimeGonderilmemisSiparis: null }, finans: null,
});

beforeEach(() => {
  closed = [];
  perms = [];
  admin = true;
  prefs = {};
  setPreference.mockReset();
  fetchPano.mockReset();
  fetchPano.mockResolvedValue(summary());
});

describe("kategori kartları — kapı ve sayaç", () => {
  it("her görünür kategori bir kart; sayaç görünen rapor sayısı", () => {
    render();
    const dokuma = inCategory("dokuma");
    expect(categoryCards().getByRole("button", { name: new RegExp(`Dokuma.*${dokuma.length} rapor`) })).toBeInTheDocument();
  });

  it("izni olmayan kategori kart üretmez (muhasebe araçları yalnız report:finance)", () => {
    admin = false;
    perms = ["report:production"];
    render();
    expect(categoryCards().queryByRole("button", { name: /Muhasebe araçları/ })).toBeNull();
    expect(categoryCards().getByRole("button", { name: /Dokuma/ })).toBeInTheDocument();
  });

  it("bütün raporları kapalı kategori kart üretmez", () => {
    closed = inCategory("dokuma").map((e) => e.key);
    render();
    expect(categoryCards().queryByRole("button", { name: /Dokuma/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Dokuma" })).toBeNull();
  });
});

describe("süzgeç", () => {
  it("⭐ kategori kartı SÜZMEZ: bölüm vurgulanır, diğerleri solar, kart seçili; süre dolunca normal", () => {
    vi.useFakeTimers();
    try {
      Element.prototype.scrollIntoView = vi.fn();
      render();
      const card = categoryCards().getByRole("button", { name: /Dokuma/ });
      fireEvent.click(card);
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("region", { name: "Dokuma" })).toHaveAttribute("data-spotlight", "lit");
      expect(screen.getByRole("region", { name: "Muhasebe araçları" })).toHaveAttribute("data-spotlight", "dim");
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent(/Dokuma bölümü vurgulandı/);
      // Açılır süzgeç kart tıklamasından etkilenmez.
      expect(screen.getByRole("button", { name: /Sıfırla/ })).toBeDisabled();
      act(() => {
        vi.advanceTimersByTime(SPOTLIGHT_DEFAULT_MS);
      });
      expect(card).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("region", { name: "Dokuma" })).not.toHaveAttribute("data-spotlight");
    } finally {
      vi.useRealTimers();
    }
  });

  it("açılır kategori süzgeci gerçek süzgeçtir; süzülmüş kategorinin kartı ışık yakmaz, neden duyurulur", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render();
    fireEvent.keyDown(screen.getByRole("button", { name: /^Kategori:/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Dokuma" }));
    expect(screen.getByRole("region", { name: "Dokuma" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Muhasebe araçları" })).toBeNull();
    fireEvent.click(categoryCards().getByRole("button", { name: /Muhasebe araçları/ }));
    expect(screen.getByRole("region", { name: "Dokuma" })).not.toHaveAttribute("data-spotlight");
    expect(screen.getByRole("status")).toHaveTextContent(/Muhasebe araçları raporları seçili süzgeçle gizli/);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Sıfırla/ }));
    expect(screen.getByRole("region", { name: "Muhasebe araçları" })).toBeInTheDocument();
  });

  it("arama eşleşmeyince süzgeç cümlesi; Sıfırla pasifken basılamaz", () => {
    render();
    expect(screen.getByRole("button", { name: /Sıfırla/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Rapor ara"), { target: { value: "zzzyok" } });
    expect(screen.getByText(/“zzzyok” ile eşleşen rapor yok/)).toBeInTheDocument();
  });

  it("model: persona + arama kategori sayacını da daraltır; kategori yalnız listeyi", () => {
    const groups = [{ key: "dokuma" as const, title: "Dokuma", entries: inCategory("dokuma") }, { key: "para" as const, title: "Para", entries: inCategory("para") }];
    const inc = (h: string, n: string) => h.toLowerCase().includes(n.toLowerCase());
    expect(personasIn(groups)).toContain("dokuma");
    const narrowed = narrowGroups(groups, { category: null, persona: "dokuma", term: "" }, inc);
    expect(narrowed.find((g) => g.key === "para")?.entries).toHaveLength(0);
    expect(visibleGroups(groups, { category: "para", persona: null, term: "" }, inc).map((g) => g.key)).toEqual(["para"]);
  });
});

describe("analiz kutuları ve kişisel kutular", () => {
  it("pano izni yoksa analiz kutusu ve istek yok; boş kişisel kutular yönlendirir", () => {
    admin = false;
    // report:customer pano ucunun izin kümesinde (PANO_UC_IZINLERI) yok; report:production artık var.
    perms = ["report:customer"];
    render();
    expect(fetchPano).not.toHaveBeenCalled();
    expect(screen.queryByText("Üretim ve sevk eğilimi")).toBeNull();
    expect(screen.getByText(/Açtığınız raporlar burada/)).toBeInTheDocument();
    expect(screen.getByText(/yıldıza basarak favorilere ekleyin/)).toBeInTheDocument();
  });

  it("pano verisi: eğilim, kumaş halkası ve öne çıkan sayı çizilir", async () => {
    render();
    const metrics = await screen.findByRole("list", { name: "Öne çıkan sayılar" });
    expect(screen.getAllByTestId("chart").map((c) => c.textContent)).toEqual(["Üretim ve sevk eğilimi", "Üretilen kumaş dağılımı"]);
    expect(within(metrics).getByText("Üretim")).toBeInTheDocument();
    expect(fetchPano).toHaveBeenCalledWith("ay");
  });

  it("son açtıklarım yalnız görünen raporu, kendi adresine bağlı listeler; sık açılan sayaç gerçektir", () => {
    const [a, b] = inCategory("dokuma");
    closed = [b!.key];
    prefs = { raporlar: { opened: [{ key: a!.key, count: 3, lastAt: "2026-11-11T08:00:00.000Z" }, { key: b!.key, count: 9, lastAt: "2026-11-11T09:00:00.000Z" }] } };
    render();
    const recent = screen.getByRole("list", { name: "Son açtıklarım" });
    expect(within(recent).getByRole("link", { name: new RegExp(a!.baslik.replace(/[?()]/g, ".")) })).toHaveAttribute("href", `/${a!.panelYolu}`);
    expect(within(recent).getAllByRole("listitem")).toHaveLength(1);
    expect(within(screen.getByRole("list", { name: "Sık açtıklarım" })).getByText(/3 kez açtınız/)).toBeInTheDocument();
  });

  it("⭐ tercihte kalan EMEKLİ ya da artık olmayan rapor anahtarı son açılan/favoride sessizce düşer", () => {
    const [a] = inCategory("dokuma");
    const retired = REPORT_CATALOG.find((e) => e.emekli === true)!;
    const gone = "dokuma/olmayan-eski-rapor";
    prefs = {
      raporlar: {
        favoriler: [retired.key, gone, a!.key],
        opened: [
          { key: retired.key, count: 7, lastAt: "2026-11-11T10:00:00.000Z" },
          { key: gone, count: 5, lastAt: "2026-11-11T09:30:00.000Z" },
          { key: a!.key, count: 2, lastAt: "2026-11-11T08:00:00.000Z" },
        ],
      },
    };
    render();
    expect(within(screen.getByRole("list", { name: "Son açtıklarım" })).getAllByRole("listitem")).toHaveLength(1);
    const favs = within(screen.getByRole("region", { name: "Favorilerim" }));
    expect(favs.getAllByRole("listitem")).toHaveLength(1);
    expect(favs.queryByText(retired.baslik)).not.toBeInTheDocument();
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("yıldız favoriyi değiştirir (tercihe yazar)", () => {
    render();
    const list = screen.getByRole("region", { name: "Muhasebe araçları" });
    fireEvent.click(within(list).getAllByRole("button", { name: /favorilere ekle/ })[0]!);
    expect(setPreference).toHaveBeenCalledTimes(1);
  });

  it("Özel rapor düğmesi yalnız report:builder ile ve kurucuya gider", () => {
    admin = false;
    perms = ["report:production"];
    const a = render();
    expect(screen.queryByRole("link", { name: /Özel rapor/ })).toBeNull();
    a.unmount();
    perms = ["report:production", "report:builder"];
    render();
    expect(screen.getByRole("link", { name: /Özel rapor/ })).toHaveAttribute("href", "/reports/ozel/yeni");
  });
});

describe("dönem çipi", () => {
  it("dönem değişince pano o dönemle istenir", async () => {
    render();
    await waitFor(() => expect(fetchPano).toHaveBeenCalledWith("ay"));
    const chip = within(screen.getByRole("toolbar", { name: "Süzgeçler" })).getByRole("button", { name: /Dönem/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Son 7 gün" }));
    await waitFor(() => expect(fetchPano).toHaveBeenCalledWith("hafta"));
  });
});
