// =============================================================================
// Order Service / coverage
// =============================================================================
// Kalem karşılama durumu (getCoverageForLines) ve spec uygunluğu.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  RollEntrySource,
  RollStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { computeWoMaterial } from "../helpers/coverage.helper";
import type { OrderServiceThis } from "./shared";

export async function getCoverageForLines(params: {
    lineIds: string[];
    excludeWorkOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    const lineIds = [...new Set(params.lineIds)];
    if (lineIds.length === 0) return { success: true, data: [] };

    const lines = await prisma.orderLine.findMany({
      where: { id: { in: lineIds } },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
      },
    });

    const specKey = (
      itemId: string,
      colorId: string | null,
      width: Prisma.Decimal | number | null,
    ): string => {
      const w = width == null ? "" : new Prisma.Decimal(width).toString();
      return `${itemId}|${colorId ?? ""}|${w}`;
    };

    // En eşleşmesi: Depo (bitmiş) birebir; Ham EN-AGNOSTİK (ham kumaşın eni
    // önemsiz, fasonda işlenir) — Ürün Dengesi ile aynı.
    const widthEqual = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean =>
      a == null || b == null ? a == null && b == null : new Prisma.Decimal(a).equals(b);

    // Serbest stok — spec bazında grupla; hiçbir çuvala/sevkiyata girmemiş (shipmentId=null
    // + sackId=null) WAREHOUSE + STOCK toplar (fungible havuz). sackId:null: çuvaldaki
    // (bekleyen) mal serbest stok sayılmaz.
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const freeGrouped = await prisma.roll.groupBy({
      // `entrySource`: ham ↔ yarı mamul ayrımı statüden çıkmaz (ikisi de STOCK).
      by: ["itemId", "colorId", "width", "status", "entrySource"],
      where: {
        shipmentId: null,
        sackId: null,
        itemId: { in: itemIds },
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
      },
      _sum: { currentQty: true },
    });

    // Serbest stok eşleştirme (item kesin):
    //  - Depo (WAREHOUSE, bitmiş/boyalı): renk + en BİREBİR (renk + en zaten sabit).
    //  - Ham (STOCK, işlenecek): renksiz (null) ham JOKER — boyahanede istenen renge
    //    boyanır, renkli talebe de sayılır; en AGNOSTİK (eni önemsiz). (Ürün Dengesi ile aynı.)
    /**
     * `semi`: yalnız STOCK dalında anlamlı — `true` yarı mamul, `false` gerçek ham,
     * `undefined` ikisi birden. Ayrım GÖSTERİM içindir; `netGap` zaten ham havuzunu
     * hiç saymıyor (işlenmemiş girdi, mamul değil).
     */
    const matchFree = (
      line: (typeof lines)[number],
      status: RollStatus,
      semi?: boolean,
    ): Prisma.Decimal =>
      freeGrouped.reduce((sum, g) => {
        if (g.status !== status) return sum;
        if (g.itemId !== line.itemId) return sum;
        if (semi !== undefined && (g.entrySource === RollEntrySource.SEMI_FINISHED) !== semi) {
          return sum;
        }
        if (status === RollStatus.WAREHOUSE) {
          if ((g.colorId ?? null) !== (line.colorId ?? null)) return sum;
          if (!widthEqual(g.width, line.width)) return sum;
        } else {
          const colorOk =
            g.colorId == null || line.colorId == null || g.colorId === line.colorId;
          if (!colorOk) return sum;
          // Ham en-agnostik: en kontrolü yok.
        }
        return sum.plus(g._sum.currentQty ?? 0);
      }, new Prisma.Decimal(0));

    // Üretimde — canlı WO'ların hedef-spec başına in-flight (committed − finished).
    // Düzenlenen WO hariç (kendi üretimini açığa saymamak için).
    const liveWos = await prisma.workOrder.findMany({
      where: {
        status: {
          in: [
            WorkOrderStatus.PLANNED,
            WorkOrderStatus.IN_PROGRESS,
          ],
        },
        isActive: true,
        targetItemId: { in: itemIds },
        ...(params.excludeWorkOrderId ? { id: { not: params.excludeWorkOrderId } } : {}),
      },
      select: {
        id: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
      },
    });
    const woMat = await computeWoMaterial(prisma, liveWos.map((w) => w.id));
    const inProdBySpec = new Map<string, Prisma.Decimal>();
    for (const w of liveWos) {
      if (!w.targetItemId) continue;
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? new Prisma.Decimal(0)).minus(mat?.finished ?? 0),
      );
      if (inFlight.lessThanOrEqualTo(0)) continue;
      const key = specKey(w.targetItemId, w.targetColorId, w.width);
      inProdBySpec.set(key, (inProdBySpec.get(key) ?? new Prisma.Decimal(0)).plus(inFlight));
    }

    const data = lines.map((l) => {
      const shipped = new Prisma.Decimal(l.shippedQty);
      const packed = new Prisma.Decimal(0); // rezerv yok — geriye uyum için 0
      const inProduction =
        inProdBySpec.get(specKey(l.itemId, l.colorId, l.width)) ?? new Prisma.Decimal(0);
      const freeWarehouse = matchFree(l, RollStatus.WAREHOUSE);
      // Ham ↔ yarı mamul AYRI raporlanır (2026-08-27): ikisi de "işlenecek girdi"
      // ama farklı stok türü ve envanterde ayrı sekmelerde duruyor. Toplamları
      // eskisiyle aynı; değişen tek şey rakamın ikiye bölünmesi.
      const freeStock = matchFree(l, RollStatus.STOCK, false);
      const freeSemiFinished = matchFree(l, RollStatus.STOCK, true);
      const requested = new Prisma.Decimal(l.quantity);
      // Net açık = bitmiş/üretimdeki ürün açığı. Rezerv/çuvallanmış (packed) KALKTI —
      // packed hep 0 (yanıt şekli için tutulur). freeWarehouse havuz malını içermez (§4).
      // Ham (freeStock) HARİÇ — işlenmemiş girdi, mamul değil (yalnız bilgi).
      const netGap = requested
        .minus(shipped)
        .minus(packed)
        .minus(freeWarehouse)
        .minus(inProduction);
      return {
        lineId: l.id,
        item: l.item,
        color: l.color,
        width: l.width,
        requested,
        shipped,
        packed,
        inProduction,
        freeWarehouse,
        freeStock,
        freeSemiFinished,
        netGap,
      };
    });

    return { success: true, data };
  }

