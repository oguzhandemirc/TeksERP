// Belge tabloları (backend `/api/printed-documents/:type/:id/tables`) → Excel sayfaları.
//
// Kolon kümesi, sırası, başlığı ve hücre değeri SUNUCUDA, PDF'i çizen çözücüden
// gelir; burada kolon SEÇİLMEZ, yalnız biçim (sayı biçimi, genişlik, hiza) uygulanır.
// Excel için elle kolon listesi yazmak PDF ile Excel'i yeniden ayrıştırırdı.
import type { SheetSpec } from "./xlsx-export";

/** Backend `document-render/doc-model.ts` aynası — hücre türü. */
export type DocCellKind =
  | { t: "text" }
  | { t: "num"; dec: number; suffix?: string }
  | { t: "int"; suffix?: string };

export type DocCellValue = string | number | null;

export interface DocTableModel {
  key: string;
  caption: string;
  columns: Array<{ key: string; label: string; align: "l" | "r" | "c"; kind: DocCellKind }>;
  rows: DocCellValue[][];
  foot: DocCellValue[] | null;
}

export interface DocTablesPayload {
  docType: string;
  documentNo: string;
  header: Array<[string, string | null]>;
  tables: DocTableModel[];
  notes: string[];
}

/** PDF'teki biçimin Excel karşılığı: aynı ondalık, aynı birim eki. */
export function numFmtOf(kind: DocCellKind): string | undefined {
  if (kind.t === "text") return undefined;
  const base = kind.t === "int" ? "0" : kind.dec > 0 ? `#,##0.${"0".repeat(kind.dec)}` : "#,##0";
  return kind.suffix ? `${base}"${kind.suffix}"` : base;
}

const ALIGN = { l: "left", r: "right", c: "center" } as const;

/** Kolon genişliği — başlık ve en uzun hücre metnine göre, makul sınırlarda. */
function widthOf(label: string, values: DocCellValue[]): number {
  const longest = values.reduce<number>((m, v) => Math.max(m, v == null ? 0 : String(v).length), label.length);
  return Math.min(50, Math.max(8, longest + 2));
}

/** Excel sayfa adı ≤31 karakter ve belge içinde tekil. */
function uniqueName(name: string, used: Set<string>): string {
  const base = name.trim().slice(0, 31) || "Liste";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

/**
 * Belge tabloları → sayfalar. Her liste bir sayfa; her sayfanın üstünde belge başlığı
 * (Excel'de sayfalar ayrı dolaşır, PDF'teki kimlik şeridinin karşılığı). Dipnotlar
 * (belgenin kendi notları + çağıranın ekledikleri) ilk sayfanın altına basılır.
 */
export function docTablesToSheets(payload: DocTablesPayload, extraNotes: string[] = []): SheetSpec[] {
  const preamble = payload.header.map(([label, value]) => (value == null ? [label] : [label, value]));
  const notes = [...payload.notes, ...extraNotes];
  const used = new Set<string>();

  if (payload.tables.length === 0) {
    return [{ name: uniqueName(payload.documentNo, used), columns: [], rows: [], preamble, notes }];
  }

  return payload.tables.map((t, ti) => {
    const keys = t.columns.map((_, i) => `c${i}`);
    const toRecord = (vals: DocCellValue[]) => Object.fromEntries(keys.map((k, i) => [k, vals[i] ?? null]));
    return {
      name: uniqueName(t.caption, used),
      columns: t.columns.map((c, i) => ({
        header: c.label,
        key: keys[i]!,
        width: widthOf(c.label, t.rows.map((r) => r[i] ?? null)),
        numFmt: numFmtOf(c.kind),
        align: ALIGN[c.align],
      })),
      rows: t.rows.map(toRecord),
      ...(t.foot ? { totalRow: toRecord(t.foot) } : {}),
      preamble,
      ...(ti === 0 && notes.length ? { notes } : {}),
    };
  });
}
