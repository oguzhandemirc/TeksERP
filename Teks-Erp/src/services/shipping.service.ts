// =============================================================================
// Shipping Service — Çuval Havuzu (Sack pool) + Sevkiyat (Shipment)
// =============================================================================
// ÇUVAL HAVUZU MODELİ (top→sipariş bağı YOK; çuval MÜŞTERİYE ait). Akış:
//   1) Müşteriye çuval aç → openSack(customerId)                → Sack (havuzda, açık)
//   2) Topları/kartelaları çuvala okut → scanIntoSack(sackId)   → Roll/Swatch.sackId
//   3) Çuvalı brüt tart + kod gir → weighSack; mühürle → sealSack → sealedAt (havuza girdi)
//      → rebalanceCustomerPool: SackAllocation + OrderLine.packedQty (rezerv görünümü)
//   4) Havuzdan çuval seç → createShipment(sackIds)             → PLANNED (tahsis donar)
//   5) Kapı önü → moveToDoor → AT_DOOR
//   6) Sevk → dispatchShipment → DISPATCHED: toplar SHIPPED, donmuş tahsis → shippedQty.
//   İptal → cancelShipment (PLANNED/AT_DOOR): çuvallar havuza döner, rebalance.
//
// Karşılanma "hangi top hangi siparişe" değil "aynı tür sipariş ↔ aynı tür top" metraj
// toplamıdır (SackAllocation defteri; rebalance FIFO). Çuval İÇERİK tutar (Roll/Swatch.sackId)
// → irsaliyede ürün-bazlı döküm.
// =============================================================================

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  ShipmentDestination,
  PrintedDocType,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import {
  renderShipmentDispatchHtml,
  type ShipmentDispatchDoc,
} from "./document-render/shipment-dispatch.html";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { readShipmentConfirmationEnabled, readSackCodeTemplate } from "./system-setting.service";
import { resolveSackCodePrefix } from "../utils/sack-code-template";
import { rebalanceCustomerPool } from "./helpers/sack-allocation.helper";
import { touchOpenSackTx, touchShipmentPlannedTx } from "./helpers/shipment-locks.helper";
import { D0 } from "./helpers/allocation.helper";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
  buildTurkishSearch,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

// Re-export saf primitifler (geriye uyum — eskiden bu dosyada tanımlıydı).
export {
  specMatch,
  allocate,
  computeLoadedByLine,
  type RollSpec,
  type LineForAlloc,
} from "./helpers/allocation.helper";

// Sevkiyat liste filtreleri (Electron FilterBar + arama).
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier"];
const SHIPMENT_FILTER_FIELDS = ["status", "customerId", "branchId"] as const;
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt"] as const;

// ---------------------------------------------------------------------------
// Sequence helpers — SVK-YYMMDD-NNN (sevkiyat), CV-YYMMDD-NNN (çuval)
// ---------------------------------------------------------------------------
function datePrefix(prefix: string): string {
  const now = new Date();
  return (
    prefix +
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "-"
  );
}

