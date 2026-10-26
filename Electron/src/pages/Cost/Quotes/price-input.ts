// Kesin birim fiyat girişi: en çok 2 ondalık hane (sunucu `PRICE_RULE` scale 2 aynası). Sayıya ÇEVRİLMEZ —
// yalnız biçim denetlenir, sunucunun Decimal metni üretilir. Hesap (tutar, toplam) sunucudadır.
import { toDecimalText } from "../shared/format";

export type PriceCheck = { ok: true; text: string } | { ok: false; error: string };

const PRICE_RE = /^\d{1,10}(\.\d{1,2})?$/;

export function checkUnitPrice(raw: string): PriceCheck {
  const text = toDecimalText(raw);
  if (!text) return { ok: false, error: "Fiyat boş olamaz." };
  if (!PRICE_RE.test(text)) {
    return { ok: false, error: /^\d+\.\d{3,}$/.test(text) ? "Birim fiyat en çok 2 ondalık hane olabilir." : "Geçerli bir fiyat girin (ör. 2,67)." };
  }
  return { ok: true, text };
}

/** Kayıtlı Decimal metniyle aynı mı (biçim farkı: "2.70" ↔ "2,7")? Aynıysa istek atılmaz. */
export function samePriceText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return norm(a) === norm(b);
}
