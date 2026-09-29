// Servislerin ortak bağlamı: yapılandırma + anahtar deposu (anahtar yenilemede değişir) + portal
// TOTP sır sarmalayıcısı, etkinleştirme kodu özetleyicisi ve modül anahtarı kasası (sırları ANAHTAR_DIZINI'nde).
import type { VendorConfig } from "../config";
import type { ActivationCodeHasher } from "../keys/code-pepper";
import type { KeyStore } from "../keys/key-store";
import type { ModuleKeyVault } from "../keys/module-vault";
import type { PortalSecretBox } from "../portal/secret-box";

export interface VendorContext {
  readonly config: VendorConfig;
  keys: KeyStore;
  readonly portalSecrets: PortalSecretBox;
  readonly codeHasher: ActivationCodeHasher;
  /** Modül anahtarı kasası (Faz 2d) — anahtarı ANAHTAR_DIZINI'nde. */
  readonly moduleVault: ModuleKeyVault;
}
