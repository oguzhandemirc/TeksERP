// =============================================================================
// TeksERP - WorkOrder (Parti) Service / list
// =============================================================================
// Liste: where kurulumu (buildListWhere), yer seçenekleri, findAll (cursor/özet), üretim metrajı zenginleştirme.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { workOrderDocSearchWhere, workOrderParameterSearch } from "../helpers/workorder-doc-search.helper";
import { ACTIVE_ORDER_LINK, withActiveOrderLinks } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { PaginatedResponse, QueryParams } from "../../types/api.types";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
  readIdCondition,
} from "../../utils/query-parser";
import { loadRollOwnersByWorkOrder, resolveWorkOrderCustomers, workOrderCustomerWhere, workOrderOwnerNameSearchWhere, withOwnCustomer } from "../helpers/work-order-customers.helper";
import { readWorkOrderTypeFilter } from "../helpers/workorder-customer-goods.helper";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import type { CursorPaginatedResponse } from "../base.service";
import { Request } from "express";
import {
  WorkOrderStatus,
  RollStatus,
  Prisma,
} from "@prisma/client";
import { resolveProducedOutputWhere } from "../helpers/produced-output.helper";
import { computeWoInput } from "../helpers/coverage.helper";
import { readWorkOrderLocationFilters, withWorkOrderLocation } from "../helpers/workorder-location.helper";
import {
  loadWorkOrderPlaceOptions,
  takeWorkOrderPlaceFilters,
  type WorkOrderPlaceOptions,
} from "../helpers/workorder-place-filter.helper";
import {
  buildHiddenStatusWhere,
  HIDE_CANCELLED_FILTER,
  HIDE_COMPLETED_FILTER,
} from "../helpers/hidden-status.helper";
import { loadProducedBuckets } from "../helpers/roll-finalize.helper";
import { OPEN_OUTSTANDING } from "../helpers/fason-open-dispatch.helper";
import { workOrderBoundOnly } from "../helpers/dispatch-header.helper";
import type { WorkOrderServiceThis } from "./shared";
import { meterCheckWhere, readMeterCheckFilter, workOrderMeterSummaries } from "../meter-comparison.service";

// WO listesinde sıralanabilir kolonlar (UI SortableHeader'larıyla eşleşir) + güvenli
// ekler. Whitelist dışı sortBy → createdAt (bilinmeyen kolon 500'ünü + indekssiz sortu engeller).
const WO_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "plannedEndDate",
  "plannedStartDate",
  "targetQuantity",
  "workOrderNumber",
  "status",
] as const;

const WORKORDER_DATE_FIELDS = [
  "createdAt",
  "plannedStartDate",
  "plannedEndDate",
] as const;

/**
 * Liste satırında gösterilecek parti no adedi; kalanı `batchCount` ile `+N`
 * olarak yazılır. 3: ölçülen gerçek veride bir iş emrinin partisi en fazla 2
 * (2026-08-03 ölçümü), yani üçüncüsü zaten nadir — kolonu şişirmeden "birden
 * fazla var" bilgisini taşır.
 */
const BATCH_PREVIEW_LIMIT = 3;
/** Liste select'i: bağdaki siparişin müşterisi yalnız id+ad (opt-in; sipariş no/adres/vergi no listeye girmez). */
const WO_LIST_ORDER_CUSTOMER = { customer: { select: { id: true, name: true } } } as const;
/**
 * Liste "Müşteri" kolonunun bağ seçimi — aktif bağlar bağlanma sırasıyla, müşteri AYNI
 * sorguda. Patron bulutu projeksiyonu (`cloud-sync` · iş emri `cariKartIdleri`) aynı seçimi
 * `withProductionMeters`e verir; liste ile bulut aynı müşteri önizlemesini basar.
 */
export const WO_LIST_CUSTOMER_LINKS = {
  where: ACTIVE_ORDER_LINK,
  orderBy: { createdAt: "asc" },
  select: { orderLineId: true, createdAt: true, orderLine: { select: { order: { select: WO_LIST_ORDER_CUSTOMER } } } },
} as const satisfies Prisma.WorkOrder$orderLinksArgs;

