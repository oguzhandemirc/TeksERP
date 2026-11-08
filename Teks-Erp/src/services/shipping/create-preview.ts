// =============================================================================
// Shipping Service / create-preview
// =============================================================================
// Sevkiyat oluşturma önizlemesi (cari bekletme dahil) ve açık siparişlerin karşılama durumu.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  resolveOrderRequirement,
} from "../helpers/shipment-order-requirement.helper";
import { batchLoadAliasesMulti, colorScopeOf, resolveName } from "../helpers/customer-name.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { ApiResponse } from "../../types/api.types";
import { ACTIVE_SACK_ALLOCATION } from "../helpers/sack-allocation.helper";
import {
  buildTextSearch,
} from "../../utils/query-parser";
import { previewOwnerMismatches } from "../helpers/emanet-owner.helper";
import { emanetShipmentReleaseTx } from "../helpers/emanet-shipment.helper";
import { cariHoldWarning, shipmentHoldNotice } from "../helpers/cari-hold.helper";
import type { ShippingServiceThis } from "./shared";

export async function previewShipmentHold(sackIds: string[], customerId: string | null) {
    if (!customerId) return null;
    return shipmentHoldNotice(prisma, customerId, () => emanetShipmentReleaseTx(prisma, { sackId: { in: sackIds } }, customerId));
  }

