import type { DeviceCodec } from './transport.types';

// =============================================================================
// Metre/kantar codec — cihazın ASCII yanıtından sayısal değeri ayıklar.
// İstek-cevap protokolünde cihaz "123.4\r\n" / "M=123.4" / "LEN 0123.45 m" gibi
// yanıt verebilir → metni tarar, SON pozitif sayısal token'ı alır (etiket öneki
// varsa değer sonda olur), ',' → '.', `scale` ile ölçekler, `decimals`'a yuvarlar.
//
// Saf — native modülden bağımsız, birim test edilir. Varsayılanlar (decimals=1,
// scale=1) eski `btMeter.parseMeterReading` davranışını birebir korur.
// =============================================================================

export interface MeterCodecOptions {
  /** Virgülden sonra anlamlı basamak (varsayılan 1). */
  decimals?: number;
  /** Ham değer → mühendislik birimi çarpanı (örn. cm→m için 0.01). Varsayılan 1. */
  scale?: number;
  /**
   * Değer ayıklama regex'i (cihaz `identifyPattern`). Verilirse 1. yakalama grubu
   * (yoksa tüm eşleşme) sayı olarak alınır — cihaza özel gürültüyü (durum bayrağı
   * `@`/`B`, sondaki `0`) net eler. Boşsa "son pozitif sayı" sezgiseline düşülür
   * (geriye uyum: eski davranış birebir korunur).
   */
  pattern?: string;
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

export function parseMeterReading(raw: string, opts: MeterCodecOptions = {}): number | null {
  if (!raw) return null;
  const decimals = opts.decimals ?? 1;
  const scale = opts.scale ?? 1;
  const text = raw.replace(/,/g, '.');

  // 1) Cihaza özel regex — varsa önce onu dene (kesin ayıklama).
  if (opts.pattern && opts.pattern.trim()) {
    try {
      const m = text.match(new RegExp(opts.pattern));
      if (m) {
        const token = m[1] ?? m[0];
        const v = parseFloat(token) * scale;
        if (Number.isFinite(v) && v > 0) return round(v, decimals);
      }
    } catch {
      // Geçersiz regex → sezgisele düş (backend kayıtta doğruluyor ama savunma).
    }
  }

  // 2) Sezgisel: satırdaki SON pozitif sayı (etiket öneki varsa değer sondadır;
  //    sondaki durum "0" pozitif olmadığı için atlanır).
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const v = parseFloat(matches[i]) * scale;
    if (Number.isFinite(v) && v > 0) return round(v, decimals);
  }
  return null;
}

/** Bir PeripheralDevice satırının protokol alanlarından metre codec'i kur. */
export function meterCodec(opts: MeterCodecOptions = {}): DeviceCodec<number> {
  return { decode: (raw: string) => parseMeterReading(raw, opts) };
}