export async function buildListWhere(req: Request, params: QueryParams): Promise<Prisma.WorkOrderWhereInput> {
    // İptal gizleme bayrağı: buildWhereClause BU serviste allowlist'ten geçmeyen
    // her filtre anahtarını body'ye kopyalar (Order'daki safeFilters süzgeci burada
    // YOK) → bayrak `where.hideCancelled` olarak Prisma'ya sızar ve "Unknown
    // argument" 500'ü verirdi. Okuyup filtre kümesinden ÇIKARIYORUZ.
    // İki bağımsız gizleme bayrağı TEK `notIn`de birleşir (bkz. helper notu).
    // ⚠️ İkisi de filtre kümesinden ÇIKARILMALI: bu serviste `buildWhereClause`
    // tanımadığı her anahtarı Prisma'ya kopyalar → bayrak `where.hideCompleted`
    // olarak sızar ve "Unknown argument" 500'ü verir (hideCancelled'ın 2026'da
    // yaşadığı hatanın aynısı).
    const hideCancelledWhere = buildHiddenStatusWhere(params.filters, {
      cancelled: [WorkOrderStatus.CANCELLED],
      completed: [WorkOrderStatus.COMPLETED],
    });
    delete params.filters[HIDE_CANCELLED_FILTER];
    delete params.filters[HIDE_COMPLETED_FILTER];
    // Müşteri süzgeci (liste kolonu, 2026-09-15): WO'da customerId YOK — bağ üzerinden
    // (`orderLinks.some.orderLine.order.customerId`), bağsız İE'de top sahibi (2026-11-06,
    // `workOrderCustomerWhere` — satırdaki müşteriyle aynı kural). Filtre kümesinden ÇIKARILIR: bu
    // serviste allowlist yok, `filter[customerId]` where'e sızıp 500 verirdi. CSV `in`.
    const customerCond = readIdCondition(params.filters.customerId);
    delete params.filters.customerId;
    // Tür süzgeci (2026-11-06): CSV, tanınmayan değer 400 (fail-closed; eskiden ham Prisma'ya sızıp 500 veriyordu).
    const typeCond = readWorkOrderTypeFilter(params.filters.type);
    delete params.filters.type;
    // "Beyandan uzun" (2026-11-10, GK): hesaplanmış değer — taban where kurulduktan sonra `id IN` olarak eklenir.
    const meterCheck = readMeterCheckFilter(params.filters.meterCheck);
    delete params.filters.meterCheck;
    // "Şu an nerede" süzgeçleri (2026-10-24): istasyon + konum sınıfı; filtre kümesinden
    // helper çıkarır, tanınmayan değer 400. Liste + cursor + sayım AYNI where'i görür.
    const locationConds = await readWorkOrderLocationFilters(params.filters);
    // "Şu an hangi fasonda" (2026-11-04): topun ŞU ANKİ yeri, plan değil.
    locationConds.push(...(await takeWorkOrderPlaceFilters(params.filters)));
    // Arama kapsamı liste kolonlarıyla hizalı: İE no + parti no + kumaş/renk +
    // sipariş bağı üzerinden müşteri adı VE sipariş no (nested some → EXISTS
    // subquery). Sipariş no ile de aranabilmesi siparişten üretim emrine
    // erişimi tamamlar (sipariş listesindeki rollup rozetinin tersi yönü).
    // `withActiveOrderLinks`: aramanın `orderLinks.some` yolu koparılmış bağdan eşleşmesin
    // (AST kapısı string yolu göremez; yürüyücü tek kaynak).
    const where = withActiveOrderLinks(buildWhereClause(
      params.filters,
      ["targetItem.name", "targetColor.name", "orderLinks.some.orderLine.order.customer.name"],
      params.search,
      [
        "workOrderNumber",
        "batches.some.batchNumber",
        "orderLinks.some.orderLine.order.orderNumber",
      ]
    ));
    // K17: arama gelen belgenin fiş/evrak no'sunu, GB no'sunu ve parti no'larını da tarar (istasyonla tek yüklem).
    const docSearch = params.search ? workOrderDocSearchWhere(params.search) : null;
    if (docSearch) {
      const w = where as { OR?: Prisma.WorkOrderWhereInput[] };
      w.OR = [...(w.OR ?? []), docSearch];
    }
    // Künyedeki kağıt kimlikleri (gönderen İE no · çok partide parti no) — istasyon aramasıyla aynı yapraklar.
    const paramSearch = params.search ? workOrderParameterSearch(params.search) : [];
    if (paramSearch.length) {
      const w = where as { OR?: Prisma.WorkOrderWhereInput[] };
      w.OR = [...(w.OR ?? []), ...paramSearch];
    }
    // Siparişsiz İE'nin müşterisi top sahibidir (liste kolonu) — adıyla da bulunur.
    const ownerSearch = params.search ? workOrderOwnerNameSearchWhere(params.search) : null;
    if (ownerSearch) {
      const w = where as { OR?: Prisma.WorkOrderWhereInput[] };
      w.OR = [...(w.OR ?? []), ownerSearch];
    }
    applyDateRange(where, params, WORKORDER_DATE_FIELDS);
    if (hideCancelledWhere) Object.assign(where, hideCancelledWhere);
    if (customerCond) {
      // AND ile: aramanın `orderLinks.some` yolu OR içinde; üstteki `orderLinks` ezilmesin.
      // Fason (müşteri malı) İE'nin kendi müşterisi ∨ sipariş/top sahibi kuralı (liste müşterisiyle aynı: `withOwnCustomer`).
      const byCustomer: Prisma.WorkOrderWhereInput = { OR: [{ customerId: customerCond }, await workOrderCustomerWhere(customerCond)] };
      const w = where as { AND?: Prisma.WorkOrderWhereInput[] };
      w.AND = [...(w.AND ?? []), byCustomer];
    }
    if (typeCond) {
      const w = where as { AND?: Prisma.WorkOrderWhereInput[] };
      w.AND = [...(w.AND ?? []), { type: typeCond }];
    }
    if (locationConds.length > 0) {
      const w = where as { AND?: Prisma.WorkOrderWhereInput[] };
      w.AND = [...(w.AND ?? []), ...locationConds];
    }
    // Arşivli (isActive=false) WO'lar default'ta gizli — ?withArchived=true override
    if (req.query.withArchived !== "true") {
      (where as Record<string, unknown>).isActive = true;
    }
    // Fason Sevk akışında: zaten AÇIK + OUTSTANDING sevki olan WO'ları listeden
    // gizle. Operatör müdahale etmeden önce eski sevki iptal etmek veya mal kabul
    // yapmak zorunda. Koşul TEK KAYNAKTAN (`OPEN_OUTSTANDING`) gelir — elle
    // yazılmış eski kopya `directShippedAt` ve `receipt.cancelledAt` süzgeçlerini
    // TAŞIMIYORDU: tamamen doğrudan-sevk edilmiş WO listede sonsuza dek gizli
    // kalıyor, kabul iptali (LIFO) sonrası yeniden açılan sevk ise gizlenmiyordu.
    if (req.query.excludeWithOpenDispatch === "true") {
      (where as Record<string, unknown>).dispatches = { none: OPEN_OUTSTANDING };
    }
    // Fason Sevk picker: yalnız fason (EXTERNAL) adımı SEVKE AÇIK olan WO'lar.
    // SKIPPED adım sevke kapalı; COMPLETED EXTERNAL adım uygundur (ek parti için
    // yeniden açılır — bkz. çoklu sevk). StepStatus'ta CANCELLED yok → tek dışlama
    // SKIPPED. Önceden client-side `steps.some(EXTERNAL)` filtresi vardı: server
    // sayfasını daraltıyor, pager'ı yanıltıyor (sayfa say. fason-dışı WO'ları da
    // sayar) ve over-fetch yapıyordu → sunucuya taşındı.
    if (req.query.hasOpenExternalStep === "true") {
      (where as Record<string, unknown>).steps = {
        some: {
          station: { type: "EXTERNAL" },
          status: { not: "SKIPPED" },
        },
      };
    }
    if (meterCheck) {
      const meterCond = await meterCheckWhere(where as Prisma.WorkOrderWhereInput);
      const w = where as { AND?: Prisma.WorkOrderWhereInput[] };
      w.AND = [...(w.AND ?? []), meterCond];
    }
    return where as Prisma.WorkOrderWhereInput;
  }

