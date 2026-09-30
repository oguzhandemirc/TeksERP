// Üretim güven çapası: kök açık anahtarları ve her kökün imzalayabileceği sınıflar.
import type { LicenseClass } from "./belgeler";

export interface RootKey {
  /** `kok-<yıl>-<n>` üretim, `hazirlik-<yıl>-<n>` hazırlık kökü. */
  readonly kid: string;
  /** Ham 32 baytlık Ed25519 açık anahtarı, base64url. */
  readonly x: string;
  readonly classes: readonly LicenseClass[];
}

/**
 * Hazırlık kökü yalnız TEST/DEMO imzalar; ÜRETİM · DR · BAYI · BARINDIRILAN yalnız törenle eklenen üretim
 * kökleriyle (`kok-<yıl>-<n>`) geçerli olur — listede üretim kökü yokken o sınıflarda hiçbir HAK geçerli
 * değildir (fail-closed). Satır yalnız `Teks-Erp/scripts/guven-capasi-ekle.ts kok` ile eklenir (satıcı ve
 * patron aynası + native `anchor.rs` birlikte); rotasyonda yeni kid EKLENİR, eskisi örtüşme penceresinde kalır.
 * Doğrulama fonksiyonları çapayı ARGÜMAN alır; bu sabit yalnız üretim çağıranının girdisidir.
 */
export const ROOT_PUBLIC_KEYS: readonly RootKey[] = Object.freeze([
  Object.freeze({
    kid: "hazirlik-2026-1",
    x: "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo",
    classes: Object.freeze<LicenseClass[]>(["TEST", "DEMO"]),
  }),
]);

/** Hazırlık kökü ÜRETİM imzalayamaz; çapa bu kümeyi aşan bir hazırlık kökünü reddeder. */
export const STAGING_ROOT_CLASSES: readonly LicenseClass[] = Object.freeze(["TEST", "DEMO"]);
