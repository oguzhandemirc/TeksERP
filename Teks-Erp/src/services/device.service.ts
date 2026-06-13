// =============================================================================
// TeksERP - Device Service (Tablet ↔ Makine eşleştirmesi)
// =============================================================================

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 dk

function generatePairingCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export class DeviceService {
  /**
   * Admin: tüm cihazları listele.
   */
  static async list() {
    return prisma.device.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        machine: {
          select: {
            id: true,
            code: true,
            name: true,
            station: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * Admin: yeni pairing kodu üret. Üretildiği anda valid; 10 dk içinde kullanılmazsa expire.
   */
  static async createPairingCode(input: {
    machineId: string;
    deviceName: string;
    createdById?: string;
  }) {
    const machine = await prisma.machine.findUnique({
      where: { id: input.machineId },
      select: { id: true, isActive: true },
    });
    if (!machine || !machine.isActive) {
      throw AppError.notFound("Makine bulunamadı veya pasif");
    }

    // Çakışma riski düşük (6 hane, max ~birkaç aktif kod), retry ile garanti.
    for (let i = 0; i < 5; i++) {
      const code = generatePairingCode();
      const existing = await prisma.pairingCode.findUnique({ where: { code } });
      if (existing) continue;
      const created = await prisma.pairingCode.create({
        data: {
          code,
          machineId: input.machineId,
          deviceName: input.deviceName,
          createdById: input.createdById ?? null,
          expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
        },
      });
      await AuditService.log({
        userId: input.createdById,
        action: "CREATE",
        tableName: "pairing_codes",
        recordId: created.code,
        newData: { machineId: created.machineId, deviceName: created.deviceName },
      });
      return created;
    }
    throw AppError.internal("Pairing kodu üretilemedi, tekrar deneyin");
  }

  /**
   * Mobil (public): tablet ilk kurulumda kodu ve kendi deviceId'sini gönderir.
   * Sonuç: Device kaydı oluşur veya güncellenir, kullanılan kod işaretlenir.
   */
  static async pair(input: { deviceId: string; code: string }) {
    const pairing = await prisma.pairingCode.findUnique({
      where: { code: input.code },
      include: {
        machine: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
            station: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!pairing) {
      throw AppError.badRequest("Eşleştirme kodu geçersiz");
    }
    if (pairing.usedAt) {
      throw AppError.badRequest("Eşleştirme kodu zaten kullanılmış");
    }
    if (pairing.expiresAt < new Date()) {
      throw AppError.badRequest("Eşleştirme kodunun süresi dolmuş");
    }
    if (!pairing.machine.isActive) {
      throw AppError.badRequest("Makine pasif durumda");
    }

    const device = await prisma.$transaction(async (tx) => {
      const upserted = await tx.device.upsert({
        where: { deviceId: input.deviceId },
        create: {
          deviceId: input.deviceId,
          name: pairing.deviceName,
          machineId: pairing.machineId,
          isActive: true,
          lastSeenAt: new Date(),
        },
        update: {
          name: pairing.deviceName,
          machineId: pairing.machineId,
          isActive: true,
          lastSeenAt: new Date(),
        },
      });
      await tx.pairingCode.update({
        where: { code: pairing.code },
        data: { usedAt: new Date(), usedDeviceId: upserted.id },
      });
      return upserted;
    });

    await AuditService.log({
      userId: pairing.createdById ?? undefined,
      action: "UPDATE",
      tableName: "devices",
      recordId: device.id,
      newData: {
        deviceId: device.deviceId,
        machineId: device.machineId,
        pairedWith: pairing.code,
      },
    });

    return {
      device: {
        id: device.id,
        deviceId: device.deviceId,
        name: device.name,
      },
      machine: pairing.machine,
    };
  }

  /**
   * Admin: cihaz eşleşmesini kaldır (tablet pairing'i tekrar isteyecek).
   */
  static async unpair(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({
      where: { id },
      data: { machineId: null },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "devices",
      recordId: id,
      oldData: { machineId: existing.machineId },
      newData: { machineId: null },
    });
    return updated;
  }

  /**
   * Admin: pasif cihazı tekrar aktifleştir. machineId sıfır kalır — admin
   * tabletin tekrar bir makineye eşlenmesini istiyorsa yeni pairing kodu
   * üretmeli; tablet de o anda pairing ekranında olur (deaktifte 401 yedi).
   */
  static async reactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.isActive) throw AppError.badRequest("Cihaz zaten aktif");
    const updated = await prisma.device.update({
      where: { id },
      data: { isActive: true },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "devices",
      recordId: id,
      oldData: { isActive: false },
      newData: { isActive: true },
    });
    return updated;
  }

  /**
   * Admin: cihazı pasife al (soft delete). Sadece isActive=false; machineId
   * korunur. Pasif cihaz middleware tarafından 401'lenir; aktifleştirilince
   * eski makinesine otomatik geri bağlanır. Eşleşmeyi gerçekten koparmak için
   * ayrı "Eşleşmeyi Kaldır" (unpair) aksiyonu kullanılır.
   */
  static async deactivate(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({
      where: { id },
      data: { isActive: false },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "devices",
      recordId: id,
      oldData: { isActive: existing.isActive },
      newData: { isActive: false },
    });
    return updated;
  }

  /**
   * Admin: cihazı kalıcı olarak sil (hard delete). Sadece eşleşmemiş
   * (machineId=null) cihazlar silinebilir; aktif eşleşmeli cihaz silinmek
   * istenirse önce "Eşleşmeyi Kaldır" çağrılmalı. PairingCode.usedDeviceId
   * FK değil — yalın string olarak audit geçmişinde kalır.
   */
  static async hardDelete(id: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    if (existing.machineId) {
      throw AppError.badRequest(
        "Cihaz şu anda bir makineye eşli. Önce eşleşmeyi kaldırın."
      );
    }
    await prisma.device.delete({ where: { id } });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "devices",
      recordId: id,
      oldData: {
        deviceId: existing.deviceId,
        name: existing.name,
        isActive: existing.isActive,
      },
    });
    return { id };
  }

  /**
   * Admin: cihaz adını yeniden adlandır.
   */
  static async rename(id: string, name: string, userId?: string) {
    const existing = await prisma.device.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Cihaz bulunamadı");
    const updated = await prisma.device.update({
      where: { id },
      data: { name },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "devices",
      recordId: id,
      oldData: { name: existing.name },
      newData: { name },
    });
    return updated;
  }

  // lastSeenAt yazım throttle'ı — resolveDevice her `x-device-id`'li istekte çalışır
  // (sahada her tarama). Her istekte bir `UPDATE devices SET lastSeenAt` yazmak
  // küçük-sıcak satırda yazma amplifikasyonu (satır-versiyon churn / ölü tuple /
  // WAL / autovacuum baskısı) yaratıyordu. lastSeenAt'in saniye hassasiyeti gerekmez
  // → cihaz başına en fazla THROTTLE_MS'de bir yaz. Map cihaz sayısıyla sınırlı (küçük).
  private static lastSeenWrites = new Map<string, number>();
  private static readonly LAST_SEEN_THROTTLE_MS = 60_000;

  /**
   * Middleware: x-device-id header'ından device + machineId çöz.
   * lastSeenAt güncellenir (fire-and-forget, cihaz başına throttle'lı).
   */
  static async resolveDevice(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: {
        id: true,
        deviceId: true,
        name: true,
        machineId: true,
        isActive: true,
      },
    });
    if (!device || !device.isActive) return null;
    // Fire-and-forget lastSeenAt — son yazımdan THROTTLE_MS geçtiyse yaz, yoksa atla.
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
