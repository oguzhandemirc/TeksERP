// =============================================================================
// Muhasebe Export Servisi — "Sevk Edilenler" döküm (Excel) veri seti
// =============================================================================
// Salt-okunur. Ekrandaki (AccountingDispatchPage) tarih aralığı + müşteri
// filtresine göre DISPATCHED sevkiyatları toplar; frontend exceljs ile çok
// sayfalı .xlsx üretir. Mali alan (fiyat/KDV) YOK — miktar-odaklı (metre/kg/
// çuval/top/vergi no/yön). Gruplama mantığı shipping.service.getDispatchReport
// ile aynı (ürün = item + color + width; çuval kg brüt).
//
// ⚠️ SEVK SATIRLARI BRÜT'TÜR (sevk anı) — iade DÜŞÜLMEZ; iadeler yalnız kendi
// "İade" sayfasında durur. Böylece "sevk − iade = net" aritmetiği doğrudur.
// (Eskiden satırlar canlı okunduğu için ZATEN net idi ve ayrıca iade sayfası
// vardı → muhasebeci aynı metrajı iki kez düşüyordu.) İki kümenin kapsamı
// bilinçli olarak FARKLI ve bu bir hata değildir: sevk satırları DÖNEMDE SEVK
// EDİLEN'i, iade satırları DÖNEMDE İADE ALINAN'ı gösterir — temmuzda iade edilen
// bir haziran sevkiyatı temmuz dökümünde yalnız iade tarafında görünür.
//
// Filtre yolu listShipments ile birebir: parseQueryParams → buildWhereClause →
// applyDateRange. status zorla DISPATCHED. Perf: tek nested sorgu + JS toplama
// (bounded set); shipment sayısı eşiği aşarsa 400 ("aralığı daraltın").
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";
import type { Request } from "express";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import {
  parseQueryParams,
  buildWhereClause,
  readFilterList,
  readIdCondition,
} from "../utils/query-parser";

