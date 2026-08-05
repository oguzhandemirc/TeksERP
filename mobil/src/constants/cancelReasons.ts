/**
 * TOP İPTALİ — HAZIR SEBEP KATALOĞU (2026-08-05).
 *
 * `manualReasons.ts` ile AYNI gerekçe (oradaki nota bak): eldivenli operatör
 * vardiya ortasında metin yazmıyor, "aaa" yazıyor — ve o, boş bırakmaktan daha
 * kötüdür, çünkü denetimde cevap varmış gibi görünür. Tek dokunuşla seçilen
 * kategori hem sürtünmeyi kaldırır hem veriyi SAYILABİLİR yapar.
 *
 * ⚠️ AYRI DOSYA, bilinçli: "topu neden ELLE EKLEDİM" ile "topu neden İPTAL
 * ETTİM" farklı sorulardır ve cevap kümeleri örtüşmez. Tek listede birleştirmek,
 * iki olayın aynı isimle sayılmasına yol açar — birleştirme cazibesine kapılma.
 *
 * Sebep yalnız ETİKETİ BASILMIŞ topun iptalinde zorunludur (backend
 * `CANCEL_REASON_REQUIRED`). Sebebi orada zorunlu kılan şey: kâğıt topun üstünde
 * kalır ("ölü etiket") ve onu sahada bulan kişinin ilk sorusu "bu neden iptal
 * edilmiş" olur. Cevap `Roll.cancelReason`'da durur — audit'te DEĞİL, çünkü
 * `archive-scheduler` 6 ayda bir `system_logs`'u arşive taşır.
 *
 * ⚠️ SÜRTÜNME ÖLÇÜTÜ: sahada sürekli "Diğer" seçiliyorsa katalog YANLIŞTIR;
 * gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi büyütme.
 */
export const CANCEL_REASON_PRESETS = [
  'Mükerrer giriş — aynı top iki kez kaydedildi',
  'Yanlış metraj girildi',
  'Yanlış ürün / renk seçildi',
  'Top fiziksel olarak yok (hatalı kayıt)',
  'Deneme / eğitim kaydı',
] as const;

/** Backend de aynı alt sınırı uygular (min 3 karakter). */
export const CANCEL_MIN_REASON = 3;