export async function previewCreateShipment(this: ShippingServiceThis, 
    data: { sackIds: string[]; customerId?: string | null; branchId?: string | null; orderIds?: string[] }
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) {
      return { success: true, data: { sacks: [], lines: [], warnings: [], totals: { totalMeters: 0, sackCount: 0, surplusMeters: 0 } } };
    }
    const branchId = data.branchId ?? null;
    const orderIds = [...new Set(data.orderIds ?? [])];

    const sacks = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, weightKg: true, rolls: { select: { currentQty: true } } },
    });
    let totalMeters = D0();
    const sackRows = sacks.map((s) => {
      let m = D0();
      for (const r of s.rolls) m = m.plus(r.currentQty);
      totalMeters = totalMeters.plus(m);
      return { id: s.id, sackNo: s.sackNo, weightKg: s.weightKg != null ? Number(s.weightKg) : null, rollCount: s.rolls.length, totalMeters: Number(m) };
    });

    // Sahiplik (G3 emanet): dispatch'teki 409 `OWNER_MISMATCH` kapısının önizleme ikizi — RED DEĞİL uyarı + liste.
    const { ownerMismatches, warnings } = await previewOwnerMismatches(prisma, { sackIds, customerId: data.customerId ?? null });
    const holdNotice = await this.previewShipmentHold(sackIds, data.customerId ?? null);
    // D4-I3: şerit metni `warning` = warnings[]'e giden satırın AYNISI (panel şeridi çizer, listede tekrar etmez).
    const cariHold = holdNotice ? { ...holdNotice, warning: cariHoldWarning(holdNotice) } : null;
    if (cariHold) warnings.push(cariHold.warning);
    let lines: { lineId: string; orderNumber: string; item: string; color: string | null; width: number | null; need: number; allocated: number }[] = [];
    let surplusMeters = Number(totalMeters);

    if (orderIds.length > 0) {
      const { allocations, lineNeeds } = await this.computeSackAllocations(prisma, { sackIds, orderIds, branchId });
      const allocByLine = new Map<string, Prisma.Decimal>();
      for (const a of allocations) allocByLine.set(a.orderLineId, (allocByLine.get(a.orderLineId) ?? D0()).plus(a.qty));
      const allocatedTotal = [...allocByLine.values()].reduce((acc, q) => acc.plus(q), D0());
      surplusMeters = Number(totalMeters.minus(allocatedTotal));

      const lineRows = await prisma.orderLine.findMany({
        where: { id: { in: [...lineNeeds.keys()] } },
        select: { id: true, width: true, item: { select: { name: true } }, color: { select: { name: true } }, order: { select: { orderNumber: true } } },
      });
      // Önizleme iç operasyon ekranıdır: her zaman bizdeki ad basılır. Satırdaki
      // müşteri override'ı yalnız adın girildiği siparişte dolu olduğundan burada
      // kullanmak aynı kumaşı iki farklı adla gösteriyordu.
      lines = lineRows.map((l) => ({
        lineId: l.id, orderNumber: l.order.orderNumber,
        item: l.item.name, color: l.color?.name ?? null,
        width: l.width != null ? Number(l.width) : null,
        need: Number(lineNeeds.get(l.id) ?? 0), allocated: Number(allocByLine.get(l.id) ?? 0),
      }));

      if (surplusMeters > 0.001) {
        warnings.push(`Seçili siparişlere yazılamayan ~${Math.round(surplusMeters)} m mal var (fazla/eşleşmeyen) — yine de sevk edilecek.`);
      }
      const pendingOther = await prisma.sackAllocation.groupBy({
        by: ["orderLineId"],
        where: { orderLineId: { in: [...lineNeeds.keys()] }, sack: { shipment: { status: ShipmentStatus.PLANNED } }, ...ACTIVE_SACK_ALLOCATION },
        _sum: { qty: true },
      });
      for (const g of pendingOther) {
        const q = Number(g._sum.qty ?? 0);
        if (q > 0.001) {
          const ln = lines.find((x) => x.lineId === g.orderLineId);
          warnings.push(`${ln?.orderNumber ?? "Sipariş"} · ${ln?.item ?? ""}: bu satırda başka açık sevkiyatta ~${Math.round(q)} m bekliyor (mükerrer sevk olabilir).`);
        }
      }
    } else {
      // ⚠️ REJİME BAĞLI TEK UYARI BU. `off` yalnız BUNU susturur; yukarıdaki iki
      // uyarı (tahsis fazlası · başka açık sevkiyatta bekleyen mükerrer tahsis)
      // farklı soruların cevabıdır ve her rejimde AYAKTA kalır — diziyi topluca
      // susturmak, kırmızı tonlu mükerrer sevk uyarısını da öldürürdü.
      const mode = await resolveOrderRequirement();
      if (mode === "block") {
        warnings.push(
          "Bu kurulumda sevkiyat siparişe bağlanmalı — sipariş seçin ya da " +
            '"Siparişsiz devam et" ile niyeti beyan edin.',
        );
      } else if (mode === "warn") {
        warnings.push("Sipariş seçilmedi — mal hiçbir siparişten düşülmeden sevk edilecek.");
      }
    }

    return {
      success: true,
      data: {
        sacks: sackRows,
        lines,
        warnings,
        /** Sahiplik uyuşmazlığı (G3): `[{barcode, owner}]`; boş = sorun yok. Eski istemci alanı görmez, `warnings` metnini basar. */
        ownerMismatches,
        cariHold, // D4-I1: aktif SHIPMENT kilidi (exempt = K22) ya da null; eski istemci yok sayar
        totals: { totalMeters: Number(totalMeters), sackCount: sacks.length, surplusMeters: Math.max(0, surplusMeters) },
      },
    };
  }

