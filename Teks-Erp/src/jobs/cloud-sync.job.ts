// =============================================================================
// Patron bulutu eşitleme işi — aralık KİRADAN (`esitlemeAraligiDk`), zil `ozet`/`rapor` anında.
// =============================================================================
// `license-poll.job` kalıbı: gecikmeli ilk koşum, `running` koruması, test enjeksiyonu.
// ⚠️ SIFIR FARK: ön koşul (URETIM · `patron-bulut` hakkı · abonelik · aralık) yoksa HİÇBİR
// dış istek atılmaz; tek yazım günlük işaret budamasıdır (tetikleyiciler her kurulumda yazar).
// Beklenen ağ hatası `reportJobFailure`e YAZILMAZ; yalnız programcı hatası iz bırakır.
// Günlük uzlaştırma fabrika saatiyle 03:30'dan sonra.
// Olay turu (`patronBulut.olayGudumluEnabled`, varsayılan KAPALI): kirli bayrak (`cloud-sync/dirty-flag.ts`)
// ilk kirlenmeden ≥3 sn sonra, iki tur arası ≥15 sn, tek uçuş; kira aralığı turu EMNİYET olarak aynen kalır.
// =============================================================================
import { whenIdentityReady } from "./installation-identity.job";
import { reportJobFailure } from "./job-failure";
import { onDoorbellTopic } from "./doorbell-topics";
import { bilgi, uyari } from "../lib/logger";
import { factoryMinuteOfDay, factoryYmd } from "../constants/time";
import { cloudEligibility, type CloudBlockReason } from "../cloud-sync/eligibility";
import { getCloudUrl } from "../cloud-sync/cloud-url";
import { egressCloudTransport, type CloudTransport } from "../cloud-sync/cloud-client";
import { runSyncRound, type RoundOutcome } from "../cloud-sync/sync-round";
import { claimAndRunReportRequests, computeReportResult, reportDigest, sendReportResult, standardReportPlan } from "../cloud-sync/report-requests";
import { pruneSyncMarks } from "../cloud-sync/marks-pruning";
import { loadWatermarks, saveWatermarks, wmKey } from "../cloud-sync/watermarks";
import type { SnapshotCadence } from "../cloud-sync/projections";
import { onDirty, peekDirty, takeDirty } from "../cloud-sync/dirty-flag";
import { DAILY_SNAPSHOT_NAMES, RepeatGate, ageDailyRetry, describeRoundProblem, dueDailyRetries, retryNotice, settleDailyRetry, type DailyRetryEntry } from "../cloud-sync/daily-retry";
import { readPatronBulutOlayGudumluEnabled } from "../services/system-setting.service";

const TICK_MS = 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;
const IDENTITY_WAIT_MS = 5 * 60 * 1000;
/** B1 kararı: aralık 1–60 dk (kira şeması 1440'a izin verir; fabrika üst sınırı ayrıca uygular). */
export const SYNC_INTERVAL_MIN = 1;
export const SYNC_INTERVAL_MAX = 60;
/** Zil yağmuruna karşı: iki anlık tur arası en az bu kadar (§6.5 "30 sn'de en çok bir"). */
const DOORBELL_MIN_GAP_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Günlük uzlaştırmanın fabrika saati (yedekten sonra, §4.4). */
const RECONCILE_MINUTE_OF_DAY = 3 * 60 + 30;
const RECONCILE_RETRY_MS = 30 * 60 * 1000;
/** Olay turu: ilk kirlenmeden en erken bu kadar sonra (güvenli ufuk payı 2 sn + birleştirme). */
export const EVENT_DEBOUNCE_MS = 3 * 1000;
/** Olay turu: herhangi iki tur arası en az bu kadar (sıcak tabloda tur yağmuru olmasın). */
export const EVENT_MIN_GAP_MS = 15 * 1000;

export function clampInterval(minutes: number): number {
  return Math.min(SYNC_INTERVAL_MAX, Math.max(SYNC_INTERVAL_MIN, Math.round(minutes)));
}

