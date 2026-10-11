// =============================================================================
// Dokuma ALARM motoru zamanlayıcısı — `loom-alarm.service.runLoomAlarmOnce` turunu sürer
// =============================================================================
// setInterval (node-cron yasak; machine-shift-close.job kalıbı), tek Express process.
//   - Bayrak (`tezgah.enabled ∧ tezgah.alarmEnabled`) KAPALIYKEN tur "disabled" döner: HİÇ satır yazılmaz.
//   - Tur üst üste binmez (`running`); tur sürerken gelen dürtme bir tur daha ister (`pending`).
//   - Dürtme (`nudgeLoomAlarm`) duruş yazma yollarından commit SONRASI gelir: kapanış/geri alma/
//     sınıflama alarmı 30 sn beklemeden kapatır. Zamanlayıcı başlamadıysa (bekçi süreci, doğrulama
//     kipi) dürtme no-op'tur — motoru yalnız sunucunun zamanlayıcısı koşar.
// =============================================================================

import { runLoomAlarmOnce } from "../services/loom-alarm.service";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";

const CHECK_INTERVAL_MS = 30 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;

let started = false;
let running = false;
let pending = false;

function tick(): void {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  pending = false;
  void runLoomAlarmOnce()
    .then((r) => {
      if (r !== "disabled" && (r.raised > 0 || r.resolved > 0 || r.cancelled > 0 || r.failed > 0)) {
        bilgi("loom-alarm", `alarm: ${r.raised} kademe çaldı, ${r.skipped} atlandı, ${r.replanned} yeniden planlandı, ${r.resolved} çözüldü, ${r.cancelled} iptal, ${r.failed} hata`);
      }
    })
    .catch((err) => reportJobFailure("loom-alarm", err))
    .finally(() => {
      running = false;
      if (pending) setImmediate(tick);
    });
}

/** Duruş yazma yolları commit sonrası çağırır — zamanlayıcı başlamadıysa no-op. */
export function nudgeLoomAlarm(): void {
  if (!started) return;
  tick();
}

export function startLoomAlarmScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick();
    setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("loom-alarm", "scheduler aktif — tezgah alarmı açıkken hedefi aşan duruşlar için kademe çalınacak");
}
