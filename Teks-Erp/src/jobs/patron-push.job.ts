// Patron push bulut turu zamanlayıcısı — backend sürecinin İÇİNDE (ikinci süreç yok), tek uçuş, `.unref()`.
// 30 sn (+ jitter) aralık; cihaz kaydı/bırakma `requestPatronPushRound` ile 2 sn sonrasına öne çeker. Bayrak kapalı ya
// da kurulum uygun değilse tur yalnız yerel süpürme yapar, dışarı istek atmaz (`cloud-round.service.ts`).
import { runPatronPushRound } from "../services/patron-push/cloud-round.service";
import { setPatronPushWakeListener } from "../services/patron-push/wake";
import { reportJobFailure } from "./job-failure";
import { withJitter } from "./license-poll.job";

const ROUND_INTERVAL_MS = 30_000;
const STARTUP_DELAY_MS = 60_000;
const WAKE_DELAY_MS = 2_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = true;

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), delayMs);
  timer.unref();
}

async function tick(): Promise<void> {
  timer = null;
  if (running) return schedule(ROUND_INTERVAL_MS);
  running = true;
  try {
    await runPatronPushRound();
  } catch (err) {
    reportJobFailure("patron-push", err);
  } finally {
    running = false;
    schedule(withJitter(ROUND_INTERVAL_MS));
  }
}

export function startPatronPushJob(): void {
  if (!stopped) return;
  stopped = false;
  setPatronPushWakeListener(() => schedule(WAKE_DELAY_MS));
  schedule(STARTUP_DELAY_MS);
}

export function stopPatronPushJob(): void {
  stopped = true;
  setPatronPushWakeListener(null);
  if (timer) clearTimeout(timer);
  timer = null;
}