// listShipments ile aynı whitelist (drift olmaması için aynı değerler).
const SHIPMENT_SEARCH_FIELDS = ["shipmentNo", "plateNumber", "driverName", "carrier", "customer.name"];
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt"] as const;

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
  branchCode: string;
  destination: string;
  procedureCode: string;
  plateNumber: string;
  driverName: string;
  carrier: string;
  sackCount: number;
  rollCount: number;
  totalMeters: number;
  totalKg: number;
  /** Dış muhasebe programındaki fatura izi — ERP fatura kesmez, yalnız işaretler. */
  invoiceNo: string;
  invoicedAt: Date | null;
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
  // F248: customerId TEK doğrulanmış kaynak (where + returnWhere). buildWhereClause
  // filter[customerId]'yi doğrulamadan yazmış olabilir → önce sil, sonra doğrulanmış
  // değeri ata (malformed UUID → Prisma parse 500 yerine açık Türkçe 400).
  //
  // ⚠️ ÇOKLU SEÇİM (denetim 2026-08-09, F-CORE-API-001): muhasebe ekranının müşteri
  // filtresi `multi-lookup`tur ve FilterBar CSV yollar (`filter[customerId]=a,b`);
  // export isteği ekranın URL parametrelerini AYNEN iletir. Eski kod tekil `UUID_RE.test`
  // ile doğruluyordu, CSV o testi geçemiyordu ve `delete` zaten filtreyi silmiş olduğu
  // için müşteri koşulu SESSİZCE DÜŞÜYORDU: ekran 2 müşteri gösterirken inen Excel
  // dönemdeki TÜM müşterileri içeriyordu. Kural (kök CLAUDE.md): elle okunan her id
  // filtresi `readIdCondition`dan geçer — tek değer düz eşitlik, N değer `{ in: [...] }`.
  delete (where as { customerId?: unknown }).customerId;
  // `?customerId=` (doğrudan) `filter[customerId]`e göre ÖNCELİKLİDİR — eski davranış.
  const rawCustomerIds = readFilterList(
    req.query.customerId as string | string[] | undefined,
  );
  const customerIds = rawCustomerIds.length
    ? rawCustomerIds
    : readFilterList(params.filters.customerId);
  // Doğrulama PARÇA BAŞINA: bozuk bir uuid sessizce düşmez, net Türkçe 400 verir.
  for (const id of customerIds) {
    if (!UUID_RE.test(id)) throw AppError.badRequest("Geçersiz müşteri ID.");
  }
  const customerId = readIdCondition(customerIds) ?? undefined;
  if (customerId) where.customerId = customerId;

  // İki mod:
  //  • SEÇİM (A): ?ids=a,b,c → yalnız işaretli sevkler (tarih aralığı yok sayılır).
  //  • DÖNEM: ids yok → HER ZAMAN sınırlı tarih penceresi. Aralık verilmezse son
  //    DEFAULT_DAYS gün uygulanır ("filtresiz tüm-zaman" çekimi İMKANSIZ); verilirse
  //    MAX_RANGE'i aşamaz. dateField geçersizse dispatchedAt'e düşer.
  //
  // SAAT DİLİMİ SÖZLEŞMESİ (2026-08-01, kolonlar timestamptz): `dateFrom`/`dateTo`
  // MUTLAK AN'lardır — takvim günü DEĞİL. Muhasebe dönemini kapatan gün sınırını
  // İSTEMCİ çizer (Electron tarih seçicisi, YEREL 00:00 / 23:59:59.999 anını ISO
  // olarak gönderir). Backend burada gün başına YUVARLAMA YAPMAZ: yaparsa aynı
  // niyet iki kez yorumlanır ve dönem uçlarındaki sevkler ya çift ya hiç sayılır.
  // Bu ayrım muhasebe için kritik — ay sonu 23:00'te yapılan bir sevkin hangi aya
  // yazıldığı istemcinin gönderdiği pencereyle belirlenir, sunucunun `TZ`'siyle değil.
  // Varsayılan pencere (son DEFAULT_DAYS gün) bilinçli olarak MUTLAK'tır.
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

  // Fasondan DOĞRUDAN sevkler (DirectShipment) de muhasebeye girer — çuval Shipment'larıyla
  // AYNI filtre penceresinde (müşteri + tarih/ids). Doğrudan sevkte çuval/plaka/sürücü/kg
  // YOK; tarih alanı dispatchedAt ≙ shippedAt, createdAt ≙ createdAt. Arama yalnız shipmentNo.
  const directWhere: Prisma.DirectShipmentWhereInput = {};
  if (customerId) directWhere.customerId = customerId;
  if (params.search) directWhere.shipmentNo = { contains: params.search, mode: "insensitive" };
  if (isSelection) {
    directWhere.id = { in: idList };
  } else {
    const directField = effField === "createdAt" ? "createdAt" : "shippedAt";
    (directWhere as Record<string, unknown>)[directField] = { gte: effFrom, lte: effTo };
  }

  // Perf guard — önce UCUZ indexli COUNT (iki tablo); aşımda hiç yüklemeden 400 (sunucu
  // RAM/CPU şişmez). Excel üretimi zaten istemci (renderer) tarafında — sunucu yalnız JSON.
  const [shipCount, directCount] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.directShipment.count({ where: directWhere }),
  ]);
  const count = shipCount + directCount;
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
      id: true,
      shipmentNo: true,
      dispatchedAt: true,
      createdAt: true,
      destination: true,
      procedureCode: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      invoiceNo: true,
      invoicedAt: true,
      customer: { select: { code: true, name: true, taxNumber: true } },
      branch: { select: { code: true, name: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      sacks: {
        select: {
          weightKg: true,
          rolls: {
            select: {
              currentQty: true,
              width: true,
              item: { select: { id: true, name: true } },
              color: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  // ⚠️ BRÜT GERİ-EKLEME — çift düşmenin panzehiri.
  // Sevkiyat satırları canlı çuval içeriğinden toplanır; iade alınmış top ise
  // `sackId`'si boşaldığı için o toplamlardan DÜŞMÜŞ durumdadır. Aynı veri setinde
  // ayrıca bir "İade" sayfası + `returnMeters` toplamı olduğu için, muhasebeci
  // "sevk − iade" yaptığında aynı metraj İKİ KEZ düşüyordu. Çözüm: sevk satırlarını
  // sevk anındaki BRÜT değere geri getir, iadeyi yalnız kendi sayfasında göster →
  // "sevk − iade = net" aritmetiği artık DOĞRU.
  //
  // Neden snapshot'tan değil de RollReturn'den: `getDispatchReport` tek sevkiyat için
  // donmuş belgeyi okur (kesin), ama dönem export'u MAX_SHIPMENTS=2000 sevkiyatı
  // kapsayabilir ve her snapshot çeki satırlarıyla birlikte yüz KB'a ulaşır (perf
  // kuralı 13: snapshot JSON'unu toplu sorguda çekme). `RollReturn` satırı iade anını
  // DONDURULMUŞ olarak taşır (`qty`/`itemId`/`colorId`/`width` sonradan değişmez) ve
  // `roll_returns_fromShipmentId_idx` + `roll_returns_itemId_colorId_width_idx` ile
  // ucuzdur — canlı + iade = sevk anı.
  const returnBackfill = await prisma.rollReturn.findMany({
    where: { cancelledAt: null, fromShipmentId: { in: shipments.map((s) => s.id) } },
    select: {
      fromShipmentId: true,
      qty: true,
      width: true,
      item: { select: { id: true, name: true } },
      color: { select: { id: true, name: true } },
    },
  });
  const backfillByShipment = new Map<string, typeof returnBackfill>();
  for (const rb of returnBackfill) {
    if (!rb.fromShipmentId) continue;
    const list = backfillByShipment.get(rb.fromShipmentId);
    if (list) list.push(rb);
    else backfillByShipment.set(rb.fromShipmentId, [rb]);
  }

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

    // F251: İD bazlı anahtar — Item.name/Color.name DB'de unique DEĞİL; aynı ada sahip
    // iki farklı ürün/renk icmalde birleşmesin (metre yanlış atfedilmesin). Adlar yalnız
    // görüntüleme için taşınır.
    const addProduct = (
      spec: { itemId: string; itemName: string; colorId: string | null; colorName: string; width: number | null },
      meters: Prisma.Decimal | number,
    ) => {
      const key = `${spec.itemId}|${spec.colorId ?? ""}|${spec.width ?? ""}`;
      const seed = () => ({
        itemName: spec.itemName,
        colorName: spec.colorName,
        width: spec.width,
        rollCount: 0,
        totalMeters: D0(),
      });
      for (const map of [prodMap, byProduct]) {
        const g = map.get(key) ?? seed();
        g.rollCount += 1;
        g.totalMeters = g.totalMeters.plus(meters);
        map.set(key, g);
      }
    };

    for (const sk of sh.sacks) {
      if (sk.weightKg != null) sKg = sKg.plus(sk.weightKg);
      for (const r of sk.rolls) {
        rollCount += 1;
        sMeters = sMeters.plus(r.currentQty);
        addProduct(
          {
            itemId: r.item.id,
            itemName: r.item.name,
            colorId: r.color?.id ?? null,
            colorName: r.color?.name ?? "",
            width: r.width != null ? Number(r.width) : null,
          },
          r.currentQty,
        );
      }
    }

    // Sevk anına geri getir (yukarıdaki BRÜT GERİ-EKLEME notu). Çuval kg'ı iade ile
    // DEĞİŞMEZ (`RollReturn` sack.weightKg'a dokunmaz, `resetSackWeightsTx` çağrılmaz)
    // → yalnız metraj/top adedi geri eklenir. Çuval adedi de değişmez: içeriği tamamen
    // iade edilmiş çuval sevkiyatta kalır.
    for (const rb of backfillByShipment.get(sh.id) ?? []) {
      rollCount += 1;
      sMeters = sMeters.plus(rb.qty);
      addProduct(
        {
          itemId: rb.item.id,
          itemName: rb.item.name,
          colorId: rb.color?.id ?? null,
          colorName: rb.color?.name ?? "",
          width: rb.width != null ? Number(rb.width) : null,
        },
        rb.qty,
      );
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
      branchCode: sh.branch?.code ?? "",
      destination: sh.destination,
      procedureCode: sh.procedureCode ?? "",
      plateNumber: sh.plateNumber ?? "",
      driverName: sh.driverName ?? "",
      carrier: sh.carrier ?? "",
      sackCount,
      rollCount,
      totalMeters: Number(sMeters),
      totalKg: Number(sKg),
      invoiceNo: sh.invoiceNo ?? "",
      invoicedAt: sh.invoicedAt,
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

  // ---- Fasondan doğrudan sevkler — çuval sevkleriyle AYNI satır/detay/icmal/totals
  // yapılarını besler (byCustomer/byProduct map'leri ortak → aynı müşteri/ürün birleşir).
  const directShipments = await prisma.directShipment.findMany({
    where: directWhere,
    orderBy: [{ shippedAt: "desc" }, { createdAt: "desc" }],
    select: {
      shipmentNo: true,
      shippedAt: true,
      createdAt: true,
      invoiceNo: true,
      invoicedAt: true,
      customer: { select: { code: true, name: true, taxNumber: true } },
      branch: { select: { code: true, name: true } },
      allocations: { select: { orderLine: { select: { order: { select: { orderNumber: true } } } } } },
      rolls: {
        select: {
          currentQty: true,
          width: true,
          item: { select: { id: true, name: true } },
          color: { select: { id: true, name: true } },
        },
      },
    },
  });

  for (const ds of directShipments) {
    let sMeters = D0();
    let rollCount = 0;
    const prodMap = new Map<string, ProductAgg>();

    for (const r of ds.rolls) {
      rollCount += 1;
      sMeters = sMeters.plus(r.currentQty);
      const itemName = r.item.name;
      const colorName = r.color?.name ?? "";
      const widthNum = r.width != null ? Number(r.width) : null;
      // F251 ile aynı: İD bazlı anahtar (aynı adlı farklı ürün/renk birleşmesin).
      const key = `${r.item.id}|${r.color?.id ?? ""}|${widthNum ?? ""}`;

      const g = prodMap.get(key) ?? { itemName, colorName, width: widthNum, rollCount: 0, totalMeters: D0() };
      g.rollCount += 1;
      g.totalMeters = g.totalMeters.plus(r.currentQty);
      prodMap.set(key, g);

      const pg = byProduct.get(key) ?? { itemName, colorName, width: widthNum, rollCount: 0, totalMeters: D0() };
      pg.rollCount += 1;
      pg.totalMeters = pg.totalMeters.plus(r.currentQty);
      byProduct.set(key, pg);
    }

    const dispatchedAt = ds.shippedAt ?? ds.createdAt;
    const orderNos = [...new Set(ds.allocations.map((a) => a.orderLine.order.orderNumber))].join(", ");
    const taxNumber = ds.customer.taxNumber ?? "";

    // Doğrudan sevkte çuval/araç/kg yok → sıfır/boş; yön varsayılan yurtiçi.
    shipmentRows.push({
      shipmentNo: ds.shipmentNo,
      dispatchedAt,
      customerCode: ds.customer.code,
      customerName: ds.customer.name,
      taxNumber,
      branchName: ds.branch?.name ?? "",
      branchCode: ds.branch?.code ?? "",
      destination: "DOMESTIC",
      procedureCode: "",
      plateNumber: "",
      driverName: "",
      carrier: "",
      sackCount: 0,
      rollCount,
      totalMeters: Number(sMeters),
      totalKg: 0,
      invoiceNo: ds.invoiceNo ?? "",
      invoicedAt: ds.invoicedAt,
    });

    for (const g of prodMap.values()) {
      detailRows.push({
        shipmentNo: ds.shipmentNo,
        dispatchedAt,
        customerName: ds.customer.name,
        orderNos,
        itemName: g.itemName,
        colorName: g.colorName,
        width: g.width,
        rollCount: g.rollCount,
        meters: Number(g.totalMeters),
      });
    }

    const ckey = ds.customer.code || ds.customer.name;
    const c =
      byCustomer.get(ckey) ??
      ({
        customerCode: ds.customer.code,
        customerName: ds.customer.name,
        taxNumber,
        shipmentCount: 0,
        sackCount: 0,
        rollCount: 0,
        totalMeters: D0(),
        totalKg: D0(),
      } satisfies CustomerAgg);
    c.shipmentCount += 1;
    c.rollCount += rollCount;
    c.totalMeters = c.totalMeters.plus(sMeters);
    byCustomer.set(ckey, c);

    gRoll += rollCount;
    gMeters = gMeters.plus(sMeters);
  }

  // Çuval sevkleri + doğrudan sevkler tek listede — sevk tarihine göre azalan sırala.
  shipmentRows.sort((a, b) => b.dispatchedAt.getTime() - a.dispatchedAt.getTime());
  detailRows.sort((a, b) => b.dispatchedAt.getTime() - a.dispatchedAt.getTime());

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
