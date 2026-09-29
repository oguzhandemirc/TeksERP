// =============================================================================
// Lisans yoklaması — saatlik (kiradaki `yoklamaAraligiDk`) + jitter; zil gelince hemen.
// =============================================================================
// `exchange-rate.job.ts` kalıbı: gecikmeli ilk koşum, `running` koruması, test enjeksiyonu.
// ⚠️ SIFIR FARK: kurulum etkinleşmemişse ya da satıcı adresi kapalıysa HİÇBİR dış istek atılmaz.
// Beklenen ağ hatası `reportJobFailure`e YAZILMAZ (internetsiz fabrikada her saat defteri
// şişirirdi); yalnız programcı hatası (gövde kurulamadı vb.) iz bırakır. Motor PES ETMEZ: DB
// kimliği/olguları gelmezse başlatma aralıklarla yeniden denenir; başarısız yoklamanın ardından
// kısa aralıklarla (üstel, olağan aralıkla tavanlı) yeniden yoklanır. Durum `/api/admin/health`te.
// =============================================================================
import { getCachedInstallationIdentity, whenIdentityReady } from "./installation-identity.job";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";
import {
  pollLicenseOnce,
  refreshLicenseDbFacts,
  refreshLicenseFingerprint,
  refreshLicenseIntegrity,
  type PollOutcome,
} from "../services/license-sync.service";
import { evaluateLicenseTransitions, licenseHousekeeping } from "../services/license-trail.service";
import { egressTransport, type VendorTransport } from "../services/helpers/license-wire.helper";
import { getLicenseConfig, getLicenseSnapshot, onDownloadTokenStale, setLicenseEngineStatus, setNextPollAt } from "../lib/license/runtime";
import { STARTUP_VENDOR } from "../lib/license/vendor-url";
import { POLL_DEFAULT_MINUTES } from "../lib/license/protocol";

const STARTUP_DELAY_MS = 60 * 1000;
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
const FINGERPRINT_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Zil yağmurunda satıcıyı dövmemek için iki yoklama arası en az bu kadar. */
const MIN_POLL_GAP_MS = 5 * 1000;
/** Başarısız yoklamadan sonraki ilk yeniden deneme; her ardışık başarısızlıkta ikiye katlanır. */
export const RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000;

/** Başlatma zamanlaması — testte kısaltılır. */
const timing = {
  /** DB kimliği için bir turda en çok bu kadar beklenir. */
  identityWaitMs: 5 * 60 * 1000,
  /** Başlatma başarısızsa (kimlik/DB yok) yeniden deneme aralığı. */
  bootRetryMs: 2 * 60 * 1000,
  startupDelayMs: STARTUP_DELAY_MS,
};

let started = false;
let stopped = false;
/** Her durdurmada artar: durdurmadan önce başlamış tur, sonra zamanlayıcı kurmaz. */
let generation = 0;
/** Başlatma tamamlandı, zamanlayıcılar kurulu (yalnız o zaman "hemen yokla" anlamlıdır). */
let engineRunning = false;
let running = false;
let again = false;
let consecutiveFailures = 0;
let pollTimer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;
let housekeepingTimer: NodeJS.Timeout | null = null;
let fingerprintTimer: NodeJS.Timeout | null = null;
let lastRunAt = 0;

/** ±%10 (en çok 5 dk) — aynı anda açılan fabrikalar satıcıya aynı saniyede gelmesin. */
export function withJitter(baseMs: number, random: () => number = Math.random): number {
  const spread = Math.min(baseMs * 0.1, 5 * 60 * 1000);
  return Math.max(1000, Math.round(baseMs + (random() * 2 - 1) * spread));
}

/**
 * Sonraki yoklamaya kadar (jitter'sız): başarısız yoklamanın ardından 2 · 4 · 8 … dk, olağan
 * aralığı (kiradaki `yoklamaAraligiDk`) aşmadan; başarı ya da dışarı çıkılmayan sonuç olağan aralık.
 */
