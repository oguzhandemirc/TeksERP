// BİLDİRİM GÖNDERİCİ — yan konteyner `satici-bildirim`in giriş noktası (satıcı imajı, farklı komut:
// `node dist/notifications/sender-main.js`; `--tek-tur` bir tur koşup çıkar). Satıcının DIŞ BAĞLANTISI yoktur:
// e-posta (Resend) ve Telegram çağrısını YALNIZ bu süreç, yalnız çıkış ağından yapar; DB'ye en az yetkili rolle
// bağlanır (açılış kapısı fazla yetkiyi reddeder). Nabız dosyası her başarılı turda yazılır (compose sağlık
// denetimi tazeliğine bakar, kanal durumunu basar). Günlüğe yalnız SAYI ve kanal durumu düşer — ileti, alıcı
// dışı içerik, belirteç, anahtar DÜŞMEZ.
import { writeFileSync } from "node:fs";
import type { BildirimKanali } from "@prisma/client";
import { runSenderCycle, type CycleTotals } from "./sender";
import { channelSummary, loadSenderConfig, type SenderConfig } from "./sender-config";
import { assertLeastPrivilege, openSenderDb } from "./sender-db";
import { ResendTransport, TelegramTransport, type NotificationTransport } from "./transports";

function transportsOf(cfg: SenderConfig): Partial<Record<BildirimKanali, NotificationTransport>> {
  return {
    ...(cfg.email.ok ? { EPOSTA: new ResendTransport(cfg.email.settings) } : {}),
    ...(cfg.telegram.ok ? { TELEGRAM: new TelegramTransport(cfg.telegram.settings) } : {}),
  };
}

function heartbeat(cfg: SenderConfig, totals: CycleTotals, telegram: TelegramTransport | undefined): void {
  const runtime = telegram?.migration ? { telegramMigratedTo: telegram.migration.chatId } : {};
  const body = { zaman: new Date().toISOString(), kanallar: channelSummary(cfg, runtime), son: totals };
  writeFileSync(cfg.heartbeatFile, `${JSON.stringify(body)}\n`, { mode: 0o600 });
}

const busy = (t: CycleTotals): boolean => Object.values(t).some((n) => n > 0);

async function main(): Promise<void> {
  const once = process.argv.includes("--tek-tur");
  const cfg = loadSenderConfig(process.env);
  const db = openSenderDb(cfg.databaseUrl);
  await assertLeastPrivilege(db.prisma);
  const transports = transportsOf(cfg);
  const telegram = transports.TELEGRAM instanceof TelegramTransport ? transports.TELEGRAM : undefined;
  const deps = {
    db: db.prisma,
    transports,
    settings: { maxAttempts: cfg.maxAttempts, maxAgeHours: cfg.maxAgeHours, portalBase: cfg.portalBase, timeZone: cfg.timeZone },
    pausedUntil: new Map<BildirimKanali, number>(),
  };
  let warnedMigration: number | null = null;
  for (const [kanal, durum] of Object.entries(channelSummary(cfg))) console.log(`[bildirim] ${kanal}: ${durum}`);
  console.log(`BILDIRIM_GONDERICI_HAZIR eposta=${cfg.email.ok ? "acik" : "kapali"} telegram=${cfg.telegram.ok ? "acik" : "kapali"}`);

  let stopping = false;
  let wake: (() => void) | null = null;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`[bildirim] ${signal}: tur bitince kapanıyor`);
    wake?.();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  do {
    try {
      const t = await runSenderCycle(deps, Date.now());
      if (busy(t)) console.log(`[bildirim] tur: gönderilen ${t.sent} · yeniden denenecek ${t.retried} · hata ${t.failed} · kapalı kanal ${t.closed} · süresi geçen ${t.expired} · kaçan claim ${t.lost} · kanal beklemesi ${t.paused}`);
      if (telegram?.migration && telegram.migration.atMs !== warnedMigration) {
        warnedMigration = telegram.migration.atMs;
        console.warn(`[bildirim] TELEGRAM: ${channelSummary(cfg, { telegramMigratedTo: telegram.migration.chatId }).TELEGRAM}`);
      }
      heartbeat(cfg, t, telegram);
    } catch (err) {
      console.error(`[bildirim] tur düştü: ${(err as Error).message.slice(0, 200)}`);
    }
    if (once || stopping) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, cfg.loopSeconds * 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  } while (!stopping);
  await db.close();
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    console.error(`[bildirim] açılış başarısız: ${err.message}`);
    process.exit(1);
  },
);
