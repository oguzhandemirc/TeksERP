// =============================================================================
// Shipping Service / repair
// =============================================================================
// Sevk tahsis onarımı: onarılabilir sevkiyatlar, önizleme, uygulama.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  ShipmentStatus,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { specMatch } from "../helpers/allocation.helper";
import {
  readShippingAllocWidthToleranceCm,
  readShippingAllowOverAllocation,
} from "../system-setting.service";
import {
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  distributeSacksToLines,
  type SackAllocLine,
} from "../helpers/allocation.helper";
import { ApiResponse } from "../../types/api.types";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";
import type { ShippingServiceThis } from "./shared";

/**
 * Onarım önizlemesinin satır tablosu — motorun istediği `SackAllocLine` biçimi
 * ile ekranın istediği okunur bağlam (sipariş no / ürün / renk / en) TEK
 * geçişte kurulur; ikisi ayrı yerlerde kurulsaydı satır eşleşmesi elle
 * yapılırdı ve sessizce kayabilirdi.
 */
function onarimSatirlariniKur(
  orders: {
    order: {
      orderNumber: string; branchId: string | null; createdAt: Date; deadline: Date | null;
      lines: {
        id: string; itemId: string; colorId: string | null; width: Prisma.Decimal | null;
        quantity: Prisma.Decimal; shippedQty: Prisma.Decimal; createdAt: Date;
        item: { name: string }; color: { name: string } | null;
      }[];
    };
  }[],
): {
  bilgi: Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>;
  lines: SackAllocLine[];
} {
  const bilgi = new Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>();
  const lines = orders.flatMap((so) =>
    so.order.lines.map((l) => {
      const acik = Number(l.quantity) - Number(l.shippedQty);
      bilgi.set(l.id, {
        orderNumber: so.order.orderNumber,
        itemName: l.item.name,
        colorName: l.color?.name ?? null,
        width: l.width == null ? null : Number(l.width),
        acikOnce: Math.round(acik * 1000) / 1000,
      });
      return {
        id: l.id, itemId: l.itemId, colorId: l.colorId, width: l.width,
        branchId: so.order.branchId,
        need: new Prisma.Decimal(Math.max(acik, 0)),
        deadline: so.order.deadline,
        orderDate: so.order.createdAt,
        lineCreatedAt: l.createdAt,
      };
    }),
  );
  return { bilgi, lines };
}

/**
 * Dağıtım sonucunu ekranın tablosuna çevirir. Aynı sipariş satırına BİRDEN ÇOK
 * çuvaldan gelen metraj TEK satırda toplanır — kullanıcı çuval kırılımını değil
 * "hangi siparişe kaç metre" sorusunu soruyor. En çok yazılan satır üstte.
 */
function onarimKalemleriniKur(
  dagitim: { orderLineId: string; qty: Prisma.Decimal }[],
  bilgi: Map<string, { orderNumber: string; itemName: string; colorName: string | null; width: number | null; acikOnce: number }>,
) {
  const satirToplam = new Map<string, number>();
  for (const d of dagitim) {
    satirToplam.set(d.orderLineId, (satirToplam.get(d.orderLineId) ?? 0) + Number(d.qty));
  }
  return [...satirToplam.entries()]
    .map(([lineId, yazilacak]) => {
      const b = bilgi.get(lineId)!;
      const y = Math.round(yazilacak * 1000) / 1000;
      return {
        orderLineId: lineId,
        orderNumber: b.orderNumber,
        itemName: b.itemName,
        colorName: b.colorName,
        width: b.width,
        acikOnce: b.acikOnce,
        yazilacak: y,
        acikSonra: Math.round((b.acikOnce - y) * 1000) / 1000,
      };
    })
    .sort((a2, b2) => b2.yazilacak - a2.yazilacak);
}

export async function listRepairableShipments(): Promise<ApiResponse<unknown>> {
    const sevkiyatlar = await prisma.shipment.findMany({
      where: { status: ShipmentStatus.DISPATCHED, orders: { some: {} } },
      select: {
        id: true, shipmentNo: true, dispatchedAt: true,
        customer: { select: { id: true, name: true } },
        sacks: {
          select: {
            branchId: true,
            rolls: { where: { status: { notIn: SACK_ABSENT_STATUSES } }, select: { itemId: true, colorId: true, width: true, currentQty: true } },
            allocations: { where: ACTIVE_SACK_ALLOCATION, select: { qty: true } },
          },
        },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, branchId: true,
                lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true } },
              },
            },
          },
        },
      },
      orderBy: { dispatchedAt: "desc" },
    });

    const enTolerans = await readShippingAllocWidthToleranceCm();
    const satirlar: unknown[] = [];
    for (const sh of sevkiyatlar) {
      const icerik = sh.sacks.reduce((a2, sk) => a2 + sk.rolls.reduce((b2, r) => b2 + Number(r.currentQty), 0), 0);
      const yazilan = sh.sacks.reduce((a2, sk) => a2 + sk.allocations.reduce((b2, x) => b2 + Number(x.qty), 0), 0);
      const bosluk = Math.round((icerik - yazilan) * 1000) / 1000;
      if (bosluk <= 0.001) continue;

      const kalemler = sh.orders.flatMap((so) =>
        so.order.lines.map((l) => ({
          itemId: l.itemId, colorId: l.colorId, width: l.width,
          branchId: so.order.branchId,
          kalan: Number(l.quantity) - Number(l.shippedQty),
        })),
      );
      // "Bugün yazılabilir mi" — motorun kendi yüklemleri: spec + şube + kapasite.
      let onarilabilir = 0;
      for (const sk of sh.sacks) {
        for (const r of sk.rolls) {
          const uygun = kalemler.some(
            (l) =>
              specMatch(r, l, enTolerans) &&
              (sk.branchId ?? null) === (l.branchId ?? null) &&
              l.kalan > 0.001,
          );
          if (uygun) onarilabilir += Number(r.currentQty);
        }
      }
      satirlar.push({
        shipmentId: sh.id,
        shipmentNo: sh.shipmentNo,
        dispatchedAt: sh.dispatchedAt,
        customer: sh.customer,
        orderNumbers: sh.orders.map((so) => so.order.orderNumber),
        // ⚠️ `orderNumbers` KALDIRILMADI: sahadaki panel onu okuyor. Yeni alan
        // numarayı TIKLANABİLİR yapmak için id taşır — numara ile sipariş aramak
        // ikinci bir okuma yolu (ve mükerrer numarada yanlış siparişi açardı).
        orders: sh.orders.map((so) => ({ id: so.order.id, orderNumber: so.order.orderNumber })),
        icerikMetraj: Math.round(icerik * 1000) / 1000,
        yazilanMetraj: Math.round(yazilan * 1000) / 1000,
        bosluk,
        /** Bugün yeniden denense yazılabilecek metraj — onarımın beklenen kazancı. */
        onarilabilirMetraj: Math.round(Math.min(onarilabilir, bosluk) * 1000) / 1000,
      });
    }
    return { success: true, data: satirlar };
  }

