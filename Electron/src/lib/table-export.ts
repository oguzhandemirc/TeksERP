import type { Column, RowData, Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { buildWorkbook, saveWorkbook } from "./xlsx-export";

// PDF üst sınırı: bu kadar satırın üstünde tek PDF pratik değil (offscreen render
// çökme riski + yüzlerce sayfa). Örn. 30.000 kayıt ~900 sayfa/20-45MB olurdu →
// Excel'e yönlendir. Excel'in sınırı yok (tek sayfada 30k'yı taşır).
const PDF_MAX_ROWS = 10000;

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

// Bir nesneden okunur ad çıkar (item/color/property gibi ilişkili kayıtlar için).
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

function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ");
  if (typeof v === "object") return pickName(v as Record<string, unknown>);
  return String(v);
}

/** Ham nesneden (TanStack Row DEĞİL) bir kolonun metin değeri: meta.exportValue →
 *  accessorFn (accessorKey de buna dönüşür) → düz alan. Full-export/seçili export
 *  bunu kullanır (satırlar bellekte Row değil, ham T). */
function rawCellText<T>(col: Column<T, unknown>, original: T): string {
  const exportValue = col.columnDef.meta?.exportValue;
  if (exportValue) return toText(exportValue(original));
  if (col.accessorFn) {
    try {
      return toText(col.accessorFn(original, 0));
    } catch {
      /* accessor patlarsa düz alana düş */
    }
  }
  return toText((original as Record<string, unknown>)?.[col.id]);
}

/** summable kolonun sayısal değeri (Excel'e sayı yazmak + TOPLAM için). Sayı değilse
 *  metinden rakamları ayıklar (ör. "180 cm" → 180); çözülemezse 0. */
function rawCellNumber<T>(col: Column<T, unknown>, original: T): number {
  const exportValue = col.columnDef.meta?.exportValue;
  let v: unknown;
  if (exportValue) v = exportValue(original);
  else if (col.accessorFn) {
    try {
      v = col.accessorFn(original, 0);
    } catch {
      v = undefined;
    }
  } else v = (original as Record<string, unknown>)?.[col.id];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.,-]/g, "").replace(/\.(?=.*\.)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** yyyy-MM-dd (dosya adına eklenen, sıralanabilir tarih damgası). */
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** İndirilen liste dosya adı — içeriği belli eden ad + tarih (ör. "Sevkiyatlar 2026-07-29",
 *  seçiliyse "Sevkiyatlar (seçili) 2026-07-29"). */
export function exportListName(base: string, opts?: { selected?: boolean }): string {
  return `${base || "Liste"}${opts?.selected ? " (seçili)" : ""} ${dateStamp()}`;
}

/** Görünür kolonlar (select/actions hariç) — export'lar paylaşır. */
function tableExportCols<T>(table: Table<T>): Column<T, unknown>[] {
  return table.getVisibleLeafColumns().filter((c) => c.id !== "select" && c.id !== "actions");
}

/** summable kolonlar varsa kalın TOPLAM satırı (ilk metin kolonuna "TOPLAM (N kayıt)"). */
function buildTotalRow<T>(
  cols: Column<T, unknown>[],
  rows: T[],
): Record<string, unknown> | undefined {
  const summable = cols.filter((c) => c.columnDef.meta?.summable);
  if (summable.length === 0 || rows.length === 0) return undefined;
  // Etiketi ilk TOPLANMAYAN kolona koy ki toplam değerini ezmesin.
  const labelCol = cols.find((c) => !c.columnDef.meta?.summable) ?? cols[0];
  if (!labelCol) return undefined;
  const total: Record<string, unknown> = { [labelCol.id]: `TOPLAM (${rows.length} kayıt)` };
  for (const c of summable) {
    total[c.id] = rows.reduce((s, r) => s + rawCellNumber(c, r), 0);
  }
  return total;
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
  const cols = tableExportCols(table);
  const columns = cols.map((c) => ({
    header: columnLabel(c),
    key: c.id,
    width: 20,
    // 3 ondalık: metre/kg alanları backend'de Decimal(x,3) — 2 hane kırpardı.
    // Sondaki gereksiz sıfırlar "#" ile gizli (tam sayı "1.234" görünür).
    numFmt: c.columnDef.meta?.summable ? "#,##0.###" : undefined,
  }));
  const dataRows = rows.map((orig) =>
    Object.fromEntries(
      cols.map((c) => [c.id, c.columnDef.meta?.summable ? rawCellNumber(c, orig) : rawCellText(c, orig)]),
    ),
  );
  const totalRow = buildTotalRow(cols, rows);
  const blob = await buildWorkbook([
    { name: filename.slice(0, 31) || "Liste", columns, rows: dataRows, totalRow },
  ]);
  await saveWorkbook(blob, filename);
}

const htmlEsc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) return false;
  // Çok büyük listede PDF'i engelle — tek dev tablo hem üretilemez (offscreen
  // render çökebilir) hem okunmaz (yüzlerce sayfa). Kullanıcıyı Excel'e yönlendir.
  if (rows.length > PDF_MAX_ROWS) {
    toast.error(
      `Liste çok büyük (${rows.length.toLocaleString("tr-TR")} kayıt, ~${Math.ceil(
        rows.length / 35,
      ).toLocaleString("tr-TR")} sayfa) — PDF yerine Excel indirin.`,
    );
    return false;
  }
  const cols = tableExportCols(table);
  const header = cols.map((c) => `<th>${htmlEsc(columnLabel(c))}</th>`).join("");
  const body = rows
    .map(
      (orig) =>
        `<tr>${cols
          .map((c) => {
            // summable kolonlar gövdede de TR yerel biçimiyle (binlik nokta, ondalık
            // virgül) — TOPLAM satırıyla AYNI biçim; aksi halde "1250.5" gövde vs
            // "2.050,5" toplam gibi sütun-içi '.' anlamı çelişirdi.
            if (c.columnDef.meta?.summable) {
              return `<td class="num">${htmlEsc(rawCellNumber(c, orig).toLocaleString("tr-TR"))}</td>`;
            }
            return `<td>${htmlEsc(rawCellText(c, orig))}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");

  // summable kolonlar için kalın TOPLAM alt satırı.
  const summable = cols.filter((c) => c.columnDef.meta?.summable);
  let foot = "";
  if (summable.length > 0 && rows.length > 0) {
    let labelPlaced = false;
    const cells = cols
      .map((c) => {
        if (c.columnDef.meta?.summable) {
          const sum = rows.reduce((s, r) => s + rawCellNumber(c, r), 0);
          return `<td class="num"><strong>${htmlEsc(sum.toLocaleString("tr-TR"))}</strong></td>`;
        }
        if (!labelPlaced) {
          labelPlaced = true;
          return `<td><strong>TOPLAM</strong></td>`;
        }
        return "<td></td>";
      })
      .join("");
    foot = `<tfoot><tr>${cells}</tr></tfoot>`;
  }

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
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
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #888; padding: 3px 6px; text-align: left; }
    td.num, th.num { text-align: right; }
    thead th { background: #eee; font-weight: 700; }
    tbody tr:nth-child(even) { background: #f7f7f7; }
    tfoot td { background: #eee; border-top: 2px solid #333; }
  </style></head><body>
    <h1>${htmlEsc(filename)}</h1>
    <div class="meta">${rows.length} kayıt</div>
    <table><thead><tr>${header}</tr></thead><tbody>${body}</tbody>${foot}</table>
  </body></html>`;
  const res = await pdfApi.save({ html, suggestedName: filename });
  return res.saved;
}
