// =============================================================================
// HAL (backend) — metre/kantar codec. Ağ (NETWORK_TCP) bağlı bir kantar/metre
// yanıtını sayıya çözmek için. Mobil `mobil/src/services/hal/meter.codec.ts` ile
// AYNI mantık (son pozitif token, ',' → '.', scale + decimals). Saf — birim test.
// =============================================================================

export interface MeterCodecOptions {
  /** Virgülden sonra anlamlı basamak (varsayılan 1). */
  decimals?: number;
  /** Ham değer → mühendislik birimi çarpanı (örn. cm→m için 0.01). Varsayılan 1. */
  scale?: number;
}

export function parseMeterReading(raw: string, opts: MeterCodecOptions = {}): number | null {
  if (!raw) return null;
  const decimals = opts.decimals ?? 1;
  const scale = opts.scale ?? 1;
  const matches = raw.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const f = Math.pow(10, decimals);
  for (let i = matches.length - 1; i >= 0; i--) {
    const v = parseFloat(matches[i]) * scale;
    if (Number.isFinite(v) && v > 0) return Math.round(v * f) / f;
  }
  return null;
}
