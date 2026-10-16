// =============================================================================
// deneme-veri — doldurmanın belirlenimli clientToken'ı (UUIDv5, RFC 4122 §4.3). Aynı mantıksal kayıt her koşumda
// aynı tokenı taşır ⇒ ikinci koşum sunucunun token-replay boğazına düşer, kayıt çoğalmaz. Bekçi: test_deneme_veri §8.
// =============================================================================
import { createHash } from "node:crypto";

/** Sabit ad alanı (deneme-veri doldurması); değişirse tüm tokenlar değişir ⇒ ikinci koşum ÇOĞALTIR. Değiştirme. */
export const AD_ALANI = "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f";

export function belirlenimliToken(anahtar, adAlani = AD_ALANI) {
  const ns = Buffer.from(adAlani.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(anahtar), "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
