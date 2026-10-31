// =============================================================================
// BİLDİRİM İŞLERİ — gözetmen + dağıtıcı zamanlayıcısı (5 sn süpürme + commit sonrası dürtme)
// =============================================================================
// Gözetmen 15 sn'de bir `bildirim.gelenKutusuEnabled`i okur: açıksa dağıtıcı + koşul tarayıcısı
// başlar, kapanınca durur — bayrağı açmak yeniden başlatma istemez. Bayrak kapalıyken tek iş bu
// okumadır (satır yazılmaz). Dürtme: emit `pg_notify` atar, yalnız COMMIT'te teslim edilir; havuzdan
// alınan TEK LISTEN bağlantısı onu birleştiriciye çevirir. Bağlantı düşerse süpürme işi sürdürür ve
// sonraki süpürmede yeniden dinlenir. Tek süreç (server.ts TEK-PROCESS) — ikinci Node süreci yok.
// =============================================================================
import { registerDeviceConditionSources } from "../services/notification-sources/cihaz";
import type { PoolClient } from "pg";
import { pool } from "../lib/prisma";
import { readNotificationInboxEnabled } from "../services/system-setting.service";
import { DISPATCH_BATCH_LIMIT, runNotificationDispatchOnce } from "../services/notification-dispatch.service";
import { NOTIFICATION_NOTIFY_CHANNEL } from "../services/helpers/notification-emit.helper";
import { startNotificationConditionScanner, stopNotificationConditionScanner } from "./notification-condition.job";
import { registerSystemConditionSources } from "../services/notification-sources/sistem";
import { registerWorkConditionSources } from "../services/notification-sources/is";
import { registerQualityConditionSources } from "../services/notification-sources/kalite";
import { registerCariConditionSources } from "../services/notification-sources/cari";
import { registerLoomAlarmRecipientResolver } from "../services/notification-sources/alarm";
import { createNudgeCoalescer } from "./nudge-coalescer";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";
import { closeAll as closeAllBells } from "../services/notification-bell-hub";

export const NOTIFICATION_SWEEP_MS = 5_000;
export const NOTIFICATION_SUPERVISOR_MS = 15_000;
const STARTUP_DELAY_MS = 10_000;
const NUDGE_DEBOUNCE_MS = 150;
const NUDGE_MAX_WAIT_MS = 1_000;

let supervisorTimer: NodeJS.Timeout | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let dispatching = false;
/** Kapanış başladıysa uçuştaki gözetmen turu işleri yeniden başlatamaz. */
let shuttingDown = false;
let running = false;
let pending = false;
let listener: PoolClient | null = null;
let listening: Promise<void> | null = null;

function tick(): void {
  if (!dispatching) return;
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;
  void runNotificationDispatchOnce()
    .then((r) => {
      // Dolu tur: kuyrukta daha fazlası olabilir — beklemeden bir tur daha.
      if (r.processed >= DISPATCH_BATCH_LIMIT && r.failed === 0) pending = true;
    })
    .catch((err) => reportJobFailure("bildirim-dagitici", err))
    .finally(() => {
      running = false;
      if (pending && dispatching) setImmediate(tick);
    });
}

const nudges = createNudgeCoalescer({ debounceMs: NUDGE_DEBOUNCE_MS, maxWaitMs: NUDGE_MAX_WAIT_MS, fire: tick });

/** Dağıtıcıyı elle dürt (commit SONRASI çağrılmalı); dağıtıcı çalışmıyorsa no-op. */
export function kickDispatcher(): void {
  if (dispatching) nudges.nudge();
}

async function listen(): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    client.on("notification", (msg) => {
      if (msg.channel === NOTIFICATION_NOTIFY_CHANNEL) kickDispatcher();
    });
    const own = client;
    client.on("error", (err) => {
      uyari("bildirim", "LISTEN bağlantısı düştü — süpürme sürüyor, yeniden dinlenecek", err);
      // Eski bağlantının geç gelen hatası yeniden kurulan dinleyiciyi düşürmesin.
      if (listener === own) dropListener(err);
    });
    await client.query(`LISTEN ${NOTIFICATION_NOTIFY_CHANNEL}`);
    if (!dispatching) {
      await client.query(`UNLISTEN ${NOTIFICATION_NOTIFY_CHANNEL}`);
      client.release();
      return;
    }
    listener = client;
  } catch (err) {
    uyari("bildirim", "LISTEN kurulamadı — yalnız süpürmeyle dağıtılıyor", err);
    client?.release(err as Error);
  }
}

function ensureListener(): void {
  if (listener || listening || !dispatching) return;
  listening = listen().finally(() => {
    listening = null;
  });
}

