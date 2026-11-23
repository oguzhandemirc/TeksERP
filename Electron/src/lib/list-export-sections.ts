// Tablosuz liste sütunlarının çıktı diyaloğu kataloğu + bölümlü çıktı (Kumaş Stoğu Özeti: kategori başına bölüm).
// Üretim `list-export`in motorundan geçer — bölüm Excel'de ayrı sayfa, PDF'te başlıklı ayrı tablo, hücre metni aynı.

import { buildWorkbook, saveWorkbook } from "./xlsx-export";
import {
  buildListSheet,
  exportRowsToCsv,
  exportRowsToPdf,
  exportRowsToXlsx,
  listBlockHtml,
  saveListPdf,
  wrapListHtml,
  type ExportColumn,
} from "./list-export";
import { assertKnownColumns, type ExportColumnOption, type ExportFormat } from "./export-columns";

/** Tablosuz liste sütunlarının diyalog kataloğu (sıra = tanım sırası). */
export function listExportCatalog<T>(cols: readonly ExportColumn<T>[]): ExportColumnOption[] {
  return cols.map((c) => ({ id: c.id ?? c.label, label: c.label, visible: !c.hidden }));
}

/** Seçili id'lerle sütun alt kümesi, tanım sırasıyla (tanınmayan id fırlatır — fail-closed). */
export function pickListColumns<T>(cols: readonly ExportColumn<T>[], ids: readonly string[]): ExportColumn<T>[] {
  assertKnownColumns(listExportCatalog(cols), ids);
  const set = new Set(ids);
  return cols.filter((c) => set.has(c.id ?? c.label));
}

/** Tablosuz liste için diyaloğun tek çağrısı: biçim + seçili sütunlar. */
export async function exportListAs<T>(
  format: ExportFormat,
  cols: readonly ExportColumn<T>[],
  columnIds: readonly string[],
  rows: T[],
  filename: string,
  notes?: string[],
): Promise<boolean> {
  const picked = pickListColumns(cols, columnIds);
  if (format === "pdf") return exportRowsToPdf(picked, rows, filename, notes);
  if (format === "csv") return exportRowsToCsv(picked, rows, filename);
  return exportRowsToXlsx(picked, rows, filename, notes);
}

/** Bölümlü çıktının tek bölümü (Excel'de ayrı sayfa, PDF'te başlıklı ayrı tablo). */
export interface ExportSection<T> {
  title: string;
  cols: ExportColumn<T>[];
  rows: T[];
  notes?: string[];
  /** true → TOPLAM satırı yok (örtüşen kategoriler: toplamak çift sayar). */
  noTotals?: boolean;
}

const htmlEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Excel sayfa adı: ≤31 karakter, yasak karakter yok, tekil (Excel aynı adı reddeder). */
function sheetNames(titles: string[]): string[] {
  const used = new Set<string>();
  return titles.map((t) => {
    const base = (t.replace(/[\\/?*[\]:]/g, " ").trim() || "Sayfa").slice(0, 28);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Bölümlerden PDF HTML'i — her bölüm `h2` + tek liste gövdesi (aynı motor). */
export function buildSectionsHtml(title: string, sections: ExportSection<unknown>[]): string {
  return wrapListHtml(
    title,
    sections
      .map((s) => `<h2>${htmlEsc(s.title)}</h2>\n    ${listBlockHtml(s.cols, s.rows, s.notes, s.noTotals)}`)
      .join("\n    "),
  );
}

/** Bölümlerden Excel sayfaları (sayfa başına bölüm; başlık satırı bölüm adı). */
export function buildSectionSheets(title: string, sections: ExportSection<unknown>[]) {
  const names = sheetNames(sections.map((s) => s.title));
  return sections.map((s, i) => ({
    ...buildListSheet(s.cols, s.rows, `${title} — ${s.title}`, s.notes, { noTotals: s.noTotals }),
    name: names[i]!,
  }));
}

/** Bölümlü çıktıyı kaydeder (Excel: çok sayfa · PDF: başlıklı tablolar). */
export async function exportSectionsAs(
  format: Exclude<ExportFormat, "csv">,
  title: string,
  sections: ExportSection<unknown>[],
  filename: string,
): Promise<boolean> {
  if (format === "pdf") {
    const rowCount = sections.reduce((a, s) => a + s.rows.length, 0);
    return saveListPdf(() => buildSectionsHtml(title, sections), filename, rowCount);
  }
  return saveWorkbook(await buildWorkbook(buildSectionSheets(title, sections)), filename);
}