export async function listOpenOrdersWithCoverage(params: {
    customerId?: string;
    branchId?: string | null;
    search?: string;
  }): Promise<ApiResponse<unknown>> {
    const where: Prisma.OrderWhereInput = { status: { notIn: ["CANCELLED", "COMPLETED"] } };
    if (params.customerId) where.customerId = params.customerId;
    if (params.branchId !== undefined) where.branchId = params.branchId;

    const search = params.search?.trim();
    if (search) {
      const or = buildTextSearch<Prisma.OrderWhereInput>(search, {
        text: [
          "customer.name",
          "lines.some.item.name",
          "lines.some.customerItemName",
          "lines.some.color.name",
        ],
        code: ["orderNumber"],
      });
      // ⚠️ SÖZLEŞME KAPISI (gözlenmiş bir hatanın yaması DEĞİL — ayrım yazılı
      // olsun): Prisma'da `OR: []` "hiçbir şey eşleşmesin" demektir, yani boş bir
      // dizi süzgeci listeyi sessizce boşaltır. `buildTextSearch` BUGÜN yalnız
      // BOŞ terimde `[]` döner ve o yol yukarıdaki `trim()` kontrolüyle zaten
      // kapalı (ölçüldü 2026-09-04: "-", "...", "·", "€", "…" dahil denenen her
      // boş-olmayan terim >=1 cümle üretti). Dal, helper'ın sözleşmesi değişirse
      // sessiz boş listeye düşmemek için duruyor.
      if (or.length > 0) where.OR = or;
    }

    const orders = await prisma.order.findMany({
      where,
      take: 300,
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { orderDate: "asc" }],
      select: {
        id: true, orderNumber: true, status: true, deadline: true, orderDate: true,
        customer: { select: { id: true, code: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        lines: { select: { id: true, itemId: true, colorId: true, width: true, quantity: true, shippedQty: true, customerItemName: true, customerColorName: true, createdAt: true, item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
      },
    });
    if (orders.length === 0) return { success: true, data: [] };

    // Serbest depo stoğu (sevke-uygun) — spec bazında toplam. Yalnız WAREHOUSE (bitmiş, sevke
    // hazır); ham STOCK sayılmaz — ham satışı nadir/özel talep, "mevcut" göstergesini şişirmesin.
    // (Ham yine de çuvala okutulup sevk EDİLEBİLİR; sadece bu sayaçta görünmez.) sackId:null:
    // çuvaldaki (bekleyen) toplar serbest sayılmaz.
    const itemIds = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.itemId)))];
    const stockBySpec = await prisma.roll.groupBy({
      by: ["itemId", "colorId", "width"],
      where: { shipmentId: null, sackId: null, status: RollStatus.WAREHOUSE, itemId: { in: itemIds } },
      _sum: { currentQty: true },
    });
    const specAvail = (line: { itemId: string; colorId: string | null; width: Prisma.Decimal | null }): Prisma.Decimal =>
      stockBySpec.reduce((sum, g) => {
        if (g.itemId !== line.itemId) return sum;
        if (line.colorId != null && g.colorId != null && g.colorId !== line.colorId) return sum;
        if (line.width != null && g.width != null && !new Prisma.Decimal(line.width).equals(g.width)) return sum;
        return sum.plus(g._sum.currentQty ?? 0);
      }, D0());

    // MÜŞTERİDEKİ AD — `getShipmentById` ile AYNI kademe (2026-09-06): override >
    // master alias > yok. Bu uç `customerId`siz de çağrılabildiği için alias'lar
    // müşteri BAŞINA döngüyle değil, (customerId, itemId) çiftleriyle TEK sorgu
    // çiftinde çekilir — kaç müşteri olursa olsun 2 gidiş-dönüş.
    const { itemAlias: kumasAlias, colors } = await batchLoadAliasesMulti(
      prisma,
      orders.map((o) => o.customer.id),
      orders.flatMap((o) => o.lines.map((l) => l.itemId)),
      orders.flatMap((o) => o.lines.map((l) => l.colorId)),
    );

    const data = orders.map((o) => ({
      order: { id: o.id, orderNumber: o.orderNumber, status: o.status, deadline: o.deadline, customer: o.customer, branch: o.branch },
      lines: o.lines.map((l) => {
        const requested = new Prisma.Decimal(l.quantity);
        const shipped = new Prisma.Decimal(l.shippedQty);
        const openQty = requested.minus(shipped);
        const fromWarehouse = specAvail(l);
        // DEFAULT'a düşerse null — arayüz bizim adımızı "müşterideki ad" diye basmasın.
        const musteriKumas = resolveName(l.customerItemName, kumasAlias.get(`${o.customer.id}:${l.itemId}`), "");
        const renkMaster = colors.master(o.customer.id, l.itemId, l.colorId);
        const musteriRenk = resolveName(l.customerColorName, renkMaster?.alias, "");
        return {
          lineId: l.id, item: l.item, color: l.color, width: l.width,
          customerItemName: musteriKumas.source === "DEFAULT" ? null : musteriKumas.name,
          customerColorName: musteriRenk.source === "DEFAULT" ? null : musteriRenk.name,
          colorNameScope: colorScopeOf(musteriRenk, renkMaster),
          requested, shipped, openQty, warehouseAvailable: fromWarehouse,
          covered: openQty.lessThanOrEqualTo(0) || fromWarehouse.greaterThanOrEqualTo(openQty),
        };
      }),
    }));
    return { success: true, data };
  }
