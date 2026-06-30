/**
 * Kantar ham yanıtından kg değeri ayıklama (saf parser).
 *
 * Mobil HAL `meter.codec.parseMeterReading`'in Electron eşdeğeri: virgülü noktaya
 * çevir, tüm sayı token'larını bul, SONDAN başa ilk POZİTİF değeri al (durum öneki
 * ve birim ağırlıktan önce/sonra gelebilir; "ST,GS,+12.34kg" → 12.34). Kantar
 * varsayılanı 2 ondalık. `scale` ham→kg çarpanıdır (g→kg: 0.001).
 */
export interface WeightCodecOptions {
  decimals?: number;
  scale?: number;
}

export function parseWeight(raw: string, opts: WeightCodecOptions = {}): number | null {
  if (!raw) return null;
  const decimals = opts.decimals ?? 2;
  const scale = opts.scale ?? 1;
  const matches = raw.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const f = Math.pow(10, decimals);
  for (let i = matches.length - 1; i >= 0; i--) {
    const tok = matches[i];
    if (tok == null) continue;
    const v = parseFloat(tok) * scale;
    if (Number.isFinite(v) && v > 0) return Math.round(v * f) / f;
  }
  return null;
}
