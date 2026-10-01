// Güven çapası: kök açık anahtarları ve her kökün imzalayabileceği sınıflar — derleme kipine göre İKİ liste.
import type { LicenseClass } from "./belgeler";

export interface RootKey {
  /** `kok-<yıl>-<n>` üretim, `hazirlik-<yıl>-<n>` hazırlık kökü. */
  readonly kid: string;
  /** Ham 32 baytlık Ed25519 açık anahtarı, base64url. */
  readonly x: string;
  readonly classes: readonly LicenseClass[];
}

/**
 * Çapa kipi: ÜRETİM derlemesi yalnız üretim köklerine, HAZIRLIK derlemesi yalnız hazırlık köklerine güvenir; iki
 * liste hiçbir derlemede birleşmez (daha az korunan hazırlık kökünün imzası üretim kurulumunda geçmesin).
 */
export const TRUST_ANCHOR_MODES = Object.freeze(["uretim", "hazirlik"] as const);
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

/** Hazırlık kökleri (`hazirlik-<yıl>-<n>`) — yalnız TEST/DEMO; aynı betikle eklenir. */
export const STAGING_ROOT_PUBLIC_KEYS: readonly RootKey[] = Object.freeze([
  Object.freeze({
    kid: "hazirlik-2026-1",
    x: "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo",
    classes: Object.freeze<LicenseClass[]>(["TEST", "DEMO"]),
  }),
]);

const NO_ROOTS: readonly RootKey[] = Object.freeze([]);

export function isTrustAnchorMode(v: unknown): v is TrustAnchorMode {
  return v === "uretim" || v === "hazirlik";
}

/** Kipin kök çapası. Doğrulama fonksiyonları çapayı ARGÜMAN alır; tanınmayan kip boş çapadır (fail-closed). */
export function rootPublicKeysFor(mode: TrustAnchorMode): readonly RootKey[] {
  if (mode === "uretim") return PRODUCTION_ROOT_PUBLIC_KEYS;
  if (mode === "hazirlik") return STAGING_ROOT_PUBLIC_KEYS;
  return NO_ROOTS;
}

/** Hazırlık kökü ÜRETİM imzalayamaz; çapa bu kümeyi aşan bir hazırlık kökünü reddeder. */
export const STAGING_ROOT_CLASSES: readonly LicenseClass[] = Object.freeze(["TEST", "DEMO"]);
