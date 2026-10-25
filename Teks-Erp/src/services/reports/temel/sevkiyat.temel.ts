// =============================================================================
// Temel rapor 2 — "Ne sevk ettik?" (`sales/sevkiyat`)
// =============================================================================
// Ana sayı BRÜT sevk metresi, TEK tanımdan: `_shipped.collectShipped` (Sevk & Termin
// Karnesi'nin `shippedQty`si ve İade Karnesi paydası da buradan). Tutar Yurtiçi/Yurtdışı
// raporunun para toplayıcısından (`_destination-mix-money`), aynı `report:sales` izniyle.
// ⚠️ Sevk & Termin Karnesi'nin günlük serisi (`daily`) KULLANILMAZ: canlı top metresinden
// okur, iade geri-eklemesi ve doğrudan sevk yok → NET'tir; brüt kuralını bozardı.

import type { ShipmentDestination } from "@prisma/client";
import { anlatiUret } from "../anlati/anlati";
import type { ScopeNoteInput } from "../anlati/gozlem.types";
import { round1 } from "../_breakdown";
import { aggregateMoney, collectMoneyRows, type MoneyAgg } from "../_destination-mix-money";
import { filterEcho } from "../_filters";
import type { CompareMode, DateRange } from "../_shared";
import { collectShipped, type ShippedCell } from "../_shipped";
import type { AnaSayi, GrafikBlok, TabloBlok } from "../sunum/sunum.types";
import {
  capTable,
  catalogHeader,
  definitionsOf,
  destinationParameter,
  metricFigure,
  periodOf,
  plainFigure,
  rangeParameters,
  singleCurrencyUnit,
  type CoreReportResult,
} from "./_common";

export const SHIPPED_FILTER_KEYS = ["destination"] as const;
const CHART_CUSTOMER_LIMIT = 10;
const DESTINATION_SERIES = [
  { key: "DOMESTIC", label: "Yurtiçi" },
  { key: "EXPORT", label: "Yurtdışı" },
  { key: "NONE", label: "Yön kaydı yok" },
] as const;

export interface ShippedReportInput {
  range: DateRange;
  compareRange: DateRange | null;
  /** Uygulanan kıyas kipi (K-KIYAS: `resolveCoreCompare`). */
  compareMode: CompareMode;
  filters: { destination?: ShipmentDestination };
}

const sumQty = (cells: ShippedCell[]): number => cells.reduce((a, c) => a + c.qty, 0);

interface CustomerAgg {
  id: string;
  name: string;
  qty: number;
  rolls: number;
  prevQty: number;
  byDestination: Map<string, number>;
}

function groupByCustomer(cells: ShippedCell[], prevCells: ShippedCell[] | null): CustomerAgg[] {
  const map = new Map<string, CustomerAgg>();
  const slot = (c: ShippedCell): CustomerAgg => {
    let a = map.get(c.customerId);
    if (!a) {
      a = { id: c.customerId, name: c.customerName, qty: 0, rolls: 0, prevQty: 0, byDestination: new Map() };
      map.set(c.customerId, a);
    }
    return a;
  };
  for (const c of cells) {
    const a = slot(c);
    a.qty += c.qty;
    a.rolls += c.rollCount;
    const d = c.destination ?? "NONE";
    a.byDestination.set(d, (a.byDestination.get(d) ?? 0) + c.qty);
  }
  for (const c of prevCells ?? []) slot(c).prevQty += c.qty;
  return [...map.values()]
    .filter((a) => a.qty > 0 || a.prevQty > 0)
    .sort((x, y) => y.qty - x.qty || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** Tutar yan sayısı + kapsam notları: tek para birimi → o birim; çok birim → kayıtlı kurla TL karşılığı. */
function moneyFigureOf(money: MoneyAgg): { figure: AnaSayi; scope: ScopeNoteInput[] } {
  const unit = singleCurrencyUnit(money.amounts);
  const scope: ScopeNoteInput[] = [];
  let figure: AnaSayi;
  if (money.amounts.length === 0) {
    figure = metricFigure("sevk.tutar", null, { unit: "TRY", unmeasured: "Sevk edilen satırların fiyatı girilmemiş" });
  } else if (unit) {
    figure = metricFigure("sevk.tutar", money.amounts[0].amount, { unit });
  } else {
    figure = metricFigure("sevk.tutar", money.tlTotal, { unit: "TRY", name: "Sevk tutarı (TL karşılığı)" });
    scope.push({ sayi: money.noRateLineCount, nesne: "sevk satırı", neden: "Sevk gününün kuru kayıtlı olmayan", sonuc: "TL karşılığına katılmadı", toplam: money.pricedLineCount });
  }
  scope.push({
    sayi: money.lineCount - money.pricedLineCount,
    nesne: "sevk satırı",
    neden: "Fiyatı girilmemiş",
    sonuc: "tutara katılmadı",
    toplam: money.lineCount,
  });

  return { figure, scope };
}

/** Müşteri (ilk 10 + Diğer) × yön yığın çubuğu — sevkiyatın donmuş yönü. */
function destinationChart(customers: CustomerAgg[], cells: ShippedCell[]): GrafikBlok | null {
  const head = customers.filter((c) => c.qty > 0).slice(0, CHART_CUSTOMER_LIMIT);
  const rest = customers.filter((c) => c.qty > 0).slice(CHART_CUSTOMER_LIMIT);
  const restByDestination = (d: string) => rest.reduce((a, c) => a + (c.byDestination.get(d) ?? 0), 0);
  const usedSeries = DESTINATION_SERIES.filter((s) => cells.some((c) => (c.destination ?? "NONE") === s.key && c.qty > 0));
  return head.length
    ? {
        tur: "yiginCubuk",
        eksen: { x: { ad: "Müşteri", tur: "kategori" }, y: { ad: "Sevk edilen", birim: "m" } },
        kategoriler: [...head.map((c) => c.name), ...(rest.length ? ["Diğer"] : [])],
        seriler: usedSeries.map((s) => ({
          ad: s.label,
          veri: [
            ...head.map((c) => round1(c.byDestination.get(s.key) ?? 0)),
            ...(rest.length ? [round1(restByDestination(s.key))] : []),
          ],
        })),
      }
    : null;

}

function customerTable(customers: CustomerAgg[], cells: ShippedCell[], withCompare: boolean): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "musteri", baslik: "Müşteri", hiza: "sol" },
      { anahtar: "top", baslik: "Top", birim: "top", hiza: "sag" },
      { anahtar: "metre", baslik: "Sevk edilen", birim: "m", hiza: "sag" },
      ...(withCompare ? [{ anahtar: "oncekiMetre", baslik: "Önceki dönem", birim: "m" as const, hiza: "sag" as const }] : []),
    ],
    satirlar: customers.map((c) => ({
      musteri: c.name,
      top: c.rolls,
      metre: round1(c.qty),
      ...(withCompare ? { oncekiMetre: round1(c.prevQty) } : {}),
    })),
    toplam: { musteri: "Toplam", top: cells.reduce((a, c) => a + c.rollCount, 0), metre: round1(sumQty(cells)) },
  };
}

