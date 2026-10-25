// =============================================================================
// RAPORLAR v2 — VARYANT (küçük çoklular) + DÖNEM KIYASI + ÖN AYAR (R1-VARYANT ekranı)
// =============================================================================
// §1 çipler sunucu beyanından: kırılım "Tek", dönem kıyası "Kapalı"; URL durumu geri yüklenir; beyanda
//    olmayan (kapalı) kırılım seçicide YOK; beyan yoksa çip yok · §2 küçük çoklular: hücre tıkı süzgece
//    döner (varyant kalkar); kişi adı işareti · §3 dönem tablosu: kesit raporunda "Ölçülemedi" + neden +
//    uyarı; son sütun kıyaslı · §4 varyant/dönem yoksa gövdede bu bölümler YOK (eski sunum aynı) ·
//    §5 ön ayar parametreleri URL'den · §6 dışa aktarım ekranla aynı metin.
//
// Negatif sonda (2026-10-25, geri alındı): `cellFilterSearch` varyantı silmeyince ❌ 1 (§2a);
// `emptyLabelOf` boş dönünce ("Tümü") ❌ 3 (§1a, §1c, §6); md5 ile geri alındı, 12/0.
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { REPORT_BY_KEY } from "@/lib/report-catalog";

vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ reportsV2Enabled: true, flagsReady: true, flagsFailed: false, isReportOpen: () => true }),
}));

import { ParamChips } from "./ParamChips";
import { ReportBody } from "./ReportBody";
import { buildExportSpec } from "./export-spec";
import { onlyDateKeys, presetParamsFromSearch, searchFromPreset } from "./preset-api";
import type { AnaSayi, DonemBlok, ParametreBeyani, RaporSunumu, VaryantBlok } from "./sunum";

const entry = REPORT_BY_KEY.get("sales/siparis-talep") ?? REPORT_BY_KEY.get("sales/termin")!;
const RANGE = "dateFrom=2026-10-01T00:00:00.000Z&dateTo=2026-10-24T20:59:59.999Z";