export interface CloudSyncStatus {
  readonly eligible: boolean;
  readonly blockReason: CloudBlockReason | null;
  readonly lastRoundAt: number | null;
  readonly lastOutcome: Pick<RoundOutcome, "status" | "reason" | "packets" | "horizon" | "contractWarning"> | null;
  readonly lastReconcileYmd: string | null;
  /** Son turu ne tetikledi (panel gösterimi): kira aralığı · kirli bayrak · zil. */
  readonly lastTrigger: CloudSyncTrigger | null;
  readonly lastEventRoundAt: number | null;
}

export type CloudSyncTrigger = "periyodik" | "olay" | "zil";

let started = false;
let stopped = false;
let running = false;
let timer: NodeJS.Timeout | null = null;
let transport: CloudTransport = egressCloudTransport;
let lastRoundAt = 0;
let lastHourlyAt = 0;
let lastDailyYmd: string | null = null;
/** Bugün ret alan günlük anlıklar → geri çekilmeli yeniden deneme (gün dönünce sıfırlanır). */
const dailyRetry = new Map<string, DailyRetryEntry>();
/** Aynı KISMI (ret) satırı 6 sa içinde yeniden yazılmaz. */
const partialWarn = new RepeatGate(6 * HOUR_MS);
let lastSnapshotRoundAt = 0;
let pendingSnapshot = false;
let pendingReports = false;
let lastReconcileAttemptAt = 0;
/** Test kancası: bir sonraki tık 03:30 kapısını BİR KEZ atlar (senaryo gece de uzlaştırma koşabilsin). */
let forceReconcileOnce = false;
let lastPruneYmd: string | null = null;
let eventTimer: { cancel(): void } | null = null;
/** Olay turunun son DENEMESİ (bayrak kapalı çıksa da) — aralık kapısı buna da bakar. */
let lastEventAttemptAt = 0;
/** Ön koşul kapalı görüldüyse bu ana dek yazım başına yeniden ölçülmez (sıcak yolda lisans okuması yok). */
let ineligibleUntil = 0;
let clock: () => number = Date.now;
type EventTimerFactory = (fn: () => Promise<void>, delayMs: number) => { cancel(): void };
const realEventTimer: EventTimerFactory = (fn, delayMs) => {
  const t = setTimeout(() => void fn(), delayMs);
  t.unref();
  return { cancel: () => clearTimeout(t) };
};
let eventTimerFactory: EventTimerFactory = realEventTimer;
const INITIAL_STATUS: CloudSyncStatus = { eligible: false, blockReason: null, lastRoundAt: null, lastOutcome: null, lastReconcileYmd: null, lastTrigger: null, lastEventRoundAt: null };
let status: CloudSyncStatus = INITIAL_STATUS;

export function getCloudSyncStatus(): CloudSyncStatus {
  return status;
}

function remember(o: RoundOutcome, at: number, trigger: CloudSyncTrigger): void {
  status = { ...status, lastRoundAt: at, lastTrigger: trigger, lastOutcome: { status: o.status, reason: o.reason, packets: o.packets, horizon: o.horizon, contractWarning: o.contractWarning } };
  if (o.status !== "HATA" && o.status !== "KISMI") return;
  const text = `eşitleme turu ${o.status} (${describeRoundProblem(o)}) — sonraki turda tekrar`;
  if (o.status === "HATA" || partialWarn.pass(text, at)) uyari("patron-bulut", text);
}


async function exclusive(fn: () => Promise<void>): Promise<void> {
  if (running) return;
  running = true;
  try {
    await fn();
  } catch (err) {
    reportJobFailure("cloud-sync", err);
  } finally {
    running = false;
  }
}

