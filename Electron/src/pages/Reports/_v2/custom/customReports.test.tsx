// =============================================================================
// Özel raporlar (R1-KAYIT) — panel: bayrak kapısı, izin görünürlüğü, gövde kurucu, sonuç biçimi
// =============================================================================
// §1 bayrak kapalı: Rapor Merkezi çizilmez → özel rapor bölümü YOK, `/api/rapor-tanimlari` çağrılmaz;
// palet girişi görünmez · §2 izin: `report:builder` yoksa "Yeni özel rapor" düğmesi yok, boş liste bölüm
// çizmez · §3 gövde kurucu: küp/ölçü/kırılım/süzgeç/kıyas → tanım gövdesi, geri okuma · §4 sonuç biçimi:
// kıyas istemcide HESAPLANMAZ (önceki dönem ham toplam), tablo/grafik yalnız biçim dönüşümü.
//
// Negatif sonda (2026-10-25, md5 ile geri alındı; taban 11/0): palet girişinin bayrak yüklemi gevşetildi
// → §1 ❌ 1 · bölümde `report:builder` denetimi kaldırıldı → §2 ❌ 2.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

let v2: boolean | undefined;
let perms: string[] = [];
let lists: Record<string, unknown[]> = { benim: [], paylasilan: [] };
const getMock = vi.fn((url: string, cfg?: { params?: { kapsam?: string } }) =>
  Promise.resolve({ data: { success: true, data: url === "/api/rapor-tanimlari" ? { items: lists[cfg?.params?.kapsam ?? ""] ?? [] } : [] } }),
);
vi.mock("@/services/apiClient", () => ({ default: { get: (u: string, c?: never) => getMock(u, c), post: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false,
  financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true,
  reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false,
  ...(v2 === undefined ? {} : { reportsV2Enabled: v2 }),
});
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: (c: string) => perms.includes(c) }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: {}, setPreference: vi.fn(), resetPreferences: vi.fn(), ready: true }) }));

import { ReportsHubPage } from "../../ReportsHubPage";
import { allCommandEntries } from "@/components/layout/command-entries";
import { CustomReportsSection } from "./CustomReportsSection";
import { allowedDimensions, EMPTY_BUILDER, fromBody, toBody } from "./builder-model";
import { chartOf, headlineOf, tableOf } from "./result-model";
import type { CatalogCube, SemanticResultLite } from "./custom-api";

const summary = (id: string, ad: string) => ({
  id, tur: "OZEL", ad, aciklama: null, kategori: { id: "k", ad: "Kayıtlı raporlar", kod: "kayitli" }, sahip: { id: "u", ad: "Ayşe" },
  gorunurluk: "OZEL", durum: "YAYINDA", aktifSurum: { id: "v", no: 1, tarih: "" }, bozuk: false, duzenleyebilir: true, guncellendi: "",
});

beforeEach(() => {
  v2 = undefined;
  perms = ["report:sales"];
  lists = { benim: [], paylasilan: [] };
  getMock.mockClear();
});

describe("§1 bayrak kapısı", () => {
  it("⭐ bayrak kapalı: özel rapor bölümü yok, tanım ucu çağrılmaz; palet girişi görünmez", () => {
    perms = ["report:sales", "report:builder"];
    v2 = false;
    renderWithProviders(<ReportsHubPage />);
    expect(screen.queryByText("Özel raporlarım")).toBeNull();
    expect(getMock.mock.calls.some(([u]) => String(u).startsWith("/api/rapor-tanimlari"))).toBe(false);
    const entry = allCommandEntries.find((e) => e.key === "report-custom:new")!;
    expect(entry.permission).toBe("report:builder");
    expect(entry.visibleWhen!({ ...ctx(), reportsV2Enabled: undefined })).toBe(false);
    expect(entry.visibleWhen!({ ...ctx(), reportsV2Enabled: true })).toBe(true);
  });

  it("bayrak açık: Rapor Merkezi'nde 'Özel raporlarım' bölümü çizilir", async () => {
    perms = ["report:sales", "report:builder"];
    v2 = true;
    renderWithProviders(<ReportsHubPage />);
    expect(await screen.findByRole("region", { name: "Özel raporlarım" })).toBeInTheDocument();
  });
});

describe("§2 izin görünürlüğü", () => {
  it("⭐ report:builder yok ve görecek rapor yok → bölüm çizilmez", async () => {
    const r = renderWithProviders(<CustomReportsSection term="" />);
    // benim + paylasilan + sistem (R3-ANALIZ hazır şablonlar)
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(r.container.innerHTML).toBe(""));
  });
  it("report:builder yok ama paylaşılan rapor var → liste görünür, 'Yeni özel rapor' YOK", async () => {
    lists = { benim: [], paylasilan: [summary("p1", "Paylaşılan sevk")] };
    renderWithProviders(<CustomReportsSection term="" />);
    expect(await screen.findByText("Paylaşılan sevk")).toBeInTheDocument();
    expect(screen.getByText("Paylaşan: Ayşe")).toBeInTheDocument();
    expect(screen.queryByText("Yeni özel rapor")).toBeNull();
  });
  it("report:builder var → boş durumda bile düğme ve açıklama görünür", async () => {
    perms = ["report:builder"];
    renderWithProviders(<CustomReportsSection term="" />);
    expect(await screen.findByText(/Henüz özel raporunuz yok/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Yeni özel rapor/ })).toHaveAttribute("href", "/reports/ozel/yeni");
  });
});