export function nextPollDelayMs(outcome: PollOutcome | "MESGUL" | null, failuresInARow: number, normalMs: number): number {
  if (outcome !== "BASARISIZ" || failuresInARow <= 0) return normalMs;
  return Math.min(normalMs, RETRY_AFTER_FAILURE_MS * 2 ** Math.min(failuresInARow - 1, 16));
}

function normalIntervalMs(): number {
  return (getLicenseSnapshot().lease?.document.yoklamaAraligiDk ?? POLL_DEFAULT_MINUTES) * 60 * 1000;
}

/**
 * Tek koşum — zamanlayıcı, zil ve bekçi aynı fonksiyonu çağırır.
 * @param transport Test enjeksiyonu (sahte satıcı); üretimde proxy'li HTTPS.
 */
export async function runLicensePollOnce(transport: VendorTransport = egressTransport): Promise<PollOutcome | "MESGUL"> {
  if (running) {
    again = true;
    return "MESGUL";
  }
  running = true;
  lastRunAt = Date.now();
  try {
    const r = await pollLicenseOnce(transport);
    if (r.outcome === "BASARISIZ") uyari("lisans", `yoklama başarısız (${r.code ?? "bilinmiyor"}) — kısa aralıkla yeniden denenecek`);
    return r.outcome;
  } catch (err) {
    reportJobFailure("license-poll", err);
    return "BASARISIZ";
  } finally {
    running = false;
    evaluateLicenseTransitions();
  }
}

function schedule(delayMs: number): void {
  if (stopped) return;
  const gen = generation;
  if (pollTimer) clearTimeout(pollTimer);
  setNextPollAt(Date.now() + delayMs);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void runLicensePollOnce().then((outcome) => {
      if (gen !== generation) return;
      if (outcome === "BASARISIZ") consecutiveFailures++;
      else if (outcome !== "MESGUL") consecutiveFailures = 0;
      const rerun = again;
      again = false;
      schedule(rerun ? MIN_POLL_GAP_MS : withJitter(nextPollDelayMs(outcome, consecutiveFailures, normalIntervalMs())));
    });
  }, delayMs);
  pollTimer.unref();
}

/** Zil "lisans" dedi ya da yönetici etkinleştirdi: beklemeden yokla (yağmur korumalı). */
export function requestImmediateLicensePoll(): void {
  if (!started || stopped || !engineRunning) return;
  if (running) {
    again = true;
    return;
  }
  schedule(Math.max(0, MIN_POLL_GAP_MS - (Date.now() - lastRunAt)));
}

function refreshFactsNow(): Promise<void> {
  const identity = getCachedInstallationIdentity();
  if (!identity) return Promise.resolve();
  return refreshLicenseDbFacts(identity.installationId);
}

/**
 * Başlatma turu: DB kimliği (en çok `identityWaitMs`) → DB olguları → parmak izi → zamanlayıcılar.
 * Kimlik ya da DB gelmezse PES ETMEZ: `bootRetryMs` sonra yeniden dener, durum sağlıkta görünür.
 */
