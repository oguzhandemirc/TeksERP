// =============================================================================
// MAL KABUL — satın alınan malın depoya girişi (üretimsiz stok girişi)
// =============================================================================
// Alım-satım kurulumunun ANA giriş kapısı: tedarikçiden gelen mal → depo → top
// satırları → barkod + etiket → WAREHOUSE. Üretici fabrikada bu akış kullanılmaz
// (mal KK1'den ham olarak girer ve rotaya sokulur).
//
// ⚠️ İKİNCİ BİR GİRİŞ MOTORU YAZILMAZ. Her satır `InventoryService.createInitialEntry`
// çağırır; mükerrer tuzağı (advisory lock), `clientToken` idempotency'si, barkod
// rezervasyonu, izinli renk/özellik doğrulaması ve etiket niyeti oradan BEDAVA
// gelir. Emsal: `tambur-manual.produceFinishedRoll` (o da iş emrisiz, hareketsiz,
// doğrudan depoya yazan bir sarmalayıcıdır).
//
// ⚠️ FİŞ BİR KAPTIR, ATOMİK BİR PAKET DEĞİL. `createInitialEntry` kendi
// transaction'ını açtığı için satırlar TEK tx'te toplanamaz; bu bilinçli olarak
// korunuyor çünkü tersi (tek dev tx) mükerrer tuzağının advisory kilidini fişin
// tamamı boyunca tutardı. Sonuç: bir satır düşerse diğerleri KALIR ve düşen satır
// somut sebebiyle döner (`failed[]`) — "10 top girildi" deyip 2'sini yutmak en
// kötü davranıştır (kurşun toplu dağıtım emsali).
// =============================================================================
import { GoodsReceiptStatus, Prisma, RollEntrySource, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { InventoryService } from "./inventory.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { buildWhereClause } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";

const inventory = new InventoryService();

/** Fiş numarası ön eki — MK + GGAAYY + NNNN. */
const RECEIPT_PREFIX = "MK";

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  weightKg?: number | null;
  width?: number | null;
  qualityGrade?: string | null;
  foldType?: string | null;
  propertyIds?: string[];
  /** Satır başına idempotency — ağ kopmasında yarım fiş mükerrer top doğurmaz. */
  clientToken?: string;
}

export interface GoodsReceiptCreateInput {
  warehouseId: string;
  supplierId?: string | null;
  deliveryNoteNo?: string | null;
  notes?: string | null;
  clientToken?: string;
  lines?: GoodsReceiptLineInput[];
}

interface LineFailure {
  index: number;
  itemId: string;
  reason: string;
}

async function nextReceiptNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const prefix = dailyCodePrefix(RECEIPT_PREFIX, now);
  const rows = await tx.goodsReceipt.findMany({
    where: { receiptNo: { gte: prefix, startsWith: prefix } },
    select: { receiptNo: true },
  });
  return buildDailyCode(RECEIPT_PREFIX, nextDailySeq(rows.map((r) => r.receiptNo), prefix), now);
}

