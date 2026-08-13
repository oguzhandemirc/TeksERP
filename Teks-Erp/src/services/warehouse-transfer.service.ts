// =============================================================================
// DEPOLAR ARASI TRANSFER
// =============================================================================
// TEK ADIMLI: "yolda" (in-transit) durumu yok — yerel depolar arasında araç
// takibi ihtiyacı yok. Gerekirse `WarehouseTransferStatus`a SONA `IN_TRANSIT`
// eklenerek açılır.
//
// ⚠️ MAL KABULDEN FARKLI OLARAK TEK TRANSACTION: burada `createInitialEntry`
// yok, yalnız `Roll.warehouseId` güncelleniyor → tüm transfer atomik olabilir
// ve OLMALI. Yarım transfer ("5 top gitti, 3'ü kaldı") fiziksel dünyada
// karşılığı olmayan bir durumdur: mal kamyona ya birlikte biner ya binmez.
//
// ⚠️ SATIR TABLOSU YOK: kalemler `WarehouseMovement` satırlarıdır (`transferId`).
// =============================================================================
import { Prisma, RollStatus, WarehouseEventType, WarehouseTransferStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { buildWhereClause } from "../utils/query-parser";
import { writeWarehouseMovements } from "./helpers/warehouse-ledger.helper";
import type { ApiResponse } from "../types/api.types";

const TRANSFER_PREFIX = "DT";

/**
 * Transfer edilebilir statüler — mal FİZİKSEL olarak depoda duruyor olmalı.
 *
 * ⚠️ Liste dar tutuldu: `IN_PRODUCTION` (istasyonda), `AT_SUBCONTRACTOR`
 * (fasonda), `SHIPPED` (müşteride), `CANCELLED`/`SCRAP` (yok) ve tüketilmiş
 * statüler DIŞARIDA. Mal zaten depoda değilken "depodan depoya taşıdım" demek
 * defteri yalanlar.
 */
const TRANSFERABLE: RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

export interface TransferCreateInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  rollIds: string[];
  notes?: string | null;
  clientToken?: string;
}

async function nextTransferNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = dailyCodePrefix(TRANSFER_PREFIX, now);
  const rows = await tx.warehouseTransfer.findMany({
    where: { transferNo: { gte: prefix, startsWith: prefix } },
    select: { transferNo: true },
  });
  return buildDailyCode(TRANSFER_PREFIX, nextDailySeq(rows.map((r) => r.transferNo), prefix), now);
}

