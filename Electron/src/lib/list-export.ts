// Düz dizi dışa aktarımı (PDF / Excel / CSV) — TanStack tablosu OLMAYAN ekranlar için.
// `table-export.ts` bunun TanStack adaptörüdür: kolonları `ExportColumn`'a çevirip
// aynı üç üreticiyi çağırır. Tek motor olması şart — ayrışırsa aynı listenin PDF'i ile
// Excel'i farklı sayı/biçim gösterir (bu projede rapor tarafında bir kez yaşandı,
// `reportExport.ts` orada tek spec'e indirilmişti).

import { toast } from "sonner";
import { buildWorkbook, saveWorkbook, type SheetSpec } from "./xlsx-export";
import { upTo3ExcelNumFmt, upTo3Text } from "./number-format";
import { saveTextAs } from "./file-save";

/** Tek sütun tarifi: başlık + satırdan değer çıkaran fonksiyon. */
export interface ExportColumn<T> {
  label: string;
  value: (row: T) => unknown;
  /** true → Excel/CSV'de SAYI (toplanabilir) + altta TOPLAM satırına girer. */
  summable?: boolean;
}

// PDF üst sınırı: bunun üstünde tek PDF pratik değil (offscreen render çökme riski +
// yüzlerce sayfa) → kullanıcı Excel'e yönlendirilir.
const PDF_MAX_ROWS = 10000;

const CSV_SEP = ";";
// ⚠️ Kaçış dizisiyle yazılır: HAM BOM karakteri kaynak dosyada görünmez bir
// "düzensiz boşluk"tur (eslint no-irregular-whitespace) ve kopyalanınca kaybolur.
const CSV_BOM = "\uFEFF";
export const CSV_MIME = "text/csv;charset=utf-8";

// --- değer → metin/sayı ------------------------------------------------------

function pickName(o: Record<string, unknown>): string {
  for (const k of ["name", "code", "label", "title", "fullName", "username"]) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  for (const k of ["property", "color", "item", "customer", "station", "branch"]) {
    const nested = o[k];
    if (nested && typeof nested === "object") {
      const n = pickName(nested as Record<string, unknown>);
      if (n) return n;
    }
  }
  return "";
}