export class GoodsReceiptService {
  /**
   * Fiş açar; `lines` verilmişse satırları da işler.
   *
   * Depo ZORUNLU ve AÇIK verilir — mal kabulde "hangi depoya" sorusunun sessiz bir
   * varsayılanı olamaz (tek depolu kurulumda arayüz onu otomatik seçer, kullanıcıya
   * sormaz; sözleşme yine de açıktır).
   */
  async create(input: GoodsReceiptCreateInput, userId?: string): Promise<ApiResponse<unknown>> {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
      select: { id: true, name: true, isActive: true },
    });
    if (!warehouse) throw AppError.badRequest("Depo bulunamadı.");
    if (!warehouse.isActive) throw AppError.badRequest(`"${warehouse.name}" deposu pasif — mal bu depoya alınamaz.`);

    if (input.supplierId) {
      const sup = await prisma.customer.findUnique({
        where: { id: input.supplierId },
        select: { id: true, name: true, isActive: true },
      });
      if (!sup) throw AppError.badRequest("Tedarikçi bulunamadı.");
      if (!sup.isActive) throw AppError.badRequest(`"${sup.name}" pasif durumda.`);
    }

    // İdempotent tekrar: aynı fiş iki kez açılmaz (ağ kopması / çift tıklama).
    if (input.clientToken) {
      const dupe = await prisma.goodsReceipt.findUnique({
        where: { clientToken: input.clientToken },
        select: { id: true, receiptNo: true },
      });
      if (dupe) {
        return {
          success: true,
          data: await this.loadDetail(dupe.id),
          message: `Bu fiş zaten açılmış (${dupe.receiptNo}).`,
        };
      }
    }

    const receipt = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const receiptNo = await nextReceiptNo(tx);
        return tx.goodsReceipt.create({
          data: {
            receiptNo,
            warehouseId: input.warehouseId,
            supplierId: input.supplierId ?? null,
            deliveryNoteNo: input.deliveryNoteNo?.trim() || null,
            notes: input.notes?.trim() || null,
            clientToken: input.clientToken ?? null,
            createdById: userId ?? null,
          },
          select: { id: true, receiptNo: true },
        });
      }),
    );

    void AuditService.log({
      userId,
      action: "CREATE",
      tableName: "GOODS_RECEIPT",
      recordId: receipt.id,
      newData: { receiptNo: receipt.receiptNo, warehouseId: input.warehouseId, supplierId: input.supplierId ?? null },
    });

    const lineResult = input.lines?.length
      ? await this.addLines(receipt.id, input.lines, userId)
      : { created: [] as string[], failed: [] as LineFailure[] };

    return {
      success: true,
      data: { ...(await this.loadDetail(receipt.id)), failed: lineResult.failed },
      message:
        lineResult.failed.length > 0
          ? `${receipt.receiptNo}: ${lineResult.created.length} top girildi, ${lineResult.failed.length} satır atlandı.`
          : `${receipt.receiptNo} oluşturuldu (${lineResult.created.length} top).`,
    };
  }

  /**
   * Fişe top ekler. Her satır kendi transaction'ında doğar (yukarıdaki "fiş bir
   * kaptır" notu); düşen satır `failed[]` içinde SEBEBİYLE döner.
   */
  async addLines(
    receiptId: string,
    lines: GoodsReceiptLineInput[],
    userId?: string,
  ): Promise<{ created: string[]; failed: LineFailure[] }> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id: receiptId },
      select: { id: true, receiptNo: true, status: true, warehouseId: true },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      throw AppError.conflict(`${receipt.receiptNo} iptal edilmiş — satır eklenemez.`);
    }

    const created: string[] = [];
    const failed: LineFailure[] = [];

    for (const [index, line] of lines.entries()) {
      try {
        const res = await inventory.createInitialEntry(
          {
            itemId: line.itemId,
            colorId: line.colorId ?? null,
            initialQty: line.initialQty,
            weightKg: line.weightKg ?? undefined,
            width: line.width ?? undefined,
            qualityGrade: line.qualityGrade ?? undefined,
            propertyIds: line.propertyIds,
            clientToken: line.clientToken,
          },
          userId,
          null,
          false,
          {
            // Satın alınan mal ÜRETİME girmez → doğrudan satılabilir depoya.
            forcedStatus: RollStatus.WAREHOUSE,
            forcedEntrySource: RollEntrySource.PURCHASE_RECEIPT,
            warehouseId: receipt.warehouseId,
            goodsReceiptId: receipt.id,
            foldType: line.foldType ?? null,
            // Mal kabulde istasyon YOK (üretim noktası değil) — kolon NULL kalır.
            entryStationId: null,
          },
        );
        created.push((res.data as { id: string }).id);
      } catch (err) {
        failed.push({
          index,
          itemId: line.itemId,
          reason: err instanceof Error ? err.message : "Bilinmeyen hata",
        });
      }
    }

    return { created, failed };
  }

  /**
   * Fişi iptal eder: toplar `softDelete` ile CANCELLED olur (mal HİÇ girmedi
   * semantiği — `qtyOut=0` storno), fiş CANCELLED işaretlenir.
   *
   * ⚠️ SEVK EDİLMİŞ ya da BAŞKA İŞLEM GÖRMÜŞ top varsa fiş iptal EDİLMEZ: mal
   * gerçekten kullanılmış, "hiç girmedi" demek defteri yalanlar. Operatör önce
   * o topları ayıklamalı.
   */
  async cancel(id: string, reason: string | undefined, userId?: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      select: { id: true, receiptNo: true, status: true },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");
    if (receipt.status === GoodsReceiptStatus.CANCELLED) {
      return { success: true, data: receipt, message: `${receipt.receiptNo} zaten iptal edilmiş.` };
    }

    const rolls = await prisma.roll.findMany({
      where: { goodsReceiptId: id },
      select: { id: true, barcode: true, status: true },
    });

    // Guard: iptal yalnız "mal hiç kullanılmadı" iken meşru.
    const used = rolls.filter(
      (r) => r.status !== RollStatus.WAREHOUSE && r.status !== RollStatus.A1_STOCK && r.status !== RollStatus.CANCELLED,
    );
    if (used.length > 0) {
      const sample = used.slice(0, 5).map((r) => `${r.barcode ?? r.id.slice(0, 8)} (${r.status})`).join(", ");
      throw AppError.conflict(
        `${receipt.receiptNo}: ${used.length} top işlem görmüş (${sample}${used.length > 5 ? "…" : ""}) — fiş iptal edilemez. ` +
          `Önce o topları ayıklayın.`,
      );
    }

    // Atomik claim: iki paralel iptalden yalnız biri geçer.
    const claim = await prisma.goodsReceipt.updateMany({
      where: { id, status: GoodsReceiptStatus.ACTIVE },
      data: {
        status: GoodsReceiptStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId ?? null,
        cancelReason: reason?.trim() || null,
      },
    });
    if (claim.count === 0) throw AppError.conflict("Fiş bu sırada başka bir işleme girdi — yenileyip tekrar deneyin.");

    // Toplar tek tek iptal edilir (`softDelete` kendi tx'ini açar + kendi
    // guard'larını koşar — ölü etiket onayı dahil).
    const cancelled: string[] = [];
    const skipped: LineFailure[] = [];
    for (const [index, r] of rolls.entries()) {
      if (r.status === RollStatus.CANCELLED) continue;
      try {
        await inventory.softDelete(r.id, userId, {
          confirmActive: true,
          confirmLabelPrinted: true,
          reason: reason?.trim() || `Mal kabul fişi iptali (${receipt.receiptNo})`,
        });
        cancelled.push(r.id);
      } catch (err) {
        skipped.push({ index, itemId: r.id, reason: err instanceof Error ? err.message : "Bilinmeyen hata" });
      }
    }

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "GOODS_RECEIPT",
      recordId: id,
      newData: { kind: "CANCEL", receiptNo: receipt.receiptNo, cancelledRolls: cancelled.length, skipped: skipped.length, reason: reason ?? null },
    });

    return {
      success: true,
      data: { id, receiptNo: receipt.receiptNo, cancelledRolls: cancelled.length, skipped },
      message:
        skipped.length > 0
          ? `${receipt.receiptNo} iptal edildi; ${cancelled.length} top düşürüldü, ${skipped.length} top atlandı.`
          : `${receipt.receiptNo} iptal edildi (${cancelled.length} top).`,
    };
  }

  /**
   * Fiş listesi (sayfalı). Sorgu SERVİSTE — route/controller katmanında prisma
   * import'u yasak (CLAUDE.md katman kuralı; ESLint bunu mekanik olarak kapatıyor).
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
  }): Promise<{ rows: unknown[]; total: number }> {
    const where = buildWhereClause(params.filters, ["receiptNo", "deliveryNoteNo", "notes"], params.search);
    const [rows, total] = await Promise.all([
      prisma.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
        select: {
          id: true,
          receiptNo: true,
          status: true,
          deliveryNoteNo: true,
          createdAt: true,
          cancelledAt: true,
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          _count: { select: { rolls: true } },
        },
      }),
      prisma.goodsReceipt.count({ where }),
    ]);
    return { rows, total };
  }

  /** Fiş detayı — başlık + toplar. */
  async loadDetail(id: string): Promise<Record<string, unknown>> {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            initialQty: true,
            width: true,
            weightKg: true,
            item: { select: { id: true, name: true, code: true } },
            color: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul fişi bulunamadı.");

    const totalQty = receipt.rolls
      .filter((r) => r.status !== RollStatus.CANCELLED)
      .reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));

    return {
      ...receipt,
      totals: { rollCount: receipt.rolls.filter((r) => r.status !== RollStatus.CANCELLED).length, totalQty: Number(totalQty) },
    };
  }
}

export const goodsReceiptService = new GoodsReceiptService();
export default goodsReceiptService;
