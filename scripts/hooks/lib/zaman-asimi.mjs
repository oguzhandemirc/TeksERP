// =============================================================================
// KAPI ADIMI ZAMAN AŞIMI — `TEKSERP_KAPI_ZAMAN_ASIMI_SN` (pozitif tam sayı saniye)
// =============================================================================
// NEDEN (2026-10-31): ~10 paralel ajanda (load 55–73) "Teks-Erp · tip" sabit 600 sn'de
// SIGTERM'le düştü, commit atılamadı. Kaçış yasak; süre ayarlanabilir. Yoksa/geçersizse
// 600 (bugünkü davranış); geçersiz değer sessiz yutulmaz, stderr'e tek satır uyarı.
export const KAPI_ZAMAN_ASIMI_ENV = "TEKSERP_KAPI_ZAMAN_ASIMI_SN";
export const KAPI_ZAMAN_ASIMI_VARSAYILAN_SN = 600;

/** Saniye cinsinden süre sınırı; `uyar` geçersiz değerde tek satır alır. */
export function kapiZamanAsimiSn(env = process.env, uyar = (s) => process.stderr.write(s)) {
  const ham = env[KAPI_ZAMAN_ASIMI_ENV];
  if (ham === undefined || ham === "") return KAPI_ZAMAN_ASIMI_VARSAYILAN_SN;
  const t = ham.trim();
  if (/^\d+$/.test(t) && Number(t) > 0 && Number.isSafeInteger(Number(t))) return Number(t);
  uyar(`⚠️ ${KAPI_ZAMAN_ASIMI_ENV}=${JSON.stringify(ham)} geçersiz (pozitif tam sayı saniye bekleniyor) — ${KAPI_ZAMAN_ASIMI_VARSAYILAN_SN} sn kullanılıyor\n`);
  return KAPI_ZAMAN_ASIMI_VARSAYILAN_SN;
}
