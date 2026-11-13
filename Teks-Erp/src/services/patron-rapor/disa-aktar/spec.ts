// =============================================================================
// Patron rapor dosyası — `RaporSunumu` → TEK dışa aktarım spec'i (PDF = Excel aynı spec'ten).
// Panelin `_v2/export-spec.ts` + `table-model.ts` + `variant-model.ts` + `grafik/veriTablosu.ts` AYNASI (iki kopya
// kararı 2026-11-13); sapmayı altın dosya ölçer. Grafik çizimi YOK (ECharts sunucuda yok): PDF'e veri tablosu girer.
// =============================================================================
import { factoryDateTr } from "../../../constants/time";
import {
  ANLATI_PDF_SAYISI, BIRIM_METNI, PARA_BIRIMLERI, SIDE_FIGURE_LIMIT,
  type DonemBlok, type GrafikBlok, type ParametreBeyani, type RaporSunumu, type TabloBlok, type TabloKolonu, type VaryantBlok,
} from "../../reports/sunum/sunum.types";
import { comparisonText, formatDisplay, formatFigure, MONEY_NUM_FMT, NOT_MEASURED_TEXT } from "./sayi";

export interface ReportColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
  align?: "left" | "right";
}

export interface ReportTableSpec {
  name: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  totalRow?: Record<string, unknown>;
  notes?: string[];
}

export interface AnaSayiKarti {
  ad: string;
  deger: string;
  kiyas?: string;
  ana?: boolean;
}

export type ExportBlok =
  | { tur: "anaSayi"; kartlar: AnaSayiKarti[] }
  | { tur: "anlati"; cumleler: string[] }
  | { tur: "grafik"; baslik: string; veri: ReportTableSpec }
  | { tur: "tanimlar"; satirlar: { ad: string; aciklama: string }[] };

export interface ReportExportSpec {
  title: string;
  subtitle?: string;
  meta?: string[];
  tables: ReportTableSpec[];
  soru?: string;
  parametreCumlesi?: string;
  kiyasDonemi?: string;
  basimAni?: Date;
  uyarilar?: string[];
  bloklar: ExportBlok[];
}

