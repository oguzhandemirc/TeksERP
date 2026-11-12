// =============================================================================
// Shipping Service / list
// =============================================================================
// Sevkiyat listesi (listShipments — cursor + özet şeridi tek where'den).
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  InvoiceStatus,
  ShipmentStatus,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  eIrsaliyeListFields,
  EIRSALIYE_LIST_SELECT,
  resolveEIrsaliyeListFilter,
} from "../e-irsaliye/e-irsaliye-shipment.helper";
import {
  D0,
} from "../helpers/allocation.helper";
import { LIVE_RETURN_WHERE, grossRollCount, loadShipmentGrossTotals } from "../helpers/shipment-gross-totals.helper";
import { buildHideCancelledWhere } from "../helpers/hidden-status.helper";
import { ApiResponse } from "../../types/api.types";
import { directShipmentsMatchDestinationFilter } from "../helpers/direct-shipment-destination.helper";
import type { CursorPaginatedResponse } from "../base.service";
import type { Request } from "express";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import {
  parseQueryParams,
  isCursorRequested,
  buildWhereClause,
  applyDateRange,
  buildTextSearch,
  resolveSortBy,
  readFilterList,
} from "../../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import type { ShippingServiceThis } from "./shared";

// Sevkiyat liste filtreleri (Electron FilterBar + arama).
// `orders.some.order.orderNumber`: muhasebeci müşteriden gelen soruyu SİPARİŞ NO ile
// arar (sevk no'yu bilmez). ShipmentOrder to-many pivot → `.some.` zorunlu;
// buildTextSearch nokta-notasyonunu ve some'ı destekler (query-parser.ts:159).
// Metin (katlanır) ↔ kod (katlanmaz) ayrımı: plaka/şoför/nakliyeci SERBEST
// METİNDİR (operatör "34 abc 123" ya da "Mehmet Şahin" yazar), sevk no ve
// sipariş no ise üretilmiş ASCII koddur.
const SHIPMENT_SEARCH_FIELDS = ["plateNumber", "driverName", "carrier", "customer.name"];
const SHIPMENT_CODE_SEARCH_FIELDS = ["shipmentNo", "orders.some.order.orderNumber"];
// destination = Shipment skaler alanı (DOMESTIC|EXPORT) → buildWhereClause halleder.
// itemId/colorId/hasReturns/invoiced BİLİNÇLİ dışarıda: relation alt-sorgusu (some) ya da
// türetilmiş null-testi olarak elle kurulur.
const SHIPMENT_FILTER_FIELDS = ["status", "customerId", "branchId", "destination"] as const;
const SHIPMENT_DATE_FIELDS = ["createdAt", "dispatchedAt"] as const;

/** Muhasebe dönem bandı — filtreli kümenin tamamı (`?withSummary=true` ile istenir). */
export interface ShipmentListSummary {
  shipmentCount: number;
  totalMeters: number;
  totalKg: number;
}

