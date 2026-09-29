// =============================================================================
// Lisans yoklaması — saatlik (kiradaki `yoklamaAraligiDk`) + jitter; zil gelince hemen.
// =============================================================================
// `exchange-rate.job.ts` kalıbı: gecikmeli ilk koşum, `running` koruması, test enjeksiyonu.
// ⚠️ SIFIR FARK: kurulum etkinleşmemişse ya da satıcı adresi kapalıysa HİÇBİR dış istek atılmaz.
// Beklenen ağ hatası `reportJobFailure`e YAZILMAZ (internetsiz fabrikada her saat defteri
// şişirirdi); yalnız programcı hatası (gövde kurulamadı vb.) iz bırakır. Kurulum kimliği
// `whenIdentityReady` ile beklenir; parmak izi günde bir tazelenir.
// =============================================================================
import { whenIdentityReady } from "./installation-identity.job";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";
import { pollLicenseOnce, refreshLicenseDbFacts, refreshLicenseFingerprint, type PollOutcome } from "../services/license-sync.service";
import { evaluateLicenseTransitions, licenseHousekeeping } from "../services/license-trail.service";
import { egressTransport, type VendorTransport } from "../services/helpers/license-wire.helper";
import { getLicenseConfig, getLicenseSnapshot, setNextPollAt } from "../lib/license/runtime";
import { STARTUP_VENDOR } from "../lib/license/vendor-url";
import { POLL_DEFAULT_MINUTES } from "../lib/license/protocol";

const STARTUP_DELAY_MS = 60 * 1000;
const IDENTITY_WAIT_MS = 5 * 60 * 1000;
const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;
const FINGERPRINT_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Zil yağmurunda satıcıyı dövmemek için iki yoklama arası en az bu kadar. */
const MIN_POLL_GAP_MS = 5 * 1000;

let started = false;
let stopped = false;
let running = false;
let again = false;
let pollTimer: NodeJS.Timeout | null = null;
let housekeepingTimer: NodeJS.Timeout | null = null;
let fingerprintTimer: NodeJS.Timeout | null = null;
let lastRunAt = 0;

/** ±%10 (en çok 5 dk) — aynı anda açılan fabrikalar satıcıya aynı saniyede gelmesin. */
export function withJitter(baseMs: number, random: () => number = Math.random): number {
  const spread = Math.min(baseMs * 0.1, 5 * 60 * 1000);
  return Math.max(1000, Math.round(baseMs + (random() * 2 - 1) * spread));
}

function nextIntervalMs(): number {
  const minutes = getLicenseSnapshot().lease?.document.yoklamaAraligiDk ?? POLL_DEFAULT_MINUTES;
  return withJitter(minutes * 60 * 1000);
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
    if (r.outcome === "BASARISIZ") uyari("lisans", `yoklama başarısız (${r.code ?? "bilinmiyor"}) — bir sonraki denemede tekrar`);
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
  if (pollTimer) clearTimeout(pollTimer);
  setNextPollAt(Date.now() + delayMs);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void runLicensePollOnce().finally(() => {
      const rerun = again;
      again = false;
      schedule(rerun ? MIN_POLL_GAP_MS : nextIntervalMs());
    });
  }, delayMs);
  pollTimer.unref();
}

/** Zil "lisans" dedi ya da yönetici etkinleştirdi: beklemeden yokla (yağmur korumalı). */
export function requestImmediateLicensePoll(): void {
  if (!started || stopped) return;
  if (running) {
    again = true;
    return;
  }
  schedule(Math.max(0, MIN_POLL_GAP_MS - (Date.now() - lastRunAt)));
}

export function startLicensePoll(): void {
  if (started) return;
  started = true;
  void (async () => {
    const identity = await whenIdentityReady(IDENTITY_WAIT_MS);
    if (!identity || stopped) {
      uyari("lisans", "kurulum kimliği hazır değil — lisans yoklaması başlatılmadı (gözlemde etkisi yok)");
      return;
    }
    try {
      await refreshLicenseDbFacts(identity.installationId);
      await refreshLicenseFingerprint();
    } catch (err) {
      uyari("lisans", "başlangıç ölçümü tamamlanamadı (bir sonraki bakımda yeniden)", err instanceof Error ? err.message : err);
    }
    evaluateLicenseTransitions();
    housekeepingTimer = setInterval(() => {
      void refreshLicenseDbFacts(identity.installationId)
        .catch(() => undefined)
        .finally(() => licenseHousekeeping());
    }, HOUSEKEEPING_INTERVAL_MS);
    housekeepingTimer.unref();
    fingerprintTimer = setInterval(() => void refreshLicenseFingerprint().catch(() => undefined), FINGERPRINT_REFRESH_MS);
    fingerprintTimer.unref();
    schedule(withJitter(STARTUP_DELAY_MS));
    const vendorUrl = getLicenseConfig().vendorUrl;
    const vendor = vendorUrl ? `${new URL(vendorUrl).host} (${STARTUP_VENDOR.source})` : `yok (${STARTUP_VENDOR.source})`;
    if (STARTUP_VENDOR.source === "gecersiz") uyari("lisans", "LICENSE_SERVER_URL biçimsiz (yalnız https://<host>[:port]) — satıcıya dışarı istek atılmaz");
    bilgi("lisans", `yoklama zamanlayıcısı aktif — satıcı: ${vendor}; etkinleşmemiş kurulum dışarı istek atmaz`);
  })();
}

/** Kapanış: zamanlayıcılar durur, birikim diske yazılır. */
export function stopLicensePoll(): void {
  stopped = true;
  for (const t of [pollTimer, housekeepingTimer, fingerprintTimer]) if (t) clearTimeout(t);
  pollTimer = housekeepingTimer = fingerprintTimer = null;
  try {
    licenseHousekeeping();
  } catch {
    /* kapanışta best-effort */
  }
}

/** Test-only. */
export function __resetLicensePollForTests(): void {
  stopLicensePoll();
  started = false;
  stopped = false;
  running = false;
  again = false;
  lastRunAt = 0;
}
