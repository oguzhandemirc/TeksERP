// =============================================================================
// KARTI KULLANAN AÇIK İŞ EMİRLERİ — atkı/çözgü kartı düzenleme uyarısı (Seyitoğlu SY-d)
// =============================================================================
// İş emri kartın kopyasını tutmaz (SY-b ölçümü): kart yerinde düzeltilince açık iş emrinin iş kartı ve
// planı yeni değeri hemen görür. Ekran bunu kaydetmeden ÖNCE söyler; engellemez. "Açık" tanımı tek
// kaynaktan (`OPEN_WEAVING_ORDER`, `OPEN_WARPING_STATUSES`); etkin kart kuralı `loom-load` ile aynı:
// iş emrinin kendi kartı, boşsa ürünün kartı (çözgüde ek katman da).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readDokumaEnabled } from "../system-setting.service";
import { OPEN_WEAVING_ORDER } from "./live-ref-where.helper";
import { OPEN_WARPING_STATUSES } from "./warp-supply.helper";

/** Uyarı listesinde gösterilen iş emri numarası tavanı (sayı her zaman tamdır). */
export const SPEC_OPEN_ORDER_SAMPLE = 10;

export interface SpecOpenOrders {
  /** Kartı kullanan açık dokuma iş emri sayısı (dokuma modülü kapalıysa 0). */
  weavingOrders: number;
  /** Kartı kullanan açık çözgü emri sayısı (yalnız çözgü kartında; atkıda 0). */
  warpingOrders: number;
  total: number;
  /** İlk numaralar (en yeni önce), en çok `SPEC_OPEN_ORDER_SAMPLE`. */
  numbers: string[];
}

export function weftSpecWeavingWhere(id: string): Prisma.WeavingOrderWhereInput {
  return { ...OPEN_WEAVING_ORDER, OR: [{ weftSpecId: id }, { weftSpecId: null, item: { weftSpecId: id } }] };
}

export function warpSpecWeavingWhere(id: string): Prisma.WeavingOrderWhereInput {
  return {
    ...OPEN_WEAVING_ORDER,
    OR: [{ warpSpecId: id }, { warpSpecId: null, item: { warpSpecId: id } }, { item: { warpLayers: { some: { warpSpecId: id } } } }],
  };
}

async function weaving(where: Prisma.WeavingOrderWhereInput): Promise<{ count: number; numbers: string[] }> {
  const [count, rows] = [
    await prisma.weavingOrder.count({ where }),
    await prisma.weavingOrder.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: SPEC_OPEN_ORDER_SAMPLE, select: { weavingOrderNumber: true } }),
  ];
  return { count, numbers: rows.map((r) => r.weavingOrderNumber) };
}

export async function weftSpecOpenOrders(id: string): Promise<SpecOpenOrders> {
  const w = (await readDokumaEnabled()) ? await weaving(weftSpecWeavingWhere(id)) : { count: 0, numbers: [] };
  return { weavingOrders: w.count, warpingOrders: 0, total: w.count, numbers: w.numbers };
}

export async function warpSpecOpenOrders(id: string): Promise<SpecOpenOrders> {
  const w = (await readDokumaEnabled()) ? await weaving(warpSpecWeavingWhere(id)) : { count: 0, numbers: [] };
  const warpWhere: Prisma.WarpingOrderWhereInput = {
    status: { in: [...OPEN_WARPING_STATUSES] },
    OR: [{ warpSpecId: id }, { extraSpecs: { some: { warpSpecId: id } } }],
  };
  const warpingOrders = await prisma.warpingOrder.count({ where: warpWhere });
  const left = SPEC_OPEN_ORDER_SAMPLE - w.numbers.length;
  const warpNumbers = left > 0
    ? (await prisma.warpingOrder.findMany({ where: warpWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: left, select: { orderNo: true } })).map((r) => r.orderNo)
    : [];
  return { weavingOrders: w.count, warpingOrders, total: w.count + warpingOrders, numbers: [...w.numbers, ...warpNumbers] };
}
