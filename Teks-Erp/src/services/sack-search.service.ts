// =============================================================================
// Sack Search Service — Saha #1+#23: Çuval/Top Arama
// =============================================================================
// Üç soruya tek ekrandan cevap:
//   1) "X üründen hangi çuvallarda ne kadar var?"  → searchSacks(itemId/colorId/width)
//      — çuval listesi + her çuvalda EŞLEŞEN top sayısı/metresi.
//   2) "Şu çuvalda ne var?"                        → searchSacks(sackCode) + getSackContents
//   3) "Bu top hangi çuvalda/sevkiyatta?"          → locateRoll(barcode)
// Varsayılan kapsam sevk edilMEMİŞ sevkiyatlar (PREPARING/READY/AT_DOOR);
// DISPATCHED bilinçli filtreyle dahil edilebilir (geçmişte arama).
// Salt-okunur — yazma/audit yok. Liste cursor'lı (sacks yıllar içinde büyür),
// aggregate'ler yalnız sayfadaki çuvallar için (over-fetch yok).
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import type { CursorPaginatedResponse } from "./base.service";
import { decodeCursor, cursorWhere, buildNextCursor } from "../utils/cursor";
import { buildTurkishSearch } from "../utils/query-parser";

const UNSHIPPED: ShipmentStatus[] = [
  ShipmentStatus.PREPARING,
  ShipmentStatus.READY,
  ShipmentStatus.AT_DOOR,
];

export interface SackSearchParams {
  itemId?: string;
  colorId?: string;
  width?: number;
  customerId?: string;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  cursor?: string;
  limit?: number;
}

export class SackSearchService {
  /**
   * Çuval arama — içerik (ürün/renk/en) ve/veya kimlik (kod/sevkiyat/müşteri)
   * filtreli. İçerik filtresi aktifken her satırda eşleşen top adedi+metresi
   * ayrıca döner ("bu çuvalda aradığından ne kadar var").
   */
  async searchSacks(params: SackSearchParams): Promise<CursorPaginatedResponse<unknown>> {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 100);

    // İçerik (rulo düzeyi) filtresi — yalnız verilen alanlar.
    const rollFilter: Prisma.RollWhereInput = {};
    if (params.itemId) rollFilter.itemId = params.itemId;
    if (params.colorId) rollFilter.colorId = params.colorId;
    if (params.width !== undefined) rollFilter.width = params.width;
    const hasContentFilter = Object.keys(rollFilter).length > 0;

    const shipmentWhere: Prisma.ShipmentWhereInput = {
      status: params.includeDispatched
        ? { in: [...UNSHIPPED, ShipmentStatus.DISPATCHED] }
        : { in: UNSHIPPED },
    };
    if (params.customerId) shipmentWhere.customerId = params.customerId;
    const shipmentNo = params.shipmentNo?.trim();
    if (shipmentNo) shipmentWhere.OR = buildTurkishSearch<Prisma.ShipmentWhereInput>(shipmentNo, ["shipmentNo"]);

    const where: Prisma.SackWhereInput = { shipment: shipmentWhere };
    const sackCode = params.sackCode?.trim();
    if (sackCode) {
      where.OR = buildTurkishSearch<Prisma.SackWhereInput>(sackCode, [
        "manualCode",
        "sackNo",
      ]);
    }
    if (hasContentFilter) where.rolls = { some: rollFilter };

    const cursor = decodeCursor(params.cursor);
    const finalWhere: Prisma.SackWhereInput = cursor ? { AND: [where, cursorWhere(cursor)] } : where;

    const rows = await prisma.sack.findMany({
      where: finalWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        sackNo: true,
        seq: true,
        manualCode: true,
        weightKg: true,
        createdAt: true,
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            readyAt: true, // çeki listesi: "ne zamandır hazır bekliyor"
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const ids = pageRows.map((s) => s.id);
    const nextCursor = hasMore ? buildNextCursor(pageRows[pageRows.length - 1]) : null;

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
        manualCode: s.manualCode,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
        createdAt: s.createdAt,
        shipment: s.shipment,
        rollCount: all?._count._all ?? 0,
        totalQty: Number(all?._sum.currentQty ?? 0),
        swatchCount: swatchBySack.get(s.id)?._count._all ?? 0,
        // İçerik filtresi yokken null — UI eşleşme sütununu gizler.
        matchRollCount: hasContentFilter ? (match?._count._all ?? 0) : null,
        matchQty: hasContentFilter ? Number(match?._sum.currentQty ?? 0) : null,
      };
    });

    return { success: true, data, pagination: { nextCursor, hasMore, limit } };
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
        manualCode: true,
        weightKg: true,
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
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
        manualCode: true,
        weightKg: true,
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            readyAt: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
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
        manualCode: s.manualCode,
        weightKg: s.weightKg === null ? null : Number(s.weightKg),
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
        sack: { select: { id: true, sackNo: true, seq: true, manualCode: true, weightKg: true } },
        shipment: {
          select: {
            id: true,
            shipmentNo: true,
            status: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Bu barkodla top bulunamadı");
    return { success: true, data: roll };
  }
}

export const sackSearchService = new SackSearchService();