export async function whereOptions(this: WorkOrderServiceThis, req: Request): Promise<WorkOrderPlaceOptions> {
    const params = parseQueryParams(req);
    // Kendi anahtarı tabandan düşer (faceted) ama değeri listeyle aynı doğrulanır (fail-closed).
    await takeWorkOrderPlaceFilters(params.filters);
    return loadWorkOrderPlaceOptions(await this.buildListWhere(req, params));
  }

export async function findAll(this: WorkOrderServiceThis, 
    req: Request
  ): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, WO_SORTABLE_FIELDS);
    const where = await this.buildListWhere(req, params);
    const withOrderDetail = req.query.withOrderDetail === "true";
    // Metre özeti OPT-IN (panel listesi ister); parametresiz yanıt bayt-aynı (tablet, eski panel).
    const withMeterSummary = req.query.withMeterSummary === "true";
    const attachMeter = async <T extends { id: string }>(rows: T[]): Promise<Array<T & { meterSummary?: unknown }>> => {
      if (!withMeterSummary) return rows;
      const sums = await workOrderMeterSummaries(rows.map((r) => r.id));
      return rows.map((r) => ({ ...r, meterSummary: sums.get(r.id) ?? null }));
    };

    const select = {
      id: true,
      workOrderNumber: true,
      type: true,
      status: true,
      width: true,
      targetQuantity: true,
      targetWeight: true,
      plannedStartDate: true,
      plannedEndDate: true,
      routeTemplateId: true,
      targetItemId: true,
      targetColorId: true,
      reworkBillable: true,
      // Üretilen kumaş + renk — liste sütunu + (targetItemId/targetColorId) filtre eşleşmesi.
      targetItem: { select: { id: true, code: true, name: true } },
      targetColor: { select: { id: true, code: true, name: true, hex: true } },
      createdAt: true,
      updatedAt: true,
      // Parti no LİSTE KOLONU (2026-08-17 saha talebi) — planlamacı iş emrini
      // sahadaki fiziksel parti plakasıyla eşleştirebilsin diye. Arama zaten
      // `batches.some.batchNumber` üzerinden çalışıyordu, gösterim yoktu.
      //
      // `orderBy: createdAt` ZORUNLU: parti no kısa/dönen biçimde (P01…P99,
      // sarmalı) olabilir → numaraya göre sıralamak "en yeni"yi vermez.
      // `mergedIntoId: null` süzgeci: birleştirilmiş parti TARİHÇEDİR, kâğıtta
      // ve listede görünmemeli (refakat kartındaki `resolveLiveBatches` ile aynı kural).
      batches: {
        where: { mergedIntoId: null },
        select: { id: true, batchNumber: true },
        orderBy: { createdAt: "asc" },
        take: BATCH_PREVIEW_LIMIT,
      },
      _count: { select: { batches: { where: { mergedIntoId: null } } } },
      // Fason (müşteri malı) İE'nin kendi müşterisi — liste müşterisinde bağdan önce gelir.
      customer: { select: { id: true, name: true } },
      steps: {
        select: {
          id: true,
          stepSequence: true,
          status: true,
          // isActive: pasife alınmış istasyonda bekleyen adım listede işaretlenir (prova 11-06, Geciken İE).
          station: { select: { id: true, code: true, name: true, type: true, kind: true, isActive: true } },
        },
        orderBy: { stepSequence: "asc" },
      },
      ...(withOrderDetail
        ? {
            orderLinks: {
              where: ACTIVE_ORDER_LINK,
              orderBy: { createdAt: "asc" },
              select: {
                orderLineId: true,
                orderLine: {
                  select: {
                    id: true,
                    item: { select: { id: true, name: true } },
                    color: { select: { id: true, name: true } },
                    order: { select: { id: true, deadline: true, ...WO_LIST_ORDER_CUSTOMER } },
                  },
                },
              },
            },
          }
        : {
            // Müşteri kolonu: bağdaki müşteri AYNI sorguda (yalnız id+ad; koparılmış bağ
            // `ACTIVE_ORDER_LINK` ile dışarıda). Rollup `rollupWorkOrderCustomers`.
            orderLinks: WO_LIST_CUSTOMER_LINKS,
          }),
    } satisfies Prisma.WorkOrderSelect;

    // CURSOR MODE — sayfa atlama yok, sabit hız; liste sayfası default'u.
    // Dinamik sortBy: cursor'a sortField değeri kodlanır, orderBy aynı yönde
    // id tie-breaker ile kararlı kalır. Detay: utils/cursor.ts dynamic API.
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";

      const sortBy = params.sortBy || "createdAt";
      const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, sortBy, sortOrder)] }
        : where;

      const [items, totalEstimate] = await Promise.all([
        prisma.workOrder.findMany({
          where: cursorWhereClause,
          orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
          take: limit + 1,
          select,
        }),
        wantTotal ? prisma.workOrder.count({ where }) : Promise.resolve(undefined),
      ]);

      const hasMore = items.length > limit;
      const data = await attachMeter(await withWorkOrderLocation(
        await this.withProductionMeters(hasMore ? items.slice(0, limit) : items),
      ));
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortBy) : null;

      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET MODE — geri uyumluluk için.
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [rawData, total] = await Promise.all([
      prisma.workOrder.findMany({ where, orderBy, skip, take, select }),
      prisma.workOrder.count({ where }),
    ]);
    const data = await attachMeter(await withWorkOrderLocation(await this.withProductionMeters(rawData)));

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

