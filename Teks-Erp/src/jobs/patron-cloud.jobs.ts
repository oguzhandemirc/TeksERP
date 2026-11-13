// Patron bulutu işlerinin TEK başlatma/kapatma noktası — backend sürecinin İÇİNDE (ikinci Node süreci yok).
// Eşitleme + gelen kutusu `cloudEligibility`, push köprüsü `pushBridgeEligibility` sorar (`cloud-sync/eligibility.ts`);
// ön koşul yoksa dışarı istek atılmaz.
import { startCloudSync, stopCloudSync } from "./cloud-sync.job";
import { startCloudInbox, stopCloudInbox } from "./cloud-inbox.job";
import { startPatronPushJob, stopPatronPushJob } from "./patron-push.job";

export function startPatronCloudJobs(): void {
  startCloudSync();
  startCloudInbox();
  startPatronPushJob();
}

export function stopPatronCloudJobs(): void {
  stopPatronPushJob();
  stopCloudInbox();
  stopCloudSync();
}
