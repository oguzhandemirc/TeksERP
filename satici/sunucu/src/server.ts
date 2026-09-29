// SATICI SUNUCUSU — tek süreç, üç dinleyici: GENEL (/v1/*, /q) + TAILNET (portal; kök parolası) + İÇ
// (patron bulutunun iç API'si; yalnız ortak sır dosyası geçerliyse açılır). Açılış: yapılandırma
// (fail-closed) → anahtar deposu → anahtar künyesi → zil (PG LISTEN) → dinleyiciler → bakım işi. Kapanış: SIGTERM/SIGINT'te akışlar ve bağlantılar düzgün kapanır.
import { mkdirSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "./config";
import { ActivationCodeHasher } from "./keys/code-pepper";
import { KeyStore } from "./keys/key-store";
import { setSignerConcurrency } from "./keys/signer";
import { loadEnvFile } from "./lib/env";
import { pool, prisma } from "./lib/prisma";
import { createPublicApp } from "./http/public-app";
import { createInternalApp } from "./http/internal-app";
import { createTailnetApp } from "./http/tailnet-app";
import { loadInternalBearer } from "./lib/internal-bearer";
import { PortalSecretBox } from "./portal/secret-box";
import { ModuleKeyVault } from "./keys/module-vault";
import type { VendorContext } from "./services/context";
import { DoorbellHub } from "./services/doorbell";
import { InternalApiCounters } from "./services/internal-api.service";
import { MaintenanceScheduler, syncKeyRegistry } from "./services/maintenance";
import { webAppAvailable } from "./http/web-static";

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
  setSignerConcurrency(config.IMZA_ESZAMANLI);
  const keys = KeyStore.load(config);
  for (const w of keys.warnings) console.warn(`[satici] anahtar: ${w}`);
  for (const app of ["portal", "bayi"] as const) {
    if (!webAppAvailable(config.PORTAL_WEB_DIZINI, app)) console.warn(`[satici] web arayüzü (${app}) derlenmemiş: /${app} 404 döner, API çalışır`);
  }
  mkdirSync(config.ANAHTAR_DIZINI, { recursive: true, mode: 0o700 });
  const ctx: VendorContext = {
    config,
    keys,
    portalSecrets: PortalSecretBox.load(config.ANAHTAR_DIZINI, { create: true }),
    moduleVault: ModuleKeyVault.load(config.ANAHTAR_DIZINI, { create: true }),
    codeHasher: ActivationCodeHasher.load(config.ANAHTAR_DIZINI, { create: true }),
  };
  await syncKeyRegistry(keys).catch((err: Error) => console.error(`[satici] anahtar künyesi yazılamadı: ${err.message}`));

  const hub = new DoorbellHub(config.DATABASE_URL, config.ZIL_KALP_SN, config.ZIL_AZAMI_ABONE);
  await hub.start();

  const publicServer = http.createServer(createPublicApp(ctx, hub));
  let tailnetAddress: AddressInfo | null = null;
  const tailnetServer = http.createServer(createTailnetApp(ctx, hub, () => tailnetAddress));
  const publicAddress = await listen(publicServer, config.PORT_GENEL, config.GENEL_BIND);
  tailnetAddress = await listen(tailnetServer, config.PORT_TAILNET, config.TAILNET_BIND);

  const internalCounters = new InternalApiCounters();
  const bearer = loadInternalBearer(config.IC_API_BELIRTEC_DOSYASI);
  let internalAddress: AddressInfo | null = null;
  let internalServer: http.Server | null = null;
  if (bearer.ok) {
    internalServer = http.createServer(createInternalApp(ctx, { bearer: bearer.bearer, counters: internalCounters, listener: () => internalAddress }));
    internalAddress = await listen(internalServer, config.PORT_IC, config.IC_BIND);
  } else {
    console.warn(`[satici] iç API KAPALI: ${bearer.reason}`);
  }
  const counterTimer = setInterval(() => void internalCounters.flush(), config.IC_SAYAC_DK * 60_000);
  counterTimer.unref();
  console.log(`SATICI_DINLIYOR genel=${publicAddress.port} tailnet=${tailnetAddress.port} ic=${internalAddress ? internalAddress.port : "kapali"}`);

  const maintenance = new MaintenanceScheduler(ctx);
  maintenance.start();
  void maintenance.runOnce();

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[satici] ${signal}: kapanıyor`);
    maintenance.stop();
    clearInterval(counterTimer);
    await hub.stop();
    await Promise.all([
      new Promise<void>((r) => publicServer.close(() => r())),
      new Promise<void>((r) => tailnetServer.close(() => r())),
      new Promise<void>((r) => (internalServer ? internalServer.close(() => r()) : r())),
    ]);
    await internalCounters.flush();
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: Error) => {
  console.error(`[satici] açılış başarısız: ${err.message}`);
  process.exit(1);
});
