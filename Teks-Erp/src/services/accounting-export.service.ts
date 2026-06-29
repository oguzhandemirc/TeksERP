// =============================================================================
// Muhasebe Export Servisi — "Sevk Edilenler" döküm (Excel) veri seti
// =============================================================================
// Salt-okunur. Ekrandaki (AccountingDispatchPage) tarih aralığı + müşteri
// filtresine göre DISPATCHED sevkiyatları toplar; frontend exceljs ile çok
// sayfalı .xlsx üretir. Mali alan (fiyat/KDV) YOK — miktar-odaklı (metre/kg/
// çuval/top/vergi no/yön). Gruplama mantığı shipping.service.getDispatchReport
// ile aynı (ürün = item + color + width; çuval kg brüt).
//
// Filtre yolu listShipments ile birebir: parseQueryParams → buildWhereClause →
// applyDateRange. status zorla DISPATCHED. Perf: tek nested sorgu + JS toplama
// (bounded set); shipment sayısı eşiği aşarsa 400 ("aralığı daraltın").
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import type { Request } from "express";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { parseQueryParams, buildWhereClause } from "../utils/query-parser";

// listShipments ile aynı whitelist (drift olmaması için aynı değerler).
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier"];
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt", "readyAt"] as const;

// Tek export isteğinde toplanacak en fazla sevkiyat. Aşılırsa kullanıcı aralığı
// daraltır (sessiz devasa indirme + uzun sorgu yerine açık 400).
const MAX_SHIPMENTS = 2000;
// Seçim (A) modunda ?ids= ile gelebilecek en fazla sevk. Querystring uzunluğunu
// (Node 16KB header limiti) ve yükü sınırlar; daha fazlası için dönem export.
const MAX_IDS = 200;
const DAY_MS = 86_400_000;
// Dönem export'ta tarih aralığı VERİLMEZSE uygulanan savunmacı pencere — "filtresiz
// tüm-zaman" çekimi İMKANSIZ. Aralık verilirse bu yok sayılır (ama MAX_RANGE'i aşamaz).
const DEFAULT_DAYS = 90;
const MAX_RANGE_MS = 366 * DAY_MS;
// ?ids= UUID doğrulaması — geçersiz değer Postgres uuid kolonunda 500 atar; önce ele.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const D0 = () => new Prisma.Decimal(0);

interface ShipmentRow {
  shipmentNo: string;
  dispatchedAt: Date;
  customerCode: string;
  customerName: string;
  taxNumber: string;
  branchName: string;
  destination: string;
  procedureCode: string;
  plateNumber: string;
  driverName: string;
  carrier: string;
  sackCount: number;
  rollCount: number;
  totalMeters: number;
  totalKg: number;
}

interface DetailRow {
  shipmentNo: string;
  dispatchedAt: Date;
  customerName: string;
  orderNos: string;
  itemName: string;
  colorName: string;
  width: number | null;
  rollCount: number;
  meters: number;
}

interface CustomerAgg {
  customerCode: string;
  customerName: string;
  taxNumber: string;
  shipmentCount: number;
  sackCount: number;
  rollCount: number;
  totalMeters: Prisma.Decimal;
  totalKg: Prisma.Decimal;
}

interface ProductAgg {
  itemName: string;
  colorName: string;
  width: number | null;
  rollCount: number;
  totalMeters: Prisma.Decimal;
}

/**
 * Muhasebe Excel veri seti. Frontend çağırır; res.json Decimal'leri zaten
 * number'a çevirir ama burada da Number() ile düz sayı döndürürüz (kural:
 * float aritmetiği yok → topla `.plus()`, sonra Number()).
 */