async function pushStandardReports(nowMs: number): Promise<void> {
  const elig = cloudEligibility(nowMs);
  if (!elig.ok) return;
  const ctx = { baseUrl: elig.baseUrl, installationId: elig.installationId, transport };
  const stored = await loadWatermarks();
  for (const plan of standardReportPlan(new Date(nowMs))) {
    const result = await computeReportResult({ istekId: null, key: plan.key, params: plan.params, donem: plan.donem, nowMs });
    const key = wmKey.standardReport(plan.key, plan.donem ?? "kesit");
    const digest = reportDigest(result);
    if (stored.get(key)?.digest === digest) continue;
    if (await sendReportResult(ctx, result)) await saveWatermarks([{ source: key, digest, at: new Date(nowMs) }]);
  }
}

async function runReportClaims(nowMs: number): Promise<void> {
  const elig = cloudEligibility(nowMs);
  if (!elig.ok) return;
  await claimAndRunReportRequests({ baseUrl: elig.baseUrl, installationId: elig.installationId, transport });
}

/** Günde bir: eski eşitleme işaretleri budanır — ön koşuldan BAĞIMSIZ (tetikleyiciler her kurulumda yazar). */
async function dailyPrune(nowMs: number): Promise<void> {
  const ymd = factoryYmd(new Date(nowMs));
  if (lastPruneYmd === ymd) return;
  const n = await pruneSyncMarks(nowMs);
  lastPruneYmd = ymd;
  if (n > 0) bilgi("patron-bulut", `${n} eski eşitleme işareti budandı`);
}

/** Tek koşum — zamanlayıcı ve bekçi aynı fonksiyonu çağırır. */
export async function runCloudSyncTick(nowMs: number = Date.now()): Promise<void> {
  await dailyPrune(nowMs);
  const elig = cloudEligibility(nowMs);
  status = { ...status, eligible: elig.ok, blockReason: elig.ok ? null : elig.reason };
  if (!elig.ok) return;
  await exclusive(async () => {
    const now = new Date(nowMs);
    const ymd = factoryYmd(now);
    const due = nowMs - lastRoundAt >= clampInterval(elig.intervalMinutes) * 60_000;
    if (due) {
      const newDay = lastDailyYmd !== ymd;
      const cadences = new Set<SnapshotCadence>(newDay ? ["HER_TUR", "GUNLUK"] : ["HER_TUR"]);
      const hourly = nowMs - lastHourlyAt >= HOUR_MS;
      if (hourly) cadences.add("SAATLIK");
      if (newDay) dailyRetry.clear();
      const retry = newDay ? [] : dueDailyRetries(dailyRetry, nowMs);
      // Emniyet turu her değişikliği zaten kapsar: kirli küme tüketilir (olay turu boşuna koşmaz).
      takeDirty();
      const o = await runSyncRound({ kind: "ARTIMLI", cadences, extraSnapshots: new Set(retry) }, { transport, nowMs: () => nowMs });
      remember(o, nowMs, "periyodik");
      // Tavana takılan kaynak varsa bir sonraki tık beklemeden devam eder.
      lastRoundAt = o.status !== "HATA" && o.more ? 0 : nowMs;
      if (o.status !== "HATA") {
        if (hourly) lastHourlyAt = nowMs;
        if (newDay) lastDailyYmd = ymd;
        // Ret alan günlük anlık günü "tamam" saymaz: yalnız o ad geri çekilmeyle yeniden denenir.
        for (const r of settleDailyRetry(dailyRetry, newDay ? DAILY_SNAPSHOT_NAMES : retry, o, nowMs)) bilgi("patron-bulut", retryNotice(r));
      }
      // Zil kaçarsa her tur rapor isteklerini de yoklar (§7).
      await runReportClaims(nowMs);
      if (hourly && o.status !== "HATA") await pushStandardReports(nowMs);
    }
    // Günlük uzlaştırma (§4.4): fabrika saatiyle 03:30'dan sonra, günde bir; kalıcı damga,
    // başarısız deneme 30 dk'da bir tekrarlanır.
    const reconcileTime = forceReconcileOnce || nowMs >= factoryMinuteOfDay(now, RECONCILE_MINUTE_OF_DAY).getTime();
    if (reconcileTime && nowMs - lastReconcileAttemptAt >= RECONCILE_RETRY_MS) {
      forceReconcileOnce = false;
      const stored = await loadWatermarks();
      if (stored.get(wmKey.reconcile)?.digest !== ymd) {
        lastReconcileAttemptAt = nowMs;
        const o = await runSyncRound({ kind: "UZLASTIRMA", cadences: new Set() }, { transport, nowMs: () => nowMs });
        remember(o, nowMs, "periyodik");
        if (o.status === "TAMAM" || o.status === "KISMI") {
          await saveWatermarks([{ source: wmKey.reconcile, digest: ymd, at: now }]);
          status = { ...status, lastReconcileYmd: ymd };
        }
      }
    }
  });
}

