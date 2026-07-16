// =============================================================================
// Sack Search Service — Saha #1+#23: Çuval/Top Arama
// =============================================================================
// Üç soruya tek ekrandan cevap:
//   1) "X üründen hangi çuvallarda ne kadar var?"  → searchSacks(itemId/colorId/width)
//      — çuval listesi + her çuvalda EŞLEŞEN top sayısı/metresi.
//   2) "Şu çuvalda ne var?"                        → searchSacks(sackCode) + getSackContents
//   3) "Bu top hangi çuvalda/sevkiyatta?"          → locateRoll(barcode)
// Kapsam (scope): POOL (havuzda, shipmentId null) | PLANNED (planlı sevkiyatta) |
// DISPATCHED (sevk edilmiş) | ALL. Varsayılan: POOL + PLANNED (sevk edilmemiş).
// Salt-okunur — yazma/audit yok. Liste cursor'lı (sacks yıllar içinde büyür),
// aggregate'ler yalnız sayfadaki çuvallar için (over-fetch yok).
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { decodeDynamicCursor, dynamicCursorWhere, buildNextDynamicCursor } from "../utils/cursor";
import { buildTurkishSearch } from "../utils/query-parser";

const PLANNED_STATUSES: ShipmentStatus[] = [ShipmentStatus.PLANNED];

export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export interface SackSearchParams {
  itemId?: string;
  colorId?: string;
  width?: number;
  widthMin?: number;
  widthMax?: number;
  customerId?: string;
  scope?: SackSearchScope;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  /** Serbest arama — sackNo / müşteri adı-kodu / sevkiyat no (DataTable arama kutusu). */
  search?: string;
  /** Sıralama alanı — yalnız Sack skaler kolonu (createdAt | sackNo); aksi createdAt. */
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** İlk sayfada toplam tahmini (DataTable). */
  withTotal?: boolean;
  cursor?: string;
  limit?: number;
}

/** Kapsam → Sack where OR parçaları (POOL=havuz, PLANNED/DISPATCHED=sevkiyat statüsü). */
function scopeWhere(scope: SackSearchScope): Prisma.SackWhereInput[] {
  switch (scope) {
    case "POOL":
      return [{ shipmentId: null }];
    case "PLANNED":
      return [{ shipment: { status: { in: PLANNED_STATUSES } } }];
    case "DISPATCHED":
      return [{ shipment: { status: ShipmentStatus.DISPATCHED } }];
    case "ALL":
      return [{ shipmentId: null }, { shipment: { is: {} } }];
  }
}

