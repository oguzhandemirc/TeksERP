/**
 * TOP İPTALİ — HAZIR SEBEP KATALOĞU (2026-08-05, sadeleştirme 2026-08-06).
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
 * ⚠️ SEBEP ARTIK ZORUNLU DEĞİL (2026-08-06 kullanıcı kararı). Aynı mantığın bir
 * adım ilerisi: zorunlu tutulunca operatör listeden rastgele birini seçiyordu ve
 * o cevap cevapsızlıktan kötüdür. Backend sebepsiz iptali kabul eder, `cancelReason`
 * NULL kalır, yüzeyler "Seçilmedi" gösterir (`inventory.service.softDelete`).
 *
 * ── İKİ METİN, TEK KAYIT ────────────────────────────────────────────────────
 * `short` yalnız BUTONUN üstünde yazar; `full` sunucuya gider ve `Roll.cancelReason`
 * olarak saklanır. Sebebi tablette okuyan kişi ile altı ay sonra raporda okuyan kişi
 * aynı kişi değil: biri iki kelimeye, diğeri tam cümleye ihtiyaç duyar. Uzun etiketler
 * chip'leri dört satıra sarıyor ve okunmadan seçtiriyordu — kısaltma bir stil tercihi
 * değil, doğru sebebin seçilme ihtimalini artıran şey.
 * ⚠️ `full` metinlerini DEĞİŞTİRME — geçmiş kayıtlarla gruplama birebir eşitliğe
 * dayanır; değiştirirsen aynı sebep raporda iki ayrı satır olur.
 *
 * ⚠️ SÜRTÜNME ÖLÇÜTÜ: sahada sürekli "Diğer" ya da sebepsiz iptal çıkıyorsa katalog
 * YANLIŞTIR; gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi büyütme.
 */
export interface CancelReasonPreset {
  /** Chip üstündeki kısa etiket — tek satıra sığmalı (eldivenli dokunuş). */
  short: string;
  /** `Roll.cancelReason`'a yazılan tam metin — raporun okuduğu değer. */
  full: string;
}

export const CANCEL_REASON_PRESETS: readonly CancelReasonPreset[] = [
  { short: 'Mükerrer', full: 'Mükerrer giriş — aynı top iki kez kaydedildi' },
  { short: 'Yanlış metraj', full: 'Yanlış metraj girildi' },
  { short: 'Yanlış ürün/renk', full: 'Yanlış ürün / renk seçildi' },
  { short: 'Top yok', full: 'Top fiziksel olarak yok (hatalı kayıt)' },
  { short: 'Deneme', full: 'Deneme / eğitim kaydı' },
] as const;

/** Backend de aynı alt sınırı uygular: kısa doldurma SAKLANMAZ (sebepsiz sayılır). */
export const CANCEL_MIN_REASON = 3;
