// =============================================================================
// Order Service / available
// =============================================================================
// İş emrine açılabilir siparişler / sipariş kalemleri ve spec başına üretimdeki miktar.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (cephe order.service.ts sayılır) */

import prisma from "../../lib/prisma";
import { CursorPaginatedResponse } from "../base.service";
import { ApiResponse, PaginatedResponse } from "../../types/api.types";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import { AppError } from "../../utils/app-error";
import {
  OrderStatus,
  Prisma,
  WorkOrderStatus,
} from "@prisma/client";
import { isMeasuredLine, openLineWhere, someOpenLine } from "../helpers/order-line-scope.helper";
import { computeLineCoverage, computeWoMaterial } from "../helpers/coverage.helper";
import {
  applyDateRange,
  buildOrderByClause,
  buildPagination,
  buildTextSearch,
  buildWhereClause,
  parseQueryParams,
} from "../../utils/query-parser";
import { Request } from "express";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import type { OrderServiceThis } from "./shared";

export async function findAvailableForWorkOrder(this: OrderServiceThis, 
    req: Request
  ): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // Search'i `buildWhereClause`'a vermiyoruz; picker'da arama relation'lara
    // (müşteri adı, kalem ürün adı) genişletiliyor — kendi OR'umuzu kuruyoruz.
    const baseWhere = buildWhereClause(
      params.filters,
      this.config.searchFields
    );
    applyDateRange(baseWhere, params, this.config.dateFields ?? []);

    const search = params.search?.trim();
    if (search) {
      baseWhere.OR = buildTextSearch<Prisma.OrderWhereInput>(search, {
        text: [
          "customer.name",
          "lines.some.item.name",
          "lines.some.customerItemName",
          "lines.some.item.customerAliases.some.alias",
        ],
        code: ["orderNumber"],
      });
    }

    // Gap-bazlı picker: bir satır "müsait" ise Açık > 0.
    //   Açık = quantity − sevk (OrderLine.shippedQty). WO bağı açığı ETKİLEMEZ —
    //   sipariş ancak sevk edilince kapanır, üretime girince değil (gevşek model).
    // Kapalı/iptal sipariş hariç (gap hesabı yalnız açık siparişlerde anlamlı).
    // F147: açık-satır koşulunu WHERE'e taşı → 500-tavanı yalnız açık siparişlere
    // harcanır (memory filtresi `lines.length>0` zaten kapalıları eliyordu; özdeş).
    // F150: filter[status] (buildWhereClause → baseWhere.status) notIn ile EZİLMESİN —
    // AND ile birleştir (picker daima iptal/tamamlanmışı eler; ek statü onu daraltır).
    const { status: filterStatus, ...restBase } = baseWhere;
    const where: Prisma.OrderWhereInput = {
      ...restBase,
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
      // Aktif + açık kalem — tek kaynak (iptal edilmiş kalem talep sayılmaz).
      ...someOpenLine(prisma.orderLine.fields),
      ...(filterStatus !== undefined
        ? { AND: [{ status: filterStatus as Prisma.OrderWhereInput["status"] }] }
        : {}),
    };

    // sortBy güvenlik süzgeci (BaseService) — bilinmeyen kolon 500'ünü engeller.
    const orderBy = buildOrderByClause(
      this.safeSortBy(params.sortBy || "createdAt"),
      params.sortOrder
    );

    // Aday açık siparişleri display include + satır tahsisleriyle çek (picker tavanı 500).
    const orders = await prisma.order.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        customer: true,
        branch: { select: { id: true, name: true, code: true, city: true, district: true } },
        lines: {
          include: {
            // item.allowedProperties picker sonucunda KULLANILMIYOR (TargetPropertyPicker
            // ayrı item sorgusundan alır) — over-fetch'i kaldır. requiredProperties
            // ise OrderPickerDialog'da gösteriliyor → kalır.
            item: true,
            color: true,
            requiredProperties: { include: { property: true } },
          },
        },
      },
    });

    // Kapsama (yalnız sevk) — tüm aday satırlar için tek hesap.
    const allLineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const covMap = await computeLineCoverage(prisma, allLineIds);

    // Her sipariş için Açık>0 satırları süz + kovaları satıra ekle (UI'da göster).
    const enriched = orders
      .map((order) => {
        const lines = order.lines
          .map((line) => {
            const cov = covMap.get(line.id);
            const shipped = cov?.shipped ?? new Prisma.Decimal(0);
            // KG/ADET satırda açık metraj ÖLÇÜLMEZ (null) — satır yine üretime alınabilir.
            const measured = isMeasuredLine(line);
            const openQty = measured ? new Prisma.Decimal(line.quantity).minus(shipped) : null;
            return { ...line, shippedQty: shipped, openQty, measured };
          })
          .filter((line) => line.openQty === null || line.openQty.greaterThan(0));
        return { ...order, lines };
      })
      .filter((order) => order.lines.length > 0);

    const total = enriched.length;
    const { skip, take } = buildPagination(params.page, params.pageSize);
    const data = enriched.slice(skip, skip + take);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

