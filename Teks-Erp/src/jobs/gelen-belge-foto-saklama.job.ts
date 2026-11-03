// =============================================================================
// Gelen belge FOTOĞRAF SAKLAMA işi (K28) — onaylı/sevk edilmiş belgelerin tarama baytını ayara göre küçültür/siler
// =============================================================================
// `gelen-belge-okuma.job.ts` kalıbı: backend sürecinin İÇİNDE, `running` koruması, turlar arası zamanlayıcı, onay/sevk/ayar
// sonrası `requestImmediatePhotoRetentionRun` dürtmesi. Sıra DB'deki atomik claim'de (servis); ayar her turda okunur →
// geçmiş onaylılara da uygulanır. Ön koşul: gelen belge modülü açık ve kip FULL değil (FULL'da aday sorgusu bile koşmaz).
// =============================================================================
import { reportJobFailure } from "./job-failure";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { effectiveIncomingDocsEnabled } from "../services/system-setting.service";
import { runPhotoRetention, type RetentionRunResult } from "../services/gelen-belge-foto-saklama.service";

const STARTUP_DELAY_MS = 60 * 1000;
/** Kuyruk boşken bakma aralığı (onay/sevk dürter; sevk dürtmesi olmayan yollar bu aralıkla yakalanır). */
const IDLE_INTERVAL_MS = 10 * 60 * 1000;
const MIN_RUN_GAP_MS = 2000;
/** Tek turda en çok bu kadar tarama (küçültme okuma servisine gider; uzun tur kapanışı geciktirmesin). */
export const PHOTO_RETENTION_MAX_PER_RUN = 20;

let started = false;
let stopped = false;
let running = false;
let again = false;
let timer: NodeJS.Timeout | null = null;
let lastRunAt = 0;
let lastResult: RetentionRunResult | null = null;
/** Çözülemeyen (4xx) görüntü bu süreçte yeniden denenmez; yeniden başlatmada bir kez daha denenir. */
const failedIds = new Set<string>();

/** Tek tur; modül kapalıysa ya da tur sürüyorsa null. */
export async function runPhotoRetentionOnce(): Promise<RetentionRunResult | null> {
  if (running) {
    again = true;
    return null;
  }
  running = true;
  lastRunAt = Date.now();
  try {
    if (!(await effectiveIncomingDocsEnabled())) return null;
    const r = await runPhotoRetention(PHOTO_RETENTION_MAX_PER_RUN, { readerUrl: getReaderUrl().url }, [...failedIds]);
    for (const id of r.failedIds) failedIds.add(id);
    return (lastResult = r);
  } catch (err) {
    reportJobFailure("gelen-belge-foto-saklama", err);
    return null;
  } finally {
    running = false;
  }
}

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runPhotoRetentionOnce().then((r) => {
      const full = (r?.outcomes.length ?? 0) >= PHOTO_RETENTION_MAX_PER_RUN && !r?.outcomes.includes("RETRY");
      const rerun = again || full;
      again = false;
      schedule(rerun ? MIN_RUN_GAP_MS : IDLE_INTERVAL_MS);
    });
  }, delayMs);
  timer.unref();
}

/** Onay/sevk/ayar değişti: beklemeden tur (yağmur korumalı). İş başlamadıysa (bekçi, betik) sessizce yok sayılır. */
/** Ayar yazımı sonrası: kip FULL değilse işi hemen tetikler; veriyi aynen döner (route tek satır kalsın). */
export function kickPhotoRetentionIfActive<T extends { photoRetention: string }>(data: T): T {
  if (data.photoRetention !== "FULL") requestImmediatePhotoRetentionRun();
  return data;
}

export function requestImmediatePhotoRetentionRun(): void {
  if (!started || stopped) return;
  if (running) {
    again = true;
    return;
  }
  schedule(Math.max(0, MIN_RUN_GAP_MS - (Date.now() - lastRunAt)));
}

export function startPhotoRetention(): void {
  if (started) return;
  started = true;
  schedule(STARTUP_DELAY_MS);
}

export function stopPhotoRetention(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function photoRetentionJobStatus(): { started: boolean; running: boolean; lastRunAt: number; last: RetentionRunResult | null } {
  return { started, running, lastRunAt, last: lastResult };
}
