// =============================================================================
// TeksERP - WorkOrder (Parti) Service / shared
// =============================================================================
// Ortak yardımcılar, sabitler ve taşınan metotların `this` tipi.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================

import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { assertStationsRoutable } from "../helpers/station-routable.helper";
import {
  WorkOrderStatus,
  RollStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { type TargetValueItem } from "../helpers/workorder-target-value.helper";
import {
  STEP_CAPABILITY_SELECT,
  stepCanApplyColor,
  stepCanApplyProperty,
} from "../helpers/step-capability.helper";
import {
  readWorkOrderDefaultPlanDurationDays,
} from "../system-setting.service";
import { TERIM } from "../../constants/terim";
import { type WorkOrderSpecLine } from "../helpers/workorder-line-spec.helper";
import type { WorkOrderService } from "../workorder.service";

// Prisma.Decimal | number | null | undefined → number | null (karşılaştırma için)
export function normNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

/**
 * "Bu rota hedef rengi/özelliği UYGULAYABİLİR mi?" — create ve replace ORTAK.
 *
 * ⚠️ 2026-08-27: ARTIK REDDETMİYOR, UYARIYOR — ve bu, aynı soruya iki farklı
 * cevap veren bir ayrışmayı kapatıyor. 2026-08-21'de "Rengi Değiştir" yolu
 * (`workorder-target-color.helper`) *"Rota kapsaması — REDDETME, UYAR"* kararıyla
 * yeniden yazılmıştı; oluşturma yolu 400 vermeye devam ediyordu. Yani MEVCUT bir
 * iş emrinin rengini değiştirmek uyarıyla geçiyor, YENİ bir iş emri açmak aynı
 * durumda duruyordu.
 *
 * Sektör dayanağı: rota/iş planı eksikliği ERP'lerde tipik olarak uyarıdır
 * (SAP PP: yönlendirme uyarısı üretim emrini durdurmaz), planlamacı bilinçli
 * geçebilir. Sert kapının bedeli ölçüldü: dışarıdan boyalı gelen kumaşa yalnız
 * kurşun+tambur yapılacak meşru senaryoyu tamamen engelliyordu.
 *
 * ⚠️ KABUL EDİLEN RİSK (kullanıcı kararı): eksik rotayla iş emri açılabilir.
 * Bu yüzden uyarı metni NE eksik olduğunu ve SONUCUNU somut söyler — "rota
 * uygun değil" gibi genel bir cümle planlamacıya ne yapacağını söylemez.
 *
 * ⚠️ 2026-08-10'da SORU DEĞİŞTİ. Eskisi *"rotada fason kategorisi var mı"* diye
 * soruyordu ve tümü İÇ istasyonlardan oluşan bir rotayı, istasyonlar o işi
 * yapabilse bile 400 ile reddediyordu ("Hedef renk veya özellik seçildi ama
 * rotada hiç fason kategorisi tanımlı değil"). İç boyahane/iç zımpara
 * senaryosunun önündeki asıl engel buydu.
 *
 * Yeni soru: *"renk/özellik VEREBİLEN bir adım var mı"* — adım bazında
 * İSTASYON bayrağı VEYA o adımda seçilmiş fason hizmetinin bayrağı
 * (`stepCanApplyColor`). Fason rotalarda sonuç birebir aynı: EXTERNAL
 * istasyonların bayrakları göçte kategorilerinden dolduruldu.
 *
 * İki blok halinde kopyalanmıştı; ayrışırlarsa aynı iş emri create'te kabul
 * edilip replace'te reddedilirdi (2026-08-02'de özellik kapsamasında tam bu
 * asimetri yaşandı).
 */
export async function collectRouteCoverageWarnings(
  steps: { stationId: string; requiredCategoryId?: string | null }[],
  need: { color: boolean; property: boolean },
): Promise<string[]> {
  const stationIds = [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
  const categoryIds = [
    ...new Set(steps.map((s) => s.requiredCategoryId).filter((c): c is string => !!c)),
  ];
  const [stations, categories] = await Promise.all([
    stationIds.length > 0
      ? prisma.station.findMany({
          where: { id: { in: stationIds } },
          select: { id: true, ...STEP_CAPABILITY_SELECT },
        })
      : Promise.resolve([]),
    categoryIds.length > 0
      ? prisma.subcontractorCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, appliesColor: true, appliesProperty: true },
        })
      : Promise.resolve([]),
  ]);
  const stById = new Map(stations.map((s) => [s.id, s]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Yüklem parametreli: iki dal AYNI adım gezintisini paylaşsın (ayrı yazılırsa
  // biri `requiredCategory`yi okumayı unutur ve sessizce farklı cevap verir).
  const can = (
    pick: (
      st: { appliesColor: boolean; appliesProperty: boolean } | undefined,
      cat: { appliesColor: boolean; appliesProperty: boolean } | undefined,
    ) => boolean,
  ) =>
    steps.some((s) =>
      pick(stById.get(s.stationId), s.requiredCategoryId ? catById.get(s.requiredCategoryId) : undefined),
    );

  // ⚠️ UYARI, RED DEĞİL (2026-08-27 kullanıcı kararı). Gerekçe aşağıdaki blok
  // yorumunda; metin SOMUT olmak zorunda ("rotada renk veren adım yok" + sonucu),
  // "rota uygun değil" gibi genel bir cümle planlamacıya ne yapacağını söylemez.
  const warnings: string[] = [];
  if (need.color && !can(stepCanApplyColor)) {
    warnings.push(
      "Rotada renk veren adım (boyahane) yok — toplar hedef rengi kendiliğinden ALMAYACAK. " +
        "Mal zaten boyalı geliyorsa sorun değil; boyanacaksa rotaya renk uygulayan bir istasyon " +
        "ya da renk veren bir fason adımı ekleyin.",
    );
  }
  if (need.property && !can(stepCanApplyProperty)) {
    warnings.push(
      "Rotada özellik veren adım yok — toplar hedef özellikleri kendiliğinden ALMAYACAK. " +
        "Mal bu özelliklerle geliyorsa sorun değil; uygulanacaksa rotaya özellik uygulayan bir " +
        "istasyon ya da fason adımı ekleyin.",
    );
  }
  return warnings;
} // üretim yeni (devam) iş emrinde sürer — statü değişmez

// ⚠️ `DISPOSITION_STATUS` ve `SELLABLE_DISPOSITIONS` buradan KALDIRILDI (2026-08-06):
// artık `helpers/roll-disposition.helper.ts` içinde `DISPOSITION_TARGET_STATUS` ve
// `SELLABLE_DISPOSITION_STATUSES` olarak yaşıyorlar ve kararı UYGULAYAN kodla aynı
// dosyadalar. Buraya ikinci bir kopya koyma: iki liste ayrıştığı gün "hangisi doğru"
// sorusunun cevabı, kararın hangi ekrandan verildiğine bağlı hale gelir.

/**
 * Fiziksel olarak DIŞARIDA (fason/boyahane) olan statüler — kapanışta hard-block.
 * `softDelete`'in fason guard'ıyla aynı gerekçe: fason malı ofis kararıyla yer
 * değiştirmez, önce fason kabul/iade yapılır.
 */
export const CLOSE_BLOCKED_STATUSES: RollStatus[] = [
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** Kapanışta "istasyonda/işlemde" sayılan statüler (dispozisyon + blok kümesi). */
export const CLOSE_IN_FLIGHT_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  ...CLOSE_BLOCKED_STATUSES,
];

/**
 * Tek kapanışta dispozisyon verilebilecek en fazla top. Aşılırsa kapatma bloklanır
 * (sessiz kırpma YOK) — bu bir istisna prosedürü, yüz toplu WIP'in yeri değil.
 */
export const CLOSE_DISPOSITION_MAX_ROLLS = 200;

// -----------------------------------------------------------------------------
// İPTAL DİSPOZİSYONU (2026-08-06)
// -----------------------------------------------------------------------------
// Kapatmanın ALTI aksiyonundan farklı olarak iptalde ÜÇ karar vardır. Fark keyfî
// değil: iptal "bu iş emri hiç olmayacaktı" demektir, "üretildi" demez — depo /
// 2. kalite / devir seçenekleri kapatmanın kelimeleridir. Depoya alınacak bir mal
// varsa doğru yol KAPATMAK'tır (arayüz bunu `canSwitchToClose` ile söyler).

/** İptalde bir topa uygulanabilecek karar. */
export type CancelDisposition = "STOCK" | "SCRAP" | "CANCELLED";

export interface CancelWorkOrderInput {
  /** Yeni uçta ZORUNLU (min 3). Eski gövdesiz `DELETE /:id` bunu taşımaz. */
  reason?: string;
  /** Hareket defterindeki tetik — varsayılan `WO_CANCEL`; sipariş iptali `ORDER_CANCEL` geçirir. */
  trigger?: string;
  /**
   * Yalnız tablet yetkisiyle (panel `workorder:write` YOK) gelen iptal: üretimi başlamış iş emri
   * reddedilir — dispozisyonlu iptal panelin işi (hareket defteri S3).
   */
  untouchedOnly?: boolean;
  /**
   * Sebebin KATALOG KODU (ReasonPreset ROLL_CANCEL, 2026-08-21) — opsiyonel;
   * CANCELLED kararındaki topların `cancelReasonCode`'una yazılır. Verilmezse
   * sunucu `reason` metninden türetir (`resolveReasonCode`, tx DIŞINDA).
   */
  reasonCode?: string | null;
  /**
   * İşlemdeki topların ALT KÜMESİ. Gönderilmeyen her top varsayılan `STOCK`'a
   * döner — "eksik gönderdin" hatası bilinçli olarak YOKTUR.
   */
  dispositions?: Array<{ rollId: string; action: CancelDisposition }>;
  /**
   * AÇIKTA KALAN FASON SEVK KALEMİ İÇİN KARAR (2026-08-29 / BULGU-T1-009).
   *
   * Kısmi kabul edilmiş bir sevk (100 gitti, 51 geldi, 49 fasonda) İPTAL
   * EDİLEMEZ — `cancel()` "kabul yapılmış" der. Eskiden bu sessizce yutuluyor ve
   * boyahanedeki mal Ham Stok'a düşüyordu. İlk düzeltmem sert engeldi; o,
   * 2026-08-17'de SAHA ŞİKÂYETİ üzerine kaldırılan engeli geri getiriyordu.
   * Doğru olan, o gün kurulan desenin ta kendisi: AÇIKÇA SOR.
   *
   * `CLOSE_AS_SCRAP` = "kalan gelmeyecek" → mevcut `closeRemainder` motoru
   * koşar (fire sapma defterine, kalem damgalanır, fason karnesi kapatır).
   * Verilmezse 409 `FASON_REMAINDER_DECISION_REQUIRED` + kararın dayanacağı
   * SOMUT liste (hangi sevk, hangi top, kaç metre) döner.
   */
  fasonRemainderAction?: "CLOSE_AS_SCRAP";
  /** Fire sebebi (katalog kodu). Verilmezse sistem sebebi kullanılır. */
  fasonRemainderReasonCode?: string;
  /**
   * FASONDAKİ TOPLAR İÇİN TEK KARAR (2026-08-17 saha isteği).
   *
   * Eskiden fasonda top varsa iptal SERT ENGELLENİYORDU ("fason malı ham stoğa
   * dönemez") ve kullanıcının hiçbir çıkışı yoktu — sahadaki şikâyet buydu:
   * "bir iş emrini iptal etmek çok zor, bazen iptal edilemiyor". Yeni kural:
   * tamamlanmamış her iş emri iptal EDİLEBİLİR, ama fasondaki mal için karar
   * AÇIKÇA verilir.
   *
   *   RETURN_TO_STOCK → açık fason sevkleri iptal edilir (mal kayden geri
   *                     gelir), toplar ham stoğa döner.
   *   SCRAP           → açık sevkler yine iptal edilir (aksi halde iptal
   *                     edilmiş bir iş emrine bağlı AÇIK sevk kalırdı) ve
   *                     toplar FİRE yazılır.
   *
   * ⚠️ Karar TOPLU verilir, top top DEĞİL: sahadaki kullanıcı 40 top için 40
   * seçim yapmaz. Tek tek karar gerekiyorsa `dispositions` zaten var.
   */
  fasonAction?: "RETURN_TO_STOCK" | "SCRAP";
}

/**
 * plannedStartDate / plannedEndDate default'ları:
 *   - Başlangıç verilmediyse şimdi.
 *   - Termin verilmediyse başlangıç + N gün (N tanımlardan
 *     `workorder.defaultPlanDurationDays`; yoksa 7).
 * CREATE ve full-update (replace) akışında çağrılır; partial header update
 * (updatePlanning) bu default'u UYGULAMAZ — operatör explicit null ile temizler.
 */
export async function resolvePlanDates(
  startInput: string | Date | null | undefined,
  endInput: string | Date | null | undefined,
): Promise<{ plannedStartDate: Date; plannedEndDate: Date }> {
  const plannedStartDate = startInput ? new Date(startInput) : new Date();
  let plannedEndDate: Date;
  if (endInput) {
    plannedEndDate = new Date(endInput);
  } else {
    const days = await readWorkOrderDefaultPlanDurationDays();
    plannedEndDate = new Date(plannedStartDate);
    plannedEndDate.setDate(plannedEndDate.getDate() + days);
  }
  return { plannedStartDate, plannedEndDate };
}

export interface WorkOrderCreateInput {
  batchNumber?:       string | null;
  /** İdempotency anahtarı (UUID) — istemci form-oturumu başına üretir. Aynı
   *  token'la 2. çağrı (timeout sonrası tekrar) mevcut WO'yu cached döner;
   *  farklı payload ile gelirse 409 CLIENT_TOKEN_COLLISION. */
  clientToken?:       string | null;
  type?:              string;
  /** Fason (müşteri malı) türünde işin müşterisi — o türde ZORUNLU, diğerlerinde yok sayılır. */
  customerId?:        string | null;
  width?:             number | null;
  targetQuantity?:    number | null;
  targetWeight?:      number | null;
  parameters?:        Record<string, unknown> | null;
  plannedStartDate?:  string | null;
  plannedEndDate?:    string | null;
  routeTemplateId?:   string | null;
  targetItemId?:      string | null;
  /** Hedef renk — "renk veren" fason adımının (appliesColor=true) Fason
   *  Kabul'ünde Roll.colorId'ye kopyalanır. ORDER_PRODUCTION'da orderLine'dan
   *  auto-pull edilir; STOCK_PRODUCTION'da manuel zorunlu olabilir. */
  targetColorId?:     string | null;
  /** Tambur planlama bilgisi — "2-KAT" / "4-KAT" gibi. Tambur'a bilgi olarak
   *  iletilir; operatör finalize sırasında override edebilir. */
  foldType?:          string | null;
  /**
   * Üretim çıktısı rulolarda olacak özellikler. "Renk veren" fason adımının
   * Fason Kabul'ünde Roll.properties'e bindirilir. Item.allowedProperties
   * dolu ise bu liste onun alt kümesi olmalı.
   */
  targetPropertyIds?: string[];
  /** KQ-D6: hedef çeşit değerleri (hedef kurşun gramajı) — `WorkOrderTargetValue`. */
  targetValues?: TargetValueItem[];
  /**
   * K29 rotasız İE: adımsız açılır, adımlar sahada okutmayla eklenir. Yalnız `production.routeMode=SCAN`
   * iken ve iç çağıranlardan (belge onayında otomatik İE) — HTTP gövdesinde yok.
   */
  scanRouted?: boolean;
  /**
   * Rota adımları — routeTemplateId verilmezse zorunlu.
   * Şablon verilirse bu alan override için kullanılabilir.
   *
   * `id` opsiyonel: replace akışında smart-merge için kullanılır. Mevcut bir
   * step'i güncelletmek istersen id'yi gönder; yeni adım için id boş bırak.
   * (create akışında id yok sayılır.)
   */
  steps?: {
    id?: string;
    stationId: string;
    notes?: string | null;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
    /** Fasona renksiz git (2026-08-17 "ekru" kuralı) — bkz. schema.prisma. */
    dispatchWithoutColor?: boolean;
    /** Önerilen makine (yalnız öneri) — adımın istasyonuna ait olmalı. */
    plannedMachineId?: string | null;
  }[];
  /**
   * routeTemplateId ile birlikte verilebilir: şablondan klonlanan adımların fason
   * planlamasını üzerine yazar. `sequence` adımın rotadaki sırası (1-bazlı).
   */
  stepPlanning?: {
    sequence: number;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
    notes?: string | null;
    dispatchWithoutColor?: boolean;
    /** Önerilen makine: verilirse şablon değerini ezer, null temizler. */
    plannedMachineId?: string | null;
  }[];
  /**
   * Tercih edilen: her satıra tahsis miktarı.
   * Eski API ile uyum için `orderLineIds` da kabul edilir (allocatedQty=0 olur).
   */
  orderLineAllocations?: { orderLineId: string; allocatedQty?: number }[];
  orderLineIds?: string[] | null;
}

/**
 * Rota adımlarındaki istasyon/kategori/firma referanslarının var + aktif olduğunu
 * doğrular (soft-delete guard, SEC-3). create() ve replace() ortak kullanır —
 * pasife alınmış (isActive=false) kayıt DB FK kontrolünü geçer ama WorkOrderStep
 * emekli istasyona işaret etmemeli. Var-olmayan UUID zaten P2003→400 ile yakalanır.
 */
export async function assertRouteRefsActive(
  steps: Array<{
    stationId: string;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
  }>,
): Promise<void> {
  const stationIds = [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
  if (stationIds.length > 0) {
    const live = await prisma.station.findMany({
      where: { id: { in: stationIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== stationIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif istasyon var");
    }
    // Tezgah rotada adım değildir — tür kapısı ayrı ve adlı (400 STATION_NOT_ROUTABLE).
    await assertStationsRoutable(prisma, stationIds);
  }
  const categoryIds = [
    ...new Set(steps.map((s) => s.requiredCategoryId).filter((x): x is string => !!x)),
  ];
  if (categoryIds.length > 0) {
    const live = await prisma.subcontractorCategory.findMany({
      where: { id: { in: categoryIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== categoryIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif fason kategorisi var");
    }
  }
  const subIds = [
    ...new Set(steps.map((s) => s.plannedSubcontractorId).filter((x): x is string => !!x)),
  ];
  if (subIds.length > 0) {
    const live = await prisma.subcontractor.findMany({
      where: { id: { in: subIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== subIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif fason firma var");
    }
  }
}

/** Sipariş satırı seçiminden tek-spec kapısının girdisi (create + replace ortak). */
export function toSpecLine(l: {
  itemId: string; colorId: string | null;
  item: { name: string } | null; color: { name: string } | null; order: { orderNumber: string };
}): WorkOrderSpecLine {
  return { itemId: l.itemId, colorId: l.colorId, itemName: l.item?.name, colorName: l.color?.name, orderNumber: l.order.orderNumber };
}

/**
 * L (düşük bulgu): WO'ya bağlanacak sipariş satırları için giriş guard'ı —
 * var olmayan satır ve İPTAL edilmiş siparişin satırı reddedilir (eskiden
 * iptal siparişe sessizce yeni üretim bağlanabiliyordu). create + replace ortak.
 */
export function assertOrderLinesLinkable(
  requestedIds: string[],
  found: Array<{ id: string; order: { status: OrderStatus; orderNumber: string } }>,
): void {
  if (found.length !== new Set(requestedIds).size) {
    throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
  }
  const cancelled = [
    ...new Set(
      found
        .filter((l) => l.order.status === OrderStatus.CANCELLED)
        .map((l) => l.order.orderNumber),
    ),
  ];
  if (cancelled.length > 0) {
    throw AppError.badRequest(
      `İptal edilmiş siparişe ${TERIM.terbiyeIsEmri.tekilKucuk} bağlanamaz: ${cancelled.join(", ")}`,
    );
  }
}

/**
 * İş emri numarası doğuşta donar (IS-EMRI-HAREKET-DEFTERI §6.3). Eski istemci
 * formdaki mevcut numarayı `batchNumber` anahtarıyla geri gönderir: aynıysa yok sayılır.
 */
export function assertWorkOrderNumberUnchanged(current: string, sent: string | null | undefined): void {
  const v = sent?.trim();
  if (v && v !== current) {
    throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} numarası değiştirilemez.`, { code: "WORK_ORDER_NUMBER_FROZEN" });
  }
}

const STARTED_EDIT_MESSAGE = {
  get color() { return `Üretim başlamış ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} renk genel Düzenle'den değişmez — 'Rengi Değiştir' tuşunu kullanın (sebep ve boyanmış top kontrolüyle).`; },
  get width() { return `Üretim başlamış ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} en genel Düzenle'den değişmez — 'Eni Değiştir' tuşunu kullanın.`; },
  get orderLinks() { return `Üretim başlamış ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} sipariş bağı genel Düzenle'den değişmez — 'Sipariş Bağla' tuşunu ya da bağı kaldır düğmesini kullanın.`; },
} as const;

/**
 * Başlamış iş emrinde tek amaçlı yolu olan alan (renk · en · sipariş bağı) genel
 * Düzenle'den değişmez (IS-EMRI-HAREKET-DEFTERI §6.3, seçenek A); rota/kumaş/kat/
 * özellik fiziksel kilitlerle Düzenle'de kalır. `status` kilit altında taze okunur.
 */
export function assertStartedEditAllowed(
  status: WorkOrderStatus,
  changed: Partial<Record<keyof typeof STARTED_EDIT_MESSAGE, boolean>>,
): void {
  if (status !== WorkOrderStatus.IN_PROGRESS) return;
  const field = (Object.keys(STARTED_EDIT_MESSAGE) as (keyof typeof STARTED_EDIT_MESSAGE)[]).find((k) => changed[k]);
  if (field) throw AppError.conflict(STARTED_EDIT_MESSAGE[field], { code: "WO_STARTED_USE_ACTION", field });
}

export const WO_REPLAY_INCLUDE = {
  steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
  orderLinks: {
    where: ACTIVE_ORDER_LINK,
    orderBy: { createdAt: "asc" },
    include: { orderLine: { include: { order: { include: { customer: true } }, item: true, color: true } } },
  },
  routeTemplate: true,
} satisfies Prisma.WorkOrderInclude;
export type WorkOrderReplayRow = Prisma.WorkOrderGetPayload<{ include: typeof WO_REPLAY_INCLUDE }>;

/** Gövdedeki sipariş satırları (tahsis ya da düz liste) — replay kimliği; boşsa "". */
export function inputOrderLineIds(data: WorkOrderCreateInput): string {
  const ids = [...(data.orderLineAllocations ?? []).map((a) => a.orderLineId), ...(data.orderLineIds ?? [])];
  return [...new Set(ids)].sort().join(",");
}
export const activeOrderLineIds = (wo: WorkOrderReplayRow): string => [...new Set(wo.orderLinks.map((l) => l.orderLineId))].sort().join(",");

/**
 * Taşınan metotların `this` tipi — cephe sınıfı `.call(this, …)` ile bağlar, böylece
 * gövdedeki `this.<metot>(…)` çağrıları eskisi gibi AYNI örnekte koşar (private üyeler
 * indeksli erişim tipiyle okunur).
 */
export type WorkOrderServiceThis = Pick<WorkOrderService, "attachRolls" | "buildListWhere" | "cancelWorkOrderTx" | "create" | "finishCreate" | "generateWorkOrderNumber" | "hardDelete" | "insertPreparedTx" | "prepareCreate" | "withProductionMeters" | "woReplay"> & {
  assertWorkOrderNumberUnique: WorkOrderService["assertWorkOrderNumberUnique"];
  computeLiveManifest: WorkOrderService["computeLiveManifest"];
  createFresh: WorkOrderService["createFresh"];
  prepareFasonCancelDecision: WorkOrderService["prepareFasonCancelDecision"];
  quickStartFresh: WorkOrderService["quickStartFresh"];
  quickStartReplay: WorkOrderService["quickStartReplay"];
  returnRawRollsOnCancelTx: WorkOrderService["returnRawRollsOnCancelTx"];
  transferRollsToNewWorkOrderTx: WorkOrderService["transferRollsToNewWorkOrderTx"];
};
