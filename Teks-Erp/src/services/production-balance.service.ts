// =============================================================================
// TeksERP - Ürün Dengesi (MRP net ihtiyaç) servisi
// =============================================================================
// Spec (ürün+renk+en) bazında arz/talep dengesi. Fabrika DOKUMA YAPMAZ — kumaş
// hazır gelir, sadece işlenir. Bu yüzden iki açık ayrılır:
//   üretilecek    = Talep − Depo − Üretimde   (WO açılacak miktar)
//   malzeme açığı = üretilecek − Ham           (kumaş tedariki gereken kısım)
//
// Talep    = Σ (quantity − shippedQty) açık siparişlerden (CANCELLED/COMPLETED hariç)
// Depo     = WAREHOUSE, sevke okutulmamış (shipmentId=null) toplar
// Ham      = STOCK, sevksiz toplar (işlenecek hazır kumaş)
// Üretimde = canlı WO'ların (PLANNED/IN_PROGRESS/PAUSED) hedef-spec başına
//            in-flight malzemesi = committed − finished (computeWoMaterial).
//            Renk-veren fason (beyaz→kırmızı) doğru spec'e yazılsın diye top
//            statüsünden değil WO HEDEF spec'inden hesaplanır.
// =============================================================================

import prisma from "../lib/prisma";
import { OrderStatus, Prisma, RollStatus, WorkOrderStatus } from "@prisma/client";
import { ApiResponse } from "../types/api.types";
import { computeLineCoverage, computeWoMaterial } from "./helpers/coverage.helper";

const LIVE_WO: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.PAUSED,
];

const D0 = () => new Prisma.Decimal(0);

function specKey(
  itemId: string,
  colorId: string | null,
  width: Prisma.Decimal | number | null
): string {
  const w = width == null ? "" : new Prisma.Decimal(width).toString();
  return `${itemId}|${colorId ?? ""}|${w}`;
}

/** Birebir en eşleşmesi (ikisi de null veya eşit). Bitmiş depo malı için. */
function widthEqual(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return new Prisma.Decimal(a).equals(b);
}

/** Gevşek en uyumu — ikisi de set ve farklıysa elenir; null = joker. */
function widthCompatible(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null
): boolean {
  if (a == null || b == null) return true;
  return new Prisma.Decimal(a).equals(b);
}

/** Drill-down: bu spec'in açık sipariş kalemi (WO formuna bind için yeterli alan). */
export interface BalanceLine {
  lineId: string;
  orderId: string;
  orderNumber: string;
  deadline: Date | null;
  orderDate: Date;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
  shipped: Prisma.Decimal;
  /** istenen − sevk (brüt açık talep). */
  remaining: Prisma.Decimal;
  /** istenen − sevk − canlı WO rezervesi = yeni WO'ya serbest tahsis tavanı. */
  open: Prisma.Decimal;
  requiredProperties: { id: string; name: string }[];
}

/** Drill-down: bu spec'i üreten canlı WO. */
export interface BalanceWo {
  id: string;
  batchNumber: string;
  status: WorkOrderStatus;
  inFlight: Prisma.Decimal;
}

export interface BalanceSpec {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  width: Prisma.Decimal | null;
  talep: Prisma.Decimal;
  depo: Prisma.Decimal;
  uretimde: Prisma.Decimal;
  ham: Prisma.Decimal;
  /** max(0, talep − depo − üretimde) → WO açılacak miktar. */
  uretilecek: Prisma.Decimal;
  /** max(0, üretilecek − ham) → kumaş tedariki gereken kısım. */
  malzemeAcigi: Prisma.Decimal;
  lines: BalanceLine[];
  wos: BalanceWo[];
}

interface SpecAcc extends BalanceSpec {
  /** İsim doldurulmuş mu — ilk dolduran sabitlesin. */
  named: boolean;
}

export class ProductionBalanceService {
  async getBalance(): Promise<ApiResponse<BalanceSpec[]>> {
    const map = new Map<string, SpecAcc>();

    const ensure = (
      itemId: string,
      colorId: string | null,
      width: Prisma.Decimal | null,
      names?: {
        itemName?: string | null;
        colorName?: string | null;
        colorHex?: string | null;
      }
    ): SpecAcc => {
      const key = specKey(itemId, colorId, width);
      let acc = map.get(key);
      if (!acc) {
        acc = {
          key,
          itemId,
          colorId,
          width,
          itemName: names?.itemName ?? "—",
          colorName: names?.colorName ?? null,
          colorHex: names?.colorHex ?? null,
          talep: D0(),
          depo: D0(),
          uretimde: D0(),
          ham: D0(),
          uretilecek: D0(),
          malzemeAcigi: D0(),
          lines: [],
          wos: [],
          named: Boolean(names?.itemName),
        };
        map.set(key, acc);
      } else if (!acc.named && names?.itemName) {
        acc.itemName = names.itemName;
        acc.colorName = names.colorName ?? acc.colorName;
        acc.colorHex = names.colorHex ?? acc.colorHex;
        acc.named = true;
      }
      return acc;
    };

    // 1) Talep — açık sipariş kalemleri
    const lines = await prisma.orderLine.findMany({
      where: {
        order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
      },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        item: { select: { name: true } },
        color: { select: { name: true, hex: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            orderDate: true,
            customer: { select: { id: true, name: true } },
          },
        },
        requiredProperties: {
          select: { propertyId: true, property: { select: { name: true } } },
        },
      },
    });

