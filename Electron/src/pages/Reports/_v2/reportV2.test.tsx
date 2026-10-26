// =============================================================================
// RAPORLAR v2 ŞABLONU + RAPOR MERKEZİ (R0-SABLON) — bayrak, çizim kümesi, "Tümü", ölçülemedi
// =============================================================================
// §1 bayrak kapalı → hub bugünkü hâli (başlık + karo listesi ölçülür; `undefined` ile `false`
//    DOM'u bayt eşit) · §2 açık → Merkez · §3 izinsiz / modülü kapalı / `hazir:false` / kapalı
//    rapor çizilmez · §4 "Tümü" seçiliyken istekte anahtar YOK · §5 `olculemedi` ana sayı "0"
//    basmaz · §6 palet: bayrak kapalıyken görünen giriş kümesi aynı · §7 yaprak kapısı ·
//    §8 hata sınıfları ayrı mesaj · §9 dışa aktarım ekranla aynı metin.
//
// Negatif sonda (2026-10-24, geri alındı): `center-model.ts`ten `isReportSurfaced` çağrısı
// kaldırıldı → ❌ 5 (§2 Merkez · §3 körlük zemini + hazir:false · §6 palet · §7 yaprak kapısı),
// 12 yeşil; md5 ile geri alındı, 17/0. §4b K-KIYAS: beyan yoksa kıyas çipi yok.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { REPORT_BY_KEY, REPORT_CATALOG, type ReportCatalogEntry, type ReportCatalogEntryV2 } from "@/lib/report-catalog";
import { isReportOpenWith } from "@/lib/report-gate";

let closed: string[] | null = [];
let v2: boolean | undefined;
let flags: Partial<OperationsVisibilityContext> = {};
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false,
  depoMultiEnabled: false,
  devereEnabled: true,
  dokumaEnabled: true,
  tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: true,
  financeEnabled: true,
  productionEnabled: true,
  ticaretEnabled: true,
  iplikEnabled: true,
  reportsClosedKeys: closed,
  isReportOpen: (key: string) => isReportOpenWith(closed, key),
  ...(v2 === undefined ? {} : { reportsV2Enabled: v2 }),
  flagsReady: true,
  flagsFailed: false,
  ...flags,
});
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: { raporlar: { favoriler: ["finance/cash-book"] } }, setPreference: vi.fn(), resetPreferences: vi.fn(), ready: true }),
}));

import { ReportsHubPage } from "../ReportsHubPage";
import { reportTiles } from "../tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { centerGroups, isCenterEntryOpen, type CenterAccess } from "./center-model";
import { HeadlineCard } from "./HeadlineCard";
import { ParamChips } from "./ParamChips";
import { buildReportRequest } from "./request-params";
import { ReportV2Route } from "./ReportV2Route";
import { FAILURE_TEXT, ReportFailureState } from "./ReportStates";
import { failureOf } from "./useReportV2";
import { buildExportSpec } from "./export-spec";
import { NarrativeBox } from "./NarrativeBox";
import { ANLATI_EKRAN_SAYISI, ANLATI_PDF_SAYISI, type AnaSayi, type RaporSunumu } from "./sunum";

const V2_ROWS = REPORT_CATALOG.filter((e): e is ReportCatalogEntryV2 => e.nesil === "v2");
/** Ucu inmiş gibi: aynı satır `hazir:true` (katalogun kendisine dokunulmaz). */
const ready = (key: string): ReportCatalogEntryV2 => ({ ...(REPORT_BY_KEY.get(key) as ReportCatalogEntryV2), hazir: true });
const access = (over: Partial<CenterAccess> = {}): CenterAccess => ({ isAdmin: false, hasPermission: () => true, ctx: ctx(), ...over });

beforeEach(() => {
  closed = [];
  v2 = undefined;
  flags = {};
});

