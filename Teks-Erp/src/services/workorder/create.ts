// =============================================================================
// TeksERP - WorkOrder (Parti) Service / create
// =============================================================================
// İş emri doğumu: numara üretimi/denetimi, create (token replay), prepareCreate, insertPreparedTx, finishCreate.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { resolveWorkOrderDefaultItemForCreate } from "../workorder-default-item.service";
import { freezeReworkBillableTx } from "../helpers/rework-billing.helper";
import { assertPlannedMachines, filterTemplatePlannedMachines } from "../helpers/planned-machine.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { collectWorkOrderDecisionWarnings } from "../helpers/defect-decision.helper";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { assertCustomerGoodsHasNoOrderLines, customerGoodsMaterialWarning, isOrderlessWorkOrderType, resolveCreateCustomer } from "../helpers/workorder-customer-goods.helper";
import {
  WorkOrder,
  WorkOrderStatus,
  Prisma,
  type RollStage,
} from "@prisma/client";
import {
  createWorkOrderTx,
} from "../helpers/workorder-event.helper";
import { assertTargetValueItems, targetValuesNestedCreate } from "../helpers/workorder-target-value.helper";
import { deriveOrderLineTargetValues } from "../helpers/order-line-target-copy.helper";
import { appendTargetNotesToExternalSteps } from "../helpers/fason-step-target-note.helper";
import { applyFoldTypeForWriteInPlace } from "../helpers/fold-type";
import { assertTargetablePropertyIds } from "../helpers/targetable-property.helper";
import { routeTemplateProblem } from "../helpers/route-template-usable.helper";
import { TravelerCardService } from "../traveler-card.service";
import {
  readProductionRouteMode,
} from "../system-setting.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { isClientTokenP2002, p2002Mentions } from "../../utils/p2002";
import { assertWorkOrderReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import { nextSeriesNo } from "../number-series.service";
import { assertManualNumberAllowed } from "../helpers/manual-number.helper";
import { assertItemUsable, assertItemUsableTx, type ItemUsage } from "../helpers/item-usage.helper";
import { TERIM } from "../../constants/terim";
import { assertWorkOrderLinesSingleSpec } from "../helpers/workorder-line-spec.helper";
import type { WorkOrderService } from "../workorder.service";
import { WO_REPLAY_INCLUDE, activeOrderLineIds, assertOrderLinesLinkable, assertRouteRefsActive, collectRouteCoverageWarnings, inputOrderLineIds, resolvePlanDates, toSpecLine, type WorkOrderCreateInput, type WorkOrderReplayRow, type WorkOrderServiceThis } from "./shared";

const travelerCardService = new TravelerCardService();

// Phase 1: WO açılış/iptali artık order status'a dokunmuyor. IN_PRODUCTION
// statü olarak kaldırıldı; "üretim sürüyor mu?" sorusu line.workOrderLinks
// üzerinden runtime hesabı.

export type PreparedWorkOrder = Awaited<ReturnType<WorkOrderService["prepareCreate"]>>;

/** Oluşturma yanıtının projeksiyonu (create + üretim önerisi aynı biçimi döner). */
const WO_CREATE_INCLUDE = {
  steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
  orderLinks: {
    where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" },
    include: { orderLine: { include: { order: { include: { customer: true } }, item: true, color: true } } },
  },
  routeTemplate: true,
} satisfies Prisma.WorkOrderInclude;

/**
 * ESKİ VERİ UYARISI (1e kararı Q1 revize, 2026-09-25): arşiv kapısı artık aktif rotanın
 * planladığı rengi/özelliği pasife aldırmıyor (kaynakta durur). Kapıdan önce bozulmuş rota
 * iş emri açılışında ENGELLENMEZ — sahada bugünkü olayı yeniden üretirdi; açık uyarı verir.
 * Fasoncu için mevcut engel (`assertRouteRefsActive`) aynen kalır.
 */
function passivePlanWarnings(route: {
  name: string;
  steps: Array<{
    sequence: number;
    plannedColor: { name: string; isActive: boolean } | null;
    plannedProperties: Array<{ property: { name: string; isActive: boolean } }>;
  }>;
}): string[] {
  const out: string[] = [];
  for (const s of route.steps) {
    if (s.plannedColor && !s.plannedColor.isActive) {
      out.push(
        `Rota '${route.name}' adım ${s.sequence} pasif rengi (${s.plannedColor.name}) planlıyor — ` +
          "fason kabulünde uygulanan rengi seçin; rotayı düzeltmesi için yöneticinize bildirin.",
      );
    }
    for (const p of s.plannedProperties) {
      if (!p.property.isActive) {
        out.push(
          `Rota '${route.name}' adım ${s.sequence} pasif özelliği (${p.property.name}) planlıyor — ` +
            "fason kabulünde uygulanan özelliği seçin; rotayı düzeltmesi için yöneticinize bildirin.",
        );
      }
    }
  }
  return out;
}

export async function generateWorkOrderNumber(db: Pick<typeof prisma, "workOrder"> = prisma): Promise<string> {
    const now = new Date();

    // Retry loop — nadiren de olsa unique çakışma olursa tekrar dene.
    // ⚠️ `nextSeriesNo`un çakışma atlaması bu döngünün YERİNE GEÇMEZ: atlama
    // yalnız BU okumada görülen kodlara bakar, döngü ise iki eşzamanlı açılışın
    // arasında doğan kaydı yakalar (okuma tx DIŞINDA — burası `withBarcodeRetry`
    // kapsamında değil, çünkü kayıt daha yaratılmadı).
    for (let attempt = 0; attempt < 5; attempt++) {
      // O-4: collation-güvenli (gte index seek + startsWith tam-prefix) + NUMERIC
      // max — lexicographic "999">"1000" taşmasını (seq kalıcı 1000'de sıkışırdı) ve
      // manuel harf-kuyruklu workOrderNumber'ın parseInt→NaN zehirlenmesini (Number.isFinite
      // ile) önler. findFirst+orderBy desc ikisine de açıktı.
      const candidate = await nextSeriesNo(
        "workOrder",
        async (prefix) => {
          const todays = await db.workOrder.findMany({
            where: { workOrderNumber: { gte: prefix, startsWith: prefix } },
            select: { workOrderNumber: true, createdAt: true },
          });
          return todays.map((w) => ({ code: w.workOrderNumber, createdAt: w.createdAt }));
        },
        now,
      );

      const exists = await db.workOrder.findUnique({ where: { workOrderNumber: candidate } });
      if (!exists) return candidate;
    }

    throw AppError.internal(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} numarası üretilemedi, lütfen tekrar deneyin`);
  }

export async function assertWorkOrderNumberUnique(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await prisma.workOrder.findUnique({
      where: { workOrderNumber },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw AppError.conflict(`Bu ${TERIM.terbiyeIsEmri.tekilKucuk} numarası zaten kullanılıyor: ${workOrderNumber}`);
    }
  }

export async function checkWorkOrderNumber(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<{ workOrderNumber: string; available: boolean }> {
    const trimmed = workOrderNumber.trim();
    if (!trimmed) return { workOrderNumber: trimmed, available: true };
    const existing = await prisma.workOrder.findUnique({
      where: { workOrderNumber: trimmed },
      select: { id: true },
    });
    return {
      workOrderNumber: trimmed,
      available: !existing || existing.id === excludeId,
    };
  }

export async function create(this: WorkOrderServiceThis, 
    ...args: Parameters<WorkOrderService["createFresh"]>
  ): ReturnType<WorkOrderService["createFresh"]> {
    const [data] = args;
    return this.woReplay(data).run(data.clientToken, () => this.createFresh(...args));
  }

export async function createFresh(this: WorkOrderServiceThis, 
    data: WorkOrderCreateInput,
    userId?: string,
    /**
     * ELDEKİ MAL — iş emrine bağlanacak topların HÂLİHAZIRDA taşıdığı nitelikler.
     *
     * Yalnız `quickStart` doldurur (tek yol: top okutarak açılan iş emri). Rota
     * kapsaması kontrolünü DARALTMAK için kullanılır — bkz. `assertRouteCoversTargets`
     * çağrısındaki gerekçe. Verilmezse davranış eskisiyle birebir aynı (F221 deseni:
     * alan yoksa muafiyet yok).
     */
    goods?: { colorIds: (string | null)[]; propertyIdSets: string[][] },
  ): Promise<ApiResponse<WorkOrder> & { idempotentReplay?: boolean }> {
    const prep = await this.prepareCreate(data, goods);
    const { manualWorkOrderNumber } = prep;
    // Otomatik iş emri no sequence çakışırsa (P2002) tx'i baştan dene. Tx'in İLK ifadesi
    // kart kilidi: 8030 SHARED → FOR SHARE (eşzamanlı "Pasif'e geç" bu iş emrini görür).
    const workOrder = await withBarcodeRetry(() => prisma.$transaction((tx) => this.insertPreparedTx(tx, prep, userId)), undefined, (err) => {
      // İdempotent replay: clientToken P2002'si retry EDİLMEZ (retry hep aynı
      // token'ı yazar) — false ile propagate edilir, boğaz (`woReplay.run`) replay'e çevirir.
      if (isClientTokenP2002(err)) return false;
      // F61: workOrderNumber P2002'si MANUEL modda retry EDİLMEZ (hep aynı numarayı
      // yazar) — doğrudan anlaşılır 409. (Auto modda taze numarayla retry edilir.)
      if (manualWorkOrderNumber && p2002Mentions(err, /workOrderNumber/i)) {
        throw AppError.conflict(`Bu ${TERIM.terbiyeIsEmri.tekilKucuk} numarası zaten kullanılıyor: ${manualWorkOrderNumber}`);
      }
      return true;
    });
    return this.finishCreate(workOrder, prep, userId);
  }

export async function prepareCreate(this: WorkOrderServiceThis, data: WorkOrderCreateInput, goods?: { colorIds: (string | null)[]; propertyIdSets: string[][] }) {
    // Kat katalog doğrulaması — YERİNDE kanonikleştirir, böylece aşağıdaki tüm
    // kullanımlar (yazım + kilit karşılaştırmaları) aynı değeri görür.
    await applyFoldTypeForWriteInPlace(data as Record<string, unknown>);

    let type = (data.type as WorkOrder["type"]) ?? "ORDER_PRODUCTION";

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) ────────────────────
    let finalSteps: {
      stationId: string;
      notes: string | null;
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      dispatchWithoutColor?: boolean;
      plannedMachineId?: string | null;
      outputStage?: RollStage | null;
    }[] = [];

    // Eski veride aktif rota pasif renk/özellik planlıyor olabilir — engel değil UYARI.
    const planWarnings: string[] = [];
    if (data.routeTemplateId) {
      if (data.steps && data.steps.length > 0) {
        throw AppError.badRequest(
          "Aynı anda hem rota şablonu hem özel rota adımları veremezsiniz. Birini seçin."
        );
      }
      const template = await prisma.route.findUnique({
        where: { id: data.routeTemplateId },
        include: {
          steps: {
            orderBy: { sequence: "asc" },
            include: {
              plannedColor: { select: { name: true, isActive: true } },
              plannedProperties: { select: { property: { select: { name: true, isActive: true } } } },
            },
          },
        },
      });
      if (!template) {
        throw AppError.notFound("Rota şablonu bulunamadı");
      }
      planWarnings.push(...passivePlanWarnings(template));
      const templateProblem = routeTemplateProblem({ isActive: template.isActive, stepCount: template.steps.length });
      if (templateProblem) throw AppError.badRequest(templateProblem);

      // Fason planlama overlay'i: sequence'e göre eşleştir.
      const planBySeq = new Map<number, NonNullable<WorkOrderCreateInput["stepPlanning"]>[number]>();
      for (const p of data.stepPlanning ?? []) planBySeq.set(p.sequence, p);

      finalSteps = template.steps.map((s) => {
        const overlay = planBySeq.get(s.sequence);
        return {
          stationId: s.stationId,
          notes:     overlay?.notes ?? s.defaultNotes ?? null,
          // Saha #14: şablonda kayıtlı fason planlaması artık default olarak
          // klonlanır (eskiden şablon bunu saklayamıyordu, hep boş geliyordu);
          // formdaki stepPlanning overlay'i yine ezebilir.
          requiredCategoryId:     overlay?.requiredCategoryId ?? s.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? s.plannedSubcontractorId ?? null,
          // 2026-08-17: "fasona renksiz git" işareti de şablondan klonlanır.
          dispatchWithoutColor:   overlay?.dispatchWithoutColor ?? s.dispatchWithoutColor ?? false,
          plannedMachineId:       s.plannedMachineId ?? null,
          // Top aşaması 2026-11-10: çıktı aşaması şablondan klonlanır; overlay verirse ezer.
          outputStage:            overlay?.outputStage !== undefined ? overlay.outputStage : (s.outputStage ?? null),
        };
      });
      // Şablondaki öneri bayatsa (pasif/başka istasyon) açılış durmaz: öneri düşer + uyarı.
      const filtered = await filterTemplatePlannedMachines(prisma, finalSteps);
      planWarnings.push(...filtered.warnings);
      finalSteps = filtered.steps.map((st, i) => {
        const overlay = planBySeq.get(template.steps[i].sequence);
        return overlay && overlay.plannedMachineId !== undefined ? { ...st, plannedMachineId: overlay.plannedMachineId } : st;
      });
    } else {
      if (!data.steps || data.steps.length === 0) {
        if (!data.scanRouted) {
          throw AppError.badRequest(
            "Rota şablonu seçin veya özel rota adımları tanımlayın."
          );
        }
        // K29: rotasız İE yalnız "Rota uygulaması: Okutmayla" iken (SIRALI'da bugünkü 400 aynen).
        if ((await readProductionRouteMode()) !== "SCAN") {
          throw AppError.badRequest(`Rotasız ${TERIM.terbiyeIsEmri.tekilKucuk} yalnız rota uygulaması 'Okutmayla' iken açılabilir.`, { code: "SCAN_ROUTE_DISABLED" });
        }
      }
      finalSteps = (data.steps ?? []).map((s) => ({
        stationId: s.stationId,
        notes:     s.notes ?? null,
        requiredCategoryId:     s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        dispatchWithoutColor:   s.dispatchWithoutColor ?? false,
        plannedMachineId:       s.plannedMachineId ?? null,
        outputStage:            s.outputStage ?? null,
      }));
    }

    // Açık verilen öneri (overlay/özel rota) sert doğrulanır: makine adımın istasyonunda + aktif.
    await assertPlannedMachines(prisma, finalSteps);

    // ── Soft-delete guard (SEC-3): rotadaki istasyon/kategori/firma referansları
    // var + aktif olmalı. Custom rota VE şablon yolunu birlikte kapsar (şablon
    // aktif olsa da içindeki istasyon sonradan pasife alınmış olabilir).
    await assertRouteRefsActive(finalSteps);

    // ── Sipariş bağları + tahsis miktarları (3.2) ───────────────────────────
    let allocations: { orderLineId: string; allocatedQty: number }[] = [];
    if (data.orderLineAllocations && data.orderLineAllocations.length > 0) {
      allocations = data.orderLineAllocations.map((a) => ({
        orderLineId: a.orderLineId,
        allocatedQty: a.allocatedQty ?? 0,
      }));
    } else if (data.orderLineIds && data.orderLineIds.length > 0) {
      // Geriye uyumluluk
      allocations = data.orderLineIds.map((id) => ({ orderLineId: id, allocatedQty: 0 }));
    }

    // TİP = BAĞIN AYNASI (2026-08-21): sipariş satırı geldiyse tip STOK OLAMAZ —
    // sunucu çevirir. Aksi hâlde "STOK + satır" gövdesi bağı yazar, tipi STOK
    // bırakır ve aşağıdaki sipariş-satırı doğrulamalarını (kumaş/renk/iptal) da
    // atlardı. Panel formu tipi satırdan türettiği için bugün bu yolu kullanmıyor;
    // kural istemci disiplinine değil sunucuya ait (workorder-link.service ile aynı).
    if (allocations.length > 0 && type === "STOCK_PRODUCTION") {
      type = "ORDER_PRODUCTION";
    }

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        `Siparişe özel üretim ${TERIM.terbiyeIsEmri.tekilKucuk} en az bir sipariş kalemine bağlanmalıdır.`
      );
    }
    // Fason (müşteri malı): sipariş yok, müşteri İE'nin üstünde ve zorunlu.
    assertCustomerGoodsHasNoOrderLines(type, allocations.length);
    const customerId = await resolveCreateCustomer(type, data.customerId);

    // ── Hedef ürün (targetItem) doğrulaması ─────────────────────────────────
    // STOCK_PRODUCTION: zorunlu — planlamacı ne üretiyoruz onu söylemeli.
    // ORDER_PRODUCTION: bağlı sipariş satırlarındaki ürün ile tutarlı olmalı.
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;
    // İE varsayılan stok kartı: yalnız topsuz/siparişsiz stoğa üretimde boş hedefe (elle seçim ezilmez; ayar boşsa bugünkü 400).
    const defaultTargetItem = isOrderlessWorkOrderType(type) && !resolvedTargetItemId && !goods && allocations.length === 0
      ? await resolveWorkOrderDefaultItemForCreate()
      : null;
    if (defaultTargetItem) resolvedTargetItemId = defaultTargetItem.id;

    if (isOrderlessWorkOrderType(type) && !resolvedTargetItemId) {
      throw AppError.badRequest(
        `Siparişsiz ${TERIM.terbiyeIsEmri.tekilKucuk} için hedef ürün seçmelisiniz.`
      );
    }

    // Kart kullanımı (URUN-YASAM-DONGUSU.md §4): okutulan toplar ya da açık sipariş
    // satırı = mevcut malı/belgeyi yürütür (E); topsuz+siparişsiz iş emri = yeni plan (A3).
    const woItemUsage: ItemUsage = goods || allocations.length > 0 ? "EXISTING_GOODS" : "NEW_PLAN";
    if (resolvedTargetItemId) await assertItemUsable(prisma, resolvedTargetItemId, woItemUsage);

    // ORDER_PRODUCTION'da hedef ürün+renk+özellikleri orderLine'lardan otomatik
    // türet/doğrula. Tüm bağlı satırların aynı item+color olması beklenir.
    let resolvedTargetColorId: string | null = data.targetColorId ?? null;
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const orderLineItems = await prisma.orderLine.findMany({
        where: { id: { in: allocations.map((a) => a.orderLineId) } },
        select: {
          id: true, itemId: true, colorId: true,
          item: { select: { name: true } },
          color: { select: { name: true } },
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
      // Tek kumaş + tek renk: hedef (undefined/null/değer) ne olursa olsun karışık kalem 400.
      assertWorkOrderLinesSingleSpec(orderLineItems.map(toSpecLine));
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor"
          );
        }
        resolvedTargetItemId = onlyItemId;
      }

      const distinctColors = new Set(orderLineItems.map((l) => l.colorId));
      if (distinctColors.size === 1) {
        const onlyColorId = Array.from(distinctColors)[0];
        if (
          data.targetColorId !== undefined &&
          data.targetColorId !== onlyColorId
        ) {
          throw AppError.badRequest(
            "Hedef renk, sipariş satırlarındaki renk ile uyuşmuyor",
          );
        }
        resolvedTargetColorId = onlyColorId;
      } else if (distinctColors.size > 1 && data.targetColorId === undefined) {
        // Buraya yalnız "renksiz + tek renk" karışımı düşer (iki renk yukarıda 400).
        throw AppError.badRequest(
          "Sipariş satırları renkli ve renksiz kalem içeriyor; hedef rengi açıkça belirtin",
        );
      }
    }

    // ── Hedef Item + targetColor + targetProperties doğrulamaları ────────
    // 1) ORDER_PRODUCTION'da targetPropertyIds verilmediyse, bağlı OrderLine'ların
    //    requiredProperties birleşimi otomatik kullanılır (planlamacı override edebilir).
    // 2) Item allowed listeleri dolu ise targetColor/Property o setin alt kümesi olmalı.
    // 3) targetColorId set edilmişse, rotada appliesColor=true en az bir adım olmalı
    //    (yoksa renk asla uygulanmaz → planlama hatası).
    // 4) targetProperties dolu ise, rotada appliesProperty=true en az bir adım olmalı
    //    (simetrik kural — özellik asla uygulanmaz aksi halde).
    /** Engel olmayan planlama notları — yanıtta `warnings` olarak döner. */
    const routeWarnings: string[] = [...planWarnings];
    const materialWarning = customerGoodsMaterialWarning(type, data.materialProvidedBy);
    if (materialWarning) routeWarnings.push(materialWarning);
    let targetPropertyIds = [...new Set(data.targetPropertyIds ?? [])];
    let targetValues = data.targetValues ?? [];
    if (
      targetPropertyIds.length === 0 &&
      type === "ORDER_PRODUCTION" &&
      allocations.length > 0 &&
      data.targetPropertyIds === undefined
    ) {
      const required = await prisma.orderLineRequiredProperty.findMany({
        where: { orderLineId: { in: allocations.map((a) => a.orderLineId) } },
        select: { propertyId: true },
      });
      targetPropertyIds = [...new Set(required.map((r) => r.propertyId))];
    }
    // SY-F1 (§7.5/2): bağlı satırların hedef değerleri kopyalanır; özellikte satırlar ayrışırsa uyarı + kopya yok.
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const copied = await deriveOrderLineTargetValues(prisma, allocations.map((a) => a.orderLineId), targetValues);
      targetValues = copied.items;
      routeWarnings.push(...copied.warnings);
      // SY-F4 (§7.5/4): satırdan gelen değer, onu uygulayan fason adımın notuna (→ çeki talimatı) doğuşta eklenir.
      const noted = await appendTargetNotesToExternalSteps(prisma, finalSteps, copied.copied);
      finalSteps = noted.steps;
      routeWarnings.push(...noted.warnings);
    }

    if (resolvedTargetItemId) {
      const targetItemFull = await prisma.item.findUnique({
        where: { id: resolvedTargetItemId },
        select: {
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });

      // Renk allowed list kontrolü
      if (resolvedTargetColorId) {
        const colorRow = await prisma.color.findUnique({
          where: { id: resolvedTargetColorId },
          select: { isActive: true, name: true },
        });
        if (!colorRow || !colorRow.isActive) {
          throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
        }
        const allowedColorSet = new Set(
          (targetItemFull?.allowedColors ?? []).map((c) => c.colorId),
        );
        if (allowedColorSet.size > 0 && !allowedColorSet.has(resolvedTargetColorId)) {
          throw AppError.badRequest(
            `'${colorRow.name}' rengi bu ürüne uygulanabilir renk listesinde değil`,
          );
        }
      }

      await assertTargetValueItems(prisma, targetValues);

      // Özellik allowed list kontrolü
      if (targetPropertyIds.length > 0) {
        const propRows = await prisma.fabricProperty.findMany({
          where: { id: { in: targetPropertyIds }, isActive: true },
          select: { id: true, name: true },
        });
        if (propRows.length !== targetPropertyIds.length) {
          throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
        }

        // SEÇİM tipli özellik HEDEF olamaz — isTargetableProperty sunucu karşılığı
        // (denetim Q2): değerini istasyonda operatör verir, hedef listesi taşımaz.
        await assertTargetablePropertyIds(targetPropertyIds, `${TERIM.terbiyeIsEmri.tekilKucuk} hedef özelliği`);

        const allowedSet = new Set(
          (targetItemFull?.allowedProperties ?? []).map((p) => p.propertyId),
        );
        if (allowedSet.size > 0) {
          const disallowed = propRows.find((p) => !allowedSet.has(p.id));
          if (disallowed) {
            throw AppError.badRequest(
              `'${disallowed.name}' özelliği bu ürün için tanımlı değil`,
            );
          }
        }
      }

      // "Renk veren" / "Özellik veren" adım var mı? — UYARI üretir, reddetmez
      // (gerekçe: `collectRouteCoverageWarnings` başlığı).
      //
      // ⚠️ MAL ZATEN ÖYLE GELİYORSA UYARI DA ÇIKMAZ. Uyarının söylediği şey
      // "toplar bu niteliği kendiliğinden almayacak"tır; nitelik eldeki topların
      // HEPSİNDE zaten varsa bu cümle yanlıştır ve gürültü olur (okunmayan uyarı,
      // olmayan uyarıdan kötüdür). Dışarıdan boyalı gelen kumaşa yalnız
      // kurşun+tambur yapılacak senaryonun tam karşılığı.
      //
      // "HEPSİ" load-bearing: bir kısmında eksikse o toplar niteliği hiç
      // kazanamaz → uyarı MEŞRU, bastırılmaz. Mal bilgisi yoksa (masaüstü formu
      // top almaz) bastırma da yok.
      const rollCount = goods?.colorIds.length ?? 0;
      const colorAlreadyOnGoods =
        rollCount > 0 &&
        !!resolvedTargetColorId &&
        goods!.colorIds.every((c) => c === resolvedTargetColorId);
      const propsAlreadyOnGoods = new Set(
        rollCount > 0
          ? targetPropertyIds.filter((pid) => goods!.propertyIdSets.every((set) => set.includes(pid)))
          : [],
      );
      const uncoveredProps = targetPropertyIds.filter((pid) => !propsAlreadyOnGoods.has(pid));

      // K29 rotasız İE (S14b): rota sahada okutmayla kurulur → açılışta kapsama sorusu yok (adım eklenirken S10 hedefi).
      const routeDecidedOnSite = data.scanRouted === true && finalSteps.length === 0;
      if (!routeDecidedOnSite && (resolvedTargetColorId || targetPropertyIds.length > 0)) {
        routeWarnings.push(
          ...(await collectRouteCoverageWarnings(finalSteps, {
            color: !!resolvedTargetColorId && !colorAlreadyOnGoods,
            property: uncoveredProps.length > 0,
          })),
        );
      }

      // ── Özellik başına rota kapsaması ────────────────────────────────────
      // 2026-08-02: bu kontrol eskiden YALNIZ replace/updateTargetProperties'te
      // vardı. Asimetri şuna yol açıyordu: API'den ZIMPARALI hedefiyle iş emri
      // AÇILABİLİYOR ama aynı iş emrine sonradan EKLENEMİYOR (409). Yukarıdaki
      // kategori kontrolü "özellik veren bir adım var mı" der; bu blok "ŞU
      // özelliği veren bir adım var mı" der — ikisi farklı sorular (rotada
      // boyahane olması zımparanın uygulanacağı anlamına gelmez).
      // Create'te tüm adımlar PENDING olduğu için uygun küme = rotadaki tüm
      // istasyonların yetenekleri; locks helper'ının COMPLETED elemesine gerek yok.
      if (!routeDecidedOnSite && targetPropertyIds.length > 0) {
        const routeStationIds = [...new Set(finalSteps.map((s) => s.stationId))];
        const caps = await prisma.stationProperty.findMany({
          where: { stationId: { in: routeStationIds } },
          select: { propertyId: true },
        });
        const applicable = new Set(caps.map((c) => c.propertyId));
        const uncoveredIds = targetPropertyIds.filter((pid) => !applicable.has(pid));
        if (uncoveredIds.length > 0) {
          const uncovered = await prisma.fabricProperty.findMany({
            where: { id: { in: uncoveredIds } },
            select: { name: true },
          });
          const names = uncovered.map((p) => p.name).join(", ");
          throw AppError.badRequest(
            `Şu özelliği uygulayabilecek istasyon rotada yok: ${names}. Uygun istasyonu rotaya ekleyin ya da o istasyonun yetenek listesine bu özelliği tanımlayın.`,
          );
        }
      }
    }

    // ── workOrderNumber / İş Emri No ─────────────────────────────────────────
    // KÖPRÜ (Faz 2): form/payload alanı hâlâ `batchNumber` adıyla geliyor (Zod
    // Faz 6'da `manualWorkOrderNumber`'a döner); bu değer artık İŞ EMRİ NO'yu
    // (İE…) doldurur — parti no (P…) attach anında AYRI üretilir (batch.service).
    // Kullanıcı verdiyse benzersizliğini doğrula; vermediyse otomatik üret
    // (IE+GGAAYY+NNNN) — üretim RETRY KAPSAMINDA, tx içinde: eşzamanlı iki create
    // aynı günlük max'ı okuyup P2002'de aynı numarayla çakışmasın.
    let manualWorkOrderNumber: string | null = null;
    if (data.batchNumber && data.batchNumber.trim().length > 0) {
      manualWorkOrderNumber = data.batchNumber.trim();
      await this.assertWorkOrderNumberUnique(manualWorkOrderNumber);
    }
    // `numberSource` kapısı KÖPRÜ ALANIN ardından: kullanıcı ne gönderdiyse
    // ONUN üzerinden karar verilir (alan adı `batchNumber`, anlamı iş emri no).
    assertManualNumberAllowed("workOrder", manualWorkOrderNumber);

    return { data, type, customerId, finalSteps, allocations, resolvedTargetItemId, woItemUsage, resolvedTargetColorId, routeWarnings, targetPropertyIds, targetValues, manualWorkOrderNumber, defaultTargetItem };
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function insertPreparedTx(this: WorkOrderServiceThis, tx: Prisma.TransactionClient, prep: PreparedWorkOrder, userId?: string, numberDb: Pick<typeof prisma, "workOrder"> = prisma) {
    const { data, type, customerId, finalSteps, allocations, resolvedTargetItemId, woItemUsage, resolvedTargetColorId, targetPropertyIds, targetValues, manualWorkOrderNumber, defaultTargetItem } = prep;
    if (resolvedTargetItemId) await assertItemUsableTx(tx, resolvedTargetItemId, woItemUsage);
    const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber(numberDb));
    // Gevşek model: per-kalem aşırı-tahsis kontrolü YOK. Sipariş bağı yalnız
    // "bu iş emri hangi siparişler için" niyetidir (metraj taşımaz); fazla
    // üretim Tambur'da stoğa düşer. Yalnız satırların varlığını doğrula.
    if (allocations.length > 0) {
      const found = await tx.orderLine.count({ where: { id: { in: allocations.map((a) => a.orderLineId) } } });
      if (found !== allocations.length) {
        throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
      }
    }

    const planDates = await resolvePlanDates(
      data.plannedStartDate,
      data.plannedEndDate,
    );

    const wo = await createWorkOrderTx(tx, { trigger: "WO_CREATE", userId }, {
      data: {
        // Künye (Faz A2) — "iş emrini KİM AÇTI" bilgisi bugüne kadar HİÇ
        // yoktu; yalnız audit'ten okunabiliyordu ve audit 6 ayda arşivlenir.
        createdById: userId ?? null,
        updatedById: userId ?? null,
        workOrderNumber,
        clientToken:       data.clientToken ?? null,
        type,
        customerId,
        width:             data.width          ?? null,
        targetQuantity:    data.targetQuantity ?? null,
        targetWeight:      data.targetWeight ?? null,
        parameters:        (data.parameters as Prisma.InputJsonValue) ?? undefined,
        // F9: yeniden işlem sebebinin ücret sınıfı İE doğarken DONAR; fatura katalogu canlı okumaz.
        reworkBillable:    await freezeReworkBillableTx(tx, data.parameters),
        status:            WorkOrderStatus.PLANNED,
        plannedStartDate:  planDates.plannedStartDate,
        plannedEndDate:    planDates.plannedEndDate,
        routeTemplateId:   data.routeTemplateId   ?? null,
        targetItemId:      resolvedTargetItemId,
        targetColorId:     resolvedTargetColorId,
        foldType:          data.foldType          ?? null,
        materialProvidedBy: data.materialProvidedBy ?? null,
        scanRouted:        data.scanRouted === true && finalSteps.length === 0,
        steps: {
          create: finalSteps.map((step, index) => ({
            stationId:              step.stationId,
            stepSequence:           index + 1,
            notes:                  step.notes,
            requiredCategoryId:     step.requiredCategoryId ?? null,
            plannedSubcontractorId: step.plannedSubcontractorId ?? null,
            plannedMachineId:       step.plannedMachineId ?? null,
            // "Fasona renksiz git" (2026-08-17 ekru kuralı). Bu satır 2026-08-25'e
            // kadar YOKTU: finalSteps alanı taşıyordu ama yazıma girmiyordu, yani
            // şablondan miras da form overlay'i de sessizce düşüyordu.
            dispatchWithoutColor:   step.dispatchWithoutColor ?? false,
            outputStage:            step.outputStage ?? null,
          })),
        },
        ...(allocations.length > 0
          ? {
              orderLinks: {
                create: allocations.map((a) => ({
                  orderLineId:  a.orderLineId,
                  allocatedQty: a.allocatedQty,
                })),
              },
            }
          : {}),
        ...(targetPropertyIds.length > 0
          ? {
              targetProperties: {
                create: targetPropertyIds.map((propertyId) => ({ propertyId })),
              },
            }
          : {}),
        ...targetValuesNestedCreate(targetValues, userId),
      },
      include: WO_CREATE_INCLUDE,
    }, defaultTargetItem ? { defaultTargetItemApplied: true } : undefined);

    // Phase 1: WO açılışı order status'a dokunmuyor. "Üretim sürüyor mu?"
    // sorusu line.workOrderLinks üzerinden runtime hesabı.

    // Refakat kartı İŞ EMRİ açılışında doğar (İE başına tek kart, barkod = İE).
    // Parti (Batch) sonradan doğsa da yeni kart üretmez; kart hep bu WO'ya bağlı.
    // Kartsız WO olmaz → mobil fason sevkte ilk sevkten önce bile okutulabilir.
    await travelerCardService.createForWorkOrder(tx, wo.id, userId);

    return wo;
  }

export async function finishCreate(workOrder: Awaited<ReturnType<WorkOrderService["insertPreparedTx"]>>, prep: PreparedWorkOrder, userId?: string) {
    const { finalSteps, allocations, routeWarnings, targetPropertyIds, targetValues, defaultTargetItem } = prep;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: workOrder.id,
      newData: {
        workOrderNumber:    workOrder.workOrderNumber,
        type:               workOrder.type,
        ...(workOrder.customerId ? { customerId: workOrder.customerId } : {}),
        width:              workOrder.width,
        status:             workOrder.status,
        stepCount:          finalSteps.length,
        routeTemplateId:    workOrder.routeTemplateId,
        allocationCount:    allocations.length,
        targetItemId:       workOrder.targetItemId,
        targetColorId:      workOrder.targetColorId,
        targetPropertyIds,
        targetValues,
        ...(defaultTargetItem ? { defaultTargetItemApplied: true } : {}),
      },
    });
    if (defaultTargetItem) {
      routeWarnings.unshift(`Hedef kumaş seçilmedi; ${TERIM.terbiyeIsEmri.tekilKucuk} varsayılan stok kartı (${defaultTargetItem.name}) yazıldı.`);
    }

    // Tambursuz rota (KQ-D8, K7): yazılmış rotadan okunur; engel değil UYARI.
    routeWarnings.push(...(await collectWorkOrderDecisionWarnings(workOrder.id)));
    return {
      success: true,
      data: workOrder,
      message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} oluşturuldu: ${workOrder.workOrderNumber}`,
      // Engel olmayan planlama notları (örn. "rotada renk veren adım yok").
      // `update` yolu bunu 2026-08-21'den beri döndürüyordu; oluşturma yolu
      // aynı durumu 400 ile reddettiği için hiç ihtiyaç duymamıştı.
      ...(routeWarnings.length > 0 ? { warnings: routeWarnings } : {}),
    };
  }

