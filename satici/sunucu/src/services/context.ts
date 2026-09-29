// Servislerin ortak bağlamı: yapılandırma + anahtar deposu (anahtar yenilemede değişir) + portal
// TOTP sır sarmalayıcısı (anahtarı ANAHTAR_DIZINI'nde).
import type { VendorConfig } from "../config";
import type { KeyStore } from "../keys/key-store";
import type { PortalSecretBox } from "../portal/secret-box";

export interface VendorContext {
  readonly config: VendorConfig;
  keys: KeyStore;
  readonly portalSecrets: PortalSecretBox;
}