function dropListener(err?: unknown): void {
  const c = listener;
  listener = null;
  if (!c) return;
  c.removeAllListeners("notification");
  if (err) {
    c.release(err as Error);
    return;
  }
  void c.query(`UNLISTEN ${NOTIFICATION_NOTIFY_CHANNEL}`)
    .then(() => c.release())
    .catch((e: unknown) => c.release(e as Error));
}

function startDispatching(sweepMs: number): void {
  if (dispatching || shuttingDown) return;
  dispatching = true;
  ensureListener();
  sweepTimer = setInterval(() => {
    ensureListener();
    tick();
  }, sweepMs);
  sweepTimer.unref();
  startNotificationConditionScanner();
  tick(); // yeniden başlatmada kalan işlenmemiş satırlar hemen
  bilgi("bildirim", "dağıtıcı ve koşul tarayıcısı başladı (gelen kutusu açık)");
}

function stopDispatching(reason: string): void {
  if (!dispatching) return;
  dispatching = false;
  nudges.cancel();
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  stopNotificationConditionScanner();
  dropListener();
  bilgi("bildirim", `dağıtıcı ve koşul tarayıcısı durdu (${reason})`);
}

/**
 * Gözetmen turu: bayrağa göre işleri başlatır/durdurur. Döner: işler çalışıyor mu (bekçi ölçer).
 * `sweepMs` yalnız bekçi içindir: süpürmeyi uzatıp dürtmenin tek başına dağıttığını ölçer.
 */
export async function reconcileNotificationJobs(opts: { sweepMs?: number } = {}): Promise<boolean> {
  let enabled = false;
  try {
    enabled = await readNotificationInboxEnabled();
  } catch (err) {
    // Okunamayan bayrak açık sayılmaz; çalışan iş de yalnız ölçülmüş "kapalı"da durur.
    reportJobFailure("bildirim-gozetmen", err);
    return dispatching;
  }
  if (enabled) startDispatching(opts.sweepMs ?? NOTIFICATION_SWEEP_MS);
  else stopDispatching("bayrak kapalı");
  return dispatching;
}

export function isNotificationDispatcherRunning(): boolean {
  return dispatching;
}

/**
 * Süreç düzeyi kapama (varsayılan AÇIK = bugünkü davranış). Yalnız aynı DB'ye bağlanan YARDIMCI test sunucuları
 * (CI HTTP bekçi sunucuları, `bekci-http`) için: onların dağıtıcısı outbox'ı kapıp zili kendi hub'ına çalar ve
 * fazladan LISTEN açar — `test_bildirim_zil` §5b ve `test_bildirim_motoru` §11e/f aralıklı kırmızısının kökü.
 */
export const NOTIFICATION_JOBS_ENV = "NOTIFICATION_JOBS_ENABLED";

export function startNotificationJobs(): void {
  if (supervisorTimer) return;
  if (process.env[NOTIFICATION_JOBS_ENV] === "false") {
    bilgi("bildirim", `${NOTIFICATION_JOBS_ENV}=false — bu süreç bildirim dağıtmaz (yardımcı sunucu)`);
    return;
  }
  shuttingDown = false;
  registerSystemConditionSources(); // koşul kaynakları tek noktadan (N1-KOSUL-SIS)
  registerWorkConditionSources(); // iş koşulları (N1-KOSUL-IS)
  registerQualityConditionSources(); // sertifika süresi (K4P-SERT)
  registerCariConditionSources(); // cari risk limiti (D4-I5)
  registerDeviceConditionSources(); // anahtar halkası kaybı (izlenebilirlik D5)
  registerLoomAlarmRecipientResolver(); // tezgah alarmı donmuş alıcı (N2-ALARM)
  firstTimer = setTimeout(() => void reconcileNotificationJobs(), STARTUP_DELAY_MS);
  firstTimer.unref();
  supervisorTimer = setInterval(() => void reconcileNotificationJobs(), NOTIFICATION_SUPERVISOR_MS);
  supervisorTimer.unref();
}

/** Kapanış: zamanlayıcılar durur, LISTEN bağlantısı havuza döner (havuz kapanmadan ÖNCE çağrılır). */
export function stopNotificationJobs(): void {
  shuttingDown = true;
  if (firstTimer) clearTimeout(firstTimer);
  if (supervisorTimer) clearInterval(supervisorTimer);
  firstTimer = null;
  supervisorTimer = null;
  stopDispatching("kapanış");
}

/**
 * Süreç kapanışı (server.ts): işler durur + açık SSE zil akışları biter. Dinleyiciler kapanmadan ÖNCE
 * çağrılır — açık akış server.close'u bekletir ve 5 sn zorla çıkışa yol açardı (bildirim plan §3.9 tuzak 2).
 */
export function shutdownNotifications(): void {
  stopNotificationJobs();
  const closed = closeAllBells();
  if (closed > 0) bilgi("bildirim", `${closed} zil akışı kapatıldı (kapanış)`);
}