/** Herhangi bir değeri hücre metnine çevirir (ilişkili kayıtta ad/kod alanını seçer). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toLocaleString("tr-TR");
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(", ");
  if (typeof v === "object") return pickName(v as Record<string, unknown>);
  return String(v);
}

/** Sayısal hücre değeri; sayı değilse metinden ayıklar ("180 cm" → 180), çözülemezse 0. */
export function cellNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(
    String(v ?? "")
      .replace(/[^\d.,-]/g, "")
      .replace(/\.(?=.*\.)/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(n) ? n : 0;
}

// --- CSV ---------------------------------------------------------------------

/** Bir hücreyi CSV alanına çevirir (tırnak/ayraç/satır sonu/baş-son boşluk → tırnaklanır). */
export function csvCell(value: string): string {
  const v = value ?? "";
  const needsQuote =
    v.includes(CSV_SEP) || v.includes('"') || v.includes("\n") || v.includes("\r") || v !== v.trim();
  return needsQuote ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Sayı → TR ondalık (virgül), binlik ayraç YOK. */
export function csvNumber(n: number): string {
  return String(n).replace(".", ",");
}

/**
 * "Türk Excel'i" CSV'si: `;` ayraç + ondalık VİRGÜL + UTF-8 BOM + CRLF.
 * Üçü BİRLİKTE bir sözleşmedir: tr-TR Excel'de ondalık virgül olduğu için ayraç
 * zorunlu olarak `;` olur ("1,5" aksi halde iki hücreye bölünür) ve aynı sebeple
 * "1234.5" yazmak hücreyi METNE düşürür (SUM sessizce çalışmaz). BOM olmadan
 * Türkçe karakterler çift tıkla açılan dosyada bozulur (Excel UTF-8 sniff etmez).
 * ⚠️ İçe aktarıcımız ayraç + ondalığı otomatik algılar → round-trip çalışır.
 */
export function buildCsvContent<T>(cols: ExportColumn<T>[], rows: T[]): string {
  const lines: string[] = [cols.map((c) => csvCell(c.label)).join(CSV_SEP)];
  for (const row of rows) {
    lines.push(
      cols
        .map((c) =>
          c.summable ? csvCell(csvNumber(cellNumber(c.value(row)))) : csvCell(cellText(c.value(row))),
        )
        .join(CSV_SEP),
    );
  }
  const totals = totalsOf(cols, rows);
  if (totals) {
    lines.push(
      cols
        .map((c, i) => {
          const v = totals[i];
          return v === undefined ? "" : csvCell(typeof v === "number" ? csvNumber(v) : v);
        })
        .join(CSV_SEP),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** summable kolon varsa TOPLAM satırı (kolon sırasına göre; etiket ilk metin kolonunda). */
function totalsOf<T>(cols: ExportColumn<T>[], rows: T[]): Array<string | number | undefined> | null {
  if (!cols.some((c) => c.summable) || rows.length === 0) return null;
  let labelPlaced = false;
  return cols.map((c) => {
    if (c.summable) return rows.reduce((s, r) => s + cellNumber(c.value(r)), 0);
    if (!labelPlaced) {
      labelPlaced = true;
      return `TOPLAM (${rows.length} kayıt)`;
    }
    return undefined;
  });
}

// --- üç çıktı ----------------------------------------------------------------

/**
 * Liste → Excel sayfası (PDF'le aynı başlık, "N kayıt", kolon, hiza ve görünen metin).
 * Sayı biçimi PDF metnini izler (`upTo3Text`, ≤3 hane — metre/kg Decimal(x,3)):
 * tam sayıda ondalık ayırıcı görünmez ("#,##0.###" 40'ı "40," gösteriyordu).
 */
export function buildListSheet<T>(cols: ExportColumn<T>[], rows: T[], filename: string, notes?: string[]): SheetSpec {
  const columns = cols.map((c, i) => ({
    header: c.label,
    key: `c${i}`,
    width: 20,
    ...(c.summable ? { numFmt: upTo3ExcelNumFmt(), align: "right" as const } : {}),
  }));
  const dataRows = rows.map((r) =>
    Object.fromEntries(cols.map((c, i) => [`c${i}`, c.summable ? cellNumber(c.value(r)) : cellText(c.value(r))])),
  );
  const t = totalsOf(cols, rows);
  const totalRow = t
    ? Object.fromEntries(t.map((v, i) => [`c${i}`, v]).filter(([, v]) => v !== undefined))
    : undefined;
  return {
    name: filename.slice(0, 31) || "Liste",
    preamble: [[filename], [`${rows.length} kayıt`]],
    columns,
    rows: dataRows,
    totalRow,
    notes,
  };
}

/** Satırları .xlsx olarak kaydeder (biçimli tek sayfa + TOPLAM satırı). */
export async function exportRowsToXlsx<T>(
  cols: ExportColumn<T>[],
  rows: T[],
  filename: string,
  notes?: string[],
): Promise<boolean> {
  const blob = await buildWorkbook([buildListSheet(cols, rows, filename, notes)]);
  return saveWorkbook(blob, filename);
}

/** Satırları .csv olarak kaydeder. */
export async function exportRowsToCsv<T>(
  cols: ExportColumn<T>[],
  rows: T[],
  filename: string,
): Promise<boolean> {
  return saveTextAs(buildCsvContent(cols, rows), `${filename}.csv`, CSV_MIME);
}

const htmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Satırlardan A4-yatay yazdırılabilir tablo HTML'i (PDF üretimi + baskı ortak). */
export function buildListHtml<T>(
  cols: ExportColumn<T>[],
  rows: T[],
  title: string,
  notes?: string[],
): string {
  const header = cols.map((c) => `<th>${htmlEsc(c.label)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${cols
          .map((c) =>
            c.summable
              ? // summable kolonlar gövdede de TR yerel biçimiyle — TOPLAM satırıyla AYNI
                // biçim; aksi halde sütun içinde '.' iki farklı anlam taşırdı.
                `<td class="num">${htmlEsc(upTo3Text(cellNumber(c.value(row))))}</td>`
              : `<td>${htmlEsc(cellText(c.value(row)))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  const t = totalsOf(cols, rows);
  const foot = t
    ? `<tfoot><tr>${t
        .map((v) =>
          typeof v === "number"
            ? `<td class="num"><strong>${htmlEsc(upTo3Text(v))}</strong></td>`
            : v
              ? `<td><strong>${htmlEsc(String(v))}</strong></td>`
              : "<td></td>",
        )
        .join("")}</tr></tfoot>`
    : "";

  const noteHtml = notes?.length
    ? `<div class="notes">${notes.map((n) => `<div>${htmlEsc(n)}</div>`).join("")}</div>`
    : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; }
    /* Belge KENDİ zeminini taşır: printToPDF printBackground:true ile koşuyor ve
       koyu zeminli bir pencerede render edilirse zemin devralınıp koyu-üstüne-koyu
       okunmaz bir PDF çıkar. color-scheme:light UA'nın karanlık mod dönüşümünü de
       kapatır. (Bu blok bir template literal içinde — backtick KULLANMA.) */
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body { font-family: Arial, "Helvetica Neue", sans-serif; font-size: 10px; color: #111; margin: 0; }
    h1 { font-size: 14px; margin: 0 0 10px; }
    .meta { font-size: 10px; color: #555; margin-bottom: 8px; }
    .notes { margin-top: 8px; font-size: 9px; color: #555; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #888; padding: 3px 6px; text-align: left; }
    td.num, th.num { text-align: right; }
    thead th { background: #eee; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f7f7f7; }
    tfoot td { background: #eee; border-top: 2px solid #333; }
  </style></head><body>
    <h1>${htmlEsc(title)}</h1>
    <div class="meta">${rows.length} kayıt</div>
    <table><thead><tr>${header}</tr></thead><tbody>${body}</tbody>${foot}</table>
    ${noteHtml}
  </body></html>`;
}

/** Satırları PDF olarak kaydeder (Electron printToPDF). PDF API yoksa false. */
export async function exportRowsToPdf<T>(
  cols: ExportColumn<T>[],
  rows: T[],
  filename: string,
  notes?: string[],
): Promise<boolean> {
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) return false;
  if (rows.length > PDF_MAX_ROWS) {
    toast.error(
      `Liste çok büyük (${rows.length.toLocaleString("tr-TR")} kayıt, ~${Math.ceil(
        rows.length / 35,
      ).toLocaleString("tr-TR")} sayfa) — PDF yerine Excel indirin.`,
    );
    return false;
  }
  const res = await pdfApi.save({ html: buildListHtml(cols, rows, filename, notes), suggestedName: filename });
  return res.saved;
}
