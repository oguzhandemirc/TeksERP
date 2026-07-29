// =============================================================================
// Return Service — Müşteri İade Girişi (RollReturn)
// =============================================================================
// QR ile sevk edilmiş top okutulur → doğrudan Hazır Depo'ya (WAREHOUSE) alınır.
// Akış:
//   1) lookupForReturn(barcode) → top + sevkiyat + ADAY siparişler (sevkiyatın
//      spec'e uyan siparişleri) + returnGradingEnabled bayrağı.
//   2) createReturn(input)      → tek transaction:
//        - RollReturn yaz (spec snapshot + neden + not + seçilen sipariş)
//        - Roll: SHIPPED→WAREHOUSE, shipmentId/sackId temizle; flag açık + override
//          verildiyse qualityGrade(+Id) güncelle (flag kapalıysa override YOK SAYILIR)
//        - SEVK MUHASEBESİNE DOKUNULMAZ (shippedQty/allocation) → sipariş kapalı kalır.
//   3) listReturns(req)         → İade Takibi raporu (filtre + toplam).
//
// GEVŞEK MODEL: top↔sipariş bağı yok; top yalnız geldiği sevkiyatı bilir. "Hangi
// siparişten" sorusu personelin sevkiyat aday siparişlerinden seçimiyle cevaplanır.
// =============================================================================

import { Prisma, RollStatus, OrderStatus, PrintedDocType } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import { renderReturnDispatchHtml, type ReturnDispatchDoc } from "./document-render/return-dispatch.html";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readReturnGradingEnabled } from "./system-setting.service";
import { ApiResponse } from "../types/api.types";
import type { Request } from "express";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
} from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";

const D0 = () => new Prisma.Decimal(0);

// item kesin; renk/en ikisi de doluysa eşit olmalı, biri null ise gevşek eşleşir
// (shipping.service.allocate ile aynı semantik — fungible spec havuzu).
function specMatch(
  a: { itemId: string; colorId: string | null; width: Prisma.Decimal | null },
  b: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }
): boolean {
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  if (
    a.width != null &&
    b.width != null &&
    !new Prisma.Decimal(a.width).equals(new Prisma.Decimal(b.width))
  ) {
    return false;
  }
  return true;
}

// Rapor filtreleri — serbest metin alanlarında OR-contains + createdAt tarih penceresi.
// Arama kapsamı liste kolonlarıyla hizalı: neden/not + müşteri + sipariş no +
// ürün adı + top barkodu (iade hacmi düşük — contains kabul edilebilir).
const RETURN_SEARCH_FIELDS = [
  "reasonText",
  "note",
  "customer.name",
  "order.orderNumber",
  "item.name",
  "roll.barcode",
];
const RETURN_DATE_FIELDS = ["createdAt"] as const;

