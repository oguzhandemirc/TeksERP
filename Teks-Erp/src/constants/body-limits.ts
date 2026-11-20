// =============================================================================
// GÖVDE LİMİTLERİ — TEK KAYNAK (2026-08-29 / BULGU-T1-045)
// =============================================================================
// `app.ts` global `express.json({ limit: "1mb" })` katmanını TÜM router'lardan
// ÖNCE mount ediyor. Bu yüzden içe aktarım router'ının kendi 10 MB'lık
// `express.json` katmanı HİÇ KOŞMUYORDU: 2 MB'lık (~6.000 satır) bir müşteri
// CSV'si global katmanda 413'e düşüyor, ekran "10.000 satır" vaat ederken
// operatör 6.000 satırı yükleyemiyor ve doğru sebep hiçbir yerde yazmıyordu.
//
// Çözüm: global katman bu yolları PARSE ETMEZ (aşağıdaki liste), router kendi
// büyük katmanıyla parse eder. Yolları ayrı ayrı iki yerde yazmak bu hatanın
// ikinci sürümünü üretir — o yüzden liste burada, ve `test_body_limits.ts`
// mekanik olarak doğrular: 10 MB'lık kendi parser'ını taşıyan HER router'ın
// mount ön eki burada olmalı, buradaki her ön ek de gerçekten mount edilmiş
// olmalı (iki yönlü — ölü girdi de gerçek bir açığı gizler).
// =============================================================================

/** Global (1 MB) JSON katmanının ATLAYACAĞI mount ön ekleri. */
// `/api/gelen-belge`: belge fotoğrafı base64 gövdeyle gelir (≤ 5 MB dosya ≈ 6,7 MB gövde; D2, 2026-10-29).
// `/api/etkili-destek`: destek talebi ekleri base64 gelir (5 × 10 MB); yalnız ekli iki POST ucu `SUPPORT_BODY_LIMIT` taşır.
// `/api/warping-beam-rejections`: kusurlu levent ret fotoğrafları base64 (≤ 3 × 5 MB; devere ek C1).
export const BUYUK_GOVDE_YOLLARI = ["/api/import", "/api/config-bundle", "/api/certificates", "/api/gelen-belge", "/api/etkili-destek", "/api/warping-beam-rejections"] as const;

/** Global JSON gövde limiti — 413 mesajı da buradan okunur (metin sabiti YOK). */
export const VARSAYILAN_GOVDE_LIMITI = "1mb";

/** Büyük gövde taşıyan router'ların limiti. */
export const BUYUK_GOVDE_LIMITI = "10mb";

/** Sertifika belge eki (base64, ≤ 5 MB dosya ≈ 6,7 MB gövde) router'ının kendi limiti (K4P-SERT). */
export const CERTIFICATE_BODY_LIMIT = "8mb";

/** Etkili Destek ekli uçlarının limiti: 5 dosya × 10 MB, base64 (×4/3) + metin payı. */
export const SUPPORT_BODY_LIMIT = "70mb";

/** Kusurlu levent ret uçları (devere ek C1): ret isteği en çok 3 fotoğrafı base64 taşır (3 × 5 MB × 4/3 + pay). */
export const WARPING_REJECTION_BODY_LIMIT = "22mb";

/** Kendi limiti `BUYUK_GOVDE_LIMITI`ten farklı olan büyük-gövde ön ekleri. */
const PREFIX_LIMITS: Readonly<Record<string, string>> = {
  "/api/certificates": CERTIFICATE_BODY_LIMIT,
  "/api/etkili-destek": SUPPORT_BODY_LIMIT,
  "/api/warping-beam-rejections": WARPING_REJECTION_BODY_LIMIT,
};

function matchesPrefix(url: string, p: string): boolean {
  return url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`);
}

/** Yolun ETKİN gövde limiti — 413 mesajı bunu söyler. */
export function effectiveBodyLimit(url: string | undefined): string {
  if (!url) return VARSAYILAN_GOVDE_LIMITI;
  const p = BUYUK_GOVDE_YOLLARI.find((x) => matchesPrefix(url, x));
  if (!p) return VARSAYILAN_GOVDE_LIMITI;
  return PREFIX_LIMITS[p] ?? BUYUK_GOVDE_LIMITI;
}

/** İstek yolu büyük-gövde router'larından birine mi ait. */
export function buyukGovdeYolu(url: string | undefined): boolean {
  if (!url) return false;
  return BUYUK_GOVDE_YOLLARI.some((p) => matchesPrefix(url, p));
}