describe("§1–§2 bayrak okuyucusu — ReportsHubPage", () => {
  it("§1 ⭐ bayrak kapalı: bugünkü hub (başlık + karo listesi); `undefined` ve `false` DOM'u bayt eşit", () => {
    v2 = undefined;
    const a = renderWithProviders(<ReportsHubPage />);
    const htmlUndefined = a.container.innerHTML;
    expect(screen.getByRole("heading", { name: "Raporlar" })).toBeInTheDocument();
    expect(screen.queryByText("Rapor Merkezi")).toBeNull();
    // Bütün bayraklar açık + admin: on kategori karosu (MAL-7 Maliyet), sırası tile-config'in sırası.
    const titles = reportTiles.map((t) => t.title);
    expect(titles).toHaveLength(10);
    for (const t of titles) expect(screen.getByText(t)).toBeInTheDocument();
    a.unmount();
    v2 = false;
    const b = renderWithProviders(<ReportsHubPage />);
    expect(b.container.innerHTML).toBe(htmlUndefined);
  });

  it("§2 bayrak açık: Rapor Merkezi; muhasebe araçları + favori + eski raporlar yer tutucusu", () => {
    v2 = true;
    renderWithProviders(<ReportsHubPage />);
    expect(screen.getByRole("heading", { name: "Rapor Merkezi" })).toBeInTheDocument();
    const tools = screen.getByRole("region", { name: "Muhasebe araçları" });
    expect(within(tools).getAllByRole("link")).toHaveLength(3);
    const fav = screen.getByRole("region", { name: "Favorilerim" });
    expect(within(fav).getByText("Kasa & Banka Defteri")).toBeInTheDocument();
    const legacy = screen.getByRole("region", { name: "Eski raporlar (geçiş dönemi)" });
    // R0-GECIS: yer tutucu yerine 36 v1 rapor, eski hub'ın kategorileriyle (`legacy-model.ts`).
    expect(within(legacy).getAllByRole("listitem")).toHaveLength(36);
    // Maliyet kategorisinin v1 raporu yok (MAL-7 yalnız v2) → eski raporlar grubu da yok.
    expect(within(legacy).getAllByRole("group")).toHaveLength(reportTiles.length - 1);
    // `hazir:true` satır Merkez'de çizilir, `hazir:false` çizilmez (ilk hazır satır KQ-D6 kurşun gramajı).
    const readyRows = V2_ROWS.filter((e) => e.hazir);
    expect(readyRows.length, "körlük zemini: hazır v2 satırı yok").toBeGreaterThan(0);
    for (const e of V2_ROWS) {
      if (e.hazir) expect(screen.getAllByText(e.baslik).length).toBeGreaterThan(0);
      else expect(screen.queryByText(e.baslik)).toBeNull();
    }
  });
});

