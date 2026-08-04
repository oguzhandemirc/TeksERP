/**
 * ELLE TOP EKLEME — HAZIR SEBEP KATALOĞU (2026-08-04).
 *
 * NEDEN HAZIR SEÇENEK: sebep ZORUNLU ve topun kalıcı bir alanına yazılıyor
 * (`Roll.entryReason`), ama eldivenli operatör vardiya ortasında tablet
 * klavyesiyle metin yazmak istemiyordu — pratikte "aaa" / "." gibi doldurmalar
 * üretiyordu. O, boş bırakmaktan DAHA KÖTÜDÜR: denetimde cevap varmış gibi
 * görünür, hiçbir şey söylemez. Tek dokunuşla seçilen kategori hem sürtünmeyi
 * kaldırır hem veriyi SAYILABİLİR yapar — "manuel girişlerin %70'i etiket
 * kopmasından" cevabı ancak böyle alınır ve asıl sorun (manuel giriş bir
 * SEMPTOMDUR) çözülebilir.
 *
 * İKİ EKRAN PAYLAŞIR, bu yüzden burada:
 *   • Tambur "Manuel Mod" (kartsız, doğrudan Bitmiş Depo)
 *   • Tambur "Düzelt → Manuel Top Ekle" (iş emri adımına bağlı)
 * İkisinde ayrı liste tutmak, zamanla ayrışıp aynı olayın iki farklı isimle
 * sayılmasına yol açardı.
 *
 * Katalog İSTEMCİDE sabit: backend'e serbest metin gidiyor (`reason: string`),
 * yani API sözleşmesi değişmedi. İleride admin'den düzenlenebilir bir tabloya
 * (`ReturnReason` emsali) taşınabilir — o zaman bu dosya tek değişim noktasıdır.
 *
 * ⚠️ SÜRTÜNME ÖLÇÜTÜ: sahada sürekli "Diğer" seçiliyorsa katalog YANLIŞTIR;
 * gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi büyütme.
 */
export const MANUAL_REASON_PRESETS = [
  'Depoda barkodsuz kalmış top',
  'Etiketi kopmuş / okunmuyor',
  'Sistem kaydı yapılmamış (geçmiş vardiya)',
  'Fason dönüşü kayda girmemiş',
  'Sayım farkı — fiziksel mal var',
] as const;

/** Backend de aynı alt sınırı uygular (min 3 karakter). */
export const MANUAL_MIN_REASON = 3;