/** Koşum dosyası biçimleri: `xlsx` (Excel) ve `html` (telefon PDF'e çevirir) — ikisi de AYNI spec'ten. */
export const PATRON_REPORT_FILE_FORMATS = ["xlsx", "html"] as const;
export type PatronReportFileFormat = (typeof PATRON_REPORT_FILE_FORMATS)[number];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Saklı sonuç dışa aktarılabilir bir sunum zarfı mı (uygulamanın `isPresentation`ından SIKI: spec'in okuduğu her alan). */
export function isRaporSunumu(v: unknown): v is RaporSunumu {
  if (!isObj(v)) return false;
  const arr = (k: string) => Array.isArray(v[k]);
  return (
    typeof v.baslik === "string" && typeof v.soru === "string" && isObj(v.donem) && typeof v.donem.etiket === "string" &&
    isObj(v.anaSayi) && typeof v.anaSayi.ad === "string" &&
    arr("yanSayilar") && arr("anlati") && arr("tanimlar") && arr("parametreler") && arr("uyarilar") &&
    (v.tablo === null || v.tablo === undefined || (isObj(v.tablo) && Array.isArray(v.tablo.kolonlar) && Array.isArray(v.tablo.satirlar))) &&
    (v.grafik === null || v.grafik === undefined || (isObj(v.grafik) && Array.isArray(v.grafik.seriler) && Array.isArray(v.grafik.kategoriler)))
  );
}

/** Koşumun indirilebilir biçimleri: yalnız HAZIR ve sunum zarflı sonuç; değilse boş (uygulama düğmeyi gizler). */
export function fileFormatsOf(status: string, result: unknown): PatronReportFileFormat[] {
  return status === "HAZIR" && isRaporSunumu(result) ? [...PATRON_REPORT_FILE_FORMATS] : [];
}

// ---------- Tablo (panel `table-model.ts`) ----------
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function columnFormat(table: TabloBlok, column: TabloKolonu): Pick<ReportColumn, "numFmt"> {
  const values = [...table.satirlar, ...(table.toplam ? [table.toplam] : [])].map((r) => r[column.anahtar]).filter(isNumber);
  if (values.length === 0) return {};
  if (column.birim && PARA_BIRIMLERI.includes(column.birim)) return { numFmt: MONEY_NUM_FMT };
  return values.every((v) => Number.isInteger(v)) ? { numFmt: "0" } : { numFmt: "0.0" };
}

const columnHeader = (c: TabloKolonu): string => (c.birim ? `${c.baslik} (${BIRIM_METNI[c.birim]})` : c.baslik);

function columnAlign(table: TabloBlok, column: TabloKolonu): "left" | "right" {
  if (column.hiza === "sag") return "right";
  if (column.hiza === "sol" || column.hiza === "orta") return "left";
  return columnFormat(table, column).numFmt ? "right" : "left";
}

function truncationNote(table: TabloBlok): string | null {
  const k = table.kesildi;
  if (!k) return null;
  return `İlk ${formatDisplay(k.gosterilen, 0)} satır gösteriliyor (toplam ${formatDisplay(k.toplam, 0)}).`;
}

export function tableToExport(table: TabloBlok, name: string): ReportTableSpec {
  const note = truncationNote(table);
  return {
    name,
    columns: table.kolonlar.map((c) => ({ header: columnHeader(c), key: c.anahtar, ...columnFormat(table, c), align: columnAlign(table, c) })),
    rows: table.satirlar,
    totalRow: table.toplam,
    notes: note ? [note] : undefined,
  };
}

// ---------- Varyant + dönem (panel `variant-model.ts`) ----------
function emptyLabelOf(paramName: string): string | undefined {
  if (paramName === "varyant") return "Tek";
  if (paramName === "donemler") return "Kapalı";
  return undefined;
}

function variantToExport(block: VaryantBlok, periodLabel?: string): ReportTableSpec | null {
  const cells = block.hucreler ?? [];
  if (cells.length === 0) return null;
  return {
    name: `${block.boyutEtiketi} kırılımı`,
    columns: [{ header: block.boyutEtiketi, key: "ad" }, { header: cells[0]!.anaSayi.ad, key: "deger", align: "right" }, { header: "Kıyas", key: "kiyas" }],
    rows: cells.map((c) => ({ ad: c.ad, deger: formatFigure(c.anaSayi.deger, c.anaSayi.birim), kiyas: comparisonText(c.anaSayi, periodLabel) ?? "" })),
  };
}

function periodsToExport(periods: readonly DonemBlok[]): ReportTableSpec | null {
  if (periods.length === 0) return null;
  return {
    name: "Dönem kıyası",
    columns: [{ header: "Dönem", key: "donem" }, { header: periods[0]!.anaSayi.ad, key: "deger", align: "right" }, { header: "Kıyas", key: "kiyas" }],
    rows: periods.map((d, i) => {
      const prev = i > 0 ? periods[i - 1] : undefined;
      const last = i === periods.length - 1;
      const value = formatFigure(d.anaSayi.deger, d.anaSayi.birim);
      const notMeasured = d.anaSayi.deger === null;
      return {
        donem: d.etiket,
        deger: notMeasured && d.anaSayi.olculemedi ? `${NOT_MEASURED_TEXT} (${d.anaSayi.olculemedi})` : value,
        kiyas: (last && prev ? comparisonText(d.anaSayi, prev.etiket) : null) ?? "",
      };
    }),
  };
}

// ---------- Grafik veri tablosu (panel `grafik/veriTablosu.ts` + `grafik/bicim.ts`) ----------
const sonlu = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unitText = (birim: string): string => (BIRIM_METNI as Readonly<Record<string, string>>)[birim] ?? birim;

function kategoriEtiketi(k: string, xTur: GrafikBlok["eksen"]["x"]["tur"]): string {
  if (xTur !== "zaman") return k;
  const gun = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
  if (gun) return `${gun[3]}.${gun[2]}.${gun[1]}`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(k)) {
    const d = new Date(k);
    return Number.isNaN(d.getTime()) ? k : factoryDateTr(d);
  }
  const ay = /^(\d{4})-(\d{2})$/.exec(k);
  return ay ? `${ay[2]}.${ay[1]}` : k;
}

function kutuIstatistigi(veri: (number | null)[]): [number, number, number, number, number] | null {
  const s = veri.filter(sonlu).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const a = Math.floor(i);
    const b = Math.ceil(i);
    return s[a]! + (s[b]! - s[a]!) * (i - a);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const ic = s.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  return [ic[0] ?? s[0]!, q1, q(0.5), q3, ic[ic.length - 1] ?? s[s.length - 1]!];
}

