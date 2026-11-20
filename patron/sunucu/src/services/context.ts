// Servislerin ortak bağlamı. İki DB istemcisi iki ROLDÜR: `app` (hesap API'si; projeksiyona yazamaz)
// ve `sync` (fabrika kanalı + bakım budaması). Saat enjekte edilebilir (bekçiler `now`u kaydırır).
import type { SecretBox } from "../auth/secret-box";
import type { CloudConfig } from "../config";
import type { BridgeTransport } from "../push/transports";
import type { SupportRuntime } from "./destek/config";
import type { Doorbell } from "./doorbell";
import type { InstallationDirectory } from "./installation-directory";
import type { NotificationRuntime } from "./notification-scheduler";
import type { TesisDbRouter } from "../lib/tesis-db";

export interface CloudContext {
  readonly config: CloudConfig;
  readonly app: TesisDbRouter;
  readonly sync: TesisDbRouter;
  readonly secrets: SecretBox;
  readonly directory: InstallationDirectory;
  readonly doorbell: Doorbell;
  readonly now: () => number;
  /** Bildirim çalışma zamanı (`BILDIRIM_KIPI=kapali` iken yok). */
  readonly notifications?: NotificationRuntime | null;
  /** Push köprüsü taşıyıcısı — verilmezse kipten türetilir (`push-bridge.ts` `bridgeTransport`); `null` = gönderim kapalı. */
  readonly pushBridge?: BridgeTransport | null;
  /** Etkili Destek çalışma zamanı; yoksa destek KAPALI (uçlar 403 `MODULE_DISABLED`, webhook 404, dış istek yok). */
  readonly destek?: SupportRuntime | null;
}
