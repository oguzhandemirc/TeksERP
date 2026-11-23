import type { Column, RowData, Table } from "@tanstack/react-table";
import {
  exportRowsToCsv,
  exportRowsToPdf,
  exportRowsToXlsx,
  buildCsvContent,
  type ExportColumn,
} from "./list-export";
import { factoryDayKey } from "@/lib/factory-time";
import { assertKnownColumns, orderByCatalog, type ExportColumnOption, type ExportFormat } from "./export-columns";

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
    /** Hücre hizası — verilmezse toplanabilir kolon sağa, diğerleri sola (DataTable). */
    align?: "left" | "right" | "center";
    /** Yalnız dosyada, bu kolonun hemen ardından yazılan ek sütunlar (ekranda gerekmeyen ayrıntı,
     *  ör. "İE sayısı"). Görünürlüğü ana kolonu izler. */
    exportExtras?: { label: string; value: (row: TData) => unknown; summable?: boolean }[];
    /** true → hücre ÇOK SATIRA sarılır (başlık + gövde gibi); varsayılan tek satır + "…" (DataTable). */
    wrap?: boolean;
    /** Yalnız dosyadaki sütun adı (ekranda/Sütunlar menüsünde `label`/başlık kalır). */
    exportLabel?: string;
    /** true → dışa aktarıma girmez (düğme sütunu: "Belgeler" gibi); Sütunlar menüsünde kalır. */
    noExport?: boolean;
    /** "right" → sütun yatay kaydırmada sağa yapışık kalır (eylem sütunu; yalnız SON sütunda doğru). */
    sticky?: "right";
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

const isExportable = <T,>(c: Column<T, unknown>) =>
  c.id !== "select" && c.id !== "actions" && !c.columnDef.meta?.noExport;

/** Dosyaya girebilen BÜTÜN sütunlar, ekrandaki sırayla (gizliler dahil) — çıktı diyaloğunun kataloğu. */
export function tableExportCatalog<T>(table: Table<T>): ExportColumnOption[] {
  const order = table.getState().columnOrder ?? [];
  const all = table.getAllLeafColumns().filter(isExportable);
  const pos = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length + all.findIndex((c) => c.id === id) : i;
  };
  return [...all]
    .sort((a, b) => pos(a.id) - pos(b.id))
    .map((c) => ({ id: c.id, label: c.columnDef.meta?.exportLabel ?? columnLabel(c), visible: c.getIsVisible() }));
}

/** Dosyanın sütunları: `columnIds` verilirse o seçim (katalog sırasıyla; tanınmayan id fırlatır), yoksa görünürler. */
function tableExportCols<T>(table: Table<T>, columnIds?: readonly string[]): Column<T, unknown>[] {
  if (!columnIds) return table.getVisibleLeafColumns().filter(isExportable);
  const catalog = tableExportCatalog(table);
  assertKnownColumns(catalog, columnIds);
  return orderByCatalog(catalog, columnIds).map((id) => table.getColumn(id)!);
}

/** TanStack kolonları → motorun anladığı sütun tarifleri. */
export function toExportColumns<T>(table: Table<T>, columnIds?: readonly string[]): ExportColumn<T>[] {
  return tableExportCols(table, columnIds).flatMap((c) => [
    {
      label: c.columnDef.meta?.exportLabel ?? columnLabel(c),
      value: (row: T) => rawCellValue(c, row),
      summable: Boolean(c.columnDef.meta?.summable),
    },
    ...(c.columnDef.meta?.exportExtras ?? []).map((x) => ({
      label: x.label,
      value: x.value,
      summable: Boolean(x.summable),
    })),
  ]);
}

/** yyyy-MM-dd (dosya adına eklenen, sıralanabilir tarih damgası). */
function dateStamp(d: Date = new Date()): string {
  return factoryDayKey(d);
}

/** ISO an → yyyy-MM-dd (FABRİKA günü). Filtre sınırları fabrika gününün 00:00/23:59'u
 *  olarak gönderiliyor (`useReportDateRange` sözleşmesi) — UTC'ye çevirmek dosya adında
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
  columnIds?: readonly string[],
): Promise<void> {
  await exportRowsToXlsx(toExportColumns(table, columnIds), rows, filename);
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
  columnIds?: readonly string[],
): Promise<boolean> {
  return exportRowsToPdf(toExportColumns(table, columnIds), rows, filename);
}

/** Verilen satırları .csv olarak kaydeder (; ayraç + ondalık virgül + BOM). */
export async function exportTableToCsv<T>(
  table: Table<T>,
  rows: T[],
  filename = "tablo",
  columnIds?: readonly string[],
): Promise<boolean> {
  return exportRowsToCsv(toExportColumns(table, columnIds), rows, filename);
}

/** Çıktı diyaloğunun tek çağrısı: biçim + satırlar + seçili sütunlar (üç biçim aynı sütun tarifinden). */
export async function exportTableAs<T>(
  format: ExportFormat,
  table: Table<T>,
  rows: T[],
  filename: string,
  columnIds?: readonly string[],
): Promise<boolean | void> {
  if (format === "pdf") return exportTableToPdf(table, rows, filename, columnIds);
  if (format === "csv") return exportTableToCsv(table, rows, filename, columnIds);
  return exportTableToXlsx(table, rows, filename, columnIds);
}

/** CSV metni (dosyaya yazmadan) — test/önizleme için. */
export function buildCsv<T>(table: Table<T>, rows: T[], columnIds?: readonly string[]): string {
  return buildCsvContent(toExportColumns(table, columnIds), rows);
}