/** Zil `ozet`: TÜM projeksiyonlar (kayıt + HER_TUR anlıklar) tazelenir — K1; 30 sn kapısı aynen. */
async function runSnapshotRound(): Promise<void> {
  const nowMs = clock();
  if (nowMs - lastSnapshotRoundAt < DOORBELL_MIN_GAP_MS) {
    pendingSnapshot = true;
    return;
  }
  lastSnapshotRoundAt = nowMs;
  await exclusive(async () => {
    takeDirty();
    const o = await runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]), snapshotsOnly: false }, { transport, nowMs: () => nowMs });
    remember(o, nowMs, "zil");
    if (o.status !== "HATA" && o.more) lastRoundAt = 0;
  });
  requestEventRound();
}

/**
 * Olay turu iste — kirli bayrak dinleyicisi ve gelen kutusu çağırır. Kirli küme boşsa,
 * ön koşul kapalıysa (fail-closed; dışarı istek yok) ya da zamanlayıcı kuruluysa no-op.
 * Zaman: max(ilk kirlenme + 3 sn, son tur/deneme + 15 sn). Bayrak turda okunur (yazım başına DB yok).
 */
export function requestEventRound(): void {
  if (stopped || eventTimer) return;
  const d = peekDirty();
  if (d.tables.size === 0) return;
  const t = clock();
  if (t < ineligibleUntil) return;
  if (!cloudEligibility(t).ok) {
    ineligibleUntil = t + EVENT_MIN_GAP_MS;
    return;
  }
  const lastAny = Math.max(lastEventAttemptAt, lastRoundAt, lastSnapshotRoundAt);
  const at = Math.max((d.firstDirtyAt ?? t) + EVENT_DEBOUNCE_MS, lastAny + EVENT_MIN_GAP_MS);
  eventTimer = eventTimerFactory(async () => {
    eventTimer = null;
    await runEventRound().catch((err) => reportJobFailure("cloud-sync", err));
  }, Math.max(0, at - t));
}

/** Tek olay turu (tek uçuş `exclusive`): kayıt projeksiyonları + HER_TUR anlıklar. */
export async function runEventRound(): Promise<void> {
  const t = clock();
  if (!cloudEligibility(t).ok) return;
  // Başka tur sürüyorsa o bitince (tık/zil sonu) yeniden istenir.
  if (running) return;
  lastEventAttemptAt = t;
  if (!(await readPatronBulutOlayGudumluEnabled())) return;
  await exclusive(async () => {
    takeDirty();
    // Turun içi duvar saatiyle (ufuk payı uygulama↔DB saat farkını da sayar); kapı saati enjekte edilebilir.
    const o = await runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]) }, { transport });
    remember(o, t, "olay");
    status = { ...status, lastEventRoundAt: t };
    if (o.status !== "HATA" && o.more) lastRoundAt = 0;
  });
  // Tur sürerken gelen yazım kümede bekler → aralık kapısıyla bir sonraki olay turu.
  requestEventRound();
}

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void (async () => {
      await runCloudSyncTick().catch((err) => reportJobFailure("cloud-sync", err));
      if (pendingSnapshot) {
        pendingSnapshot = false;
        await runSnapshotRound().catch((err) => reportJobFailure("cloud-sync", err));
      }
      if (pendingReports) {
        pendingReports = false;
        await exclusive(() => runReportClaims(Date.now()));
      }
      requestEventRound();
    })().finally(() => schedule(TICK_MS));
  }, delayMs);
  timer.unref();
}