export async function listShipments(this: ShippingServiceThis, 
    req: Request,
  ): Promise<
    | (ApiResponse<unknown> & { summary?: ShipmentListSummary })
    | (CursorPaginatedResponse<unknown> & { summary?: ShipmentListSummary })
  > {
    const params = parseQueryParams(req);
    const safeFilters: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(params.filters)) {
      if ((SHIPMENT_FILTER_FIELDS as readonly string[]).includes(k)) safeFilters[k] = v;
    }
    const where = buildWhereClause(
      safeFilters,
      SHIPMENT_SEARCH_FIELDS,
      params.search,
      SHIPMENT_CODE_SEARCH_FIELDS
    ) as Prisma.ShipmentWhereInput;
    applyDateRange(where as Record<string, unknown>, params, SHIPMENT_DATE_FIELDS);

    const rawStatus = req.query.status as string | undefined;
    if (rawStatus && Object.values(ShipmentStatus).includes(rawStatus as ShipmentStatus)) {
      where.status = rawStatus as ShipmentStatus;
    }

    // İptal edilmiş sevkiyatları gizle (panel varsayılanı). SHIPMENT_FILTER_FIELDS
    // allowlist'i bayrağı zaten `safeFilters`'a almaz — ham params.filters'tan
    // okunur. `rawStatus` (üstteki tekil ?status=) de açık niyet sayılır: varsa
    // dışlama uygulanmaz, yoksa çelişip listeyi boşaltırdı.
    if (!rawStatus) {
      const hideCancelled = buildHideCancelledWhere(params.filters, [
        ShipmentStatus.CANCELLED,
      ]);
      if (hideCancelled) where.status = hideCancelled.status as Prisma.EnumShipmentStatusFilter;
    }
    const rawCustomerId = req.query.customerId as string | undefined;
    if (rawCustomerId) where.customerId = rawCustomerId;

    // --- İÇERİK FİLTRESİ (ürün + renk = TEK TOP eşleşmesi) --------------------
    // itemId/colorId relation alt-sorgusudur (skaler DEĞİL) → SHIPMENT_FILTER_FIELDS'e
    // KOYULMAZ (buildWhereClause skaler bekler). csv → temiz ID listesi. İkisi de
    // seçiliyse AYNI topun HEM üründe HEM renkte olması gerekir (tek `some` bloğu,
    // iki koşul AND — "mavi patos" = aynı topun itemId∈seçili VE colorId∈seçili).
    const csvIds = (v: string | string[] | undefined): string[] => {
      if (v == null) return [];
      const arr = Array.isArray(v) ? v : String(v).split(",");
      return arr.map((s) => s.trim()).filter(Boolean);
    };
    const itemIds = csvIds(params.filters.itemId);
    const colorIds = csvIds(params.filters.colorId);
    const rollMatch: Prisma.RollWhereInput = {};
    if (itemIds.length) rollMatch.itemId = { in: itemIds };
    if (colorIds.length) rollMatch.colorId = { in: colorIds };
    const hasContentFilter = itemIds.length > 0 || colorIds.length > 0;
    // Roll.itemId + Roll.colorId indexli → some alt-sorgusu performanslı.
    if (hasContentFilter) where.rolls = { some: rollMatch };

    // --- İADE FİLTRESİ ("iade içerenler") — basit; iptalsiz iade taşıyan sevkler.
    const hasReturnsFilter = params.filters.hasReturns === "true";
    if (hasReturnsFilter) where.returns = { some: { cancelledAt: null } };

    // --- FATURA FİLTRESİ (muhasebe) — türetilmiş null-testi, skaler eşitlik DEĞİL →
    // FILTER_FIELDS whitelist'ine konmaz (hasReturns ile aynı gerekçe).
    const invoicedRaw = params.filters.invoiced;
    const invoicedFilter =
      invoicedRaw === "true" ? true : invoicedRaw === "false" ? false : null;
    if (invoicedFilter !== null) {
      where.invoicedAt = invoicedFilter ? { not: null } : null;
    }

    // --- e-İRSALİYE SÜZGECİ — where parçası tek helper'da (liste + cursor + özet aynı where).
    // DirectShipment'ın e-İrsaliyesi yok → süzgeç aktifken union'dan düşer.
    const eIrsWhere = await resolveEIrsaliyeListFilter(readFilterList(params.filters.eIrsaliye));
    if (eIrsWhere) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), eIrsWhere];
    // --- BOŞ PLANLI GİZLE (`hasRolls=true`, el terminali listesi) — yalnız hiç topu olmayan PLANNED düşer;
    // sevk edilmiş sevkiyat iade sonrası canlı topsuz kalabilir, o görünür kalmalı (brüt).
    const hasRollsFilter = req.query.hasRolls === "true";
    if (hasRollsFilter) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [{ status: { not: ShipmentStatus.PLANNED } }, { rolls: { some: {} } }] }];
    }

    // destination (DOMESTIC|EXPORT) buildWhereClause tarafından where'e YAZILDI;
    // DirectShipment'ta destination YOK → aktifse doğrudan sevkler union'dan düşer
    // (muhasebe Excel'iyle AYNI yüklem: `directShipmentsMatchDestinationFilter`).
    const hasDestinationFilter = !directShipmentsMatchDestinationFilter(safeFilters.destination);

    // --- SIRALAMA (whitelist) — createdAt|shipmentNo|dispatchedAt.
    // dispatchedAt PLANNED'da NULL'dur; keyset'i bozmadan sıralamak için nulls-last
    // + `dynamicCursorWhere(..., sortNullable=true)` (cursor.ts:214 null kuyruk fazı)
    // kullanılır. Muhasebe ekranı bunu ister: liste "Sevk Tarihi" basıp createdAt'e
    // göre dizilince pazartesi kurulup cuma sevk edilen sevkiyat yanlış yere düşüyordu.
    // ⚠️ DirectShipment'ta bu alanın adı `shippedAt` (NON-NULL) — direct dalındaki
    // orderBy/cursor AYRI kurulur, Shipment'ınki paylaşılamaz.
    // customerName (el terminali, K4b): DB harmanlamasıyla sıralanır → JS birleşimi yeniden dizemez, bu yüzden
    // bu sıralamada doğrudan sevkler birleşime girmez (kendi cari adı sırasını JS'te kurmak sayfa sınırını bozardı).
    const SORTABLE = ["createdAt", "shipmentNo", "dispatchedAt", "customerName"] as const;
    type ShipSortField = (typeof SORTABLE)[number];
    const sortField = resolveSortBy(params.sortBy, SORTABLE, "createdAt") as ShipSortField;
    const sortDir: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
    // Direct tablosundaki karşılık — union'ın iki tarafında alan adı farklı.
    const byCustomer = sortField === "customerName";
    const directSortField = sortField === "dispatchedAt" ? "shippedAt" : byCustomer ? "createdAt" : sortField;
    const sortNullable = sortField === "dispatchedAt";
    const shipOrderBy: Prisma.ShipmentOrderByWithRelationInput[] =
      byCustomer
        ? [{ customer: { name: sortDir } }, { id: sortDir }]
        : sortField === "shipmentNo"
          ? [{ shipmentNo: sortDir }, { id: sortDir }]
          : sortField === "dispatchedAt"
            ? [{ dispatchedAt: { sort: sortDir, nulls: "last" } }, { id: sortDir }]
            : [{ createdAt: sortDir }, { id: sortDir }];
    const directOrderBy: Prisma.DirectShipmentOrderByWithRelationInput[] =
      sortField === "shipmentNo"
        ? [{ shipmentNo: sortDir }, { id: sortDir }]
        : sortField === "dispatchedAt"
          ? [{ shippedAt: sortDir }, { id: sortDir }]
          : [{ createdAt: sortDir }, { id: sortDir }];

    const select = {
      id: true,
      shipmentNo: true,
      status: true,
      plateNumber: true,
      driverName: true,
      carrier: true,
      dispatchedAt: true,
      createdAt: true,
      invoiceNo: true,
      invoicedAt: true,
      // Muhasebe ekranı ikisini de basıyor: sevk notu (eskiden yalnız irsaliyede
      // vardı) ve operatörün beyan ettiği gerçek çuval adedi.
      dispatchNote: true,
      manualSackCount: true,
      // ── İÇ FATURA BAĞI (2026-08-15) ────────────────────────────────────────
      // ⚠️ `invoiceNo` DIŞ muhasebe programındaki belgenin izidir ("ERP fatura
      // KESMEZ", `schema.prisma`), iç fatura bağı ise `Invoice.shipmentId`dir.
      // Panelin "Faturala (iç)" düğmesi yükleminin `invoiceNo`ya bakması İKİ
      // YÖNLÜ yanlıştı: (a) iç TASLAK varken düğme çıkıyor, kullanıcı formu
      // dolduruyor ve `assertSourceFree` 409 veriyordu (emek çöpe); (b) dış
      // numarası işaretlenmiş sevkiyatta düğme HİÇ çıkmıyor, iç fatura
      // kesilemiyordu. Yüklem artık bu alana bağlanabilir.
      // ⚠️ İPTAL EDİLMİŞ FATURA DIŞARIDA: `assertSourceFree` ile AYNI süzgeç
      // (`status <> CANCELLED`) — ayrışsalardı panel "faturası var" der, uç
      // yeni faturayı kabul ederdi (ya da tersi).
      // ⚠️ Perf: to-many `select` Prisma'da sayfadaki id'ler üzerinde TEK ek
      // sorgudur (`_count` ile aynı sınıf); snapshot/JSON kolonu ÇEKİLMEZ
      // (perf kuralı 13).
      invoices: {
        where: { status: { not: InvoiceStatus.CANCELLED } },
        select: { id: true, docNo: true, status: true },
      },
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      _count: { select: { sacks: { where: LIVE_LOAD_UNIT_WHERE }, rolls: true, orders: true, returns: { where: LIVE_RETURN_WHERE } } },
      eIrsaliyeler: EIRSALIYE_LIST_SELECT,
    } as const;

    // --- BİRLEŞİK LİSTE: fasondan DOĞRUDAN sevkler (DirectShipment) çuval
    // Shipment'larıyla AYNI listede görünür (nadir ama kayıt altında olmalı).
    // Aynı createdAt-keyed keyset cursor İKİ tabloya da uygulanır; iki desc-sıralı
    // akış merge edilip üstten `limit` alınır → union üzerinde doğru keyset sayfalama
    // (her akıştan limit+1 çekmek top-`limit`'i ve hasMore'u garantiler).
    const directSelect = {
      id: true,
      shipmentNo: true,
      shippedAt: true,
      createdAt: true,
      rollCount: true,
      totalQty: true,
      reason: true,
      invoiceNo: true,
      invoicedAt: true,
      // Doğrudan sevkin de iç faturası olabilir (`Invoice.directShipmentId` +
      // kendi partial unique'i) — iki dal AYNI şekli döndürmeli, yoksa panel
      // satırın hangi tür olduğuna göre farklı alan ezberlemek zorunda kalır.
      invoices: {
        where: { status: { not: InvoiceStatus.CANCELLED } },
        select: { id: true, docNo: true, status: true },
      },
      customer: { select: { id: true, code: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      // `clearedAt` SÜZÜLMEZ: bu `allocations` DirectShipAllocation (doğrudan sevk), SackAllocation değil
      _count: { select: { allocations: true } },
    } as const;
    type ShipRow = Prisma.ShipmentGetPayload<{ select: typeof select }>;
    type DirectRow = Prisma.DirectShipmentGetPayload<{ select: typeof directSelect }>;
    // totalMeters/totalKg: SHIPMENT satırlarında `attachTotals` doldurur (toplama
    // gerektirir); DIRECT'te metraj zaten denormalize (`DirectShipment.totalQty`) → sorgu yok.
    const mapShip = ({ eIrsaliyeler, ...s }: ShipRow) => ({
      kind: "SHIPMENT" as const,
      ...s,
      ...eIrsaliyeListFields(eIrsaliyeler),
      totalMeters: 0,
      totalKg: 0,
    });
    const mapDirect = (d: DirectRow) => ({
      kind: "DIRECT" as const,
      id: d.id,
      shipmentNo: d.shipmentNo,
      status: ShipmentStatus.DISPATCHED, // doğrudan sevk daima çıkmış say
      plateNumber: null,
      driverName: null,
      carrier: null,
      dispatchedAt: d.shippedAt,
      createdAt: d.createdAt,
      reason: d.reason,
      invoiceNo: d.invoiceNo,
      invoicedAt: d.invoicedAt,
      invoices: d.invoices,
      customer: d.customer,
      branch: d.branch,
      // Doğrudan sevkte ÇUVAL YOK (roll bazlı akış) → ikisi de null. Union'ın
      // iki tarafı aynı alan kümesini taşımalı, yoksa liste satırı tipi ayrışır.
      dispatchNote: null,
      manualSackCount: null,
      totalMeters: Number(d.totalQty),
      totalKg: 0, // doğrudan sevkte çuval/tartı yok
      _count: { sacks: 0, rolls: d.rollCount, orders: d._count.allocations, returns: 0 },
      ...eIrsaliyeListFields([]),
    });
    type UnifiedRow = ReturnType<typeof mapShip> | ReturnType<typeof mapDirect>;
    // Union sıralama karşılaştırıcısı — sortField + sortDir'e göre (orderBy ile birebir).
    // Birincil anahtar sortField (createdAt→getTime, shipmentNo→string compare); tie-break
    // DAİMA id, aynı yönde (dynamicCursorWhere tie-break'iyle simetrik).
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: UnifiedRow, b: UnifiedRow): number => {
      // Cari adı: yalnız Shipment satırı var ve DB sırası otoritedir (sort kararlı → sıra korunur).
      if (byCustomer) return 0;
      // NULL kuyruğu: dispatchedAt sıralamasında null'lar YÖNDEN BAĞIMSIZ olarak sonda
      // durur (Prisma `nulls: "last"` ile birebir) → `dir` ile çarpılmaz.
      if (sortField === "dispatchedAt") {
        const av = a.dispatchedAt;
        const bv = b.dispatchedAt;
        if (av === null && bv !== null) return 1;
        if (bv === null && av !== null) return -1;
        if (av !== null && bv !== null) {
          const d = av.getTime() - bv.getTime();
          if (d !== 0) return dir * d;
        }
        const idcN = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        return dir * idcN;
      }
      const primary =
        sortField === "shipmentNo"
          ? a.shipmentNo < b.shipmentNo
            ? -1
            : a.shipmentNo > b.shipmentNo
              ? 1
              : 0
          : a.createdAt.getTime() - b.createdAt.getTime();
      if (primary !== 0) return dir * primary;
      const idc = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return dir * idc;
    };

    // DirectShipment'ın status'u yok → daima DISPATCHED. Status filtresi DISPATCHED
    // istemiyorsa doğrudan sevkleri union'dan DÜŞ.
    const statusRaw = safeFilters.status;
    const statuses =
      statusRaw == null
        ? null
        : Array.isArray(statusRaw)
          ? statusRaw
          : String(statusRaw).split(",").map((s) => s.trim());
    // DirectShipment'ta status/destination/returns YOK → bu filtreler aktifse doğrudan
    // sevkler union'dan düşer. (İçerik filtresi DÜŞÜRMEZ — DirectShipment.rolls'a uygulanır.)
    const includeDirect =
      (!statuses || statuses.includes(ShipmentStatus.DISPATCHED)) &&
      (!rawStatus || rawStatus === ShipmentStatus.DISPATCHED) &&
      !hasReturnsFilter &&
      !hasDestinationFilter &&
      !eIrsWhere &&
      !byCustomer;

    // DirectShipment where — Shipment ile AYNI filtreleri alanlarına eşle.
    const directBaseWhere: Prisma.DirectShipmentWhereInput = {};
    {
      const cust =
        (typeof safeFilters.customerId === "string" ? safeFilters.customerId : undefined) ??
        rawCustomerId;
      if (cust) directBaseWhere.customerId = cust;
      if (typeof safeFilters.branchId === "string") directBaseWhere.branchId = safeFilters.branchId;
      if (params.search)
        directBaseWhere.OR = buildTextSearch<Prisma.DirectShipmentWhereInput>(
          params.search,
          {
            text: ["reason", "customer.name"],
            // Sipariş no ile arama — Shipment tarafındaki `orders.some.order.orderNumber`
            // karşılığı; doğrudan sevkte sipariş bağı allocation üzerinden kurulur.
            code: ["shipmentNo", "allocations.some.orderLine.order.orderNumber"],
          }
        );
      if (invoicedFilter !== null) {
        directBaseWhere.invoicedAt = invoicedFilter ? { not: null } : null;
      }
      if (params.dateField && (params.dateFrom || params.dateTo)) {
        const range: { gte?: Date; lte?: Date } = {};
        if (params.dateFrom) range.gte = params.dateFrom;
        if (params.dateTo) range.lte = params.dateTo;
        // Shipment.dispatchedAt ≙ DirectShipment.shippedAt.
        if (params.dateField === "createdAt") directBaseWhere.createdAt = range;
        else if (params.dateField === "dispatchedAt") directBaseWhere.shippedAt = range;
      }
      // İçerik filtresi doğrudan sevklere de (DirectShipment.rolls Roll[] — aynı rollMatch).
      if (hasContentFilter) directBaseWhere.rolls = { some: rollMatch };
    }

    // --- EŞLEŞME ROZETİ verisi — SADECE hasContentFilter iken. dataRows'a bağımlı →
    // merge/slice SONRASI ayrı Promise.all (mevcut Promise.all'a EKLENMEZ). tx dışı,
    // salt-okuma (prisma.* global) → Promise.all serbest. hasContentFilter yoksa alan
    // HİÇ eklenmez (matchRollCount undefined kalır).
    const attachBadges = async (
      rows: UnifiedRow[],
    ): Promise<Array<UnifiedRow & { matchRollCount?: number }>> => {
      if (!hasContentFilter) return rows;
      const shipIds = rows.filter((r) => r.kind === "SHIPMENT").map((r) => r.id);
      const directIds = rows.filter((r) => r.kind === "DIRECT").map((r) => r.id);
      const [shipGroups, directGroups] = await Promise.all([
        shipIds.length
          ? prisma.roll.groupBy({
              by: ["shipmentId"],
              where: { shipmentId: { in: shipIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve([] as Array<{ shipmentId: string | null; _count: { _all: number } }>),
        directIds.length
          ? prisma.roll.groupBy({
              by: ["directShipmentId"],
              where: { directShipmentId: { in: directIds }, ...rollMatch },
              _count: { _all: true },
            })
          : Promise.resolve(
              [] as Array<{ directShipmentId: string | null; _count: { _all: number } }>,
            ),
      ]);
      const shipMap = new Map<string | null, number>(
        shipGroups.map((g): [string | null, number] => [g.shipmentId, g._count._all]),
      );
      const directMap = new Map<string | null, number>(
        directGroups.map((g): [string | null, number] => [g.directShipmentId, g._count._all]),
      );
      return rows.map((r) => ({
        ...r,
        matchRollCount: r.kind === "SHIPMENT" ? (shipMap.get(r.id) ?? 0) : (directMap.get(r.id) ?? 0),
      }));
    };

    // --- BRÜT TOPLAMLAR (metraj / kg / top adedi) -----------------------------
    // ⚠️ SEVK RAKAMI BRÜT'TÜR (kök CLAUDE.md 2026-08-02, saha vakası SVK2007260001).
    // İade `Roll.shipmentId`'yi NULL'lar (`return.service.ts:324-325`) → CANLI sayım
    // NET verir ve liste, donmuş irsaliyeden FARKLI bir sayı söyler. Bu yüzden iptal
    // edilmemiş iadeler metraja ve top adedine GERİ EKLENİR; dört yüzey (PDF, liste,
    // fiş, muhasebe Excel'i) aynı rakamı basar. İade bilgisi kaybolmaz — `_count.returns`
    // ayrı alan olarak duruyor ve listede rozet olarak gösteriliyor.
    //
    // Donmuş `PrintedDocument.snapshot` OKUNMAZ: perf kuralı 13 (liste sorgusunda
    // snapshot JSON çekilmez) — `accounting-export.service.ts:255` de aynı sebeple
    // geri-ekleme yolunu seçti. Kg geri-ekleme İSTEMEZ: iade `Sack.weightKg`'a
    // dokunmaz (tartı sevk anında donmuş brüt değerdir).
    //
    // `attachBadges` ile aynı yerleşim: merge/slice SONRASI, yalnız sayfadaki ≤limit
    // id üzerinde; tx dışı salt-okuma (`prisma.*` global) → `Promise.all` serbest.
    // DIRECT satırlar sorguya girmez — `DirectShipment.totalQty`/`rollCount` denormalize.
    const attachTotals = async <T extends UnifiedRow>(rows: T[]): Promise<T[]> => {
      const shipIds = rows.filter((r) => r.kind === "SHIPMENT").map((r) => r.id);
      if (shipIds.length === 0) return rows;
      // TEK ANLIK GÖRÜNTÜ + brüt formül tek kaynakta (patron bulutu projeksiyonu da okur).
      // Araba/dökme sayısı: "İçerik" sütunu birim farkında olsun (`_count.sacks` tüm canlı birimler).
      const [totals, looseUnits] = await Promise.all([
        loadShipmentGrossTotals(shipIds),
        prisma.sack.groupBy({ by: ["shipmentId", "unitKind"], where: { shipmentId: { in: shipIds }, unitKind: { not: LoadUnitKind.SACK }, ...LIVE_LOAD_UNIT_WHERE }, _count: { _all: true } }),
      ]);
      const looseOf = (id: string, kind: LoadUnitKind) => looseUnits.find((u) => u.shipmentId === id && u.unitKind === kind)?._count._all ?? 0;
      return rows.map((r) => {
        if (r.kind !== "SHIPMENT") return r;
        const t = totals.get(r.id);
        return {
          ...r,
          totalMeters: Number(t?.grossMeters ?? D0()),
          totalKg: Number(t?.kg ?? D0()),
          // İade sayısı `_count.returns` ile geldi (aynı `LIVE_RETURN_WHERE`) → ayrı sorgu gerekmez.
          _count: { ...r._count, rolls: grossRollCount(r._count.rolls, r._count.returns), carts: looseOf(r.id, LoadUnitKind.CART), bulks: looseOf(r.id, LoadUnitKind.BULK) },
        };
      });
    };

    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";
      // Muhasebe ekranının dönem bandı — filtreli KÜMENİN TAMAMI (sayfa değil).
      // Bayrak olmadan ek sorgu koşmaz → operasyon ekranı bedel ödemez.
      const wantSummary = req.query.withSummary === "true";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cw = cursor ? (byCustomer ? (customerNameCursorWhere(cursor, sortDir) as Record<string, unknown>) : dynamicCursorWhere(cursor, sortField, sortDir, sortNullable)) : null;
      // Direct tarafı AYRI cursor ister: union'ın iki tablosunda sıralama kolonunun adı
      // farklı (dispatchedAt ↔ shippedAt). Aynı `cw` nesnesini paylaşmak DirectShipment'ta
      // var olmayan bir alana filtre yazmak olurdu.
      const directCw = cursor
        ? directSortField === sortField
          ? cw
          : dynamicCursorWhere(cursor, directSortField, sortDir) // shippedAt NON-NULL → sortNullable YOK
        : null;
      const shipWhere = cw ? { AND: [where, cw] } : where;
      const directWhere = directCw ? { AND: [directBaseWhere, directCw] } : directBaseWhere;
      const [shipItems, directItems, shipTotal, directTotal] = await Promise.all([
        prisma.shipment.findMany({ where: shipWhere, orderBy: shipOrderBy, take: limit + 1, select }),
        includeDirect
          ? prisma.directShipment.findMany({ where: directWhere, orderBy: directOrderBy, take: limit + 1, select: directSelect })
          : Promise.resolve([] as DirectRow[]),
        wantTotal ? prisma.shipment.count({ where }) : Promise.resolve(undefined),
        wantTotal && includeDirect ? prisma.directShipment.count({ where: directBaseWhere }) : Promise.resolve(0),
      ]);
      const merged: UnifiedRow[] = [...shipItems.map(mapShip), ...directItems.map(mapDirect)].sort(cmp);
      const hasMore = merged.length > limit;
      const dataRows = hasMore ? merged.slice(0, limit) : merged;
      const last = dataRows[dataRows.length - 1] as Record<string, unknown> | undefined;
      const cursorRow = byCustomer && last ? { id: last.id, customerName: (last.customer as { name: string }).name } : last;
      const nextCursor = hasMore ? buildNextDynamicCursor(cursorRow, sortField) : null;
      const totalEstimate = shipTotal !== undefined ? shipTotal + (directTotal ?? 0) : undefined;
      const data = await attachTotals(await attachBadges(dataRows));
      const summary = wantSummary
        ? await this.buildShipmentListSummary(where, includeDirect ? directBaseWhere : null)
        : undefined;
      return {
        success: true,
        data,
        ...(summary ? { summary } : {}),
        pagination: { nextCursor, hasMore, limit, ...(totalEstimate !== undefined ? { totalEstimate } : {}) },
      };
    }

    const [shipments, directs] = await Promise.all([
      prisma.shipment.findMany({ where, orderBy: shipOrderBy, take: 200, select }),
      includeDirect
        ? prisma.directShipment.findMany({ where: directBaseWhere, orderBy: directOrderBy, take: 200, select: directSelect })
        : Promise.resolve([] as DirectRow[]),
    ]);
    const merged: UnifiedRow[] = [...shipments.map(mapShip), ...directs.map(mapDirect)].sort(cmp).slice(0, 200);
    const data = await attachTotals(await attachBadges(merged));
    return { success: true, data };
  }

/** `customerName` sıralamasının keyset koşulu — ilişki alanı `dynamicCursorWhere`in düz kolon kalıbına sığmaz. */
function customerNameCursorWhere(cursor: { v: string | null; id: string }, sortDir: "asc" | "desc"): Prisma.ShipmentWhereInput {
  const op = sortDir === "asc" ? "gt" : "lt";
  const name = cursor.v ?? "";
  return { OR: [{ customer: { name: { [op]: name } } }, { AND: [{ customer: { name } }, { id: { [op]: cursor.id } }] }] };
}

export async function buildShipmentListSummary(
    where: Prisma.ShipmentWhereInput,
    directWhere: Prisma.DirectShipmentWhereInput | null,
  ): Promise<ShipmentListSummary> {
    const [shipCount, rollAgg, sackAgg, returnAgg, directAgg] = await Promise.all([
      prisma.shipment.count({ where }),
      prisma.roll.aggregate({ where: { shipment: where }, _sum: { currentQty: true } }),
      prisma.sack.aggregate({ where: { shipment: where }, _sum: { weightKg: true } }),
      prisma.rollReturn.aggregate({
        where: { cancelledAt: null, fromShipment: where },
        _sum: { qty: true },
      }),
      directWhere
        ? prisma.directShipment.aggregate({ where: directWhere, _sum: { totalQty: true }, _count: { _all: true } })
        : Promise.resolve(null),
    ]);
    const meters = (rollAgg._sum.currentQty ?? D0())
      .plus(returnAgg._sum.qty ?? D0())
      .plus(directAgg?._sum.totalQty ?? D0());
    return {
      shipmentCount: shipCount + (directAgg?._count._all ?? 0),
      totalMeters: Number(meters),
      totalKg: Number(sackAgg._sum.weightKg ?? D0()),
    };
  }
