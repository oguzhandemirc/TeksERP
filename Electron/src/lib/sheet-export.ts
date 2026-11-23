// SheetSpec tabanlı çıktılar (muhasebe dökümü, stok kalemi bazında…) için ortak diyalog motoru: sütun kataloğu,
// seçim, PDF. PDF hücresi Excel'in o hücreyi GÖSTERECEĞİ metindir (`sheetCellText` — sayı biçimi, birim eki, tarih);
// böylece Excel ile PDF aynı SheetSpec'ten aynı satırı ve aynı rakamı verir.
import { formatClassed } from "./format";
import { formatFactory } from "./factory-time";
import { assertKnownColumns, type ExportColumnOption, type ExportFormat } from "./export-columns";
import { saveListPdf, wrapListHtml } from "./list-export";
import { buildWorkbook, saveWorkbook, type SheetColumn, type SheetSpec } from "./xlsx-export";

const columnId = (sheet: number, key: string) => `${sheet}:${key}`;

/** Diyalog kataloğu — tek sayfada kolon başlığı, çok sayfada "Sayfa · Kolon". */
export function sheetColumnCatalog(sheets: readonly SheetSpec[]): ExportColumnOption[] {
  const many = sheets.length > 1;
  return sheets.flatMap((s, i) =>
    s.columns.map((c) => ({ id: columnId(i, c.key), label: many ? `${s.name} · ${c.header}` : c.header, visible: true })),
  );
}

/** Seçimi uygular; hiç kolonu kalmayan sayfa düşer. Tanınmayan id fırlatır (fail-closed). Alt tablolar seçime girmez. */
export function pickSheetColumns(sheets: readonly SheetSpec[], ids: readonly string[]): SheetSpec[] {
  assertKnownColumns(sheetColumnCatalog(sheets), ids);
  const set = new Set(ids);
  return sheets.flatMap((s, i) => {
    const columns = s.columns.filter((c) => set.has(columnId(i, c.key)));
    return columns.length > 0 ? [{ ...s, columns }] : [];
  });
}

/** Excel tarih biçimi → kalıp ("dd.mm.yyyy hh:mm" → "dd.MM.yyyy HH:mm"; "hh:" sonrası mm dakikadır). */
function datePattern(fmt: string | undefined): string {
  return fmt ? fmt.replace("dd.mm", "dd.MM").replace("hh", "HH") : "dd.MM.yyyy HH:mm";
}

/**
 * Excel'in hücrede GÖSTERECEĞİ metin. Tarih hücresi Excel'de dilimsizdir — SheetSpec'e fabrika duvar saati olarak
 * (UTC dilimine kaydırılmış) girer, bu yüzden burada UTC ile okunur. Sayı: biçimdeki zorunlu/isteğe bağlı hane,
 * virgül = binlik grup, tırnaklı ek aynen. Biçimsiz sayı ham değer (Excel "Genel").
 */
export function sheetCellText(v: unknown, numFmt?: SheetColumn["numFmt"]): string {
  if (v === null || v === undefined || v === "") return "";
  const fmt = typeof numFmt === "function" ? numFmt(v) : numFmt;
  if (v instanceof Date) return formatFactory(v, datePattern(fmt), "", "UTC");
  if (typeof v !== "number") return String(v);
  if (!fmt) return String(v).replace(".", ",");
  const suffix = /"([^"]*)"/.exec(fmt)?.[1] ?? "";
  const base = fmt.replace(/"[^"]*"/g, "");
  const frac = /\.([0#]+)/.exec(base)?.[1] ?? "";
  const min = (frac.match(/0/g) ?? []).length;
  return `${formatClassed(v, min, frac.length, base.includes(","))}${suffix}`;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tdClass = (c: Pick<SheetColumn, "align">) => (c.align === "right" ? ' class="num"' : "");

/** Tek sayfanın PDF gövdesi: başlık satırları · tablo (+ kalın TOPLAM) · alt tablolar · notlar. */
export function sheetBlockHtml(s: SheetSpec): string {
  const pre = (s.preamble ?? []).map((l) => `<div class="meta">${esc(l.filter((x) => x != null).join(" "))}</div>`).join("");
  const cells = (r: Record<string, unknown>, total: boolean) =>
    s.columns
      .map((c) => {
        const t = esc(sheetCellText(r[c.key], (total && s.totalNumFmt?.[c.key]) || c.numFmt));
        return `<td${tdClass(c)}>${total && t ? `<strong>${t}</strong>` : t}</td>`;
      })
      .join("");
  const head = s.columns.map((c) => `<th${tdClass(c)}>${esc(c.header)}</th>`).join("");
  const body = s.rows.map((r) => `<tr>${cells(r, false)}</tr>`).join("");
  const foot = s.totalRow ? `<tfoot><tr>${cells(s.totalRow, true)}</tr></tfoot>` : "";
  const subs = (s.subTables ?? [])
    .map(
      (st) =>
        `<h3>${esc(st.title)}</h3><table><thead><tr>${st.columns.map((c) => `<th>${esc(c.header)}</th>`).join("")}</tr></thead><tbody>${st.rows
          .map((r) => `<tr>${st.columns.map((c, i) => `<td${tdClass(c)}>${esc(sheetCellText(r[i], c.numFmt))}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
    )
    .join("");
  const notes = s.notes?.length ? `<div class="notes">${s.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "";
  return `${pre}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>${subs}${notes}`;
}

/** Sayfalardan PDF HTML'i — çok sayfada her sayfa başlıklı ayrı tablo. */
export function buildSheetsHtml(title: string, sheets: readonly SheetSpec[]): string {
  const many = sheets.length > 1;
  return wrapListHtml(title, sheets.map((s) => `${many ? `<h2>${esc(s.name)}</h2>` : ""}${sheetBlockHtml(s)}`).join("\n"));
}

/** Diyaloğun tek çağrısı: Excel (çok sayfa) ya da PDF (aynı sayfalardan). */
export async function exportSheetsAs(format: ExportFormat, title: string, sheets: SheetSpec[], filename: string): Promise<boolean> {
  if (format === "pdf") {
    const rowCount = sheets.reduce((a, s) => a + s.rows.length + (s.totalRow ? 1 : 0), 0);
    return saveListPdf(() => buildSheetsHtml(title, sheets), filename, rowCount);
  }
  if (format === "csv") throw new Error("Bu çıktı CSV desteklemez.");
  return saveWorkbook(await buildWorkbook(sheets), filename);
}
