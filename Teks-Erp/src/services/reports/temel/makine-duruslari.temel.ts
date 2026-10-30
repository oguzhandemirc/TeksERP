// =============================================================================
// Temel rapor — "Makineler neden durdu?" (`production/makine-duruslari`; D4-A4, DALGA4 §2.5 md. 5–6, §2.8)
// =============================================================================
// Sayı `machine-stops.report.ts`ten (span defteri; günlere bölünmüş, revoked hariç, açık duruş "şimdi"ye kadar);
// burası yalnız zarfı kurar. Ekran, Excel, PDF ve patron bulutu AYNI zarfı okur (bulut aritmetik yapmaz).
import type { StationKind } from "@prisma/client";
import { anlatiUret } from "../anlati/anlati";
import { anaSayiKur } from "../sunum/sunum-kur";
import type { AnaSayi, GrafikBlok, ParametreBeyani, TabloBlok } from "../sunum/sunum.types";
import { getMachineStopReport, NO_REASON_KEY, stationKindLabel, type MachineStopReport, type MachineStopReportFilters } from "../machine-stops.report";
import { capTable, catalogHeader, periodOf, type CoreReportResult } from "./_common";
import { dayRangeParameters, type ResolvedDayRange } from "./_day-range";
import type { CoreRunner } from "./_variant";
import type { CompareMode, DateRange } from "../_shared";
import { secondsToMinutes } from "./duruslar.temel";

export const MACHINE_STOPS_KEY = "production/makine-duruslari";

/** ms → dakika (1 ondalık; dokuma duruş raporuyla aynı yuvarlama). */
export const msToMinutes = (ms: number): number => secondsToMinutes(ms / 1000) ?? 0;

const DAY_LABEL = (ymd: string): string => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;

export function machineStopsTable(r: MachineStopReport): TabloBlok {
  return {
    kolonlar: [
      { anahtar: "makine", baslik: "Makine", hiza: "sol" },
      { anahtar: "tur", baslik: "Makine türü", hiza: "sol" },
      { anahtar: "adet", baslik: "Duruş sayısı", birim: "adet", hiza: "sag" },
      { anahtar: "dakika", baslik: "Süre", birim: "dakika", hiza: "sag" },
      { anahtar: "durum", baslik: "Şu an", hiza: "sol" },
      { anahtar: "metre", baslik: "Aynı dönemde çıkan", birim: "m", hiza: "sag" },
    ],
    satirlar: r.machines.map((m) => ({
      makine: m.label,
      tur: stationKindLabel(m.stationKind),
      adet: m.stopCount,
      dakika: msToMinutes(m.ms),
      durum: m.ongoing > 0 ? "Sürüyor" : "",
      metre: Math.round(m.outMeters * 10) / 10,
    })),
    toplam: {
      makine: "Toplam", tur: "", adet: r.stopCount, dakika: msToMinutes(r.ms), durum: r.ongoing > 0 ? `${r.ongoing} sürüyor` : "",
      metre: Math.round(r.machines.reduce((s, m) => s + m.outMeters, 0) * 10) / 10,
    },
  };
}

/** Vardiya tanımı olan kurulumda vardiya kırılımı, yoksa fabrika günü (sınırı aşan duruş günlere bölünmüş). */
export function machineStopsChart(r: MachineStopReport, range: DateRange): GrafikBlok | null {
  const byShift = r.shifts.length > 0;
  const cats = byShift ? r.shifts.map((s) => ({ ad: s.label, ms: s.ms })) : r.days.map((d) => ({ ad: DAY_LABEL(d.day), ms: d.ms }));
  if (cats.length === 0) return null;
  return {
    tur: "cubuk",
    eksen: { x: { ad: byShift ? "Vardiya" : "Gün", tur: "kategori" }, y: { ad: "Süre", birim: "dakika" } },
    kategoriler: cats.map((c) => c.ad),
    seriler: [{ ad: periodOf(range).etiket, veri: cats.map((c) => msToMinutes(c.ms)) }],
  };
}

export function machineStopsWarnings(r: MachineStopReport): string[] {
  const w: string[] = [];
  if (r.ongoing > 0) w.push(`${r.ongoing} duruş hâlâ sürüyor; süresi şu ana kadar sayıldı.`);
  if (r.unclassified > 0) w.push(`${r.unclassified} duruşun sebebi girilmemiş; "Sebebi girilmemiş" satırında toplandı.`);
  return w;
}

function filterParameters(r: MachineStopReport, f: MachineStopReportFilters): ParametreBeyani[] {
  const sel = (v: readonly string[] | undefined) => (v && v.length > 0 ? [...v] : null);
  return [
    { ad: "machineId", etiket: "Makine", tur: "cokluSecim", deger: sel(f.machineId), secenekler: r.machines.map((m) => ({ deger: m.key, etiket: m.label })) },
    { ad: "stationKind", etiket: "Makine türü", tur: "cokluSecim", deger: sel(f.stationKind), secenekler: r.stationKinds.map((k) => ({ deger: k.key, etiket: k.label })) },
    { ad: "reasonCode", etiket: "Sebep", tur: "cokluSecim", deger: sel(f.reasonCode), secenekler: r.reasons.filter((x) => x.key !== NO_REASON_KEY).map((x) => ({ deger: x.key, etiket: x.label })) },
  ];
}

