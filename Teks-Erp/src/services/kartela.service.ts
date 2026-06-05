// =============================================================================
// TeksERP - Kartela (Swatch) Fason Service
// =============================================================================
// Üretim fasonundan AYRI, İŞ EMRİSİZ akış. Bkz. KARTELA-TASARIM.md.
//
//   dispatch()       : Depodaki bitmiş toplar kartela firmasına sevk edilir.
//                      Roll.status WAREHOUSE → AT_KARTELA.
//   cancelDispatch() : Sevk soft-cancel; toplar WAREHOUSE'a döner.
//   receive()        : Firmadan dönen kartelalar kabul edilir. Her orijinal top
//                      KARTELA_CONSUMED'a çekilir (komple tükenir) ve N adet
//                      Swatch (SW-) doğar. Uzunluk(cm)+ağırlık(kg) opsiyonel;
//                      toplu (bulk) veya tek-tek (items) girilebilir.
//   cancelReceipt()  : Kabul soft-cancel; doğan kartelalar geri alınır (soft),
//                      toplar AT_KARTELA'ya döner.
//
// Refakat kartı / WO step mantığı YOK — kartela bitmiş üründen üretilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { Prisma, RollStatus } from "@prisma/client";
import { buildPrefixedCardNumber, buildPrefixedBarcode } from "../utils/barcode";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildPagination } from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Liste filtre/sayfalama parametreleri — hem offset (mobil) hem cursor (admin)
// modunu besler. cursor||mode==="cursor" → cursor response; aksi halde offset.
interface KartelaListParams {
  subcontractorId?: string;
  /**
   * Durum filtresi:
   *   active   (default) — iptal edilmemiş (cancelledAt null)
   *   open     — iptal edilmemiş VE henüz kabul edilmemiş (iptal edilebilir)
   *   received — iptal edilmemiş VE kabul edilmiş
   *   cancelled — iptal edilmiş
   *   all      — hepsi
   */
  status?: "active" | "open" | "received" | "cancelled" | "all";
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  // offset (mobil)
  page?: number;
  pageSize?: number;
  // cursor (admin/useDataTable)
  cursor?: string;
  mode?: string;
  limit?: number;
  withTotal?: boolean;
}

