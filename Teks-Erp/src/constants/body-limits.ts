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
export const BUYUK_GOVDE_YOLLARI = ["/api/import", "/api/config-bundle"] as const;

/** Global JSON gövde limiti — 413 mesajı da buradan okunur (metin sabiti YOK). */
export const VARSAYILAN_GOVDE_LIMITI = "1mb";

/** Büyük gövde taşıyan router'ların limiti. */
export const BUYUK_GOVDE_LIMITI = "10mb";

/** İstek yolu büyük-gövde router'larından birine mi ait. */
export function buyukGovdeYolu(url: string | undefined): boolean {
  if (!url) return false;
  return BUYUK_GOVDE_YOLLARI.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
}
