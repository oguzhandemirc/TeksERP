// Sevk Çıkışı liste kartı metinleri (saf). Rakamlar sunucunun brüt toplamlarından (`totalMeters`/`totalKg`).
import { formatFactory } from '../../../../lib/factory-time';
import type { ShipmentListRow } from '../../../../services/handheldShipment.service';
import { fmtInt, fmtKg, fmtM } from './summary';

export type RowTone = 'open' | 'empty' | 'done';

/** Durum çipi: Açık · Açık · boş (hiç top yok, K4) · Sevk edildi. */
export function rowChip(row: Pick<ShipmentListRow, 'status' | '_count'>): { label: string; tone: RowTone } {
  if (row.status === 'DISPATCHED') return { label: 'Sevk edildi', tone: 'done' };
  if (row._count.rolls === 0) return { label: 'Açık · boş', tone: 'empty' };
  return { label: 'Açık', tone: 'open' };
}

/** Yalnız çuval sayısı: canlı birimlerden dökme ve araba düşülür. */
export function rowSackCount(row: Pick<ShipmentListRow, '_count'>): number {
  const c = row._count;
  return Math.max(0, c.sacks - (c.bulks ?? 0) - (c.carts ?? 0));
}

/** "2 çuval · 8 top" (çuval yoksa yalnız top). */
export function rowLoadLine(row: Pick<ShipmentListRow, '_count'>): string {
  const sacks = rowSackCount(row);
  const rolls = `${fmtInt(row._count.rolls)} top`;
  return sacks > 0 ? `${fmtInt(sacks)} çuval · ${rolls}` : rolls;
}

export function rowMeters(row: Pick<ShipmentListRow, 'totalMeters'>): string {
  return `${fmtM(row.totalMeters ?? 0)} m`;
}

export function rowKg(row: Pick<ShipmentListRow, 'totalKg'>): string | null {
  return row.totalKg != null && row.totalKg > 0 ? `${fmtKg(row.totalKg)} kg` : null;
}

/** Sevk edilmişte sevk anı, açıkta açılış anı — fabrika diliminde. */
export function rowDate(row: Pick<ShipmentListRow, 'status' | 'createdAt' | 'dispatchedAt'>): string {
  const at = row.status === 'DISPATCHED' && row.dispatchedAt ? row.dispatchedAt : row.createdAt;
  return formatFactory(at, 'dd.MM.yyyy HH:mm');
}

/** Dokunma hedefi: açık → okutma, sevk edilmiş → salt-okunur; doğrudan (fason) sevk bu ekranda açılmaz. */
export function rowTarget(row: Pick<ShipmentListRow, 'kind' | 'status'>): 'scan' | 'readonly' | 'none' {
  if (row.kind === 'DIRECT') return 'none';
  if (row.status === 'PLANNED') return 'scan';
  if (row.status === 'DISPATCHED') return 'readonly';
  return 'none';
}
