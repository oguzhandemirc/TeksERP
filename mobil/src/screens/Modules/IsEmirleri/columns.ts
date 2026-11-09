// =============================================================================
// İş Emirleri (tablet) — sütun aç/kapa tercihleri (SAF; testli)
// =============================================================================
// "İE no" ve "Şu an nerede" ZORUNLU (kapatılamaz). Varsayılan açık: İE no, tür, müşteri, kumaş, top, şu an nerede, durum.
// Saklanan biçim `{ v: 2, visible: [...] }` (v1 okunur ve Tür/Top eklenerek yükseltilir); bilinmeyen anahtar atılır, zorunlu sütun her zaman eklenir, bozuk kayıt
// varsayılana düşer (fail-safe: tercih okunamadı diye ekran boş tablo göstermez).
// =============================================================================

export type ColumnKey = 'no' | 'tur' | 'musteri' | 'kumas' | 'konum' | 'durum' | 'parti' | 'top' | 'topMetre' | 'tarih';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  required: boolean;
  /** Göreli genişlik (flex). */
  flex: number;
}

/** Görüntü sırası. */
export const COLUMNS: readonly ColumnDef[] = [
  { key: 'no', label: 'İE no', required: true, flex: 1.1 },
  { key: 'tur', label: 'Tür', required: false, flex: 0.8 },
  { key: 'musteri', label: 'Müşteri', required: false, flex: 1.6 },
  { key: 'kumas', label: 'Kumaş / renk', required: false, flex: 1.6 },
  { key: 'parti', label: 'Parti', required: false, flex: 1 },
  { key: 'top', label: 'Top', required: false, flex: 0.7 },
  { key: 'topMetre', label: 'Top / metre', required: false, flex: 1.2 },
  { key: 'konum', label: 'Şu an nerede', required: true, flex: 2.2 },
  { key: 'durum', label: 'Durum', required: false, flex: 1.1 },
  { key: 'tarih', label: 'Tarih', required: false, flex: 0.9 },
];

export const REQUIRED_COLUMNS: readonly ColumnKey[] = COLUMNS.filter((c) => c.required).map((c) => c.key);
export const DEFAULT_VISIBLE: readonly ColumnKey[] = ['no', 'tur', 'musteri', 'kumas', 'top', 'konum', 'durum'];

const KNOWN = new Set<string>(COLUMNS.map((c) => c.key));

/** Kayıtlı JSON → görünür sütun kümesi (görüntü sırasında). */
export function parseStoredColumns(raw: string | null | undefined): ColumnKey[] {
  let list: readonly string[] = DEFAULT_VISIBLE;
  if (raw) {
    try {
      const v = JSON.parse(raw) as { v?: unknown; visible?: unknown };
      if (v && (v.v === 1 || v.v === 2) && Array.isArray(v.visible)) {
        const saved = v.visible.filter((k): k is string => typeof k === 'string');
        // v1 kayıtta Tür/Top sütunu yoktu (eskiden İE no ve konum hücresinin içindeydi): bilgi kaybolmasın diye bir kez eklenir.
        list = v.v === 1 ? [...saved, 'tur', 'top'] : saved;
      }
    } catch {
      list = DEFAULT_VISIBLE;
    }
  }
  return normalizeColumns(list);
}

/** Bilinmeyeni at, zorunluyu ekle, görüntü sırasına diz. */
export function normalizeColumns(list: readonly string[]): ColumnKey[] {
  const set = new Set(list.filter((k) => KNOWN.has(k)));
  for (const k of REQUIRED_COLUMNS) set.add(k);
  return COLUMNS.map((c) => c.key).filter((k) => set.has(k));
}

/** Bir sütunu aç/kapa; zorunlu sütun değişmez. */
export function toggleColumn(visible: readonly ColumnKey[], key: ColumnKey): ColumnKey[] {
  if (REQUIRED_COLUMNS.includes(key)) return normalizeColumns(visible);
  return normalizeColumns(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
}

export function serializeColumns(visible: readonly ColumnKey[]): string {
  return JSON.stringify({ v: 2, visible: normalizeColumns(visible) });
}

/** Kullanıcı başına cihaz anahtarı (SecureStore anahtar alfabesi: harf, rakam, `.`, `-`, `_`). */
export function columnsStorageKey(userId: string | null | undefined): string {
  return `isEmirleri.columns.${(userId ?? 'anon').replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export const visibleDefs = (visible: readonly ColumnKey[]): ColumnDef[] => COLUMNS.filter((c) => visible.includes(c.key));
