// =============================================================================
// İŞ EMRİ ↔ SİPARİŞ KALEMİ BAĞI DAMGASI — `WorkOrderToOrderLine` (③a ticari pivot)
// =============================================================================
// 2026-09-14'ten beri bağ SİLİNMEZ, `unlinkedAt` ile damgalanır (WOTOL-BAG-DAMGA-PLAN).
// "Bu iş emri hangi sipariş için açıldı" olgusu koparıldıktan sonra da satırda durur;
// yeniden bağlama YENİ satırdır (un-unlink yok). Dışlayıcılık DB'de PARTIAL UNIQUE
// (`… WHERE "unlinkedAt" IS NULL`): açık çift tekil, koparılmış çift yeniden bağlanabilir.
//
// Okuyan HER yol `ACTIVE_ORDER_LINK`tan geçer (AST bekçisi `test_order_link_unlink` §13);
// `WorkOrder.type` aynası AÇIK bağ sayısından türer — `activeOrderLinkCount`.
// =============================================================================

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Açık (koparılmamış) bağ — okuyan her yol buradan geçer. */
export const ACTIVE_ORDER_LINK = { unlinkedAt: null } as const;

export type UnlinkReason = "MANUAL_UNLINK" | "WO_REPLACE" | "ORDER_LINE_CANCEL" | "ORDER_DELETE" | "ORDER_CANCEL";

export interface UnlinkOrderLinesArgs {
  workOrderId?: string;
  orderLineId?: string;
  /** Siparişin TÜM kalemlerinin bağları (sipariş iptali/silme). */
  orderId?: string;
  /** Yalnız bu çiftler (sipariş silme: canlı iş emirleriyle olan bağlar). */
  pairs?: { workOrderId: string; orderLineId: string }[];
  reason: UnlinkReason;
  userId?: string | null;
}

/**
 * Açık bağları DAMGALAR (silmez). Dönen sayı = damgalanan satır (eski `deleteMany().count`
 * ile aynı anlam). Zaten koparılmış satıra dokunmaz. `pairs` boşsa 0.
 */
export async function unlinkOrderLinesTx(tx: Tx, args: UnlinkOrderLinesArgs): Promise<number> {
  if (args.pairs && args.pairs.length === 0) return 0;
  // SEÇİCİSİZ ÇAĞRI YASAK (47 bulgusu K2, 2026-09-14): dört seçici de opsiyonel olduğu için
  // çalışma zamanında `undefined` kalan bir orderId `WHERE unlinkedAt IS NULL` = BÜTÜN
  // tabloyu damgalardı. Emsaller kapsamı zorunlu tutar; burada kapsam ayrık değil, kapı var.
  if (!args.workOrderId && !args.orderLineId && !args.orderId && !args.pairs) {
    throw new Error("unlinkOrderLinesTx: seçici yok (workOrderId · orderLineId · orderId · pairs) — bütün tabloyu damgalamak yasak");
  }
  const res = await tx.workOrderToOrderLine.updateMany({
    where: {
      ...(args.workOrderId ? { workOrderId: args.workOrderId } : {}),
      ...(args.orderLineId ? { orderLineId: args.orderLineId } : {}),
      ...(args.orderId ? { orderLine: { orderId: args.orderId } } : {}),
      ...(args.pairs ? { OR: args.pairs.map((k) => ({ workOrderId: k.workOrderId, orderLineId: k.orderLineId })) } : {}),
      ...ACTIVE_ORDER_LINK,
    },
    data: {
      unlinkedAt: new Date(),
      unlinkedById: args.userId ?? null,
      unlinkReason: args.reason,
    },
  });
  return res.count;
}

/** İş emrinin AÇIK bağ sayısı — `WorkOrder.type` aynası bundan türer (ORDER ↔ STOCK). */
export async function activeOrderLinkCount(tx: Tx, workOrderId: string): Promise<number> {
  return tx.workOrderToOrderLine.count({ where: { workOrderId, ...ACTIVE_ORDER_LINK } });
}

/**
 * Serbest metin araması noktalı yol yazar (`orderLinks.some.orderLine.order…` ·
 * `lines.some.workOrderLinks.some.workOrder…`) ve `buildWhereClause` bunu iç içe `some`
 * nesnesine çevirir — AST kapısı string yolu göremez. Bu yürüyücü `where` içindeki her
 * `orderLinks.some` / `workOrderLinks.some` düğümüne aktif yüklemi ekler: koparılmış bağ
 * üzerinden arama eşleşmesin (sipariş no ile iş emri / müşteri adı ile iş emri).
 */
export function withActiveOrderLinks<T>(where: T): T {
  // Yalnız DÜZ nesneye inilir: Date/Decimal/Buffer/RegExp olduğu gibi döner. Tam paket
  // yakaladı (2026-09-14, 1e): `Object.entries(new Date())` = [] ⇒ `deadline: { gte: Date }`
  // → `{ gte: {} }` ⇒ Prisma boş nesneyi FieldRef sanıp "Argument `_ref` is missing" —
  // tarih süzgeçli her liste canlıda 500 verirdi.
  const duzNesne = (v: unknown): v is Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!duzNesne(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if ((k === "orderLinks" || k === "workOrderLinks") && duzNesne(val)) {
        const rel = val;
        out[k] = Object.fromEntries(
          Object.entries(rel).map(([rk, rv]) =>
            (rk === "some" || rk === "none") && duzNesne(rv)
              ? [rk, { ...ACTIVE_ORDER_LINK, ...(walk(rv) as Record<string, unknown>) }]
              : [rk, walk(rv)],
          ),
        );
      } else {
        out[k] = walk(val);
      }
    }
    return out;
  };
  return walk(where) as T;
}