export async function getSpecAvailability(this: OrderServiceThis, params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<
    ApiResponse<{
      freeWarehouse: number;
      inProduction: number;
      freeStock: number;
      /** Dışarıdan alınan yarı mamul — `freeStock`tan AYRI raporlanır (2026-08-27). */
      freeSemiFinished: number;
    }>
  > {
    const colorId = params.colorId ?? null;
    const width = params.width == null ? null : new Prisma.Decimal(params.width);

    // Serbest stok — hiçbir çuvala/sevkiyata girmemiş WAREHOUSE + STOCK (fungible havuz).
    const freeGrouped = await prisma.roll.groupBy({
      // `entrySource`: ham ↔ yarı mamul statüden ayrılmaz (ikisi de STOCK).
      by: ["colorId", "width", "status", "entrySource"],
      where: {
        shipmentId: null,
        sackId: null,
        itemId: params.itemId,
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
      },
      _sum: { currentQty: true },
    });

    // En eşleşmesi: Depo birebir; Ham en-agnostik (getCoverageForLines ile aynı kural).
    const widthEqual = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean =>
      a == null || b == null ? a == null && b == null : new Prisma.Decimal(a).equals(b);

    let freeWarehouse = new Prisma.Decimal(0);
    let freeStock = new Prisma.Decimal(0);
    let freeSemiFinished = new Prisma.Decimal(0);
    for (const g of freeGrouped) {
      const qty = g._sum.currentQty ?? new Prisma.Decimal(0);
      if (g.status === RollStatus.WAREHOUSE) {
        // Depo: renk + en BİREBİR.
        if ((g.colorId ?? null) !== colorId) continue;
        if (!widthEqual(g.width, width)) continue;
        freeWarehouse = freeWarehouse.plus(qty);
      } else {
        // Ham: renksiz joker (renkli talebe de sayılır), en-agnostik.
        const colorOk = g.colorId == null || colorId == null || g.colorId === colorId;
        if (!colorOk) continue;
        // Ham ↔ yarı mamul AYRI kovada; toplamları eskisiyle aynı, değişen yalnız
        // rakamın ikiye bölünmesi (ikisi de gerçek arz — hiçbiri düşülmüyor).
        if (g.entrySource === RollEntrySource.SEMI_FINISHED) {
          freeSemiFinished = freeSemiFinished.plus(qty);
        } else {
          freeStock = freeStock.plus(qty);
        }
      }
    }

    // Üretimde — hazır spec-havuz hesabı; anahtar computeInProdBySpec ile aynı format.
    const inProdBySpec = await this.computeInProdBySpec(params.itemId);
    const key = `${params.itemId}|${colorId ?? ""}|${width == null ? "" : width.toString()}`;
    const inProduction = inProdBySpec.get(key) ?? new Prisma.Decimal(0);

    return {
      success: true,
      data: {
        freeWarehouse: freeWarehouse.toNumber(),
        inProduction: inProduction.toNumber(),
        freeStock: freeStock.toNumber(),
        freeSemiFinished: freeSemiFinished.toNumber(),
      },
    };
  }
