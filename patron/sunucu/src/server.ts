// PATRON BULUTU SUNUCUSU — tek süreç, tek dinleyici (`/v1/*` fabrika kanalı + `/api/*` hesap API'si).
// Açılış (fail-closed): yapılandırma → iki DB rolü RLS'i ATLAYAMAZ (süper kullanıcı ya da BYPASSRLS
// ise sunucu KALKMAZ) → TOTP sır anahtarı → web çıktısı (verildiyse yoksa KALKMAZ) → dinleyici → bakım işi.
import { mkdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SecretBox } from "./auth/secret-box";
import { loadConfig } from "./config";
import { closeDatabase, createDatabase, roleBypassesRls } from "./lib/db";
import { loadEnvFile } from "./lib/env";
import { createApp } from "./http/app";
import type { CloudContext } from "./services/context";
import { createDoorbell } from "./services/doorbell";
import { InstallationDirectory } from "./services/installation-directory";
import { MaintenanceScheduler } from "./services/maintenance";

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
  const app = createDatabase(config.DATABASE_URL, "uygulama");
  const sync = createDatabase(config.ESITLEME_DATABASE_URL, "esitleme");
  for (const db of [app, sync]) {
    const r = await roleBypassesRls(db);
    if (r.bypass) throw new Error(`${db.label} rolü (${r.role}) RLS'i atlayabiliyor (süper kullanıcı/BYPASSRLS) — kiracı yalıtımı yok, açılış DURDU`);
  }
  mkdirSync(config.ANAHTAR_DIZINI, { recursive: true, mode: 0o700 });
  const ctx: CloudContext = {
    config,
    app: app.prisma,
    sync: sync.prisma,
    secrets: SecretBox.load(config.ANAHTAR_DIZINI, { create: true }),
    directory: new InstallationDirectory(sync.prisma, config),
    doorbell: createDoorbell(config),
    now: () => Date.now(),
  };
  const server = http.createServer(createApp(ctx));
  const address = await listen(server, config.PORT, config.BIND);
  console.log(`PATRON_DINLIYOR port=${address.port} kurulumKaynagi=${config.KURULUM_KAYNAGI} web=${config.PATRON_WEB_DIZINI ? "acik" : "yok"}`);

  const maintenance = new MaintenanceScheduler(ctx);
  maintenance.start();
  void maintenance.runOnce();

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[patron] ${signal}: kapanıyor`);
    maintenance.stop();
    await new Promise<void>((r) => server.close(() => r()));
    await closeDatabase(app);
    await closeDatabase(sync);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: Error) => {
  console.error(`[patron] açılış başarısız: ${err.message}`);
  process.exit(1);
});
