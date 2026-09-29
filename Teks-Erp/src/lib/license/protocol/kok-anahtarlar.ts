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
 * BOŞ doğar: gerçek kök üretilene dek hiçbir HAK geçerli olamaz (fail-closed).
 * Rotasyonda yeni kid bir sürümle EKLENİR, eskisi örtüşme penceresi boyunca kalır.
 * Doğrulama fonksiyonları çapayı ARGÜMAN alır; bu sabit yalnız üretim çağıranının girdisidir.
 */
export const ROOT_PUBLIC_KEYS: readonly RootKey[] = Object.freeze([]);

/** Hazırlık kökü ÜRETİM imzalayamaz; çapa bu kümeyi aşan bir hazırlık kökünü reddeder. */
export const STAGING_ROOT_CLASSES: readonly LicenseClass[] = Object.freeze(["TEST", "DEMO"]);
