// Kimliksiz cihaz duyurusunun seli (VDS denetimi O3, 2026-11-01). Barındırılan (internete açık)
// kurulumda: kaynak (IP, IPv6'da /64) başına en çok 5 BEKLEYEN cihaz; hiç onaylanmamış PENDING
// cihaz 24 saatte PASİFE düşer (durum geçişi — satır silinmez, yönetici `reactivate` ile geri açar).
// LAN kurulumu bayt-aynıdır (her tablet kendi IP'sini taşır; tavan ve süre aşımı yok).
// Kaynak, doğuş olayının (`REGISTERED`) meta'sına `ip` olarak yazılır — şema değişmez.
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { isHostedInstallation } from "./install-class.helper";
import { liveDeviceWhere } from "./device-identity.helper";

export const MAX_PENDING_DEVICES_PER_SOURCE = 5;
export const PENDING_DEVICE_TTL_MS = 24 * 60 * 60 * 1000;
/** Tek turda pasife alınan en çok satır — tavansız `findMany` yasağı. */
const EXPIRE_BATCH = 200;

/** Onay görmüş (sonra geri alınmış) cihaz süre aşımına düşmez: yalnız doğuş olayı olan satır. */
const NEVER_APPROVED: Prisma.DeviceWhereInput = {
  bindingEvents: { none: { event: { notIn: ["REGISTERED", "HW_CONFLICT"] } } },
  workSessions: { none: {} },
  proofConfirmedAt: null,
};

/** Süre aşımı ve toplu reddin ortak yüklemi: canlı, aktif, bekleyen. */
const PENDING_LIVE: Prisma.DeviceWhereInput = { status: "PENDING", isActive: true, ...liveDeviceWhere() };

/** Barındırılanda kaynağın bekleyen cihaz tavanı dolduysa 429 `PENDING_DEVICE_SOURCE_LIMIT`. */
export async function assertSourcePendingCapacity(source: string | null, hosted = isHostedInstallation()): Promise<void> {
  if (!hosted || !source) return;
  const n = await prisma.device.count({
    where: {
      ...PENDING_LIVE,
      bindingEvents: { some: { event: "REGISTERED", meta: { path: ["ip"], equals: source } } },
    },
  });
  if (n >= MAX_PENDING_DEVICES_PER_SOURCE) {
    throw AppError.tooManyRequests(
      `Bu ağdan onay bekleyen cihaz sayısı üst sınırda (${MAX_PENDING_DEVICES_PER_SOURCE}). ` +
        "Yönetici panelinden bekleyen cihazları onaylayın ya da reddedin.",
      { code: "PENDING_DEVICE_SOURCE_LIMIT" },
    );
  }
}

/** Barındırılanda 24 saati geçmiş, hiç onaylanmamış PENDING cihazları pasife alır (atomik claim). */
export async function expireStalePendingDevices(now = new Date(), hosted = isHostedInstallation()): Promise<number> {
  if (!hosted) return 0;
  const cutoff = new Date(now.getTime() - PENDING_DEVICE_TTL_MS);
  const stale = await prisma.device.findMany({
    where: { ...PENDING_LIVE, ...NEVER_APPROVED, createdAt: { lt: cutoff } },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: EXPIRE_BATCH,
  });
  let expired = 0;
  for (const { id } of stale) {
    const r = await prisma.device.updateMany({
      where: { id, ...PENDING_LIVE, ...NEVER_APPROVED, createdAt: { lt: cutoff } },
      data: { isActive: false },
    });
    if (r.count === 0) continue;
    expired += 1;
    await AuditService.log({
      userId: undefined, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: true, status: "PENDING" }, newData: { isActive: false, reason: "PENDING_EXPIRED" },
    }).catch(() => undefined);
  }
  return expired;
}

/** Yönetici: seçili bekleyen cihazları toplu reddet (pasife al). Yalnız hâlâ bekleyen satır döner. */
export async function rejectPendingDevices(ids: string[], userId?: string): Promise<{ rejected: string[] }> {
  const rejected: string[] = [];
  for (const id of ids) {
    const r = await prisma.device.updateMany({ where: { id, ...PENDING_LIVE }, data: { isActive: false } });
    if (r.count === 0) continue;
    rejected.push(id);
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: true, status: "PENDING" }, newData: { isActive: false, reason: "PENDING_REJECTED" },
    }).catch(() => undefined);
  }
  return { rejected };
}
