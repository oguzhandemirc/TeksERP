// =============================================================================
// Sevk Çıkışı — sevke hazır iş yardımcıları (D4-J4)
// =============================================================================
// "Sevke hazır işler" şeridi 2026-11-11 kararıyla kalktı; hazırlık bilgisi cari seçicide (E1) satır alt bilgisi
// olarak görünür. Liste board'dan AYRI tek istekten (`ready-works?groupBy=customer`); eski backend 404 → `null`.
// =============================================================================

import type { ReadyWorkRow } from '../../../services/readyWorks.service';

export const READY_WORKS_KEY = ['sack-store', 'ready-works'] as const;

const fmtM = (m: number) => m.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

/** Hazır topu olan READY/PARTIAL satırlar (sunucu zaten süzer; savunma). */
export function readyChipRows(rows: ReadyWorkRow[] | null | undefined): ReadyWorkRow[] {
  if (!rows) return [];
  return rows.filter((r) => (r.state === 'READY' || r.state === 'PARTIAL') && r.readyCount > 0);
}

/** READY → "Hazır: 3 top · 1.250 m"; PARTIAL → neden kısmen olduğunu söyler ("· 16 top işlemde"). */
export function readyChipText(r: ReadyWorkRow): string {
  if (r.state === 'READY') return `Hazır: ${r.readyCount} top · ${fmtM(r.readyMeters)} m`;
  const wait = r.inProcessCount > 0 ? ` · ${r.inProcessCount} top işlemde` : '';
  return `Hazır: ${r.readyCount} top · ${fmtM(r.readyMeters)} m${wait}`;
}
