// Servislerin ortak bağlamı: yapılandırma + anahtar deposu (anahtar yenilemede değişir) + portal
// TOTP sır sarmalayıcısı ve etkinleştirme kodu özetleyicisi (ikisinin de sırrı ANAHTAR_DIZINI'nde).
import type { VendorConfig } from "../config";
import type { ActivationCodeHasher } from "../keys/code-pepper";
import type { KeyStore } from "../keys/key-store";
import type { PortalSecretBox } from "../portal/secret-box";

export interface VendorContext {
  readonly config: VendorConfig;
  keys: KeyStore;
  readonly portalSecrets: PortalSecretBox;
  readonly codeHasher: ActivationCodeHasher;
}
