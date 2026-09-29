// D4 kalıbı — imzalı istek `ISTEK_ZAMAN` ile reddedilip İMZASIZ sunucu saati dönünce düzeltme payı (duvar − sunucu).
// Lisans (satıcı) ve patron bulutu kanalı AYNI yardımcıyı kullanır; pay yalnız bir kez yeniden imzalanan isteğin
// damgasına girer, güvenilir saate ve kademeye girmez.

/** `ISTEK_ZAMAN` + geçerli sunucu saati → düzeltme payı (ms); aksi hâlde null (yeniden deneme yok). */
export function requestClockSkewMs(code: string, serverTimeMs: number | undefined, receivedAtMs: number): number | null {
  if (code !== "ISTEK_ZAMAN" || serverTimeMs === undefined || !Number.isFinite(serverTimeMs)) return null;
  return receivedAtMs - serverTimeMs;
}