export async function buildShippedReport(input: ShippedReportInput): Promise<CoreReportResult> {
  const { range, compareRange, filters } = input;
  const f = { destination: filters.destination };
  const [cells, prevCells, moneyRows] = await Promise.all([
    collectShipped(range, f),
    compareRange ? collectShipped(compareRange, f) : Promise.resolve(null),
    collectMoneyRows(range),
  ]);
  const suzgec = filterEcho(filters, SHIPPED_FILTER_KEYS);

  const total = sumQty(cells);
  const mainFigure = metricFigure("sevk.brutMetre", round1(total), prevCells ? { previous: round1(sumQty(prevCells)) } : {});

  // Para satırı yönü sevkiyatın donmuş yönüdür (`bucket`); yön süzgeci aynı kovayı seçer.
  const money = aggregateMoney(filters.destination ? moneyRows.filter((r) => r.bucket === filters.destination) : moneyRows);
  const { figure: amountFigure, scope } = moneyFigureOf(money);

  const exportQty = cells.filter((c) => c.destination === "EXPORT").reduce((a, c) => a + c.qty, 0);
  const sideFigures: AnaSayi[] = [
    amountFigure,
    plainFigure("sevk.top", "Sevk edilen top", cells.reduce((a, c) => a + c.rollCount, 0), { unit: "top", direction: "yukari" }),
  ];
  // Yön süzgeçliyken ihracat payı anlamsızdır (%0 ya da %100) — gösterilmez.
  if (!filters.destination) {
    sideFigures.push(
      plainFigure("sevk.ihracatPayi", "İhracat payı", total > 0 ? round1((exportQty * 100) / total) : null, { unit: "yuzde",
        unmeasured: "Bu dönemde sevk yok",
      }),
    );
  }

  const customers = groupByCustomer(cells, prevCells);
  const chart = destinationChart(customers, cells);

  const table = customerTable(customers, cells, prevCells !== null);
  const capped = capTable(table, "Müşteri kırılımı");

  const anlati = anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi: mainFigure,
    anaSayiIfadesi: { yuklem: "sevk edildi" },
    veri: { satirSayisi: cells.length, suzgec },
    kirilim: {
      boyut: "müşteri",
      birim: "m",
      adTuru: "ozel",
      satirlar: customers.map((c) => ({ ad: c.name, deger: round1(c.qty), ...(prevCells ? { onceki: round1(c.prevQty) } : {}) })),
    },
    kapsam: scope,
  });

  return {
    suzgec,
    sunum: {
      ...catalogHeader("sales/sevkiyat"),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi: mainFigure,
      yanSayilar: sideFigures,
      anlati,
      grafik: chart,
      tablo: capped.tablo,
      tanimlar: definitionsOf(["sevk.brutMetre", "sevk.tutar"]),
      parametreler: [...rangeParameters(range, input.compareMode), destinationParameter(filters.destination, "Yön (sevkiyat)")],
      uyarilar: capped.uyarilar,
    },
  };
}