export class SackSearchService {
  /**
   * Çuval arama — içerik (ürün/renk/en) ve/veya kimlik (kod/sevkiyat/müşteri)
   * filtreli. İçerik filtresi aktifken her satırda eşleşen top adedi+metresi
   * ayrıca döner ("bu çuvalda aradığından ne kadar var").
   */
  async searchSacks(params: SackSearchParams): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 50), 100);
    const sortField: "createdAt" | "sackNo" = params.sortBy === "sackNo" ? "sackNo" : "createdAt";
    const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";

    // İçerik (rulo düzeyi) filtresi — ürün/renk/en (en tek değer VEYA min-max aralık).
    const rollFilter: Prisma.RollWhereInput = {};
    if (params.itemId) rollFilter.itemId = params.itemId;
    if (params.colorId) rollFilter.colorId = params.colorId;
    if (params.widthMin != null || params.widthMax != null) {
      rollFilter.width = {
        ...(params.widthMin != null ? { gte: params.widthMin } : {}),
        ...(params.widthMax != null ? { lte: params.widthMax } : {}),
      };
    } else if (params.width != null) {
      rollFilter.width = params.width;
    }
    const hasContentFilter = Object.keys(rollFilter).length > 0;

    // Kapsam: verilen scope; yoksa includeDispatched'e göre ALL, aksi POOL+PLANNED (varsayılan).
    const scopeOr: Prisma.SackWhereInput[] = params.scope
      ? scopeWhere(params.scope)
      : params.includeDispatched
        ? scopeWhere("ALL")
        : [{ shipmentId: null }, { shipment: { status: { in: PLANNED_STATUSES } } }];

    const andClauses: Prisma.SackWhereInput[] = [{ OR: scopeOr }];
    if (params.customerId) andClauses.push({ customerId: params.customerId });
    const shipmentNo = params.shipmentNo?.trim();
    if (shipmentNo) andClauses.push({ shipment: { is: { OR: buildTurkishSearch<Prisma.ShipmentWhereInput>(shipmentNo, ["shipmentNo"]) } } });
    const sackCode = params.sackCode?.trim();
    if (sackCode) andClauses.push({ OR: buildTurkishSearch<Prisma.SackWhereInput>(sackCode, ["sackNo"]) });
    // Serbest arama (DataTable kutusu) — sackNo / müşteri adı-kodu / sevkiyat no.
    const search = params.search?.trim();
    if (search) {
      andClauses.push({ OR: buildTurkishSearch<Prisma.SackWhereInput>(search, ["sackNo", "customer.name", "customer.code", "shipment.shipmentNo"]) });
    }
    if (hasContentFilter) andClauses.push({ rolls: { some: rollFilter } });

    const where: Prisma.SackWhereInput = { AND: andClauses };
    const cursor = decodeDynamicCursor(params.cursor);
    const finalWhere: Prisma.SackWhereInput = cursor
      ? { AND: [where, dynamicCursorWhere(cursor, sortField, sortOrder) as Prisma.SackWhereInput] }
      : where;

    const rows = await prisma.sack.findMany({
      where: finalWhere,
      orderBy: [{ [sortField]: sortOrder }, { id: sortOrder }],
      take: limit + 1,
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
      },
    });
    const totalEstimate = params.withTotal ? await prisma.sack.count({ where }) : undefined;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore
      ? buildNextDynamicCursor(pageRows[pageRows.length - 1] as unknown as Record<string, unknown>, sortField)
      : null;

    // Sayfa kapsamı aggregate'leri: toplam içerik + (filtre aktifse) eşleşen kısım.
    const [allAgg, matchAgg, swatchAgg] = ids.length
      ? await Promise.all([
          prisma.roll.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids } },
            _count: { _all: true },
            _sum: { currentQty: true },
          }),
          hasContentFilter
            ? prisma.roll.groupBy({
                by: ["sackId"],
                where: { sackId: { in: ids }, ...rollFilter },
                _count: { _all: true },
                _sum: { currentQty: true },
              })
            : Promise.resolve([]),
          prisma.swatch.groupBy({
            by: ["sackId"],
            where: { sackId: { in: ids } },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];

    const allBySack = new Map(allAgg.map((g) => [g.sackId, g]));
    const matchBySack = new Map(matchAgg.map((g) => [g.sackId, g]));
    const swatchBySack = new Map(swatchAgg.map((g) => [g.sackId, g]));

    const data = pageRows.map((s) => {
      const all = allBySack.get(s.id);
      const match = matchBySack.get(s.id);
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        createdAt: s.createdAt,
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment, // null = havuzda; dolu = sevkiyatta
        rollCount: all?._count._all ?? 0,
        totalQty: Number(all?._sum.currentQty ?? 0),
        swatchCount: swatchBySack.get(s.id)?._count._all ?? 0,
        // İçerik filtresi yokken null — UI eşleşme sütununu gizler.
        matchRollCount: hasContentFilter ? (match?._count._all ?? 0) : null,
        matchQty: hasContentFilter ? Number(match?._sum.currentQty ?? 0) : null,
      };
    });

    return {
      success: true,
      data,
      pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
    };
  }

  /**
   * Tek çuvalın dökümü — arama satırı genişletilince lazy yüklenir.
   * Tek çuval = sınırlı kapsam (onlarca top) → satırları çekmek güvenli.
   */
  async getSackContents(sackId: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
        rolls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            width: true,
            qualityGrade: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
        swatches: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            barcode: true,
            item: { select: { id: true, name: true } },
            color: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    return { success: true, data: sack };
  }

  /**
   * Çeki listesi verisi — SEÇİLEN çuvalların içerik özetiyle tek istekte dökümü.
   * Senaryo: müşterinin farklı sevkiyatlarda bekleyen çuvallarından bir alt küme
   * seçilir ("sadece gri Patos"), kağıda basılır, sahada bulunan çuvalın üstü
   * çizilir. Çalışma kağıdıdır — PrintedDocument (donmuş/versiyonlu) DEĞİL.
   * Salt-okunur; seçim ≤200 çuval + çuval başına onlarca top → tek sorgu güvenli.
   */
  async getPickList(sackIds: string[]): Promise<ApiResponse<unknown>> {
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (ids.length > 200) throw AppError.badRequest("Bir çeki listesinde en fazla 200 çuval olabilir");

    const sacks = await prisma.sack.findMany({
      where: { id: { in: ids } },
      // Sevkiyat + çuval sırası: sahada aynı sevkin çuvalları yan yana durur.
      orderBy: [{ shipmentId: "asc" }, { seq: "asc" }],
      select: {
        id: true,
        sackNo: true,
        seq: true,
        weightKg: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
          },
        },
        rolls: {
          select: {
            currentQty: true,
            width: true,
            item: { select: { name: true } },
            color: { select: { name: true } },
          },
        },
        swatches: { select: { id: true } },
      },
    });

    const data = sacks.map((s) => {
      // Ürün·renk·en bazında özet (irsaliye döküm diliyle aynı).
      const groups = new Map<string, { itemName: string; colorName: string | null; width: number | null; qty: number; rollCount: number }>();
      let totalQty = 0;
      for (const r of s.rolls) {
        const widthNum = r.width === null ? null : Number(r.width);
        const key = `${r.item.name}|${r.color?.name ?? ""}|${widthNum ?? ""}`;
        const g = groups.get(key) ?? {
          itemName: r.item.name,
          colorName: r.color?.name ?? null,
          width: widthNum,
          qty: 0,
          rollCount: 0,
        };
        g.qty += Number(r.currentQty);
        g.rollCount += 1;
        groups.set(key, g);
        totalQty += Number(r.currentQty);
      }
      return {
        id: s.id,
        sackNo: s.sackNo,
        seq: s.seq,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        customer: s.customer,
        branch: s.branch,
        shipment: s.shipment,
        rollCount: s.rolls.length,
        swatchCount: s.swatches.length,
        totalQty,
        contents: [...groups.values()],
      };
    });

    return { success: true, data };
  }

  /**
   * Top yerini bul — barkod EXACT eşleşme (ILIKE contains seq-scan tuzağına
   * girilmez; barkodlar tam okutulur). Çuvalsız/sevkiyatsız toplar için de
   * konum cevabı verir (statü = depoda/üretimde/sevk edildi).
   */
  async locateRoll(barcode: string): Promise<ApiResponse<unknown>> {
    const code = barcode.trim();
    if (!code) throw AppError.badRequest("Barkod gerekli");

    const roll = await prisma.roll.findFirst({
      where: { barcode: code },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        width: true,
        qualityGrade: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, name: true, hex: true } },
        sack: { select: { id: true, sackNo: true, seq: true, weightKg: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Bu barkodla top bulunamadı");
    return { success: true, data: roll };
  }
}

export const sackSearchService = new SackSearchService();
