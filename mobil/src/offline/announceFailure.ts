// =============================================================================
// announceFailure — kalıcı düşen istasyon kaydını OLDUĞU ANDA söyle
// =============================================================================
// 2026-08-12'de "ölü mektup kutusu"nun (failedOps + OutboxModal) yerine geçti.
//
// KUTU NEDEN KALDIRILDI (sahada ölçüldü): kutu iki bambaşka olayı tek kırmızı
// başlık altında topluyordu —
//   (a) istek sunucuya ULAŞMADI (ağ/timeout) → operatör tekrar girmeli,
//   (b) istek ULAŞTI, sunucu 409 ile SORU SORDU ("bu top az önce girilmiş
//       olabilir, ayrı bir top mu?") → operatör KARAR vermeli.
// Başlık ikisine birden "bilgisayara ULAŞMADI" diyordu; (b) için bu yanlış ve
// operatörü yanlış işe yönlendiriyor. Üstelik (b) ekranda zaten modalla
// soruluyordu, yani aynı karar iki yüzeyde iki kez duruyordu; modal cevapsız
// kapatılınca satır kutuda günlerce çürüyordu (sahada 4 satır, 1 saatlik).
//
// YERİNE GEÇEN SÖZLEŞME: kalıcı düşüş anında görünür bir toast basılır ve
// HİÇBİR YERE YAZILMAZ. Kayıt kaybı riski üç mekanizmayla karşılanır:
//   1. KK1 online-only rejimi — çevrimdışıyken kayıt hiç denenmez (buton kilitli),
//   2. sunucudaki atomik mükerrer tuzağı — belirsiz timeout sonrası operatör
//      topu yeniden girerse sunucu yakalar ve sorar,
//   3. yazıcı kuyruğu — "top KAYITLI, etiketi çıkmadı" ayrı ve kalıcı yüzey.
// =============================================================================

/** Sunucunun SORU sorduğu 409'lar — cevabı ekranın kendi modalıdır. */
const CONFLICT_CODES = new Set(['POSSIBLE_DUPLICATE', 'CLIENT_TOKEN_COLLISION', 'MULTI_BATCH']);

interface FailureLike {
  message?: string;
  noAuth?: boolean;
  details?: Record<string, unknown> | null;
}

/** Bu mutationKey bir istasyon kaydı mı (yalnız onlar duyurulur). */
export function isStationMutationKey(key: unknown): key is readonly unknown[] {
  return Array.isArray(key) && key[0] === 'station';
}

/**
 * Bu düşüş operatöre DUYURULMALI mı?
 *
 * Saf karar — ekrandaki bir `if`'te yaşasaydı tersine çevrilmesi hiçbir testi
 * kırmazdı (`shouldReleaseInFlight` emsali).
 *
 * Üç hayır:
 *   • istasyon-dışı mutation → o ekranın kendi hata yolu var,
 *   • `noAuth` → HTTP'ye hiç çıkmadı, kuyrukta süresiz bekliyor (hata değil),
 *   • çakışma 409'u → ekran modalla SORUYOR; toast aynı kararı ikinci kez,
 *     üstelik cevaplanamaz biçimde sordururdu.
 */
export function shouldAnnounceFailure(
  key: unknown,
  error: unknown,
  /**
   * Bu kaydın ARDINDA EKRAN VAR MI?
   *
   * Çakışma 409'unun tek yüzeyi ekranın kendi modalıdır — ama o modal yalnız
   * kaydı YAPAN ekran ayaktayken çizilebilir. Uygulama kapanıp açıldığında
   * kuyruktan replay edilen kaydın ekranı yoktur: soru sorulamaz, toast da
   * basılmazsa 409 HİÇBİR YERDE görünmez ve fiziksel top sistemde hiç doğmaz
   * (BULGU-T3-001). Bu yüzden ekransız kayıtta çakışma da DUYURULUR.
   *
   * ⚠️ Belirsizlikte DUYUR: alan okunamıyorsa (eski persist formatı, bozuk meta)
   * `ekranYok` false kalır ve davranış eski hâline döner — ama diriltme yolunda
   * damga `persistPolicy.revivePendingStationMutations` tarafından HER ZAMAN
   * yazılır, yani sessizlik ancak damganın hiç yazılmadığı eski kayıtlarda olur.
   */
  ekranYok = false,
): boolean {
  if (!isStationMutationKey(key)) return false;
  const e = (error ?? null) as FailureLike | null;
  if (e?.noAuth) return false; // HTTP'ye çıkmadı — düşüş değil, bekleyiş
  const code = e?.details?.code;
  if (typeof code === 'string' && CONFLICT_CODES.has(code)) return ekranYok;
  return true;
}

/** Çakışma 409'u mu (ekranın modalıyla aynı soru)? Toast metni buna göre değişir. */
export function isConflictFailure(error: unknown): boolean {
  const code = ((error ?? null) as FailureLike | null)?.details?.code;
  return typeof code === 'string' && CONFLICT_CODES.has(code);
}

/**
 * Toast metni: HANGİ İŞ + NE OLDU + NE YAPMALI.
 *
 * ⚠️ "KAYIT OLUŞMADI" DEMEZ — diyemez. Zaman aşımında sunucu isteği almış ve
 * COMMIT etmiş olabilir; istemci bunu bilemez (timeout "yazılmadı" demek
 * DEĞİLDİR). Kesin bir yokluk iddiası, gerçekten yazılmış bir topu operatöre
 * ikinci kez girdirirdi. Bu yüzden yönerge ÖNCE doğrulatır: "listede yoksa
 * tekrar girin" — ve ikinci giriş yine de olursa sunucunun mükerrer tuzağı
 * karşılar. Metin eldivenli, Türkçesi zayıf operatör için kısa tutulur.
 */
export function failureToastText(
  error: unknown,
  label: string,
): { text1: string; text2: string } {
  const e = (error ?? null) as FailureLike | null;
  if (isConflictFailure(error)) {
    // Ekransız çakışma: sunucu SORU sordu ama soracak ekran yok. Operatöre
    // "kayıt yapılmadı" DENMEZ (sunucu aynı topu daha önce yazmış olabilir —
    // sorunun kendisi bu); doğru yönerge önce BAKTIRMAKTIR.
    return {
      text1: `${label} — KAYIT BEKLEMEDE`,
      text2: `${e?.message ?? 'Sunucu bu kaydı sordu'} · Listede yoksa yeniden girin.`,
    };
  }
  return {
    text1: `${label} — KAYIT GİTMEDİ`,
    // Sunucunun Türkçe mesajı varsa onu göster — sebebi o daha iyi biliyor.
    text2: `${e?.message ?? 'Bilinmeyen hata'} · Listede yoksa tekrar girin.`,
  };
}
