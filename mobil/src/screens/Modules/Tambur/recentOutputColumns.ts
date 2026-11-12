// "Son Çıkan Toplar" sütun seçimi (saha 2026-11-10): operatör hangi sütunların görüneceğini seçer, seçim cihazda
// ekran kimliğiyle saklanır. Barkod zorunludur. Kayıt yokken bugünkü görünüm; verisi hiç olmayan renk/en sütunu kapalı başlar.
import type { Roll } from '../../../types/models';
import { TERIM } from '../../../lib/terim';

export const RECENT_OUTPUT_SCREEN_KEY = 'tambur.recentOutput';

export type OutputColumnKey = 'quality' | 'barcode' | 'item' | 'color' | 'width' | 'date' | 'qty' | 'kg' | 'labelBatch' | 'workOrder';

export const OUTPUT_COLUMNS: readonly { key: OutputColumnKey; label: string; required?: boolean }[] = [
  { key: 'quality', label: 'Kalite' },
  { key: 'barcode', label: 'Barkod', required: true },
  { key: 'item', label: 'Ürün' },
  { key: 'color', label: 'Renk' },
  { key: 'width', label: 'En (cm)' },
  { key: 'date', label: 'Tarih-saat' },
  { key: 'qty', label: 'Metre' },
  { key: 'kg', label: 'Kg' },
  { key: 'labelBatch', label: 'Müşteri parti no' },
  { key: 'workOrder', get label() { return `${TERIM.terbiyeIsEmri.cumleBasi.yalin} no`; } },
];

/** Bugünkü görünüm (sütun seçici öncesi). */
export const DEFAULT_OUTPUT_COLUMNS: readonly OutputColumnKey[] = ['quality', 'barcode', 'item', 'color', 'width', 'date', 'qty'];

type RowData = Pick<Roll, 'width'> & { color?: { name?: string | null } | null };

/** Varsayılan görünümde yalnız veri varsa açılan sütunlar (hep "—" gösteren sütun yer kaplamasın). */
const DATA_GATED: Partial<Record<OutputColumnKey, (r: RowData) => boolean>> = {
  color: (r) => !!r.color?.name,
  width: (r) => r.width != null,
};

const KNOWN = new Set<string>(OUTPUT_COLUMNS.map((c) => c.key));

/** Görünür sütunlar: kayıt varsa o (bilinmeyen anahtar düşer), yoksa veriye göre süzülmüş varsayılan; barkod hep. */
export function resolveOutputColumns(stored: readonly string[] | null | undefined, rows: readonly RowData[]): Set<OutputColumnKey> {
  const base: OutputColumnKey[] = stored
    ? (stored.filter((k) => KNOWN.has(k)) as OutputColumnKey[])
    : DEFAULT_OUTPUT_COLUMNS.filter((k) => !DATA_GATED[k] || rows.some(DATA_GATED[k]!));
  return new Set<OutputColumnKey>([...base, 'barcode']);
}

/** Tek sütunu aç/kapat → saklanacak sıralı liste; zorunlu sütun kapanmaz. */
export function toggleOutputColumn(current: ReadonlySet<OutputColumnKey>, key: OutputColumnKey): OutputColumnKey[] {
  const required = OUTPUT_COLUMNS.find((c) => c.key === key)?.required === true;
  const next = new Set(current);
  if (next.has(key) && !required) next.delete(key);
  else next.add(key);
  return OUTPUT_COLUMNS.map((c) => c.key).filter((k) => next.has(k));
}
