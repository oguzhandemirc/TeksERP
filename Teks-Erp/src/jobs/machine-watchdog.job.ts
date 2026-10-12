// =============================================================================
// Makine kartı WATCHDOG zamanlayıcısı — `machine-watchdog.service.runMachineWatchdogOnce` turunu sürer
// =============================================================================
// setInterval (node-cron yasak; machine-shift-close.job kalıbı), tek Express process; tur üst üste binmez.
// Durum DB'dedir (claim'ler), bellekte değil — yeniden başlatma çift uyarı ya da çift kapanış üretmez.
// =============================================================================
import { runMachineWatchdogOnce } from "../services/machine-watchdog.service";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";

const CHECK_INTERVAL_MS = 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startMachineWatchdogScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runMachineWatchdogOnce()
      .then((r) => {
        if (r !== "disabled" && (r.silenced > 0 || r.provisional > 0 || r.corrected > 0 || r.failed > 0)) {
          bilgi("machine-watchdog", `kart: ${r.silenced} sessiz · duruş: ${r.provisional} geçici kapandı, ${r.corrected} düzeltildi, ${r.sealed} mühürlü bekliyor, ${r.failed} hata`);
        }
      })
      .catch((err) => reportJobFailure("machine-watchdog", err))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
  bilgi("machine-watchdog", "scheduler aktif — sessiz kart ve uzun açık kart duruşu izleniyor");
}
