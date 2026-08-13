// =============================================================================
// DEPO SERVİSİ — BaseService CRUD + üç guard
// =============================================================================
// Depo saf tanım verisidir; listeleme/arama/kod üretimi BaseService'ten gelir.
// Eklenen tek şey, varsayılan deponun ve dolu deponun korunması.
//
// ⚠️ "Varsayılan depo" bir KURAL taşır: depo söylenmeyen her giriş oraya düşer
// (`resolveTargetWarehouseId`). Pasifleştirilir ya da silinirse o kural cevapsız
// kalır ve yeni toplar DEPOSUZ doğar — hata yok, log yok, yalnız envanterde
// sessiz boşluk. Bu yüzden guard servis katmanında AÇIK; DB tarafında da
// `rolls_warehouseId_fkey` RESTRICT ile ikinci hat var.
// =============================================================================
import prisma from "../lib/prisma";
import { BaseService } from "./base.service";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";

class WarehouseService extends BaseService {
  constructor() {
    super({
      modelName: "warehouse",
      tableName: "WAREHOUSE",
      searchFields: ["code", "name", "address", "notes"],
      uniqueField: "code",
      duplicateNameField: "name",
      entityLabel: "depo",
      // Kod backend-authoritative: `DP+GGAAYY+NNNN` (istemci kodu yok sayılır).
      autoCode: { prefix: "DP" },
    });
  }

  /** Varsayılan depo pasife ALINAMAZ (kural cevapsız kalır). */
  async update(id: string, data: Record<string, unknown>, userId?: string): Promise<ApiResponse<unknown>> {
    if (data.isActive === false) {
      const w = await prisma.warehouse.findUnique({ where: { id }, select: { isDefault: true, name: true } });
      if (w?.isDefault) {
        throw AppError.conflict(
          `"${w.name}" VARSAYILAN depodur — pasife alınamaz. Önce başka bir depoyu varsayılan yapın.`,
        );
      }
    }
    return super.update(id, data, userId);
  }

  /** Soft-delete de pasifleştirmedir → aynı guard (controller.remove buraya gelir). */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const w = await prisma.warehouse.findUnique({ where: { id }, select: { isDefault: true, name: true } });
    if (w?.isDefault) {
      throw AppError.conflict(
        `"${w.name}" VARSAYILAN depodur — silinemez. Önce başka bir depoyu varsayılan yapın.`,
      );
    }
    return super.softDelete(id, userId);
  }

  /**
   * Kalıcı silme — varsayılan depo ve İÇİNDE KAYIT OLAN depo engellenir.
   *
   * DB'de `rolls_warehouseId_fkey` zaten RESTRICT (silme P2003 ile düşer); bu guard
   * kullanıcıya HAM veritabanı hatası yerine ne olduğunu söyleyen mesajı verir ve
   * sayıları listeler (kök CLAUDE.md: "X kayıt etkilenecek" gibi soyut sayı yetmez).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, name: true, isDefault: true },
    });
    if (!existing) return { success: false, data: null, message: "Depo bulunamadı" };
    if (existing.isDefault) {
      throw AppError.conflict(`"${existing.name}" VARSAYILAN depodur — kalıcı silinemez.`);
    }

    const [rollCount, receiptCount, transferFromCount, transferToCount, movementCount] = await Promise.all([
      prisma.roll.count({ where: { warehouseId: id } }),
      prisma.goodsReceipt.count({ where: { warehouseId: id } }),
      prisma.warehouseTransfer.count({ where: { fromWarehouseId: id } }),
      prisma.warehouseTransfer.count({ where: { toWarehouseId: id } }),
      prisma.warehouseMovement.count({
        where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] },
      }),
    ]);

    const blockers: string[] = [];
    if (rollCount > 0) blockers.push(`${rollCount} top`);
    if (receiptCount > 0) blockers.push(`${receiptCount} mal kabul fişi`);
    const transferCount = transferFromCount + transferToCount;
    if (transferCount > 0) blockers.push(`${transferCount} transfer`);
    if (movementCount > 0) blockers.push(`${movementCount} depo hareketi`);

    if (blockers.length > 0) {
      throw AppError.conflict(
        `Depoya bağlı kayıtlar var (${blockers.join(", ")}) — kalıcı silinemez. Depoyu pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }

  /**
   * Varsayılan depoyu DEĞİŞTİR — tek tx: eskisini düşür, yenisini kaldır.
   *
   * ⚠️ İki adımı ayrı yazmak partial unique'e (`warehouses_isDefault_key`) çarpar:
   * yeni depoyu önce işaretlemek "iki varsayılan" anlamına gelir ve DB reddeder.
   * Sıra bu yüzden LOAD-BEARING: önce eskiyi düşür, sonra yeniyi işaretle.
   */
  async setDefault(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const target = await prisma.warehouse.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true, isDefault: true },
    });
    if (!target) throw AppError.notFound("Depo bulunamadı");
    if (!target.isActive) throw AppError.badRequest("Pasif depo varsayılan yapılamaz.");
    if (target.isDefault) return { success: true, data: target, message: "Bu depo zaten varsayılan." };

    await prisma.$transaction(async (tx) => {
      await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
    });

    const { AuditService } = await import("./audit.service");
    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WAREHOUSE",
      recordId: id,
      newData: { kind: "SET_DEFAULT_WAREHOUSE", name: target.name },
    });

    return { success: true, data: { id, name: target.name }, message: `"${target.name}" varsayılan depo yapıldı.` };
  }
}

export const warehouseService = new WarehouseService();
export default warehouseService;