export async function previewRepairAllocation(shipmentId: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true,
        customer: { select: { id: true, name: true } },
        sacks: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, branchId: true,
            rolls: {
              where: { status: { notIn: SACK_ABSENT_STATUSES } },
              select: { itemId: true, colorId: true, width: true, currentQty: true },
            },
            allocations: { where: ACTIVE_SACK_ALLOCATION, select: { qty: true } },
          },
        },
        orders: {
          select: {
            order: {
              select: {
                id: true, orderNumber: true, branchId: true, createdAt: true, deadline: true,
                lines: {
                  select: {
                    id: true, itemId: true, colorId: true, width: true,
                    quantity: true, shippedQty: true, createdAt: true,
                    item: { select: { name: true } },
                    color: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");

    const enTolerans = await readShippingAllocWidthToleranceCm();
    const fazlaSevk = await readShippingAllowOverAllocation();

    const { bilgi, lines } = onarimSatirlariniKur(sh.orders);

    const dagitim = distributeSacksToLines(
      sh.sacks.map((sk) => ({
        sackId: sk.id,
        branchId: sk.branchId,
        rolls: sk.rolls.map((r) => ({ itemId: r.itemId, colorId: r.colorId, width: r.width, currentQty: r.currentQty })),
      })),
      lines,
      enTolerans,
      fazlaSevk,
    );

    const kalemler = onarimKalemleriniKur(dagitim, bilgi);

    const icerik = sh.sacks.reduce((a2, sk) => a2 + sk.rolls.reduce((c, r) => c + Number(r.currentQty), 0), 0);
    const yazili = sh.sacks.reduce((a2, sk) => a2 + sk.allocations.reduce((c, x) => c + Number(x.qty), 0), 0);
    const toplamYazilacak = kalemler.reduce((a2, k) => a2 + k.yazilacak, 0);

    return {
      success: true,
      data: {
        shipmentId: sh.id,
        shipmentNo: sh.shipmentNo,
        customer: sh.customer,
        icerikMetraj: Math.round(icerik * 1000) / 1000,
        yazilanMetraj: Math.round(yazili * 1000) / 1000,
        yazilacakMetraj: Math.round(toplamYazilacak * 1000) / 1000,
        enToleransCm: enTolerans,
        fazlaSevkYazilir: fazlaSevk,
        kalemler,
      },
    };
  }

export async function repairShipmentAllocation(this: ShippingServiceThis, shipmentId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, shipmentNo: true, status: true, orders: { select: { orderId: true } } },
    });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
    if (sh.status !== ShipmentStatus.DISPATCHED) {
      throw AppError.conflict("Yalnız sevk EDİLMİŞ sevkiyatın defteri onarılır");
    }
    if (sh.orders.length === 0) {
      throw AppError.conflict("Sevkiyata bağlı sipariş yok — onarılacak defter yok");
    }
    const oncesi = await this.olcTahsis(shipmentId);
    await this.setShipmentOrders(shipmentId, sh.orders.map((o) => o.orderId), userId);
    const sonrasi = await this.olcTahsis(shipmentId);
    const kazanc = Math.round((sonrasi - oncesi) * 1000) / 1000;
    await AuditService.log({
      userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId,
      newData: { kind: "ALLOCATION_REPAIR", shipmentNo: sh.shipmentNo, oncesi, sonrasi, kazanc },
    });
    return {
      success: true,
      data: { shipmentNo: sh.shipmentNo, oncesi, sonrasi, kazanc },
      message: kazanc > 0.001
        ? `${sh.shipmentNo}: ${Math.round(kazanc)} m sipariş defterine yazıldı`
        : `${sh.shipmentNo}: yazılabilecek yeni metraj bulunamadı (defter değişmedi)`,
    };
  }

export async function olcTahsis(shipmentId: string): Promise<number> {
    const rows = await prisma.sackAllocation.aggregate({
      where: { sack: { shipmentId }, ...ACTIVE_SACK_ALLOCATION },
      _sum: { qty: true },
    });
    return Math.round(Number(rows._sum.qty ?? 0) * 1000) / 1000;
  }
