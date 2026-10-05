// =============================================================================
// Hata raporları — bellek → kuyruk (dakikada), kuyruk → satıcı (15 dk + jitter), budama (saatte).
// =============================================================================
// Varsayılan KAPALI: onay yoksa boşaltma ve gönderim hiçbir şey yapmaz (servis kapısı). Hepsi fail-silent;
// zamanlayıcılar `.unref()` — kapanışı bekletmez. Doğrulama kipinde ve etkinleşmemiş kurulumda dışarı çıkılmaz.
import { uyari } from "../lib/logger";
import {
  flushErrorReports,
  loadErrorReportConsent,
  pruneErrorReports,
  sendErrorReports,
} from "../services/error-report.service";
import { withJitter } from "./license-poll.job";

const FLUSH_INTERVAL_MS = 60 * 1000;
const SEND_INTERVAL_MS = 15 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let flushTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
let sendTimer: NodeJS.Timeout | null = null;
let stopped = true;

function scheduleSend(): void {
  if (stopped) return;
  sendTimer = setTimeout(() => {
    void sendErrorReports()
      .catch(() => "BEKLIYOR")
      .finally(scheduleSend);
  }, withJitter(SEND_INTERVAL_MS));
  sendTimer.unref();
}

export function startErrorReportJob(): void {
  if (!stopped) return;
  stopped = false;
  void loadErrorReportConsent();
  flushTimer = setInterval(() => {
    void flushErrorReports().catch((err: unknown) => uyari("error-report", "hata raporu kuyruğa yazılamadı", err));
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
  pruneTimer = setInterval(() => {
    void pruneErrorReports().catch(() => 0);
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();
  scheduleSend();
}

/** Kapanışta: zamanlayıcıları durdurur ve bellekteki son grupları kuyruğa yazar (gönderim bir sonraki açılışta). */
export async function stopErrorReportJob(): Promise<void> {
  stopped = true;
  for (const t of [flushTimer, pruneTimer]) if (t) clearInterval(t);
  if (sendTimer) clearTimeout(sendTimer);
  flushTimer = pruneTimer = sendTimer = null;
  await flushErrorReports().catch(() => 0);
}