const VARIANT_DECL: ParametreBeyani = {
  ad: "varyant",
  etiket: "Kırılım",
  tur: "secim",
  deger: null,
  secenekler: [
    { deger: "musteri", etiket: "Müşteriye göre" },
    { deger: "urun", etiket: "Kumaşa göre" },
  ],
};
const PERIOD_DECL: ParametreBeyani = {
  ad: "donemler",
  etiket: "Dönem kıyası",
  tur: "secim",
  deger: null,
  secenekler: [
    { deger: "ay:3", etiket: "Son 3 ay" },
    { deger: "ay:6", etiket: "Son 6 ay" },
  ],
};

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="search">{loc.search}</output>;
}
const wrap = (ui: React.ReactNode, search = RANGE) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/reports/x?${search}`]}>
        {ui}
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const urlNow = () => new URLSearchParams(screen.getByTestId("search").textContent ?? "");

const fig = (deger: number | null, over: Partial<AnaSayi> = {}): AnaSayi => ({ olcu: "siparis.metre", ad: "Sipariş metresi", deger, birim: "m", ...over });
const base = (over: Partial<RaporSunumu> = {}): RaporSunumu => ({
  anahtar: "sales/siparis-talep",
  baslik: "Sipariş talebi",
  soru: "Ne kadar sipariş geldi?",
  donem: { from: "2026-10-01", to: "2026-10-24", etiket: "Ekim 2026" },
  kiyasDonemi: { from: "2026-09-01", to: "2026-09-30", etiket: "Eylül 2026" },
  anaSayi: fig(12000),
  yanSayilar: [],
  anlati: [],
  grafik: null,
  tablo: null,
  tanimlar: [],
  parametreler: [VARIANT_DECL, PERIOD_DECL],
  uyarilar: [],
  ...over,
});
const VARIANT: VaryantBlok = {
  boyut: "musteri",
  boyutEtiketi: "Müşteri",
  secili: null,
  digerleri: [],
  suzgecAnahtari: "customerId",
  hucreler: [
    { deger: "c1", ad: "Kaya Tekstil", anaSayi: fig(6400, { kiyas: { deger: 5000, fark: 1400, yuzde: 28, yon: "artti", durum: "iyi" } }) },
    { deger: "c2", ad: "Ak Örme", anaSayi: fig(3100) },
  ],
};
const PERIODS: DonemBlok[] = [
  { from: "2026-08-01", to: "2026-08-31", etiket: "Ağustos 2026", anaSayi: fig(9000) },
  { from: "2026-09-01", to: "2026-09-30", etiket: "Eylül 2026", anaSayi: fig(10000) },
  { from: "2026-10-01", to: "2026-10-24", etiket: "Ekim 2026", anaSayi: fig(12000, { kiyas: { deger: 10000, fark: 2000, yuzde: 20, yon: "artti", durum: "iyi" } }) },
];

describe("§1 çipler sunucu beyanından", () => {
  it("§1a ⭐ seçim yokken 'Kırılım: Tek' ve 'Dönem kıyası: Kapalı' — 'Tümü' değil", () => {
    wrap(<ParamChips entry={entry} params={[VARIANT_DECL, PERIOD_DECL]} />);
    expect(screen.getByRole("button", { name: /Kırılım:\s*Tek/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dönem kıyası:\s*Kapalı/ })).toBeInTheDocument();
  });

  it("§1b URL durumu geri yüklenir (paylaşılabilir bağlantı)", () => {
    wrap(<ParamChips entry={entry} params={[VARIANT_DECL, PERIOD_DECL]} />, `${RANGE}&varyant=urun&donemler=ay:6`);
    expect(screen.getByRole("button", { name: /Kırılım:\s*Kumaşa göre/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dönem kıyası:\s*Son 6 ay/ })).toBeInTheDocument();
  });

  it("§1c ⭐ kapalı kırılım (renk/istasyon/tezgâh/desen) seçicide çizilmez; 'Tek' seçince anahtar düşer", () => {
    wrap(<ParamChips entry={entry} params={[VARIANT_DECL]} />, `${RANGE}&varyant=musteri`);
    fireEvent.click(screen.getByRole("button", { name: /Kırılım:/ }));
    const dlg = within(screen.getByRole("dialog"));
    expect(dlg.getAllByRole("option").map((o) => o.textContent)).toEqual(["Tek", "Müşteriye göre", "Kumaşa göre"]);
    for (const closed of [/Renk/, /İstasyon/, /Tezg/, /Desen/]) expect(dlg.queryByRole("option", { name: closed })).toBeNull();
    fireEvent.click(dlg.getByRole("option", { name: "Tek" }));
    expect(urlNow().has("varyant")).toBe(false);
  });

  it("§1d beyan yoksa (eski uç) kırılım ve dönem çipi yok", () => {
    wrap(<ParamChips entry={entry} params={[]} />);
    expect(screen.queryByRole("button", { name: /Kırılım:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dönem kıyası:/ })).toBeNull();
  });

  it("§1e kişi adı taşıyan sunum → kırılım çipinde işaret (K-KISI)", () => {
    wrap(<ParamChips entry={entry} params={[VARIANT_DECL]} personNamed />);
    expect(screen.getByTestId("person-named-chip")).toBeInTheDocument();
  });
});

describe("§2 küçük çoklular", () => {
  it("§2a ⭐ hücre tıkı süzgece döner: customerId yazılır, varyant kalkar, tarih kalır", () => {
    wrap(<ReportBody presentation={base({ varyant: VARIANT })} fetchedAt={Date.parse("2026-10-25T08:00:00Z")} />, `${RANGE}&varyant=musteri`);
    const grid = screen.getByRole("region", { name: "Müşteri kırılımı" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
    expect(within(grid).getByText("6.400 m")).toBeInTheDocument();
    expect(within(grid).getByText("▲ %28 (Eylül 2026: 5.000 m)")).toBeInTheDocument();
    fireEvent.click(within(grid).getByRole("button", { name: /Kaya Tekstil/ }));
    const u = urlNow();
    expect(u.get("customerId")).toBe("c1");
    expect(u.has("varyant")).toBe(false);
    expect(u.get("dateFrom")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("§2b süzgeç anahtarı beyan edilmemişse hücre tıklanamaz (düğme yok)", () => {
    wrap(<ReportBody presentation={base({ varyant: { ...VARIANT, suzgecAnahtari: undefined } })} fetchedAt={0} />);
    expect(within(screen.getByRole("region", { name: "Müşteri kırılımı" })).queryByRole("button")).toBeNull();
  });
});

describe("§3 dönem kıyası", () => {
  it("§3a dönemler yan yana, son sütun bir öncekiyle kıyaslı", () => {
    wrap(<ReportBody presentation={base({ donemler: PERIODS })} fetchedAt={0} />);
    const t = screen.getByRole("region", { name: "Dönem kıyası" });
    expect(within(t).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Ölçü", "Ağustos 2026", "Eylül 2026", "Ekim 2026"]);
    expect(within(t).getByText("▲ %20 (Eylül 2026: 10.000 m)")).toBeInTheDocument();
  });

  it("§3b ⭐ kesit raporunda geçmiş 'Ölçülemedi' + neden + uyarı; '0' yazılmaz", () => {
    const nm = (e: string): DonemBlok => ({ from: e, to: e, etiket: e, anaSayi: fig(null, { olculemedi: "Geçmiş kesit görüntüsü yok" }) });
    wrap(
      <ReportBody
        presentation={base({ donemler: [nm("Ağustos 2026"), nm("Eylül 2026"), { ...PERIODS[2]!, anaSayi: fig(12000) }], uyarilar: ["Geçmiş için aylık kesit görüntüsü gerekiyor; bu rapor yalnız bugünün kesitini ölçer."] })}
        fetchedAt={0}
      />,
    );
    expect(screen.getByText(/kesit görüntüsü gerekiyor/)).toBeInTheDocument();
    const t = screen.getByRole("region", { name: "Dönem kıyası" });
    expect(within(t).getAllByText("Ölçülemedi")).toHaveLength(2);
    expect(within(t).getAllByText("Geçmiş kesit görüntüsü yok")).toHaveLength(2);
    expect(within(t).queryByText(/^0 m$/)).toBeNull();
  });
});

describe("§4 varyant/dönem yoksa gövde bugünkü hâli", () => {
  it("⭐ bölümler çizilmez; hücresiz varyant da çizilmez", () => {
    const a = wrap(<ReportBody presentation={base()} fetchedAt={0} />);
    const html = a.container.innerHTML;
    expect(screen.queryByRole("region", { name: /kırılımı/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Dönem kıyası" })).toBeNull();
    a.unmount();
    const b = wrap(<ReportBody presentation={base({ varyant: { ...VARIANT, hucreler: [] }, donemler: [] })} fetchedAt={0} />);
    expect(b.container.innerHTML).toBe(html);
  });
});

describe("§5 ön ayar parametreleri URL'den", () => {
  it("⭐ tarih + kırılım + dönem + süzgeç; boş ve kural dışı anahtar atlanır; geri dönüşüm aynı URL", () => {
    const s = new URLSearchParams(`${RANGE}&varyant=musteri&donemler=ay:6&customerId=c1,c2&bos=&x-y=1`);
    const p = presetParamsFromSearch(s);
    expect(p).toEqual({ dateFrom: "2026-10-01T00:00:00.000Z", dateTo: "2026-10-24T20:59:59.999Z", varyant: "musteri", donemler: "ay:6", customerId: "c1,c2" });
    expect(searchFromPreset({ ...p, customerId: ["c1", "c2"] }).toString()).toBe(new URLSearchParams(p).toString());
    // Tarihsiz ön ayar bugünkü tarihi korur (aralık raporu tarihsiz istek atmaz); tarihli ön ayar kendi tarihini yazar.
    expect(searchFromPreset({ varyant: "urun" }, s).toString()).toBe(new URLSearchParams(`${RANGE}&varyant=urun`).toString());
    expect(searchFromPreset({ dateFrom: "a", dateTo: "b" }, s).toString()).toBe("dateFrom=a&dateTo=b");
    expect(onlyDateKeys(new URLSearchParams(RANGE))).toBe(true);
    expect(onlyDateKeys(s)).toBe(false);
  });
});

describe("§6 dışa aktarım ekranla aynı metin", () => {
  it("kırılım ve dönem tabloları belgeye girer; parametre cümlesi 'Tek'/'Kapalı'", () => {
    const spec = buildExportSpec(base({ varyant: VARIANT, donemler: PERIODS }));
    expect(spec.parametreCumlesi).toBe("Kırılım: Tek · Dönem kıyası: Kapalı");
    const [v, d] = spec.tables;
    expect(v!.name).toBe("Müşteri kırılımı");
    expect(v!.rows[0]).toEqual({ ad: "Kaya Tekstil", deger: "6.400 m", kiyas: "▲ %28 (Eylül 2026: 5.000 m)" });
    expect(d!.rows.map((r) => r.donem)).toEqual(["Ağustos 2026", "Eylül 2026", "Ekim 2026"]);
    expect(d!.rows[2]).toEqual({ donem: "Ekim 2026", deger: "12.000 m", kiyas: "▲ %20 (Eylül 2026: 10.000 m)" });
  });
});
