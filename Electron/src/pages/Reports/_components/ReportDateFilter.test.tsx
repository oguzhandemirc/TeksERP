// =============================================================================
// RAPOR TARİH FİLTRESİ — bileşen bekçisi (R4 / K7): 6 sözleşme × parametre adı
// =============================================================================
// İddia: yaprak hangi girdiyi çizeceğini bilmez; sözleşme KATALOGDAN gelir ve backend
// parametre ADI değişmez (`dateFrom/dateTo` ISO · `from/to` gün · `factoryDay` · `asOf`).
// Her sözleşme için üç şey ölçülür: (a) hangi girdi çizildi (kaç tarih kutusu), (b) hook
// hangi parametre ADLARINI üretti (K7 tablosu), (c) URL durumu — anahtarlar sözleşmeye göre.
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `REPORT_DATE_PARAM_KEYS.kesit`
// → ["asOfDate"] → §d ❌ (11/1); `useForwardWindow` boş URL'de `{dateFrom, dateTo}` uydurdu → §e ❌ (11/1).
// =============================================================================
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { REPORT_CATALOG, type ReportKey, type ReportTarih } from "@/lib/report-catalog";
import { useForwardWindow } from "../_hooks/useForwardWindow";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useAsOfDay, useFactoryDay } from "../_hooks/useReportDay";
import { REPORT_DATE_PARAM_KEYS, REPORT_DATE_URL_KEYS, rangeDayParams } from "../_lib/report-date";
import { ReportDateFilter } from "./ReportDateFilter";

/** Her sözleşmeden kataloğun İLK yaprağı — körlük zemini: altısının da satırı olmalı. */
function sampleKey(tarih: ReportTarih): ReportKey {
  const r = REPORT_CATALOG.find((e) => e.tarih === tarih && e.yuzey !== "diyalog");
  if (!r) throw new Error(`katalogda '${tarih}' sözleşmeli yaprak yok`);
  return r.key;
}

// Takvim girdisi `DatePickerInput` (maskeli metin + takvim; yerleşik type=date YOK — 2026-09-17 taraması);
// kutular `data-date-input` ile bulunur, sınırlar `data-min`/`data-max`.
const DATE_INPUT = "input[data-date-input]";

function mount(ui: React.ReactNode, url = "/reports/x/y") {
  return render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);
}

/** Hook çıktısını DOM'a döker ki test paramları/URL'i okuyabilsin. */
function Probe({ params }: { params: Record<string, unknown> }) {
  const [sp] = useSearchParams();
  return (
    <>
      <output data-testid="params">{JSON.stringify(params)}</output>
      <output data-testid="url">{sp.toString()}</output>
    </>
  );
}
function RangeProbe({ reportKey }: { reportKey: ReportKey }) {
  const { params } = useReportDateRange(reportKey);
  return <Probe params={params} />;
}
function DayRangeProbe({ reportKey }: { reportKey: ReportKey }) {
  const { params } = useReportDateRange(reportKey);
  return <Probe params={rangeDayParams(params.dateFrom, params.dateTo)} />;
}
function FactoryDayProbe({ reportKey }: { reportKey: ReportKey }) {
  return <Probe params={useFactoryDay(reportKey).params} />;
}
function AsOfProbe({ reportKey }: { reportKey: ReportKey }) {
  return <Probe params={useAsOfDay(reportKey).params} />;
}
function ForwardProbe({ reportKey }: { reportKey: ReportKey }) {
  return <Probe params={useForwardWindow(reportKey).params} />;
}

const readParams = (): Record<string, unknown> => JSON.parse(screen.getByTestId("params").textContent ?? "{}") as Record<string, unknown>;
const readUrl = (): URLSearchParams => new URLSearchParams(screen.getByTestId("url").textContent ?? "");

