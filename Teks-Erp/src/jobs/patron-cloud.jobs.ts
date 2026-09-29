// Patron bulutu işlerinin TEK başlatma/kapatma noktası — backend sürecinin İÇİNDE (ikinci Node süreci yok).
// İkisi de aynı ön koşulu (`cloud-sync/eligibility.ts`) sorar; ön koşul yoksa dışarı istek atılmaz.
import { startCloudSync, stopCloudSync } from "./cloud-sync.job";
import { startCloudInbox, stopCloudInbox } from "./cloud-inbox.job";

export function startPatronCloudJobs(): void {
  startCloudSync();
  startCloudInbox();
}

export function stopPatronCloudJobs(): void {
  stopCloudInbox();
  stopCloudSync();
}