// Günlük sıralı numara — collation-güvenli (gte+startsWith; U+FFFF sentinel glibc'de
// ignorable olduğundan yasak). orderBy createdAt desc + numeric tail → gün içi monotonik.
async function nextShipmentNo(): Promise<string> {
  const prefix = datePrefix("SVK-");
  const last = await prisma.shipment.findFirst({
    where: { shipmentNo: { gte: prefix, startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { shipmentNo: true },
  });
  const seq = last ? parseInt(last.shipmentNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

async function nextSackNo(): Promise<string> {
  const prefix = datePrefix("CV-");
  const last = await prisma.sack.findFirst({
    where: { sackNo: { gte: prefix, startsWith: prefix } },
    orderBy: { createdAt: "desc" },
    select: { sackNo: true },
  });
  const seq = last ? parseInt(last.sackNo.split("-").pop() ?? "0", 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Otomatik çuval kodu (manualCode) üret — SACK_CODE_TEMPLATE'ten (default "AMB{SIRA:5}").
 * GLOBAL sayaç (shipmentId filtresi YOK — havuz modelinde çuvallar sevkiyattan bağımsız).
 * Sabit-genişlik SIRA kuyruğu → collation-güvenli kapalı aralık (gte/lte). tx İÇİNDE çağrılır.
 */
async function generateSackManualCode(
  tx: Prisma.TransactionClient,
  codeGen: { prefix: string; digits: number }
): Promise<string> {
  const { prefix, digits } = codeGen;
  const lo = prefix + "0".repeat(digits);
  const hi = prefix + "9".repeat(digits);
  const rows = await tx.sack.findMany({
    where: { manualCode: { gte: lo, lte: hi } },
    orderBy: { manualCode: "desc" },
    take: 20,
    select: { manualCode: true },
  });
  const exact = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{${digits}}$`);
  const lastExact = rows.map((r) => r.manualCode).find((c): c is string => !!c && exact.test(c));
  const lastNum = lastExact ? parseInt(lastExact.slice(prefix.length), 10) : 0;
  const nextNum = (Number.isFinite(lastNum) ? lastNum : 0) + 1;
  if (nextNum > 10 ** digits - 1) {
    throw AppError.conflict(
      "Çuval kodu sırası doldu — Ayarlar'dan şablondaki {SIRA} hane sayısını artırın"
    );
  }
  return `${prefix}${String(nextNum).padStart(digits, "0")}`;
}

export class ShippingService {
  // =========================================================================
  // ÇUVAL DEPO HAVUZU — çuval aç / okut / tart / mühürle (sevkiyattan bağımsız)
  // =========================================================================

  /**
   * Müşteriye yeni (açık) havuz çuvalı aç. shipmentId NULL, seq NULL, sealedAt NULL.
   * manualCode otomatik (SACK_CODE_TEMPLATE) veya operatör override. İçine top okutulur,
   * tartılır, mühürlenir → havuza girer.
   */
  async openSack(
    data: { customerId: string; branchId?: string | null; weightKg?: number | null; sackNo?: string | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.weightKg != null && !(data.weightKg > 0)) {
      throw AppError.badRequest("Geçerli bir kg girilmeli");
    }
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, code: true, isActive: true },
    });
    if (!customer || !customer.isActive) throw AppError.badRequest("Geçerli bir müşteri seçilmeli");
    let branchId: string | null = null;
    if (data.branchId) {
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, customerId: true, isActive: true },
      });
      if (!branch || !branch.isActive || branch.customerId !== data.customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      branchId = branch.id;
    }

    const code = data.manualCode?.trim() || null; // serbest format override
    const codeTemplate = code ? null : await readSackCodeTemplate();
    const codeGen = codeTemplate
      ? resolveSackCodePrefix(codeTemplate, { now: new Date(), customerCode: customer.code })
      : null;

    const sack = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const sackNo = data.sackNo?.trim() || (await nextSackNo());
        let effectiveCode = code;
        if (!effectiveCode && codeGen) effectiveCode = await generateSackManualCode(tx, codeGen);
        return tx.sack.create({
          data: {
            sackNo,
            customerId: data.customerId,
            branchId,
            shipmentId: null,
            seq: null,
            manualCode: effectiveCode,
            weightKg: data.weightKg != null ? new Prisma.Decimal(data.weightKg) : null,
            ...(data.weightKg != null ? { weighedById: userId ?? null, weighedAt: new Date() } : {}),
          },
          select: { id: true, sackNo: true, manualCode: true, weightKg: true, customerId: true, branchId: true },
        });
      })
    );
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, customerId: data.customerId, branchId, manualCode: sack.manualCode },
    });
    return { success: true, data: sack, message: "Çuval açıldı" };
  }

  /**
   * Barkod okut → top ya da kartelayı AÇIK havuz çuvalına ekle (depodaki serbest mal).
   * Aynı müşterinin başka açık çuvalındaki bir top bu çuvala okutulursa TAŞINIR.
   */
  async scanIntoSack(
    data: { sackId: string; barcode: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, customerId: true, shipmentId: true, sealedAt: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış — içerik değiştirilemez");
    if (sack.sealedAt != null) throw AppError.conflict("Çuval mühürlü — önce mührü açın");

    const code = data.barcode.trim();
    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true, sack: { select: { customerId: true, shipmentId: true, sealedAt: true } } },
    });
    if (roll) {
      // Zaten bu çuvalda
      if (roll.sackId === data.sackId) {
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
      }
      // Başka çuvalda — aynı müşteri + açık havuz çuvalıysa TAŞI; değilse reddet.
      if (roll.sackId) {
        const from = roll.sack;
        if (!from || from.customerId !== sack.customerId || from.shipmentId != null || from.sealedAt != null) {
          throw AppError.conflict("Top başka bir çuvalda (farklı müşteri / mühürlü / sevkiyatta) — taşınamaz");
        }
        const fromSackId = roll.sackId;
        await prisma.$transaction(async (tx) => {
          await touchOpenSackTx(tx, data.sackId);
          const moved = await tx.roll.updateMany({
            where: { id: roll.id, sackId: fromSackId, shipmentId: null },
            data: { sackId: data.sackId },
          });
          if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
          await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]);
        });
        await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode } });
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty }, message: "Top bu çuvala taşındı" };
      }
      // Serbest depo topu — çuvala ekle (atomik claim).
      if (roll.shipmentId) throw AppError.conflict("Top bir sevkiyatta");
      if (roll.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(`Sadece depodaki toplar okutulabilir (bu top: ${roll.status})`);
      }
      await prisma.$transaction(async (tx) => {
        await touchOpenSackTx(tx, data.sackId);
        const claimed = await tx.roll.updateMany({
          where: { id: roll.id, shipmentId: null, sackId: null, status: RollStatus.WAREHOUSE },
          data: { sackId: data.sackId },
        });
        if (claimed.count === 0) throw AppError.conflict("Top az önce başka bir akışa girdi — tekrar deneyin.");
        await this.resetSackWeightsTx(tx, [data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_SCAN", sackId: data.sackId, barcode: roll.barcode } });
      return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId, currentQty: roll.currentQty }, message: "Top çuvala eklendi" };
    }

    // Kartela
    const swatch = await prisma.swatch.findUnique({
      where: { barcode: code },
      select: { id: true, shipmentId: true, sackId: true, barcode: true, cancelledAt: true, sack: { select: { customerId: true, shipmentId: true, sealedAt: true } } },
    });
    if (!swatch) throw AppError.notFound(`Top/kartela bulunamadı: ${code}`);
    if (swatch.cancelledAt) throw AppError.badRequest(`İptal edilmiş kartela okutulamaz: ${swatch.barcode}`);
    if (swatch.sackId === data.sackId) {
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela zaten bu çuvalda" };
    }
    if (swatch.sackId) {
      const from = swatch.sack;
      if (!from || from.customerId !== sack.customerId || from.shipmentId != null || from.sealedAt != null) {
        throw AppError.conflict("Kartela başka bir çuvalda (farklı müşteri / mühürlü / sevkiyatta) — taşınamaz");
      }
      const fromSackId = swatch.sackId;
      await prisma.$transaction(async (tx) => {
        await touchOpenSackTx(tx, data.sackId);
        const moved = await tx.swatch.updateMany({ where: { id: swatch.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
        if (moved.count !== 1) throw AppError.conflict("Kartela bu sırada taşınmış/çıkarılmış — tekrar deneyin");
        await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: swatch.barcode } });
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela bu çuvala taşındı" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela bir sevkiyatta");
    await prisma.$transaction(async (tx) => {
      await touchOpenSackTx(tx, data.sackId);
      const claimed = await tx.swatch.updateMany({ where: { id: swatch.id, shipmentId: null, sackId: null, cancelledAt: null }, data: { sackId: data.sackId } });
      if (claimed.count === 0) throw AppError.conflict("Kartela az önce başka bir akışa girdi — tekrar deneyin.");
      await this.resetSackWeightsTx(tx, [data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_SCAN", sackId: data.sackId, barcode: swatch.barcode } });
    return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

  /**
   * Sevkiyata SEÇEREK kartela ekle (barkodsuz) — açık havuz çuvalına N adet FIFO claim.
   */
  async addKartelaToSack(
    data: { sackId: string; itemId: string; colorId: string | null; count: number },
    userId?: string
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string }>> {
    if (!Number.isInteger(data.count) || data.count < 1) throw AppError.badRequest("Adet pozitif tam sayı olmalı");
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true, sealedAt: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış");
    if (sack.sealedAt != null) throw AppError.conflict("Çuval mühürlü — önce mührü açın");

    const ids = await prisma.$transaction(async (tx) => {
      await touchOpenSackTx(tx, data.sackId);
      const candidates = await tx.swatch.findMany({
        where: { itemId: data.itemId, colorId: data.colorId, shipmentId: null, sackId: null, cancelledAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: data.count,
      });
      if (candidates.length < data.count) {
        throw AppError.conflict(`Yeterli kartela stoğu yok — istenen ${data.count}, mevcut ${candidates.length}. Listeyi yenileyin.`);
      }
      const claimIds = candidates.map((c) => c.id);
      const claimed = await tx.swatch.updateMany({ where: { id: { in: claimIds }, shipmentId: null, sackId: null, cancelledAt: null }, data: { sackId: data.sackId } });
      if (claimed.count !== data.count) throw AppError.conflict("Kartelalardan biri az önce başka bir akışa girdi — tekrar deneyin.");
      await this.resetSackWeightsTx(tx, [data.sackId]);
      return claimIds;
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: ids[0], newData: { kind: "KARTELA_SELECT_ADD", sackId: data.sackId, itemId: data.itemId, colorId: data.colorId, count: data.count } });
    return { success: true, data: { added: ids.length, swatchIds: ids, sackId: data.sackId }, message: "Kartela çuvala eklendi" };
  }

  /** Topu açık çuvaldan çıkar → serbest depoya döner (sackId null). */
  async removeRollFromSack(
    data: { rollId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true, sealedAt: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || (roll.sack && (roll.sack.shipmentId != null || roll.sack.sealedAt != null))) {
      throw AppError.conflict("Top mühürlü/sevkiyattaki çuvalda — önce mührü açın / sevkiyattan çıkarın");
    }
    const sackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchOpenSackTx(tx, sackId);
      const removed = await tx.roll.updateMany({ where: { id: data.rollId, sackId, shipmentId: null }, data: { sackId: null } });
      if (removed.count !== 1) throw AppError.conflict("Top bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.resetSackWeightsTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: data.rollId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Top çuvaldan çıkarıldı (depoya döndü)" };
  }

  /** Kartelayı açık çuvaldan çıkar. */
  async removeSwatchFromSack(
    data: { swatchId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const swatch = await prisma.swatch.findUnique({
      where: { id: data.swatchId },
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true, sealedAt: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!swatch.sackId) throw AppError.badRequest("Kartela bir çuvalda değil");
    if (swatch.shipmentId != null || (swatch.sack && (swatch.sack.shipmentId != null || swatch.sack.sealedAt != null))) {
      throw AppError.conflict("Kartela mühürlü/sevkiyattaki çuvalda — önce mührü açın / sevkiyattan çıkarın");
    }
    const sackId = swatch.sackId;
    await prisma.$transaction(async (tx) => {
      await touchOpenSackTx(tx, sackId);
      const removed = await tx.swatch.updateMany({ where: { id: data.swatchId, sackId, shipmentId: null }, data: { sackId: null } });
      if (removed.count !== 1) throw AppError.conflict("Kartela bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.resetSackWeightsTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: data.swatchId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Kartela çuvaldan çıkarıldı" };
  }

  /** Topu bir açık çuvaldan diğerine taşı (aynı müşteri). */
  async moveRollToSack(
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, barcode: true, sackId: true, shipmentId: true, sack: { select: { customerId: true, shipmentId: true, sealedAt: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId || !roll.sack) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || roll.sack.shipmentId != null || roll.sack.sealedAt != null) {
      throw AppError.conflict("Kaynak çuval mühürlü/sevkiyatta — önce mührü açın");
    }
    if (roll.sackId === data.sackId) {
      return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
    }
    const target = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, customerId: true, shipmentId: true, sealedAt: true } });
    if (!target) throw AppError.notFound("Hedef çuval bulunamadı");
    if (target.customerId !== roll.sack.customerId) throw AppError.badRequest("Hedef çuval farklı müşteriye ait");
    if (target.shipmentId != null || target.sealedAt != null) throw AppError.conflict("Hedef çuval mühürlü/sevkiyatta");
    const fromSackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchOpenSackTx(tx, fromSackId);
      await touchOpenSackTx(tx, data.sackId);
      const moved = await tx.roll.updateMany({ where: { id: roll.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
      if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
      await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode } });
    return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top taşındı" };
  }

  /**
   * Çuval brüt tartısını ve/veya kodunu güncelle (açık VEYA mühürlü havuz çuvalı — sevkiyata
   * atanmamış). Mühürlü çuvalda tartı/kod düzeltmesi karşılanmayı değiştirmez → güvenli.
   */
  async weighSack(
    data: { sackId: string; weightKg?: number | null; manualCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    const hasCode = data.manualCode !== undefined;
    if (!hasWeight && !hasCode) throw AppError.badRequest("Tartı veya çuval kodu girilmeli");
    if (hasWeight && !(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    const sack = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuvalın tartısı değiştirilemez");

    const update: Prisma.SackUpdateInput = {};
    if (hasWeight) {
      update.weightKg = new Prisma.Decimal(data.weightKg!);
      update.weighedBy = userId ? { connect: { id: userId } } : { disconnect: true };
      update.weighedAt = new Date();
    }
    let codeForLog: string | null | undefined;
    if (hasCode) {
      const code = data.manualCode?.trim() || null;
      update.manualCode = code;
      codeForLog = code;
    }
    try {
      await prisma.sack.update({ where: { id: data.sackId }, data: update });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw AppError.conflict("Bu çuval kodu başka bir çuvalda kullanılıyor");
      }
      throw e;
    }
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "WEIGH", ...(hasWeight ? { weightKg: data.weightKg } : {}), ...(hasCode ? { manualCode: codeForLog } : {}) } });
    return { success: true, data: {}, message: "Çuval güncellendi" };
  }

  /**
   * Çuvalı MÜHÜRLE → çuval depo havuzuna girer. Non-empty + manualCode zorunlu. Mühür
   * sonrası rebalance: içerik açık siparişlere FIFO tahsis (packedQty rezervi).
   */
  async sealSack(data: { sackId: string }, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, customerId: true, shipmentId: true, sealedAt: true, manualCode: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış");
    if (sack.sealedAt != null) return { success: true, data: { sackId: sack.id }, message: "Çuval zaten mühürlü" };
    if (sack._count.rolls === 0 && sack._count.swatches === 0) throw AppError.badRequest("Boş çuval mühürlenemez — önce top/kartela okut");
    if (!sack.manualCode || !sack.manualCode.trim()) throw AppError.badRequest("Çuval kodu girilmeden mühürlenemez");

    await prisma.$transaction(async (tx) => {
      const claim = await tx.sack.updateMany({
        where: { id: data.sackId, shipmentId: null, sealedAt: null },
        data: { sealedAt: new Date(), sealedById: userId ?? null },
      });
      if (claim.count === 0) throw AppError.conflict("Çuval bu sırada mühürlendi/atandı — yenileyin");
      await rebalanceCustomerPool(tx, sack.customerId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "SEAL" } });
    return { success: true, data: { sackId: sack.id }, message: "Çuval mühürlendi — çuval depo havuzunda" };
  }

  /** Mührü aç (havuz çuvalı) — içerik düzeltmek için. rebalance: rezerv geri alınır. */
  async reopenSack(data: { sackId: string }, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, customerId: true, shipmentId: true, sealedAt: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuvalın mührü açılamaz — önce sevkiyattan çıkarın");
    if (sack.sealedAt == null) return { success: true, data: { sackId: sack.id }, message: "Çuval zaten açık" };
    await prisma.$transaction(async (tx) => {
      const claim = await tx.sack.updateMany({
        where: { id: data.sackId, shipmentId: null, sealedAt: { not: null } },
        data: { sealedAt: null, sealedById: null, weightKg: null, weighedById: null, weighedAt: null },
      });
      if (claim.count === 0) throw AppError.conflict("Çuval durumu değişti — yenileyin");
      await rebalanceCustomerPool(tx, sack.customerId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "REOPEN" } });
    return { success: true, data: { sackId: sack.id }, message: "Çuval mührü açıldı — düzenlenebilir" };
  }

  /**
   * Havuz çuvalını sil. Sevkiyata atanmış çuval silinemez (önce sevkiyattan çıkar). Boş
   * çuval doğrudan; dolu çuval `withContents=true` ile içerik depoya döner. Mühürlüyse
   * tahsis temizlenir + rebalance.
   */
  async removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, customerId: true, shipmentId: true, sealedAt: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuval silinemez — önce sevkiyattan çıkarın");

    const hasContents = sack._count.rolls > 0 || sack._count.swatches > 0;
    if (hasContents && !withContents) {
      throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
    }
    const wasSealed = sack.sealedAt != null;

    const rolls = hasContents ? await prisma.roll.findMany({ where: { sackId }, select: { id: true, barcode: true } }) : [];
    await prisma.$transaction(async (tx) => {
      if (hasContents) {
        await tx.roll.updateMany({ where: { sackId }, data: { sackId: null } });
        await tx.swatch.updateMany({ where: { sackId }, data: { sackId: null } });
      }
      // Mühürlü çuvalın tahsisleri (Restrict FK) — silmeden önce temizle.
      if (wasSealed) await tx.sackAllocation.deleteMany({ where: { sackId } });
      await tx.sack.delete({ where: { id: sackId } });
      if (wasSealed) await rebalanceCustomerPool(tx, sack.customerId);
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNo: sack.sackNo, ...(hasContents ? { kind: "SACK_REMOVE_WITH_CONTENTS", returnedRolls: rolls.map((r) => r.barcode ?? r.id), rollCount: sack._count.rolls, swatchCount: sack._count.swatches } : {}) },
    });
    const n = sack._count.rolls + sack._count.swatches;
    return { success: true, data: { returnedToWarehouse: n }, message: n > 0 ? `Çuval silindi — ${n} top/kartela depoya döndü` : "Çuval silindi" };
  }

  /**
   * İçeriği değişen çuvalların brüt tartısını sıfırla — tartıdan sonra içerik değişirse
   * eski kg bayatlar. (Açık çuvallarda; mühürleme sonrası yeniden tartı istenir.)
   */
  private async resetSackWeightsTx(
    tx: Prisma.TransactionClient,
    sackIds: (string | null | undefined)[]
  ): Promise<void> {
    const ids = [...new Set(sackIds.filter((s): s is string => !!s))];
    if (ids.length === 0) return;
    await tx.sack.updateMany({
      where: { id: { in: ids }, weightKg: { not: null } },
      data: { weightKg: null, weighedById: null, weighedAt: null },
    });
  }

  // =========================================================================
  // HAVUZ GÖRÜNÜMÜ — müşteri-gruplu board
  // =========================================================================

  /**
   * Çuval depo havuzu board'u — müşteri bazlı özet (mühürlü/açık çuval sayısı, kg, metraj).
   * Yalnız havuzdaki (shipmentId NULL) çuvallar. Sevkiyata hazır mühürlü çuvalları gösterir.
   */
  async listPool(params: { customerId?: string; search?: string }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SackWhereInput = { shipmentId: null };
    if (params.customerId) where.customerId = params.customerId;
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTurkishSearch<Prisma.SackWhereInput>(search, ["customer.name", "customer.code", "sackNo", "manualCode"]);
    }
    const sacks = await prisma.sack.findMany({
      where,
      take: 2000,
      select: {
        id: true,
        customerId: true,
        sealedAt: true,
        weightKg: true,
        customer: { select: { id: true, code: true, name: true } },
      },
    });
    if (sacks.length === 0) return { success: true, data: [] };

    // Roll metrajı çuval bazında (havuz kapsamı) — sackId → toplam.
    const rollAgg = await prisma.roll.groupBy({
      by: ["sackId"],
      where: { sackId: { in: sacks.map((s) => s.id) }, status: RollStatus.WAREHOUSE },
      _sum: { currentQty: true },
      _count: { _all: true },
    });
    const rollBySack = new Map(rollAgg.map((g) => [g.sackId, g]));

    const byCustomer = new Map<string, {
      customer: { id: string; code: string; name: string };
      sealedSacks: number;
      openSacks: number;
      totalKg: Prisma.Decimal;
      totalMeters: Prisma.Decimal;
      rollCount: number;
    }>();
    for (const s of sacks) {
      let e = byCustomer.get(s.customerId);
      if (!e) {
        e = { customer: s.customer, sealedSacks: 0, openSacks: 0, totalKg: D0(), totalMeters: D0(), rollCount: 0 };
        byCustomer.set(s.customerId, e);
      }
      if (s.sealedAt) e.sealedSacks += 1;
      else e.openSacks += 1;
      if (s.weightKg) e.totalKg = e.totalKg.plus(s.weightKg);
      const ra = rollBySack.get(s.id);
      if (ra) {
        e.totalMeters = e.totalMeters.plus(ra._sum.currentQty ?? 0);
        e.rollCount += ra._count._all;
      }
    }
    const data = [...byCustomer.values()].map((e) => ({
      customer: e.customer,
      sealedSacks: e.sealedSacks,
      openSacks: e.openSacks,
      totalKg: Number(e.totalKg),
      totalMeters: Number(e.totalMeters),
      rollCount: e.rollCount,
    }));
    data.sort((a, b) => b.sealedSacks - a.sealedSacks || a.customer.name.localeCompare(b.customer.name, "tr"));
    return { success: true, data };
  }

  /**
   * Bir müşterinin havuz çuvalları (açık + mühürlü, sevkiyata atanmamış) — içerikleriyle.
   * Paketleme workspace'inin canlı kaynağı (çuval aç/okut/mühürle).
   */
  async listCustomerPoolSacks(customerId: string): Promise<ApiResponse<unknown>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    const sacks = await prisma.sack.findMany({
      where: { customerId, shipmentId: null },
      orderBy: [{ sealedAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: {
        id: true, sackNo: true, manualCode: true, weightKg: true, sealedAt: true, branchId: true,
        branch: { select: { id: true, name: true } },
        rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, width: true, currentQty: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true, hex: true } } } },
        swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
      },
    });
    const data = sacks.map((sk) => {
      const totalQty = sk.rolls.reduce((s, r) => s.plus(r.currentQty), D0());
      return {
        id: sk.id, sackNo: sk.sackNo, manualCode: sk.manualCode, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        sealed: sk.sealedAt != null, branch: sk.branch,
        rollCount: sk.rolls.length, swatchCount: sk.swatches.length, totalQty: Number(totalQty),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, width: r.width != null ? Number(r.width) : null, currentQty: Number(r.currentQty), item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });
    return { success: true, data: { customer, sacks: data } };
  }

  // =========================================================================
  // SEVKİYAT — havuzdan çuval seçerek kur + yaşam döngüsü
  // =========================================================================

  /** Sevkiyat kurulumundan ÖNCE seçilen çuvalları doğrula (pre-tx erken 4xx). */
  private async loadSacksForShipment(sackIds: string[]) {
    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, customerId: true, branchId: true, shipmentId: true, sealedAt: true, weightKg: true, manualCode: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (sacks.length !== sackIds.length) throw AppError.notFound("Bazı çuvallar bulunamadı");
    for (const s of sacks) {
      if (s.shipmentId != null) throw AppError.conflict("Çuvallardan biri zaten bir sevkiyatta");
      if (s.sealedAt == null) throw AppError.badRequest("Sevkiyata yalnız mühürlü çuvallar eklenebilir");
      if (s._count.rolls === 0 && s._count.swatches === 0) throw AppError.badRequest("Boş çuval sevk edilemez");
    }
    const customerId = sacks[0].customerId;
    const branchId = sacks[0].branchId ?? null;
    if (sacks.some((s) => s.customerId !== customerId || (s.branchId ?? null) !== branchId)) {
      throw AppError.badRequest("Tek sevkiyat = tek müşteri + tek şube. Seçilen çuvallar aynı müşteri/şubeye ait olmalı.");
    }
    return { sacks, customerId, branchId };
  }

  private assertExportWeighed(
    sacks: { weightKg: Prisma.Decimal | null; manualCode: string | null }[],
    destination: ShipmentDestination
  ): void {
    if (destination !== ShipmentDestination.EXPORT) return;
    const unweighed = sacks.filter((s) => s.weightKg == null || !new Prisma.Decimal(s.weightKg).greaterThan(0));
    if (unweighed.length > 0) throw AppError.badRequest("Yurtdışı sevkte tüm çuvallar tartılı olmalı");
  }

  /** Sevkiyatın donmuş tahsislerinden ShipmentOrder denorm'unu (yeniden) türet. */
  private async deriveShipmentOrdersTx(tx: Prisma.TransactionClient, shipmentId: string): Promise<void> {
    const allocs = await tx.sackAllocation.findMany({
      where: { sack: { shipmentId } },
      select: { orderLine: { select: { orderId: true } } },
    });
    const orderIds = [...new Set(allocs.map((a) => a.orderLine.orderId))];
    await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
    if (orderIds.length > 0) {
      await tx.shipmentOrder.createMany({ data: orderIds.map((orderId) => ({ shipmentId, orderId, isActive: true })), skipDuplicates: true });
    }
  }

  /**
   * Havuzdan seçilen mühürlü çuvallarla yeni sevkiyat kur (PLANNED). Çuvallar sevkiyata
   * atanır (shipmentId + seq), içerik roll/swatch shipmentId'si açıkça yazılır, çuvalların
   * donmuş tahsisleri sipariş kümesini (ShipmentOrder) belirler. rebalance: kalan havuz.
   */
  async createShipment(
    data: { sackIds: string[]; destination?: ShipmentDestination; procedureCode?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    const { sacks, customerId, branchId } = await this.loadSacksForShipment(sackIds);
    const destination = data.destination ?? ShipmentDestination.DOMESTIC;
    this.assertExportWeighed(sacks, destination);

    const shipment = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const shipmentNo = await nextShipmentNo();
        const created = await tx.shipment.create({
          data: { shipmentNo, customerId, branchId, status: ShipmentStatus.PLANNED, destination, procedureCode: data.procedureCode?.trim() || null },
          select: { id: true, shipmentNo: true, status: true, destination: true },
        });
        // Atomik claim + seq ata.
        for (let i = 0; i < sackIds.length; i++) {
          const claimed = await tx.sack.updateMany({
            where: { id: sackIds[i], shipmentId: null, sealedAt: { not: null } },
            data: { shipmentId: created.id, seq: i + 1 },
          });
          if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        }
        // İçerik shipmentId açıkça (composite FK deferred → commit'te doğrulanır).
        await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId: created.id } });
        await tx.swatch.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId: created.id } });
        // Donmuş tahsislerden sipariş kümesini türet + kalan havuzu yeniden dengele.
        await this.deriveShipmentOrdersTx(tx, created.id);
        await rebalanceCustomerPool(tx, customerId);
        return created;
      })
    );
    await AuditService.log({ userId, action: "CREATE", tableName: "SHIPMENT", recordId: shipment.id, newData: { shipmentNo: shipment.shipmentNo, customerId, branchId, sackIds, destination: shipment.destination } });
    return { success: true, data: shipment, message: `Sevkiyat kuruldu: ${shipment.shipmentNo}` };
  }

  /**
   * Sevkiyat kurulum ÖNİZLEMESİ (salt-okunur): seçilen çuvalların içerik dökümü + sipariş
   * bazında donacak tahsisler. DB'ye hiçbir şey yazmaz.
   */
  async previewCreateShipment(data: { sackIds: string[] }): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) return { success: true, data: { sacks: [], orders: [], totals: { totalMeters: 0, sackCount: 0 } } };
    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: {
        id: true, sackNo: true, manualCode: true, weightKg: true, customerId: true,
        rolls: { select: { currentQty: true, width: true, item: { select: { name: true } }, color: { select: { name: true } } } },
        allocations: { select: { qty: true, orderLine: { select: { order: { select: { id: true, orderNumber: true } } } } } },
      },
    });
    const byOrder = new Map<string, { orderNumber: string; qty: Prisma.Decimal }>();
    for (const s of sacks) {
      for (const a of s.allocations) {
        const ord = a.orderLine.order;
        const e = byOrder.get(ord.id) ?? { orderNumber: ord.orderNumber, qty: D0() };
        e.qty = e.qty.plus(a.qty);
        byOrder.set(ord.id, e);
      }
    }
    let totalMeters = D0();
    const sackRows = sacks.map((s) => {
      let m = D0();
      for (const r of s.rolls) m = m.plus(r.currentQty);
      totalMeters = totalMeters.plus(m);
      return { id: s.id, sackNo: s.sackNo, manualCode: s.manualCode, weightKg: s.weightKg != null ? Number(s.weightKg) : null, rollCount: s.rolls.length, totalMeters: Number(m) };
    });
    return {
      success: true,
      data: {
        sacks: sackRows,
        orders: [...byOrder.values()].map((o) => ({ orderNumber: o.orderNumber, qty: Number(o.qty) })),
        totals: { totalMeters: Number(totalMeters), sackCount: sacks.length },
      },
    };
  }

  /** PLANNED sevkiyata havuzdan çuval(lar) ekle. */
  async addSacksToShipment(shipmentId: string, sackIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(sackIdsIn)];
    if (sackIds.length === 0) throw AppError.badRequest("Çuval seçilmeli");
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyata çuval eklenebilir");
    const { sacks, customerId, branchId } = await this.loadSacksForShipment(sackIds);
    if (customerId !== shipment.customerId || branchId !== (shipment.branchId ?? null)) {
      throw AppError.badRequest("Çuvallar sevkiyatın müşteri/şubesine ait değil");
    }
    this.assertExportWeighed(sacks, shipment.destination);

    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const maxSeqRow = await tx.sack.findFirst({ where: { shipmentId }, orderBy: { seq: "desc" }, select: { seq: true } });
      let seq = (maxSeqRow?.seq ?? 0) + 1;
      for (const sackId of sackIds) {
        const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId: null, sealedAt: { not: null } }, data: { shipmentId, seq } });
        if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        seq += 1;
      }
      await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      await tx.swatch.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      await this.deriveShipmentOrdersTx(tx, shipmentId);
      await rebalanceCustomerPool(tx, shipment.customerId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "ADD_SACKS", sackIds } });
    return { success: true, data: {}, message: "Çuval(lar) sevkiyata eklendi" };
  }

  /** PLANNED sevkiyattan çuval çıkar → havuza döner (mühürlü kalır). */
  async removeSackFromShipment(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true, shipmentId: true, customerId: true, shipment: { select: { status: true } } } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== shipmentId) throw AppError.badRequest("Çuval bu sevkiyatta değil");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyattan çuval çıkarılabilir");
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId }, data: { shipmentId: null, seq: null } });
      if (claimed.count !== 1) throw AppError.conflict("Çuval bu sırada çıkarıldı — yenileyin");
      await tx.roll.updateMany({ where: { sackId }, data: { shipmentId: null } });
      await tx.swatch.updateMany({ where: { sackId }, data: { shipmentId: null } });
      await this.deriveShipmentOrdersTx(tx, shipmentId);
      await rebalanceCustomerPool(tx, sack.customerId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "REMOVE_SACK", sackId } });
    return { success: true, data: {}, message: "Çuval sevkiyattan çıkarıldı (havuza döndü)" };
  }

  /** Yurtiçi/yurtdışı kapsamını değiştir (PLANNED). */
  async setDestination(shipmentId: string, destination: ShipmentDestination, userId?: string): Promise<ApiResponse<unknown>> {
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.shipment.update({ where: { id: shipmentId }, data: { destination } });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DESTINATION", destination } });
    return { success: true, data: { shipmentId, destination }, message: destination === ShipmentDestination.EXPORT ? "Yurtdışı sevk olarak işaretlendi" : "Yurtiçi sevk olarak işaretlendi" };
  }

  /** Prosedür/ihracat kodu güncelle (PLANNED). */
  async setProcedureCode(shipmentId: string, procedureCode: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const code = procedureCode?.trim() || null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.shipment.update({ where: { id: shipmentId }, data: { procedureCode: code } });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "PROCEDURE_CODE", procedureCode: code } });
    return { success: true, data: { shipmentId, procedureCode: code }, message: "Prosedür kodu güncellendi" };
  }

  /** Kapı Önüne Koy (PLANNED → AT_DOOR). Tahsis zaten donmuş (packedQty) — commit yok. */
  async moveToDoor(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, destination: true, sacks: { select: { weightKg: true, manualCode: true } } } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.AT_DOOR) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten kapı önünde" };
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyat kapı önüne konabilir");
    this.assertExportWeighed(shipment.sacks, shipment.destination);
    const claim = await prisma.shipment.updateMany({ where: { id: shipmentId, status: ShipmentStatus.PLANNED }, data: { status: ShipmentStatus.AT_DOOR } });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "AT_DOOR", from: "PLANNED" } });
    return { success: true, data: { shipmentId }, message: "Kapı önüne kondu — kamyon/'Alındı' onayı bekliyor" };
  }

  /** Kapı önünden geri çek (AT_DOOR → PLANNED). */
  async pullBackFromDoor(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.PLANNED) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten planlı" };
    if (shipment.status !== ShipmentStatus.AT_DOOR) throw AppError.conflict("Yalnız kapı önündeki sevkiyat geri çekilir");
    const claim = await prisma.shipment.updateMany({ where: { id: shipmentId, status: ShipmentStatus.AT_DOOR }, data: { status: ShipmentStatus.PLANNED } });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "PULL_BACK_FROM_DOOR", from: "AT_DOOR", to: "PLANNED" } });
    return { success: true, data: { shipmentId }, message: "Kapı önünden geri çekildi" };
  }

  /**
   * Sevk / Alındı (fiziksel çıkış) — toplar SHIPPED, donmuş tahsis → shippedQty (terfi).
   * Sevk onayı bayrağı (shipmentConfirmationEnabled):
   *  - KAPALI: PLANNED/AT_DOOR → DISPATCHED.
   *  - AÇIK: yalnız AT_DOOR → DISPATCHED.
   */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const confirmRequired = await readShipmentConfirmationEnabled();
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, destination: true, customerId: true, sacks: { select: { weightKg: true, manualCode: true } }, _count: { select: { rolls: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevkiyat zaten sevk edilmiş");
    if (confirmRequired) {
      if (shipment.status !== ShipmentStatus.AT_DOOR) throw AppError.conflict("Sevk onayı açık — önce 'Kapı Önüne Koy'; çıkış onayı kapı önünden verilir");
    } else if (shipment.status !== ShipmentStatus.PLANNED && shipment.status !== ShipmentStatus.AT_DOOR) {
      throw AppError.conflict("Yalnız planlanan veya kapı önündeki sevkiyat sevk edilebilir");
    }
    if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
    this.assertExportWeighed(shipment.sacks, shipment.destination);

    let shippedRolls = 0;
    await prisma.$transaction(async (tx) => {
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: shipment.status },
        data: {
          status: ShipmentStatus.DISPATCHED,
          dispatchedAt: new Date(),
          dispatchedById: userId ?? null,
          ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
          ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
          ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
        },
      });
      if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
      const flipped = await tx.roll.updateMany({ where: { shipmentId, status: RollStatus.WAREHOUSE }, data: { status: RollStatus.SHIPPED } });
      shippedRolls = flipped.count;
      // Donmuş tahsis → shippedQty (recompute), kalan havuz yeniden dengelenir.
      await rebalanceCustomerPool(tx, shipment.customerId);
      // Resmi belge — sevk irsaliyesi v1 burada donar.
      await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH", fromStatus: shipment.status, rollCount: shippedRolls, plateNumber: data.plateNumber ?? null, driverName: data.driverName ?? null } });
    return { success: true, data: { shipmentId, rollCount: shippedRolls }, message: "Sevk edildi — stok bina dışı, karşılanma kesinleşti" };
  }

  // =========================================================================
  // İPTAL (yıkıcı) — önizleme + uygula
  // =========================================================================

  /** İptal önizleme — havuza dönecek çuvallar + rezervi geri alınacak siparişler. */
  async getCancelPreview(shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        _count: { select: { sacks: true, rolls: true, swatches: true } },
        sacks: { select: { allocations: { select: { qty: true, orderLine: { select: { order: { select: { orderNumber: true } } } } } } } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    const canCancel = shipment.status !== ShipmentStatus.DISPATCHED && shipment.status !== ShipmentStatus.CANCELLED;
    const byOrder = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        const ord = a.orderLine.order.orderNumber;
        byOrder.set(ord, (byOrder.get(ord) ?? D0()).plus(a.qty));
      }
    }
    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        canCancel,
        reason: canCancel ? null : "Sevk edilmiş veya iptal edilmiş sevkiyat iptal edilemez.",
        sackCount: shipment._count.sacks,
        rollCount: shipment._count.rolls,
        swatchCount: shipment._count.swatches,
        affectedOrders: [...byOrder.entries()].map(([orderNumber, qty]) => ({ orderNumber, qty: qty.toString() })),
      },
    };
  }

  /**
   * Sevkiyatı iptal et (soft → CANCELLED). PLANNED/AT_DOOR iptal edilebilir: çuvallar havuza
   * döner (mühürlü), donmuş tahsis rebalance ile rezerve çevrilir. DISPATCHED iptal edilemez.
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, _count: { select: { sacks: true } } } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");

    await prisma.$transaction(async (tx) => {
      const claim = await tx.shipment.updateMany({ where: { id: shipmentId, status: shipment.status }, data: { status: ShipmentStatus.CANCELLED } });
      if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
      // Çuvallar havuza döner (mühürlü kalır); içerik shipmentId null.
      await tx.roll.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
      await tx.swatch.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
      await tx.sack.updateMany({ where: { shipmentId }, data: { shipmentId: null, seq: null } });
      // Donmuş tahsisler artık havuz tahsisi → rebalance sil-yazar + recompute.
      await rebalanceCustomerPool(tx, shipment.customerId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "CANCEL", freedSacks: shipment._count.sacks } });
    return { success: true, data: { shipmentId, freedSacks: shipment._count.sacks }, message: "Sevkiyat iptal edildi — çuvallar havuza döndü" };
  }

  // =========================================================================
  // LİSTE / DETAY
  // =========================================================================

  async listShipments(req: Request): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    const safeFilters: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(params.filters)) {
      if ((SHIPMENT_FILTER_FIELDS as readonly string[]).includes(k)) safeFilters[k] = v;
    }
    const where = buildWhereClause(safeFilters, SHIPMENT_SEARCH_FIELDS, params.search) as Prisma.ShipmentWhereInput;
    applyDateRange(where as Record<string, unknown>, params, SHIPMENT_DATE_FIELDS);

    const rawStatus = req.query.status as string | undefined;
    if (rawStatus && Object.values(ShipmentStatus).includes(rawStatus as ShipmentStatus)) {
      where.status = rawStatus as ShipmentStatus;
    }
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;

    const select = {
      id: true,
      shipmentNo: true,
      status: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      dispatchedAt: true,
      createdAt: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, name: true } },
      _count: { select: { sacks: true, rolls: true, orders: true, returns: { where: { cancelledAt: null } } } },
    } as const;

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhere = cursor ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] } : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.shipment.findMany({ where: cursorWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select }),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const dataRows = hasMore ? items.slice(0, limit) : items;
      const last = dataRows[dataRows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      return { success: true, data: dataRows, pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) } };
    }

    const shipments = await prisma.shipment.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, select });
    return { success: true, data: shipments };
  }

  /** Sevkiyat detayı — çuvallar + toplar + sipariş bazlı bu-sevkiyat tahsis dökümü. */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true, shipmentNo: true, status: true, destination: true, procedureCode: true,
        plateNumber: true, driverName: true, carrier: true, dispatchedAt: true, createdAt: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, packedQty: true,
                    customerItemName: true, customerColorName: true, createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: { select: { id: true, barcode: true, itemId: true, colorId: true, width: true, currentQty: true, sackId: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, manualCode: true, weightKg: true,
            rolls: { select: { id: true, barcode: true, width: true, currentQty: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
            swatches: { select: { id: true, barcode: true, length: true, width: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
            allocations: { select: { orderLineId: true, qty: true } },
          },
        },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");

    // Bu sevkiyatın satır bazlı tahsisi (çuval tahsislerinin toplamı).
    const thisShipmentByLine = new Map<string, Prisma.Decimal>();
    for (const sk of shipment.sacks) {
      for (const a of sk.allocations) {
        thisShipmentByLine.set(a.orderLineId, (thisShipmentByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      }
    }

    const orders = shipment.orders.map((so) => ({
      id: so.order.id,
      orderNumber: so.order.orderNumber,
      status: so.order.status,
      deadline: so.order.deadline,
      lines: so.order.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const packed = new Prisma.Decimal(l.packedQty);
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped,
          packed,
          openQty: requested.minus(shipped).minus(packed),
          thisShipment: thisShipmentByLine.get(l.id) ?? D0(),
        };
      }),
    }));

    const totalMeters = shipment.rolls.reduce((s, r) => s.plus(r.currentQty), D0());
    const totalKg = shipment.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0());

    const sacks = shipment.sacks.map((sk) => {
      const summaryMap = new Map<string, { itemCode: string; itemName: string; colorCode: string | null; colorName: string | null; width: Prisma.Decimal | null; totalQty: Prisma.Decimal; rollCount: number }>();
      for (const r of sk.rolls) {
        const key = `${r.item.code}|${r.color?.code ?? ""}|${r.width == null ? "" : new Prisma.Decimal(r.width).toString()}`;
        let e = summaryMap.get(key);
        if (!e) {
          e = { itemCode: r.item.code, itemName: r.item.name, colorCode: r.color?.code ?? null, colorName: r.color?.name ?? null, width: r.width, totalQty: D0(), rollCount: 0 };
          summaryMap.set(key, e);
        }
        e.totalQty = e.totalQty.plus(r.currentQty);
        e.rollCount += 1;
      }
      return { id: sk.id, sackNo: sk.sackNo, seq: sk.seq, manualCode: sk.manualCode, weightKg: sk.weightKg, rolls: sk.rolls, swatches: sk.swatches, productSummary: [...summaryMap.values()], rollCount: sk.rolls.length, swatchCount: sk.swatches.length };
    });

    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, qty: true, width: true, createdAt: true, reasonText: true, roll: { select: { barcode: true } }, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } }, reason: { select: { name: true, color: true } } },
    });
    const returnedRolls = returnRows.map((rr) => ({ id: rr.id, barcode: rr.roll.barcode, item: rr.item, color: rr.color, width: rr.width, qty: rr.qty, returnedAt: rr.createdAt, reasonName: rr.reason?.name ?? rr.reasonText ?? null, reasonColor: rr.reason?.color ?? null }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        destination: shipment.destination,
        procedureCode: shipment.procedureCode,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        orders,
        rolls: shipment.rolls.map((r) => ({ id: r.id, barcode: r.barcode, item: r.item, color: r.color, width: r.width, currentQty: r.currentQty, sackId: r.sackId })),
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        summary: { rollCount: shipment.rolls.length, swatchCount: shipment.swatches.length, totalMeters, sackCount: shipment.sacks.length, totalKg, returnedCount: returnedRolls.length, returnedMeters },
      },
    };
  }

  // =========================================================================
  // SEVK KAPISI — PLANNED/AT_DOOR board
  // =========================================================================

  /** Sevk Kapısı board LİSTESİ — PLANNED (planlı) | AT_DOOR (kapı önü); hafif + cursor. */
  async listSackStoreBoard(params: { status?: string; search?: string; destination?: string; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);
    const statusFilter: ShipmentStatus[] =
      params.status === "PLANNED" ? [ShipmentStatus.PLANNED]
        : params.status === "AT_DOOR" ? [ShipmentStatus.AT_DOOR]
          : [ShipmentStatus.PLANNED, ShipmentStatus.AT_DOOR];

    const where: Prisma.ShipmentWhereInput = { status: { in: statusFilter } };
    if (params.destination === "DOMESTIC" || params.destination === "EXPORT") {
      where.destination = params.destination as ShipmentDestination;
    }
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTurkishSearch<Prisma.ShipmentWhereInput>(search, ["shipmentNo", "customer.name", "sacks.some.sackNo", "sacks.some.manualCode"]);
    }

    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.ShipmentWhereInput = cursor ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "asc") as Prisma.ShipmentWhereInput] } : where;

    const rows = await prisma.shipment.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      select: { id: true, shipmentNo: true, status: true, destination: true, procedureCode: true, createdAt: true, customer: { select: { id: true, code: true, name: true } }, branch: { select: { id: true, code: true, name: true } } },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, "createdAt") : null;

    const [sackAgg, rollAgg] = ids.length
      ? await Promise.all([
          prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { weightKg: true } }),
          prisma.roll.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { currentQty: true } }),
        ])
      : [[], []];
    const sackByShip = new Map(sackAgg.map((g) => [g.shipmentId, g]));
    const rollByShip = new Map(rollAgg.map((g) => [g.shipmentId, g]));

    const data = pageRows.map((s) => {
      const sa = sackByShip.get(s.id);
      const ra = rollByShip.get(s.id);
      return { id: s.id, shipmentNo: s.shipmentNo, status: s.status, destination: s.destination, procedureCode: s.procedureCode, createdAt: s.createdAt, customer: s.customer, branch: s.branch, sackCount: sa?._count._all ?? 0, rollCount: ra?._count._all ?? 0, totalKg: Number(sa?._sum.weightKg ?? 0), totalQty: Number(ra?._sum.currentQty ?? 0) };
    });
    return { success: true, data, pagination: { nextCursor, hasMore, limit } };
  }

  /** Bir sevkiyatın tam çuval+rulo dökümü — board kartına tıklayınca lazy. */
  async getShipmentSackContents(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true, plateNumber: true, driverName: true, carrier: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, manualCode: true, weightKg: true,
            rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true, width: true, qualityGrade: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
            swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { id: true, name: true } }, color: { select: { id: true, name: true, hex: true } } } },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const sacks = sh.sacks.map((sk) => {
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: Prisma.Decimal; rollCount: number }>();
      let sackQty = D0();
      for (const r of sk.rolls) {
        const key = `${r.item.name}|${r.color?.name ?? ""}|${r.width ?? ""}`;
        const g = groups.get(key) ?? { itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width ? Number(r.width) : null, qty: D0(), rollCount: 0 };
        g.qty = g.qty.plus(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        sackQty = sackQty.plus(r.currentQty);
      }
      return {
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, manualCode: sk.manualCode, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        rollCount: sk.rolls.length, swatchCount: sk.swatches.length, totalQty: Number(sackQty),
        contents: [...groups.values()].map((g) => ({ itemName: g.itemName, colorName: g.colorName, width: g.width, qty: Number(g.qty), rollCount: g.rollCount })),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, qty: Number(r.currentQty), width: r.width != null ? Number(r.width) : null, qualityGrade: r.qualityGrade, item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });

    return { success: true, data: { id: sh.id, shipmentNo: sh.shipmentNo, status: sh.status, plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, customer: sh.customer, branch: sh.branch, sackCount: sh.sacks.length, sacks } };
  }

  /** Muhasebe sevk fişi — collectShipmentDocContent (irsaliye ile birebir). */
  async getDispatchReport(shipmentId: string): Promise<ApiResponse<unknown>> {
    const content = await collectShipmentDocContent(prisma, shipmentId, { requireDispatched: false });
    if (!content) throw AppError.notFound("Sevkiyat bulunamadı");
    return { success: true, data: content };
  }

  // =========================================================================
  // SİPARİŞ SEÇİM EKRANI — açık siparişler + depo karşılaması (paketleme rehberi)
  // =========================================================================

  /**
   * Açık siparişler + her satırda depo karşılaması. openQty = istenen − sevk − çuvallanmış.
   * Depo serbest stoğu (shipmentId=null, sackId=null, WAREHOUSE) spec bazında gösterilir.
   */
  async listOpenOrdersWithCoverage(params: { customerId?: string; branchId?: string | null }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderWhereInput = { status: { notIn: ["CANCELLED", "COMPLETED"] } };
    if (params.customerId) where.customerId = params.customerId;
    if (params.branchId !== undefined) where.branchId = params.branchId;

    const orders = await prisma.order.findMany({
      where,
      take: 300,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
      select: {
        id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, name: true } },
        lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, packedQty: true, customerItemName: true, customerColorName: true, createdAt: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Serbest depo stoğu — spec bazında toplam. sackId:null EKLENDİ: çuvallanmış (havuz)
    // toplar çift sayılmasın (onlar packedQty'de rezerve edilir).
    const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
    const stockBySpec = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width"],
      where: { shipmentId: null, sackId: null, status: RollStatus.WAREHOUSE, itemId: { in: itemIds } },
      _sum: { currentQty: true },
    });
    const specAvail = (line: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }): Prisma.Decimal =>
      stockBySpec.reduce((sum, g) => {
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId != null && g.colorId !== line.colorId) return sum;
        if (line.width != null && g.width != null && !new Prisma.Decimal(line.width).equals(g.width)) return sum;
        return sum.plus(g._sum.currentQty ?? 0);
      }, D0());

    const data = orders.map((o) => ({
      order: { id: o.id, orderNumber: o.orderNumber, status: o.status, deadline: o.deadline, customer: o.customer, branch: o.branch },
      lines: o.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const packed = new Prisma.Decimal(l.packedQty);
        const openQty = requested.minus(shipped).minus(packed);
        const fromWarehouse = specAvail(l);
        return {
          lineId: l.id, item: l.item, color: l.color, width: l.width,
          customerItemName: l.customerItemName, customerColorName: l.customerColorName,
          requested, shipped, packed, openQty, warehouseAvailable: fromWarehouse,
          covered: openQty.lessThanOrEqualTo(0) || fromWarehouse.greaterThanOrEqualTo(openQty),
        };
      }),
    }));
    return { success: true, data };
  }
}

export const shippingService = new ShippingService();

// =============================================================================
// RESMİ BELGE — Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici: freeze (dispatch tx'i), reissue (revizyon), lazy-init. `collectShipmentDocContent`
// çuval içeriğinden (Sack→Roll) üretir — tahsis/allocation'a DOKUNMAZ. Muhasebe fişi ile
// sevk irsaliyesi BİREBİR aynı veriden gelir.
async function collectShipmentDocContent(
  db: PrintedDocDb,
  shipmentId: string,
  opts: { requireDispatched: boolean }
): Promise<ShipmentDispatchDoc | null> {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, procedureCode: true, destination: true, dispatchedAt: true, createdAt: true,
      plateNumber: true, driverName: true, carrier: true,
      customer: { select: { code: true, name: true, taxNumber: true } },
      branch: { select: { name: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        select: { seq: true, manualCode: true, weightKg: true, rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true, width: true, item: { select: { name: true } }, color: { select: { name: true } } } } },
      },
    },
  });
  if (!sh) return null;
  if (opts.requireDispatched && sh.status !== ShipmentStatus.DISPATCHED) return null;

  const productMap = new Map<string, { name: string; rollCount: number; totalMeters: Prisma.Decimal }>();
  const sackRows = sh.sacks.map((sk) => {
    let sackMeters = D0();
    for (const r of sk.rolls) {
      sackMeters = sackMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      const g = productMap.get(stokAdi) ?? { name: stokAdi, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
    }
    return { code: sk.manualCode ?? `#${sk.seq}`, seq: sk.seq ?? 0, totalMeters: Number(sackMeters), totalKg: sk.weightKg != null ? Number(sk.weightKg) : 0, packageCount: sk.rolls.length };
  });

  const cekiRows = sh.sacks.flatMap((sk) =>
    sk.rolls.map((r, idx) => ({ rollId: r.id, sackCode: sk.manualCode ?? `#${sk.seq}`, barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", meters: Number(r.currentQty), kg: idx === 0 && sk.weightKg != null ? Number(sk.weightKg) : 0 }))
  );

  const products = [...productMap.values()].map((p) => ({ name: p.name, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
  const totalRolls = products.reduce((s, p) => s + p.rollCount, 0);
  const totalMeters = Number(sackRows.reduce((s, r) => s.plus(r.totalMeters), D0()));
  const totalKg = Number(sackRows.reduce((s, r) => s.plus(r.totalKg), D0()));
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");

  return {
    header: { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, branchName: sh.branch?.name ?? null, procedureCode: sh.procedureCode, destination: sh.destination, status: sh.status, date: (sh.dispatchedAt ?? sh.createdAt).toISOString(), plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, orderNos },
    products,
    sacks: sackRows,
    cekiRows,
    totals: { totalRolls, totalMeters, totalKg, sackCount: sh.sacks.length },
  };
}

/** Freeze / reissue / lazy-init — yalnız DISPATCHED sevkiyat belgelenir. */
async function buildShipmentDispatchDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: true });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

/** Canlı önizleme (TASLAK) — sevk öncesi içerik üretir. */
async function buildShipmentDispatchPreview(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const content = await collectShipmentDocContent(db, shipmentId, { requireDispatched: false });
  if (!content) return null;
  return { documentNo: content.header.shipmentNo, doc: content as unknown as Record<string, unknown> };
}

registerPrintedDocBuilder(PrintedDocType.SHIPMENT_DISPATCH, {
  fresh: buildShipmentDispatchDoc,
  renderHtml: renderShipmentDispatchHtml,
  buildPreview: buildShipmentDispatchPreview,
});