const bicim = (values: unknown[]): Pick<ReportColumn, "numFmt"> =>
  values.filter(sonlu).every((v) => Number.isInteger(v)) ? { numFmt: "0" } : { numFmt: "0.0" };

function grafikVeriTablosu(blok: GrafikBlok, ad: string): ReportTableSpec {
  const birim = unitText(blok.eksen.y.birim);
  const ek = birim ? ` (${birim})` : "";
  if (blok.tur === "kutu") {
    const ist = blok.seriler.map((s) => kutuIstatistigi(s.veri));
    const fmt = bicim(ist.flatMap((k) => k ?? []));
    const headers = ["En küçük", "Alt çeyrek", "Orta değer", "Üst çeyrek", "En büyük"];
    return {
      name: ad,
      columns: [
        { header: blok.eksen.x.ad || "Grup", key: "g" },
        ...headers.map((h, i) => ({ header: `${h}${ek}`, key: `k${i}`, ...fmt, align: "right" as const })),
        { header: "Kayıt sayısı", key: "n", numFmt: "0", align: "right" as const },
      ],
      rows: blok.seriler.map((s, j) => ({ g: s.ad, ...Object.fromEntries(headers.map((_, i) => [`k${i}`, ist[j]?.[i] ?? "—"])), n: s.veri.filter(sonlu).length })),
    };
  }
  return {
    name: ad,
    columns: [{ header: blok.eksen.x.ad, key: "k" }, ...blok.seriler.map((s, i) => ({ header: `${s.ad}${ek}`, key: `s${i}`, ...bicim(s.veri), align: "right" as const }))],
    rows: blok.kategoriler.map((k, j) => ({
      k: kategoriEtiketi(k, blok.eksen.x.tur),
      ...Object.fromEntries(blok.seriler.map((s, i) => [`s${i}`, sonlu(s.veri[j]) ? s.veri[j] : "—"])),
    })),
  };
}

// ---------- Spec (panel `export-spec.ts`) ----------
export function parameterSentence(params: readonly ParametreBeyani[]): string | undefined {
  const parts = params
    .filter((p) => p.tur !== "tarih")
    .map((p) => {
      const values = p.deger === null ? [] : Array.isArray(p.deger) ? p.deger : [String(p.deger)];
      const labels = values.map((v) => p.secenekler?.find((o) => o.deger === v)?.etiket ?? v);
      return `${p.etiket}: ${labels.length ? labels.join(", ") : (emptyLabelOf(p.ad) ?? "Tümü")}`;
    });
  return parts.length ? parts.join(" · ") : undefined;
}

export function buildExportSpec(p: RaporSunumu): ReportExportSpec {
  const cards: AnaSayiKarti[] = [
    { ad: p.anaSayi.ad, deger: formatFigure(p.anaSayi.deger, p.anaSayi.birim), kiyas: comparisonText(p.anaSayi, p.kiyasDonemi?.etiket) ?? undefined, ana: true },
    ...p.yanSayilar.slice(0, SIDE_FIGURE_LIMIT).map((f) => ({ ad: f.ad, deger: formatFigure(f.deger, f.birim) })),
  ];
  const bloklar: ExportBlok[] = [
    { tur: "anaSayi", kartlar: cards },
    { tur: "anlati", cumleler: p.anlati.slice(0, ANLATI_PDF_SAYISI).map((c) => c.metin) },
  ];
  if (p.grafik) bloklar.push({ tur: "grafik", baslik: p.baslik, veri: grafikVeriTablosu(p.grafik, "Grafik verisi") });
  if (p.tanimlar.length) bloklar.push({ tur: "tanimlar", satirlar: p.tanimlar.map((t) => ({ ad: t.ad, aciklama: t.aciklama })) });
  return {
    title: p.baslik,
    subtitle: p.donem.etiket,
    soru: p.soru,
    kiyasDonemi: p.kiyasDonemi?.etiket,
    parametreCumlesi: parameterSentence(p.parametreler),
    uyarilar: p.uyarilar.length ? p.uyarilar : undefined,
    tables: [
      ...[p.varyant ? variantToExport(p.varyant, p.kiyasDonemi?.etiket) : null, p.donemler ? periodsToExport(p.donemler) : null].filter((t) => t !== null),
      ...(p.tablo ? [tableToExport(p.tablo, "Tablo")] : []),
    ],
    bloklar,
  };
}
