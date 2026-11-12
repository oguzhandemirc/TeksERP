// Belgeden İE formunun "gelen" (müşteri beyanı) alanları — CİHAZ ayarı (2026-11-10, Gülkesim: yalnız beyan metre + işlenen
// metre ilgilendiriyor). Kapalı alan formda çizilmez, kaydedilmez ve gövdedeki `skipDeclared` ile sunucuya da "belgeden
// doldurma" denir. Parti no ve beyan metre kapatılamaz. Varsayılan HEPSİ AÇIK (bugünkü davranış).
export type DocIncomingField = 'kg' | 'width' | 'item' | 'color';

/** Gövde anahtarı (sunucu `SKIP_DECLARED_FIELDS` ile bayt-aynı). */
export type SkipDeclaredField = 'incomingKg' | 'incomingWidth' | 'incomingItemText' | 'incomingColorText';

export const DOC_INCOMING_FIELDS: readonly { key: DocIncomingField; label: string; bodyKey: SkipDeclaredField }[] = [
  { key: 'kg', label: 'Gelen kg', bodyKey: 'incomingKg' },
  { key: 'width', label: 'Gelen en', bodyKey: 'incomingWidth' },
  { key: 'item', label: 'Gelen kumaş', bodyKey: 'incomingItemText' },
  { key: 'color', label: 'Gelen renk', bodyKey: 'incomingColorText' },
];

/** Diskteki CSV (kapalı alanlar) → liste; boş/bozuk kayıt = hepsi açık, bilinmeyen anahtar atılır. */
export function parseHiddenIncoming(raw: string | null): DocIncomingField[] {
  if (!raw) return [];
  const parts = raw.split(',').map((s) => s.trim());
  return DOC_INCOMING_FIELDS.map((f) => f.key).filter((k) => parts.includes(k));
}

/** Aç/kapat; sıra sabit. */
export function setIncomingShown(hidden: readonly DocIncomingField[], key: DocIncomingField, shown: boolean): DocIncomingField[] {
  return DOC_INCOMING_FIELDS.map((f) => f.key).filter((k) => (k === key ? !shown : hidden.includes(k)));
}

/** Kapalı alanların gövde anahtarları (`skipDeclared`). */
export const skipDeclaredOf = (hidden: readonly DocIncomingField[]): SkipDeclaredField[] =>
  DOC_INCOMING_FIELDS.filter((f) => hidden.includes(f.key)).map((f) => f.bodyKey);
