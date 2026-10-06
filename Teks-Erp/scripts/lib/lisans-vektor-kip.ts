// Gömülü çapa vektörlerinin KİP yardımcıları — iki vektör üreticisinin (çekirdek + bütünlük) ortak kaynağı;
// ayrı dosyada ki üreticiler birbirini çalışma anında içe aktarmasın (döngü).
import { TRUST_ANCHOR_MODES, rootPublicKeysFor, type TrustAnchorMode } from "../../src/lib/license/protocol";
import { packagePublicKeysFor } from "../../src/lib/license/integrity";
import type { Vektor } from "./lisans-cekirdek-vektor";

/**
 * Gömülü çapa vektörünü her kipe (bugün tek: üretim) çoğaltır: aynı belge kipin kendi çapasıyla beklenir. Kipin
 * GERÇEK kid'iyle yabancı anahtarın imzaladığı belge imzada (`JWS_IMZA`) düşer; çapada olmayan kid (eski
 * `hazirlik-*` dahil) kid'de (`KOK_BILINMIYOR` · `JWS_KID`) düşer.
 */
export function kiplere<T extends Vektor>(v: T): T[] {
  return TRUST_ANCHOR_MODES.map((kip) => ({ ...v, ad: `${v.ad} [${kip}]`, kip }));
}

/** Kipin çapasındaki İLK kök kid'i (rotasyonda liste değişirse vektörler onunla yeniden üretilir). */
export function kipKokKidi(kip: TrustAnchorMode): string {
  const kid = rootPublicKeysFor(kip)[0]?.kid;
  if (!kid) throw new Error(`${kip} kök çapası boş — gömülü çapa vektörü kurulamaz`);
  return kid;
}

/** Kipin PAKET çapasındaki İLK kid. */
export function kipPaketKidi(kip: TrustAnchorMode): string {
  const kid = packagePublicKeysFor(kip)[0]?.kid;
  if (!kid) throw new Error(`${kip} PAKET çapası boş — gömülü çapa vektörü kurulamaz`);
  return kid;
}