export async function findAvailableOrderLines(this: OrderServiceThis, params: {
    itemId?: string | null;
    colorId?: string | null;
    width?: number | null;
    withInProduction?: boolean;
    // Cursor mod (sipariş-önce aramalı liste) — yalnız `limit` verilince devreye girer.
    search?: string | null;
    cursor?: string | null;
    limit?: number | null;
    withTotal?: boolean;
    /** Mobil picker "detaylı filtre" — müşteri bazlı daraltma. */
    customerId?: string | null;
    /**
     * "Bu kalemle AYNI iş emrinde üretilebilecek kalemler" — verilen satırın
     * spec'ini (kumaş + renk + en) okur ve listeyi ona daraltır.
     *
     * Neden ham `colorId`/`width` değil: spec'in parçaları NULL olabilir
     * (renksiz/ham kalem, eni girilmemiş kalem) ve "renk yok" ile "renk filtresi
     * yok" sorgu dizesinde aynı görünür — istemci NULL'ı kodlamaya çalışsa
     * eninde sonunda birini diğeri sanardı. Satır id'si tek parça, belirsizlik yok.
     */
    specOfLineId?: string | null;
  }): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    // Ortak WHERE — itemId artık OPSİYONEL (cursor modda sipariş-önce için).
    const orderWhere: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    };
    if (params.customerId) orderWhere.customerId = params.customerId;
    const baseWhere: Prisma.OrderLineWhereInput = { order: orderWhere };

    // Spec çapası varsa kumaş/renk/en'i O BELİRLER (istemciden geleni ezer).
    let resolvedItemId: string | null = params.itemId ?? null;
    if (params.specOfLineId) {
      const anchor = await prisma.orderLine.findUnique({
        where: { id: params.specOfLineId },
        select: { itemId: true, colorId: true, width: true },
      });
      if (!anchor) throw AppError.badRequest("Referans sipariş kalemi bulunamadı");
      // NULL'lar BİLEREK aynen yazılır: renksiz çapa yalnız renksiz kalemleri,
      // ensiz çapa yalnız ensiz kalemleri getirsin.
      baseWhere.itemId = anchor.itemId;
      baseWhere.colorId = anchor.colorId;
      baseWhere.width = anchor.width;
      resolvedItemId = anchor.itemId;
    } else {
      if (params.itemId) baseWhere.itemId = params.itemId;
      if (params.colorId) baseWhere.colorId = params.colorId;
      if (params.width != null) baseWhere.width = params.width;
    }
    const term = params.search?.trim();
    if (term) {
      baseWhere.OR = buildTextSearch<Prisma.OrderLineWhereInput>(term, {
        text: [
          "order.customer.name",
          "item.name",
          "customerItemName",
          "item.customerAliases.some.alias",
        ],
        code: ["order.orderNumber"],
      });
    }

    // ── CURSOR MOD (limit verildi): itemId opsiyonel, "sipariş-önce" aramalı liste.
    //    E1: açık>0 SQL'de (keyset-safe; openQty = quantity − shippedQty). withInProduction
    //    broad modda (itemId yok) hesaplanmaz; openQty doğrudan shippedQty'den türetilir.
    if (params.limit != null) {
      const limit = Math.min(Math.max(1, params.limit), 50);
      const whereOpen: Prisma.OrderLineWhereInput = {
        ...baseWhere,
        ...openLineWhere(prisma.orderLine.fields),
      };
      // EN YENİ SİPARİŞ ÖNCE (desc). Saha gerekçesi: picker'ı açan kişi genelde
      // az önce girilen siparişi arıyor; artan sırada o kalem sayfalar sonundaydı.
      // Keyset tie-break de desc olmalı — `dynamicCursorWhere` "lt" üretir.
      const cur = decodeDynamicCursor(params.cursor ?? undefined);
      const where = cur
        ? { AND: [whereOpen, dynamicCursorWhere(cur, "createdAt", "desc")] }
        : whereOpen;
      const rows = await prisma.orderLine.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          itemId: true,
          quantity: true,
          shippedQty: true,
          unit: true,
          width: true,
          colorId: true,
          customerItemName: true,
          customerColorName: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              deadline: true,
              customer: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          item: { select: { code: true, name: true } },
          color: { select: { code: true, name: true } },
        },
      });
      const totalEstimate = params.withTotal
        ? await prisma.orderLine.count({ where: whereOpen })
        : undefined;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      // F152: cursor mod da withInProduction'ı hesaplasın (eskiden 0 hardcode idi).
      // Yalnız itemId sabitlendiğinde anlamlı (spec-havuz item bazlı); broad modda atlanır.
      let inProdBySpec: Map<string, Prisma.Decimal> | null = null;
      if (params.withInProduction && resolvedItemId) {
        inProdBySpec = await this.computeInProdBySpec(resolvedItemId);
      }
      // "Bu kaleme iş emri açılmış mı" — SATIR bazlı gerçek bağ (pivot).
      // `inProduction`'dan FARKLIDIR: o spec-havuz (kumaş|renk|en) bazında hesaplanır,
      // yani aynı spec'teki BAŞKA bir kalem üretimdeyse de dolu gelir. Rozet satırın
      // kendi bağını göstermeli. İptal/devredilmiş WO sayılmaz (mal o emirde değil).
      const woLinked = new Set<string>();
      if (page.length > 0) {
        const links = await prisma.workOrderToOrderLine.findMany({
          where: {
            ...ACTIVE_ORDER_LINK,
            orderLineId: { in: page.map((l) => l.id) },
            workOrder: {
              status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
            },
          },
          select: { orderLineId: true },
          distinct: ["orderLineId"],
        });
        for (const l of links) woLinked.add(l.orderLineId);
      }
      const data = page.map((l) => {
        // Açık = quantity − sevk (rezerv yok; düşüş yalnız sevkte). KG/ADET satırda
        // ÖLÇÜLMEZ (null): shippedQty hiç yazılmaz, metre açığı yalan olurdu.
        const measured = isMeasuredLine(l);
        const openQty = measured ? new Prisma.Decimal(l.quantity).minus(l.shippedQty) : null;
        const inProduction =
          inProdBySpec?.get(
            `${l.itemId}|${l.colorId ?? ""}|${l.width == null ? "" : new Prisma.Decimal(l.width).toString()}`,
          ) ?? new Prisma.Decimal(0);
        const netOpenQty = openQty === null ? null : Prisma.Decimal.max(0, openQty.minus(inProduction));
        return {
          lineId: l.id,
          itemId: l.itemId,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          branchName: l.order.branch?.name ?? null,
          itemCode: l.item.code,
          itemName: l.item.name,
          customerItemName: l.customerItemName,
          colorId: l.colorId,
          colorCode: l.color?.code ?? null,
          colorName: l.color?.name ?? null,
          customerColorName: l.customerColorName,
          width: l.width,
          quantity: l.quantity,
          openQty,
          inProduction,
          netOpenQty,
          measured,
          hasWorkOrder: woLinked.has(l.id),
        };
      });
      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // ── LEGACY MOD (limit yok): itemId ZORUNLU — Tambur/etiket picker'ı. DAVRANIŞ BİREBİR.
    const itemId = params.itemId;
    if (!itemId) throw AppError.badRequest("itemId gerekli");

    const lines = await prisma.orderLine.findMany({
      // F146: legacy mod da cursor moddaki açık-satır süzgecini uygular (200-tavanı
      // açık satırlara harcanır). Bellek süzgeci (openQty>0) defansif kalır — özdeş.
      where: { ...baseWhere, ...openLineWhere(prisma.orderLine.fields) },
      take: 200,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        unit: true,
        width: true,
        colorId: true,
        customerItemName: true,
        customerColorName: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
      },
    });

    const lineIds = lines.map((l) => l.id);
    const covMap = await computeLineCoverage(prisma, lineIds);

    // Opsiyonel: üretimdeki (canlı WO committed − finished) spec-havuz bazında.
    // getCoverageForLines ile aynı mantık; yalnız bu itemId için hesaplanır.
    const specKey = (
      colorId: string | null,
      width: Prisma.Decimal | number | null,
    ): string =>
      `${itemId}|${colorId ?? ""}|${width == null ? "" : new Prisma.Decimal(width).toString()}`;
    // F152: üretimdeki hesabı computeInProdBySpec'e çıkarıldı (cursor mod da kullanır).
    let inProdBySpec: Map<string, Prisma.Decimal> | null = null;
    if (params.withInProduction) inProdBySpec = await this.computeInProdBySpec(itemId);

    const data = lines
      .map((l) => {
        const cov = covMap.get(l.id);
        // Açık = quantity − kapsama (sevk + çuvallanmış rezerv). KG/ADET satırda
        // ÖLÇÜLMEZ (null) — satır listede kalır, rakam yerine "ölçülmüyor".
        const measured = isMeasuredLine(l);
        const openQty = measured
          ? new Prisma.Decimal(l.quantity).minus(cov?.coverage ?? new Prisma.Decimal(0))
          : null;
        const inProduction =
          inProdBySpec?.get(specKey(l.colorId, l.width)) ?? new Prisma.Decimal(0);
        // Net açık = açık − üretimdeki (0'ın altına inmez). Yalnız withInProduction'da anlamlı.
        const netOpenQty = openQty === null ? null : Prisma.Decimal.max(0, openQty.minus(inProduction));
        return {
          lineId: l.id,
          itemId: l.itemId,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          branchName: l.order.branch?.name ?? null,
          itemCode: l.item.code,
          itemName: l.item.name,
          customerItemName: l.customerItemName,
          colorId: l.colorId,
          colorCode: l.color?.code ?? null,
          colorName: l.color?.name ?? null,
          customerColorName: l.customerColorName,
          width: l.width,
          quantity: l.quantity,
          openQty,
          inProduction,
          netOpenQty,
          measured,
        };
      })
      .filter((l) => l.openQty === null || l.openQty.greaterThan(0));

    return { success: true, data };
  }

export async function computeInProdBySpec(
    itemId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const liveWos = await prisma.workOrder.findMany({
      where: {
        status: {
          in: [
            WorkOrderStatus.PLANNED,
            WorkOrderStatus.IN_PROGRESS,
          ],
        },
        isActive: true,
        targetItemId: itemId,
      },
      select: { id: true, targetColorId: true, width: true },
    });
    const woMat = await computeWoMaterial(prisma, liveWos.map((w) => w.id));
    const map = new Map<string, Prisma.Decimal>();
    for (const w of liveWos) {
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? new Prisma.Decimal(0)).minus(mat?.finished ?? 0),
      );
      if (inFlight.lessThanOrEqualTo(0)) continue;
      const key = `${itemId}|${w.targetColorId ?? ""}|${w.width == null ? "" : new Prisma.Decimal(w.width).toString()}`;
      map.set(key, (map.get(key) ?? new Prisma.Decimal(0)).plus(inFlight));
    }
    return map;
  }
