// =============================================================================
// Belge TABLO MODELİ — PDF (HTML) ile Excel'in ORTAK kolon/değer çözücüsü
// =============================================================================
// Bir belge tablosu bir kez `DocColSpec` listesi olarak tanımlanır: her kolon bir
// ham DEĞER (`value`) ve o değerin TÜRÜ (`kind`) taşır. İki çıkış aynı listeden
// türer:
//   • HTML  → `toHtmlCols` → `buildDocTable` (görünürlük/sıra `applyColumnCfg`)
//   • Excel → `resolveDocTable` (aynı `applyColumnCfg`, ham değer + tür)
// Excel'in kendi kolon listesi YOKTUR; PDF'te görünen kolon Excel'de de görünür,
// opt-in (`defaultHidden`) kolon ikisinde birden kapalı doğar.
// =============================================================================

import { applyColumnCfg, type DocCol, type DocColumnCfg } from "./doc-table";

/** Hücre türü — HTML biçimini ve Excel sayı biçimini BİRLİKTE belirler. */
export type DocCellKind =
  | { t: "text" }
  /** Ondalıklı/gruplu sayı (`fmtTr(v, dec)`); dizi değer (ör. "—") olduğu gibi basılır. */
  | { t: "num"; dec: number; suffix?: string }
  /** Gruplamasız tam sayı (`String(v)`) — ambalaj no, en (cm). */
  | { t: "int"; suffix?: string };

export type DocCellValue = string | number | null;

export interface DocColSpec<R> {
  key: string;
  /** Kolon başlığı — sabit literal (escape edilmiş varsayılır). */
  label: string;
  align: "l" | "r" | "c";
  width?: string;
  cellClass?: string;
  defaultHidden?: boolean;
  kind: DocCellKind;
  value: (row: R, index: number) => DocCellValue | undefined;
  /** Toplam satırı hücresi — nesne VAR ise kolon "toplamlı" sayılır (değer boş olsa da). */
  foot?: { value: DocCellValue | undefined };
}

/** Renderer'ın kendi kaçırma/biçim fonksiyonları — bayt kimliği için dışarıdan verilir. */
export interface DocFmtKit {
  esc: (v: unknown) => string;
  fmtTr: (n: number | null | undefined, dec: number) => string;
}

/** Bir hücrenin HTML metni — renderer'ların bugünkü çıktısıyla bayt bayt aynı. */
export function docCellHtml(kind: DocCellKind, v: DocCellValue | undefined, kit: DocFmtKit): string {
  if (kind.t === "text") return kit.esc(v ?? "");
  if (v == null) return "";
  if (typeof v === "string") return kit.esc(v);
  const suffix = kind.suffix ? kit.esc(kind.suffix) : "";
  if (kind.t === "int") return `${kit.esc(String(v))}${suffix}`;
  return `${kit.esc(kit.fmtTr(v, kind.dec))}${suffix}`;
}

/** Kolon tanımlarını HTML tablo motorunun kolonlarına çevirir. */
export function toHtmlCols<R>(cols: DocColSpec<R>[], kit: DocFmtKit): DocCol<R>[] {
  return cols.map((c) => ({
    key: c.key,
    label: c.label,
    align: c.align,
    ...(c.width ? { width: c.width } : {}),
    ...(c.cellClass ? { cellClass: c.cellClass } : {}),
    ...(c.defaultHidden ? { defaultHidden: true } : {}),
    cell: (row: R, i: number) => docCellHtml(c.kind, c.value(row, i), kit),
    ...(c.foot ? { foot: docCellHtml(c.kind, c.foot.value, kit) } : {}),
  }));
}

/** Excel'e giden, görünürlüğü/sırası/başlığı çözülmüş tek tablo. */
export interface DocTableModel {
  key: string;
  caption: string;
  columns: Array<{ key: string; label: string; align: "l" | "r" | "c"; kind: DocCellKind }>;
  /** Satır başına, `columns` sırasıyla hücre değerleri. */
  rows: DocCellValue[][];
  /** Toplam satırı (`columns` sırasıyla) — HTML'deki gibi yalnız toplamlı kolon görünürse. */
  foot: DocCellValue[] | null;
}

/** Başlık override'ı HTML için kaçırılmış gelir; Excel ham metni ister. */
function unescLabel(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Bir tabloyu HTML ile AYNI kurallarla çözer: `applyColumnCfg` (hidden/shown/order/
 * labels/blankLabels) ve toplam satırı etiketinin yeri (`buildDocTable`: toplamı
 * olmayan İLK görünür hücre).
 */
export function resolveDocTable<R>(opts: {
  key: string;
  caption: string;
  cols: DocColSpec<R>[];
  rows: R[];
  colCfg?: DocColumnCfg;
  footLabel?: string;
  kit: DocFmtKit;
}): DocTableModel {
  const visibleKeys = applyColumnCfg(toHtmlCols(opts.cols, opts.kit), opts.colCfg);
  const byKey = new Map(opts.cols.map((c) => [c.key, c]));
  const cols = visibleKeys.map((h) => ({ spec: byKey.get(h.key)!, label: h.label }));

  const rows = opts.rows.map((r, i) => cols.map(({ spec }) => spec.value(r, i) ?? null));

  let foot: DocCellValue[] | null = null;
  if (opts.footLabel && cols.some(({ spec }) => spec.foot !== undefined)) {
    let labelPlaced = false;
    foot = cols.map(({ spec }) => {
      const html = spec.foot ? docCellHtml(spec.kind, spec.foot.value, opts.kit) : "";
      if (!html && !labelPlaced) {
        labelPlaced = true;
        return opts.footLabel as string;
      }
      return spec.foot ? (spec.foot.value ?? null) : null;
    });
  }

  return {
    key: opts.key,
    caption: unescLabel(opts.caption),
    columns: cols.map(({ spec, label }) => ({
      key: spec.key,
      label: unescLabel(label),
      align: spec.align,
      kind: spec.kind,
    })),
    rows,
    foot,
  };
}

/** Belgenin Excel'e giden bütünü: başlık satırları + tablolar + dipnotlar. */
export interface DocTablesPayload {
  docType: string;
  /** Dosya/sayfa adı için belge numarası. */
  documentNo: string;
  /** Başlık bloğu — [etiket, değer] satırları; tek hücreli satır (değer null) başlık gibi basılır. */
  header: Array<[string, string | null]>;
  tables: DocTableModel[];
  notes: string[];
}
