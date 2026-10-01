// =============================================================================
// Lisans kapı zili — satıcıya kalıcı SSE aboneliği; `zil(lisans)` gelince hemen yokla.
// =============================================================================
// Kanal İÇERİK taşımaz (güvenlik imzalı yoklamada kalır): sahte zil yalnız fazladan
// yoklama yaptırır. Global `EventSource` yok → fetch akışı elle ayrıştırılır. Satıcı
// 25 sn'de bir yorum satırı gönderir; 60 sn sessizlik = kopuk sayılır, üstel geri
// çekilmeyle yeniden bağlanılır — geri çekilme yalnız EN AZ bir dakika yaşamış bağlantıdan
// sonra sıfırlanır (bağlantıyı periyodik kesen vekilde yeniden bağlanma fırtınası olmasın).
// Etkinleşmemiş kurulum ya da adressiz satıcı: bağlanılmaz.
// =============================================================================
import type { IncomingMessage } from "node:http";
import { egressStream, EgressError } from "../lib/http-egress";
import { bilgi } from "../lib/logger";
import {
  DOORBELL_EVENT_NAME,
  DOORBELL_HEARTBEAT_SECONDS,
  DoorbellEventSchema,
  ENDPOINTS,
  REQUEST_HEADER,
  signRequest,
} from "../lib/license/protocol";
import { getLicenseStore } from "../lib/license/store";
import { getLicenseConfig, getLicenseSnapshot, recordVendorClockSkew, updateDoorbellStatus } from "../lib/license/runtime";
import { onLicenseActivated } from "../services/license-sync.service";
import { learnVendorClock, readVendorError } from "../services/helpers/license-wire.helper";
import { requestImmediateLicensePoll } from "./license-poll.job";
import { dispatchDoorbellTopic } from "./doorbell-topics";

const HEARTBEAT_TIMEOUT_MS = (DOORBELL_HEARTBEAT_SECONDS * 2 + 10) * 1000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** Etkinleşmemiş kurulumda ne sıklıkla yeniden bakılır (etkinleştirme zaten dürter). */
const IDLE_RECHECK_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 30 * 1000;
/** Bu kadar yaşamış bağlantı "kararlı" sayılır; ancak ondan sonra geri çekilme baştan başlar. */
export const STABLE_CONNECTION_MS = 60 * 1000;
const ERROR_BODY_MAX = 16 * 1024;

export type DoorbellEvent = { readonly kind: "zil"; readonly konu: string } | { readonly kind: "kalp" };

/**
 * SSE ayrıştırıcı — satır sonu \n ya da \r\n; boş satır olayı bitirir; `:` ile başlayan
 * satır yorumdur (kalp atışı). Yalnız `event`/`data` alanları okunur.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  push(chunk: string): DoorbellEvent[] {
    this.buffer += chunk;
    const out: DoorbellEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line === "") {
        if (this.data.length > 0 || this.event) {
          const ev = this.finish();
          if (ev) out.push(ev);
        }
        continue;
      }
      if (line.startsWith(":")) {
        out.push({ kind: "kalp" });
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") this.event = value;
      else if (field === "data") this.data.push(value);
    }
    // Sonsuz satır saldırısına karşı tampon tavanı.
    if (this.buffer.length > 64 * 1024) this.buffer = "";
    return out;
  }

  private finish(): DoorbellEvent | null {
    const name = this.event || "message";
    const data = this.data.join("\n");
    this.event = "";
    this.data = [];
    if (name !== DOORBELL_EVENT_NAME) return null;
    try {
      const parsed = DoorbellEventSchema.safeParse(JSON.parse(data));
      return parsed.success ? { kind: "zil", konu: parsed.data.konu } : null;
    } catch {
      return null;
    }
  }
}

let started = false;
let stopped = false;
/** Her durdurmada artar: durdurmadan önce başlamış bağlantı turu, sonra yeniden bağlanma planlamaz. */
let generation = 0;
let controller: AbortController | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let attempt = 0;

/** Üstel geri çekilme (±%20 jitter), tavan 5 dk. */
export function backoffMs(n: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, n));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * Sonraki bekleme hangi deneme sırasından hesaplanır: yalnız kararlı (≥ 1 dk yaşamış) bağlantı
 * sırayı sıfırlar; hemen kopan bağlantı (veri gelmiş olsa da) sırayı ilerletir.
 */
export function reconnectAttempt(previous: number, livedMs: number | null): number {
  return livedMs !== null && livedMs >= STABLE_CONNECTION_MS ? 0 : previous;
}

function canConnect(): boolean {
  if (!getLicenseConfig().vendorUrl) return false;
  const snap = getLicenseSnapshot();
  return snap.imzaHazir && snap.activated && snap.licenseId !== null;
}

function readSmallBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      text += chunk;
      if (text.length > ERROR_BODY_MAX) res.destroy();
    });
    res.on("end", () => resolve(text));
    res.on("close", () => resolve(text));
    res.on("error", () => resolve(text));
  });
}

function scheduleConnect(delayMs: number): void {
  if (stopped) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectOnce();
  }, delayMs);
  retryTimer.unref();
}