export interface MachineStopsInput {
  window: ResolvedDayRange;
  filters?: MachineStopReportFilters;
  now?: Date;
}

export interface MachineStopsResult extends CoreReportResult {
  detay: MachineStopReport;
}

export async function buildMachineStopsReport(input: MachineStopsInput): Promise<MachineStopsResult> {
  const { days, range, compareRange, mode } = input.window;
  const filters = input.filters ?? {};
  const report = await getMachineStopReport({ range, filters, now: input.now });
  const previous = compareRange ? await getMachineStopReport({ range: compareRange, filters, now: input.now }) : null;

  const anaSayi: AnaSayi = anaSayiKur({
    olcu: "makineDurus.sure", ad: "Toplam duruş", deger: msToMinutes(report.ms), birim: "dakika",
    onceki: previous ? msToMinutes(previous.ms) : undefined, iyiYon: "asagi",
  });
  const yanSayilar: AnaSayi[] = [
    anaSayiKur({ olcu: "makineDurus.sayi", ad: "Duruş sayısı", deger: report.stopCount, birim: "adet", onceki: previous?.stopCount, iyiYon: "asagi" }),
    anaSayiKur({ olcu: "makineDurus.suruyor", ad: "Şu an süren", deger: report.ongoing, birim: "adet", iyiYon: "asagi" }),
    anaSayiKur({ olcu: "makineDurus.sebepsiz", ad: "Sebebi girilmemiş", deger: report.unclassified, birim: "adet", iyiYon: "asagi" }),
  ];
  const capped = capTable(machineStopsTable(report), "Makineler");
  const anlati = report.stopCount === 0 ? [] : anlatiUret({
    donem: range,
    kiyasDonemi: compareRange,
    anaSayi,
    anaSayiIfadesi: { yuklem: "durdu", ozne: "Makineler" },
    kirilim: { boyut: "sebep", birim: "dakika", adTuru: "ozel", ozneIlgi: "Duruşların", satirlar: report.reasons.map((x) => ({ ad: x.label, deger: msToMinutes(x.ms) })) },
  });

  return {
    detay: report,
    kirilimlar: {
      makine: report.machines.map((m) => ({ deger: m.key, etiket: m.label })),
      istasyon: report.stationKinds.map((k) => ({ deger: k.key, etiket: k.label })),
      sebep: report.reasons.filter((x) => x.key !== NO_REASON_KEY).map((x) => ({ deger: x.key, etiket: x.label })),
    },
    sunum: {
      ...catalogHeader(MACHINE_STOPS_KEY),
      donem: periodOf(range),
      ...(compareRange ? { kiyasDonemi: periodOf(compareRange) } : {}),
      anaSayi,
      yanSayilar,
      anlati,
      grafik: machineStopsChart(report, range),
      tablo: capped.tablo,
      tanimlar: [
        { ad: "Toplam duruş", aciklama: "Makinelerin bu dönemde durduğu süre, dakika. Geri alınan duruş girmez; süren duruş şu ana kadar sayılır." },
        { ad: "Gün", aciklama: "Gece yarısını aşan duruş iki güne bölünür; her gün kendi payını alır." },
        { ad: "Vardiya", aciklama: "Duruş başladığı vardiyaya yazılır. Vardiya tanımı yoksa kırılım güne göredir." },
        { ad: "Aynı dönemde çıkan", aciklama: "O makineden bu dönemde sayaçla ölçülüp çıkan kumaş, metre (geri alınan okuma girmez)." },
      ],
      parametreler: [...dayRangeParameters(days, mode), ...filterParameters(report, filters)],
      uyarilar: [...capped.uyarilar, ...machineStopsWarnings(report)],
    },
  };
}

/** Varyant/dönem sarmalı için koşucu: hücre değeri ucun kendi süzgecine yazılır. `onMain` ana koşunun detayını alır. */
export function machineStopsRunner(filters: MachineStopReportFilters, mode: CompareMode, dayWindow: (r: DateRange, c: DateRange | null, m: CompareMode) => ResolvedDayRange, onMain?: (d: MachineStopReport) => void): CoreRunner {
  let first = true;
  return async (range, compareRange, cell) => {
    const f: MachineStopReportFilters = {
      ...filters,
      ...(cell?.boyut === "makine" ? { machineId: [cell.deger] } : {}),
      ...(cell?.boyut === "istasyon" ? { stationKind: [cell.deger as StationKind] } : {}),
      ...(cell?.boyut === "sebep" ? { reasonCode: [cell.deger] } : {}),
    };
    const res = await buildMachineStopsReport({ window: dayWindow(range, compareRange, mode), filters: f });
    if (first) { first = false; onMain?.(res.detay); }
    return res;
  };
}
