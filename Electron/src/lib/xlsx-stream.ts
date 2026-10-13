// Akışlı Excel istemcisi (Perf-2 B4): büyük liste sayfası renderer'da exceljs Workbook olarak
// kurulmaz; satırlar ≤10K'lık parçalarla ana sürece gider (`electron/ipc/xlsx.ipc.ts`).
// Hücre başına biçim fonksiyonu (ör. upTo3ExcelNumFmt) BURADA dizgiye çözülür → `{v,f}`.

import type { SheetColumn, SheetSpec } from "./xlsx-export";
import {
  XLSX_STREAM_MAX_CHUNK,
  type XlsxCell,
  type XlsxCellValue,
  type XlsxStreamBeginOpts,
} from "@shared/xlsx-stream";

/**
 * Bu satır sayısından itibaren liste Excel'i akışla yazılır. Ölçüm (Node, 8 kolon, RSS artışı):
 * 20K eski 458 ms / 257 MB ↔ akış 310 ms / 71 MB · 50K 1,15 s / 519 MB ↔ 0,69 s / 139 MB.
 * Altında eski yol kalır (paylaşımlı dizgi → ~%25 küçük dosya, bellek zaten az).
 */
export const XLSX_STREAM_MIN_ROWS = 20_000;

function toValue(v: unknown): XlsxCellValue {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return null;
}

function toCell(v: unknown, col: SheetColumn): XlsxCell {
  const value = toValue(v);
  const f = typeof col.numFmt === "function" ? col.numFmt(v) : undefined;
  return f ? { v: value, f } : value;
}

const toCells = (r: Record<string, unknown>, cols: readonly SheetColumn[]): XlsxCell[] => cols.map((c) => toCell(r[c.key], c));

/**
 * Akışın taşıyabildiği sayfa şekli: `buildListSheet` çıktısı (hücre değeri metin/sayı,
 * kolon biçimi yalnız fonksiyon). Kolon düzeyinde dizgi biçim, alt tablo ve TOPLAM'a özel
 * biçim eski yolda kalır — sessizce farklı dosya üretmek yerine.
 */
export function isStreamableSheet(spec: SheetSpec): boolean {
  if (spec.subTables?.length || spec.totalNumFmt) return false;
  if (spec.columns.some((c) => typeof c.numFmt === "string")) return false;
  const okValue = (v: unknown) => v === undefined || v === null || typeof v === "string" || typeof v === "number";
  return spec.rows.every((r) => Object.values(r).every(okValue)) && Object.values(spec.totalRow ?? {}).every(okValue);
}

export function streamBeginOpts(spec: SheetSpec, filename: string): XlsxStreamBeginOpts {
  return {
    suggestedName: filename,
    sheetName: spec.name,
    columns: spec.columns.map((c) => ({ header: c.header, width: c.width ?? 16, ...(c.align ? { align: c.align } : {}) })),
    preamble: (spec.preamble ?? []).map((line) => line.map(toValue)),
  };
}

/**
 * Sayfayı akışla yazar. Döner: kaydedildi mi (diyalog iptali false). Yazım hatası fırlatır
 * (çağıranın "İndirme hazırlanamadı" yolu); yarım dosya ana süreçte silinir.
 */
export async function streamSheetToXlsx(spec: SheetSpec, filename: string): Promise<boolean> {
  const api = window.api.xlsx;
  const begun = await api.streamBegin(streamBeginOpts(spec, filename));
  if (!begun.ok) {
    if (begun.canceled) return false;
    throw new Error(begun.error ?? "Excel dosyası yazılamadı");
  }
  const { sessionId } = begun;
  let open = true;
  try {
    for (let i = 0; i < spec.rows.length; i += XLSX_STREAM_MAX_CHUNK) {
      const rows = spec.rows.slice(i, i + XLSX_STREAM_MAX_CHUNK).map((r) => toCells(r, spec.columns));
      const res = await api.streamRows({ sessionId, rows });
      if (!res.ok) {
        open = false; // ana süreç oturumu zaten bıraktı
        throw new Error(res.error);
      }
    }
    const res = await api.streamEnd({
      sessionId,
      ...(spec.totalRow ? { totalRow: toCells(spec.totalRow, spec.columns) } : {}),
      ...(spec.notes?.length ? { notes: spec.notes } : {}),
    });
    open = false;
    if (!res.ok) throw new Error(res.error);
    return true;
  } finally {
    if (open) await api.streamAbort(sessionId).catch(() => undefined);
  }
}