type ListResult = {
  success: true;
  data: unknown[];
  pagination: Record<string, unknown>;
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function decodeSequenceFromBarcode(barcode: string): number | null {
  const parts = barcode.split("-");
  if (parts.length < 4) return null;
  const seqStr = parts[2];
  let n = 0;
  for (const ch of seqStr.toUpperCase()) {
    const v = CROCKFORD.indexOf(ch);
    if (v < 0) return null;
    n = n * 32 + v;
  }
  return n;
}

/** KD-/KR- belge numarası sequence (3 parçalı, sade ondalık: PFX-YYMM-NNNNNN). */
async function nextKartelaDocSequence(
  tx: Prisma.TransactionClient,
  kind: "dispatch" | "receipt",
  prefix: string,
  date: Date
): Promise<number> {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const docPrefix = `${prefix}-${yy}${mm}-`;

  let lastNo: string | null = null;
  if (kind === "dispatch") {
    const last = await tx.kartelaDispatch.findFirst({
      where: { dispatchNo: { startsWith: docPrefix } },
      orderBy: { dispatchNo: "desc" },
      select: { dispatchNo: true },
    });
    lastNo = last?.dispatchNo ?? null;
  } else {
    const last = await tx.kartelaReceipt.findFirst({
      where: { receiptNo: { startsWith: docPrefix } },
      orderBy: { receiptNo: "desc" },
      select: { receiptNo: true },
    });
    lastNo = last?.receiptNo ?? null;
  }

  if (!lastNo) return 1;
  const n = parseInt(lastNo.split("-")[2] ?? "", 10);
  return (Number.isFinite(n) ? n : 0) + 1;
}

/** SW- kartela barkodu sequence (4 parçalı, Crockford + checksum). */
async function nextSwatchSequence(
  tx: Prisma.TransactionClient,
  date: Date
): Promise<number> {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const barcodePrefix = `SW-${yy}${mm}-`;
  const last = await tx.swatch.findFirst({
    where: { barcode: { startsWith: barcodePrefix } },
    orderBy: { barcode: "desc" },
    select: { barcode: true },
  });
  if (!last?.barcode) return 1;
  const n = decodeSequenceFromBarcode(last.barcode);
  return (n ?? 0) + 1;
}

// -----------------------------------------------------------------------------
// Input types
// -----------------------------------------------------------------------------

export interface KartelaDispatchInput {
  subcontractorId: string;
  rollIds: string[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface KartelaReceiveReturn {
  rollId: string;
  /** Bu toptan dönen kartela adedi (1 top → N kartela). */
  count: number;
  /** Toplu ölçüm — bu toptan doğan TÜM kartelalara uygulanır. */
  bulkLengthCm?: number | null;
  bulkWeightKg?: number | null;
  /** Tek-tek ölçüm — varsa length === count olmalı; bulk'u ezer. */
  items?: Array<{ lengthCm?: number | null; weightKg?: number | null }>;
  notes?: string | null;
}

export interface KartelaReceiveInput {
  subcontractorId: string;
  dispatchId?: string | null;
  manifestNo?: string | null;
  notes?: string | null;
  returns: KartelaReceiveReturn[];
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class KartelaService {
  // ===========================================================================
  // DISPATCH — Depodaki bitmiş topları kartela firmasına sevk
  // ===========================================================================
  async dispatch(
    data: KartelaDispatchInput,
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (!data.rollIds || data.rollIds.length === 0) {
      throw AppError.badRequest("En az bir top seçmelisiniz");
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
    });
    if (!subcontractor) throw AppError.notFound("Kartela firması bulunamadı");

    const rolls = await prisma.roll.findMany({
      where: { id: { in: data.rollIds } },
      include: {
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
      },
    });
    if (rolls.length !== data.rollIds.length) {
      const foundIds = new Set(rolls.map((r) => r.id));
      const missing = data.rollIds.filter((id) => !foundIds.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // IDEMPOTENCY: offline replay — aynı firma + aynı toplarla açık (kabul edilmemiş)
    // bir sevk varsa onu döndür. WAREHOUSE guard'ından ÖNCE: replay'de toplar zaten
    // AT_KARTELA olduğundan guard'a takılmadan cached sevk dönmeli.
    const openDispatch = await prisma.kartelaDispatch.findFirst({
      where: {
        subcontractorId: data.subcontractorId,
        cancelledAt: null,
        items: {
          some: { rollId: { in: data.rollIds }, receiptItems: { none: {} } },
        },
      },
      include: { items: { select: { rollId: true } } },
    });
    if (openDispatch) {
      const existing = new Set(openDispatch.items.map((i) => i.rollId));
      const incoming = new Set(data.rollIds);
      const sameRolls =
        existing.size === incoming.size &&
        [...existing].every((id) => incoming.has(id));
      if (sameRolls) {
        return {
          success: true,
          data: openDispatch as unknown as Record<string, unknown>,
          message: `Kartela sevki zaten oluşturulmuş (idempotent): ${openDispatch.dispatchNo}`,
        };
      }
    }

    // Sadece depodaki (WAREHOUSE) ve sevkiyata girmemiş bitmiş toplar kartelaya gider.
    for (const r of rolls) {
      if (r.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} kartelaya gönderilemez (durum: ${r.status}). Sadece depodaki bitmiş toplar.`
        );
      }
      if (r.shipmentId) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} bir sevkiyatta — önce sevkiyattan çıkarın.`
        );
      }
    }

    const totalQty = rolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0)
    );

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const seq = await nextKartelaDocSequence(tx, "dispatch", "KD", now);
        const dispatchNo = buildPrefixedCardNumber("KD", now, seq);

        const rollSnapshots = rolls.map((r, idx) => ({
          sequence: idx + 1,
          id: r.id,
          barcode: r.barcode,
          itemCode: r.item?.code ?? "",
          itemName: r.item?.name ?? "",
          colorCode: r.color?.code ?? null,
          colorName: r.color?.name ?? null,
          dispatchedQty: r.currentQty,
          dispatchedWeight: r.weightKg ?? null,
          qualityGrade: r.qualityGrade,
          width: r.width ?? null,
        }));
        const totalWeight = rollSnapshots.reduce(
          (s, r) => s.plus(r.dispatchedWeight ?? 0),
          new Prisma.Decimal(0)
        );

        const printSnapshot = {
          dispatchNo,
          dispatchedAt: now.toISOString(),
          driverName: data.driverName ?? null,
          plateNumber: data.plateNumber ?? null,
          notes: data.notes ?? null,
          subcontractor: {
            id: subcontractor.id,
            name: subcontractor.name,
            code: subcontractor.code ?? null,
          },
          rolls: rollSnapshots,
          totals: {
            rollCount: rollSnapshots.length,
            totalQty,
            totalWeight,
          },
        };

        const dispatch = await tx.kartelaDispatch.create({
          data: {
            dispatchNo,
            subcontractorId: data.subcontractorId,
            plateNumber: data.plateNumber ?? null,
            driverName: data.driverName ?? null,
            dispatchedById: userId ?? null,
            notes: data.notes ?? null,
            totalQty,
            printSnapshot: printSnapshot as Prisma.InputJsonValue,
            items: {
              create: rolls.map((r) => ({
                rollId: r.id,
                dispatchedQty: r.currentQty,
                dispatchedWeight: r.weightKg,
              })),
            },
          },
          include: { items: true, subcontractor: true },
        });

        // ATOMIK SAHİPLENME: toplar hâlâ depoda (WAREHOUSE) VE bir sevkiyata bağlı
        // değilse (shipmentId null) AT_KARTELA'ya çek. Okuma ile yazma arasında
        // biri (sevkiyat okutması / başka kartela sevki) kapmışsa count < beklenen
        // olur → tüm tx geri sarılır (KartelaDispatch da oluşmaz), çift-bağ engellenir.
        const claimed = await tx.roll.updateMany({
          where: {
            id: { in: data.rollIds },
            status: RollStatus.WAREHOUSE,
            shipmentId: null,
          },
          data: { status: RollStatus.AT_KARTELA },
        });
        if (claimed.count !== data.rollIds.length) {
          throw AppError.conflict(
            "Toplardan biri az önce başka bir akışa girdi (sevkiyat/başka kartela sevki) — tekrar deneyin."
          );
        }

        return dispatch;
      })
    );

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "KARTELA_DISPATCH",
      recordId: result.id,
      newData: {
        dispatchNo: result.dispatchNo,
        subcontractorId: data.subcontractorId,
        rollCount: rolls.length,
        totalQty,
      },
    });

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: `Kartela sevki oluşturuldu: ${result.dispatchNo} (${rolls.length} top, ${totalQty.toFixed(1)}m)`,
    };
  }

  // ===========================================================================
  // CANCEL DISPATCH — Sevk iptali (soft cancel)
  // ===========================================================================
  async cancelDispatch(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim();
    if (!trimmed || trimmed.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.kartelaDispatch.findUnique({
      where: { id: dispatchId },
      include: { items: { select: { rollId: true } } },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    if (dispatch.cancelledAt) throw AppError.conflict("Bu sevk zaten iptal edilmiş");

    // Kabul yapılmış sevk iptal edilemez (önce kabulü iptal et).
    const accepted = await prisma.kartelaReceiptItem.findFirst({
      where: {
        sourceDispatchItem: { is: { dispatchId } },
        receipt: { cancelledAt: null },
      },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (accepted?.receipt) {
      throw AppError.conflict(
        `Kabul yapılmış sevk iptal edilemez (kabul: ${accepted.receipt.receiptNo}). Önce kabulü iptal edin.`
      );
    }

    const rollIds = dispatch.items.map((i) => i.rollId);

    // Defansif: toplar hâlâ AT_KARTELA olmalı (kabul/manuel müdahale sonrası taşınmamış).
    const movedRolls = await prisma.roll.findMany({
      where: { id: { in: rollIds }, status: { not: RollStatus.AT_KARTELA } },
      select: { id: true, barcode: true, status: true },
    });
    if (movedRolls.length > 0) {
      throw AppError.conflict(
        `${movedRolls.length} top sevkten sonra taşınmış/statüsü değişmiş — sevk iptal edilemez.`,
        {
          code: "ROLLS_MOVED_PAST_DISPATCH",
          movedRolls,
        }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.kartelaDispatch.update({
        where: { id: dispatchId },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmed,
        },
      });
      await tx.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { status: RollStatus.WAREHOUSE },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KARTELA_DISPATCH",
      recordId: dispatchId,
      newData: {
        cancelled: true,
        cancelReason: trimmed,
        rolledBackRollCount: rollIds.length,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Sevk iptal edildi: ${dispatch.dispatchNo}`,
    };
  }

  // ===========================================================================
  // RECEIVE — Kartela mal kabul (top komple tükenir → N kartela doğar)
  // ===========================================================================
  async receive(
    data: KartelaReceiveInput,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.returns || data.returns.length === 0) {
      throw AppError.badRequest("En az bir dönen top girmelisiniz");
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
    });
    if (!subcontractor) throw AppError.notFound("Kartela firması bulunamadı");

    // Doğrula: adet + ölçüm tutarlılığı
    for (const ret of data.returns) {
      if (!Number.isInteger(ret.count) || ret.count <= 0) {
        throw AppError.badRequest("Her top için kartela adedi pozitif tam sayı olmalı");
      }
      if (ret.items && ret.items.length !== ret.count) {
        throw AppError.badRequest(
          `Tek-tek ölçüm sayısı (${ret.items.length}) kartela adedi (${ret.count}) ile eşleşmeli`
        );
      }
    }

    const rollIds = data.returns.map((r) => r.rollId);
    if (new Set(rollIds).size !== rollIds.length) {
      throw AppError.badRequest("Aynı top birden fazla kez girilemez");
    }

    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
      },
    });
    if (rolls.length !== rollIds.length) {
      const found = new Set(rolls.map((r) => r.id));
      const missing = rollIds.filter((id) => !found.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // IDEMPOTENCY: tüm toplar zaten KARTELA_CONSUMED ise ve tek bir iptal-edilmemiş
    // receipt'e aitse onu döndür (offline replay). Kısmi tüketim = gerçek çakışma.
    const consumed = rolls.filter((r) => r.status === RollStatus.KARTELA_CONSUMED);
    if (consumed.length === rolls.length) {
      const existingItems = await prisma.kartelaReceiptItem.findMany({
        where: {
          consumedRollId: { in: rollIds },
          receipt: { cancelledAt: null },
        },
        select: { receiptId: true, receipt: { select: { receiptNo: true } } },
      });
      const receiptIds = new Set(existingItems.map((i) => i.receiptId));
      if (receiptIds.size === 1) {
        const rec = await prisma.kartelaReceipt.findUnique({
          where: { id: [...receiptIds][0] },
        });
        if (rec) {
          return {
            success: true,
            data: rec,
            message: `Kartela kabulü zaten yapılmış (idempotent): ${rec.receiptNo}`,
          };
        }
      }
      throw AppError.conflict("Bu toplar zaten kartela olarak kabul edilmiş.");
    }

    // Tüm toplar AT_KARTELA olmalı; firma da bu topların açık sevkindeki firma olmalı.
    const dispatchItems = await prisma.kartelaDispatchItem.findMany({
      where: {
        rollId: { in: rollIds },
        dispatch: { cancelledAt: null },
      },
      select: {
        id: true,
        rollId: true,
        dispatch: { select: { id: true, subcontractorId: true } },
      },
    });
    const dispatchItemByRoll = new Map(dispatchItems.map((di) => [di.rollId, di]));

    for (const r of rolls) {
      if (r.status !== RollStatus.AT_KARTELA) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} kabul edilemez (durum: ${r.status}). Sadece kartelada (AT_KARTELA) toplar.`
        );
      }
      const di = dispatchItemByRoll.get(r.id);
      if (!di) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} için açık kartela sevki bulunamadı.`
        );
      }
      if (di.dispatch.subcontractorId !== data.subcontractorId) {
        throw AppError.badRequest(
          `Top ${r.barcode ?? r.id} bu firmaya ait kartela sevkinde değil.`
        );
      }
    }

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const seq = await nextKartelaDocSequence(tx, "receipt", "KR", now);
        const receiptNo = buildPrefixedCardNumber("KR", now, seq);

        const receipt = await tx.kartelaReceipt.create({
          data: {
            receiptNo,
            manifestNo: data.manifestNo ?? null,
            dispatchId: data.dispatchId ?? null,
            subcontractorId: data.subcontractorId,
            receivedById: userId ?? null,
            notes: data.notes ?? null,
          },
        });

        const rollById = new Map(rolls.map((r) => [r.id, r]));

        // Sıra numarasını döngü DIŞINDA bir kez oku; tüm kartelalara bellekte
        // ardışık ata (seq, seq+1, ...). Eski kod her kartela için ayrı
        // nextSwatchSequence taraması + tek-tek create yapıyordu (N+1 + yavaş).
        // P2002 çakışmasında withBarcodeRetry tx'i baştan dener → sıra yeniden okunur.
        let seqCounter = await nextSwatchSequence(tx, now);

        const receiptItemData: Prisma.KartelaReceiptItemCreateManyInput[] = [];
        const swatchData: Prisma.SwatchCreateManyInput[] = [];
        const consumedRollIds: string[] = [];

        for (const ret of data.returns) {
          const roll = rollById.get(ret.rollId)!;
          const di = dispatchItemByRoll.get(ret.rollId)!;

          receiptItemData.push({
            receiptId: receipt.id,
            consumedRollId: roll.id,
            sourceDispatchItemId: di.id,
            kartelaCount: ret.count,
            notes: ret.notes ?? null,
          });
          consumedRollIds.push(roll.id);

          // N adet kartela doğar (bellekte hazırlanır, aşağıda tek createMany).
          for (let i = 0; i < ret.count; i++) {
            const sSeq = seqCounter++;
            const measure = ret.items?.[i];
            swatchData.push({
              cardNumber: buildPrefixedCardNumber("SW", now, sSeq, 6),
              barcode: buildPrefixedBarcode("SW", now, sSeq),
              itemId: roll.itemId,
              colorId: roll.colorId ?? null,
              width: roll.width ?? null,
              length: measure?.lengthCm ?? ret.bulkLengthCm ?? null,
              weightKg: measure?.weightKg ?? ret.bulkWeightKg ?? null,
              parentReceiptId: receipt.id,
              parentRollId: roll.id,
              createdById: userId ?? null,
            });
          }
        }

        // Toplu yazma: tek-tek create yerine createMany / updateMany.
        await tx.kartelaReceiptItem.createMany({ data: receiptItemData });
        await tx.roll.updateMany({
          where: { id: { in: consumedRollIds } },
          data: { status: RollStatus.KARTELA_CONSUMED },
        });
        await tx.swatch.createMany({ data: swatchData });

        return { receipt, totalSwatches: swatchData.length };
      })
    );

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "KARTELA_RECEIPT",
      recordId: result.receipt.id,
      newData: {
        receiptNo: result.receipt.receiptNo,
        subcontractorId: data.subcontractorId,
        consumedRollCount: rolls.length,
        swatchCount: result.totalSwatches,
      },
    });

    return {
      success: true,
      data: result.receipt,
      message: `Kartela kabulü yapıldı: ${result.receipt.receiptNo} (${rolls.length} top → ${result.totalSwatches} kartela)`,
    };
  }

  // ===========================================================================
  // CANCEL RECEIPT — Kabul iptali (doğan kartelalar soft geri alınır)
  // ===========================================================================
  /** İptal önizleme — doğan kartelaların downstream (sevkiyat/çuval) bağ kontrolü. */
  async getReceiptCancelPreview(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id },
      include: {
        swatches: {
          where: { cancelledAt: null },
          select: {
            id: true,
            cardNumber: true,
            barcode: true,
            shipmentId: true,
            sackId: true,
            item: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");

    const swatches = receipt.swatches.map((s) => {
      const blockingReasons: string[] = [];
      if (s.shipmentId) blockingReasons.push("Bir sevkiyatta");
      if (s.sackId) blockingReasons.push("Bir çuvalda");
      return { ...s, blockingReasons, safeToCancel: blockingReasons.length === 0 };
    });

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        cancellable: swatches.every((s) => s.safeToCancel),
        swatches,
      },
    };
  }

  async cancelReceipt(
    receiptId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim();
    if (!trimmed || trimmed.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id: receiptId },
      include: {
        items: { select: { consumedRollId: true } },
        swatches: {
          where: { cancelledAt: null },
          select: { id: true, shipmentId: true, sackId: true, cardNumber: true },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");
    if (receipt.cancelledAt) throw AppError.conflict("Bu kabul zaten iptal edilmiş");

    // Downstream bağlı (sevkiyatta/çuvalda) kartela varsa iptal edilemez.
    const blocked = receipt.swatches.filter((s) => s.shipmentId || s.sackId);
    if (blocked.length > 0) {
      throw AppError.conflict(
        `${blocked.length} kartela sevkiyatta/çuvalda — kabul iptal edilemez. Önce sevkiyattan çıkarın.`,
        {
          code: "SWATCHES_DOWNSTREAM",
          blocked: blocked.map((s) => s.cardNumber),
        }
      );
    }

    const rollIds = receipt.items.map((i) => i.consumedRollId);
    const swatchIds = receipt.swatches.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      // Kabul soft-cancel
      await tx.kartelaReceipt.update({
        where: { id: receiptId },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmed,
        },
      });
      // Doğan kartelalar soft-delete
      if (swatchIds.length > 0) {
        await tx.swatch.updateMany({
          where: { id: { in: swatchIds } },
          data: { cancelledAt: new Date(), cancelReason: trimmed },
        });
      }
      // Tüketilen toplar AT_KARTELA'ya döner (firma hâlâ malı işlemiş sayılır).
      if (rollIds.length > 0) {
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { status: RollStatus.AT_KARTELA },
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KARTELA_RECEIPT",
      recordId: receiptId,
      newData: {
        cancelled: true,
        cancelReason: trimmed,
        revertedRollCount: rollIds.length,
        cancelledSwatchCount: swatchIds.length,
      },
    });

    return {
      success: true,
      data: { id: receiptId, receiptNo: receipt.receiptNo },
      message: `Kabul iptal edildi: ${receipt.receiptNo}`,
    };
  }

  // ===========================================================================
  // LISTS & DETAIL
  // ===========================================================================
  async listDispatches(params?: KartelaListParams): Promise<ListResult> {
    // Filtre: firma + durum + tarih(dispatchedAt) + arama(belge no/firma adı).
    // Tüm filtre kolonları indeksli (@@index dispatchedAt / subcontractorId,dispatchedAt).
    const where: Prisma.KartelaDispatchWhereInput = {};
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;
    // "Kabul edilmiş" = en az bir sevk kalemi, iptal edilmemiş bir kabulde tüketilmiş.
    // (cancelDispatch ile aynı kural — receiptItem.sourceDispatchItem üzerinden.)
    const receivedFilter: Prisma.KartelaDispatchWhereInput = {
      items: { some: { receiptItems: { some: { receipt: { cancelledAt: null } } } } },
    };
    const status = params?.status ?? "active";
    if (status === "active") where.cancelledAt = null;
    else if (status === "cancelled") where.cancelledAt = { not: null };
    else if (status === "open") {
      where.cancelledAt = null;
      where.NOT = receivedFilter;
    } else if (status === "received") {
      where.cancelledAt = null;
      where.items = receivedFilter.items;
    }
    if (params?.dateFrom || params?.dateTo) {
      where.dispatchedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    const search = params?.search?.trim();
    if (search) {
      where.OR = [
        { dispatchNo: { contains: search, mode: "insensitive" } },
        { subcontractor: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Liste için hafif select — detay (`getDispatch`) tam veriyi döner.
    // `receivedProbe`: kabul edilmiş kalem var mı (indeksli, take:1 existence).
    // Mobil kabul dispatchId set etmediği için _count.receipts güvenilmez;
    // "kabul edildi" rozeti bu probe ile hesaplanır (isReceived).
    const select = {
      id: true,
      dispatchNo: true,
      dispatchedAt: true,
      totalQty: true,
      plateNumber: true,
      driverName: true,
      notes: true,
      cancelledAt: true,
      cancelReason: true,
      subcontractor: { select: { id: true, name: true, code: true } },
      dispatchedBy: { select: { id: true, fullName: true } },
      _count: { select: { items: true, receipts: true } },
      // Existence probe: kabul edilmiş kalem var mı (take:1, indeksli).
      items: {
        where: { receiptItems: { some: { receipt: { cancelledAt: null } } } },
        select: { id: true },
        take: 1,
      },
    } as const;

    // Probe array'ini boolean isReceived'a indir, ham relation'ı yanıttan çıkar.
    const withReceived = (r: { items: { id: string }[] }) => {
      const { items: receivedProbe, ...rest } = r;
      return { ...rest, isReceived: receivedProbe.length > 0 };
    };

    // CURSOR mode (admin/useDataTable): keyset by dispatchedAt desc + id desc.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "dispatchedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.kartelaDispatch.findMany({
          where: whereClause,
          select,
          orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.kartelaDispatch.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "dispatchedAt") : null;
      return {
        success: true,
        data: rows.map(withReceived),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (mobil).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const { skip } = buildPagination(page, pageSize);
    const [dispatches, total] = await Promise.all([
      prisma.kartelaDispatch.findMany({
        where,
        select,
        orderBy: { dispatchedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.kartelaDispatch.count({ where }),
    ]);
    return {
      success: true,
      data: dispatches.map(withReceived),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  async getDispatch(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.kartelaDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
        items: {
          include: { roll: { include: { item: true, color: true } } },
        },
        receipts: {
          where: { cancelledAt: null },
          select: { id: true, receiptNo: true, receivedAt: true },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    return { success: true, data: dispatch };
  }

  async listReceipts(params?: KartelaListParams): Promise<ListResult> {
    const where: Prisma.KartelaReceiptWhereInput = {};
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;
    const status = params?.status ?? "active";
    if (status === "active") where.cancelledAt = null;
    else if (status === "cancelled") where.cancelledAt = { not: null };
    if (params?.dateFrom || params?.dateTo) {
      where.receivedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    const search = params?.search?.trim();
    if (search) {
      where.OR = [
        { receiptNo: { contains: search, mode: "insensitive" } },
        { manifestNo: { contains: search, mode: "insensitive" } },
        { subcontractor: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const select = {
      id: true,
      receiptNo: true,
      manifestNo: true,
      receivedAt: true,
      notes: true,
      cancelledAt: true,
      subcontractor: { select: { id: true, name: true, code: true } },
      receivedBy: { select: { id: true, fullName: true } },
      _count: { select: { items: true, swatches: true } },
      // Downstream probe: doğan kartelalardan biri sevkiyatta/çuvalda mı (take:1).
      // Varsa kabul iptal edilemez (cancelReceipt zaten engeller).
      swatches: {
        where: { cancelledAt: null, OR: [{ shipmentId: { not: null } }, { sackId: { not: null } }] },
        select: { id: true },
        take: 1,
      },
    } satisfies Prisma.KartelaReceiptSelect;

    // İptal edilebilir mi: iptal edilmemiş VE hiçbir kartela downstream'de değil.
    const withCancellable = (r: { cancelledAt: Date | null; swatches: { id: string }[] }) => {
      const { swatches: downstreamProbe, ...rest } = r;
      return { ...rest, cancellable: !r.cancelledAt && downstreamProbe.length === 0 };
    };

    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "receivedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.kartelaReceipt.findMany({
          where: whereClause,
          select,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.kartelaReceipt.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "receivedAt") : null;
      return {
        success: true,
        data: rows.map(withCancellable),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 20));
    const { skip } = buildPagination(page, pageSize);
    const [receipts, total] = await Promise.all([
      prisma.kartelaReceipt.findMany({
        where,
        select,
        orderBy: { receivedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.kartelaReceipt.count({ where }),
    ]);
    return {
      success: true,
      data: receipts.map(withCancellable),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.kartelaReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true } },
        receivedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
        items: {
          include: { consumedRoll: { include: { item: true, color: true } } },
        },
        swatches: {
          where: { cancelledAt: null },
          select: {
            id: true,
            cardNumber: true,
            barcode: true,
            length: true,
            width: true,
            weightKg: true,
            parentRollId: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");
    return { success: true, data: receipt };
  }

  // ===========================================================================
  // OUTSTANDING — Kabul worklist'i: firmadaki AT_KARTELA toplar
  // ===========================================================================
  async outstandingRolls(params?: {
    subcontractorId?: string;
  }): Promise<ApiResponse<unknown[]>> {
    const items = await prisma.kartelaDispatchItem.findMany({
      where: {
        dispatch: {
          cancelledAt: null,
          ...(params?.subcontractorId
            ? { subcontractorId: params.subcontractorId }
            : {}),
        },
        roll: { status: RollStatus.AT_KARTELA },
      },
      select: {
        dispatchedQty: true,
        dispatchedWeight: true,
        dispatch: {
          select: {
            id: true,
            dispatchNo: true,
            dispatchedAt: true,
            subcontractor: { select: { id: true, name: true } },
          },
        },
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            weightKg: true,
            qualityGrade: true,
            markedForKartela: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { dispatch: { dispatchedAt: "asc" } },
    });

    return { success: true, data: items };
  }

  // ===========================================================================
  // KARTELALIK işareti — Tambur'da set, depoda toggle (frontend opsiyonel)
  // ===========================================================================
  async setRollMarkedForKartela(
    rollId: string,
    value: boolean,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, markedForKartela: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (roll.markedForKartela === value) {
      return {
        success: true,
        data: { id: rollId, markedForKartela: value },
        message: "Değişiklik yok",
      };
    }

    await prisma.roll.update({
      where: { id: rollId },
      data: { markedForKartela: value },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { markedForKartela: value },
    });

    return {
      success: true,
      data: { id: rollId, markedForKartela: value },
      message: value ? "Top kartelalık işaretlendi" : "Kartelalık işareti kaldırıldı",
    };
  }
}

export const kartelaService = new KartelaService();