export class ReturnService {
  // =========================================================================
  // LOOKUP — QR okut → iade ekranı için top + aday siparişler
  // =========================================================================
  async lookupForReturn(barcode: string): Promise<ApiResponse<unknown>> {
    const code = barcode.trim();
    if (!code) throw AppError.badRequest("Barkod gerekli");

    const roll = await prisma.roll.findUnique({
      where: { barcode: code },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        qualityGrade: true,
        qualityGradeId: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            dispatchedAt: true,
            customer: { select: { id: true, code: true, name: true } },
            branch: { select: { id: true, name: true } },
            orders: {
              select: {
                order: {
                  select: {
                    id: true,
                    orderNumber: true,
                    status: true,
                    deadline: true,
                    lines: {
                      select: {
                        id: true,
                        itemId: true,
                        colorId: true,
                        width: true,
                        quantity: true,
                        shippedQty: true,
                        customerItemName: true,
                        customerColorName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound(`Top bulunamadı: ${code}`);
    if (roll.status !== RollStatus.SHIPPED) {
      throw AppError.badRequest(
        `Bu top sevk edilmemiş (durum: ${roll.status}) — iade alınamaz.`
      );
    }
    if (!roll.shipment) {
      throw AppError.badRequest("Bu topun sevkiyat bağı yok — iade alınamaz.");
    }

    const rollSpec = { itemId: roll.itemId, colorId: roll.colorId, width: roll.width };
    // Aday siparişler: sevkiyatın, İPTAL DEĞİL ve topun spec'ine uyan satırı olan siparişleri.
    const candidateOrders = roll.shipment.orders
      .map((so) => so.order)
      .filter((o) => o.status !== OrderStatus.CANCELLED && o.lines.some((l) => specMatch(l, rollSpec)))
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        deadline: o.deadline,
        matchingLines: o.lines
          .filter((l) => specMatch(l, rollSpec))
          .map((l) => ({
            lineId: l.id,
            quantity: l.quantity,
            shippedQty: l.shippedQty,
            customerItemName: l.customerItemName,
            customerColorName: l.customerColorName,
          })),
      }));

    const returnGradingEnabled = await readReturnGradingEnabled();

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          item: roll.item,
          color: roll.color,
          width: roll.width,
          currentQty: roll.currentQty,
          qualityGrade: roll.qualityGrade,
          qualityGradeRef: roll.qualityGradeRef,
        },
        shipment: {
          id: roll.shipment.id,
          shipmentNo: roll.shipment.shipmentNo,
          dispatchedAt: roll.shipment.dispatchedAt,
        },
        customer: roll.shipment.customer,
        branch: roll.shipment.branch,
        candidateOrders, // tek aday → frontend otomatik seçer
        returnGradingEnabled,
      },
    };
  }

  // =========================================================================
  // CREATE — iade al → top Hazır Depo'ya, defter kaydı
  // =========================================================================
  async createReturn(
    input: {
      rollId: string;
      orderId?: string | null;
      reasonId?: string | null;
      reasonText?: string | null;
      note?: string | null;
      qualityGradeId?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const roll = await prisma.roll.findUnique({
      where: { id: input.rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        qualityGrade: true,
        qualityGradeId: true,
        shipmentId: true,
        sackId: true,
        shipment: {
          select: {
            id: true,
            customerId: true,
            orders: {
              select: {
                orderId: true,
                order: {
                  select: {
                    status: true,
                    lines: { select: { itemId: true, colorId: true, width: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.SHIPPED) {
      throw AppError.badRequest(
        `Bu top sevk edilmemiş (durum: ${roll.status}) — iade alınamaz.`
      );
    }
    if (!roll.shipment || !roll.shipmentId) {
      throw AppError.badRequest("Bu topun sevkiyat bağı yok — iade alınamaz.");
    }
    const customerId = roll.shipment.customerId;

    // Sipariş atfı — verildiyse aday kriterini sağlamalı: bu sevkiyatta + iptal değil
    // + topun spec'ine (ürün+renk+en) uyan satırı olmalı (lookup'taki aday mantığının aynısı).
    let orderId: string | null = null;
    if (input.orderId) {
      const link = roll.shipment.orders.find((o) => o.orderId === input.orderId);
      if (!link) {
        throw AppError.badRequest("Seçilen sipariş bu topun sevkiyatına ait değil");
      }
      if (link.order.status === OrderStatus.CANCELLED) {
        throw AppError.badRequest("İptal edilmiş sipariş seçilemez");
      }
      const rollSpec = { itemId: roll.itemId, colorId: roll.colorId, width: roll.width };
      if (!link.order.lines.some((l) => specMatch(l, rollSpec))) {
        throw AppError.badRequest("Seçilen sipariş bu topun ürün/renk/en bilgisine uymuyor");
      }
      orderId = input.orderId;
    }

    // İade nedeni ZORUNLU — en az biri: katalog nedeni VEYA serbest metin açıklama.
    // (Nedensiz iade kalite geri-besleme verisini değersizleştirir.)
    const reasonText = input.reasonText?.trim() || null;
    if (!input.reasonId && !reasonText) {
      throw AppError.badRequest(
        "İade nedeni gerekli — katalogdan bir neden seçin veya açıklama yazın."
      );
    }
    // Neden seçildiyse var olmalı (pasif neden de seçilebilir — snapshot için sorun değil).
    if (input.reasonId) {
      const reason = await prisma.returnReason.findUnique({
        where: { id: input.reasonId },
        select: { id: true },
      });
      if (!reason) throw AppError.badRequest("İade nedeni bulunamadı");
    }

    // Kalite override — YALNIZ returnGradingEnabled açıkken honor edilir. Override
    // varsa topun gideceği raf = seçilen kalitenin returnTargetStatus'u (FİRE→SCRAP,
    // A1→A1_STOCK, 1.Kalite→WAREHOUSE). Bu kolon Tambur'un targetStatus'undan AYRIDIR
    // (Tambur'a dokunmaz). Override yoksa / flag kapalıysa top hep WAREHOUSE'a iner.
    const gradingEnabled = await readReturnGradingEnabled();
    let overrideQualityGradeId: string | null = null;
    let overrideQualityCode: string | null = null;
    let appliedStatus: RollStatus = RollStatus.WAREHOUSE;
    if (gradingEnabled && input.qualityGradeId) {
      const qg = await prisma.qualityGrade.findUnique({
        where: { id: input.qualityGradeId },
        select: { id: true, code: true, isActive: true, returnTargetStatus: true },
      });
      // Soft-delete giriş guard'ı (createInitialEntry/tambur/resolveQualityGradeIdStrict
      // ile parite): pasif kalite ile iade rafına atama yapılamaz.
      if (!qg || !qg.isActive) {
        throw AppError.badRequest("Kalite derecesi bulunamadı veya pasif");
      }
      overrideQualityGradeId = qg.id;
      overrideQualityCode = qg.code;
      appliedStatus = qg.returnTargetStatus ?? RollStatus.WAREHOUSE;
    }

    const qty = new Prisma.Decimal(roll.currentQty);
    const note = input.note?.trim() || null;

    const created = await prisma.$transaction(async (tx) => {
      // Top iade rafına — appliedStatus (override yoksa WAREHOUSE; FİRE→SCRAP vb.).
      // KOŞULLU flip (status===SHIPPED): eşzamanlı/çift iade'de yalnız ilki başarılı
      // olur; ikincisi count=0 görür → tüm tx geri sarılır, çift RollReturn yazılmaz.
      const flip = await tx.roll.updateMany({
        where: { id: roll.id, status: RollStatus.SHIPPED },
        data: {
          status: appliedStatus,
          shipmentId: null,
          sackId: null,
          ...(overrideQualityGradeId
            ? { qualityGradeId: overrideQualityGradeId, qualityGrade: overrideQualityCode! }
            : {}),
        },
      });
      if (flip.count === 0) {
        throw AppError.conflict("Bu top zaten iade alınmış veya durumu değişmiş.");
      }
      const rr = await tx.rollReturn.create({
        data: {
          rollId: roll.id,
          fromShipmentId: roll.shipmentId,
          customerId,
          orderId,
          itemId: roll.itemId,
          colorId: roll.colorId,
          width: roll.width,
          qty,
          reasonId: input.reasonId ?? null,
          reasonText,
          note,
          qualityGradeId: overrideQualityGradeId,
          appliedStatus,
          receivedById: userId,
          // İade öncesi snapshot — iptal (geri al) topu bunlarla eski haline döndürür.
          prevSackId: roll.sackId,
          prevQualityGrade: roll.qualityGrade,
          prevQualityGradeId: roll.qualityGradeId,
        },
        select: { id: true },
      });
      return rr;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_RETURN",
      recordId: created.id,
      newData: {
        rollId: roll.id,
        barcode: roll.barcode,
        fromShipmentId: roll.shipmentId,
        customerId,
        orderId,
        qty: qty.toString(),
        reasonId: input.reasonId ?? null,
        qualityGradeId: overrideQualityGradeId,
        appliedStatus,
      },
    });

    const shelfLabel =
      appliedStatus === RollStatus.SCRAP
        ? "hurdaya"
        : appliedStatus === RollStatus.A1_STOCK
          ? "2. kalite stoğa"
          : "Hazır Depo'ya";
    return {
      success: true,
      data: { id: created.id, rollId: roll.id, appliedStatus },
      message: `İade alındı — top ${shelfLabel} eklendi`,
    };
  }

  // =========================================================================
  // LİSTE — İade Takibi raporu (filtre + toplam)
  // =========================================================================
  async listReturns(req: Request): Promise<Record<string, unknown>> {
    const params = parseQueryParams(req);

    // İptal durumu — Electron FilterBar `filter[cancelled]` ile, doğrudan/legacy
    // çağrılar `?cancelled=` ham param ile gönderir. RollReturn'de `cancelled`
    // kolonu YOK (yalnız `cancelledAt`); generic buildWhereClause'a `where.cancelled`
    // olarak sızarsa Prisma validation (HTTP 500) verir → filters'tan ayıklayıp
    // ayrı yorumluyoruz.
    const cancelledParam =
      (Array.isArray(params.filters.cancelled)
        ? params.filters.cancelled[0]
        : params.filters.cancelled) ??
      (req.query.cancelled as string | undefined) ??
      "active";
    delete params.filters.cancelled;

    // L (düşük bulgu): filter[] anahtarları whitelist'ten geçer — bilinmeyen
    // anahtar generic buildWhereClause üzerinden Prisma validation 500'üne
    // dönüşüyordu (base.service safeFilters davranışının yereli: sessiz düş).
    const ALLOWED_RETURN_FILTERS = new Set([
      "customerId", "orderId", "itemId", "colorId", "reasonId",
      "qualityGradeId", "rollId", "fromShipmentId", "receivedById",
    ]);
    for (const key of Object.keys(params.filters)) {
      if (!ALLOWED_RETURN_FILTERS.has(key)) delete params.filters[key];
    }

    const where = buildWhereClause(
      params.filters,
      RETURN_SEARCH_FIELDS,
      params.search
    ) as Prisma.RollReturnWhereInput;
    applyDateRange(where as Record<string, unknown>, params, RETURN_DATE_FIELDS);

    // Ham query geri-uyumu (filter[] değil): customerId / orderId / itemId / reasonId
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;
    const rawOrderId = req.query.orderId as string | undefined;
    if (rawOrderId) where.orderId = rawOrderId;
    const rawItemId = req.query.itemId as string | undefined;
    if (rawItemId) where.itemId = rawItemId;
    const rawReasonId = req.query.reasonId as string | undefined;
    if (rawReasonId) where.reasonId = rawReasonId;

    // İptal filtresi: default yalnız AKTİF (iptal edilmemiş) — rapor/özet iptalleri
    // saymaz. "cancelled" → yalnız iptaller; "all" → hepsi (iptaller İptal rozetiyle).
    if (cancelledParam === "cancelled") where.cancelledAt = { not: null };
    else if (cancelledParam !== "all") where.cancelledAt = null;

    const select = {
      id: true,
      qty: true,
      width: true,
      reasonText: true,
      note: true,
      createdAt: true,
      roll: { select: { id: true, barcode: true } },
      item: { select: { id: true, code: true, name: true } },
      color: { select: { id: true, code: true, name: true } },
      customer: { select: { id: true, code: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      reason: { select: { id: true, code: true, name: true, color: true } },
      qualityGrade: { select: { id: true, code: true, name: true, color: true } },
      appliedStatus: true,
      fromShipment: { select: { id: true, shipmentNo: true } },
      receivedBy: { select: { id: true, fullName: true } },
      cancelledAt: true,
      cancelReason: true,
      cancelledBy: { select: { id: true, fullName: true } },
    } as const;

    // Toplam (filtreli set) — "ne kadar iade geldi" (adet + metraj). where ile aynı.
    const summarize = async () => {
      const agg = await prisma.rollReturn.aggregate({
        where,
        _sum: { qty: true },
        _count: { _all: true },
      });
      return { count: agg._count._all, totalQty: agg._sum.qty ?? D0() };
    };

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhere = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, summary] = await Promise.all([
        prisma.rollReturn.findMany({
          where: cursorWhere,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select,
        }),
        wantTotal ? summarize() : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          // Electron useDataTable satır sayısını buradan okur; özet adet = toplam.
          ...(summary !== undefined ? { totalEstimate: summary.count } : {}),
        },
        ...(summary !== undefined ? { summary } : {}),
      };
    }

    const [items, summary] = await Promise.all([
      prisma.rollReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        select,
      }),
      summarize(),
    ]);
    return { success: true, data: items, summary };
  }

  // =========================================================================
  // DETAY — tek iade kaydı (mobil geçmiş ekranı detay sheet'i)
  // =========================================================================
  async getReturnById(id: string): Promise<ApiResponse<unknown>> {
    const r = await prisma.rollReturn.findUnique({
      where: { id },
      select: {
        id: true,
        qty: true,
        width: true,
        reasonText: true,
        note: true,
        createdAt: true,
        cancelledAt: true,
        cancelReason: true,
        roll: { select: { id: true, barcode: true, status: true } },
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        reason: { select: { id: true, code: true, name: true, color: true } },
        qualityGrade: { select: { id: true, code: true, name: true, color: true } },
        appliedStatus: true,
        fromShipment: { select: { id: true, shipmentNo: true } },
        receivedBy: { select: { id: true, fullName: true } },
        cancelledBy: { select: { id: true, fullName: true } },
      },
    });
    if (!r) throw AppError.notFound("İade kaydı bulunamadı");
    return { success: true, data: r };
  }

  // =========================================================================
  // İPTAL (geri al) — yanlış iade kabulü. Top iade öncesi haline döner (SHIPPED +
  // eski sevkiyat/çuval/kalite); RollReturn iptal işaretlenir (sebep + kim). Yalnız
  // top hâlâ iade-sonrası durumdaysa (WAREHOUSE + sevkiyatsız) yapılabilir; sonradan
  // yeniden sevk/kesim görmüşse engellenir. Sevk muhasebesi zaten dokunulmamıştı → simetrik.
  // =========================================================================
  async cancelReturn(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();
    const trimmedReason = (reason ?? "").trim();
    if (trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi gerekli (en az 3 karakter).");
    }

    const rr = await prisma.rollReturn.findUnique({
      where: { id },
      select: {
        id: true,
        cancelledAt: true,
        createdAt: true,
        rollId: true,
        fromShipmentId: true,
        // İadede uygulanan kalite override'ı (varsa) — iptalde geri alma koşulu.
        qualityGradeId: true,
        prevSackId: true,
        prevQualityGrade: true,
        prevQualityGradeId: true,
        appliedStatus: true,
        roll: { select: { barcode: true, status: true, shipmentId: true, sackId: true } },
      },
    });
    if (!rr) throw AppError.notFound("İade kaydı bulunamadı");
    if (rr.cancelledAt) throw AppError.conflict("Bu iade zaten iptal edilmiş.");
    // İade anında topa uygulanan raf (override yoksa / legacy null → WAREHOUSE). Top hâlâ
    // tam bu raftaysa, sevkiyatsız VE çuvalsızsa iptal edilebilir; sonradan kesim /
    // yeniden sevk / yeni depo çuvalına okutma → engel. (İade topu çuvalsız bırakır —
    // sackId dolu = iade sonrası yeni çuvala girmiş; sessizce sökülmesin, çuval
    // tartısı/içeriği bayatlar.)
    const expectedStatus = rr.appliedStatus ?? RollStatus.WAREHOUSE;
    if (
      rr.roll.status !== expectedStatus ||
      rr.roll.shipmentId !== null ||
      rr.roll.sackId !== null
    ) {
      throw AppError.conflict(
        rr.roll.sackId !== null
          ? "Top iade sonrası bir depo çuvalına konmuş — önce çuvaldan çıkarın, sonra iadeyi iptal edin."
          : `Top iade sonrası işlem görmüş (durum: ${rr.roll.status}) — iade iptal edilemez.`
      );
    }
    if (!rr.fromShipmentId) {
      throw AppError.conflict("İadenin sevkiyat bağı yok — geri alınamaz.");
    }

    // RECENCY GUARD'I: iptal yalnız topun EN SON aktif iadesinde yapılabilir.
    // Sevk→iade R1→yeniden sevk→iade R2 geçmişinde R1 yanlışlıkla iptal
    // edilirse şekil-kontrolleri geçer ve top YILLAR ÖNCEKİ sevkiyata (R1.
    // fromShipmentId) SHIPPED yazılır, eski kalite etiketini giyerdi.
    const newerReturn = await prisma.rollReturn.findFirst({
      where: {
        rollId: rr.rollId,
        cancelledAt: null,
        createdAt: { gt: rr.createdAt },
      },
      select: { id: true },
    });
    if (newerReturn) {
      throw AppError.conflict(
        "Bu topun daha yeni bir iade kaydı var — önce onu iptal edin."
      );
    }

    // Eski çuval hâlâ duruyor mu? (sevkiyat iptalinde çuvallar silinmiş olabilir) →
    // yoksa çuvalsız geri yaz (FK ihlalini önle).
    let restoreSackId = rr.prevSackId;
    if (restoreSackId) {
      const sack = await prisma.sack.findUnique({
        where: { id: restoreSackId },
        select: { id: true },
      });
      if (!sack) restoreSackId = null;
    }

    await prisma.$transaction(async (tx) => {
      // KOŞULLU geri-yükleme: yalnız hâlâ iade rafında + sevkiyatsız + ÇUVALSIZ ise
      // (eşzamanlı koruması — pre-check'in atomik hali).
      const restore = await tx.roll.updateMany({
        where: { id: rr.rollId, status: expectedStatus, shipmentId: null, sackId: null },
        data: {
          status: RollStatus.SHIPPED,
          shipmentId: rr.fromShipmentId,
          sackId: restoreSackId,
          // Kalite override'ı İADEDE uygulandıysa (rr.qualityGradeId dolu) snapshot'a
          // geri dön. Koşul "override var mıydı"dır, "eski kalite dolu muydu" DEĞİL:
          // kalitesiz (null) sevk edilmiş top iade + A1 override + iptal edildiğinde
          // eski koşul override'ı geri almıyor, top SHIPPED'e A1 etiketiyle dönüyordu.
          // Snapshot null olabilir — null geri yazmak doğru davranıştır.
          ...(rr.qualityGradeId != null
            ? { qualityGrade: rr.prevQualityGrade, qualityGradeId: rr.prevQualityGradeId }
            : {}),
        },
      });
      if (restore.count === 0) {
        throw AppError.conflict("Top iade sonrası işlem görmüş — iade iptal edilemez.");
      }
      await tx.rollReturn.update({
        where: { id: rr.id },
        data: { cancelledAt: new Date(), cancelReason: trimmedReason, cancelledById: userId },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_RETURN",
      recordId: rr.id,
      newData: {
        kind: "CANCEL",
        reason: trimmedReason,
        rollId: rr.rollId,
        barcode: rr.roll.barcode,
        restoredToShipmentId: rr.fromShipmentId,
      },
    });

    return {
      success: true,
      data: { id: rr.id, rollId: rr.rollId },
      message: "İade iptal edildi — top sevkiyatına geri döndü",
    };
  }

  // =========================================================================
  // DÜZELT — yalnız defter alanları (neden + not). Topun statüsü / sevkiyat bağı /
  // kalitesi DEĞİŞMEZ (onu düzeltmek gerekirse iptal+yeniden iade). İptal edilmiş
  // kayıt düzeltilemez. Neden zorunluluğu burada da korunur (her ikisi de boşalamaz).
  // =========================================================================
  async editReturn(
    id: string,
    input: { reasonId?: string | null; reasonText?: string | null; note?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const rr = await prisma.rollReturn.findUnique({
      where: { id },
      select: { id: true, cancelledAt: true, reasonId: true, reasonText: true, note: true, rollId: true },
    });
    if (!rr) throw AppError.notFound("İade kaydı bulunamadı");
    if (rr.cancelledAt) throw AppError.conflict("İptal edilmiş iade düzeltilemez.");

    // undefined = dokunma; null/boş = temizle. Mevcut değerle birleştirip son hâli doğrula.
    const nextReasonId = input.reasonId !== undefined ? input.reasonId || null : rr.reasonId;
    const nextReasonText =
      input.reasonText !== undefined ? input.reasonText?.trim() || null : rr.reasonText;
    const nextNote = input.note !== undefined ? input.note?.trim() || null : rr.note;

    if (!nextReasonId && !nextReasonText) {
      throw AppError.badRequest(
        "İade nedeni gerekli — katalogdan bir neden seçin veya açıklama yazın."
      );
    }
    if (nextReasonId) {
      const reason = await prisma.returnReason.findUnique({
        where: { id: nextReasonId },
        select: { id: true },
      });
      if (!reason) throw AppError.badRequest("İade nedeni bulunamadı");
    }

    // F198: Atomik claim — eşzamanlı cancelReturn ile yarışta düzeltmeyi deterministik
    // reddet (cancelledAt guard update WHERE'inde — check-then-act değil).
    const updated = await prisma.rollReturn.updateMany({
      where: { id: rr.id, cancelledAt: null },
      data: { reasonId: nextReasonId, reasonText: nextReasonText, note: nextNote },
    });
    if (updated.count === 0) {
      throw AppError.conflict("İptal edilmiş iade düzeltilemez.");
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_RETURN",
      recordId: rr.id,
      oldData: { reasonId: rr.reasonId, reasonText: rr.reasonText, note: rr.note },
      newData: { kind: "EDIT", reasonId: nextReasonId, reasonText: nextReasonText, note: nextNote },
    });

    return {
      success: true,
      data: { id: rr.id, rollId: rr.rollId },
      message: "İade kaydı güncellendi",
    };
  }
}

export const returnService = new ReturnService();

// =============================================================================
// RESMİ BELGE — İade İrsaliyesi (PrintedDocument)
// =============================================================================
// Müşteriden dönen topun kabul belgesi. sourceId = RollReturn.id (top-başına).
// İade iptali (cancelledAt) → belge VOIDED. Belge no yok → createdAt + kısa id'den
// okunur bir numara türetilir (IADE-GGAAYY-XXXXXX).
async function buildReturnDispatchDoc(
  db: PrintedDocDb,
  returnId: string,
): Promise<BuiltDocContent | null> {
  const rr = await db.rollReturn.findUnique({
    where: { id: returnId },
    select: {
      id: true, qty: true, width: true, createdAt: true, reasonText: true, note: true,
      cancelledAt: true, cancelReason: true,
      customer: { select: { code: true, name: true } },
      order: { select: { orderNumber: true } },
      fromShipment: { select: { shipmentNo: true } },
      reason: { select: { name: true } },
      item: { select: { name: true } },
      color: { select: { name: true } },
      qualityGrade: { select: { name: true } },
      roll: { select: { barcode: true } },
      receivedBy: { select: { fullName: true } },
    },
  });
  if (!rr) return null;

  const d = rr.createdAt;
  const p = (x: number) => String(x).padStart(2, "0");
  const documentNo = `IADE-${p(d.getDate())}${p(d.getMonth() + 1)}${String(d.getFullYear()).slice(2)}-${rr.id.slice(0, 6).toUpperCase()}`;

  const doc: ReturnDispatchDoc = {
    header: {
      documentNo,
      customerName: rr.customer.name,
      customerCode: rr.customer.code,
      date: rr.createdAt.toISOString(),
      fromShipmentNo: rr.fromShipment?.shipmentNo ?? null,
      orderNo: rr.order?.orderNumber ?? null,
    },
    line: {
      barcode: rr.roll?.barcode ?? null,
      itemName: rr.item.name,
      colorName: rr.color?.name ?? null,
      width: rr.width != null ? Number(rr.width) : null,
      qty: Number(rr.qty),
      grade: rr.qualityGrade?.name ?? "",
    },
    reason: rr.reason?.name ?? rr.reasonText ?? null,
    note: rr.note ?? null,
    receivedBy: rr.receivedBy?.fullName ?? null,
  };

  return {
    documentNo,
    voidInfo: rr.cancelledAt ? { reason: rr.cancelReason ?? null, at: rr.cancelledAt } : null,
    doc: doc as unknown as Record<string, unknown>,
  };
}

registerPrintedDocBuilder(PrintedDocType.RETURN_DISPATCH, {
  fresh: buildReturnDispatchDoc,
  renderHtml: renderReturnDispatchHtml,
  resolveProfileId: async (db, sourceId) => {
    const r = await db.rollReturn.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return r?.customer?.documentProfileId ?? null;
  },
});
