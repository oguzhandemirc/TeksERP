// Servislerin ortak bağlamı. İki DB istemcisi iki ROLDÜR: `app` (hesap API'si; projeksiyona yazamaz)
// ve `sync` (fabrika kanalı + bakım budaması). Saat enjekte edilebilir (bekçiler `now`u kaydırır).
import type { PrismaClient } from "@prisma/client";
import type { SecretBox } from "../auth/secret-box";
import type { CloudConfig } from "../config";
import type { Doorbell } from "./doorbell";
import type { InstallationDirectory } from "./installation-directory";
import type { NotificationRuntime } from "./notification-scheduler";

export interface CloudContext {
  readonly config: CloudConfig;
  readonly app: PrismaClient;
  readonly sync: PrismaClient;
  readonly secrets: SecretBox;
  readonly directory: InstallationDirectory;
  readonly doorbell: Doorbell;
  readonly now: () => number;
  /** Bildirim çalışma zamanı (`BILDIRIM_KIPI=kapali` iken yok). */
  readonly notifications?: NotificationRuntime | null;
}
