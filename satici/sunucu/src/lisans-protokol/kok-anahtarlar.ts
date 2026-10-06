// Güven çapası: kök açık anahtarları ve her kökün imzalayabileceği sınıflar — TEK kip (üretim).
import type { LicenseClass } from "./belgeler";

export interface RootKey {
  /** `kok-<yıl>-<n>`; başka aile (eski `hazirlik-*` dahil) çapada biçim düzeyinde reddedilir. */
  readonly kid: string;
  /** Ham 32 baytlık Ed25519 açık anahtarı, base64url. */
  readonly x: string;
  readonly classes: readonly LicenseClass[];
}

/**
 * Çapa kipi: tek değer. Küme native künyesinin `capaKipi` alanını da süzer — başka kiple derlenmiş bir ikili
 * (ör. eski `hazirlik-capasi`) yükleyicide reddedilir.
 */
export const TRUST_ANCHOR_MODES = Object.freeze(["uretim"] as const);
export type TrustAnchorMode = (typeof TRUST_ANCHOR_MODES)[number];

/**
 * Üretim kökleri (`kok-<yıl>-<n>`, tören) — bütün sınıflar. Satır yalnız `Teks-Erp/scripts/guven-capasi-ekle.ts kok`
 * ile eklenir (satıcı ve patron aynası + native `anchor.rs` birlikte); rotasyonda yeni kid EKLENİR.
 */
export const PRODUCTION_ROOT_PUBLIC_KEYS: readonly RootKey[] = Object.freeze([
  Object.freeze({
    kid: "kok-2026-1",
    x: "sPveT3g3QhV8F_-xN2ZF0MVXFX1HHSiYzZ1GHYbPhEY",
    classes: Object.freeze<LicenseClass[]>(["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"]),
  }),
]);

const NO_ROOTS: readonly RootKey[] = Object.freeze([]);

export function isTrustAnchorMode(v: unknown): v is TrustAnchorMode {
  return v === "uretim";
}

/** Kipin kök çapası. Doğrulama fonksiyonları çapayı ARGÜMAN alır; tanınmayan kip boş çapadır (fail-closed). */
export function rootPublicKeysFor(mode: TrustAnchorMode): readonly RootKey[] {
  if (mode === "uretim") return PRODUCTION_ROOT_PUBLIC_KEYS;
  return NO_ROOTS;
}
