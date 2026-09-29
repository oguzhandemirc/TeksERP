// Servislerin ortak bağlamı: yapılandırma + anahtar deposu (anahtar yenilemede değişir).
import type { VendorConfig } from "../config";
import type { KeyStore } from "../keys/key-store";

export interface VendorContext {
  readonly config: VendorConfig;
  keys: KeyStore;
}