async function consume(res: IncomingMessage, signal: AbortSignal): Promise<void> {
  const parser = new SseParser();
  await new Promise<void>((resolve) => {
    let watchdog: NodeJS.Timeout | null = null;
    const arm = (): void => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => res.destroy(new Error("kalp atışı yok")), HEARTBEAT_TIMEOUT_MS);
      watchdog.unref();
    };
    const done = (): void => {
      if (watchdog) clearTimeout(watchdog);
      resolve();
    };
    arm();
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      arm();
      for (const ev of parser.push(chunk)) {
        const now = Date.now();
        if (ev.kind === "kalp") updateDoorbellStatus({ lastHeartbeatAt: now });
        else {
          updateDoorbellStatus({ lastEventAt: now });
          if (ev.konu === "lisans") requestImmediateLicensePoll();
          else dispatchDoorbellTopic(ev.konu);
        }
      }
    });
    res.on("end", done);
    res.on("close", done);
    res.on("error", done);
    signal.addEventListener("abort", () => res.destroy(), { once: true });
  });
}

async function openStream(base: string, licenseId: string, signal: AbortSignal, nowMs: number): Promise<IncomingMessage> {
  const store = getLicenseStore();
  if (!store?.key) throw new EgressError("EGRESS_NETWORK", "lisans deposu hazır değil");
  const token = signRequest({ installationId: licenseId, purpose: "zil", body: "", key: { privateKey: store.key.privateKey, nowMs }, path: ENDPOINTS.DOORBELL });
  return egressStream(`${base}${ENDPOINTS.DOORBELL}`, {
    method: "GET",
    headers: { accept: "text/event-stream", "cache-control": "no-cache", [REQUEST_HEADER]: token },
    timeoutMs: CONNECT_TIMEOUT_MS,
    signal,
  });
}

const isEventStream = (res: IncomingMessage): boolean =>
  res.statusCode === 200 && String(res.headers["content-type"] ?? "").includes("text/event-stream");

async function connectOnce(): Promise<void> {
  if (stopped) return;
  const gen = generation;
  if (!canConnect()) {
    updateDoorbellStatus({ connected: false });
    scheduleConnect(IDLE_RECHECK_MS);
    return;
  }
  const licenseId = getLicenseSnapshot().licenseId;
  const base = getLicenseConfig().vendorUrl;
  if (!licenseId || !base) return;
  controller = new AbortController();
  let livedMs: number | null = null;
  try {
    let res = await openStream(base, licenseId, controller.signal, Date.now());
    let corrected = false;
    if (res.statusCode === 401) {
      // Saat kayıkken satıcı ISTEK_ZAMAN + kendi saatini döner: bir kez düzeltilmiş damgayla yeniden (D4).
      const e = readVendorError(401, await readSmallBody(res));
      const skewMs = learnVendorClock(e.code, e.vendorTimeMs);
      if (skewMs === null) updateDoorbellStatus({ connected: false, lastErrorCode: e.code });
      else {
        corrected = true;
        res = await openStream(base, licenseId, controller.signal, Date.now() - skewMs);
      }
    }
    if (!isEventStream(res)) {
      if (res.statusCode !== 401 || corrected) {
        res.resume();
        updateDoorbellStatus({ connected: false, lastErrorCode: `HTTP_${res.statusCode ?? 0}` });
      }
    } else {
      if (!corrected) recordVendorClockSkew(null);
      const t0 = Date.now();
      updateDoorbellStatus({ connected: true, lastConnectedAt: t0, lastErrorCode: null });
      // Bağlanınca bir kez yokla: kopukken kaçan zil olmuş olabilir.
      requestImmediateLicensePoll();
      await consume(res, controller.signal);
      livedMs = Date.now() - t0;
      updateDoorbellStatus({ connected: false });
    }
  } catch (err) {
    updateDoorbellStatus({ connected: false, lastErrorCode: err instanceof EgressError ? err.code : "EGRESS_NETWORK" });
  } finally {
    if (gen === generation) controller = null;
  }
  if (stopped || gen !== generation) return;
  attempt = reconnectAttempt(attempt, livedMs);
  scheduleConnect(backoffMs(attempt++));
}

/** Kurulum etkinleşince beklemeden bağlan. */
export function kickLicenseDoorbell(): void {
  if (!started || stopped || controller) return;
  attempt = 0;
  scheduleConnect(0);
}

export function startLicenseDoorbell(): void {
  if (started) return;
  started = true;
  onLicenseActivated(kickLicenseDoorbell);
  scheduleConnect(BACKOFF_MIN_MS * 5);
  bilgi("lisans", "kapı zili aboneliği hazır (etkin kurulumda satıcıya bağlanır)");
}

/** Kapanış fazı: akış kesilir, yeniden bağlanma planı iptal edilir. */
export function stopLicenseDoorbell(): void {
  stopped = true;
  generation++;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  controller?.abort();
  controller = null;
  updateDoorbellStatus({ connected: false });
}

/** Test-only. */
export function __resetLicenseDoorbellForTests(): void {
  stopLicenseDoorbell();
  started = false;
  stopped = false;
  attempt = 0;
}