const cube: CatalogCube = {
  kimlik: "sevk", ad: "Sevkiyat",
  olculer: [{ kimlik: "sevk.brutMetre", ad: "Brüt metre", aciklama: "", birim: "m", boyutlar: null }, { kimlik: "sevk.adet", ad: "Sevk sayısı", aciklama: "", birim: "adet", boyutlar: ["musteri"] }],
  boyutlar: [{ kimlik: "musteri", ad: "Müşteri", tur: "kategori", islecler: ["in"] }, { kimlik: "urun", ad: "Ürün", tur: "kategori", islecler: ["in"] }],
};

describe("§3 gövde kurucu", () => {
  it("küp + iki ölçü + kırılım + süzgeç + kıyas → ana sayı, grafik ve tablo blokları; geri okunur", () => {
    const state = { ...EMPTY_BUILDER, title: "Müşteriye göre sevk", cube: "sevk", measures: ["sevk.brutMetre", "sevk.adet"], dimensions: ["musteri"], filters: [{ boyut: "urun", degerler: [{ deger: "u1", etiket: "Poplin" }] }] };
    const body = toBody(state) as { bloklar: Array<{ tur: string; sorgu: { olculer: string[]; boyutlar: string[]; zaman: { kiyas?: string }; suzgec?: unknown } }>; parametreler: unknown[] };
    expect(body.bloklar.map((b) => b.tur)).toEqual(["anaSayi", "grafik", "tablo"]);
    expect(body.bloklar[0]!.sorgu.olculer).toEqual(["sevk.brutMetre"]);
    expect(body.bloklar[0]!.sorgu.zaman.kiyas).toBe("$kiyas");
    expect(body.bloklar[2]!.sorgu.boyutlar).toEqual(["musteri"]);
    expect(body.bloklar[2]!.sorgu.suzgec).toEqual({ combinator: "and", rules: [{ field: "urun", operator: "in", value: ["u1"] }] });
    const back = fromBody(body, (_d, v) => (v === "u1" ? "Poplin" : v))!;
    expect(back).toEqual({ ...state, view: "cubuk" });
  });
  it("kırılım yoksa yalnız ana sayı; kod modunun zengin gövdesi oluşturucuya açılmaz (null)", () => {
    expect((toBody({ ...EMPTY_BUILDER, cube: "sevk", measures: ["sevk.brutMetre"] }) as { bloklar: unknown[] }).bloklar).toHaveLength(1);
    expect(fromBody({ baslik: "x", bloklar: [{ tur: "anlati" }, { tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["a"] } }] })).toBeNull();
  });
  it("kırılım seçeneği seçili TÜM ölçülerin izin verdiği boyutlardır", () => {
    expect(allowedDimensions(cube, ["sevk.brutMetre"]).map((d) => d.kimlik)).toEqual(["musteri", "urun"]);
    expect(allowedDimensions(cube, ["sevk.brutMetre", "sevk.adet"]).map((d) => d.kimlik)).toEqual(["musteri"]);
  });
});

describe("§4 sonuç biçimi", () => {
  const result: SemanticResultLite = {
    olculer: [{ kimlik: "sevk.brutMetre", ad: "Brüt metre", birim: "m" }],
    boyutlar: [{ kimlik: "musteri", ad: "Müşteri" }],
    satirlar: [{ anahtarlar: { musteri: { deger: "c1", etiket: "Akın Tekstil" } }, degerler: { "sevk.brutMetre": 1200 } }],
    toplam: { degerler: { "sevk.brutMetre": 1200 } },
    kiyas: { toplam: { degerler: { "sevk.brutMetre": 1000 } } },
    uyarilar: [],
  };
  it("⭐ kıyas yüzdesi istemcide üretilmez: ana sayının `kiyas`ı yok, önceki dönem ham toplam", () => {
    const h = headlineOf(result)!;
    expect(h.figure.kiyas).toBeUndefined();
    expect(h.figure.deger).toBe(1200);
    expect(h.previous).toBe(1000);
  });
  it("ölçülemeyen toplam 0'a çökmez", () => {
    const h = headlineOf({ ...result, toplam: { degerler: {} } })!;
    expect(h.figure.deger).toBeNull();
    expect(h.figure.olculemedi).toBeTruthy();
  });
  it("tablo ve grafik yalnız biçim dönüşümü (etiket + değer, toplam satırı sunucunun toplamı)", () => {
    const t = tableOf(result);
    expect(t.satirlar).toEqual([{ "b:musteri": "Akın Tekstil", "o:sevk.brutMetre": 1200 }]);
    expect(t.toplam).toEqual({ "b:musteri": "Toplam", "o:sevk.brutMetre": 1200 });
    const c = chartOf(result, "pasta")!;
    expect(c.tur).toBe("pasta");
    expect(c.kategoriler).toEqual(["Akın Tekstil"]);
    expect(c.seriler[0]!.veri).toEqual([1200]);
  });
});
