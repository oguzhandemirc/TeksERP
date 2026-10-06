// PATRON BULUTU SUNUCUSU — tek süreç, tek dinleyici (`/v1/*` fabrika kanalı + `/api/*` hesap API'si).
// Açılış (fail-closed): yapılandırma → iki merkez rolü RLS'i ATLAYAMAZ (süper kullanıcı ya da BYPASSRLS
// ise sunucu KALKMAZ) → tesis DB anahtarı → iki yönlendirici (uygulama · eşitleme; tesis DB'leri istek anında)
// → TOTP sır anahtarı → web çıktısı (verildiyse yoksa KALKMAZ) → dinleyici → bakım işi.
import { mkdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { FacilityDbKey, facilityDbKeyPath } from "./auth/facility-db-key";
import { SecretBox } from "./auth/secret-box";
import { loadConfig } from "./config";
import { roleBypassesRls } from "./lib/db";
import { loadEnvFile } from "./lib/env";
import { TesisDbRouter } from "./lib/tesis-db";
import { expectedSchemaVersion } from "./lib/tesis-goc";
import { createApp } from "./http/app";
import type { CloudContext } from "./services/context";
import { createDoorbell } from "./services/doorbell";
import { InstallationDirectory } from "./services/installation-directory";
import { MaintenanceScheduler } from "./services/maintenance";
import { createNotificationRuntime, NotificationScheduler } from "./services/notification-scheduler";

function listen(server: http.Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  mkdirSync(config.ANAHTAR_DIZINI, { recursive: true, mode: 0o700 });
  const keyPath = facilityDbKeyPath({ TESIS_ROL_ANAHTARI_DOSYASI: config.TESIS_ROL_ANAHTARI_DOSYASI, ANAHTAR_DIZINI: config.ANAHTAR_DIZINI }, process.cwd());
  const key = FacilityDbKey.load(keyPath.file, { create: !keyPath.explicit });
  const schemaVersion = expectedSchemaVersion();
  const app = new TesisDbRouter({ role: "uygulama", centralUrl: config.DATABASE_URL, key, schemaVersion });
  const sync = new TesisDbRouter({ role: "esitleme", centralUrl: config.ESITLEME_DATABASE_URL, key, schemaVersion });
  for (const router of [app, sync]) {
    const r = await roleBypassesRls(router.central);
    if (r.bypass) throw new Error(`${router.central.label} rolü (${r.role}) RLS'i atlayabiliyor (süper kullanıcı/BYPASSRLS) — kiracı yalıtımı yok, açılış DURDU`);
  }
  const ctx: CloudContext = {
    config,
    app,
    sync,
    secrets: SecretBox.load(config.ANAHTAR_DIZINI, { create: true }),
    directory: new InstallationDirectory(sync, config),
    doorbell: createDoorbell(config),
    now: () => Date.now(),
    notifications: createNotificationRuntime(config),
  };
  const server = http.createServer(createApp(ctx));
  const address = await listen(server, config.PORT, config.BIND);
  console.log(`PATRON_DINLIYOR port=${address.port} kurulumKaynagi=${config.KURULUM_KAYNAGI} web=${config.PATRON_WEB_DIZINI ? "acik" : "yok"}`);

  const maintenance = new MaintenanceScheduler(ctx);
  maintenance.start();
  void maintenance.runOnce();
  const notifier = ctx.notifications ? new NotificationScheduler(ctx, ctx.notifications) : null;
  notifier?.start();
  console.log(`PATRON_BILDIRIM kip=${config.BILDIRIM_KIPI}`);

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[patron] ${signal}: kapanıyor`);
    maintenance.stop();
    notifier?.stop();
    await new Promise<void>((r) => server.close(() => r()));
    await app.close();
    await sync.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: Error) => {
  console.error(`[patron] açılış başarısız: ${err.message}`);
  process.exit(1);
});