export async function withProductionMeters<
    T extends {
      id: string;
      // `station` ve `orderLinks` OPSİYONEL: liste select'i ikisini de getirir ve
      // aşağıdaki rollup geçişleri onları BELLEKTEN okur (aynı satırı ikinci kez
      // sorgulamamak için). Gelmezlerse geçişler DB turuna düşer — davranış aynı.
      steps: { id: string; stepSequence: number; station?: { name: string } | null }[];
      orderLinks?: { orderLineId: string; orderLine?: { order?: { customer?: { id: string; name: string } | null } | null } | null }[];
      /** Fason (müşteri malı) İE'nin kendi müşterisi — varsa rollup'ın önüne geçer. */
      customer?: { id: string; name: string } | null;
    },
  >(
    wos: T[]
  ): Promise<
    (T & {
      producedMeters: number;
      inputMeters: number;
      orderedMeters: number;
      /** Bağlı siparişlerin DISTINCT müşterileri (bağlanma sırası, ≤5) + toplam; bağsız İE'de top sahipleri — liste "Müşteri" kolonu. */
      customers: { id: string; name: string }[];
      customerCount: number;
      /** Şu an mal tutulan fason istasyon adları (genelde tek) — liste rozeti. */
      currentFasonStations: string[];
      /**
       * Bu iş emrinin GEÇMİŞTE VE ŞU AN gittiği fason firmalar (2026-08-17, madde 14).
       * `currentFasonStations` yalnız "şu an dışarıda mal var mı" sorusunu
       * cevaplıyordu; adım geçildiğinde firma bilgisi listede kayboluyordu.
       * Planlamacının sorusu ise "bu işi kim yaptı" — o yüzden İPTAL EDİLMEMİŞ
       * tüm sevkler okunur ve `current` ile ayrıca işaretlenir.
       */
      fasonFirms: { name: string; current: boolean }[];
    })[]
  > {
    // SİPARİŞ TOPLAMI — WO'ya bağlı sipariş satırlarının talep metrajı (quantity)
    // toplamı; üretim çıktısını/girişini sipariş talebiyle kıyaslamak için. STOK
    // üretiminde bağ yok → 0 (frontend "—" gösterir). Pivot PK (workOrderId,...)
    // lider kolonuyla indeksli, sayfa başına tek sorgu.
    //
    // ÖLÇÜM 2026-09-05: bu geçiş `work_order_to_order_lines`ı İKİNCİ kez
    // okuyordu — liste select'i `orderLinks.orderLineId`i zaten getiriyor.
    // Bağ satırları bellekten okunur, DB'ye yalnız `order_lines.quantity` turu
    // kalır (istek başına 2 → 1 sorgu). Satır KÜMESİ birebir aynı: liste
    // select'inde `orderLinks` üzerinde where/take yok.
    const orderedByWo = new Map<string, number>();
    const woIds = wos.map((w) => w.id);
    // Müşteri kolonu: açık bağı olmayan İE'nin müşterisi top sahibi — yalnız onlar için TEK sorgu.
    // `orderLinks` hiç gelmediyse (çağıran seçmedi) bugünkü gibi boş kalır; sahip okunmaz.
    const ownerlessWoIds = wos.filter((w) => Array.isArray(w.orderLinks) && w.orderLinks.length === 0).map((w) => w.id);
    const rollOwnersByWo = await loadRollOwnersByWorkOrder(ownerlessWoIds);
    if (woIds.length > 0) {
      const preloaded = wos.every((w) => Array.isArray(w.orderLinks));
      const links = preloaded
        ? wos.flatMap((w) =>
            (w.orderLinks ?? []).map((l) => ({ workOrderId: w.id, orderLineId: l.orderLineId }))
          )
        : await prisma.workOrderToOrderLine.findMany({
            where: { workOrderId: { in: woIds }, ...ACTIVE_ORDER_LINK },
            select: { workOrderId: true, orderLineId: true },
          });
      const lineIds = [...new Set(links.map((l) => l.orderLineId))];
      if (lineIds.length > 0) {
        const lines = await prisma.orderLine.findMany({
          where: { id: { in: lineIds } },
          select: { id: true, quantity: true },
        });
        const qtyByLine = new Map(lines.map((l) => [l.id, Number(l.quantity)]));
        for (const l of links) {
          orderedByWo.set(
            l.workOrderId,
            (orderedByWo.get(l.workOrderId) ?? 0) + (qtyByLine.get(l.orderLineId) ?? 0)
          );
        }
      }
    }

    const stepIds = wos.flatMap((w) => w.steps.map((s) => s.id));
    if (stepIds.length === 0) {
      return wos.map((w) => ({
        ...w,
        producedMeters: 0,
        inputMeters: 0,
        orderedMeters: orderedByWo.get(w.id) ?? 0,
        currentFasonStations: [],
        fasonFirms: [],
        ...withOwnCustomer(w.customer, resolveWorkOrderCustomers(w.orderLinks, rollOwnersByWo.get(w.id))),
      }));
    }

    // ŞU AN FASONDA — bu sayfadaki WO'lardan hangisi şu an bir fasonda mal tutuyor
    // (AT_SUBCONTRACTOR top'un currentStepId'si o EXTERNAL adım). WO başına distinct
    // istasyon adı (liste rozeti). Tek batched sorgu — currentStepId partial-indexli.
    //
    // ÖLÇÜM 2026-09-05: nested `currentStep:{workOrderId, station:{name}}` select'i
    // AYNI adım+istasyon satırlarını iki ek turda tekrar okuyordu; oysa liste
    // select'i her adımın `station.name`ini zaten getirmiş oluyor. Adım→WO ve
    // adım→istasyon haritası BELLEKTEN kurulur (3 → 1 sorgu). Küme aynı: WHERE
    // `currentStepId ∈ stepIds` olduğu için her satırın adımı bellekte VAR.
    const stepWoById = new Map<string, string>();
    const stepStationById = new Map<string, string>();
    for (const w of wos) {
      for (const st of w.steps) {
        stepWoById.set(st.id, w.id);
        if (st.station?.name) stepStationById.set(st.id, st.station.name);
      }
    }
    const fasonStationsByWo = new Map<string, Set<string>>();
    const atSubRows = await prisma.roll.findMany({
      where: { currentStepId: { in: stepIds }, status: RollStatus.AT_SUBCONTRACTOR },
      select: { currentStepId: true },
    });
    for (const r of atSubRows) {
      const stepId = r.currentStepId;
      if (!stepId) continue;
      const woId = stepWoById.get(stepId);
      const name = stepStationById.get(stepId);
      if (!woId || !name) continue;
      let set = fasonStationsByWo.get(woId);
      if (!set) {
        set = new Set();
        fasonStationsByWo.set(woId, set);
      }
      set.add(name);
    }

    // KİME GİTTİ — iptal edilmemiş TÜM fason sevkleri (adım geçmiş olsa bile).
    // Tek batched sorgu; `workOrderId` FK indeksli.
    //
    // ÖLÇÜM 2026-09-05: `step:{station:{name}}` nested select'i work_order_steps +
    // stations turlarını ÜÇÜNCÜ kez atıyordu. Adım→istasyon adı yukarıdaki
    // bellek haritasından okunur (3 → 1 sorgu). Sevkin adımı normalde aynı
    // WO'nundur; sayfa dışı bir adıma işaret eden anomali sevk varsa YALNIZ o
    // adımlar için tek ek tur atılır → `current` işareti eski davranışla aynı.
    const firmsByWo = new Map<string, Map<string, boolean>>();
    // İş emri kapsamlı: daraltma tip içindir, SQL aynı.
    const dispatchRows = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: woIds }, cancelledAt: null },
      select: {
        workOrderId: true,
        stepId: true,
        subcontractor: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }));
    const unknownStepIds = [
      ...new Set(dispatchRows.map((d) => d.stepId).filter((id) => !stepStationById.has(id))),
    ];
    if (unknownStepIds.length > 0) {
      const extraSteps = await prisma.workOrderStep.findMany({
        where: { id: { in: unknownStepIds } },
        select: { id: true, station: { select: { name: true } } },
      });
      for (const st of extraSteps) {
        if (st.station?.name) stepStationById.set(st.id, st.station.name);
      }
    }
    for (const d of dispatchRows) {
      const name = d.subcontractor?.name;
      if (!name) continue;
      let m = firmsByWo.get(d.workOrderId);
      if (!m) {
        m = new Map();
        firmsByWo.set(d.workOrderId, m);
      }
      // "Şu an orada mı" — o WO'nun fasonda tuttuğu istasyon adıyla eşleşiyorsa.
      const stationName = stepStationById.get(d.stepId);
      const isCurrent = Boolean(stationName && fasonStationsByWo.get(d.workOrderId)?.has(stationName));
      m.set(name, (m.get(name) ?? false) || isCurrent);
    }

    // ÇIKAN — üretim çıktısı; detay `producedRolls.totalMeters` ile AYNI küme
    // (producedOutputWhere) + YALNIZ FİRE hariç.
    //
    // ⚠️ İKİ DEĞİŞİKLİK (2026-08-21):
    //   ① A1 (2. kalite) ARTIK SAYILIR. Kullanıcı kararı: A1 SATILABİLİR maldır,
    //      üretim çıktısıdır. Eskiden liste onu dışlıyor, detay ise `totalMeters`
    //      içinde sayıyordu — aynı iş emri iki ekranda iki farklı "çıkan" metraj
    //      gösteriyordu. Liste artık detaya hizalı.
    //   ② Kalite kovası KATALOGDAN çözülür (`loadProducedBuckets`), kod GÖMÜLÜ
    //      DEĞİL. `qualityGrade` fabrikaya açık bir katalog kodudur; gömülü
    //      `["FIRE","A1"]` listesi yeni bir SCRAP kademesini (ör. "2. Fire")
    //      sessizce sağlam üretim sayardı (schema.prisma QualityGrade notu).
    const buckets = await loadProducedBuckets(prisma);
    const excludedGradeCodes = buckets.fireCodes;
    const producedSet = await resolveProducedOutputWhere(prisma, stepIds);
    const producedRows = await prisma.roll.groupBy({
      by: ["producedInStepId"],
      where: {
        AND: [
          producedSet,
          // Postgres `NOT IN` NULL-hostile: null kalite (kaliteye bakılmadı) sağlam
          // üretim sayılmalı; düz notIn onu dışlardı → null VEYA (fire değil).
          // Katalogda hiç fire kodu yoksa süzgeç HİÇ yazılmaz (`notIn: []` üretme).
          ...(excludedGradeCodes.length
            ? [
                {
                  OR: [
                    { qualityGrade: null },
                    { qualityGrade: { notIn: excludedGradeCodes } },
                  ],
                },
              ]
            : []),
        ],
      },
      _sum: { initialQty: true },
    });
    const producedByStep = new Map<string, number>();
    for (const r of producedRows) {
      if (r.producedInStepId) producedByStep.set(r.producedInStepId, Number(r._sum.initialQty ?? 0));
    }

    // GİREN (üretime giren) — SPLIT (tebdil) WO dahil doğru; computeWoInput tek
    // kaynak (detay inputRolls + committed ile AYNI tanım). Girdi kökü = W dışından
    // gelen üye top; split WO'nun reEntry adımında doğan enjekte kökü de sayılır
    // (eski "yalnız ilk adım" çapası split WO'yu 0 sayıyordu).
    const inputByWo = await computeWoInput(
      prisma,
      wos.map((w) => w.id),
    );

    return wos.map((w) => ({
      ...w,
      producedMeters: w.steps.reduce((sum, st) => sum + (producedByStep.get(st.id) ?? 0), 0),
      inputMeters: Number(inputByWo.get(w.id)?.meters ?? 0),
      orderedMeters: orderedByWo.get(w.id) ?? 0,
      currentFasonStations: [...(fasonStationsByWo.get(w.id) ?? [])],
      fasonFirms: [...(firmsByWo.get(w.id) ?? new Map())].map(([name, current]) => ({ name, current })),
      ...withOwnCustomer(w.customer, resolveWorkOrderCustomers(w.orderLinks, rollOwnersByWo.get(w.id))),
    }));
  }
