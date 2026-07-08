// =============================================================================
// netStats — istemci tarafı istek süresi ölçümü (RUM-hafif).
// =============================================================================
// Neden: sunucu tarafı ölçüm (morgan) sahada kullanıcının HİSSETTİĞİ süreyi
// göstermez — kuyruk, retry, Keystore, Wi-Fi kopması hep istemcide yaşanır.
// api.ts interceptor'ları her isteğin süresini buraya yazar; eşik üstü istek
// console.warn ile adb logcat/Metro'dan sahada okunur. UI yok (gerekirse
// Ayarlar'a "son yavaş istekler" listesi olarak dökülebilir — getNetStats hazır).

export interface NetSample {
  method: string;
  url: string;
  /** HTTP status; ağ hatası 'ERR', istemci timeout'u 'TIMEOUT'. */
  status: number | 'ERR' | 'TIMEOUT';
  ms: number;
  /** Date.now() — örnek zamanı. */
  at: number;
}

/** Ring buffer boyu — sabit bellek, sızıntı yok. */
const MAX_SAMPLES = 100;
/** Bu eşiğin üstü "yavaş istek" uyarısı basar. */
export const SLOW_REQUEST_MS = 3_000;

const samples: NetSample[] = [];

export function recordNetSample(sample: NetSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  if (sample.ms >= SLOW_REQUEST_MS) {
    console.warn(
      `YAVAŞ İSTEK: ${sample.method} ${sample.url} ${Math.round(sample.ms)}ms (status ${sample.status})`,
    );
  }
}

/** Son örnekler (en yeni sonda) — okuma amaçlı; kopya döner. */
export function getNetStats(): NetSample[] {
  return [...samples];
}