describe("§3 çizim kümesi — centerGroups / isCenterEntryOpen", () => {
  const catalog: ReportCatalogEntry[] = [ready("sales/termin"), ready("quality/kalite"), ready("dokuma/levent-dengesi"), REPORT_BY_KEY.get("quality/kayip")!];
  const keys = (a: CenterAccess) => centerGroups(a, catalog).flatMap((g) => g.entries.map((e) => e.key));

  it("körlük zemini: tam erişimde hazır üç satır çizilir", () => {
    expect(keys(access())).toEqual(["sales/termin", "quality/kalite", "dokuma/levent-dengesi"]);
  });
  it("⭐ `hazir:false` satır çizilmez", () => {
    expect(keys(access())).not.toContain("quality/kayip");
    expect(isCenterEntryOpen(REPORT_BY_KEY.get("quality/kayip")!, ctx())).toBe(false);
  });
  it("⭐ izinsiz rapor çizilmez (admin değil, izin yok)", () => {
    expect(keys(access({ hasPermission: (c) => c !== "report:sales" }))).not.toContain("sales/termin");
  });
  it("⭐ modülü kapalı rapor çizilmez (üretim kapalı → kalite; devere kapalı → levent)", () => {
    flags = { productionEnabled: false };
    expect(keys(access())).not.toContain("quality/kalite");
    flags = { devereEnabled: false };
    expect(keys(access())).not.toContain("dokuma/levent-dengesi");
  });
  it("⭐ rapor kapısı kapalı (closedKeys) ya da liste okunamadı → çizilmez", () => {
    closed = ["sales/termin"];
    expect(keys(access())).not.toContain("sales/termin");
    closed = null;
    expect(keys(access())).toEqual([]);
  });
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="search">{loc.search}</output>;
}

describe("§4 parametre çipi — \"Tümü\" = anahtar GÖNDERİLMEZ", () => {
  const entry = REPORT_BY_KEY.get("sales/termin")!;
  it("⭐ Tümü seçilince URL'den ve istekten anahtar düşer; seçim varken gider", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/reports/sales/termin?dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-24T20:59:59.999Z&customerId=c1"]}>
          <ParamChips
            entry={entry}
            params={[{ ad: "customerId", etiket: "Müşteri", tur: "cokluSecim", deger: ["c1"], secenekler: [{ deger: "c1", etiket: "Kaya Tekstil" }, { deger: "c2", etiket: "Ak Örme" }] }]}
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const before = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(buildReportRequest(entry, before).customerId).toBe("c1");
    fireEvent.click(screen.getByRole("button", { name: /Müşteri:\s*Kaya Tekstil/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("option", { name: "Tümü" }));
    const after = new URLSearchParams(screen.getByTestId("search").textContent ?? "");
    expect(after.has("customerId")).toBe(false);
    const req = buildReportRequest(entry, after);
    expect("customerId" in req).toBe(false);
    expect(Object.keys(req).sort()).toEqual(["dateFrom", "dateTo"]);
  });

  it("boş değer gönderilmez; kıyas varsayılanını istemci EKLEMEZ (K-KIYAS); seçilen kıyas aynen gider", () => {
    expect(buildReportRequest(entry, new URLSearchParams("dateFrom=a&dateTo=b&customerId="))).toEqual({ dateFrom: "a", dateTo: "b" });
    expect(buildReportRequest(entry, new URLSearchParams("dateFrom=a&dateTo=b&kiyas=prevYear"))).toEqual({ dateFrom: "a", dateTo: "b", kiyas: "prevYear" });
    const asOf = buildReportRequest(REPORT_BY_KEY.get("finance/alacaklar")!, new URLSearchParams("asOf=2026-10-01"));
    expect(Object.keys(asOf)).toEqual(["asOf"]);
  });
});

describe("§4b kıyas çipi — sunucu beyanından çizilir (K-KIYAS)", () => {
  const entry = REPORT_BY_KEY.get("sales/termin")!;
  const renderChips = (params: Parameters<typeof ParamChips>[0]["params"]) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/reports/sales/termin?dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-24T20:59:59.999Z"]}>
          <ParamChips entry={entry} params={params} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("⭐ beyan yok → kıyas çipi YOK (istemci 'önceki dönem' yazmaz)", () => {
    renderChips([]);
    expect(screen.queryByRole("button", { name: /Kıyas:/ })).toBeNull();
  });

  it("beyan var → çip sunucunun uyguladığı değeri gösterir, 'Tümü' seçeneği taşımaz", () => {
    renderChips([
      { ad: "kiyas", etiket: "Kıyas", tur: "secim", deger: "prev", secenekler: [{ deger: "prev", etiket: "Önceki dönem" }, { deger: "none", etiket: "Kıyas yok" }] },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Kıyas:\s*Önceki dönem/ }));
    expect(within(screen.getByRole("dialog")).queryByRole("option", { name: "Tümü" })).toBeNull();
  });
});

const measured = (over: Partial<AnaSayi> = {}): AnaSayi => ({ olcu: "termin.zamanindaYuzde", ad: "Zamanında teslim", deger: 78, birim: "yuzde", ...over });

describe("§5 ana sayı — ölçülemedi 0 basmaz", () => {
  it("⭐ deger null + olculemedi → 'Ölçülemedi' ve neden; hiçbir yerde '0' yok", () => {
    renderWithProviders(
      <HeadlineCard
        headline={measured({ deger: null, olculemedi: "Termini olan sipariş yok", kiyas: { deger: null, fark: null, yuzde: null, yon: null, durum: "notr" } })}
        sideFigures={[measured({ olcu: "x", ad: "Geciken sipariş", deger: null, birim: "siparis" })]}
      />,
    );
    expect(screen.getByTestId("headline-value")).toHaveTextContent("Ölçülemedi");
    expect(screen.getByText("Termini olan sipariş yok")).toBeInTheDocument();
    expect(screen.getByTestId("headline-compare")).toHaveTextContent("Kıyas yapılamadı");
    expect(document.body.textContent).not.toMatch(/(^|[^\d])0([^\d,.]|$)/);
  });
  it("ölçülen oran: '%78' ve puan farkı, renk sunucunun durumundan", () => {
    renderWithProviders(
      <HeadlineCard
        headline={measured({ kiyas: { deger: 84, fark: -6, yuzde: -7.1, yon: "azaldi", durum: "kotu" } })}
        sideFigures={[]}
        comparisonLabel="Eylül 2026"
      />,
    );
    expect(screen.getByTestId("headline-value")).toHaveTextContent("%78");
    const c = screen.getByTestId("headline-compare");
    expect(c).toHaveTextContent("▼ 6 puan (Eylül 2026: %84)");
    expect(c.className).toContain("text-red-600");
  });
});

describe("§6 palet — bayrak kapalıyken görünen küme aynı", () => {
  const visibleKeys = () => allCommandEntries.filter((e) => !e.visibleWhen || e.visibleWhen(ctx())).map((e) => e.key);
  it("⭐ undefined ve false aynı; hiçbir v2 girişi görünmez; v2 girişleri satırın iznini taşır", () => {
    v2 = undefined;
    const a = visibleKeys();
    v2 = false;
    expect(visibleKeys()).toEqual(a);
    expect(a.some((k) => k.startsWith("report-v2:"))).toBe(false);
    const v2Entries = allCommandEntries.filter((e) => e.key.startsWith("report-v2:"));
    expect(v2Entries).toHaveLength(V2_ROWS.length);
    for (const e of v2Entries) expect(e.permission).toBe(REPORT_BY_KEY.get(e.key.slice("report-v2:".length))!.izin);
    // Açık bayrakta yalnız `hazir:true` satırlar görünür; `hazir:false` olan hiçbiri görünmez.
    v2 = true;
    const shown = visibleKeys().filter((k) => k.startsWith("report-v2:")).sort();
    const readyKeys = V2_ROWS.filter((e) => e.hazir).map((e) => `report-v2:${e.key}`).sort();
    expect(readyKeys.length, "körlük zemini: hazır v2 satırı yok").toBeGreaterThan(0);
    expect(shown).toEqual(readyKeys);
  });
});

function renderLeaf(path: string, key: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports/sales/termin" element={<ReportV2Route reportKey={key} />} />
          <Route path="/forbidden" element={<p>YASAK</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("§7 yaprak kapısı", () => {
  it("⭐ bayrak kapalı → /forbidden; açık ama hazir:false → /forbidden", () => {
    v2 = false;
    // `quality/kayip` hâlâ `hazir:false` (satış satırları R1-KAYIT'ta hazır oldu).
    const a = renderLeaf("/reports/sales/termin", "quality/kayip");
    expect(screen.getByText("YASAK")).toBeInTheDocument();
    a.unmount();
    v2 = true;
    renderLeaf("/reports/sales/termin", "quality/kayip");
    expect(screen.getByText("YASAK")).toBeInTheDocument();
  });
});

describe("§8 hata sınıfları — ayrı Türkçe mesaj", () => {
  const err = (status: number, code?: string) => ({ response: { status, data: { details: code ? { code } : undefined } } });
  it("MODULE_DISABLED ≠ REPORT_DISABLED ≠ 403 yetki", () => {
    expect(failureOf(err(403, "MODULE_DISABLED"))).toBe("module-disabled");
    expect(failureOf(err(403, "REPORT_DISABLED"))).toBe("report-disabled");
    expect(failureOf(err(403))).toBe("forbidden");
    expect(failureOf(err(500))).toBe("other");
    const titles = Object.values(FAILURE_TEXT).map((t) => t.title);
    expect(new Set(titles).size).toBe(3);
    renderWithProviders(<ReportFailureState failure="report-disabled" error={null} onRetry={() => undefined} />);
    expect(screen.getByText(FAILURE_TEXT["report-disabled"].title)).toBeInTheDocument();
  });
});

describe("§9 dışa aktarım — ekranla aynı metin", () => {
  const sentences = Array.from({ length: 6 }, (_, i) => ({ kural: `k${i}`, onem: 1 - i / 10, metin: `Cümle ${i + 1}.`, kanit: {} }));
  const p: RaporSunumu = {
    anahtar: "sales/termin",
    baslik: "Sözümüzü tuttuk mu?",
    soru: "Siparişler terminde gitti mi?",
    donem: { from: "2026-10-01", to: "2026-10-24", etiket: "1–24 Ekim 2026" },
    anaSayi: measured({ deger: null, olculemedi: "Termini olan sipariş yok" }),
    yanSayilar: [],
    anlati: sentences,
    grafik: null,
    tablo: null,
    tanimlar: [{ ad: "Zamanında teslim", aciklama: "Termin gününe kadar giden siparişler." }],
    parametreler: [{ ad: "customerId", etiket: "Müşteri", tur: "cokluSecim", deger: null }],
    uyarilar: [],
  };
  it("kart 'Ölçülemedi'; anlatı ekranda ilk 3, belgede ilk 5 — aynı metin; parametre cümlesi 'Tümü'", () => {
    const spec = buildExportSpec(p);
    const cards = spec.bloklar!.find((b) => b.tur === "anaSayi");
    expect(cards && cards.tur === "anaSayi" && cards.kartlar[0]!.deger).toBe("Ölçülemedi");
    const doc = spec.bloklar!.find((b) => b.tur === "anlati");
    expect(doc && doc.tur === "anlati" && doc.cumleler).toEqual(sentences.slice(0, ANLATI_PDF_SAYISI).map((s) => s.metin));
    renderWithProviders(<NarrativeBox sentences={sentences} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(sentences.slice(0, ANLATI_EKRAN_SAYISI).map((s) => s.metin));
    expect(spec.parametreCumlesi).toBe("Müşteri: Tümü");
  });
});