export class WarehouseTransferService {
  /**
   * Transferi kurar ve ANINDA uygular (tek tx).
   *
   * Guard ihlalinde 400 + SOMUT top listesi — "3 top uygun değil" gibi soyut bir
   * sayı operatöre hangi topu ayıklayacağını söylemez (kök CLAUDE.md kuralı).
   */
  async create(input: TransferCreateInput, userId?: string): Promise<ApiResponse<unknown>> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw AppError.badRequest("Kaynak ve hedef depo aynı olamaz.");
    }
    if (input.rollIds.length === 0) throw AppError.badRequest("Transfer edilecek top seçilmedi.");

    const [from, to] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: input.fromWarehouseId }, select: { id: true, name: true, isActive: true } }),
      prisma.warehouse.findUnique({ where: { id: input.toWarehouseId }, select: { id: true, name: true, isActive: true } }),
    ]);
    if (!from) throw AppError.badRequest("Kaynak depo bulunamadı.");
    if (!to) throw AppError.badRequest("Hedef depo bulunamadı.");
    if (!to.isActive) throw AppError.badRequest(`"${to.name}" deposu pasif — mal bu depoya taşınamaz.`);

    // İdempotent tekrar (ağ kopması / çift tıklama).
    if (input.clientToken) {
      const dupe = await prisma.warehouseTransfer.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, transferNo: true },
      });
      if (dupe) {
        return { success: true, data: await this.loadDetail(dupe.id), message: `Bu transfer zaten yapılmış (${dupe.transferNo}).` };
      }
    }

    const uniqueIds = [...new Set(input.rollIds)];
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const rolls = await tx.roll.findMany({
          where: { id: { in: uniqueIds } },
          select: {
            id: true, barcode: true, status: true, currentQty: true,
            warehouseId: true, sackId: true, shipmentId: true,
          },
        });

        const problems: string[] = [];
        const ref = (r: { id: string; barcode: string | null }) => r.barcode ?? r.id.slice(0, 8);
        const foundIds = new Set(rolls.map((r) => r.id));
        for (const missing of uniqueIds.filter((id) => !foundIds.has(id))) {
          problems.push(`${missing.slice(0, 8)}: top bulunamadı`);
        }
        for (const r of rolls) {
          if (r.warehouseId !== input.fromWarehouseId) problems.push(`${ref(r)}: bu depoda değil`);
          else if (!TRANSFERABLE.includes(r.status)) problems.push(`${ref(r)}: durumu uygun değil (${r.status})`);
          else if (r.sackId) problems.push(`${ref(r)}: çuvalda — önce çuvaldan çıkarın`);
          else if (r.shipmentId) problems.push(`${ref(r)}: sevkiyata bağlı`);
        }
        if (problems.length > 0) {
          const sample = problems.slice(0, 8).join(" · ");
          throw AppError.badRequest(
            `${problems.length} top transfer edilemez: ${sample}${problems.length > 8 ? " · …" : ""}`,
          );
        }

        const transferNo = await nextTransferNo(tx);
        const transfer = await tx.warehouseTransfer.create({
          data: {
            transferNo,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            notes: input.notes?.trim() || null,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
          },
          select: { id: true, transferNo: true },
        });

        // ATOMİK CLAIM: taşıma yalnız toplar HÂLÂ kaynak depodaysa geçer. Guard'lar
        // yukarıda tx İÇİNDE okundu ama araya giren bir sevk/başka transfer aynı
        // pencerede commit edebilir; koşullu updateMany kaybedeni 409'a düşürür.
        const moved = await tx.roll.updateMany({
          where: { id: { in: uniqueIds }, warehouseId: input.fromWarehouseId, sackId: null, shipmentId: null },
          data: { warehouseId: input.toWarehouseId },
        });
        if (moved.count !== uniqueIds.length) {
          throw AppError.conflict(
            `Toplar bu sırada başka bir işleme girdi (${moved.count}/${uniqueIds.length} taşınabildi) — transfer iptal edildi, tekrar deneyin.`,
          );
        }

        await writeWarehouseMovements(
          tx,
          rolls.map((r) => ({
            rollId: r.id,
            eventType: WarehouseEventType.TRANSFER,
            qty: r.currentQty,
            fromWarehouseId: input.fromWarehouseId,
            toWarehouseId: input.toWarehouseId,
            transferId: transfer.id,
            userId: userId ?? null,
          })),
        );

        return { id: transfer.id, transferNo: transfer.transferNo, count: rolls.length };
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WAREHOUSE_TRANSFER",
      recordId: result.id,
      newData: { transferNo: result.transferNo, from: from.name, to: to.name, rollCount: result.count },
    });

    return {
      success: true,
      data: await this.loadDetail(result.id),
      message: `${result.transferNo}: ${result.count} top "${from.name}" → "${to.name}" taşındı.`,
    };
  }

  /**
   * Transferi geri alır (storno) — toplar kaynak depoya döner.
   *
   * ⚠️ Geri dönüş adresi transferin KENDİ satırındadır (`fromWarehouseId`), yani
   * `preShipStatus` gibi ayrı bir snapshot alanına gerek yok.
   *
   * ⚠️ Yalnız toplar HÂLÂ hedef depoda ve SERBEST ise geri alınır: aradan sevk
   * geçmişse ya da başka bir transferle taşınmışsa geri sarmak yanlış defter
   * yazar. İhlalde 409 + hangi toplar.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<unknown>> {
    const transfer = await prisma.warehouseTransfer.findUnique({
      where: { id },
      select: { id: true, transferNo: true, status: true, fromWarehouseId: true, toWarehouseId: true },
    });
    if (!transfer) throw AppError.notFound("Transfer bulunamadı.");
    if (transfer.status === WarehouseTransferStatus.CANCELLED) {
      return { success: true, data: transfer, message: `${transfer.transferNo} zaten iptal edilmiş.` };
    }

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.warehouseMovement.findMany({
        where: { transferId: id, eventType: WarehouseEventType.TRANSFER },
        select: { rollId: true, qty: true },
      });
      if (rows.length === 0) throw AppError.conflict("Transferin kalemleri bulunamadı.");

      const rollIds = rows.map((r) => r.rollId);
      const rolls = await tx.roll.findMany({
        where: { id: { in: rollIds } },
        select: { id: true, barcode: true, status: true, warehouseId: true, sackId: true, shipmentId: true },
      });
      const problems = rolls
        .filter((r) => r.warehouseId !== transfer.toWarehouseId || r.sackId || r.shipmentId || !TRANSFERABLE.includes(r.status))
        .map((r) => `${r.barcode ?? r.id.slice(0, 8)} (${r.status})`);
      if (problems.length > 0) {
        throw AppError.conflict(
          `${transfer.transferNo}: ${problems.length} top transfer sonrası işlem görmüş (${problems.slice(0, 5).join(", ")}` +
            `${problems.length > 5 ? "…" : ""}) — transfer geri alınamaz.`,
        );
      }

      const claim = await tx.warehouseTransfer.updateMany({
        where: { id, status: WarehouseTransferStatus.COMPLETED },
        data: {
          status: WarehouseTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
      if (claim.count === 0) throw AppError.conflict("Transfer bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");

      const back = await tx.roll.updateMany({
        where: { id: { in: rollIds }, warehouseId: transfer.toWarehouseId, sackId: null, shipmentId: null },
        data: { warehouseId: transfer.fromWarehouseId },
      });
      if (back.count !== rollIds.length) {
        throw AppError.conflict("Toplar bu sırada taşındı — transfer geri alınamadı, tekrar deneyin.");
      }

      // Defter APPEND-ONLY: TRANSFER satırı silinmez, ters satır eklenir —
      // taşıma gerçekten olmuştu; ikisi birlikte "gitti ve geri geldi" der.
      await writeWarehouseMovements(
        tx,
        rows.map((r) => ({
          rollId: r.rollId,
          eventType: WarehouseEventType.TRANSFER_REVERSAL,
          qty: r.qty,
          fromWarehouseId: transfer.toWarehouseId,
          toWarehouseId: transfer.fromWarehouseId,
          transferId: id,
          userId: userId ?? null,
          notes: reason?.trim() || null,
        })),
      );

      return { count: rollIds.length };
    });

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WAREHOUSE_TRANSFER",
      recordId: id,
      newData: { kind: "CANCEL", transferNo: transfer.transferNo, rollCount: result.count, reason: reason ?? null },
    });

    return {
      success: true,
      data: await this.loadDetail(id),
      message: `${transfer.transferNo} geri alındı (${result.count} top kaynak depoya döndü).`,
    };
  }

  /** Transfer listesi (sayfalı) — sorgu SERVİSTE (katman kuralı). */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
  }): Promise<{ rows: unknown[]; total: number }> {
    const where = buildWhereClause(params.filters, ["transferNo", "notes"], params.search);
    const [rows, total] = await Promise.all([
      prisma.warehouseTransfer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          transferNo: true,
          status: true,
          createdAt: true,
          cancelledAt: true,
          fromWarehouse: { select: { id: true, name: true } },
          toWarehouse: { select: { id: true, name: true } },
          _count: { select: { movements: true } },
        },
      }),
      prisma.warehouseTransfer.count({ where }),
    ]);
    return { rows, total };
  }

  /** Transfer detayı — başlık + taşınan toplar (defter satırlarından). */
  async loadDetail(id: string): Promise<Record<string, unknown>> {
    const transfer = await prisma.warehouseTransfer.findUnique({
      where: { id },
      include: {
        fromWarehouse: { select: { id: true, code: true, name: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        cancelledBy: { select: { id: true, fullName: true, username: true } },
      },
    });
    if (!transfer) throw AppError.notFound("Transfer bulunamadı.");

    // Kalemler defterden okunur (satır tablosu YOK — tek kaynak).
    const lines = await prisma.warehouseMovement.findMany({
      where: { transferId: id, eventType: WarehouseEventType.TRANSFER },
      orderBy: { createdAt: "asc" },
      select: {
        qty: true,
        roll: {
          select: {
            id: true, barcode: true, status: true, currentQty: true, width: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true } },
          },
        },
      },
    });

    const totalQty = lines.reduce((s, l) => s.plus(l.qty), new Prisma.Decimal(0));
    return { ...transfer, lines, totals: { rollCount: lines.length, totalQty: Number(totalQty) } };
  }
}

export const warehouseTransferService = new WarehouseTransferService();
export default warehouseTransferService;
