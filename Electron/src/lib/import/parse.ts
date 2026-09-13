// =============================================================================
// DOSYA AYRIŞTIRMA — .xlsx / .csv → satır dizisi
// =============================================================================
// Backend'de CSV/XLSX ayrıştırıcı YOKTUR (Allowed Packages) — biçim panelin
// sorunudur, sunucuya yalnız `{rowNo, cells}` gider. Bu dosya o dönüşümü yapar.
//
// ⚠️ Hücreler METİN olarak gönderilir; tip dönüşümü (sayı/tarih/evet-hayır)
// SUNUCUDA, tek yerde yapılır. Panelin "12,5"i sayıya çevirmesi ikinci bir
// yorum katmanı demektir ve iki katman er ya da geç ayrışır.

import type { ImportColumn, ImportRowInput } from "@/services/importService";
import { upperTr } from "../tr-case";

export interface ParsedFile {
  /** Dosyadaki başlık satırının hücreleri (ham). */
  headers: string[];
  /** Veri satırları — `rowNo` DOSYADAKİ satır numarasıdır (başlık 1 ise ilk veri 2). */
  rows: Array<{ rowNo: number; cells: string[] }>;
}

export interface MappedRows {
  rows: ImportRowInput[];
  /** Spec'te karşılığı bulunamayan başlıklar — kullanıcıya söylenir. */
  unmatchedHeaders: string[];
  /** Şablonda olup dosyada bulunmayan ZORUNLU sütunlar. */
  missingRequired: ImportColumn[];
}

/** Türkçe-duyarsız başlık karşılaştırma anahtarı. */
function headerKey(s: string): string {
  return upperTr(s.replace(/\s+/g, " ").trim())
    .replace(/[İI]/g, "I")
    .replace(/[Şş]/g, "S")
    .replace(/[Ğğ]/g, "G")
    .replace(/[Üü]/g, "U")
    .replace(/[Öö]/g, "O")
    .replace(/[Çç]/g, "C");
}

// --- CSV ---------------------------------------------------------------------

/**
 * Ayracı TESPİT eder: `;` `,` `\t` arasından, başlık satırında en çok geçen
 * (tırnak dışında). Biçimi dayatmak yerine tespit etmek şart — bizim CSV'miz
 * `;` yazar ama müşteri dosyası `,` olabilir.
 */
function detectDelimiter(firstLine: string): string {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let bestCount = -1;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** RFC4180 uyumlu CSV ayrıştırma (tırnak içinde ayraç/satır sonu güvenli). */
export function parseCsv(text: string): ParsedFile {
  // BOM'u at (Excel'in yazdığı UTF-8 dosyalarda ilk karakter).
  const content = text.replace(/^\uFEFF/, "");
  const firstLineEnd = content.search(/\r?\n/);
  const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd);
  const delim = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // CRLF'in CR'ı — yok say.
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return {
    headers,
    rows: rows
      .map((cells, i) => ({ rowNo: i + 2, cells }))
      // Tamamen boş satırlar atlanır (Excel dosyalarının sonunda tipik).
      .filter((r) => r.cells.some((c) => c.trim() !== "")),
  };
}

// --- XLSX --------------------------------------------------------------------

/** .xlsx'in İLK sayfasını okur (exceljs dinamik yüklenir — açılış şişmesin). */
export async function parseXlsx(file: File): Promise<ParsedFile> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headers: string[] = [];
  const headerRow = ws.getRow(1);
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellToText(cell.value).trim();
  });

  const rows: Array<{ rowNo: number; cells: string[] }> = [];
  ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= headers.length; c++) {
      cells[c - 1] = cellToText(r.getCell(c).value);
    }
    if (cells.some((c) => c.trim() !== "")) rows.push({ rowNo: rowNumber, cells });
  });

  return { headers, rows };
}

