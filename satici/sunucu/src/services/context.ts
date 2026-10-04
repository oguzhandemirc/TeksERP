// Servislerin ortak bağlamı: yapılandırma + anahtar deposu (anahtar yenilemede değişir) + portal
// TOTP sır sarmalayıcısı, etkinleştirme kodu özetleyicisi ve modül anahtarı kasası (sırları ANAHTAR_DIZINI'nde).
import type { VendorConfig } from "../config";
import type { AccessVerifier } from "../http/access-jwt";
import type { ActivationCodeHasher } from "../keys/code-pepper";
import type { KeyStore } from "../keys/key-store";
import type { ModuleKeyVault } from "../keys/module-vault";
import type { PortalSecretBox } from "../portal/secret-box";
import type { DoorbellHub } from "./doorbell";

/** Süreç düzeyi canlı parçalar — yalnız sağlık özeti okur (services/system-health.ts). */
export interface RuntimeHandles {
  readonly hub: Pick<DoorbellHub, "listening" | "subscriberCount" | "delivered"> | null;
  readonly access: AccessVerifier | null;
}

export interface VendorContext {
  readonly config: VendorConfig;
  keys: KeyStore;
  readonly portalSecrets: PortalSecretBox;
  readonly codeHasher: ActivationCodeHasher;
  /** Modül anahtarı kasası (Faz 2d) — anahtarı ANAHTAR_DIZINI'nde. */
  readonly moduleVault: ModuleKeyVault;
  /** Sunucu süreci kurar; yoksa (bekçinin süreç içi bağlamı) sağlık özetinde zil ve ERİŞİM "kapalı" görünür. */
  readonly runtime?: RuntimeHandles;
}
