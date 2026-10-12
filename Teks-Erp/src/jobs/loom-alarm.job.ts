// =============================================================================
// Dokuma ALARM motoru zamanlayıcısı — `loom-alarm.service.runLoomAlarmOnce` turunu sürer
// =============================================================================
// setInterval (node-cron yasak; machine-shift-close.job kalıbı), tek Express process.
//   - Bayrak (`tezgah.enabled ∧ tezgah.alarmEnabled`) KAPALIYKEN tur "disabled" döner: HİÇ satır yazılmaz.
//   - Tur üst üste binmez (`running`); tur sürerken gelen dürtme bir tur daha ister (`pending`).
//   - Dürtme (`nudgeLoomAlarm`) duruş yazma yollarından commit SONRASI gelir ve TEK kuyrukta BİRLEŞİR
//     (2 sn sessizlik, en çok 5 sn bekleme): makine sinyali akışında motor kesintisiz dönmez, kapanış
//     yine 30 sn beklemez. Zamanlayıcı başlamadıysa (bekçi süreci, doğrulama kipi) dürtme no-op'tur.
// =============================================================================

import { runLoomAlarmOnce } from "../services/loom-alarm.service";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";
import { createNudgeCoalescer } from "./nudge-coalescer";

const CHECK_INTERVAL_MS = 30 * 1000;
const STARTUP_DELAY_MS = 45 * 1000;
/** Dürtme birleştirme: son dürtmeden sonra sessizlik penceresi ve ilk dürtmeden en çok bekleme. */
export const LOOM_ALARM_NUDGE_DEBOUNCE_MS = 2 * 1000;
export const LOOM_ALARM_NUDGE_MAX_WAIT_MS = 5 * 1000;

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

const nudges = createNudgeCoalescer({ debounceMs: LOOM_ALARM_NUDGE_DEBOUNCE_MS, maxWaitMs: LOOM_ALARM_NUDGE_MAX_WAIT_MS, fire: tick });

/** Duruş yazma yolları commit sonrası çağırır — birleşir; zamanlayıcı başlamadıysa no-op. */
export function nudgeLoomAlarm(): void {
  if (!started) return;
  nudges.nudge();
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
