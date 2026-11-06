// İE oluştur türleri — CİHAZ ayarı (2026-11-06; fabrika ayarı YOK). Varsayılan bugünkü davranış: yalnız "İE oluştur"
// (Stok/Sipariş türü bağdan türer). "Fason (müşteri malı)" açılınca alt çubukta ayrı düğme olur; YALNIZ o açıksa cihazın
// öteki giriş noktaları (gelen belge formu, belge masası) da Fason türüyle açar.
export type WoCreateKind = 'STANDARD' | 'CUSTOMER_GOODS';
export const WO_CREATE_KINDS: readonly WoCreateKind[] = ['STANDARD', 'CUSTOMER_GOODS'];
export const WO_CREATE_KINDS_DEFAULT: readonly WoCreateKind[] = ['STANDARD'];
export const CUSTOMER_GOODS_TYPE = 'CUSTOMER_GOODS_SERVICE' as const;

/** Diskteki CSV → türler; bozuk/boş kayıt varsayılana düşer (cihaz sessizce Fason'a geçmez). */
export function parseWoCreateKinds(raw: string | null): WoCreateKind[] {
  if (!raw) return [...WO_CREATE_KINDS_DEFAULT];
  const picked = WO_CREATE_KINDS.filter((k) => raw.split(',').map((s) => s.trim()).includes(k));
  return picked.length > 0 ? picked : [...WO_CREATE_KINDS_DEFAULT];
}

/** Aç/kapat; en az bir tür açık kalır (son açığı kapatmak yok sayılır). Sıra sabit. */
export function toggleWoCreateKind(current: readonly WoCreateKind[], kind: WoCreateKind): WoCreateKind[] {
  const on = current.includes(kind);
  if (on && current.length === 1) return [...current];
  return WO_CREATE_KINDS.filter((k) => (k === kind ? !on : current.includes(k)));
}

/** Öteki giriş noktalarının varsayılan türü: yalnız Fason açıksa Fason; değilse null (bugünkü türetme). */
export function defaultWoTypeFor(kinds: readonly WoCreateKind[]): typeof CUSTOMER_GOODS_TYPE | null {
  return kinds.length === 1 && kinds[0] === 'CUSTOMER_GOODS' ? CUSTOMER_GOODS_TYPE : null;
}
