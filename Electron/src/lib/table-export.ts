import type { Column, RowData, Table } from "@tanstack/react-table";
import {
  exportRowsToCsv,
  exportRowsToPdf,
  exportRowsToXlsx,
  buildCsvContent,
  type ExportColumn,
} from "./list-export";

// TanStack tablosunun dışa aktarım ADAPTÖRÜ. Üretimin kendisi `list-export.ts`te —
// tablosuz ekranlar (kullanıcılar, cihazlar, yetenek matrisi…) aynı motoru kullanır;
// iki ayrı üretici olsaydı aynı listenin PDF'i ile Excel'i zamanla ayrışırdı.

// Kolon meta'sını genişlet: dışa aktarma için özel değer + okunur etiket + toplanabilirlik.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** CSV/etiket için okunur sütun adı (header bir bileşense). */
    label?: string;
    /** Türetilmiş/iç içe kolonlar için dışa aktarma değeri. */
    exportValue?: (row: TData) => unknown;
    /** true → Excel'de gerçek SAYI olarak yazılır + altına TOPLAM satırına eklenir
     *  (metre/kg/adet gibi). Diğer kolonlar metin. */
    summable?: boolean;
  }
}

/** Sütun için insan-okunur etiket: meta.label → string header → id. */
export function columnLabel<T>(col: Column<T, unknown>): string {
  const label = col.columnDef.meta?.label;
  if (label) return label;
  const h = col.columnDef.header;
  if (typeof h === "string" && h.trim()) return h;
  return col.id;
}

/** Ham nesneden (TanStack Row DEĞİL) bir kolonun HAM değeri: meta.exportValue →
 *  accessorFn (accessorKey de buna dönüşür) → düz alan. Metne/sayıya çevirmeyi
 *  `list-export` yapar (tek yerde). */
function rawCellValue<T>(col: Column<T, unknown>, original: T): unknown {
  const exportValue = col.columnDef.meta?.exportValue;
  if (exportValue) return exportValue(original);
  if (col.accessorFn) {
    try {
      return col.accessorFn(original, 0);
    } catch {
      /* accessor patlarsa düz alana düş */
    }
  }
  return (original as Record<string, unknown>)?.[col.id];
}

/** Görünür kolonlar (select/actions hariç) — export'lar paylaşır. */
function tableExportCols<T>(table: Table<T>): Column<T, unknown>[] {
  return table.getVisibleLeafColumns().filter((c) => c.id !== "select" && c.id !== "actions");
}

/** Görünür TanStack kolonları → motorun anladığı sütun tarifleri. */
function toExportColumns<T>(table: Table<T>): ExportColumn<T>[] {
  return tableExportCols(table).map((c) => ({
    label: columnLabel(c),
    value: (row: T) => rawCellValue(c, row),
    summable: Boolean(c.columnDef.meta?.summable),
  }));
}

/** yyyy-MM-dd (dosya adına eklenen, sıralanabilir tarih damgası). */
function dateStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO an → yyyy-MM-dd (YEREL gün). Filtre sınırları yerel 00:00/23:59 olarak
 *  gönderiliyor (`useReportDateRange` sözleşmesi) — UTC'ye çevirmek dosya adında
 *  günü kaydırırdı. Çözülemezse null (ad damgasız kalır, indirme düşmez). */
function isoToDayLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateStamp(d);
}

/**
 * İndirilen liste dosya adı — içeriği belli eden ad + tarih damgası.
 * `range` verilirse damga İNDİRME günü değil VERİNİN dönemidir ("Siparişler
 * 2026-08-01_2026-08-19"): elden ele dolaşan dosyada asıl soru "bu hangi döneme
 * ait", "ne zaman indirildi" değil. Aralık yoksa eski davranış (indirme günü).
 */
export function exportListName(
  base: string,
  opts?: { selected?: boolean; range?: { from?: string | null; to?: string | null } },
): string {
  const from = isoToDayLabel(opts?.range?.from);
  const to = isoToDayLabel(opts?.range?.to);
  const stamp = from || to ? `${from ?? "…"}_${to ?? "…"}` : dateStamp();
  return `${base || "Liste"}${opts?.selected ? " (seçili)" : ""} ${stamp}`;
}

/**
 * Verilen satırları (ham T[]) GERÇEK .xlsx olarak indirir (biçimli tek sayfa) —
 * görünür sütunlar. summable kolonlar SAYI olarak yazılır (formatlı, Excel'de
 * toplanabilir) + en altta kalın TOPLAM satırı. `rows` çağıranca belirlenir:
 * "yüklenenler", "seçili" veya (fetchAll ile) "filtreye uyan TÜM kayıtlar".
 */
export async function exportTableToXlsx<T>(
  table: Table<T>,
  rows: T[],
  filename = "tablo",
): Promise<void> {
  await exportRowsToXlsx(toExportColumns(table), rows, filename);
}

/**
 * Verilen satırları (ham T[]) yazdırılabilir A4-yatay PDF tablosu olarak kaydeder
 * (Electron printToPDF → kaydet dialoğu). Görünür sütunlar + başlık + summable
 * kolonlarda TOPLAM satırı. Çok büyük listelerde Excel tercih edilmeli (PDF ağır).
 */
export async function exportTableToPdf<T>(
  table: Table<T>,
  rows: T[],
  filename = "tablo",
): Promise<boolean> {
  return exportRowsToPdf(toExportColumns(table), rows, filename);
}

/** Verilen satırları .csv olarak kaydeder (; ayraç + ondalık virgül + BOM). */
export async function exportTableToCsv<T>(
  table: Table<T>,
  rows: T[],
  filename = "tablo",
): Promise<boolean> {
  return exportRowsToCsv(toExportColumns(table), rows, filename);
}

/** CSV metni (dosyaya yazmadan) — test/önizleme için. */
export function buildCsv<T>(table: Table<T>, rows: T[]): string {
  return buildCsvContent(toExportColumns(table), rows);
}
