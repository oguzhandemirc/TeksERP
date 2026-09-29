// Portalın modül kataloğu: HAK tavanında ve K2'de seçilebilen anahtarlar. Protokol listeyi
// BİLMEZ (yalnız biçim); portal yazım hatasını kapıda keser. Kaynak: backend
// `Teks-Erp/src/constants/module-flags.ts` `MODULE_SETTING_KEYS` + `patron-bulut` hakkı —
// bekçi (test_portal_bayi_tavani §0) ikisinin eşitliğini ölçer.
import { badRequest, VendorError } from "../lib/errors";

export const PRODUCTION_MODULE_KEY = "production.enabled";

export const PORTAL_MODULE_KEYS = [
  "production.enabled",
  "finance.enabled",
  "ticaret.enabled",
  "iplik.enabled",
  "depo.multiEnabled",
  "kumasTeknik.enabled",
  "tezgah.enabled",
  "devere.enabled",
  "dokuma.enabled",
  "emanet.enabled",
  "patron-bulut",
] as const;

/** Yeni HAK'ın varsayılan tavanı: üretim açık (satır yokken TRUE okunan modül — lisans onu kapatmasın). */
export const DEFAULT_ENTITLEMENT_MODULES: readonly string[] = [PRODUCTION_MODULE_KEY];

/** K3 geri sayımının hazır seçenekleri (gün); özel gün de verilebilir. */
export const RESTRICTION_DAY_PRESETS = [0, 7, 15, 30] as const;

export function assertKnownModules(modules: readonly string[]): string[] {
  const unique = [...new Set(modules)];
  const unknown = unique.filter((m) => !(PORTAL_MODULE_KEYS as readonly string[]).includes(m));
  if (unknown.length > 0) throw badRequest(`Tanınmayan modül anahtarı: ${unknown.join(", ")}`);
  return unique;
}

/**
 * Üretim modülü çıkarılıyorsa açık onay ister: fabrikada üretim ekranları (tablet dahil) kapanır.
 * Onaysız çıkarma 400 URETIM_MODULU_UYARISI — arayüz uyarıyı gösterip onayla yeniden gönderir.
 */
export function assertProductionKept(modules: readonly string[], confirmedRemoval: boolean | undefined): void {
  if (modules.includes(PRODUCTION_MODULE_KEY) || confirmedRemoval === true) return;
  throw new VendorError(
    400,
    "URETIM_MODULU_UYARISI",
    `Üretim modülü (${PRODUCTION_MODULE_KEY}) lisanstan çıkarılıyor: fabrikada üretim ekranları ve tablet üretim girişi kapanır. Bilerek yapıyorsanız "uretimModuluCikarilsin: true" ile onaylayın.`,
  );
}
