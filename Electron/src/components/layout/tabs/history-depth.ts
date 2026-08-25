/**
 * Sekme başına "geçmişte kaç adım geri gidilebilir" defteri.
 *
 * ⚠️ NEDEN AYRI BİR SAYAÇ (2026-08-22 saha bulgusu): React Router'ın memory
 * router'ı geçmiş İNDEKSİNİ dışarı vermez. Elde kalan tek ipucu `location.key`di
 * ("ilk giriş her zaman `default`") ve o YANILTICIDIR: `setSearchParams(…, {
 * replace: true })` yeni bir anahtar üretir ama geçmişe adım EKLEMEZ. Liste
 * sayfaları (Envanter, Siparişler, Kartela, İadeler, Çuvallar…) açılışta
 * varsayılan sekmeyi/filtreyi tam da böyle URL'e yazar → anahtar "default"tan
 * çıkar, "geri gidilebilir" sanılır, `navigate(-1)` sessizce hiçbir şey yapmaz.
 * Kullanıcının tarifi birebir buydu: geri tuşu Raporlar/Yetkilendirme/Sistem'de
 * çalışıyor (o sayfalar açılışta URL'i yeniden yazmıyor), Tanımlar/Operasyon'da
 * çalışmıyor.
 *
 * Sayaç üç eylemi ayırır: PUSH +1 · POP -1 · REPLACE değişmez.
 */
const depth = new Map<string, number>();
/** Sekmenin en son GÖRÜLEN konum anahtarı — aynı gezinmenin tekrar eden
 *  abonelik olayları (loading → idle) iki kez sayılmasın. */
const lastKey = new Map<string, string>();

/**
 * Router olayını deftere işle. Aynı anahtar için ikinci çağrı yok sayılır.
 *
 * `action` bilerek düz `string`: React Router'ın `historyAction`'ı bir string
 * ENUM'dur (`NavigationType`) ve TS'te enum üyesi ile `"PUSH"` gibi bir literal
 * birbirine atanamaz — tipi enum yapmak testleri, literal birliği yapmak da
 * çağrı yerini kırardı. Enum'un çalışma anı değerleri zaten bu üç metindir.
 */
export function trackTabLocation(id: string, key: string, action: string): void {
  if (lastKey.get(id) === key) return;
  const first = !lastKey.has(id);
  lastKey.set(id, key);
  // İlk olay sekmenin AÇILIŞ konumudur (router kurulurken gelir) — adım değil.
  if (first) {
    depth.set(id, 0);
    return;
  }
  const current = depth.get(id) ?? 0;
  if (action === "PUSH") depth.set(id, current + 1);
  else if (action === "POP") depth.set(id, Math.max(0, current - 1));
  // REPLACE: konum değişti ama geçmiş derinliği değişmedi — bu satırın YOKLUĞU
  // kasıtlıdır; "REPLACE de sayılsın" demek hatanın ta kendisini geri getirir.
}

/** Bu sekmede geri gidilecek bir adım var mı? */
export function canGoBackTab(id: string): boolean {
  return (depth.get(id) ?? 0) > 0;
}

/** Sekme kapanınca defteri temizle (kimlikler yeniden kullanılmasa da sızmasın). */
export function forgetTab(id: string): void {
  depth.delete(id);
  lastKey.delete(id);
}
