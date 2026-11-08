// =============================================================================
// Order Service / detail
// =============================================================================
// Detay yanıtının renk adı çözümü ve siparişin sevkiyatları.
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  ShipmentStatus,
} from "@prisma/client";
import { colorScopeOf, loadCustomerColorIndex, resolveName } from "../helpers/customer-name.helper";
import type { OrderWithLines } from "./shared";

// ── Sipariş → sevkiyat drill-down (getOrderShipments) ────────────────────────
/** İç toplama kovası — çuval sevki ve fason direkt sevk aynı şekle indirgenir. */
interface ShipmentAgg {
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  kind: "SHIPMENT" | "DIRECT";
  date: Date | null;
  qty: Prisma.Decimal;
  sacks: Set<string>;
  branchName: string | null;
}

export interface OrderShipmentRow {
  /** DIRECT legacy toplu satırında boş (tıklanamaz). */
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  kind: "SHIPMENT" | "DIRECT";
  /** ISO; PLANNED çuval-sevkinde/DIRECT-legacy'de null olabilir. */
  date: string | null;
  qty: number;
  sackCount: number;
  branchName: string | null;
}

export interface OrderShipmentsResult {
  /** DISPATCHED çuval + fason direkt — order.shippedQty ile mutabık. */
  dispatchedTotal: number;
  /** PLANNED çuval (bekleyen, henüz sevk edilmemiş). */
  plannedTotal: number;
  shipments: OrderShipmentRow[];
}

export async function withResolvedColorNames(order: OrderWithLines, withMaster: boolean): Promise<void> {
    const lines = order.lines ?? [];
    const colors = withMaster
      ? await loadCustomerColorIndex(prisma, {
          customerIds: [order.customerId],
          itemIds: lines.map((l) => l.itemId),
          colorIds: lines.map((l) => l.colorId),
        })
      : null;
    for (const l of lines) {
      const master = colors?.master(order.customerId, l.itemId, l.colorId) ?? null;
      const r = resolveName(l.customerColorName, master?.alias, "");
      l.resolvedCustomerColorName = r.source === "DEFAULT" ? null : r.name;
      l.colorNameScope = colorScopeOf(r, master);
    }
  }

export async function getOrderShipments(orderId: string): Promise<ApiResponse<OrderShipmentsResult>> {
    // ── Kaynak A: çuval sevkiyatı ──
    const sackAllocs = await prisma.sackAllocation.findMany({
      where: {
        orderLine: { orderId },
        sack: { shipment: { status: { not: ShipmentStatus.CANCELLED } } },
        ...ACTIVE_SACK_ALLOCATION,
      },
      select: {
        qty: true,
        sackId: true,
        sack: {
          select: {
            shipment: {
              select: {
                id: true,
                shipmentNo: true,
                status: true,
                dispatchedAt: true,
                branch: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const byShipment = new Map<string, ShipmentAgg>();
    for (const a of sackAllocs) {
      const s = a.sack.shipment;
      if (!s) continue;
      let agg = byShipment.get(s.id);
      if (!agg) {
        agg = {
          shipmentId: s.id,
          shipmentNo: s.shipmentNo,
          status: s.status,
          kind: "SHIPMENT",
          date: s.dispatchedAt,
          qty: new Prisma.Decimal(0),
          sacks: new Set<string>(),
          branchName: s.branch?.name ?? null,
        };
        byShipment.set(s.id, agg);
      }
      agg.qty = agg.qty.plus(a.qty);
      agg.sacks.add(a.sackId);
    }

    // ── Kaynak B: fason direkt sevk ──
    const directAllocs = await prisma.subcontractorDirectShipAllocation.findMany({
      where: { orderLine: { orderId } },
      select: {
        qty: true,
        directShipmentId: true,
        directShipment: {
          select: {
            id: true,
            shipmentNo: true,
            shippedAt: true,
            branch: { select: { name: true } },
          },
        },
      },
    });

    const byDirect = new Map<string, ShipmentAgg>();
    let legacyDirectQty = new Prisma.Decimal(0);
    for (const a of directAllocs) {
      const d = a.directShipment;
      if (!d || !a.directShipmentId) {
        legacyDirectQty = legacyDirectQty.plus(a.qty);
        continue;
      }
      let agg = byDirect.get(d.id);
      if (!agg) {
        agg = {
          shipmentId: d.id,
          shipmentNo: d.shipmentNo,
          status: ShipmentStatus.DISPATCHED, // direkt sevk terminal
          kind: "DIRECT",
          date: d.shippedAt,
          qty: new Prisma.Decimal(0),
          sacks: new Set<string>(),
          branchName: d.branch?.name ?? null,
        };
        byDirect.set(d.id, agg);
      }
      agg.qty = agg.qty.plus(a.qty);
    }

    // ── Totaller (mutabakat: dispatchedTotal = order.shippedQty) ──
    let dispatchedTotal = new Prisma.Decimal(0);
    let plannedTotal = new Prisma.Decimal(0);
    for (const agg of byShipment.values()) {
      if (agg.status === ShipmentStatus.DISPATCHED) dispatchedTotal = dispatchedTotal.plus(agg.qty);
      else if (agg.status === ShipmentStatus.PLANNED) plannedTotal = plannedTotal.plus(agg.qty);
    }
    for (const agg of byDirect.values()) dispatchedTotal = dispatchedTotal.plus(agg.qty);
    dispatchedTotal = dispatchedTotal.plus(legacyDirectQty);

    // ── Satırlar: PLANNED üstte (bekliyor), sonra tarih desc ──
    const rows = [...byShipment.values(), ...byDirect.values()].map((a) => ({
      shipmentId: a.shipmentId,
      shipmentNo: a.shipmentNo,
      status: a.status,
      kind: a.kind,
      date: a.date ? a.date.toISOString() : null,
      qty: a.qty.toNumber(),
      sackCount: a.sacks.size,
      branchName: a.branchName,
    }));
    if (legacyDirectQty.greaterThan(0)) {
      rows.push({
        shipmentId: "",
        shipmentNo: "Fason direkt sevk (eski)",
        status: ShipmentStatus.DISPATCHED,
        kind: "DIRECT",
        date: null,
        qty: legacyDirectQty.toNumber(),
        sackCount: 0,
        branchName: null,
      });
    }
    rows.sort((a, b) => {
      const ap = a.status === ShipmentStatus.PLANNED ? 0 : 1;
      const bp = b.status === ShipmentStatus.PLANNED ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ad = a.date ? Date.parse(a.date) : 0;
      const bd = b.date ? Date.parse(b.date) : 0;
      return bd - ad;
    });

    return {
      success: true,
      data: {
        dispatchedTotal: dispatchedTotal.toNumber(),
        plannedTotal: plannedTotal.toNumber(),
        shipments: rows,
      },
    };
  }