/**
 * Excel hücresi → metin. ⚠️ TARİH hücreleri `Date` gelir ve `toISOString()`
 * UTC'ye kayar (yerel 00:00 → önceki gün 21:00) — GG.AA.YYYY olarak YEREL
 * bileşenlerden yazılır, sunucu da onu fabrika günü olarak okur.
 */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(value.getDate())}.${p(value.getMonth() + 1)}.${value.getFullYear()}`;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    // Formül hücresi → hesaplanan sonuç; zengin metin → düz metin; hyperlink → metin.
    if ("result" in v) return cellToText(v.result);
    if ("text" in v) return cellToText(v.text);
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
    }
    if ("hyperlink" in v) return String(v.hyperlink ?? "");
    if ("error" in v) return "";
    return "";
  }
  return String(value);
}

// --- Ortak giriş noktası ------------------------------------------------------

export async function parseSpreadsheet(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return parseXlsx(file);
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseCsv(await file.text());
  throw new Error("Desteklenmeyen dosya türü — .xlsx ya da .csv yükleyin.");
}

/**
 * SÜTUN EŞLEMESİ — dosya başlığı → şablon sütunu.
 *
 * Dizinin i. elemanı, dosyanın i. sütununun hangi şablon sütununa gittiğini
 * söyler (`null` = yok sayılacak). Ayrı bir tip olmasının sebebi kullanıcının
 * bunu DÜZENLEYEBİLMESİ: dosya bizim şablonumuzsa otomatik eşleme yeter, ama
 * müşterinin kendi Excel'inde başlık "Kumaş Kodu" değil "ÜRÜN" olur ve elle
 * eşleme sektör standardıdır (Odoo / NetSuite / Salesforce / Dynamics hepsinde
 * açık bir eşleme adımı vardır).
 */
export type ColumnMapping = Array<string | null>;

/**
 * Başlıkları şablon sütunlarına OTOMATİK eşler (etikete göre, Türkçe-duyarsız;
 * sütun ANAHTARI da kabul edilir ki dışa aktarılan ham dosya da yüklenebilsin).
 */
export function autoMapColumns(parsed: ParsedFile, columns: ImportColumn[]): ColumnMapping {
  const byLabel = new Map<string, ImportColumn>();
  for (const c of columns) {
    byLabel.set(headerKey(c.label), c);
    byLabel.set(headerKey(c.key), c);
  }
  return parsed.headers.map((h) => (h ? (byLabel.get(headerKey(h))?.key ?? null) : null));
}

/** Eşlemeye göre satırları kurar. Eşlenmemiş sütun DÜŞER. */
export function applyMapping(parsed: ParsedFile, mapping: ColumnMapping): ImportRowInput[] {
  return parsed.rows.map((r) => {
    const cells: Record<string, string> = {};
    mapping.forEach((key, i) => {
      if (!key) return;
      const raw = r.cells[i];
      if (raw === undefined) return;
      cells[key] = String(raw);
    });
    return { rowNo: r.rowNo, cells };
  });
}

/** Eşlenmemiş dosya başlıkları — sessizce düşmesinler diye raporlanır. */
export function unmatchedHeadersOf(parsed: ParsedFile, mapping: ColumnMapping): string[] {
  return parsed.headers.filter((h, i) => Boolean(h) && !mapping[i]);
}

/** Eşlemede karşılığı olmayan ZORUNLU şablon sütunları. */
export function missingRequiredOf(columns: ImportColumn[], mapping: ColumnMapping): ImportColumn[] {
  const present = new Set(mapping.filter(Boolean) as string[]);
  return columns.filter((c) => c.required && !c.readOnly && !present.has(c.key));
}

/**
 * Otomatik eşleme + satır kurulumu (tek adım).
 * Karşılığı olmayan sütunlar DÜŞÜRÜLÜR ama kullanıcıya SÖYLENİR — sessizce
 * yok saymak "yükledim ama o alan boş kaldı" şikayetinin kaynağıdır.
 */
export function mapRows(parsed: ParsedFile, columns: ImportColumn[]): MappedRows {
  const mapping = autoMapColumns(parsed, columns);
  return {
    rows: applyMapping(parsed, mapping),
    unmatchedHeaders: unmatchedHeadersOf(parsed, mapping),
    missingRequired: missingRequiredOf(columns, mapping),
  };
}

/**
 * BAŞLIKSIZ blok — yapıştırma için.
 *
 * `parseCsv` 1. satırı KOŞULSUZ başlık sayar ve veri satırlarını 2'den
 * numaralar. Kullanıcı Excel'den başlık satırı OLMADAN kopyaladıysa ilk satır
 * sessizce yenirdi — bu, buradaki en kötü arıza (bir kayıt kaybolur ve hiçbir
 * şey söylemez). Bu dönüşüm o bloğu düzeltir:
 *   • başlıklar `Sütun 1…N` olur (otomatik eşleme çalışamaz → eşleme adımı zorunlu)
 *   • eski başlık satırı `rowNo: 1` ile VERİ olur
 *   • diğer satırların numarası bir azalır
 *
 * ⚠️ Numaralar YAPIŞTIRILAN BLOĞA göredir; dosya yok, 1'den başlamak tek dürüst
 * numaralandırma. Arayüz bunu açıkça yazar.
 */
export function withoutHeaderRow(p: ParsedFile): ParsedFile {
  const width = Math.max(p.headers.length, ...p.rows.map((r) => r.cells.length), 0);
  return {
    headers: Array.from({ length: width }, (_, i) => `Sütun ${i + 1}`),
    rows: [
      { rowNo: 1, cells: p.headers },
      ...p.rows.map((r) => ({ rowNo: r.rowNo - 1, cells: r.cells })),
    ],
  };
}
