// =============================================================================
// Bekleyen cihaz süre aşımı (VDS denetimi O3) — barındırılan kurulumda 24 saati geçmiş, hiç
// onaylanmamış PENDING cihazı pasife alır; LAN'da tur no-op. setInterval (node-cron yasak),
// tur üst üste binmez; durum DB'de (atomik claim), yeniden başlatma çift iş üretmez.
// =============================================================================
import { expireStalePendingDevices } from "../services/helpers/device-pending-guard.helper";
import { reportJobFailure } from "./job-failure";
import { bilgi } from "../lib/logger";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_DELAY_MS = 120 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startPendingDeviceExpiryScheduler(): void {
  if (timer) return;
  const tick = (): void => {
    if (running) return;
    running = true;
    void expireStalePendingDevices()
      .then((n) => {
        if (n > 0) bilgi("pending-device-expiry", `${n} bekleyen cihaz 24 saatte onaylanmadı — pasife alındı`);
      })
      .catch((err) => reportJobFailure("pending-device-expiry", err))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS).unref();
}