export async function buildDispatchAccountingExport(req: Request): Promise<{
  success: true;
  data: unknown;
}> {
  const params = parseQueryParams(req);

  // listShipments ile aynı where kuruluşu + zorla DISPATCHED.
  const where = buildWhereClause(
    params.filters,
    SHIPMENT_SEARCH_FIELDS,
    params.search
  ) as Prisma.ShipmentWhereInput;
  where.status = ShipmentStatus.DISPATCHED;
  const rawCustomerId = req.query.customerId as string | undefined;
  if (rawCustomerId) where.customerId = rawCustomerId;
  const customerId =
    (typeof params.filters.customerId === "string" ? params.filters.customerId : undefined) ??
    rawCustomerId;

  // İki mod:
  //  • SEÇİM (A): ?ids=a,b,c → yalnız işaretli sevkler (tarih aralığı yok sayılır).
  //  • DÖNEM: ids yok → HER ZAMAN sınırlı tarih penceresi. Aralık verilmezse son
  //    DEFAULT_DAYS gün uygulanır ("filtresiz tüm-zaman" çekimi İMKANSIZ); verilirse
  //    MAX_RANGE'i aşamaz. dateField geçersizse dispatchedAt'e düşer.
  const idsRaw = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
  const idList = idsRaw
    ? idsRaw.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s))
    : [];
  // ids gönderildi ama hiçbiri geçerli UUID değil → 500 yerine açık 400.
  if (idsRaw && idList.length === 0) {
    throw AppError.badRequest("Geçersiz sevkiyat ID(leri).");
  }
  const isSelection = idList.length > 0;
  const effField =
    params.dateField && (SHIPMENT_DATE_FIELDS as readonly string[]).includes(params.dateField)
      ? params.dateField
      : "dispatchedAt";
  const effTo = params.dateTo ?? new Date();
  const effFrom = params.dateFrom ?? new Date(effTo.getTime() - DEFAULT_DAYS * DAY_MS);

  if (isSelection) {
    if (idList.length > MAX_IDS) {
      throw AppError.badRequest(
        `Tek seferde en fazla ${MAX_IDS} sevkiyat seçilebilir (${idList.length} seçildi). ` +
          `Daha fazlası için tarih/müşteri filtresiyle dönem export'u kullanın.`
      );
    }
    where.id = { in: idList };
  } else {
    if (effFrom > effTo) {
      throw AppError.badRequest("Başlangıç tarihi bitiş tarihinden büyük olamaz.");
    }
    if (effTo.getTime() - effFrom.getTime() > MAX_RANGE_MS) {
      throw AppError.badRequest("Tarih aralığı en fazla 366 gün olabilir. Aralığı daraltın.");
    }
    (where as Record<string, unknown>)[effField] = { gte: effFrom, lte: effTo };
  }

  // Perf guard — önce UCUZ indexli COUNT; aşımda hiç yüklemeden 400 (sunucu RAM/CPU
  // şişmez). Excel üretimi zaten istemci (renderer) tarafında — sunucu yalnız JSON döner.
  const count = await prisma.shipment.count({ where });
  if (count > MAX_SHIPMENTS) {
    throw AppError.badRequest(
      `Seçili kapsamda ${count} sevkiyat var (üst sınır ${MAX_SHIPMENTS}). ` +
        `Tarih aralığını daraltın veya daha az sevk seçin.`
    );
  }

  const shipments = await prisma.shipment.findMany({
    where,
    orderBy: [{ dispatchedAt: "desc" }, { createdAt: "desc" }],
    select: {
      shipmentNo: true,
      dispatchedAt: true,
      createdAt: true,
      destination: true,
      procedureCode: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      customer: { select: { code: true, name: true, taxNumber: true } },
      branch: { select: { name: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        select: {
          weightKg: true,
          rolls: {
            select: {
              currentQty: true,
              width: true,
              item: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const shipmentRows: ShipmentRow[] = [];
  const detailRows: DetailRow[] = [];
  const byCustomer = new Map<string, CustomerAgg>();
  const byProduct = new Map<string, ProductAgg>();

  let gSack = 0;
  let gRoll = 0;
  let gMeters = D0();
  let gKg = D0();

  for (const sh of shipments) {
    let sMeters = D0();
    let sKg = D0();
    let rollCount = 0;
    const prodMap = new Map<string, ProductAgg>();

    for (const sk of sh.sacks) {
      if (sk.weightKg != null) sKg = sKg.plus(sk.weightKg);
      for (const r of sk.rolls) {
        rollCount += 1;
        sMeters = sMeters.plus(r.currentQty);
        const itemName = r.item.name;
        const colorName = r.color?.name ?? "";
        const widthNum = r.width != null ? Number(r.width) : null;
        const key = `${itemName}|${colorName}|${widthNum ?? ""}`;

        const g = prodMap.get(key) ?? { itemName, colorName, width: widthNum, rollCount: 0, totalMeters: D0() };
        g.rollCount += 1;
        g.totalMeters = g.totalMeters.plus(r.currentQty);
        prodMap.set(key, g);

        const pg = byProduct.get(key) ?? { itemName, colorName, width: widthNum, rollCount: 0, totalMeters: D0() };
        pg.rollCount += 1;
        pg.totalMeters = pg.totalMeters.plus(r.currentQty);
        byProduct.set(key, pg);
      }
    }

    const sackCount = sh.sacks.length;
    const dispatchedAt = sh.dispatchedAt ?? sh.createdAt;
    const orderNos = sh.orders.map((o) => o.order.orderNumber).join(", ");
    const taxNumber = sh.customer.taxNumber ?? "";

    shipmentRows.push({
      shipmentNo: sh.shipmentNo,
      dispatchedAt,
      customerCode: sh.customer.code,
      customerName: sh.customer.name,
      taxNumber,
      branchName: sh.branch?.name ?? "",
      destination: sh.destination,
      procedureCode: sh.procedureCode ?? "",
      plateNumber: sh.plateNumber ?? "",
      driverName: sh.driverName ?? "",
      carrier: sh.carrier ?? "",
      sackCount,
      rollCount,
      totalMeters: Number(sMeters),
      totalKg: Number(sKg),
    });

    for (const g of prodMap.values()) {
      detailRows.push({
        shipmentNo: sh.shipmentNo,
        dispatchedAt,
        customerName: sh.customer.name,
        orderNos,
        itemName: g.itemName,
        colorName: g.colorName,
        width: g.width,
        rollCount: g.rollCount,
        meters: Number(g.totalMeters),
      });
    }

    const ckey = sh.customer.code || sh.customer.name;
    const c =
      byCustomer.get(ckey) ??
      ({
        customerCode: sh.customer.code,
        customerName: sh.customer.name,
        taxNumber,
        shipmentCount: 0,
        sackCount: 0,
        rollCount: 0,
        totalMeters: D0(),
        totalKg: D0(),
      } satisfies CustomerAgg);
    c.shipmentCount += 1;
    c.sackCount += sackCount;
    c.rollCount += rollCount;
    c.totalMeters = c.totalMeters.plus(sMeters);
    c.totalKg = c.totalKg.plus(sKg);
    byCustomer.set(ckey, c);

    gSack += sackCount;
    gRoll += rollCount;
    gMeters = gMeters.plus(sMeters);
    gKg = gKg.plus(sKg);
  }

  // İade (RollReturn) — iptal hariç. Seçim modunda: işaretli sevklerden gelen iadeler
  // (fromShipmentId ∈ ids). Dönem modunda: effFrom–effTo penceresindeki iadeler + müşteri.
  const returnWhere: Prisma.RollReturnWhereInput = isSelection
    ? { cancelledAt: null, fromShipmentId: { in: idList } }
    : {
        cancelledAt: null,
        createdAt: { gte: effFrom, lte: effTo },
        ...(customerId ? { customerId } : {}),
      };
  const returnRows = await prisma.rollReturn.findMany({
    where: returnWhere,
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      qty: true,
      width: true,
      reasonText: true,
      roll: { select: { barcode: true } },
      item: { select: { name: true } },
      color: { select: { name: true } },
      reason: { select: { name: true } },
      customer: { select: { name: true } },
      fromShipment: { select: { shipmentNo: true } },
    },
  });

  let returnMeters = D0();
  const returns = returnRows.map((rr) => {
    returnMeters = returnMeters.plus(rr.qty);
    return {
      returnedAt: rr.createdAt,
      customerName: rr.customer.name,
      fromShipmentNo: rr.fromShipment?.shipmentNo ?? "",
      barcode: rr.roll.barcode ?? "",
      itemName: rr.item.name,
      colorName: rr.color?.name ?? "",
      width: rr.width != null ? Number(rr.width) : null,
      meters: Number(rr.qty),
      reason: rr.reason?.name ?? rr.reasonText ?? "",
    };
  });

  return {
    success: true,
    data: {
      range: {
        from: isSelection ? null : effFrom.toISOString(),
        to: isSelection ? null : effTo.toISOString(),
        field: isSelection ? null : effField,
        mode: isSelection ? "selection" : "period",
        selectedCount: isSelection ? idList.length : undefined,
      },
      shipments: shipmentRows,
      detail: detailRows,
      byCustomer: [...byCustomer.values()].map((c) => ({
        customerCode: c.customerCode,
        customerName: c.customerName,
        taxNumber: c.taxNumber,
        shipmentCount: c.shipmentCount,
        sackCount: c.sackCount,
        rollCount: c.rollCount,
        totalMeters: Number(c.totalMeters),
        totalKg: Number(c.totalKg),
      })),
      byProduct: [...byProduct.values()].map((p) => ({
        itemName: p.itemName,
        colorName: p.colorName,
        width: p.width,
        rollCount: p.rollCount,
        totalMeters: Number(p.totalMeters),
      })),
      returns,
      totals: {
        shipmentCount: shipmentRows.length,
        sackCount: gSack,
        rollCount: gRoll,
        totalMeters: Number(gMeters),
        totalKg: Number(gKg),
        returnMeters: Number(returnMeters),
      },
    },
  };
}