    // Kalem başına kapsama (sevk + canlı WO rezervesi) — bind tahsis tavanı için.
    // excludeWorkOrderId YOK → yeni WO create doğrulamasıyla aynı remaining.
    const cov = await computeLineCoverage(prisma, lines.map((l) => l.id));

    for (const l of lines) {
      const acc = ensure(l.itemId, l.colorId, l.width, {
        itemName: l.item.name,
        colorName: l.color?.name ?? null,
        colorHex: l.color?.hex ?? null,
      });
      const remaining = Prisma.Decimal.max(
        0,
        new Prisma.Decimal(l.quantity).minus(l.shippedQty)
      );
      acc.talep = acc.talep.plus(remaining);
      if (remaining.greaterThan(0)) {
        acc.lines.push({
          lineId: l.id,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          orderDate: l.order.orderDate,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          itemId: l.itemId,
          itemName: l.item.name,
          colorId: l.colorId,
          colorName: l.color?.name ?? null,
          colorHex: l.color?.hex ?? null,
          width: l.width,
          quantity: new Prisma.Decimal(l.quantity),
          shipped: new Prisma.Decimal(l.shippedQty),
          remaining,
          // Tabana yuvarla: metre tamsayı; pro-rata bölme artığı (…,371) atılır.
          // floor → backend remaining (ondalıklı) asla aşılmaz.
          open: Prisma.Decimal.max(
            0,
            new Prisma.Decimal(l.quantity).minus(cov.get(l.id)?.coverage ?? 0)
          ).floor(),
          requiredProperties: l.requiredProperties.map((rp) => ({
            id: rp.propertyId,
            name: rp.property.name,
          })),
        });
      }
    }

    // 2) Arz havuzu (sevksiz) — depo (WAREHOUSE, bitmiş) + ham (STOCK, işlenecek).
    // Satıra ENSURE ile eklenmez; aşağıda mevcut talep/üretim satırlarına eşleşir.
    //   Depo: birebir (ürün+renk+en) — renk zaten uygulanmış.
    //   Ham : renk-agnostik — renksiz (color=null) ham, boyahanede istenen renge
    //         boyanacağı için aynı ürün+en'deki RENKLİ talebe de sayılır.
    const supply = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width", "status"],
      where: {
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
        shipmentId: null,
      },
      _sum: { currentQty: true },
    });

    // 3) Üretimde — canlı WO'lar, hedef spec başına in-flight (committed − finished)
    const wos = await prisma.workOrder.findMany({
      where: {
        status: { in: LIVE_WO },
        isActive: true,
        targetItemId: { not: null },
      },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
        targetItem: { select: { name: true } },
        targetColor: { select: { name: true, hex: true } },
      },
    });
    const woMat = await computeWoMaterial(prisma, wos.map((w) => w.id));
    for (const w of wos) {
      if (!w.targetItemId) continue;
      const acc = ensure(w.targetItemId, w.targetColorId, w.width, {
        itemName: w.targetItem?.name ?? null,
        colorName: w.targetColor?.name ?? null,
        colorHex: w.targetColor?.hex ?? null,
      });
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? D0()).minus(mat?.finished ?? D0())
      );
      acc.uretimde = acc.uretimde.plus(inFlight);
      if (inFlight.greaterThan(0)) {
        acc.wos.push({
          id: w.id,
          batchNumber: w.batchNumber,
          status: w.status,
          inFlight,
        });
      }
    }

    // 4) Arz eşleştirme (depo birebir, ham gevşek) + türev kolonlar + filtre.
    const data: BalanceSpec[] = [];
    for (const acc of map.values()) {
      for (const g of supply) {
        if (g.itemId !== acc.itemId) continue;
        const qty = new Prisma.Decimal(g._sum.currentQty ?? 0);
        if (qty.lessThanOrEqualTo(0)) continue;
        if (g.status === RollStatus.WAREHOUSE) {
          // Depo: birebir ürün+renk+en.
          if (
            (g.colorId ?? null) === (acc.colorId ?? null) &&
            widthEqual(g.width, acc.width)
          ) {
            acc.depo = acc.depo.plus(qty);
          }
        } else {
          // Ham: renksiz (null) joker; renkli ham yalnız kendi rengine.
          const colorOk =
            g.colorId == null ||
            acc.colorId == null ||
            g.colorId === acc.colorId;
          if (colorOk && widthCompatible(g.width, acc.width)) {
            acc.ham = acc.ham.plus(qty);
          }
        }
      }

      acc.uretilecek = Prisma.Decimal.max(
        0,
        acc.talep.minus(acc.depo).minus(acc.uretimde)
      );
      acc.malzemeAcigi = Prisma.Decimal.max(0, acc.uretilecek.minus(acc.ham));
      if (acc.talep.greaterThan(0) || acc.uretimde.greaterThan(0)) {
        // termin sırasıyla göster (bind seed'i için de hazır sıra)
        acc.lines.sort((a, b) => {
          const ad = a.deadline ? a.deadline.getTime() : Infinity;
          const bd = b.deadline ? b.deadline.getTime() : Infinity;
          if (ad !== bd) return ad - bd;
          return a.orderDate.getTime() - b.orderDate.getTime();
        });
        const { named: _named, ...spec } = acc;
        void _named;
        data.push(spec);
      }
    }

    // En çok üretilecek olan üste — planlamacı önceliği.
    data.sort((a, b) => b.uretilecek.comparedTo(a.uretilecek));

    return { success: true, data };
  }
}