describe("ReportDateFilter — sözleşme katalogdan, parametre adı K7 tablosundan", () => {
  it("§z körlük zemini: altı sözleşmenin her birinin katalogda en az bir yaprağı var", () => {
    for (const t of Object.keys(REPORT_DATE_PARAM_KEYS) as ReportTarih[]) {
      if (t === "yok") continue;
      expect(() => sampleKey(t)).not.toThrow();
    }
    expect(Object.keys(REPORT_DATE_PARAM_KEYS).sort()).toEqual(["aralik-gun", "aralik-iso", "ileri-pencere", "kesit", "tek-gun", "yok"]);
  });

  it("§a aralik-iso: iki tarih kutusu; boş URL'de katalog varsayılanı URL'e yazılır; parametre adları dateFrom/dateTo (ISO)", () => {
    const key = sampleKey("aralik-iso");
    const days = REPORT_CATALOG.find((r) => r.key === key)!.varsayilanGun!;
    const { container } = mount(
      <>
        <ReportDateFilter reportKey={key} />
        <RangeProbe reportKey={key} />
      </>,
    );
    expect(container.querySelectorAll(DATE_INPUT)).toHaveLength(2);
    const p = readParams();
    expect(Object.keys(p).sort()).toEqual([...REPORT_DATE_PARAM_KEYS["aralik-iso"]].sort());
    expect(String(p.dateFrom)).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO an, gün değil
    const spanDays = Math.floor((new Date(String(p.dateTo)).getTime() - new Date(String(p.dateFrom)).getTime()) / 86_400_000);
    expect(spanDays).toBe(days);
    const url = readUrl();
    expect([...url.keys()].sort()).toEqual([...REPORT_DATE_URL_KEYS["aralik-iso"]].sort());
  });

  it("§a2 aralik-iso: varsayılan gün YAPRAKTAN değil KATALOGDAN — farklı varsayılanlı iki rapor farklı pencere açar", () => {
    const keys = REPORT_CATALOG.filter((r) => r.tarih === "aralik-iso" && r.varsayilanGun !== null);
    const distinct = new Set(keys.map((r) => r.varsayilanGun));
    expect(distinct.size).toBeGreaterThan(1); // körlük zemini: tek değer olsaydı test hiçbir şeyi ayırt edemezdi
    for (const r of keys.slice(0, 6)) {
      const { unmount } = mount(<RangeProbe reportKey={r.key} />);
      const p = readParams();
      const spanDays = Math.floor((new Date(String(p.dateTo)).getTime() - new Date(String(p.dateFrom)).getTime()) / 86_400_000);
      expect(spanDays, r.key).toBe(r.varsayilanGun);
      unmount();
    }
  });

  it("§b aralik-gun: aynı URL kalıbı (dateFrom/dateTo), backend adı from/to FABRİKA GÜNÜ (YYYY-MM-DD)", () => {
    const key = sampleKey("aralik-gun");
    const { container } = mount(
      <>
        <ReportDateFilter reportKey={key} />
        <DayRangeProbe reportKey={key} />
      </>,
    );
    expect(container.querySelectorAll(DATE_INPUT)).toHaveLength(2);
    const p = readParams();
    expect(Object.keys(p).sort()).toEqual([...REPORT_DATE_PARAM_KEYS["aralik-gun"]].sort());
    expect(String(p.from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(p.to)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...readUrl().keys()].sort()).toEqual([...REPORT_DATE_URL_KEYS["aralik-gun"]].sort());
  });

  it("§c tek-gun: TEK kutu + Bugün; URL'de yoksa bugün ve bugün URL'e YAZILMAZ; parametre factoryDay", () => {
    const key = sampleKey("tek-gun");
    const { container } = mount(
      <>
        <ReportDateFilter reportKey={key} />
        <FactoryDayProbe reportKey={key} />
      </>,
    );
    expect(container.querySelectorAll(DATE_INPUT)).toHaveLength(1);
    expect(screen.getByText("Fabrika günü")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bugün" })).toBeDisabled();
    expect(Object.keys(readParams())).toEqual([...REPORT_DATE_PARAM_KEYS["tek-gun"]]);
    expect(readUrl().toString()).toBe("");
  });

  it("§c2 tek-gun: URL'deki gün okunur ve aynen gider (yenilemede kaybolmaz)", () => {
    const key = sampleKey("tek-gun");
    mount(<FactoryDayProbe reportKey={key} />, "/reports/x/y?factoryDay=2026-01-15");
    expect(readParams()).toEqual({ factoryDay: "2026-01-15" });
  });

  it("§d kesit: TEK kutu (max=bugün) + Kesit etiketi; asOf = seçilen günün SONU (ISO)", () => {
    const key = sampleKey("kesit");
    const { container } = mount(
      <>
        <ReportDateFilter reportKey={key} />
        <AsOfProbe reportKey={key} />
      </>,
      "/reports/x/y?asOf=2026-03-10",
    );
    const inputs = container.querySelectorAll<HTMLInputElement>(DATE_INPUT);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.dataset.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText("Kesit")).toBeInTheDocument();
    const p = readParams();
    expect(Object.keys(p)).toEqual([...REPORT_DATE_PARAM_KEYS.kesit]);
    const asOf = new Date(String(p.asOf));
    expect(asOf.getHours()).toBe(23);
    expect(asOf.getMinutes()).toBe(59);
    expect(asOf.getDate()).toBe(10);
  });

  it("§e ileri-pencere: iki kutu + İLERİ ön ayarlar (çıpa yokken pasif); boş URL → BOŞ parametre (backend varsayılanı)", () => {
    const key = sampleKey("ileri-pencere");
    const { container } = mount(
      <>
        <ReportDateFilter reportKey={key} />
        <ForwardProbe reportKey={key} />
      </>,
    );
    expect(container.querySelectorAll(DATE_INPUT)).toHaveLength(2);
    expect(screen.getByText("Takvim penceresi")).toBeInTheDocument();
    for (const d of [7, 30, 90]) expect(screen.getByRole("button", { name: `+${d} gün` })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Son \d+g/ })).toBeNull(); // geriye bakan ön ayar YOK
    expect(readParams()).toEqual({});
    expect(readUrl().toString()).toBe("");
  });

  it("§e2 ileri-pencere: URL dueFrom/dueTo → dateFrom (gün başı) / dateTo (gün sonu) ISO; anahtarlar dateFrom/dateTo'dan AYRI", () => {
    const key = sampleKey("ileri-pencere");
    mount(<ForwardProbe reportKey={key} />, "/reports/x/y?dueFrom=2026-05-01&dueTo=2026-05-08");
    const p = readParams();
    expect(Object.keys(p).sort()).toEqual([...REPORT_DATE_PARAM_KEYS["ileri-pencere"]].sort());
    expect(new Date(String(p.dateFrom)).getHours()).toBe(0);
    expect(new Date(String(p.dateTo)).getHours()).toBe(23);
    expect(REPORT_DATE_URL_KEYS["ileri-pencere"]).toEqual(["dueFrom", "dueTo"]);
  });

  it("§f yok: HİÇ çizilmez", () => {
    const key = sampleKey("yok");
    const { container } = mount(<ReportDateFilter reportKey={key} />);
    expect(container.querySelectorAll(DATE_INPUT)).toHaveLength(0);
    expect(container.textContent).toBe("");
    expect(REPORT_DATE_PARAM_KEYS.yok).toEqual([]);
  });

  it("§g kontrollü kip (diyalog): URL'siz, iki kutu, min/max çapraz bağlı; yalnız aralik-iso", () => {
    const { container } = mount(
      <ReportDateFilter reportKey="finance/statement" value={{ from: "2026-01-01", to: "2026-01-31" }} onChange={() => {}} bare />,
    );
    const inputs = container.querySelectorAll<HTMLInputElement>(DATE_INPUT);
    expect(inputs).toHaveLength(2);
    // Tutarlılık takasla/klampla değil uyarıyla: geçerli aralıkta uyarı yok (DateRangeInput sözleşmesi).
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(readUrlSafe()).toBe("");
    expect(() => render(<MemoryRouter><ReportDateFilter reportKey={sampleKey("kesit")} value={{ from: "", to: "" }} onChange={() => {}} /></MemoryRouter>)).toThrow(/kontrollü kip/);
  });

  it("§h yanlış sözleşmeyle çağrılan hook GELİŞTİRME HATASI verir (sessiz 30 uydurmaz)", () => {
    const silent = console.error;
    console.error = () => {};
    try {
      expect(() => mount(<RangeProbe reportKey={sampleKey("kesit")} />)).toThrow(/aralık hook'u kullanılamaz/);
      expect(() => mount(<FactoryDayProbe reportKey={sampleKey("kesit")} />)).toThrow(/bekleniyordu/);
      expect(() => mount(<ForwardProbe reportKey={sampleKey("aralik-iso")} />)).toThrow(/ileri-pencere hook'u kullanılamaz/);
      expect(() => mount(<RangeProbe reportKey="finance/statement" />)).toThrow(/varsayılan gün yok/);
    } finally {
      console.error = silent;
    }
  });
});

function readUrlSafe(): string {
  const el = screen.queryByTestId("url");
  return el?.textContent ?? "";
}
