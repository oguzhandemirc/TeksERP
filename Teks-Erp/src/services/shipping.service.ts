// =============================================================================
// Shipping Service — Çuval Havuzu (Sack pool) + Sevkiyat (Shipment)
// =============================================================================
// ÇUVAL DEPO MODELİ (top→sipariş bağı YOK; mühür/rezerv YOK). Akış:
//   1) Çuval aç → openSack(customerId?)  → Sack (depoda; müşteri OPSİYONEL)
//   2) Topları/kartelaları çuvala okut → scanIntoSack(sackId) → Roll/Swatch.sackId
//   3) (Opsiyonel) brüt tart + kod gir → weighSack. Çuval depoda, her an düzenlenebilir.
//   4) Çuval(lar) seç → createShipment({sackIds, customerId, branchId?, orderIds?, plate/driver?})
//      → seçili siparişlere spec-FIFO tahsis (distributeSacksToLines) yazılır. Sevk onayı
//      KAPALI (varsayılan) ise AYNI adımda dispatch → DISPATCHED (toplar SHIPPED, tahsisler
//      → shippedQty). AÇIK ise PLANNED kalır; (5) Sevk Kapısı → dispatchShipment → DISPATCHED.
//   İptal → cancelShipment (PLANNED): çuvallar depoya döner, tahsisler silinir. Kapı önü YOK.
//
// Düşüş yalnız sevkte, elle seçilen siparişlere. Rezerv/packedQty yok. Fazla/eşleşmeyen/
// siparişsiz sevk edilebilir (uyarı). Çuval İÇERİK tutar (Roll/Swatch.sackId) → irsaliyede
// ürün-bazlı döküm. Tahsis "hangi top" değil "ne kadar metraj" (SackAllocation defteri).
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
import { renderQualityCertificateHtml, type QualityCertificateDoc } from "./document-render/quality-certificate.html";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { p2002Mentions } from "../utils/p2002";
import { readShipmentConfirmationEnabled } from "./system-setting.service";
import { dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { touchWarehouseSackTx, touchShipmentPlannedTx } from "./helpers/shipment-locks.helper";
import {
  D0,
  distributeSacksToLines,
  type PoolSack,
  type SackAllocLine,
} from "./helpers/allocation.helper";
import { recomputeOrderStatusForOrders, touchOrderLinesTx } from "./helpers/order-status.helper";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
  buildTurkishSearch,
  resolveSortBy,
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
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier", "customer.name"];
// destination = Shipment skaler alanı (DOMESTIC|EXPORT) → buildWhereClause halleder.
// itemId/colorId/hasReturns BİLİNÇLİ dışarıda: relation alt-sorgusu (some) olarak elle kurulur.
const SHIPMENT_FILTER_FIELDS = ["status", "customerId", "branchId", "destination"] as const;
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt"] as const;

// Çuvala okutulamayacak / sevke sokulamayacak top durumları. Kalite/bitmişlik GATE'i
// YOK — envanterde fiziksel mevcut her top girer (ham STOCK, mamul WAREHOUSE,
// 2.kalite A1_STOCK, fason dönüşü açık kumaş). Yalnız FİZİKSEL İMKÂNSIZ durumlar bloklu:
// gitti (SHIPPED), fire (SCRAP), iptal (CANCELLED), makinede (IN_PRODUCTION), bina dışı
// (AT_SUBCONTRACTOR/AT_KARTELA), emekli/tüketilmiş (*_CONSUMED) → bagajlanırsa çift-sayım.
const NON_SACKABLE_STATUSES: RollStatus[] = [
  RollStatus.SHIPPED,
  RollStatus.SCRAP,
  RollStatus.CANCELLED,
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.AT_KARTELA,
  RollStatus.TAMBUR_CONSUMED,
  RollStatus.SUBCONTRACTOR_CONSUMED,
  RollStatus.KARTELA_CONSUMED,
];

// ---------------------------------------------------------------------------
// Sequence helpers — SVK + GGAAYY + NNNN (sevkiyat), CV + GGAAYY + NNNN (çuval)
// ---------------------------------------------------------------------------
// Günlük sıralı numara — collation-güvenli (gte+startsWith; U+FFFF sentinel glibc'de
// ignorable olduğundan yasak). Sayısal max+1 → gün içi monotonik.
async function nextShipmentNo(): Promise<string> {
  const prefix = dailyCodePrefix("SVK");
  const todays = await prisma.shipment.findMany({
    where: { shipmentNo: { gte: prefix, startsWith: prefix } },
    select: { shipmentNo: true },
  });
  const seq = nextDailySeq(todays.map((s) => s.shipmentNo), prefix);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function nextSackNo(): Promise<string> {
  const prefix = dailyCodePrefix("CV");
  const todays = await prisma.sack.findMany({
    where: { sackNo: { gte: prefix, startsWith: prefix } },
    select: { sackNo: true },
  });
  const seq = nextDailySeq(todays.map((s) => s.sackNo), prefix);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export class ShippingService {
  // =========================================================================
  // ÇUVAL DEPO HAVUZU — çuval aç / okut / tart (sevkiyattan bağımsız)
  // =========================================================================

  /**
   * Yeni çuval aç (depoda). shipmentId NULL, seq NULL. Müşteri OPSİYONEL — bilinen sipariş
   * için atanabilir, yoksa boş (genel stok); müşteri/şube sevk kurulurken de atanır. Çuval
   * sistem kodu (sackNo) otomatik üretilir. Mühür yok — depoda her an düzenlenebilir.
   */
  async openSack(
    data: { customerId?: string | null; branchId?: string | null; weightKg?: number | null; sackNo?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (data.weightKg != null && !(data.weightKg > 0)) {
      throw AppError.badRequest("Geçerli bir kg girilmeli");
    }
    let customerId: string | null = null;
    let customerName: string | null = null;
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isActive: true, name: true },
      });
      if (!customer || !customer.isActive) throw AppError.badRequest("Geçerli bir müşteri seçilmeli");
      customerId = customer.id;
      customerName = customer.name;
    }
    let branchId: string | null = null;
    let branchName: string | null = null;
    let branchCode: string | null = null;
    if (data.branchId) {
      if (!customerId) throw AppError.badRequest("Şube seçmek için önce müşteri seçilmeli");
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, customerId: true, isActive: true, name: true, code: true },
      });
      if (!branch || !branch.isActive || branch.customerId !== customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      branchId = branch.id;
      branchName = branch.name;
      branchCode = branch.code ?? null;
    }

    const manualSackNo = data.sackNo?.trim() || null;
    const sack = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const sackNo = manualSackNo ?? (await nextSackNo());
        return tx.sack.create({
          data: {
            sackNo,
            customerId,
            branchId,
            shipmentId: null,
            seq: null,
            weightKg: data.weightKg != null ? new Prisma.Decimal(data.weightKg) : null,
            ...(data.weightKg != null ? { weighedById: userId ?? null, weighedAt: new Date() } : {}),
          },
          select: { id: true, sackNo: true, weightKg: true, customerId: true, branchId: true },
        });
      }),
      undefined,
      manualSackNo
        ? (err) => {
            // F61 emsali: manuel sackNo P2002'si retry EDİLMEZ (retry hep aynı sabit
            // değeri yazar; 5 tur sonra yanıltıcı "Barkod üretimi 5 denemede başarısız"
            // dönerdi) — doğrudan anlamlı 409. Otomatik modda predicate yok: sackNo
            // sequence yarışı taze nextSackNo ile retry edilir (mevcut davranış).
            if (p2002Mentions(err, /sackNo/i)) {
              throw AppError.conflict(`Bu çuval kodu zaten kullanılıyor: ${manualSackNo}`);
            }
            return true;
          }
        : undefined,
    );
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SACK",
      recordId: sack.id,
      newData: { sackNo: sack.sackNo, customerId, branchId },
    });
    return {
      success: true,
      data: { ...sack, customerName, branchName, branchCode },
      message: "Çuval açıldı",
    };
  }

  /**
   * Depodaki çuvalın MÜŞTERİSİNİ (ve şubesini) değiştir — yalnız `shipmentId=null`
   * (sevkiyata girmemiş) çuvalda. Top→müşteri bağı olmadığından içerik varken de
   * güvenli; müşteri `null`'a (müşterisiz genel stok) çekilebilir. Şube verilirse yeni
   * müşteriye ait olmalı; müşteri boşsa/değişince şube temizlenir. `openSack`'in
   * müşteri/şube doğrulamasıyla aynı kural. Atomik claim: eşzamanlı sevkiyat kurulumu
   * araya girerse (çuval PLANNED'e kaçarsa) 409.
   */
  async reassignSackCustomer(
    sackId: string,
    data: { customerId?: string | null; branchId?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, shipmentId: true, customerId: true, branchId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) {
      throw AppError.conflict("Çuval bir sevkiyata atanmış — müşteri değiştirilemez (önce sevkiyattan çıkarın)");
    }

    // Müşteri opsiyonel (null = müşterisiz genel stok). Ad'ı da al → yanıtta dön
    // (istemci editör rozetini fetch'siz günceller).
    let customerId: string | null = null;
    let customerName: string | null = null;
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, isActive: true, name: true },
      });
      if (!customer || !customer.isActive) throw AppError.badRequest("Geçerli bir müşteri seçilmeli");
      customerId = customer.id;
      customerName = customer.name;
    }
    // Şube opsiyonel — müşteri gerektirir + o müşteriye ait olmalı.
    let branchId: string | null = null;
    let branchName: string | null = null;
    let branchCode: string | null = null;
    if (data.branchId) {
      if (!customerId) throw AppError.badRequest("Şube seçmek için önce müşteri seçilmeli");
      const branch = await prisma.customerBranch.findUnique({
        where: { id: data.branchId },
        select: { id: true, customerId: true, isActive: true, name: true, code: true },
      });
      if (!branch || !branch.isActive || branch.customerId !== customerId) {
        throw AppError.badRequest("Şube bu müşteriye ait değil");
      }
      branchId = branch.id;
      branchName = branch.name;
      branchCode = branch.code ?? null;
    }

    // Atomik claim — hâlâ depoda (shipmentId=null) olmalı.
    const claimed = await prisma.sack.updateMany({
      where: { id: sackId, shipmentId: null },
      data: { customerId, branchId },
    });
    if (claimed.count !== 1) throw AppError.conflict("Çuval az önce bir sevkiyata girdi — yenileyin.");

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { customerId: sack.customerId, branchId: sack.branchId },
      newData: { customerId, branchId },
    });
    return {
      success: true,
      data: { id: sackId, customerId, customerName, branchId, branchName, branchCode },
      message: "Çuval müşterisi güncellendi",
    };
  }

  /**
   * Barkod okut → top ya da kartelayı depodaki çuvala ekle (depodaki serbest mal). Başka
   * depodaki çuvaldaki bir top bu çuvala okutulursa TAŞINIR (sevkiyattaki çuval reddedilir).
   */
  async scanIntoSack(
    data: { sackId: string; barcode: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış — içerik değiştirilemez");

    const code = data.barcode.trim();
    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: { id: true, status: true, shipmentId: true, sackId: true, barcode: true, currentQty: true, sack: { select: { shipmentId: true } } },
    });
    if (roll) {
      // Zaten bu çuvalda
      if (roll.sackId === data.sackId) {
        return { success: true, data: { kind: "ROLL", rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
      }
      // Başka depodaki çuvaldaysa TAŞI; sevkiyattaki çuvaldaysa reddet.
      if (roll.sackId) {
        const from = roll.sack;
        if (!from || from.shipmentId != null) {
          throw AppError.conflict("Top başka bir çuvalda (sevkiyatta) — taşınamaz");
        }
        const fromSackId = roll.sackId;
        await prisma.$transaction(async (tx) => {
          await touchWarehouseSackTx(tx, data.sackId);
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
      if (NON_SACKABLE_STATUSES.includes(roll.status)) {
        throw AppError.badRequest(
          `Bu top çuvala konulamaz — durumu: ${roll.status} (sevk edilmiş/fire/iptal/tüketilmiş/fasonda/kartelada/üretimde). Envanterdeki serbest toplar okutulabilir.`,
        );
      }
      await prisma.$transaction(async (tx) => {
        await touchWarehouseSackTx(tx, data.sackId);
        const claimed = await tx.roll.updateMany({
          where: { id: roll.id, shipmentId: null, sackId: null, status: { notIn: NON_SACKABLE_STATUSES } },
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
      select: { id: true, shipmentId: true, sackId: true, barcode: true, cancelledAt: true, sack: { select: { shipmentId: true } } },
    });
    if (!swatch) throw AppError.notFound(`Top/kartela bulunamadı: ${code}`);
    if (swatch.cancelledAt) throw AppError.badRequest(`İptal edilmiş kartela okutulamaz: ${swatch.barcode}`);
    if (swatch.sackId === data.sackId) {
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela zaten bu çuvalda" };
    }
    if (swatch.sackId) {
      const from = swatch.sack;
      if (!from || from.shipmentId != null) {
        throw AppError.conflict("Kartela başka bir çuvalda (sevkiyatta) — taşınamaz");
      }
      const fromSackId = swatch.sackId;
      await prisma.$transaction(async (tx) => {
        await touchWarehouseSackTx(tx, data.sackId);
        const moved = await tx.swatch.updateMany({ where: { id: swatch.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
        if (moved.count !== 1) throw AppError.conflict("Kartela bu sırada taşınmış/çıkarılmış — tekrar deneyin");
        await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]);
      });
      await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: swatch.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: swatch.barcode } });
      return { success: true, data: { kind: "SWATCH", swatchId: swatch.id, sackId: data.sackId }, message: "Kartela bu çuvala taşındı" };
    }
    if (swatch.shipmentId) throw AppError.conflict("Kartela bir sevkiyatta");
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
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
      select: { id: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Çuval bir sevkiyata atanmış");

    const ids = await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
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
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || (roll.sack && roll.sack.shipmentId != null)) {
      throw AppError.conflict("Top sevkiyattaki çuvalda — önce sevkiyattan çıkarın");
    }
    const sackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, sackId);
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
      select: { id: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    if (!swatch.sackId) throw AppError.badRequest("Kartela bir çuvalda değil");
    if (swatch.shipmentId != null || (swatch.sack && swatch.sack.shipmentId != null)) {
      throw AppError.conflict("Kartela sevkiyattaki çuvalda — önce sevkiyattan çıkarın");
    }
    const sackId = swatch.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, sackId);
      const removed = await tx.swatch.updateMany({ where: { id: data.swatchId, sackId, shipmentId: null }, data: { sackId: null } });
      if (removed.count !== 1) throw AppError.conflict("Kartela bu sırada çıkarılmış/taşınmış — tekrar deneyin");
      await this.resetSackWeightsTx(tx, [sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SWATCH", recordId: data.swatchId, newData: { kind: "SACK_UNSCAN", sackId: null } });
    return { success: true, data: {}, message: "Kartela çuvaldan çıkarıldı" };
  }

  /** Topu bir depodaki çuvaldan diğerine taşı. */
  async moveRollToSack(
    data: { rollId: string; sackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, barcode: true, sackId: true, shipmentId: true, sack: { select: { shipmentId: true } } },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (!roll.sackId || !roll.sack) throw AppError.badRequest("Top bir çuvalda değil");
    if (roll.shipmentId != null || roll.sack.shipmentId != null) {
      throw AppError.conflict("Kaynak çuval sevkiyatta — önce sevkiyattan çıkarın");
    }
    if (roll.sackId === data.sackId) {
      return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top zaten bu çuvalda" };
    }
    const target = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!target) throw AppError.notFound("Hedef çuval bulunamadı");
    if (target.shipmentId != null) throw AppError.conflict("Hedef çuval sevkiyatta");
    const fromSackId = roll.sackId;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, fromSackId);
      await touchWarehouseSackTx(tx, data.sackId);
      const moved = await tx.roll.updateMany({ where: { id: roll.id, sackId: fromSackId, shipmentId: null }, data: { sackId: data.sackId } });
      if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşınmış/çıkarılmış — tekrar deneyin");
      await this.resetSackWeightsTx(tx, [fromSackId, data.sackId]);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "ROLL", recordId: roll.id, newData: { kind: "SACK_MOVE", sackId: data.sackId, fromSackId, barcode: roll.barcode } });
    return { success: true, data: { rollId: roll.id, sackId: data.sackId }, message: "Top taşındı" };
  }

  /**
   * "Çuvalı dağıt" — çuvalın SEÇİLİ (rollIds/swatchIds) veya TÜM (ikisi de boşsa)
   * top/kartelalarını serbest depoya çıkar (sackId=null). Çuval boş kalır ama SİLİNMEZ
   * (silmek isteyen `removeSack(withContents)` kullanır). Yalnız depodaki çuval — sevkiyata
   * atanmış çuval reddedilir (touchWarehouseSackTx). İçerik değiştiği için tartı sıfırlanır.
   */
  async distributeSackContents(
    data: { sackId: string; rollIds?: string[]; swatchIds?: string[] },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: data.sackId },
      select: { id: true, sackNo: true, shipmentId: true },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) {
      throw AppError.conflict("Sevkiyata atanmış çuvalın içeriği değiştirilemez — önce sevkiyattan çıkarın");
    }
    const rollSel = data.rollIds?.length ? data.rollIds : null;
    const swatchSel = data.swatchIds?.length ? data.swatchIds : null;
    // Hiç seçim verilmediyse: çuvaldaki HER ŞEYİ dağıt.
    const all = !rollSel && !swatchSel;

    let removedRolls = 0;
    let removedSwatches = 0;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      if (all || rollSel) {
        const rollWhere: Prisma.RollWhereInput = all
          ? { sackId: data.sackId, shipmentId: null }
          : { id: { in: rollSel! }, sackId: data.sackId, shipmentId: null };
        removedRolls = (await tx.roll.updateMany({ where: rollWhere, data: { sackId: null } })).count;
      }
      if (all || swatchSel) {
        const swatchWhere: Prisma.SwatchWhereInput = all
          ? { sackId: data.sackId, shipmentId: null }
          : { id: { in: swatchSel! }, sackId: data.sackId, shipmentId: null };
        removedSwatches = (await tx.swatch.updateMany({ where: swatchWhere, data: { sackId: null } })).count;
      }
      await this.resetSackWeightsTx(tx, [data.sackId]);
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId,
      newData: { kind: "SACK_DISTRIBUTE", removedRolls, removedSwatches, all },
    });
    const n = removedRolls + removedSwatches;
    return { success: true, data: { removedRolls, removedSwatches }, message: n > 0 ? `${n} top/kartela depoya çıkarıldı` : "Çıkarılacak içerik yok" };
  }

  /**
   * Kaynak çuvalın (`sackId`) SEÇİLİ toplarını başka bir depo çuvalına TOPLU taşı.
   * Kaynak ve hedef depoda olmalı (sevkiyattaki reddedilir). Atomik updateMany +
   * her iki çuvalın tartısı sıfırlanır (içerik değişti).
   */
  async moveRollsToSack(
    data: { sackId: string; rollIds: string[]; targetSackId: string },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.rollIds?.length) throw AppError.badRequest("Taşınacak top seçilmedi");
    if (data.sackId === data.targetSackId) throw AppError.badRequest("Kaynak ve hedef çuval aynı olamaz");
    const source = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!source) throw AppError.notFound("Kaynak çuval bulunamadı");
    if (source.shipmentId != null) throw AppError.conflict("Kaynak çuval sevkiyatta — önce sevkiyattan çıkarın");
    const target = await prisma.sack.findUnique({ where: { id: data.targetSackId }, select: { id: true, shipmentId: true } });
    if (!target) throw AppError.notFound("Hedef çuval bulunamadı");
    if (target.shipmentId != null) throw AppError.conflict("Hedef çuval sevkiyatta");

    let moved = 0;
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      await touchWarehouseSackTx(tx, data.targetSackId);
      moved = (await tx.roll.updateMany({
        where: { id: { in: data.rollIds }, sackId: data.sackId, shipmentId: null },
        data: { sackId: data.targetSackId },
      })).count;
      await this.resetSackWeightsTx(tx, [data.sackId, data.targetSackId]);
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId,
      newData: { kind: "SACK_MOVE_BULK", targetSackId: data.targetSackId, moved },
    });
    return { success: true, data: { moved }, message: moved > 0 ? `${moved} top taşındı` : "Taşınacak top yok" };
  }

  /**
   * Çuval brüt tartısını güncelle (depodaki çuval — sevkiyata atanmamış).
   */
  async weighSack(
    data: { sackId: string; weightKg?: number | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    if (!hasWeight) throw AppError.badRequest("Tartı girilmeli");
    if (!(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    const sack = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuvalın tartısı değiştirilemez");

    // Atomik claim: yukarıdaki tx-dışı guard yalnız UX (404 + okunaklı mesaj) —
    // findUnique ile update arasında çuval bir sevkiyata claim edilebilirdi
    // (check-then-act; tartı DISPATCH sırasında yazılırdı). Otorite kilitte:
    // touchWarehouseSackTx WHERE shipmentId IS NULL, atanmışsa 409.
    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      await tx.sack.update({
        where: { id: data.sackId },
        data: {
          weightKg: new Prisma.Decimal(data.weightKg!),
          weighedBy: userId ? { connect: { id: userId } } : { disconnect: true },
          weighedAt: new Date(),
        },
      });
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "WEIGH", weightKg: data.weightKg } });
    return { success: true, data: {}, message: "Çuval tartısı güncellendi" };
  }

  /**
   * Depodaki çuvalı sil. Sevkiyata atanmış çuval silinemez (önce sevkiyattan çıkar). Boş
   * çuval doğrudan; dolu çuval `withContents=true` ile içerik depoya döner. Depodaki çuvalın
   * tahsisi yoktur (tahsis yalnız sevkte yazılır) → temizlik gerekmez.
   */
  async removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, shipmentId: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuval silinemez — önce sevkiyattan çıkarın");

    const hasContents = sack._count.rolls > 0 || sack._count.swatches > 0;
    if (hasContents && !withContents) {
      throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
    }

    const rolls = hasContents ? await prisma.roll.findMany({ where: { sackId }, select: { id: true, barcode: true } }) : [];
    await prisma.$transaction(async (tx) => {
      // Atomik claim: tx-dışı shipmentId guard'ı yalnız UX — "atama-önce-silme-sonra"
      // yarışında PLANNED (onay kapalıysa DISPATCHED) sevkiyattan çuval sessizce
      // silinir, toplar "sevkiyatta ama çuvalsız" limboya düşerdi. Otorite kilitte
      // (dosyadaki diğer tüm depo-çuval mutasyonlarıyla aynı desen).
      await touchWarehouseSackTx(tx, sackId);
      // İçerik sayımı kilit ALTINDA taze — tx-dışı _count bayat olabilir (araya
      // giren okutma dolu çuvalı "boş" diye sildirtmesin). updateMany'ler koşulsuz
      // (boş çuvalda no-op); tx-dışı sayımlar yalnız audit/mesaj için kalır.
      const freshRolls = await tx.roll.count({ where: { sackId } });
      const freshSwatches = await tx.swatch.count({ where: { sackId } });
      if (!withContents && freshRolls + freshSwatches > 0) {
        throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
      }
      await tx.roll.updateMany({ where: { sackId }, data: { sackId: null } });
      await tx.swatch.updateMany({ where: { sackId }, data: { sackId: null } });
      await tx.sack.delete({ where: { id: sackId } });
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
   * eski kg bayatlar (yeniden tartı istenir).
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
   * Çuval depo board'u — müşteri bazlı özet (çuval sayısı, kg, metraj). Yalnız depodaki
   * (shipmentId NULL) çuvallar. Müşterisiz çuvallar "atanmamış" (customer=null) grubunda.
   */
  async listPool(params: { customerId?: string; search?: string }): Promise<ApiResponse<unknown>> {
    const where: Prisma.SackWhereInput = { shipmentId: null };
    if (params.customerId) where.customerId = params.customerId;
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTurkishSearch<Prisma.SackWhereInput>(search, ["customer.name", "customer.code", "sackNo"]);
    }
    const sacks = await prisma.sack.findMany({
      where,
      take: 2000,
      select: {
        id: true,
        customerId: true,
        weightKg: true,
        customer: { select: { id: true, code: true, name: true } },
      },
    });
    if (sacks.length === 0) return { success: true, data: [] };

    // Roll metrajı çuval bazında (havuz kapsamı) — sackId → toplam.
    const rollAgg = await prisma.roll.groupBy({
      by: ["sackId"],
      where: { sackId: { in: sacks.map((s) => s.id) }, status: { notIn: NON_SACKABLE_STATUSES } },
      _sum: { currentQty: true },
      _count: { _all: true },
    });
    const rollBySack = new Map(rollAgg.map((g) => [g.sackId, g]));

    const UNASSIGNED = "__none__";
    const byCustomer = new Map<string, {
      customer: { id: string; code: string; name: string } | null;
      sackCount: number;
      totalKg: Prisma.Decimal;
      totalMeters: Prisma.Decimal;
      rollCount: number;
    }>();
    for (const s of sacks) {
      const key = s.customerId ?? UNASSIGNED;
      let e = byCustomer.get(key);
      if (!e) {
        e = { customer: s.customer, sackCount: 0, totalKg: D0(), totalMeters: D0(), rollCount: 0 };
        byCustomer.set(key, e);
      }
      e.sackCount += 1;
      if (s.weightKg) e.totalKg = e.totalKg.plus(s.weightKg);
      const ra = rollBySack.get(s.id);
      if (ra) {
        e.totalMeters = e.totalMeters.plus(ra._sum.currentQty ?? 0);
        e.rollCount += ra._count._all;
      }
    }
    const data = [...byCustomer.values()].map((e) => ({
      customer: e.customer,
      sackCount: e.sackCount,
      totalKg: Number(e.totalKg),
      totalMeters: Number(e.totalMeters),
      rollCount: e.rollCount,
    }));
    data.sort((a, b) => b.sackCount - a.sackCount || (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "", "tr"));
    return { success: true, data };
  }

  /**
   * Bir müşterinin depo çuvalları (sevkiyata atanmamış) — içerikleriyle. Paketleme
   * workspace'inin canlı kaynağı (çuval aç/okut/tart).
   */
  async listCustomerPoolSacks(customerId: string): Promise<ApiResponse<unknown>> {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, code: true, name: true } });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    const sacks = await prisma.sack.findMany({
      where: { customerId, shipmentId: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, sackNo: true, weightKg: true, branchId: true,
        branch: { select: { id: true, code: true, name: true } },
        rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, width: true, currentQty: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true, hex: true } } } },
        swatches: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } } } },
      },
    });
    const data = sacks.map((sk) => {
      const totalQty = sk.rolls.reduce((s, r) => s.plus(r.currentQty), D0());
      return {
        id: sk.id, sackNo: sk.sackNo, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        branch: sk.branch,
        rollCount: sk.rolls.length, swatchCount: sk.swatches.length, totalQty: Number(totalQty),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, width: r.width != null ? Number(r.width) : null, currentQty: Number(r.currentQty), item: r.item, color: r.color })),
        swatches: sk.swatches.map((s) => ({ id: s.id, barcode: s.barcode, item: s.item, color: s.color })),
      };
    });
    return { success: true, data: { customer, sacks: data } };
  }

  // =========================================================================
  // SEVKİYAT — depodan çuval seçerek kur + yaşam döngüsü
  // =========================================================================

  /** Sevkiyat kurulumundan ÖNCE seçilen çuvalları doğrula (pre-tx erken 4xx). Hedef
   *  müşteri/şube dialog'da seçilir; çuvalların null-olmayan müşteri/şubesi hedefle
   *  uyuşmalı, müşterisiz/şubesiz çuvallar serbest (sevkte atanır). */
  private async loadSacksForShipment(
    sackIds: string[],
    target: { customerId: string; branchId: string | null }
  ) {
    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, customerId: true, branchId: true, shipmentId: true, weightKg: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (sacks.length !== sackIds.length) throw AppError.notFound("Bazı çuvallar bulunamadı");
    for (const s of sacks) {
      if (s.shipmentId != null) throw AppError.conflict("Çuvallardan biri zaten bir sevkiyatta");
      if (s._count.rolls === 0 && s._count.swatches === 0) throw AppError.badRequest("Boş çuval sevk edilemez");
      if (s.customerId != null && s.customerId !== target.customerId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka müşteriye ait — tek sevkiyat = tek müşteri.");
      }
      if (s.branchId != null && s.branchId !== target.branchId) {
        throw AppError.badRequest("Seçilen çuvallardan biri başka şubeye ait — tek sevkiyat = tek şube.");
      }
    }
    return { sacks, customerId: target.customerId, branchId: target.branchId };
  }

  /** Seçili siparişler hedef müşteri/şubeye ait mi. */
  private async assertOrdersBelong(orderIds: string[], customerId: string, branchId: string | null): Promise<void> {
    if (orderIds.length === 0) return;
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, customerId: true, branchId: true },
    });
    if (orders.length !== orderIds.length) throw AppError.notFound("Bazı siparişler bulunamadı");
    for (const o of orders) {
      if (o.customerId !== customerId) throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın müşterisine ait değil");
      if (branchId != null && o.branchId != null && o.branchId !== branchId) {
        throw AppError.badRequest("Seçili siparişlerden biri sevkiyatın şubesine ait değil");
      }
    }
  }

  private assertExportWeighed(
    sacks: { weightKg: Prisma.Decimal | null }[],
    destination: ShipmentDestination
  ): void {
    if (destination !== ShipmentDestination.EXPORT) return;
    const unweighed = sacks.filter((s) => s.weightKg == null || !new Prisma.Decimal(s.weightKg).greaterThan(0));
    if (unweighed.length > 0) throw AppError.badRequest("Yurtdışı sevkte tüm çuvallar tartılı olmalı");
  }

  /** ShipmentOrder denorm'unu kullanıcının seçtiği sipariş kümesine ayarla. */
  private async setShipmentOrdersTx(tx: Prisma.TransactionClient, shipmentId: string, orderIds: string[]): Promise<void> {
    const ids = [...new Set(orderIds)];
    await tx.shipmentOrder.deleteMany({ where: { shipmentId } });
    if (ids.length > 0) {
      await tx.shipmentOrder.createMany({ data: ids.map((orderId) => ({ shipmentId, orderId, isActive: true })), skipDuplicates: true });
    }
  }

  /**
   * Sevkiyatın çuvallarını seçili siparişlerin AÇIK satırlarına spec + şube FIFO ile dağıt
   * (distributeSacksToLines). Şube = sevkiyatın atanan şubesi (çuvalın depolanan null'ı değil)
   * → şubesiz depo çuvalı da doğru dağıtılır. need = quantity − shippedQty. DB-pure hesap.
   */
  private async computeSackAllocations(
    db: Prisma.TransactionClient,
    params: { sackIds: string[]; orderIds: string[]; branchId: string | null }
  ): Promise<{ allocations: { sackId: string; orderLineId: string; qty: Prisma.Decimal }[]; lineNeeds: Map<string, Prisma.Decimal> }> {
    const sacks = await db.sack.findMany({
      where: { id: { in: params.sackIds } },
      orderBy: { createdAt: "asc" },
      select: { id: true, rolls: { select: { itemId: true, colorId: true, width: true, currentQty: true } } },
    });
    const poolSacks: PoolSack[] = sacks.map((s) => ({
      sackId: s.id,
      branchId: params.branchId,
      rolls: s.rolls.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, currentQty: r.currentQty })),
    }));
    const lines = params.orderIds.length
      ? await db.orderLine.findMany({
          where: { orderId: { in: params.orderIds } },
          select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, createdAt: true, order: { select: { deadline: true, orderDate: true } } },
        })
      : [];
    const allocLines: SackAllocLine[] = [];
    const lineNeeds = new Map<string, Prisma.Decimal>();
    for (const l of lines) {
      const need = new Prisma.Decimal(l.quantity).minus(l.shippedQty);
      lineNeeds.set(l.id, need);
      if (need.greaterThan(0)) {
        allocLines.push({
          id: l.id, itemId: l.itemId, colorId: l.colorId, width: l.width, branchId: params.branchId,
          need, deadline: l.order.deadline, orderDate: l.order.orderDate, lineCreatedAt: l.createdAt,
        });
      }
    }
    const allocations = distributeSacksToLines(poolSacks, allocLines);
    return { allocations, lineNeeds };
  }

  /** Sevkiyatın tahsislerini sil-yaz (tüm çuvalları × seçili siparişleri). */
  private async writeShipmentAllocationsTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    orderIds: string[],
    branchId: string | null
  ): Promise<void> {
    await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
    if (orderIds.length === 0) return;
    const sackRows = await tx.sack.findMany({ where: { shipmentId }, select: { id: true } });
    const sackIds = sackRows.map((s) => s.id);
    if (sackIds.length === 0) return;
    const { allocations } = await this.computeSackAllocations(tx, { sackIds, orderIds, branchId });
    if (allocations.length > 0) {
      await tx.sackAllocation.createMany({ data: allocations.map((a) => ({ sackId: a.sackId, orderLineId: a.orderLineId, qty: a.qty })) });
    }
  }

  /**
   * Depodan seçilen çuvallarla yeni sevkiyat kur (PLANNED). Müşteri/şube dialog'da seçilir
   * (müşterisiz çuvala backfill). Seçili siparişlere (opsiyonel) spec-FIFO tahsis yazılır;
   * shippedQty yalnız DISPATCH'te terfi eder. Fazla/eşleşmeyen/siparişsiz sevk edilebilir.
   */
  async createShipment(
    data: { sackIds: string[]; customerId: string; branchId?: string | null; orderIds?: string[]; destination?: ShipmentDestination; procedureCode?: string | null; plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (!data.customerId) throw AppError.badRequest("Müşteri seçilmeli");
    const orderIds = [...new Set(data.orderIds ?? [])];
    const branchId = data.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: data.customerId, branchId });
    const destination = data.destination ?? ShipmentDestination.DOMESTIC;
    this.assertExportWeighed(sacks, destination);
    await this.assertOrdersBelong(orderIds, data.customerId, branchId);
    // Sevk onayı KAPALI (varsayılan) → aynı adımda dispatch; AÇIK → PLANNED kalır (Sevk Kapısı).
    const confirmationEnabled = await readShipmentConfirmationEnabled();

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const shipmentNo = await nextShipmentNo();
        const created = await tx.shipment.create({
          data: { shipmentNo, customerId: data.customerId, branchId, status: ShipmentStatus.PLANNED, destination, procedureCode: data.procedureCode?.trim() || null },
          select: { id: true, shipmentNo: true },
        });
        // Atomik claim + seq ata (+ müşterisiz çuvala müşteri/şube backfill).
        for (let i = 0; i < sackIds.length; i++) {
          const claimed = await tx.sack.updateMany({
            where: { id: sackIds[i], shipmentId: null },
            data: { shipmentId: created.id, seq: i + 1, customerId: data.customerId, branchId },
          });
          if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        }
        // İçerik shipmentId açıkça (composite FK deferred → commit'te doğrulanır).
        await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId: created.id } });
        await tx.swatch.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId: created.id } });
        // Sipariş kümesi (kullanıcı seçimi) + spec-FIFO tahsis.
        await this.setShipmentOrdersTx(tx, created.id, orderIds);
        await this.writeShipmentAllocationsTx(tx, created.id, orderIds, branchId);
        // Onay kapalı → aynı tx'te sevk et (DISPATCHED).
        if (!confirmationEnabled) {
          await this.performDispatchTx(tx, created.id, { plateNumber: data.plateNumber, driverName: data.driverName, carrier: data.carrier }, userId);
        }
        return created;
      })
    );
    const dispatched = !confirmationEnabled;
    await AuditService.log({ userId, action: "CREATE", tableName: "SHIPMENT", recordId: result.id, newData: { shipmentNo: result.shipmentNo, customerId: data.customerId, branchId, sackIds, orderIds, destination, dispatched } });
    return {
      success: true,
      data: { id: result.id, shipmentNo: result.shipmentNo, status: dispatched ? ShipmentStatus.DISPATCHED : ShipmentStatus.PLANNED, dispatched },
      message: dispatched ? `Sevk edildi: ${result.shipmentNo}` : `Sevkiyat kuruldu (onay bekliyor): ${result.shipmentNo}`,
    };
  }

  /**
   * Sevkiyat kurulum ÖNİZLEMESİ (salt-okunur): çuval içerik dökümü + seçili siparişlere
   * hesaplanan tahsis + fazla/eşleşmeyen/mükerrer UYARILARI. DB'ye hiçbir şey yazmaz.
   */
  async previewCreateShipment(
    data: { sackIds: string[]; customerId?: string | null; branchId?: string | null; orderIds?: string[] }
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) {
      return { success: true, data: { sacks: [], lines: [], warnings: [], totals: { totalMeters: 0, sackCount: 0, surplusMeters: 0 } } };
    }
    const branchId = data.branchId ?? null;
    const orderIds = [...new Set(data.orderIds ?? [])];

    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, weightKg: true, rolls: { select: { currentQty: true } } },
    });
    let totalMeters = D0();
    const sackRows = sacks.map((s) => {
      let m = D0();
      for (const r of s.rolls) m = m.plus(r.currentQty);
      totalMeters = totalMeters.plus(m);
      return { id: s.id, sackNo: s.sackNo, weightKg: s.weightKg != null ? Number(s.weightKg) : null, rollCount: s.rolls.length, totalMeters: Number(m) };
    });

    const warnings: string[] = [];
    let lines: { lineId: string; orderNumber: string; item: string; color: string | null; width: number | null; need: number; allocated: number }[] = [];
    let surplusMeters = Number(totalMeters);

    if (orderIds.length > 0) {
      const { allocations, lineNeeds } = await this.computeSackAllocations(prisma, { sackIds, orderIds, branchId });
      const allocByLine = new Map<string, Prisma.Decimal>();
      for (const a of allocations) allocByLine.set(a.orderLineId, (allocByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      const allocatedTotal = [...allocByLine.values()].reduce((acc, q) => acc.plus(q), D0());
      surplusMeters = Number(totalMeters.minus(allocatedTotal));

      const lineRows = await prisma.orderLine.findMany({
        where: { id: { in: [...lineNeeds.keys()] } },
        select: { id: true, width: true, item: { select: { name: true } }, color: { select: { name: true } }, order: { select: { orderNumber: true } } },
      });
      // Önizleme iç operasyon ekranıdır: her zaman bizdeki ad basılır. Satırdaki
      // müşteri override'ı yalnız adın girildiği siparişte dolu olduğundan burada
      // kullanmak aynı kumaşı iki farklı adla gösteriyordu.
      lines = lineRows.map((l) => ({
        lineId: l.id, orderNumber: l.order.orderNumber,
        item: l.item.name, color: l.color?.name ?? null,
        width: l.width != null ? Number(l.width) : null,
        need: Number(lineNeeds.get(l.id) ?? 0), allocated: Number(allocByLine.get(l.id) ?? 0),
      }));

      if (surplusMeters > 0.001) {
        warnings.push(`Seçili siparişlere yazılamayan ~${Math.round(surplusMeters)} m mal var (fazla/eşleşmeyen) — yine de sevk edilecek.`);
      }
      const pendingOther = await prisma.sackAllocation.groupBy({
        by: ["orderLineId"],
        where: { orderLineId: { in: [...lineNeeds.keys()] }, sack: { shipment: { status: ShipmentStatus.PLANNED } } },
        _sum: { qty: true },
      });
      for (const g of pendingOther) {
        const q = Number(g._sum.qty ?? 0);
        if (q > 0.001) {
          const ln = lines.find((x) => x.lineId === g.orderLineId);
          warnings.push(`${ln?.orderNumber ?? "Sipariş"} · ${ln?.item ?? ""}: bu satırda başka açık sevkiyatta ~${Math.round(q)} m bekliyor (mükerrer sevk olabilir).`);
        }
      }
    } else {
      warnings.push("Sipariş seçilmedi — mal hiçbir siparişten düşülmeden sevk edilecek.");
    }

    return {
      success: true,
      data: {
        sacks: sackRows,
        lines,
        warnings,
        totals: { totalMeters: Number(totalMeters), sackCount: sacks.length, surplusMeters: Math.max(0, surplusMeters) },
      },
    };
  }

  /** PLANNED sevkiyata depodan çuval(lar) ekle (tahsisler yeniden hesaplanır). */
  async addSacksToShipment(shipmentId: string, sackIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(sackIdsIn)];
    if (sackIds.length === 0) throw AppError.badRequest("Çuval seçilmeli");
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyata çuval eklenebilir");
    const branchId = shipment.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: shipment.customerId, branchId });
    this.assertExportWeighed(sacks, shipment.destination);

    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const maxSeqRow = await tx.sack.findFirst({ where: { shipmentId }, orderBy: { seq: "desc" }, select: { seq: true } });
      let seq = (maxSeqRow?.seq ?? 0) + 1;
      for (const sackId of sackIds) {
        const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId: null }, data: { shipmentId, seq, customerId: shipment.customerId, branchId } });
        if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        seq += 1;
      }
      await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      await tx.swatch.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "ADD_SACKS", sackIds } });
    return { success: true, data: {}, message: "Çuval(lar) sevkiyata eklendi" };
  }

  /** PLANNED sevkiyattan çuval çıkar → depoya döner (tahsisler yeniden hesaplanır). */
  async removeSackFromShipment(shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true, shipmentId: true, shipment: { select: { status: true, branchId: true } } } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== shipmentId) throw AppError.badRequest("Çuval bu sevkiyatta değil");
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyattan çuval çıkarılabilir");
    const branchId = sack.shipment?.branchId ?? null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId }, data: { shipmentId: null, seq: null } });
      if (claimed.count !== 1) throw AppError.conflict("Çuval bu sırada çıkarıldı — yenileyin");
      await tx.roll.updateMany({ where: { sackId }, data: { shipmentId: null } });
      await tx.swatch.updateMany({ where: { sackId }, data: { shipmentId: null } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "REMOVE_SACK", sackId } });
    return { success: true, data: {}, message: "Çuval sevkiyattan çıkarıldı (depoya döndü)" };
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

  /** İrsaliye açıklaması (annotation) — sevkiyat DURUMU fark etmez, her an düzenlenir
   *  (SÜRÜM DOĞURMAZ; belge basılırken canlı çözülür). Boş → temizlenir. */
  async setDispatchNote(shipmentId: string, note: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const value = note?.trim().slice(0, 500) || null;
    const updated = await prisma.shipment.updateMany({ where: { id: shipmentId }, data: { dispatchNote: value } });
    if (updated.count === 0) throw AppError.notFound("Sevkiyat bulunamadı");
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH_NOTE", dispatchNote: value } });
    return { success: true, data: { shipmentId, dispatchNote: value }, message: "İrsaliye açıklaması güncellendi" };
  }

  /** İrsaliye açıklamasını oku — irsaliye modalı notu ağır getDetail'siz alsın. */
  async getDispatchNote(shipmentId: string): Promise<ApiResponse<{ dispatchNote: string | null }>> {
    const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { dispatchNote: true } });
    if (!s) throw AppError.notFound("Sevkiyat bulunamadı");
    return { success: true, data: { dispatchNote: s.dispatchNote } };
  }

  /**
   * Sevk tx'i — createShipment auto-dispatch + dispatchShipment ortak çekirdeği. PLANNED →
   * DISPATCHED: toplar SHIPPED, tahsisler → shippedQty (recompute), irsaliye dondurulur.
   * Döner: sevk edilen top adedi. Çağıran ön-koşulları (dolu, EXPORT tartı) garanti eder.
   */
  private async performDispatchTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<number> {
    const claim = await tx.shipment.updateMany({
      where: { id: shipmentId, status: ShipmentStatus.PLANNED },
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
    const flipped = await tx.roll.updateMany({ where: { shipmentId, status: { not: RollStatus.SHIPPED } }, data: { status: RollStatus.SHIPPED } });
    // Tahsisler artık DISPATCHED sevkiyatta → shippedQty defterden yeniden hesaplanır.
    const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
    // Lost-update kilidi: recompute defteri KİLİTSİZ okuyup shippedQty yazar — READ
    // COMMITTED altında aynı siparişe eşzamanlı iki terminal olay (iki dispatch, ya da
    // dispatch ∥ fason directShip) birbirinin commit'ini görmeden eksik toplam yazardı
    // (order-status.helper doc'u). Protokol: etkilenen siparişlerin TAM satır kümesi
    // recompute'tan ÖNCE tek sıralı touchOrderLinesTx partisiyle kilitlenir
    // (subcontractor directShip ile aynı; alt-küme kilidi deadlock riski taşır).
    const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
    const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
    await recomputeOrderStatusForOrders(tx, orderIds);
    // Resmi belge — sevk irsaliyesi v1 burada donar.
    await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
    return flipped.count;
  }

  /**
   * Sevk (fiziksel çıkış) — PLANNED → DISPATCHED. Yalnız sevk onayı AÇIKKEN gerekir
   * (kapalıyken createShipment zaten doğrudan dispatch eder). Toplar SHIPPED, tahsisler
   * → shippedQty terfi eder, irsaliye dondurulur. Kapı önü adımı YOK.
   */
  async dispatchShipment(
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, destination: true, sacks: { select: { weightKg: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevkiyat zaten sevk edilmiş");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyat sevk edilebilir");
    if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
    this.assertExportWeighed(shipment.sacks, shipment.destination);

    const shippedRolls = await prisma.$transaction((tx) => this.performDispatchTx(tx, shipmentId, data, userId));
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH", rollCount: shippedRolls, plateNumber: data.plateNumber ?? null, driverName: data.driverName ?? null } });
    return { success: true, data: { shipmentId, rollCount: shippedRolls }, message: "Sevk edildi — stok bina dışı, karşılanma kesinleşti" };
  }

  // =========================================================================
  // İPTAL (yıkıcı) — önizleme + uygula
  // =========================================================================

  /** İptal önizleme — depoya dönecek çuvallar + tahsisi kalkacak siparişler. */
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
   * Sevkiyatı iptal et (soft → CANCELLED). PLANNED iptal edilebilir: çuvallar depoya
   * döner, tahsisler silinir (sipariş bağı kalkar). DISPATCHED iptal edilemez.
   */
  async cancelShipment(shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, _count: { select: { sacks: true } } } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) return { success: true, data: { shipmentId }, message: "Sevkiyat zaten iptal edilmiş" };
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevk edilmiş sevkiyat iptal edilemez");

    await prisma.$transaction(async (tx) => {
      const claim = await tx.shipment.updateMany({ where: { id: shipmentId, status: shipment.status }, data: { status: ShipmentStatus.CANCELLED } });
      if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      // Tahsisleri sil (çuval.shipmentId null'lanmadan ÖNCE — yoksa where eşleşmez) + sipariş defteri.
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      // Lost-update kilidi (performDispatchTx ile simetrik): defter mutasyonu
      // (deleteMany) + recompute, etkilenen siparişlerin TAM satır kümesi kilitliyken
      // koşar — eşzamanlı dispatch/iptal shippedQty'yi eksik yazamaz.
      const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
      const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
      await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
      await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
      // Çuvallar depoya döner; içerik shipmentId null.
      await tx.roll.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
      await tx.swatch.updateMany({ where: { shipmentId }, data: { shipmentId: null } });
      await tx.sack.updateMany({ where: { shipmentId }, data: { shipmentId: null, seq: null } });
      await recomputeOrderStatusForOrders(tx, orderIds);
    });
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "CANCEL", freedSacks: shipment._count.sacks } });
    return { success: true, data: { shipmentId, freedSacks: shipment._count.sacks }, message: "Sevkiyat iptal edildi — çuvallar depoya döndü" };
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

    // --- İÇERİK FİLTRESİ (ürün + renk = TEK TOP eşleşmesi) --------------------
    // itemId/colorId relation alt-sorgusudur (skaler DEĞİL) → SHIPMENT_FILTER_FIELDS'e
    // KOYULMAZ (buildWhereClause skaler bekler). csv → temiz ID listesi. İkisi de
    // seçiliyse AYNI topun HEM üründe HEM renkte olması gerekir (tek `some` bloğu,
    // iki koşul AND — "mavi patos" = aynı topun itemId∈seçili VE colorId∈seçili).
    const csvIds = (v: string | string[] | undefined): string[] => {
      if (v == null) return [];
      const arr = Array.isArray(v) ? v : String(v).split(",");
      return arr.map((s) => s.trim()).filter(Boolean);
    };
    const itemIds = csvIds(params.filters.itemId);
    const colorIds = csvIds(params.filters.colorId);
    const rollMatch: Prisma.RollWhereInput = {};
    if (itemIds.length) rollMatch.itemId = { in: itemIds };
    if (colorIds.length) rollMatch.colorId = { in: colorIds };
    const hasContentFilter = itemIds.length > 0 || colorIds.length > 0;
    // Roll.itemId + Roll.colorId indexli → some alt-sorgusu performanslı.
    if (hasContentFilter) where.rolls = { some: rollMatch };

    // --- İADE FİLTRESİ ("iade içerenler") — basit; iptalsiz iade taşıyan sevkler.
    const hasReturnsFilter = params.filters.hasReturns === "true";
    if (hasReturnsFilter) where.returns = { some: { cancelledAt: null } };

    // destination (DOMESTIC|EXPORT) buildWhereClause tarafından where'e YAZILDI;
    // DirectShipment'ta destination YOK → aktifse doğrudan sevkler union'dan düşer.
    const hasDestinationFilter = safeFilters.destination != null;

    // --- SIRALAMA (whitelist) — createdAt|shipmentNo (ikisi de her iki tabloda
    // NON-NULL var → union keyset güvenli). dispatchedAt BİLİNÇLİ dışarıda: PLANNED'da
    // null olduğundan NULLS sıralaması union keyset'i bozar.
    const SORTABLE = ["createdAt", "shipmentNo"] as const;
    type ShipSortField = (typeof SORTABLE)[number];
    const sortField = resolveSortBy(params.sortBy, SORTABLE, "createdAt") as ShipSortField;
    const sortDir: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
    const shipOrderBy: Prisma.ShipmentOrderByWithRelationInput[] =
      sortField === "shipmentNo"
        ? [{ shipmentNo: sortDir }, { id: sortDir }]
        : [{ createdAt: sortDir }, { id: sortDir }];
    const directOrderBy: Prisma.DirectShipmentOrderByWithRelationInput[] =
      sortField === "shipmentNo"
        ? [{ shipmentNo: sortDir }, { id: sortDir }]
        : [{ createdAt: sortDir }, { id: sortDir }];

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
      branch: { select: { id: true, code: true, name: true } },
      _count: { select: { sacks: true, rolls: true, orders: true, returns: { where: { cancelledAt: null } } } },
    } as const;

    // --- BİRLEŞİK LİSTE: fasondan DOĞRUDAN sevkler (DirectShipment) çuval
    // Shipment'larıyla AYNI listede görünür (nadir ama kayıt altında olmalı).
    // Aynı createdAt-keyed keyset cursor İKİ tabloya da uygulanır; iki desc-sıralı
    // akış merge edilip üstten `limit` alınır → union üzerinde doğru keyset sayfalama
    // (her akıştan limit+1 çekmek top-`limit`'i ve hasMore'u garantiler).
    const directSelect = {
      id: true,
      shipmentNo: true,
      shippedAt: true,
      createdAt: true,
      rollCount: true,
      reason: true,
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      _count: { select: { allocations: true } },
    } as const;
    type ShipRow = Prisma.ShipmentGetPayload<{ select: typeof select }>;
    type DirectRow = Prisma.DirectShipmentGetPayload<{ select: typeof directSelect }>;
    const mapShip = (s: ShipRow) => ({ kind: "SHIPMENT" as const, ...s });
    const mapDirect = (d: DirectRow) => ({
      kind: "DIRECT" as const,
      id: d.id,
      shipmentNo: d.shipmentNo,
      status: ShipmentStatus.DISPATCHED, // doğrudan sevk daima çıkmış say
      plateNumber: null,
      driverName: null,
      carrier: null,
      dispatchedAt: d.shippedAt,
      createdAt: d.createdAt,
      reason: d.reason,
      customer: d.customer,
      branch: d.branch,
      _count: { sacks: 0, rolls: d.rollCount, orders: d._count.allocations, returns: 0 },
    });
    type UnifiedRow = ReturnType<typeof mapShip> | ReturnType<typeof mapDirect>;
    // Union sıralama karşılaştırıcısı — sortField + sortDir'e göre (orderBy ile birebir).
    // Birincil anahtar sortField (createdAt→getTime, shipmentNo→string compare); tie-break
    // DAİMA id, aynı yönde (dynamicCursorWhere tie-break'iyle simetrik).
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: UnifiedRow, b: UnifiedRow): number => {
      const primary =
        sortField === "shipmentNo"
          ? a.shipmentNo < b.shipmentNo
            ? -1
            : a.shipmentNo > b.shipmentNo
              ? 1
              : 0
          : a.createdAt.getTime() - b.createdAt.getTime();
      if (primary !== 0) return dir * primary;
      const idc = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return dir * idc;
    };

    // DirectShipment'ın status'u yok → daima DISPATCHED. Status filtresi DISPATCHED
    // istemiyorsa doğrudan sevkleri union'dan DÜŞ.
    const statusRaw = safeFilters.status;
    const statuses =
      statusRaw == null
        ? null
        : Array.isArray(statusRaw)
          ? statusRaw
          : String(statusRaw).split(",").map((s) => s.trim());
    // DirectShipment'ta status/destination/returns YOK → bu filtreler aktifse doğrudan
    // sevkler union'dan düşer. (İçerik filtresi DÜŞÜRMEZ — DirectShipment.rolls'a uygulanır.)
    const includeDirect =
      (!statuses || statuses.includes(ShipmentStatus.DISPATCHED)) &&
      (!rawStatus || rawStatus === ShipmentStatus.DISPATCHED) &&
      !hasReturnsFilter &&
      !hasDestinationFilter;

    // DirectShipment where — Shipment ile AYNI filtreleri alanlarına eşle.
    const directBaseWhere: Prisma.DirectShipmentWhereInput = {};
    {
      const cust =
        (typeof safeFilters.customerId === "string" ? safeFilters.customerId : undefined) ??
        rawCustomerId;
      if (cust) directBaseWhere.customerId = cust;
      if (typeof safeFilters.branchId === "string") directBaseWhere.branchId = safeFilters.branchId;
      if (params.search)
        directBaseWhere.OR = buildTurkishSearch<Prisma.DirectShipmentWhereInput>(
          params.search,
          ["shipmentNo", "reason", "customer.name"]
        );
      if (params.dateField && (params.dateFrom || params.dateTo)) {
        const range: { gte?: Date; lte?: Date } = {};
        if (params.dateFrom) range.gte = params.dateFrom;
        if (params.dateTo) range.lte = params.dateTo;
        // Shipment.dispatchedAt ≙ DirectShipment.shippedAt.
        if (params.dateField === "createdAt") directBaseWhere.createdAt = range;
        else if (params.dateField === "dispatchedAt") directBaseWhere.shippedAt = range;
      }
      // İçerik filtresi doğrudan sevklere de (DirectShipment.rolls Roll[] — aynı rollMatch).
      if (hasContentFilter) directBaseWhere.rolls = { some: rollMatch };
    }

    // --- EŞLEŞME ROZETİ verisi — SADECE hasContentFilter iken. dataRows'a bağımlı →
    // merge/slice SONRASI ayrı Promise.all (mevcut Promise.all'a EKLENMEZ). tx dışı,
    // salt-okuma (prisma.* global) → Promise.all serbest. hasContentFilter yoksa alan
    // HİÇ eklenmez (matchRollCount undefined kalır).
    const attachBadges = async (
      rows: UnifiedRow[],
    ): Promise<Array<UnifiedRow & { matchRollCount?: number }>> => {
      if (!hasContentFilter) return rows;
      const shipIds = rows.filter((r) => r.kind === "SHIPMENT").map((r) => r.id);
      const directIds = rows.filter((r) => r.kind === "DIRECT").map((r) => r.id);
      const [shipGroups, directGroups] = await Promise.all([
        shipIds.length
          ? prisma.roll.groupBy({
              by: ["shipmentId"],
              where: { shipmentId: { in: shipIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ shipmentId: string | null; _count: { _all: number } }>),
        directIds.length
          ? prisma.roll.groupBy({
              by: ["directShipmentId"],
              where: { directShipmentId: { in: directIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve(
              [] as Array<{ directShipmentId: string | null; _count: { _all: number } }>,
            ),
      ]);
      const shipMap = new Map<string | null, number>(
        shipGroups.map((g): [string | null, number] => [g.shipmentId, g._count._all]),
      );
      const directMap = new Map<string | null, number>(
        directGroups.map((g): [string | null, number] => [g.directShipmentId, g._count._all]),
      );
      return rows.map((r) => ({
        ...r,
        matchRollCount: r.kind === "SHIPMENT" ? (shipMap.get(r.id) ?? 0) : (directMap.get(r.id) ?? 0),
      }));
    };

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cw = cursor ? dynamicCursorWhere(cursor, sortField, sortDir) : null;
      const shipWhere = cw ? { AND: [where, cw] } : where;
      const directWhere = cw ? { AND: [directBaseWhere, cw] } : directBaseWhere;
      const [shipItems, directItems, shipTotal, directTotal] = await Promise.all([
        prisma.shipment.findMany({ where: shipWhere, orderBy: shipOrderBy, take: limit + 1, select }),
        includeDirect
          ? prisma.directShipment.findMany({ where: directWhere, orderBy: directOrderBy, take: limit + 1, select: directSelect })
          : Promise.resolve([] as DirectRow[]),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
        wantTotal && includeDirect ? prisma.directShipment.count({ where: directBaseWhere }) : Promise.resolve(0),
      ]);
      const merged: UnifiedRow[] = [...shipItems.map(mapShip), ...directItems.map(mapDirect)].sort(cmp);
      const hasMore = merged.length > limit;
      const dataRows = hasMore ? merged.slice(0, limit) : merged;
      const last = dataRows[dataRows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortField) : null;
      const totalEstimate = shipTotal !== undefined ? shipTotal + (directTotal ?? 0) : undefined;
      const data = await attachBadges(dataRows);
      return { success: true, data, pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) } };
    }

    const [shipments, directs] = await Promise.all([
      prisma.shipment.findMany({ where, orderBy: shipOrderBy, take: 200, select }),
      includeDirect
        ? prisma.directShipment.findMany({ where: directBaseWhere, orderBy: directOrderBy, take: 200, select: directSelect })
        : Promise.resolve([] as DirectRow[]),
    ]);
    const merged: UnifiedRow[] = [...shipments.map(mapShip), ...directs.map(mapDirect)].sort(cmp).slice(0, 200);
    const data = await attachBadges(merged);
    return { success: true, data };
  }

  /** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik Sevkiyatlar
   *  listesinden açılınca gösterilir. Toplar + karşılanan sipariş satırları +
   *  fason/İE bağlamı; irsaliye SUBCONTRACTOR_DIRECT_SHIP (sourceId=DirectShipment.id). */
  async getDirectShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shippedBy: { select: { fullName: true, username: true } },
        dispatch: {
          select: {
            id: true,
            dispatchNo: true,
            subcontractor: { select: { id: true, name: true, code: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
            step: { select: { stepSequence: true, station: { select: { name: true, code: true } } } },
          },
        },
        rolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        allocations: {
          select: {
            qty: true,
            orderLine: {
              select: {
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
                order: { select: { orderNumber: true } },
              },
            },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");

    return {
      success: true,
      data: {
        id: ds.id,
        kind: "DIRECT" as const,
        shipmentNo: ds.shipmentNo,
        reason: ds.reason,
        totalQty: Number(ds.totalQty),
        rollCount: ds.rollCount,
        shippedAt: ds.shippedAt.toISOString(),
        createdAt: ds.createdAt.toISOString(),
        customer: ds.customer,
        branch: ds.branch,
        shippedBy: ds.shippedBy?.fullName ?? ds.shippedBy?.username ?? null,
        dispatch: {
          id: ds.dispatch.id,
          dispatchNo: ds.dispatch.dispatchNo,
          subcontractor: ds.dispatch.subcontractor,
          workOrder: ds.dispatch.workOrder,
          stationName: ds.dispatch.step.station.name,
          stepSequence: ds.dispatch.step.stepSequence,
        },
        rolls: ds.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          itemName: r.item?.name ?? "",
          colorName: r.color?.name ?? null,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade,
        })),
        allocations: ds.allocations.map((a) => ({
          orderNumber: a.orderLine.order.orderNumber,
          itemName: a.orderLine.item.name,
          colorName: a.orderLine.color?.name ?? null,
          qty: Number(a.qty),
        })),
      },
    };
  }

  /** Sevkiyat detayı — çuvallar + toplar + sipariş bazlı bu-sevkiyat tahsis dökümü. */
  async getShipmentById(id: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true, shipmentNo: true, status: true, destination: true, procedureCode: true,
        plateNumber: true, driverName: true, carrier: true, dispatchedAt: true, createdAt: true,
        dispatchNote: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true,
                    customerItemName: true, customerColorName: true, createdAt: true,
                    item: { select: { id: true, code: true, name: true } },
                    color: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
        },
        rolls: { select: { id: true, barcode: true, itemId: true, colorId: true, width: true, currentQty: true, qualityGrade: true, sackId: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
        swatches: { select: { id: true, barcode: true, length: true, width: true, sackId: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true,
            rolls: { select: { id: true, barcode: true, width: true, currentQty: true, qualityGrade: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
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
        return {
          lineId: l.id,
          item: l.item,
          color: l.color,
          width: l.width,
          customerItemName: l.customerItemName,
          customerColorName: l.customerColorName,
          requested,
          shipped,
          openQty: requested.minus(shipped),
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
      return { id: sk.id, sackNo: sk.sackNo, seq: sk.seq, weightKg: sk.weightKg, rolls: sk.rolls, swatches: sk.swatches, productSummary: [...summaryMap.values()], rollCount: sk.rolls.length, swatchCount: sk.swatches.length };
    });

    const returnRows = await prisma.rollReturn.findMany({
      where: { fromShipmentId: id, cancelledAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, qty: true, width: true, createdAt: true, reasonText: true, prevSackId: true, roll: { select: { barcode: true } }, item: { select: { code: true, name: true } }, color: { select: { code: true, name: true } }, reason: { select: { name: true, color: true } } },
    });
    // prevSackId = iade anındaki çuval (top artık o çuvalda değil ama iz burada); UI
    // sackNo/seq'i sevkiyatın YÜKLÜ sacks[]'ından çözer (çuval sevkiyatta kalır).
    const returnedRolls = returnRows.map((rr) => ({ id: rr.id, barcode: rr.roll.barcode, item: rr.item, color: rr.color, width: rr.width, qty: rr.qty, returnedAt: rr.createdAt, reasonName: rr.reason?.name ?? rr.reasonText ?? null, reasonColor: rr.reason?.color ?? null, prevSackId: rr.prevSackId }));
    const returnedMeters = returnRows.reduce((s, r) => s.plus(r.qty), D0());

    return {
      success: true,
      data: {
        id: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        destination: shipment.destination,
        procedureCode: shipment.procedureCode,
        dispatchNote: shipment.dispatchNote,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        carrier: shipment.carrier,
        dispatchedAt: shipment.dispatchedAt,
        customer: shipment.customer,
        branch: shipment.branch,
        orders,
        rolls: shipment.rolls.map((r) => ({ id: r.id, barcode: r.barcode, item: r.item, color: r.color, width: r.width, currentQty: r.currentQty, qualityGrade: r.qualityGrade, sackId: r.sackId })),
        swatches: shipment.swatches,
        sacks,
        returnedRolls,
        summary: { rollCount: shipment.rolls.length, swatchCount: shipment.swatches.length, totalMeters, sackCount: shipment.sacks.length, totalKg, returnedCount: returnedRolls.length, returnedMeters },
      },
    };
  }

  // =========================================================================
  // SEVK KAPISI — PLANNED board (yalnız sevk-onayı AÇIKKEN dolar)
  // =========================================================================

  /** Sevk Kapısı board LİSTESİ — onay bekleyen PLANNED sevkiyatlar; hafif + cursor. */
  async listSackStoreBoard(params: { status?: string; search?: string; destination?: string; cursor?: string; limit?: number }): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);
    const where: Prisma.ShipmentWhereInput = { status: ShipmentStatus.PLANNED };
    if (params.destination === "DOMESTIC" || params.destination === "EXPORT") {
      where.destination = params.destination as ShipmentDestination;
    }
    const search = params.search?.trim();
    if (search) {
      where.OR = buildTurkishSearch<Prisma.ShipmentWhereInput>(search, ["shipmentNo", "customer.name", "sacks.some.sackNo"]);
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
        branch: { select: { id: true, code: true, name: true } },
        sacks: {
          orderBy: { seq: "asc" },
          select: {
            id: true, sackNo: true, seq: true, weightKg: true,
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
        id: sk.id, sackNo: sk.sackNo, seq: sk.seq, weightKg: sk.weightKg != null ? Number(sk.weightKg) : null,
        rollCount: sk.rolls.length, swatchCount: sk.swatches.length, totalQty: Number(sackQty),
        contents: [...groups.values()].map((g) => ({ itemName: g.itemName, colorName: g.colorName, width: g.width, qty: Number(g.qty), rollCount: g.rollCount })),
        rolls: sk.rolls.map((r) => ({ id: r.id, barcode: r.barcode, qty: Number(r.currentQty), width: r.width != null ? Number(r.width) : null, qualityGrade: r.qualityGrade ?? "", item: r.item, color: r.color })),
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

  /**
   * Muhasebe fişi — fasondan DOĞRUDAN sevk (DirectShipment) sürümü. Çuval Shipment'ının
   * getDispatchReport'u ile AYNI şekli (header/products/sacks/cekiRows/totals) üretir ki
   * muhasebe ekranındaki Fiş dialog'u tek kontratla çalışsın. Doğrudan sevkte ÇUVAL YOK
   * (sacks:[], kg:0, çeki satırları top-başına); ürün gruplaması "İsim Renk Encm." biçimiyle
   * collectShipmentDocContent ile birebir. Baskı/önizleme ayrıca SUBCONTRACTOR_DIRECT_SHIP
   * donmuş irsaliyesinden gelir — bu yalnız Excel/etiket için yapılandırılmış veridir.
   */
  async getDirectShipmentDispatchReport(id: string): Promise<ApiResponse<unknown>> {
    const ds = await prisma.directShipment.findUnique({
      where: { id },
      select: {
        shipmentNo: true,
        shippedAt: true,
        createdAt: true,
        customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
        branch: { select: { code: true, name: true } },
        allocations: { select: { orderLine: { select: { order: { select: { orderNumber: true } } } } } },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
      },
    });
    if (!ds) throw AppError.notFound("Fasondan sevk kaydı bulunamadı");

    const productMap = new Map<string, { name: string; rollCount: number; totalMeters: Prisma.Decimal }>();
    let totalMeters = D0();
    const cekiRows = ds.rolls.map((r) => {
      totalMeters = totalMeters.plus(r.currentQty);
      const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
      const stokAdi = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
      const g = productMap.get(stokAdi) ?? { name: stokAdi, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      productMap.set(stokAdi, g);
      // Çuval yok → sackCode "—", kg top-başına taşınmaz (0).
      return { rollId: r.id, sackCode: "—", barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", meters: Number(r.currentQty), kg: 0 };
    });
    const products = [...productMap.values()].map((p) => ({ name: p.name, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
    const orderNos = [...new Set(ds.allocations.map((a) => a.orderLine.order.orderNumber))].join(", ");

    return {
      success: true,
      data: {
        header: {
          shipmentNo: ds.shipmentNo,
          customerName: ds.customer.name,
          customerCode: ds.customer.code,
          customerTaxNumber: ds.customer.taxNumber ?? null,
          branchName: ds.branch?.name ?? null,
          branchCode: ds.branch?.code ?? null,
          // Şirket ihracat kodu — tek "İhracat Kodu" satırına şube ihracat kodu
          // (branchCode) boşsa yedek olarak basılır (branchCode ?? customerExportCode).
          customerExportCode: ds.customer.exportCode ?? null,
          procedureCode: null,
          destination: ShipmentDestination.DOMESTIC,
          status: ShipmentStatus.DISPATCHED,
          date: ds.shippedAt.toISOString(),
          plateNumber: null,
          driverName: null,
          carrier: null,
          orderNos,
        },
        products,
        sacks: [],
        cekiRows,
        totals: { totalRolls: ds.rolls.length, totalMeters: Number(totalMeters), totalKg: 0, sackCount: 0 },
      },
    };
  }

  // =========================================================================
  // SİPARİŞ SEÇİM EKRANI — açık siparişler + depo karşılaması (paketleme rehberi)
  // =========================================================================

  /**
   * Açık siparişler + her satırda depo karşılaması. openQty = istenen − sevk (rezerv yok).
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
        branch: { select: { id: true, code: true, name: true } },
        lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, customerItemName: true, customerColorName: true, createdAt: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Serbest depo stoğu (sevke-uygun) — spec bazında toplam. Yalnız WAREHOUSE (bitmiş, sevke
    // hazır); ham STOCK sayılmaz — ham satışı nadir/özel talep, "mevcut" göstergesini şişirmesin.
    // (Ham yine de çuvala okutulup sevk EDİLEBİLİR; sadece bu sayaçta görünmez.) sackId:null:
    // çuvaldaki (bekleyen) toplar serbest sayılmaz.
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
        const openQty = requested.minus(shipped);
        const fromWarehouse = specAvail(l);
        return {
          lineId: l.id, item: l.item, color: l.color, width: l.width,
          customerItemName: l.customerItemName, customerColorName: l.customerColorName,
          requested, shipped, openQty, warehouseAvailable: fromWarehouse,
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
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true } },
      branch: { select: { code: true, name: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        select: { seq: true, sackNo: true, weightKg: true, rolls: { orderBy: { createdAt: "asc" }, select: { id: true, barcode: true, currentQty: true, width: true, item: { select: { name: true } }, color: { select: { name: true } } } } },
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
    return { code: sk.sackNo ?? `#${sk.seq}`, seq: sk.seq ?? 0, totalMeters: Number(sackMeters), totalKg: sk.weightKg != null ? Number(sk.weightKg) : 0, packageCount: sk.rolls.length };
  });

  const cekiRows = sh.sacks.flatMap((sk) =>
    sk.rolls.map((r, idx) => ({ rollId: r.id, sackCode: sk.sackNo ?? `#${sk.seq}`, barcode: r.barcode, desen: r.item.name, varyant: r.color?.name ?? "", width: r.width != null ? Number(r.width) : null, meters: Number(r.currentQty), kg: idx === 0 && sk.weightKg != null ? Number(sk.weightKg) : 0 }))
  );

  const products = [...productMap.values()].map((p) => ({ name: p.name, rollCount: p.rollCount, totalMeters: Number(p.totalMeters) }));
  const totalRolls = products.reduce((s, p) => s + p.rollCount, 0);
  const totalMeters = Number(sackRows.reduce((s, r) => s.plus(r.totalMeters), D0()));
  const totalKg = Number(sackRows.reduce((s, r) => s.plus(r.totalKg), D0()));
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");

  return {
    // branchCode = şube ihracat kodu; customerExportCode = şirket ihracat kodu.
    // Belgede TEK "İhracat Kodu" satırı basılır: branchCode ?? customerExportCode
    // (şube önce, boşsa şirket) — "exportCode" section toggle'ıyla açılıp kapanır.
    header: { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, branchName: sh.branch?.name ?? null, branchCode: sh.branch?.code ?? null, customerExportCode: sh.customer.exportCode ?? null, procedureCode: sh.procedureCode, destination: sh.destination, status: sh.status, date: (sh.dispatchedAt ?? sh.createdAt).toISOString(), plateNumber: sh.plateNumber, driverName: sh.driverName, carrier: sh.carrier, orderNos },
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
  // Belge şablon profili: sevkiyatın müşterisine atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return s?.customer?.documentProfileId ?? null;
  },
  // İrsaliye açıklaması — sevkiyata kayıtlı serbest not (annotation). Donmuş belgeye
  // girmez; her baskıda canlı çözülür, düzenlenince tekrar baskıda güncel çıkar.
  resolveLiveNote: async (db, sourceId) => {
    const s = await db.shipment.findUnique({
      where: { id: sourceId },
      select: { dispatchNote: true },
    });
    return s?.dispatchNote ?? null;
  },
});

// =============================================================================
// SEVKİYAT-TÜREVLİ BELGELER — Kalite Sertifikası / Packing List / Commercial Invoice
// =============================================================================
// Aynı Shipment kaynağının farklı görünümleri (sourceId = Shipment.id, her belge
// tipi kendi zinciri). Tek genişletilmiş collector: kalite, ambalaj ve fiyat verisi
// bir sorguda. Fatura fiyatı çuval→SackAllocation→OrderLine.unitPrice'tan türetilir.
async function collectShipmentDerived(db: PrintedDocDb, shipmentId: string) {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      shipmentNo: true, status: true, destination: true, dispatchedAt: true, createdAt: true, procedureCode: true,
      customer: { select: { code: true, name: true, taxNumber: true, exportCode: true, address: true, city: true, country: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        orderBy: { seq: "asc" },
        select: {
          seq: true, sackNo: true, weightKg: true,
          rolls: { orderBy: { createdAt: "asc" }, select: { barcode: true, currentQty: true, width: true, qualityGrade: true, item: { select: { name: true } }, color: { select: { name: true } }, qualityGradeRef: { select: { name: true } } } },
          allocations: { select: { qty: true, orderLine: { select: { unitPrice: true, currency: true, customerItemName: true, item: { select: { name: true } }, color: { select: { name: true } } } } } },
        },
      },
    },
  });
  if (!sh) return null;

  const date = (sh.dispatchedAt ?? sh.createdAt).toISOString();
  const orderNos = [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", ");
  const addr = [sh.customer.address, sh.customer.city, sh.customer.country].filter(Boolean).join(", ") || null;

  // ── Kalite: kalite başına adet/metraj + top dökümü ──
  const gradeMap = new Map<string, { grade: string; rollCount: number; totalMeters: Prisma.Decimal }>();
  const qualityRolls: { sequence: number; barcode: string | null; itemName: string; colorName: string | null; width: number | null; grade: string; meters: number }[] = [];
  let seq = 0;
  for (const sk of sh.sacks) {
    for (const r of sk.rolls) {
      const grade = r.qualityGradeRef?.name ?? r.qualityGrade ?? "Belirsiz";
      const g = gradeMap.get(grade) ?? { grade, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      gradeMap.set(grade, g);
      qualityRolls.push({ sequence: ++seq, barcode: r.barcode, itemName: r.item.name, colorName: r.color?.name ?? null, width: r.width != null ? Number(r.width) : null, grade, meters: Number(r.currentQty) });
    }
  }
  const grades = [...gradeMap.values()].map((g) => ({ grade: g.grade, rollCount: g.rollCount, totalMeters: Number(g.totalMeters) }));
  const totalRolls = qualityRolls.length;
  const totalMeters = Number(qualityRolls.reduce((s, r) => s.plus(r.meters), D0()));

  // ── Ambalaj (packing): çuval bazlı ── (width = çuvaldaki farklı enler, cm)
  const packages = sh.sacks.map((sk) => {
    const contents = [...new Set(sk.rolls.map((r) => `${r.item.name}${r.color?.name ? ` ${r.color.name}` : ""}`))].join(", ");
    const meters = Number(sk.rolls.reduce((s, r) => s.plus(r.currentQty), D0()));
    const widths = [...new Set(sk.rolls.map((r) => (r.width != null ? Math.round(Number(r.width)) : null)).filter((w): w is number => w != null))]
      .sort((a, b) => a - b)
      .join(" / ");
    return { no: sk.sackNo ?? `#${sk.seq}`, contents, width: widths, meters, netKg: sk.weightKg != null ? Number(sk.weightKg) : 0, rollCount: sk.rolls.length };
  });
  const totalNetKg = Number(sh.sacks.reduce((s, sk) => s.plus(sk.weightKg ?? 0), D0()));

  // ── Fatura: allocation → orderLine fiyatı; (açıklama|fiyat|para) bazında grupla ──
  const invMap = new Map<string, { description: string; qty: Prisma.Decimal; unit: string; unitPrice: number | null; currency: string; amount: Prisma.Decimal | null }>();
  let anyPrice = false;
  let currency = "TRY";
  for (const sk of sh.sacks) {
    for (const al of sk.allocations) {
      const ol = al.orderLine;
      const desc = ol.customerItemName?.trim() || `${ol.item.name}${ol.color?.name ? ` · ${ol.color.name}` : ""}`;
      const up = ol.unitPrice != null ? Number(ol.unitPrice) : null;
      if (up != null) anyPrice = true;
      currency = ol.currency;
      const key = `${desc}|${up ?? ""}|${ol.currency}`;
      const row = invMap.get(key) ?? { description: desc, qty: D0(), unit: "m", unitPrice: up, currency: ol.currency, amount: up != null ? D0() : null };
      row.qty = row.qty.plus(al.qty);
      if (up != null && row.amount != null) row.amount = row.amount.plus(new Prisma.Decimal(al.qty).times(up));
      invMap.set(key, row);
    }
  }
  const invoiceLines = [...invMap.values()].map((r) => ({ description: r.description, qty: Number(r.qty), unit: r.unit, unitPrice: r.unitPrice, amount: r.amount != null ? Number(r.amount) : null }));
  const curTotals = new Map<string, Prisma.Decimal>();
  for (const r of invMap.values()) {
    if (r.amount != null) curTotals.set(r.currency, (curTotals.get(r.currency) ?? D0()).plus(r.amount));
  }
  const invoiceTotals = [...curTotals.entries()].map(([currency, amount]) => ({ currency, amount: Number(amount) }));

  const header = { shipmentNo: sh.shipmentNo, customerName: sh.customer.name, customerCode: sh.customer.code, customerTaxNumber: sh.customer.taxNumber ?? null, customerAddress: addr, date, orderNos, procedureCode: sh.procedureCode };
  return { header, destination: sh.destination, grades, qualityRolls, packages, invoiceLines, invoiceTotals, currency, hasPrices: anyPrice, totals: { totalRolls, totalMeters, totalNetKg } };
}

async function buildQualityCertificateDoc(db: PrintedDocDb, shipmentId: string): Promise<BuiltDocContent | null> {
  const c = await collectShipmentDerived(db, shipmentId);
  if (!c) return null;
  const doc: QualityCertificateDoc = {
    header: { shipmentNo: c.header.shipmentNo, customerName: c.header.customerName, customerCode: c.header.customerCode, date: c.header.date, orderNos: c.header.orderNos },
    grades: c.grades,
    rolls: c.qualityRolls,
    totals: { rollCount: c.totals.totalRolls, totalMeters: c.totals.totalMeters },
  };
  return { documentNo: c.header.shipmentNo, doc: doc as unknown as Record<string, unknown> };
}

// Sevkiyat-türevli belgelerin ortak profil çözücüsü (müşteri profili).
const resolveShipmentProfileId = async (db: PrintedDocDb, sourceId: string) => {
  const s = await db.shipment.findUnique({ where: { id: sourceId }, select: { customer: { select: { documentProfileId: true } } } });
  return s?.customer?.documentProfileId ?? null;
};

registerPrintedDocBuilder(PrintedDocType.QUALITY_CERTIFICATE, { fresh: buildQualityCertificateDoc, renderHtml: renderQualityCertificateHtml, resolveProfileId: resolveShipmentProfileId });
