// =============================================================================
// Tambur Service / swatch
// =============================================================================
// Kartela okuma: barkodla kartela, kartela listesi ve stok özeti (getSwatchStats).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { normalizeScanCode } from "../../utils/code-format";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import { buildTextSearch } from "../../utils/query-parser";
import type { CursorPaginatedResponse } from "../base.service";
import {
  Prisma,
  SwatchStatus,
  Swatch,
} from "@prisma/client";
import { SWATCH_IN_STOCK_WHERE } from "../helpers/swatch-event.helper";

export interface SwatchStats {
  /** Filtreye uyan STOKTAKİ kartela sayısı (`getStock` ile aynı yüklem). */
  count: number;
  /** Stoktaki kartelaların `length` toplamı — cm. */
  totalLength: number;
  /** Filtreye uyan kartelaların durum kırılımı (çuvalda · sevkiyatta · sevk edildi …). */
  byStatus: Record<SwatchStatus, number>;
}

export async function getSwatchByBarcode(
    barcode: string
  ): Promise<ApiResponse<Swatch | null>> {
    const swatch = await prisma.swatch.findUnique({
      where: { barcode: normalizeScanCode(barcode) },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        parentRoll: { select: { id: true, barcode: true } },
      },
    });
    // F292: kardeş getByCardBarcode/getStep deseniyle hizala — bulunamayan barkod
    // 404 (controller {success:false}'u incelemiyor → servis-throw güvenli).
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
    return { success: true, data: swatch };
  }

export async function listSwatches(params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
    /** Cursor mode aktivasyonu — verilirse pagination cursor response döner. */
    cursor?: string;
    /** `cursor=...` parametresi yokken bile cursor formatı istemek için. */
    mode?: string;
    /** Barkod / kart no / ürün adı/kodu / parti araması (cursor mode'da geçerli). */
    search?: string;
    /** Cursor mode ilk fetch'te totalEstimate doldur. */
    withTotal?: boolean;
    /** Durum süzgeci — verilmezse iptal/düşüm dışındakiler (eski varsayılan). */
    statuses?: SwatchStatus[];
  }): Promise<ApiResponse<Swatch[]> | CursorPaginatedResponse<Swatch>> {
    // Varsayılan: iptal edilmiş ve düşülmüş kartela listelenmez; durum süzgeci verilirse o geçer.
    const where: Prisma.SwatchWhereInput = params?.statuses?.length
      ? { status: { in: params.statuses } }
      : { cancelledAt: null };
    if (params?.itemId) where.itemId = params.itemId;
    const search = params?.search?.trim();
    if (search) {
      // Barkod + kart no: TAM eşleşme (ikisi de @unique → index seek). `contains`/
      // ILIKE en_US.UTF-8'de unique indeksi KULLANAMAZ → tüm swatch tablosunu seq
      // scan eder. SW- barkod/kart hep tam okutulur; kısmi tarama saha akışı değil.
      // Ürün adı/kodu küçük master tabloya join (itemId IN) olduğu için contains kalır.
      where.OR = [
        // ⚠️ Barkod/kart no TAM eşleşme → girdi normalize EDİLMEK ZORUNDA
        // (bkz. `listRecentOutputRolls` notu; aynı sessiz-0-sonuç arızası).
        { barcode: normalizeScanCode(search) },
        { cardNumber: normalizeScanCode(search) },
        ...buildTextSearch<Prisma.SwatchWhereInput>(search, {
          text: ["item.name"],
          code: ["item.code"],
        }),
      ];
    }

    // Kartela kendi `properties` alanı taşımaz; özellikler kaynak rolden
    // miras (kartela fasonda kaynak Roll'dan üretilir, aynı kumaş).
    // Side panel'in "Renk + Özellikler" bölmesi parentRoll üzerinden okur.
    const include = {
      item: { select: { id: true, code: true, name: true } },
      color: { select: { id: true, code: true, name: true, hex: true } },
      parentRoll: {
        select: {
          id: true,
          barcode: true,
          qualityGrade: true,
          color: { select: { id: true, code: true, name: true, hex: true } },
          properties: {
            where: ACTIVE_ROLL_PROPERTY,
            select: {
              propertyId: true,
              property: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    } as const;

    // Cursor mode (mobil infinite scroll, büyük katalog). Legacy çağrılar
    // (Electron paneli, tartı/paket scan akışı) cursor/mode vermez ve eski
    // `ApiResponse<Swatch[]>` cevabını alır.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.swatch.findMany({
          where: cursorWhereClause,
          include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.swatch.count({ where }) : Promise.resolve(undefined),
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
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // F170: legacy dal da cursor moduyla AYNI 1..200 clamp'ini uygular — controller
    // ham Number(req.query.limit) geçiyor (NaN / negatif / 500000 mümkün); ağır
    // parentRoll+properties+color include'lu sınırsız satır çekimini önle.
    const legacyLimit = Math.min(
      Math.max(1, Number.isFinite(params?.limit) ? (params!.limit as number) : 100),
      200,
    );
    const swatches = await prisma.swatch.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      take: legacyLimit,
    });
    return { success: true, data: swatches };
  }

export async function getSwatchStats(params?: {
    itemId?: string;
    search?: string;
  }): Promise<ApiResponse<SwatchStats>> {
    // Süzgeç (ürün + arama) tek; sayı stoktakini, kırılım bütün durumları sayar. Eskiden
    // `cancelledAt: null` çuvaldaki/sevkiyattaki/SEVK EDİLMİŞ kartelayı da "toplam" sayıyordu.
    const where: Prisma.SwatchWhereInput = {};
    if (params?.itemId) where.itemId = params.itemId;
    const search = params?.search?.trim();
    if (search) {
      // Barkod + kart no: TAM eşleşme (ikisi de @unique → index seek). `contains`/
      // ILIKE en_US.UTF-8'de unique indeksi KULLANAMAZ → tüm swatch tablosunu seq
      // scan eder. SW- barkod/kart hep tam okutulur; kısmi tarama saha akışı değil.
      // Ürün adı/kodu küçük master tabloya join (itemId IN) olduğu için contains kalır.
      where.OR = [
        // ⚠️ Barkod/kart no TAM eşleşme → girdi normalize EDİLMEK ZORUNDA
        // (bkz. `listRecentOutputRolls` notu; aynı sessiz-0-sonuç arızası).
        { barcode: normalizeScanCode(search) },
        { cardNumber: normalizeScanCode(search) },
        ...buildTextSearch<Prisma.SwatchWhereInput>(search, {
          text: ["item.name"],
          code: ["item.code"],
        }),
      ];
    }

    const aggregate = await prisma.swatch.aggregate({
      where: { ...where, ...SWATCH_IN_STOCK_WHERE },
      _count: { _all: true },
      _sum: { length: true },
    });
    const perStatus = await prisma.swatch.groupBy({ by: ["status"], where, _count: { _all: true } });
    const byStatus = Object.fromEntries(
      Object.values(SwatchStatus).map((st) => [st, perStatus.find((p) => p.status === st)?._count._all ?? 0]),
    ) as Record<SwatchStatus, number>;

    return {
      success: true,
      data: {
        count: aggregate._count._all,
        totalLength: Number(aggregate._sum.length ?? 0),
        byStatus,
      },
    };
  }