async function bootstrap(): Promise<void> {
  if (stopped) return;
  const gen = generation;
  const stale = (): boolean => stopped || gen !== generation;
  setLicenseEngineStatus("BASLIYOR");
  const identity = await whenIdentityReady(timing.identityWaitMs);
  if (stale()) return;
  if (!identity) {
    setLicenseEngineStatus("BASLAMADI", "KIMLIK_YOK");
    uyari("lisans", `kurulum kimliği hazır değil — lisans motoru ${Math.round(timing.bootRetryMs / 1000)} sn sonra yeniden denenecek (gözlemde etkisi yok)`);
    scheduleBoot();
    return;
  }
  try {
    await refreshLicenseDbFacts(identity.installationId);
  } catch (err) {
    if (stale()) return;
    setLicenseEngineStatus("BASLAMADI", "DB_OLGULARI");
    uyari("lisans", "lisans DB olguları okunamadı — yeniden denenecek", err instanceof Error ? err.message : err);
    scheduleBoot();
    return;
  }
  try {
    await refreshLicenseFingerprint();
  } catch (err) {
    uyari("lisans", "parmak izi ölçülemedi (günlük tazelemede yeniden)", err instanceof Error ? err.message : err);
  }
  await refreshIntegrityQuietly();
  if (stale()) return;
  evaluateLicenseTransitions();
  housekeepingTimer = setInterval(() => {
    void refreshFactsNow()
      .catch(() => undefined)
      .finally(() => licenseHousekeeping());
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeepingTimer.unref();
  fingerprintTimer = setInterval(() => {
    void refreshLicenseFingerprint()
      .catch(() => undefined)
      .finally(() => void refreshIntegrityQuietly());
  }, FINGERPRINT_REFRESH_MS);
  fingerprintTimer.unref();
  engineRunning = true;
  setLicenseEngineStatus("CALISIYOR");
  schedule(withJitter(timing.startupDelayMs));
  const vendorUrl = getLicenseConfig().vendorUrl;
  const vendor = vendorUrl ? `${new URL(vendorUrl).host} (${STARTUP_VENDOR.source})` : `yok (${STARTUP_VENDOR.source})`;
  if (STARTUP_VENDOR.source === "gecersiz") uyari("lisans", "LICENSE_SERVER_URL biçimsiz (yalnız https://<host>[:port]) — satıcıya dışarı istek atılmaz");
  bilgi("lisans", `yoklama zamanlayıcısı aktif — satıcı: ${vendor}; etkinleşmemiş kurulum dışarı istek atmaz`);
}

/** Bütünlük denetimi (açılışta + parmak iziyle aynı günlük tikte); hata ölçümü düşürür, süreci değil. */
async function refreshIntegrityQuietly(): Promise<void> {
  try {
    await refreshLicenseIntegrity();
  } catch (err) {
    uyari("lisans", "bütünlük denetlenemedi (günlük tazelemede yeniden)", err instanceof Error ? err.message : err);
  }
}

function scheduleBoot(): void {
  if (stopped) return;
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void bootstrap();
  }, timing.bootRetryMs);
  bootTimer.unref();
}

export function startLicensePoll(): void {
  if (started) return;
  started = true;
  // İndirme belirteci dolmak üzere/yoksa istemcinin isteği yoklamayı dürter (kiraya eşlik eder).
  onDownloadTokenStale(requestImmediateLicensePoll);
  void bootstrap();
}

/** Kapanış: zamanlayıcılar durur, birikim diske yazılır. */
export function stopLicensePoll(): void {
  stopped = true;
  generation++;
  for (const t of [pollTimer, bootTimer, housekeepingTimer, fingerprintTimer]) if (t) clearTimeout(t);
  pollTimer = bootTimer = housekeepingTimer = fingerprintTimer = null;
  engineRunning = false;
  if (started) setLicenseEngineStatus("DURDU");
  try {
    licenseHousekeeping();
  } catch {
    /* kapanışta best-effort */
  }
}

/** Test-only: başlatma zamanlamasını kısaltır. */
export function configureLicensePollForTests(p: Partial<typeof timing>): void {
  Object.assign(timing, p);
}

/** Test-only. */
export function __resetLicensePollForTests(): void {
  stopLicensePoll();
  started = false;
  stopped = false;
  running = false;
  again = false;
  consecutiveFailures = 0;
  lastRunAt = 0;
  engineRunning = false;
  timing.identityWaitMs = 5 * 60 * 1000;
  timing.bootRetryMs = 2 * 60 * 1000;
  timing.startupDelayMs = STARTUP_DELAY_MS;
  setLicenseEngineStatus("BASLAMADI");
}