/** Zil konusu kayıtları — kapanışta silinir (gelen kutusu işiyle simetrik). */
let offDoorbell: Array<() => void> = [];

export function startCloudSync(): void {
  if (started) return;
  started = true;
  onDirty(requestEventRound);
  offDoorbell = [
    onDoorbellTopic("ozet", () => {
      if (!running) void runSnapshotRound().catch((err) => reportJobFailure("cloud-sync", err));
      else pendingSnapshot = true;
    }),
    onDoorbellTopic("rapor", () => {
      if (!running) void exclusive(() => runReportClaims(Date.now()));
      else pendingReports = true;
    }),
  ];
  void (async () => {
    const identity = await whenIdentityReady(IDENTITY_WAIT_MS);
    if (!identity || stopped) {
      uyari("patron-bulut", "kurulum kimliği hazır değil — eşitleme işi başlatılmadı");
      return;
    }
    schedule(STARTUP_DELAY_MS);
    const c = getCloudUrl();
    bilgi("patron-bulut", `eşitleme işi hazır — bulut: ${c.url ? new URL(c.url).host : "yok"} (${c.source}); patron-bulut hakkı olmayan kurulum dışarı istek atmaz`);
  })();
}

export function stopCloudSync(): void {
  stopped = true;
  onDirty(null);
  eventTimer?.cancel();
  eventTimer = null;
  for (const off of offDoorbell) off();
  offDoorbell = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Test-only: sonraki tık aralığı beklemeden tur koşar (senaryo koşucusu; açık turu bozmaz). */
export function __forceNextCloudSyncRoundForTests(opts: { reconcile?: boolean } = {}): void {
  lastRoundAt = 0;
  if (opts.reconcile) {
    lastReconcileAttemptAt = 0;
    forceReconcileOnce = true;
  }
}

/**
 * Test-only: bellek durumunu `ms` kadar yaşlandırır (saat ilerlemiş gibi) — lisansın saat seddi
 * duvar saatinin ileri sıçramasını reddettiği için senaryo saati değil durumu kaydırır.
 */
export function __ageCloudSyncStateForTests(ms: number, opts: { newDay?: boolean } = {}): void {
  lastRoundAt -= ms;
  lastHourlyAt -= ms;
  lastReconcileAttemptAt -= ms;
  ageDailyRetry(dailyRetry, ms);
  partialWarn.age(ms);
  if (opts.newDay) lastDailyYmd = null;
}

/** Test-only: sahte bulut taşıması + bellek durumu sıfırlama. */
export function __configureCloudSyncForTests(p: { transport?: CloudTransport; reset?: boolean; now?: () => number; eventTimer?: EventTimerFactory | null }): void {
  if (p.transport) transport = p.transport;
  if (p.now) clock = p.now;
  if (p.eventTimer !== undefined) eventTimerFactory = p.eventTimer ?? realEventTimer;
  if (p.reset) {
    forceReconcileOnce = false;
    lastRoundAt = 0;
    lastHourlyAt = 0;
    lastDailyYmd = null;
    dailyRetry.clear();
    partialWarn.reset();
    lastSnapshotRoundAt = 0;
    pendingSnapshot = false;
    pendingReports = false;
    lastReconcileAttemptAt = 0;
    lastPruneYmd = null;
    running = false;
    eventTimer?.cancel();
    eventTimer = null;
    lastEventAttemptAt = 0;
    ineligibleUntil = 0;
    status = INITIAL_STATUS;
  }
}
