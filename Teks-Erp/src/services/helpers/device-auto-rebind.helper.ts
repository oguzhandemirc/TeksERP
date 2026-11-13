// Otomatik yeniden bağlama kararı — `device-rebind.service.ts`in TEK yüklemi burada durur
// (servis dosyası satır tavanında; karar saf, defter okuması ayrı).
import prisma from "../../lib/prisma";
import { isHostedInstallation } from "./install-class.helper";

/** Otomatik bağlamanın gerekçesi (defter `meta.kural` + audit `reason`). */
export type AutoRebindRule = "ESLESTIRME_KAPALI" | "BILINEN_DONANIM";

/** Barındırılanda aynı hedefe bu süre içinde ikinci OTOMATİK bağlama talebe düşer (klon/çekişme sigortası). */
export const AUTO_REBIND_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Otomatik yeniden bağlama kararı — TEK yüklem. Hedef aktif + onaylı olmalı (revoke edilmiş PENDING
 * ya da pasif cihaz public uçla dirilmez); eşleştirme kapalıysa ya da `device.autoReattachKnownHardware`
 * açıksa otomatik. `recentAuto`: barındırılanda son 10 dk'da otomatik bağlama olduysa talep.
 */
export function autoRebindRule(p: {
  target: { isActive: boolean; status: string };
  pairingRequired: boolean;
  autoReattach: boolean;
  hostedRecentAuto: boolean;
}): AutoRebindRule | null {
  if (!p.target.isActive || p.target.status !== "APPROVED") return null;
  if (!p.pairingRequired) return "ESLESTIRME_KAPALI";
  if (!p.autoReattach || p.hostedRecentAuto) return null;
  return "BILINEN_DONANIM";
}

/** Barındırılan sınıfta hedefe son soğuma penceresinde OTOMATİK bağlama olmuş mu (defterden). */
export async function hostedRecentAutoRebind(targetId: string): Promise<boolean> {
  if (!isHostedInstallation()) return false;
  const since = new Date(Date.now() - AUTO_REBIND_COOLDOWN_MS);
  const n = await prisma.deviceBindingEvent.count({
    where: { deviceRefId: targetId, event: "REBOUND", createdAt: { gte: since }, meta: { path: ["yol"], equals: "OTOMATIK" } },
  });
  return n > 0;
}
