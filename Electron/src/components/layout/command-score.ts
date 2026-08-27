import { foldSearchText } from "@/lib/search-fold";
import { SERVER_ITEM_PREFIX } from "@/lib/search/search-targets";

// ⚠️ ÖNEK BURADA TANIMLANMAZ, İÇE AKTARILIR. İlk yazımda ikinci bir sabit
// tanımlanmıştı ("__srv__:" ↔ gerçek "srv:") ve sunucu satırları sessizce
// ELENDİ — arama çalışıyor, sonuç görünmüyordu (4 test kırmızı). Sabitin tek
// sahibi `search-targets.ts`tir.
export { SERVER_ITEM_PREFIX } from "@/lib/search/search-targets";

/**
 * KOMUT PALETİ PUANLAMASI — tam ad eşleşmesi HER ZAMAN kazanır.
 *
 * Ölçülen arıza (2026-08-27): puan İKİLİYDİ (1/0), yani eşleşen her kayıt aynı
 * puanı alıyor ve sırayı DOM belirliyordu. "Müşteri Karnesi" yazan kullanıcı
 * Enter'a basınca "Sipariş İptal Karnesi" açılıyordu — o kaydın AÇIKLAMASINDA
 * "Müşteriler…" geçtiği için eşleşiyor ve listede daha yukarıda duruyordu.
 * Tam adı yazılan sayfayı açmayan bir palet, palet değildir.
 *
 * `value` = etiket + açıklama + anahtar kelimeler + bölüm başlığı (bu sırayla)
 * → BAŞLIKTAKİ eşleşme dizinin BAŞINDA olur; puan o konumu kullanır.
 *
 * ⚠️ EŞLEŞME KÜMESİ DEĞİŞMEZ, yalnız SIRA değişir: eskiden eşleşen hiçbir kayıt
 * artık elenmez (kelime-kelime AND tabanı korunur — "sip listesi" ile
 * "listesi sip" aynı sonucu verir, sunucu aramasıyla aynı sözleşme).
 *
 * ⚠️ Ayrı dosyada çünkü satır içi `filter` prop'u TEST EDİLEMEZ: bileşeni
 * render edip cmdk'nın sıralamasına güvenmek, puanlamanın kendisini ölçmez.
 */
export function scoreCommandValue(value: string, search: string, keywords?: string[]): number {
  // Sunucu satırları ZATEN süzülmüş geldi — ikinci süzme alias eşleşmelerini eler.
  if (value.startsWith(SERVER_ITEM_PREFIX)) return 1;

  const q = foldSearchText(search);
  if (!q) return 1;

  const val = foldSearchText(value);
  const hay = foldSearchText([value, ...(keywords ?? [])].join(" "));
  const terms = q.split(" ").filter(Boolean);
  if (!terms.every((t) => hay.includes(t))) return 0;

  if (val === q) return 1; // birebir ad
  if (val.startsWith(q)) return 0.95; // ad sorguyla başlıyor
  const at = val.indexOf(q);
  // Bitişik geçiş: ne kadar erkendeyse (ada ne kadar yakınsa) o kadar yüksek.
  if (at >= 0) return 0.9 - Math.min(at, 60) / 200;
  // Tüm kelimeler ADIN+açıklamanın içinde ama bitişik değil.
  if (terms.every((t) => val.includes(t))) return 0.5;
  // Yalnız anahtar kelimelerden eşleşti — en düşük öncelik.
  return 0.3;
}
