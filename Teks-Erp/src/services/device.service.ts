// =============================================================================
// TeksERP - Device Service (Tablet allowlist + atama)
// =============================================================================
// Eski 6-haneli PairingCode akışı KALDIRILDI. Yeni model: tablet boot'ta kendi
// kalıcı deviceId'sini `announce` eder → bilinmiyorsa PENDING kaydı açılır → admin
// "Onayla & Ata" ile APPROVED yapıp bir makineye bağlar → tablet otomatik çalışır.
// İstasyon makineden türetilir. `resolveDevice` yalnız APPROVED+aktif cihaza
// machineId döner (atıf), aksi null (bugünkü eşleşmemiş davranışı).
// =============================================================================

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

const DEVICE_INCLUDE = {
  machine: {
    select: { id: true, code: true, name: true, station: { select: { id: true, name: true } } },
  },
} as const;

type DeviceWithMachine = {
  status: string;
  isActive: boolean;
  machineId: string | null;
  machine: { id: string; code: string; name: string; station: { id: string; name: string } | null } | null;
};

function toAssignment(d: DeviceWithMachine) {
  const station = d.machine?.station ?? null;
  return {
    status: d.isActive ? d.status : "INACTIVE",
    machineId: d.machineId,
    machineCode: d.machine?.code ?? null,
    machineName: d.machine?.name ?? null,
    stationId: station?.id ?? null,
    stationName: station?.name ?? null,
  };
}

export class DeviceService {
  /** Admin: tüm cihazları listele (PENDING'ler önce). */
  static async list() {
    return prisma.device.findMany({
      orderBy: [{ status: "asc" }, { isActive: "desc" }, { createdAt: "desc" }],
      include: DEVICE_INCLUDE,
    });
  }

  /**
   * Mobil (public): tablet boot'ta deviceId'sini bildirir. Bilinmiyorsa PENDING
   * açılır (admin onaylar). Var olan → lastSeen güncellenir; mevcut atama döner.
   */
  static async announce(input: { deviceId: string; name?: string }) {
    const deviceId = (input.deviceId ?? "").trim();
    if (!deviceId) throw AppError.badRequest("deviceId zorunlu");
    const fallbackName = input.name?.trim() || `Tablet ${deviceId.slice(0, 8)}`;
    const device = await prisma.device.upsert({
      where: { deviceId },
      create: { deviceId, name: fallbackName, status: "PENDING", isActive: true, lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
      include: DEVICE_INCLUDE,
    });
    return toAssignment(device);
  }

  /** Mobil (public): atama durumunu poll'la. Bilinmiyorsa UNKNOWN. */
  static async getStatus(deviceId: string) {
    const device = await prisma.device.findUnique({ where: { deviceId }, include: DEVICE_INCLUDE });
    if (!device) return { status: "UNKNOWN", machineId: null, machineCode: null, machineName: null, stationId: null, stationName: null };
    return toAssignment(device);
  }

  /** Admin: cihazı onayla + (opsiyonel) makineye ata. İstasyon makineden türetilir. */
  static async approveAndAssign(id: string, input: { machineId?: string | null }, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    let machineId: string | null = input.machineId ?? null;
    if (machineId) {
      const m = await prisma.machine.findFirst({ where: { id: machineId, isActive: true }, select: { id: true } });
      if (!m) throw AppError.badRequest("Makine bulunamadı veya pasif");
    }
    const updated = await prisma.device.update({
      where: { id },
      data: { status: "APPROVED", isActive: true, machineId },
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { status: existing.status, machineId: existing.machineId },
      newData: { status: "APPROVED", machineId },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: onayı/atamayı geri al → PENDING (tablet "atama bekleniyor"a düşer). */
  static async revoke(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({
      where: { id }, data: { status: "PENDING", machineId: null },
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { status: existing.status, machineId: existing.machineId },
      newData: { status: "PENDING", machineId: null },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: pasif cihazı tekrar aktifleştir (atama/onay durumu korunur). */
  static async reactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.isActive) throw AppError.badRequest("Cihaz zaten aktif");
    const updated = await prisma.device.update({ where: { id }, data: { isActive: true } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: false }, newData: { isActive: true },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: cihazı pasife al (soft delete; onay/atama korunur, middleware 401'ler). */
  static async deactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({ where: { id }, data: { isActive: false } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { isActive: existing.isActive }, newData: { isActive: false },
    }).catch(() => undefined);
    return updated;
  }

  /** Admin: kalıcı sil (yalnız atanmamış — machineId=null). */
  static async hardDelete(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.machineId) {
      throw AppError.badRequest("Cihaz bir makineye atanmış. Önce atamayı geri alın.");
    }
    await prisma.device.delete({ where: { id } });
    await AuditService.log({
      userId, action: "DELETE", tableName: "devices", recordId: id,
      oldData: { deviceId: existing.deviceId, name: existing.name, status: existing.status },
    }).catch(() => undefined);
    return { id };
  }

  /** Admin: cihaz adını yeniden adlandır. */
  static async rename(id: string, name: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({ where: { id }, data: { name } });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "devices", recordId: id,
      oldData: { name: existing.name }, newData: { name },
    }).catch(() => undefined);
    return updated;
  }

  // lastSeenAt yazım throttle'ı — resolveDevice her `x-device-id`'li istekte çalışır.
  private static lastSeenWrites = new Map<string, number>();
  private static readonly LAST_SEEN_THROTTLE_MS = 60_000;

  /**
   * Middleware: x-device-id → device + machineId çöz. YALNIZ APPROVED + aktif cihaza
   * atıf döner; PENDING/INACTIVE/bilinmeyen → null (eşleşmemiş davranışı).
   * lastSeenAt fire-and-forget (cihaz başına throttle'lı).
   */
  static async resolveDevice(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: { id: true, deviceId: true, name: true, machineId: true, isActive: true, status: true },
    });
    if (!device || !device.isActive || device.status !== "APPROVED") return null;
    const now = Date.now();
    const lastWrite = DeviceService.lastSeenWrites.get(deviceId) ?? 0;
    if (now - lastWrite > DeviceService.LAST_SEEN_THROTTLE_MS) {
      DeviceService.lastSeenWrites.set(deviceId, now);
      void prisma.device
        .update({ where: { deviceId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    return device;
  }
}