export function woReplay(data: WorkOrderCreateInput) {
    const lineIds = inputOrderLineIds(data);
    return tokenReplay<WorkOrderReplayRow, ApiResponse<WorkOrder> & { idempotentReplay?: boolean }>({
      find: (db, clientToken) => db.workOrder.findUnique({ where: { clientToken }, include: WO_REPLAY_INCLUDE }),
      alive: assertWorkOrderReplayAlive,
      identity: (p) => [
        { ad: "orderLines", mevcut: activeOrderLineIds(p), gelen: lineIds },
        ...(data.targetItemId != null ? [{ ad: "targetItemId", mevcut: p.targetItemId, gelen: data.targetItemId }] : []),
        ...(data.type && !lineIds ? [{ ad: "type", mevcut: p.type, gelen: data.type }] : []),
      ],
      collision: (p) => `Bu form daha önce kaydedilmiş: ${p.workOrderNumber}. Yeni ${TERIM.terbiyeIsEmri.tekilKucuk} için formu kapatıp yeniden açın.`,
      collisionEk: (p) => ({ workOrderNumber: p.workOrderNumber }),
      respond: (p) => ({ success: true, data: p, message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten oluşturulmuş (idempotent retry): ${p.workOrderNumber}`, idempotentReplay: true }),
    });
  }
