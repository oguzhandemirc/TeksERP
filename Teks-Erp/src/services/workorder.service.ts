// =============================================================================
// TeksERP - WorkOrder (Parti) Service
// =============================================================================
// Handles Work Order creation, roll attachment, and document generation.
// Business Rules:
//   - A Work Order CAN exist without linked orders (producing for stock).
//   - A Work Order CAN be linked to multiple orders.
//   - WorkOrderSteps are auto-generated from the provided route stations.
//   - Rolls attached to a WO change status from STOCK → IN_PRODUCTION.
// =============================================================================

import { ROLL_DISPLAY_ORDER } from "../constants/roll-order";
import { ACTIVE_OPERATION, OWN_OPERATION } from "./helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "./helpers/roll-movement.helper";
import {
  ACTIVE_ROLL_PROPERTY,
  ACTIVE_TARGET_PROPERTY,
  revokeRollProperties,
  revokeTargetProperties,
} from "./helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK, unlinkOrderLinesTx, withActiveOrderLinks } from "./helpers/order-link.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./helpers/warehouse-stock.helper";
import { postStockMove, qtyYazilabilir } from "./helpers/warehouse-ledger.helper";
import { postProductionIssuesTx } from "./helpers/production-issue-ledger.helper";
import { warehouseStampManyTx, warehouseStampWhereTx } from "./helpers/warehouse.helper";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import prisma from "../lib/prisma";
import { SHRINK_REASON_CODE } from "../constants/variance-reasons";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { assertStationsRoutable } from "./helpers/station-routable.helper";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
  readIdCondition,
} from "../utils/query-parser";
import { rollupWorkOrderCustomers } from "./helpers/work-order-customers.helper";

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
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import {
  WarehouseEventType,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderType,
  RollStatus,
  RollEntrySource,
  StepStatus,
  OrderStatus,
  Prisma,
  ReasonPresetKind,
} from "@prisma/client";
import { resolveReasonCode } from "./reason-preset.service";
import {
  ensureWorkOrderInProgress,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import { computeWorkOrderLocks, touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { assertTargetColorChange } from "./helpers/workorder-target-color.helper";
import { applyFoldTypeForWriteInPlace } from "./helpers/fold-type";
import {
  STEP_CAPABILITY_SELECT,
  stepCanApplyColor,
  stepCanApplyProperty,
} from "./helpers/step-capability.helper";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
// Kurşun bypass (kurşun istasyonunda tablet YOK): WO yaşam döngüsü olayları açık
// dağıtım atamalarını bayat bırakmasın. Guard helper hiçbir servise bağlı değil —
// `kursun-bypass.service`'i import etmek burada döngü yaratırdı.
import {
  voidStalePendingBypassAssignmentsTx,
  repointPendingBypassAssignmentsTx,
} from "./helpers/kursun-bypass-guard.helper";
import { computeWoInput } from "./helpers/coverage.helper";
import {
  buildHiddenStatusWhere,
  HIDE_CANCELLED_FILTER,
  HIDE_COMPLETED_FILTER,
} from "./helpers/hidden-status.helper";
import { setWorkOrderCardStatusesTx } from "./helpers/traveler-card-fanout.helper";
import {
  createBatchTx,
  deleteIfEmptyAndTracelessTx,
  K18_DEAD_STATUSES,
  type CreateBatchResult,
} from "./batch.service";
import { WorkOrderSplitService } from "./workorder-split.service";
import { WorkOrderManualMoveService, type PartyMode } from "./workorder-manual-move.service";
import { cloneWorkOrderTx, repointRollsTx } from "./helpers/workorder-clone.helper";
import { loadQualityTargetMaps, resolveFinalStatus, loadProducedBuckets } from "./helpers/roll-finalize.helper";
import {
  applyRollDispositionsTx,
  DISPOSITION_MAX_ROLLS,
  type AppliedRollDisposition,
} from "./helpers/roll-disposition.helper";
import { resolveDispatchCancelBlockReason } from "./helpers/subcontractor-cancel.helper";
// Parti düşürme ayrı dosyada (bu dosya 5700+ satır) — `workorder-split` /
// `workorder-manual-move` ile aynı delegasyon deseni. Ters yöndeki bağ YALNIZ
// tip (`CancelDisposition`) olduğu için derlemede silinir → çalışma anında döngü yok.
import {
  workOrderBatchDropService,
  type BatchDropInput,
} from "./workorder-batch-drop.service";
import { TravelerCardService } from "./traveler-card.service";
import {
  readWorkOrderDefaultPlanDurationDays,
  readQualityGradeRequiredEnabled,
} from "./system-setting.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { nextManifestNo } from "./helpers/manifest-number.helper";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { normalizeScanCode } from "../utils/code-format";
import { formatSeriesCode, nextSeriesNo, resolveSeriesFormat, seriesPrefix, seriesSeqFrom } from "./number-series.service";
// Per-roll split'te taşınan toplar için yeni SD dispatch numarası (aynı sequence).
import { SubcontractorService } from "./subcontractor.service";

import { diffFields } from "./helpers/audit-diff.helper";
import { OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "./helpers/fason-open-dispatch.helper";
import { workOrderBoundOnly, workOrderStepIdOf } from "./helpers/dispatch-header.helper";
import { hata } from "../lib/logger";
import { hasRoll, isRollItem } from "./helpers/dispatch-item-kind.helper";
import { assertManualNumberAllowed } from "./helpers/manual-number.helper";
import { assertItemUsable, assertItemUsableTx, type ItemUsage } from "./helpers/item-usage.helper";
// Prisma.Decimal | number | null | undefined → number | null (karşılaştırma için)
function normNum(v: Prisma.Decimal | number | null | undefined): number | null {
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
async function collectRouteCoverageWarnings(
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
}

// =============================================================================
// KAPANIŞ DİSPOZİSYONU (WIP disposition) — manuel kapatmada istasyonda kalan top
// =============================================================================
// Kapatma artık "işlemde top var" diye reddetmez; kapanışı yapan kişi her top için
// KARAR verir ve karar sebebiyle audit'e yazılır (sektör pratiği: SAP TECO sonrası
// WIP dispozisyonu / Oracle-D365 job close). Fiziksel olarak DIŞARIDA olan mal
// (fason) hâlâ hard-block — ofisten verilen karar kumaşı geri getirmez.

/** Kapanışta istasyonda kalan (in-flight) topa uygulanacak dispozisyon kararı. */
export type CloseDisposition =
  // ⚠️ "ham stok" DEMEK DEĞİL: top `STOCK` statüsüne döner, hangi envanter
  // sekmesinde görüneceğini `entrySource` belirler (ham → Ham Stok, dışarıdan
  // alınan yarı mamul → Yarı Mamul). Etiketler bu yüzden "Stoğa geri" der.
  | "STOCK" // stoğa geri — mal geldiği gibi, yeni bir iş emrine sokulabilir
  | "WAREHOUSE" // bitmiş depo — satışa/sevke hazır
  | "A1_STOCK" // 2. kalite satılabilir stok
  | "SCRAP" // gerçek fire (mal vardı, çöpe gitti)
  | "CANCELLED" // hatalı kayıt geri alındı (fire DEĞİL — mal hiç yoktu)
  | "TRANSFER"; // üretim yeni (devam) iş emrinde sürer — statü değişmez

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
const CLOSE_BLOCKED_STATUSES: RollStatus[] = [
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** Kapanışta "istasyonda/işlemde" sayılan statüler (dispozisyon + blok kümesi). */
const CLOSE_IN_FLIGHT_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  ...CLOSE_BLOCKED_STATUSES,
];

/**
 * Tek kapanışta dispozisyon verilebilecek en fazla top. Aşılırsa kapatma bloklanır
 * (sessiz kırpma YOK) — bu bir istisna prosedürü, yüz toplu WIP'in yeri değil.
 */
const CLOSE_DISPOSITION_MAX_ROLLS = 200;

/** İstemciden gelen tek dispozisyon satırı. */
export interface CloseDispositionInput {
  rollId: string;
  action: CloseDisposition;
  /** Yalnız WAREHOUSE/A1_STOCK'ta anlamlı; opsiyonel — boş bırakılırsa kalite "—" kalır. */
  qualityGradeId?: string | null;
}

/** Uygulanan dispozisyonun audit izi (tx dışında `SystemLog`'a yazılır). */
interface AppliedDisposition {
  rollId: string;
  barcode: string | null;
  from: RollStatus;
  to: RollStatus;
  action: CloseDisposition;
}

// -----------------------------------------------------------------------------
// İPTAL DİSPOZİSYONU (2026-08-06)
// -----------------------------------------------------------------------------
// Kapatmanın ALTI aksiyonundan farklı olarak iptalde ÜÇ karar vardır. Fark keyfî
// değil: iptal "bu iş emri hiç olmayacaktı" demektir, "üretildi" demez — depo /
// 2. kalite / devir seçenekleri kapatmanın kelimeleridir. Depoya alınacak bir mal
// varsa doğru yol KAPATMAK'tır (arayüz bunu `canSwitchToClose` ile söyler).

/** İptalde bir topa uygulanabilecek karar. */
export type CancelDisposition = "STOCK" | "SCRAP" | "CANCELLED";

/** İptal payload'ı — hiçbiri verilmezse davranış 2026-08-06 öncesiyle birebir aynı. */
export interface CancelWorkOrderInput {
  /** Yeni uçta ZORUNLU (min 3). Eski gövdesiz `DELETE /:id` bunu taşımaz. */
  reason?: string;
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

/** Manuel kapatma payload'ı. */
export interface CompleteWorkOrderInput {
  /** Dispozisyon varsa zorunlu (min 3 karakter) — audit'e yazılır. */
  reason?: string;
  /** Sebebin KATALOG KODU — yalnız CANCELLED dispozisyonunda anlamlı (`CancelWorkOrderInput`). */
  reasonCode?: string | null;
  dispositions?: CloseDispositionInput[];
  /** TRANSFER varsa: yeni iş emri siparişe bağlı kalsın mı ("keep") yoksa stok mu. */
  transferOrderMode?: "stock" | "keep";
}

const workOrderSplitService = new WorkOrderSplitService();
const workOrderManualMoveService = new WorkOrderManualMoveService();
const travelerCardService = new TravelerCardService();

/**
 * `quickStart` idempotent-replay dalları için partiyi ÇÖZ.
 *
 * Normal akışta parti `attachRolls`'un yanıtından gelir; replay'de attach hiç
 * koşmadığı için WO üzerinden okunur. Timeout sonrası tekrar denemede operatör
 * sonuç ekranını İLK KEZ görür — parti orada boş kalırsa özellik tam da en çok
 * gerektiği anda kaybolur.
 *
 * `mergedIntoId != null` olan parti TARİHÇEDİR (başka partiye katılmış), canlı
 * kimlik değildir → dışlanır. Hızlı İş Emri tek parti üretir; yine de en YENİsi
 * alınır ki elle bölünmüş/eklenmiş WO'da güncel olan dönsün.
 */
async function resolveQuickStartBatch(
  workOrderId: string,
): Promise<{ id: string; batchNumber: string } | null> {
  return prisma.batch.findFirst({
    where: { workOrderId, mergedIntoId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, batchNumber: true },
  });
}

/**
 * plannedStartDate / plannedEndDate default'ları:
 *   - Başlangıç verilmediyse şimdi.
 *   - Termin verilmediyse başlangıç + N gün (N tanımlardan
 *     `workorder.defaultPlanDurationDays`; yoksa 7).
 * CREATE ve full-update (replace) akışında çağrılır; partial header update
 * (updatePlanning) bu default'u UYGULAMAZ — operatör explicit null ile temizler.
 */
async function resolvePlanDates(
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

// Phase 1: WO açılış/iptali artık order status'a dokunmuyor. IN_PRODUCTION
// statü olarak kaldırıldı; "üretim sürüyor mu?" sorusu line.workOrderLinks
// üzerinden runtime hesabı.

export interface WorkOrderCreateInput {
  batchNumber?:       string | null;
  /** İdempotency anahtarı (UUID) — istemci form-oturumu başına üretir. Aynı
   *  token'la 2. çağrı (timeout sonrası tekrar) mevcut WO'yu cached döner;
   *  farklı payload ile gelirse 409 CLIENT_TOKEN_COLLISION. */
  clientToken?:       string | null;
  type?:              string;
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
  }[];
  /**
   * Tercih edilen: her satıra tahsis miktarı.
   * Eski API ile uyum için `orderLineIds` da kabul edilir (allocatedQty=0 olur).
   */
  orderLineAllocations?: { orderLineId: string; allocatedQty?: number }[];
  orderLineIds?: string[] | null;
}

// "Hedef özellik değiştir" geri-dönük yazımının dokunabileceği rulo durumları.
// Canlı üretim + depodaki satışa hazır mal. HARİÇ tutulanlar: SHIPPED (müşteride —
// geçmiş çarpıtılmamalı), SCRAP/CANCELLED (ölü), TAMBUR_CONSUMED/
// SUBCONTRACTOR_CONSUMED/KARTELA_CONSUMED (emekli/içi boş parent), AT_KARTELA
// (kartela firmasında, tükenecek). Önizleme (getTargetPropertyChangeImpact) ile
// mutasyon (updateTargetProperties) AYNI kümeyi kullanır → onay = gerçek kapsam.
const TARGET_PROP_FINISHED_STATUSES: RollStatus[] = [
  RollStatus.WAREHOUSE,
];
const TARGET_PROP_INPROD_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
  RollStatus.STOCK,
];
const TARGET_PROP_MUTABLE_STATUSES: RollStatus[] = [
  ...TARGET_PROP_FINISHED_STATUSES,
  ...TARGET_PROP_INPROD_STATUSES,
];

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

/**
 * Rota adımlarındaki istasyon/kategori/firma referanslarının var + aktif olduğunu
 * doğrular (soft-delete guard, SEC-3). create() ve replace() ortak kullanır —
 * pasife alınmış (isActive=false) kayıt DB FK kontrolünü geçer ama WorkOrderStep
 * emekli istasyona işaret etmemeli. Var-olmayan UUID zaten P2003→400 ile yakalanır.
 */
async function assertRouteRefsActive(
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

/**
 * L (düşük bulgu): WO'ya bağlanacak sipariş satırları için giriş guard'ı —
 * var olmayan satır ve İPTAL edilmiş siparişin satırı reddedilir (eskiden
 * iptal siparişe sessizce yeni üretim bağlanabiliyordu). create + replace ortak.
 */
function assertOrderLinesLinkable(
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
      `İptal edilmiş siparişe iş emri bağlanamaz: ${cancelled.join(", ")}`,
    );
  }
}

export class WorkOrderService {
  /**
   * Auto-generate an iş emri numarası (workOrderNumber): "IE" + GGAAYY + NNNN
   * (örn IE1207260001). Günlük sıra work_orders'taki mevcut maksimum +1.
   * (Parti no P… AYRI kimliktir — `batch.service.generateBatchNumberTx` üretir.)
   */
  async generateWorkOrderNumber(): Promise<string> {
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
          const todays = await prisma.workOrder.findMany({
            where: { workOrderNumber: { gte: prefix, startsWith: prefix } },
            select: { workOrderNumber: true, createdAt: true },
          });
          return todays.map((w) => ({ code: w.workOrderNumber, createdAt: w.createdAt }));
        },
        now,
      );

      const exists = await prisma.workOrder.findUnique({ where: { workOrderNumber: candidate } });
      if (!exists) return candidate;
    }

    throw AppError.internal("İş emri numarası üretilemedi, lütfen tekrar deneyin");
  }

  /**
   * Kullanıcının verdiği iş emri numarası (workOrderNumber) benzersiz mi? Değilse net
   * Türkçe hata fırlatır. excludeId verilirse o iş emrini hariç tutar (güncelleme).
   * DB @unique kısıtı backstop'tur; bu ön-kontrol generic P2002 yerine anlaşılır
   * mesaj verir (auto modda withBarcodeRetry'ın yanıltıcı "Barkod..." hatasını da önler).
   */
  private async assertWorkOrderNumberUnique(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await prisma.workOrder.findUnique({
      where: { workOrderNumber },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw AppError.conflict(`Bu iş emri numarası zaten kullanılıyor: ${workOrderNumber}`);
    }
  }

  /**
   * Verilen iş emri numarası (workOrderNumber) kullanılabilir mi? Form alanı blur'unda
   * canlı kontrol için — kaydetmeden önce "bu numara daha önce verilmiş mi"
   * uyarısı. excludeId verilirse o iş emrini hariç tutar (düzenleme modu kendi
   * kodunu çakışma saymaz). Boş kod = kullanılabilir (otomatik üretilecek).
   */
  async checkWorkOrderNumber(
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

  /**
   * Create a new Work Order.
   *
   * Kurallar:
   *   - routeTemplateId verilirse RouteStep'ler WorkOrderStep'e kopyalanır (copy-on-write snapshot).
   *     Bu durumda `steps` verilmemelidir; verilirse reddedilir.
   *   - routeTemplateId verilmezse `steps` zorunlu.
   *   - sipariş bağı (orderLineIds/orderLineAllocations) link-only; metraj taşımaz.
   *   - type=ORDER_PRODUCTION ise en az bir sipariş bağı zorunlu.
   *   - batchNumber (Parti Kodu) verilmezse otomatik üretilir (P+GGAAYY+NNNN);
   *     verilirse benzersizliği doğrulanır.
   */
  async create(
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
      if (!template.isActive) {
        throw AppError.badRequest("Pasif bir rota şablonu kullanılamaz");
      }
      if (template.steps.length === 0) {
        throw AppError.badRequest("Rota şablonunda adım yok");
      }

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
        };
      });
    } else {
      if (!data.steps || data.steps.length === 0) {
        throw AppError.badRequest(
          "Rota şablonu seçin veya özel rota adımları tanımlayın."
        );
      }
      finalSteps = data.steps.map((s) => ({
        stationId: s.stationId,
        notes:     s.notes ?? null,
        requiredCategoryId:     s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        dispatchWithoutColor:   s.dispatchWithoutColor ?? false,
      }));
    }

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
        "Siparişe özel üretim iş emri en az bir sipariş kalemine bağlanmalıdır."
      );
    }

    // ── Hedef ürün (targetItem) doğrulaması ─────────────────────────────────
    // STOCK_PRODUCTION: zorunlu — planlamacı ne üretiyoruz onu söylemeli.
    // ORDER_PRODUCTION: bağlı sipariş satırlarındaki ürün ile tutarlı olmalı.
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;

    if (type === "STOCK_PRODUCTION" && !resolvedTargetItemId) {
      throw AppError.badRequest(
        "Stoğa üretim iş emri için hedef ürün seçmelisiniz."
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
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor"
          );
        }
        resolvedTargetItemId = onlyItemId;
      } else if (distinctItems.size > 1 && !resolvedTargetItemId) {
        throw AppError.badRequest(
          "Sipariş satırları farklı ürünler içeriyor; hedef ürünü açıkça belirtin"
        );
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
        throw AppError.badRequest(
          "Sipariş satırları farklı renkler içeriyor; hedef rengi açıkça belirtin",
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
    let targetPropertyIds = [...new Set(data.targetPropertyIds ?? [])];
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
        await assertTargetablePropertyIds(targetPropertyIds, "iş emri hedef özelliği");

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

      if (resolvedTargetColorId || targetPropertyIds.length > 0) {
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
      if (targetPropertyIds.length > 0) {
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

    // Otomatik iş emri no sequence çakışırsa (P2002) tx'i baştan dene. Tx'in İLK ifadesi
    // kart kilidi: 8030 SHARED → FOR SHARE (eşzamanlı "Pasif'e geç" bu iş emrini görür).
    const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      if (resolvedTargetItemId) await assertItemUsableTx(tx, resolvedTargetItemId, woItemUsage);
      const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber());
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

      const wo = await tx.workOrder.create({
        data: {
          // Künye (Faz A2) — "iş emrini KİM AÇTI" bilgisi bugüne kadar HİÇ
          // yoktu; yalnız audit'ten okunabiliyordu ve audit 6 ayda arşivlenir.
          createdById: userId ?? null,
          updatedById: userId ?? null,
          workOrderNumber,
          clientToken:       data.clientToken ?? null,
          type,
          width:             data.width          ?? null,
          targetQuantity:    data.targetQuantity ?? null,
          targetWeight:      data.targetWeight ?? null,
          parameters:        (data.parameters as Prisma.InputJsonValue) ?? undefined,
          status:            WorkOrderStatus.PLANNED,
          plannedStartDate:  planDates.plannedStartDate,
          plannedEndDate:    planDates.plannedEndDate,
          routeTemplateId:   data.routeTemplateId   ?? null,
          targetItemId:      resolvedTargetItemId,
          targetColorId:     resolvedTargetColorId,
          foldType:          data.foldType          ?? null,
          steps: {
            create: finalSteps.map((step, index) => ({
              stationId:              step.stationId,
              stepSequence:           index + 1,
              notes:                  step.notes,
              requiredCategoryId:     step.requiredCategoryId ?? null,
              plannedSubcontractorId: step.plannedSubcontractorId ?? null,
              // "Fasona renksiz git" (2026-08-17 ekru kuralı). Bu satır 2026-08-25'e
              // kadar YOKTU: finalSteps alanı taşıyordu ama yazıma girmiyordu, yani
              // şablondan miras da form overlay'i de sessizce düşüyordu.
              dispatchWithoutColor:   step.dispatchWithoutColor ?? false,
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
        },
        include: {
          steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: {
            where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" },
            include: {
              orderLine: {
                include: {
                  order: { include: { customer: true } },
                  item: true,
                  color: true,
                },
              },
            },
          },
          routeTemplate: true,
        },
      });

      // Phase 1: WO açılışı order status'a dokunmuyor. "Üretim sürüyor mu?"
      // sorusu line.workOrderLinks üzerinden runtime hesabı.

      // Refakat kartı İŞ EMRİ açılışında doğar (İE başına tek kart, barkod = İE).
      // Parti (Batch) sonradan doğsa da yeni kart üretmez; kart hep bu WO'ya bağlı.
      // Kartsız WO olmaz → mobil fason sevkte ilk sevkten önce bile okutulabilir.
      await travelerCardService.createForWorkOrder(tx, wo.id, userId);

      return wo;
    }), undefined, (err) => {
      // İdempotent replay: clientToken P2002'si retry EDİLMEZ (retry hep aynı
      // token'ı yazar) — false ile propagate edilir, aşağıdaki catch cached
      // (idempotent retry) yanıtına çevirir.
      if (isClientTokenP2002(err)) return false;
      // F61: workOrderNumber P2002'si MANUEL modda retry EDİLMEZ (hep aynı numarayı
      // yazar) — doğrudan anlaşılır 409. (Auto modda taze numarayla retry edilir.)
      if (manualWorkOrderNumber && p2002Mentions(err, /workOrderNumber/i)) {
        throw AppError.conflict(`Bu iş emri numarası zaten kullanılıyor: ${manualWorkOrderNumber}`);
      }
      return true;
    }).catch(async (err) => ({
      replayOf: await this.resolveCreateTokenReplay(err, data.clientToken, type, resolvedTargetItemId),
    }));

    if ("replayOf" in workOrder) {
      // İlk commit refakat kartı dahil her şeyi yazdı; audit yalnız gerçek
      // create yolunda (inventory emsali — cached yol audit'i atlar).
      return {
        success: true,
        data: workOrder.replayOf,
        message: `İş emri zaten oluşturulmuş (idempotent retry): ${workOrder.replayOf.workOrderNumber}`,
        idempotentReplay: true,
      };
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: workOrder.id,
      newData: {
        workOrderNumber:    workOrder.workOrderNumber,
        type:               workOrder.type,
        width:              workOrder.width,
        status:             workOrder.status,
        stepCount:          finalSteps.length,
        routeTemplateId:    workOrder.routeTemplateId,
        allocationCount:    allocations.length,
        targetItemId:       workOrder.targetItemId,
        targetColorId:      workOrder.targetColorId,
        targetPropertyIds,
      },
    });

    return {
      success: true,
      data: workOrder,
      message: `İş emri oluşturuldu: ${workOrder.workOrderNumber}`,
      // Engel olmayan planlama notları (örn. "rotada renk veren adım yok").
      // `update` yolu bunu 2026-08-21'den beri döndürüyordu; oluşturma yolu
      // aynı durumu 400 ile reddettiği için hiç ihtiyaç duymamıştı.
      ...(routeWarnings.length > 0 ? { warnings: routeWarnings } : {}),
    };
  }

  /**
   * create() tx'i clientToken P2002 ile düştüyse idempotent replay çözümlemesi:
   * aynı token'lı mevcut WO'yu bulur; payload kimliği (type + targetItemId)
   * uyuşuyorsa onu döner (çağıran cached yanıt üretir). Uyuşmuyorsa veya WO
   * arşivliyse 409. Token replay'i değilse orijinal hata aynen fırlar.
   */
  private async resolveCreateTokenReplay(
    err: unknown,
    clientToken: string | null | undefined,
    type: WorkOrder["type"],
    targetItemId: string | null,
  ): Promise<WorkOrder> {
    if (!clientToken || !isClientTokenP2002(err)) throw err;
    const existing = await prisma.workOrder.findUnique({
      where: { clientToken },
      include: {
        steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
        orderLinks: {
          where: ACTIVE_ORDER_LINK,
          orderBy: { createdAt: "asc" },
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
                color: true,
              },
            },
          },
        },
        routeTemplate: true,
      },
    });
    if (!existing) throw err;
    if (!existing.isActive) {
      // quickStart zero-attach telafisi token'ı NULL'ladığından buraya pratikte
      // düşülmez (savunma guard'ı): arşivli WO'ya cached dönmek operatörü
      // "iş emri açık" sanrısına sokar.
      throw AppError.conflict(
        `Bu formun önceki denemesi arşivlenmiş (${existing.workOrderNumber}) — formu yenileyip tekrar deneyin.`,
      );
    }
    // Hafif payload-özdeşlik (F117 emsali): kimlik-kilit alanları uyuşmalı.
    if (existing.type === type && existing.targetItemId === targetItemId) {
      return existing;
    }
    throw AppError.conflict(
      `Bu form daha önce kaydedilmiş: ${existing.workOrderNumber}. Yeni iş emri için formu kapatıp yeniden açın.`,
      {
        code: "CLIENT_TOKEN_COLLISION",
        workOrderNumber: existing.workOrderNumber,
        existing: { id: existing.id, type: existing.type, targetItemId: existing.targetItemId },
        incoming: { type, targetItemId },
      },
    );
  }

  /**
   * Mobil "Hızlı İş Emri" — okutulan stok toplarından tek istekte WO başlatır.
   *
   * Akış:
   *   1) Barkodları ön-doğrula: hepsi var + STOCK + aynı ürün (kural: tek WO = tek
   *      kumaş). targetItemId verilmemişse topların ürününden türetilir (basit mod).
   *   2) create() ile WO oluştur (kendi tx'i + refakat kartı).
   *   3) attachRolls() ile bağla (kendi tx'i; STOCK → IN_PRODUCTION, ilk adım).
   *   4) Hiç top bağlanamazsa (örn. yarış koşulu) WO'yu arşivle — yetim WO bırakma.
   *
   * create/attachRolls kendi transaction'larını sahiplenir; aralarındaki pencere
   * aynı request içinde milisaniyeler olduğundan ön-doğrulama + telafi yaklaşımı,
   * iki metodu tek tx'e zorlayan riskli refactor'a tercih edildi.
   */
  async quickStart(
    data: WorkOrderCreateInput & { rollBarcodes: string[]; dispatchFirstStep?: boolean },
    userId?: string,
  ): Promise<
    ApiResponse<{
      workOrder: WorkOrder;
      attached: number;
      errors: string[];
      dispatch: { id: string; dispatchNo: string } | null;
      /** Topların bağlandığı PARTİ — İş Emri No ile AYRI kavram. Çözülemezse null. */
      batch: { id: string; batchNumber: string } | null;
    }>
  > {
    const { rollBarcodes, dispatchFirstStep, ...woInput } = data;
    // Okutulan kod DEPOLANMIŞ biçime çekilir (bkz. normalizeScanCode) — büyütme
    // TEKİLLEŞTİRMEDEN ÖNCE yapılır, yoksa "T1" ve "t1" iki ayrı kod sayılırdı.
    const barcodes = [...new Set(rollBarcodes.map(normalizeScanCode).filter(Boolean))];
    if (barcodes.length === 0) {
      throw AppError.badRequest("En az bir top barkodu okutmalısınız.");
    }

    // ── 0) İdempotent replay kısa-devresi ───────────────────────────────────
    // Bu clientToken'la WO zaten açılmışsa (manuel tekrar / timeout-replay), aşağıdaki
    // ön-doğrulamaya HİÇ girme: toplar İLK istekte bağlandığından artık IN_PRODUCTION
    // ve pre-validation yanlışlıkla "toplar envanterde değil" 400'ü atardı. Cached WO'yu
    // dön (create()'in idempotentReplay guard'ının pre-validation-öncesi ikizi).
    if (woInput.clientToken) {
      const existing = await prisma.workOrder.findUnique({
        where: { clientToken: woInput.clientToken },
        include: {
          steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: { where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" }, include: { orderLine: { include: { order: { include: { customer: true } }, item: true, color: true } } } },
          routeTemplate: true,
        },
      });
      if (existing && existing.isActive) {
        const attached = await prisma.roll.count({
          where: { barcode: { in: barcodes }, currentStep: { workOrderId: existing.id } },
        });
        return {
          success: true,
          data: {
            workOrder: existing,
            attached,
            errors: [],
            dispatch: null,
            batch: await resolveQuickStartBatch(existing.id),
          },
          message: `İş emri zaten başlatılmış (idempotent retry): ${existing.workOrderNumber}`,
        };
      }
    }

    // ── 1) Ön-doğrulama: var + STOCK + aynı ürün ────────────────────────────
    const rolls = await prisma.roll.findMany({
      where: { barcode: { in: barcodes } },
      select: {
        id: true, barcode: true, status: true, itemId: true, sackId: true, shipmentId: true,
        // Rota kapsaması muafiyeti için (bkz. create → assertRouteCoversTargets):
        // "mal zaten hedef renkte/özellikte mi". Okunmazsa muafiyet hiç doğmaz ve
        // sipariş bağlı + boyahanesiz rota yine 400 verir.
        colorId: true,
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } },
      },
    });
    const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

    const missing = barcodes.filter((b) => !byBarcode.has(b));
    if (missing.length > 0) {
      throw AppError.badRequest(`Şu barkodlar bulunamadı: ${missing.join(", ")}`);
    }

    // Envanterdeki serbest+satılabilir toplar (ham STOCK + depo WAREHOUSE/A1_STOCK) bağlanabilir.
    const attachable: RollStatus[] = [RollStatus.STOCK, RollStatus.WAREHOUSE, RollStatus.A1_STOCK];
    const notAttachable = rolls.filter((r) => !attachable.includes(r.status));
    if (notAttachable.length > 0) {
      throw AppError.badRequest(
        "Yalnız envanterdeki (stok/depo) toplar bağlanabilir. Uygun olmayan: " +
          notAttachable.map((r) => `${r.barcode} (${r.status})`).join(", "),
      );
    }
    const committed = rolls.filter((r) => r.sackId != null || r.shipmentId != null);
    if (committed.length > 0) {
      throw AppError.badRequest(
        "Bir çuvalda/sevkiyatta olan top üretime bağlanamaz — önce oradan çıkarın: " +
          committed.map((r) => r.barcode).join(", "),
      );
    }

    const itemIds = [...new Set(rolls.map((r) => r.itemId))];
    if (itemIds.length > 1) {
      throw AppError.badRequest(
        "Okutulan toplar farklı ürünlere ait. Tek iş emri tek kumaş içindir — aynı üründeki topları okutun.",
      );
    }
    const rollsItemId = itemIds[0];

    // type: explicit verilmemişse sipariş bağına göre türet.
    const hasOrderLink =
      (woInput.orderLineIds?.length ?? 0) > 0 ||
      (woInput.orderLineAllocations?.length ?? 0) > 0;
    const type =
      (woInput.type as WorkOrder["type"]) ??
      (hasOrderLink ? "ORDER_PRODUCTION" : "STOCK_PRODUCTION");

    // targetItemId: verilmemişse topların ürününden türet; verilmişse tutarlılık şart.
    let targetItemId = woInput.targetItemId ?? null;
    if (!targetItemId) {
      targetItemId = rollsItemId;
    } else if (targetItemId !== rollsItemId) {
      throw AppError.badRequest(
        "Okutulan topların ürünü, seçilen hedef ürün ile aynı değil.",
      );
    }

    // ── 2) WO oluştur ───────────────────────────────────────────────────────
    const createRes = await this.create({ ...woInput, type, targetItemId }, userId, {
      colorIds: rolls.map((r) => r.colorId),
      propertyIdSets: rolls.map((r) => r.properties.map((p) => p.propertyId)),
    });
    if (!createRes.success || !createRes.data) {
      throw AppError.badRequest(createRes.message ?? "İş emri oluşturulamadı.");
    }
    const workOrder = createRes.data;

    // İdempotent replay: create() cached WO döndüyse toplar İLK istekte bağlanmış
    // demektir — attach/telafi/dispatch TEKRARLANMAZ. (Devam edilseydi attach 0
    // dönerdi ve zero-attach telafisi GERÇEK WO'yu hardDelete ile arşivlerdi.)
    if (createRes.idempotentReplay) {
      const attached = await prisma.roll.count({
        where: { barcode: { in: barcodes }, currentStep: { workOrderId: workOrder.id } },
      });
      return {
        success: true,
        data: {
          workOrder,
          attached,
          errors: [],
          dispatch: null,
          batch: await resolveQuickStartBatch(workOrder.id),
        },
        message: `İş emri zaten başlatılmış (idempotent retry): ${workOrder.workOrderNumber}`,
      };
    }

    // ── 3) Topları bağla + 4) telafi (zero-attach → WO'yu arşivle) ──────────
    let attached = 0;
    let errors: string[] = [];
    // Parti, attachRolls'ta doğar (P+GGAAYY+NNNN). Eskiden yanıta konmuyordu ve
    // mobil sonuç ekranı parti yerine İŞ EMRİ numarasını basıyordu — iki kavram
    // ayrı (bkz. kök CLAUDE.md "İş Emri No ≠ Parti"), operatör kartta/lanede
    // parti arayınca bulamıyordu.
    let batch: { id: string; batchNumber: string } | null = null;
    // Telafi (zero-attach → WO'yu arşivle) başarısız OLURSA artık sessizce
    // yutulmuyor: telafi hardDelete patlarsa kullanıcıya "oluşturulmadı" denirken
    // canlı yetim PLANNED WO + ACTIVE refakat kartı kalır — bunu loglayıp iz bırak
    // (audit best-effort sayacı felsefesi; operatör/log yetim WO'yu görebilsin).
    const logOrphanCleanupFailure = (cleanupErr: unknown): void => {
      hata("quickStart", `telafi hardDelete başarısız — yetim WO kaldı (${workOrder.id}), manuel iptal gerekebilir:`,
        cleanupErr,
      );
    };

    try {
      const attachRes = await this.attachRolls(workOrder.id, barcodes, userId);
      attached = attachRes.data?.attached ?? 0;
      errors = attachRes.data?.errors ?? [];
      batch = attachRes.data?.batch ?? null;
    } catch (err) {
      await this.hardDelete(workOrder.id, userId).catch(logOrphanCleanupFailure);
      throw err;
    }

    if (attached === 0) {
      await this.hardDelete(workOrder.id, userId).catch(logOrphanCleanupFailure);
      throw AppError.conflict(
        `Hiçbir top bağlanamadı; iş emri oluşturulmadı. ${errors.join("; ")}`.trim(),
      );
    }

    // ── 5) Opsiyonel: ilk adım fason (EXTERNAL) ise otomatik fason sevki ──────
    // Hızlı iş emrinin amacı "iş emri aç + malı fasona gönder"i tek seferde yapmak.
    // dispatch() ayrı bir tx — patlarsa WO oluşmuş (PLANNED, toplar ilk adımda) kalır,
    // operatör manuel Fason Sevk'le tamamlar (kurtarılabilir kısmi başarı).
    let dispatch: { id: string; dispatchNo: string } | null = null;
    let dispatchWarning: string | null = null;
    if (dispatchFirstStep) {
      const firstStep = await prisma.workOrderStep.findFirst({
        where: { workOrderId: workOrder.id },
        orderBy: { stepSequence: "asc" },
        select: {
          id: true,
          plannedSubcontractorId: true,
          station: { select: { type: true } },
        },
      });
      if (firstStep && firstStep.station.type === "EXTERNAL") {
        if (!firstStep.plannedSubcontractorId) {
          dispatchWarning =
            "Fason firma planlanmadığı için otomatik sevk yapılamadı — Fason Sevk ekranından gönderin.";
        } else {
          const dispatchRollIds = (
            await prisma.roll.findMany({
              where: {
                currentStepId: firstStep.id,
                status: RollStatus.IN_PRODUCTION,
              },
              select: { id: true },
            })
          ).map((r) => r.id);
          if (dispatchRollIds.length === 0) {
            dispatchWarning =
              "İlk adıma bağlı top bulunamadığı için otomatik sevk yapılamadı.";
          } else {
            try {
              // dyehouseNote verilmez → dispatch() WO.dyehouseNote'u default alır.
              const dispRes = await new SubcontractorService().dispatch(
                {
                  workOrderId: workOrder.id,
                  stepId: firstStep.id,
                  subcontractorId: firstStep.plannedSubcontractorId,
                  rollIds: dispatchRollIds,
                },
                userId,
              );
              const d = dispRes.data as
                | { id?: string; dispatchNo?: string }
                | undefined;
              if (d?.id && d?.dispatchNo) {
                dispatch = { id: d.id, dispatchNo: d.dispatchNo };
              }
            } catch (err) {
              dispatchWarning =
                "İş emri oluştu ama otomatik fason sevki yapılamadı: " +
                (err instanceof Error ? err.message : "bilinmeyen hata") +
                " — Fason Sevk ekranından gönderebilirsiniz.";
            }
          }
        }
      }
    }

    return {
      success: true,
      data: { workOrder, attached, errors, dispatch, batch },
      message:
        `İş emri ${workOrder.workOrderNumber} başlatıldı — ${attached} top bağlandı` +
        (batch ? ` (Parti ${batch.batchNumber})` : "") +
        (errors.length ? `, ${errors.length} top bağlanamadı.` : ".") +
        (dispatch ? ` Fasona sevk edildi: ${dispatch.dispatchNo}.` : "") +
        (dispatchWarning ? ` ${dispatchWarning}` : ""),
      // `create`'in rota kapsaması uyarıları BURADAN GEÇMEK ZORUNDA — yoksa
      // tablet iş emrini açar ve "rotada renk veren adım yok" notu yolda kaybolur
      // (uyarıya çevirmenin tüm anlamı o notun görünmesiydi).
      ...(createRes.warnings?.length ? { warnings: createRes.warnings } : {}),
    };
  }

  /**
   * List work orders with dynamic filtering, sorting, pagination.
   *
   * Query param: `?withOrderDetail=true`
   *   - orderLinks → orderLine + order + customer + item + variant açar
   *   - targetItem (renk/özellikler dahil) join'lenir
   *   - Her WO'ya `dispatchedTotalQty` (iptal edilmemiş fason sevklerinin toplamı) eklenir
   *   - Mobil "Fason Sevk" iş emri picker'ı için tasarlanmıştır; web admin liste hala
   *     hafif projeksiyonla çalışır (geri uyumluluk).
   */
  async findAll(
    req: Request
  ): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, WO_SORTABLE_FIELDS);
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
    // (`orderLinks.some.orderLine.order.customerId`). Filtre kümesinden ÇIKARILIR: bu
    // serviste allowlist yok, `filter[customerId]` where'e sızıp 500 verirdi. CSV `in`.
    const customerCond = readIdCondition(params.filters.customerId);
    delete params.filters.customerId;
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
    applyDateRange(where, params, WORKORDER_DATE_FIELDS);
    if (hideCancelledWhere) Object.assign(where, hideCancelledWhere);
    if (customerCond) {
      // AND ile: aramanın `orderLinks.some` yolu OR içinde; üstteki `orderLinks` ezilmesin.
      // Prisma tipli sabit: revoke AST kapısı (§13c) ilişki süzgecini tipten çözüp aktif yüklemi arar.
      const byCustomer: Prisma.WorkOrderWhereInput = { orderLinks: { some: { ...ACTIVE_ORDER_LINK, orderLine: { order: { customerId: customerCond } } } } };
      const w = where as { AND?: Prisma.WorkOrderWhereInput[] };
      w.AND = [...(w.AND ?? []), byCustomer];
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
    const withOrderDetail = req.query.withOrderDetail === "true";

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
      steps: {
        select: {
          id: true,
          stepSequence: true,
          status: true,
          station: { select: { id: true, code: true, name: true, type: true } },
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
            orderLinks: { where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" }, select: { orderLineId: true, createdAt: true, orderLine: { select: { order: { select: WO_LIST_ORDER_CUSTOMER } } } } },
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
      const data = await this.withProductionMeters(hasMore ? items.slice(0, limit) : items);
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
    const data = await this.withProductionMeters(rawData);

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

  /**
   * WO ÜRETİM ÇIKTISI küme tanımı — liste (withProductionMeters) ve detay
   * (producedRolls) AYNI kümeyi kullanır (drift = iki ekranda farklı sayı).
   *
   * 2026-07-27 düzeltmesi: eski tanım `parent.entrySource=SUBCONTRACTOR_RETURN`
   * şartıyla YALNIZ fason-dönüşü açık kumaştan kesilen çocukları sayıyordu —
   * fasonsuz rota (stok top → KK1→KK2→Tambur) ve Tambur'suz biten rota
   * ("her rotanın son adımı final üretir": Kurşun/fason finalize) ÇIKAN=0
   * görünüyordu. Yeni küme iki daldan oluşur:
   *   a) Tambur birinci-nesil çocukları (entrySource=TAMBUR_SPLIT, bu WO'nun
   *      adımında doğmuş). AYNI WO içi re-cut torunları çift sayım nedeniyle
   *      hariç; ama BAŞKA WO'nun deposundan tüketilen TAMBUR_SPLIT parent'ın
   *      çocukları meşru çıktıdır (parent.producedInStepId kapsam şartı).
   *      Snapshot: sonradan TAMBUR_CONSUMED/CANCELLED olan çocuk listede kalır
   *      (detay rozet basar).
   *   b) Çocuğa bölünmeden nihai-ürün statüsüne ulaşan finalize çıktıları —
   *      rota Kurşun/QC2 veya fasonla bitti. Ara-tüketilenler
   *      (TAMBUR_CONSUMED/SUBCONTRACTOR_CONSUMED) ve canlı üretim bu dala giremez.
   */
  private producedOutputWhere(stepIds: string[]): Prisma.RollWhereInput {
    return {
      producedInStepId: { in: stepIds },
      OR: [
        {
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          NOT: {
            parent: {
              entrySource: RollEntrySource.TAMBUR_SPLIT,
              producedInStepId: { in: stepIds },
            },
          },
        },
        {
          entrySource: { not: RollEntrySource.TAMBUR_SPLIT },
          status: {
            in: [
              RollStatus.WAREHOUSE,
              RollStatus.A1_STOCK,
              RollStatus.SCRAP,
              RollStatus.SHIPPED,
              RollStatus.AT_KARTELA,
              RollStatus.KARTELA_CONSUMED,
            ],
          },
        },
      ],
    };
  }

  /**
   * Liste WO'larına ÜRETİLEN METRAJI ekler (ilerleme kolonu için). Detay
   * sayfasının `producedRolls.totalMeters` tanımıyla aynı küme
   * (`producedOutputWhere`); YALNIZ fire (katalogda `targetStatus=SCRAP`) olan
   * rulolar dışlanır — A1 (2. kalite) SATILABİLİR olduğu için SAYILIR; initialQty
   * toplamı. Tek groupBy ile sayfa başına 1 sorgu. Ayrıca üretime GİREN ham
   * metrajı ve bağlı SİPARİŞ TOPLAMINI (talep) ekler.
   */
  private async withProductionMeters<
    T extends {
      id: string;
      // `station` ve `orderLinks` OPSİYONEL: liste select'i ikisini de getirir ve
      // aşağıdaki rollup geçişleri onları BELLEKTEN okur (aynı satırı ikinci kez
      // sorgulamamak için). Gelmezlerse geçişler DB turuna düşer — davranış aynı.
      steps: { id: string; stepSequence: number; station?: { name: string } | null }[];
      orderLinks?: { orderLineId: string; orderLine?: { order?: { customer?: { id: string; name: string } | null } | null } | null }[];
    },
  >(
    wos: T[]
  ): Promise<
    (T & {
      producedMeters: number;
      inputMeters: number;
      orderedMeters: number;
      /** Bağlı siparişlerin DISTINCT müşterileri (ad sırası, ≤5) + toplam — liste "Müşteri" kolonu. */
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
        ...rollupWorkOrderCustomers(w.orderLinks),
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
    const producedRows = await prisma.roll.groupBy({
      by: ["producedInStepId"],
      where: {
        AND: [
          this.producedOutputWhere(stepIds),
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
      ...rollupWorkOrderCustomers(w.orderLinks),
    }));
  }

  /**
   * Get single work order by ID.
   */
  async findById(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        targetItem: true,
        targetColor: true,
        // Aktif süzgeç ŞART: panel prefill bu listeyi PUT replace'e echo eder — damgalı
        // hedef burada dönerse replace onu DİRİLTİR.
        targetProperties: { where: ACTIVE_TARGET_PROPERTY, include: { property: true } },
        steps: {
          include: {
            station: true,
            requiredCategory: true,
            plannedSubcontractor: true,
          },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          where: ACTIVE_ORDER_LINK,
          orderBy: { createdAt: "asc" },
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true, branch: { select: { id: true, name: true, code: true } } } },
                item: true,
                color: true,
                requiredProperties: { include: { property: true } },
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    // dispatchedTotalQty: iptal edilmemiş fason sevklerinin toplam metrajı
    // (detay panelinde "Sevk: X / Y mt · kaldı Z" gösterimi için)
    const dispatchSum = await prisma.subcontractorDispatch.aggregate({
      where: { workOrderId: id, cancelledAt: null },
      _sum: { totalQty: true },
    });
    const dispatchedTotalQty = dispatchSum._sum.totalQty ?? 0;

    // Adım bazlı anlık ürün özeti + WO geneli üretilen nihai toplar.
    // currentStepId = şu an o adımda fiziksel olarak bekleyen rulolar (ham/boyalı/açık kumaş).
    // producedInStepId + depo/sevk statüsü = WO'nun ürettiği nihai çıktı.
    const stepIds = wo.steps.map((s) => s.id);
    // Sevkin kendi talimatı boşsa düşülecek default: o adımın notu (per-step).
    const stepNotesById = new Map(wo.steps.map((s) => [s.id, s.notes]));
    // Meter alanları Prisma.Decimal — JS float drift'i önlemek için. Response
    // serializer (json-replacer) Decimal → number'a otomatik çevirir, frontend
    // her zaman number görür.
    const stepRollSummaries = new Map<
      string,
      {
        count: number;
        totalMeters: Prisma.Decimal;
        rawCount: number;
        rawMeters: Prisma.Decimal;
        dyedCount: number;
        dyedMeters: Prisma.Decimal;
        openFabricCount: number;
        openFabricMeters: Prisma.Decimal;
        // Durum kırılımı (masaüstü fason sevk aksiyonu gating'i için): adımda
        // fiziksel BEKLEYEN (sevke hazır) vs FASONDA (dışarıda) top ayrımı.
        // EXTERNAL adımda AT_SUBCONTRACTOR top da currentStepId=step taşır →
        // "count" ikisini birleştirir; bu iki alan ayırır.
        waitingCount: number;
        waitingMeters: Prisma.Decimal;
        atSubcontractorCount: number;
        atSubcontractorMeters: Prisma.Decimal;
      }
    >();
    /** Üretim çıktısının kategori bazlı kırılımı.
     *  Tambur tüm çıktıyı `status=WAREHOUSE` olarak yazar; ayrım `qualityGrade`
     *  üzerinden: "1.KALITE" → warehouse, "A1" → a1, "FIRE" → fire.
     *  Toplam top sayısı warehouse+a1+fire (kartela ayrı); toplam metraj
     *  warehouse+a1 (fire metre kaybı sayılmaz). */
    let producedRolls: {
      count: number;
      totalMeters: Prisma.Decimal;
      warehouse: { count: number; totalMeters: Prisma.Decimal };
      a1: { count: number; totalMeters: Prisma.Decimal };
      fire: { count: number; totalMeters: Prisma.Decimal };
      items: Array<{
        id: string;
        barcode: string | null;
        qualityGrade: string | null;
        /** Snapshot için production anındaki metraj (initialQty). */
        currentQty: Prisma.Decimal;
        /** Anlık durum — frontend re-cut/iptal rozetlerini buradan basar. */
        status: RollStatus;
        color: { code: string; name: string; hex: string | null } | null;
        createdAt: Date;
      }>;
    } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
      warehouse: { count: 0, totalMeters: new Prisma.Decimal(0) },
      a1: { count: 0, totalMeters: new Prisma.Decimal(0) },
      fire: { count: 0, totalMeters: new Prisma.Decimal(0) },
      items: [],
    };

    // Üretime giren ham toplar — WO'nun ilk adımına giren ayrık toplar (aşağıda
    // RollMovement üzerinden, stepIds hesaplandıktan sonra doldurulur).
    let inputRolls: { count: number; totalMeters: Prisma.Decimal } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
    };

    // Per-step individual roll listesi — detay panelinde "hangi parça kaç metre"
    // sorusunun cevabı. Aggregate ile aynı sorgudan dolduruyoruz, ek round-trip yok.
    const stepRolls = new Map<
      string,
      Array<{
        id: string;
        barcode: string | null;
        /** Anlık durum — UI: AT_SUBCONTRACTOR (fasonda) vs bekliyor ayrımı için. */
        status: RollStatus;
        currentQty: number;
        width: number | null;
        qualityGrade: string | null;
        kind: "raw" | "dyed" | "open";
        item: { id: string; code: string; name: string } | null;
        color: { id: string; code: string; name: string; hex: string | null } | null;
        /** Hangi partiye üye — "hangi top hangi partide" sorusu için (F: Rota&Dağılım). */
        batchNumber: string | null;
      }>
    >();
    // Per-step fason sevk bilgisi — plaka / sürücü / not detayı için.
    const stepDispatches = new Map<
      string,
      Array<{
        id: string;
        dispatchNo: string;
        dispatchedAt: string;
        totalQty: number;
        plateNumber: string | null;
        driverName: string | null;
        notes: string | null;
        instruction: string | null;
        /** Sevk edilen adımın notu (default) — sevkin kendi talimatı boşsa frontend buna düşer. */
        stepNote: string | null;
        subcontractor: { id: string; name: string };
        dispatchedBy: { id: string; fullName: string | null; username: string } | null;
        /** Bir sevk = bir parti (K10) — bu sevkte hangi partinin topları gitti. */
        batchNumber: string | null;
        /** Bu sevkte BİRLİKTE giden toplar (barkod+ürün+renk) — "hangi toplar birlikte gitti". */
        rolls: Array<{
          id: string;
          barcode: string | null;
          dispatchedQty: number;
          item: { name: string } | null;
          color: { name: string; hex: string | null } | null;
        }>;
      }>
    >();

    if (stepIds.length > 0) {
      const currentRolls = await prisma.roll.findMany({
        where: { currentStepId: { in: stepIds } },
        select: {
          id: true,
          barcode: true,
          currentStepId: true,
          status: true,
          colorId: true,
          parentReceiptId: true,
          currentQty: true,
          width: true,
          qualityGrade: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true, hex: true } },
          batch: { select: { batchNumber: true } },
        },
        orderBy: ROLL_DISPLAY_ORDER,
      });
      for (const r of currentRolls) {
        const key = r.currentStepId!;
        const s = stepRollSummaries.get(key) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
        };
        s.count += 1;
        s.totalMeters = s.totalMeters.plus(r.currentQty);
        // Durum kırılımı: AT_SUBCONTRACTOR = fasonda dışarıda; gerisi (IN_PRODUCTION/
        // STOCK) = bu adımda bekliyor, sevke hazır.
        if (r.status === RollStatus.AT_SUBCONTRACTOR) {
          s.atSubcontractorCount += 1;
          s.atSubcontractorMeters = s.atSubcontractorMeters.plus(r.currentQty);
        } else {
          s.waitingCount += 1;
          s.waitingMeters = s.waitingMeters.plus(r.currentQty);
        }
        let kind: "raw" | "dyed" | "open";
        if (r.parentReceiptId) {
          s.openFabricCount += 1;
          s.openFabricMeters = s.openFabricMeters.plus(r.currentQty);
          kind = "open";
        } else if (r.colorId == null) {
          s.rawCount += 1;
          s.rawMeters = s.rawMeters.plus(r.currentQty);
          kind = "raw";
        } else {
          s.dyedCount += 1;
          s.dyedMeters = s.dyedMeters.plus(r.currentQty);
          kind = "dyed";
        }
        stepRollSummaries.set(key, s);

        const list = stepRolls.get(key) ?? [];
        list.push({
          id: r.id,
          barcode: r.barcode,
          status: r.status,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade ?? "",
          kind,
          item: r.item,
          color: r.color,
          batchNumber: r.batch?.batchNumber ?? null,
        });
        stepRolls.set(key, list);
      }

      // Adım kapsamlı: dokuma sevkinin adımı yok — daraltma tip içindir, SQL aynı.
      const dispatches = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
        where: { stepId: { in: stepIds }, cancelledAt: null },
        select: {
          id: true,
          workOrderId: true,
          stepId: true,
          dispatchNo: true,
          dispatchedAt: true,
          totalQty: true,
          plateNumber: true,
          driverName: true,
          notes: true,
          instruction: true,
          subcontractor: { select: { id: true, name: true } },
          dispatchedBy: { select: { id: true, fullName: true, username: true } },
          batch: { select: { batchNumber: true } },
          // Bir sevk = bir parti (K10) — sevkte BİRLİKTE giden topların kimliği.
          items: {
            select: {
              dispatchedQty: true,
              roll: {
                select: {
                  id: true,
                  barcode: true,
                  item: { select: { name: true } },
                  color: { select: { name: true, hex: true } },
                },
              },
            },
          },
        },
        orderBy: { dispatchedAt: "desc" },
      }));
      for (const d of dispatches) {
        const list = stepDispatches.get(d.stepId) ?? [];
        list.push({
          id: d.id,
          dispatchNo: d.dispatchNo,
          dispatchedAt: d.dispatchedAt.toISOString(),
          totalQty: Number(d.totalQty),
          plateNumber: d.plateNumber,
          driverName: d.driverName,
          notes: d.notes,
          instruction: d.instruction,
          // Sevkin kendi talimatı boşsa, sevk edilen adımın notuna düşülür.
          stepNote: stepNotesById.get(d.stepId) ?? null,
          subcontractor: d.subcontractor,
          dispatchedBy: d.dispatchedBy,
          batchNumber: d.batch?.batchNumber ?? null,
          rolls: d.items.filter(hasRoll).map((it) => ({
            id: it.roll.id,
            barcode: it.roll.barcode,
            dispatchedQty: Number(it.dispatchedQty),
            item: it.roll.item,
            color: it.roll.color,
          })),
        });
        stepDispatches.set(d.stepId, list);
      }

      // Üretim çıktısı — SNAPSHOT: liste metriğiyle AYNI küme (producedOutputWhere;
      // Tambur birinci-nesil çocukları + Tambur'suz finalize çıktıları). Tambur
      // dalında status filtresi yok; sonradan re-cut'la TAMBUR_CONSUMED veya
      // CANCELLED olanlar listede kalır (rozetle işaretlenir). Metraj initialQty
      // (production anı), currentQty değil — re-cut sonrası sıfırlanmaz, snapshot sabit.
      const producedRollRows = await prisma.roll.findMany({
        where: this.producedOutputWhere(stepIds),
        select: {
          id: true,
          barcode: true,
          initialQty: true,
          status: true,
          qualityGrade: true,
          createdAt: true,
          color: { select: { code: true, name: true, hex: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      // Kova KATALOGDAN (`targetStatus`) çözülür — gömülü kod YOK (liste metriğiyle
      // AYNI kaynak). `totalMeters` = warehouse + a1: A1 satılabilir 2. kalitedir,
      // üretim çıktısı sayılır; yalnız FİRE (SCRAP hedefli kalite) dışarıda kalır.
      const detailBuckets = await loadProducedBuckets(prisma);
      for (const r of producedRollRows) {
        const bucket = producedRolls[detailBuckets.bucketOf(r.qualityGrade)];
        bucket.count += 1;
        bucket.totalMeters = bucket.totalMeters.plus(r.initialQty);
      }

      // Headline: tüm rulo çıktıları + üretilen sağlam metraj
      // (fire metresi hariç).
      producedRolls.count =
        producedRolls.warehouse.count +
        producedRolls.a1.count +
        producedRolls.fire.count;
      producedRolls.totalMeters = producedRolls.warehouse.totalMeters.plus(
        producedRolls.a1.totalMeters,
      );

      // Parça parça liste — snapshot. qty = initialQty (production anı), status
      // = mevcut durum (frontend "Bölündü"/"İptal" rozeti basabilsin).
      producedRolls.items = producedRollRows.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        qualityGrade: r.qualityGrade ?? "",
        currentQty: r.initialQty,
        status: r.status,
        color: r.color,
        createdAt: r.createdAt,
      }));

      // Üretime giren ham toplar — SPLIT (tebdil) WO dahil doğru. computeWoInput
      // "girdi kökü" tanımını kullanır (W dışından gelen üye toplar): normal WO'da
      // eskiyle AYNI (tek KK1/supplier kökü; fason-dönüş + Tambur çocuğu elenir),
      // split WO'da reEntry adımında doğan enjekte kökü de sayar (eskiden 0'dı).
      const wi = (await computeWoInput(prisma, [id])).get(id);
      inputRolls = {
        count: wi?.count ?? 0,
        totalMeters: wi?.meters ?? new Prisma.Decimal(0),
      };
    }

    const stepsWithRollSummary = wo.steps.map((step) => ({
      ...step,
      currentRolls:
        stepRollSummaries.get(step.id) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
        },
      currentRollList: stepRolls.get(step.id) ?? [],
      dispatches: stepDispatches.get(step.id) ?? [],
    }));

    // Düzenleme kilitleri — frontend formu bu bilgi ile input'ları disable
    // eder, kullanıcıya niye değiştirilemediğini gösterir.
    const locks = await computeWorkOrderLocks(prisma, id);

    return {
      success: true,
      data: {
        ...wo,
        steps: stepsWithRollSummary,
        dispatchedTotalQty,
        producedRolls,
        inputRolls,
        locks,
      },
    };
  }

  /**
   * Bir iş emrinin PARTİLERİ (Batch lane'leri) — "Dallar" panelinin yeni kaynağı.
   *
   * Her parti (Batch) bir lane'dir: üyesi topların ŞU ANKİ konum dağılımı (istasyon
   * adı / statü etiketi), aktif refakat kartı, fason sevk durumu (K10: bir sevk =
   * bir parti) ve soy bağı (splitFrom / splitChildren) tek bakışta görünür — "1.
   * parti Kurşun'da, 2. parti hâlâ boyahanede". Kilit TÜRETİLMİŞ (K14): fasonda
   * (AT_SUB) topu VEYA outstanding açık sevki olan parti kilitlidir; mal dönünce
   * kendiliğinden açılır. (Route uyumu için metod adı `getBranches` kaldı;
   * Electron `/branches` ucu Faz 6'da `/batches`'e döner — bkz. plan Faz 6.3.)
   */
  async getBranches(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        // Ayrılma soy bağı (WO seviyesi) — WO başka WO'nun partisinden ayrıldıysa
        // (redye NEW_COLOR / UNDYED_MOVE ile yeni WO'ya taşınma).
        splitFrom: { select: { id: true, workOrderNumber: true } },
        splitChildren: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            workOrderNumber: true,
            status: true,
            createdAt: true,
            targetColor: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    // Kart iş emri başına (tek) — tüm parti lane'leri aynı WO kartını gösterir.
    const woCard = await prisma.travelerCard.findFirst({
      where: { workOrderId, status: "ACTIVE" },
      // `contentDirty` = "basılı kart güncel değil" rozeti (WO detay başlığı).
      select: { cardNumber: true, barcode: true, contentDirty: true },
    });

    const batches = await prisma.batch.findMany({
      where: { workOrderId },
      // id tie-break: createdAt eşitliğinde (aynı tx'te doğan partiler) UI'nın
      // survivor önizlemesi ile mergeBatches'in gerçek survivor seçimi ayrışmasın.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        batchNumber: true,
        createdAt: true,
        splitFrom: { select: { id: true, batchNumber: true } },
        splitChildren: { select: { id: true, batchNumber: true } },
        // K17: bu parti bir survivor'a birleştiyse — lane'de "→ P… altına birleşti"
        // rozeti için (boş+merge'li kaynaklar rollCount=0 lane'i olarak döner).
        mergedInto: { select: { id: true, batchNumber: true } },
        // Parti üyesi toplar (tüketilmiş ara düğümler HARİÇ — çift sayım olmasın:
        // fason öncesi orijinaller CONSUMED, Tambur'da bölünen parent CONSUMED,
        // kartelaya bölünen parent KARTELA_CONSUMED). Küme tek kaynaktan (K18) —
        // elle liste kopyası KARTELA_CONSUMED'ı atlıyordu (lane'de hayalet top).
        rolls: {
          where: {
            status: { notIn: K18_DEAD_STATUSES },
          },
          orderBy: ROLL_DISPLAY_ORDER,
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            status: true,
            currentStep: { select: { station: { select: { name: true, type: true } } } },
            item: { select: { name: true } },
            color: { select: { name: true, hex: true } },
          },
        },
        // Partinin fason sevkleri (K10) — durum türetimi (açık/kısmi/döndü) için.
        dispatches: {
          orderBy: { dispatchedAt: "asc" },
          select: {
            id: true,
            dispatchNo: true,
            dispatchedAt: true,
            totalQty: true,
            cancelledAt: true,
            directShippedAt: true,
            directShipReason: true,
            step: { select: { stepSequence: true, station: { select: { name: true } } } },
            subcontractor: { select: { id: true, name: true } },
            items: {
              select: {
                // Kapanış metrajı: dönen kalemin sevk metresi (list-endpoint semantiği).
                dispatchedQty: true,
                // Aktarım çıktısı türetimi (K: "Aktarımı Geri Al" butonu): sevkin TÜM
                // topları born (parentReceiptId dolu) ise bu bir fason→fason aktarımdır.
                roll: { select: { parentReceiptId: true } },
                receiptItems: {
                  select: {
                    receipt: {
                      select: { id: true, receiptNo: true, receivedAt: true, cancelledAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Partiye ait FASONDAN SEVKLER (DSK): split çocuğu ya da tamamı sevk edilmiş orijinal
    // top directShipmentId taşır + batchId'yi korur → partiye bağlanır. Parti Geçmişi'nde
    // "Fasondan Sevkler" bölümü için (mal fasondan doğrudan müşteriye gitti).
    const batchIdList = batches.map((b) => b.id);
    const dsRolls = batchIdList.length
      ? await prisma.roll.findMany({
          where: { batchId: { in: batchIdList }, directShipmentId: { not: null } },
          select: {
            batchId: true,
            directShipment: {
              select: {
                id: true,
                shipmentNo: true,
                totalQty: true,
                rollCount: true,
                shippedAt: true,
                customer: { select: { name: true } },
              },
            },
          },
        })
      : [];
    type DsRow = NonNullable<(typeof dsRolls)[number]["directShipment"]>;
    const directShipsByBatch = new Map<string, Map<string, DsRow>>();
    for (const r of dsRolls) {
      if (!r.batchId || !r.directShipment) continue;
      const m = directShipsByBatch.get(r.batchId) ?? new Map<string, DsRow>();
      m.set(r.directShipment.id, r.directShipment);
      directShipsByBatch.set(r.batchId, m);
    }

    // Kapanış kolonu için sevk-başına FASONDAN SEVK metrajı (Σ DirectShipment.totalQty).
    // DirectShipment.dispatchId doğrudan FK → groupBy ile tek sorgu.
    const dispatchIdsAll = batches.flatMap((b) => b.dispatches.map((d) => d.id));
    const dsByDispatch = dispatchIdsAll.length
      ? await prisma.directShipment.groupBy({
          by: ["dispatchId"],
          where: { dispatchId: { in: dispatchIdsAll } },
          _sum: { totalQty: true },
        })
      : [];
    const directShippedByDispatch = new Map(
      dsByDispatch.map((g) => [g.dispatchId, Number(g._sum.totalQty ?? 0)]),
    );

    const statusLabel = (s: string): string =>
      s === "WAREHOUSE" ? "Depo" : s === "STOCK" ? "Stok" : "—";

    const lanes = batches.map((b) => {
      // Konum dağılımı: istasyon adı yoksa statü etiketi.
      const positions = new Map<
        string,
        { label: string; count: number; totalMeters: number }
      >();
      for (const r of b.rolls) {
        const label = r.currentStep?.station?.name ?? statusLabel(r.status);
        const cur = positions.get(label) ?? { label, count: 0, totalMeters: 0 };
        cur.count += 1;
        cur.totalMeters += Number(r.currentQty);
        positions.set(label, cur);
      }

      const dispatchViews = b.dispatches.map((d) => {
        const itemCount = d.items.length;
        const receivedItemCount = d.items.filter((it) =>
          it.receiptItems.some((ri) => ri.receipt && !ri.receipt.cancelledAt),
        ).length;
        // Aktarım çıktısı: tüm sevk topları born (parentReceiptId dolu) → geri alınabilir.
        const isTransferOutput =
          d.items.length > 0 && d.items.every((it) => it.roll?.parentReceiptId != null);
        let status: "OPEN" | "PARTIAL" | "RETURNED" | "CANCELLED" | "DIRECT_SHIPPED";
        if (d.cancelledAt) status = "CANCELLED";
        else if (d.directShippedAt) status = "DIRECT_SHIPPED";
        else if (receivedItemCount === 0) status = "OPEN";
        else if (receivedItemCount >= itemCount) status = "RETURNED";
        else status = "PARTIAL";

        const receiptMap = new Map<string, { receiptNo: string; receivedAt: Date }>();
        for (const it of d.items) {
          for (const ri of it.receiptItems) {
            const rcpt = ri.receipt;
            if (!rcpt || rcpt.cancelledAt) continue;
            if (!receiptMap.has(rcpt.id)) {
              receiptMap.set(rcpt.id, { receiptNo: rcpt.receiptNo, receivedAt: rcpt.receivedAt });
            }
          }
        }

        // Kapanış bakiyesi (metraj): Dönen = non-cancelled makbuzu olan kalemlerin sevk
        // metresi Σ; Fasondan = bu sevke atfedilmiş Σ DirectShipment.totalQty. Fasonda kalan
        // = totalQty − Dönen − Fasondan (frontend hesaplar).
        const returnedQty = d.items.reduce(
          (s, it) =>
            it.receiptItems.some((ri) => ri.receipt && !ri.receipt.cancelledAt)
              ? s + Number(it.dispatchedQty)
              : s,
          0,
        );
        const directShippedQty = directShippedByDispatch.get(d.id) ?? 0;

        return {
          dispatchId: d.id,
          dispatchNo: d.dispatchNo,
          stepName: d.step?.station?.name ?? null,
          stepSequence: d.step?.stepSequence ?? 0,
          // K15 onay-listesi gruplaması AD değil KİMLİK üzerinden yapılsın diye
          // (aynı istasyon adına iki fason adımı / ad çakışması yanlış "birleşecek"
          // beyanı üretirdi) — Electron batch-merge-confirm bunu anahtar yapar.
          subcontractorId: d.subcontractor.id,
          subcontractorName: d.subcontractor.name,
          dispatchedAt: d.dispatchedAt,
          totalQty: Number(d.totalQty),
          rollCount: itemCount,
          receivedItemCount,
          returnedQty,
          directShippedQty,
          status,
          isTransferOutput,
          directShippedAt: d.directShippedAt,
          directShipReason: d.directShipReason,
          receipts: [...receiptMap.values()],
        };
      });

      // Fasondan sevkler (DSK) — mal fasondan doğrudan müşteriye gitti; en yeni önce.
      const directShipments = [...(directShipsByBatch.get(b.id)?.values() ?? [])]
        .map((ds) => ({
          id: ds.id,
          shipmentNo: ds.shipmentNo,
          customerName: ds.customer?.name ?? null,
          totalQty: Number(ds.totalQty),
          rollCount: ds.rollCount,
          shippedAt: ds.shippedAt,
        }))
        .sort((a, c) => c.shippedAt.getTime() - a.shippedAt.getTime());

      // Kilit türetilmiş (K14, isBatchLockedTx ile aynı ÇİFT kural): partinin FASONDA
      // (AT_SUBCONTRACTOR) topu VEYA outstanding (OPEN/PARTIAL — dönmemiş kalemi olan)
      // açık sevki varsa kilitli — mal fiilen dışarıda. İkinci koşul "zombi sevk"
      // içindir: AT_SUB top detach edilirse roll-koşulu söner ama açık sevk kalır;
      // kilit sürmeli. Mal dönünce iki koşul da söner → kilit kendiliğinden açılır;
      // DIRECT_SHIPPED sevk kilit saymaz (toplar SHIPPED, dönmeyecek).
      const locked =
        b.rolls.some((r) => r.status === "AT_SUBCONTRACTOR") ||
        dispatchViews.some((d) => d.status === "OPEN" || d.status === "PARTIAL");
      const card = woCard;
      // Fasona sevk bekliyor: parti topları bir FASON (EXTERNAL) adımında ÜRETİMDE ama
      // henüz sevk edilmemiş (redye geri-sarımı ya da ilk sevk öncesi). Panelde
      // "boyahaneye gönder" ipucu için — sahadan Fason Sevk yapılmalı.
      const awaitingFasonDispatch = b.rolls.some(
        (r) => r.status === "IN_PRODUCTION" && r.currentStep?.station?.type === "EXTERNAL",
      );

      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        createdAt: b.createdAt,
        locked,
        awaitingFasonDispatch,
        cardNumber: card?.cardNumber ?? null,
        cardBarcode: card?.barcode ?? null,
        rollCount: b.rolls.length,
        directShipments,
        currentPositions: [...positions.values()],
        // "Hangi partide hangi top var" — count'un ötesinde tek tek kimlik (F: Partiler).
        rolls: b.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          status: r.status,
          currentQty: Number(r.currentQty),
          positionLabel: r.currentStep?.station?.name ?? statusLabel(r.status),
          item: r.item,
          color: r.color,
        })),
        dispatches: dispatchViews,
        splitFrom: b.splitFrom,
        splitChildren: b.splitChildren,
        // K17 (additive): { id, batchNumber } | null — dolu ise bu lane birleşmiş
        // kaynak partidir (Electron Faz 4 rozeti).
        mergedInto: b.mergedInto,
      };
    });

    return {
      success: true,
      data: {
        batches: lanes,
        // WO-seviyesi ayrılma bağı (redye ile yeni WO'ya taşınan/gelen partiler).
        splitFrom: wo.splitFrom,
        splitChildren: wo.splitChildren.map((c) => ({
          id: c.id,
          workOrderNumber: c.workOrderNumber,
          status: c.status,
          createdAt: c.createdAt,
          targetColor: c.targetColor,
        })),
      },
    };
  }

  /**
   * Parti rota-zaman çizelgesi (birleşik geçmiş) — partinin TÜM toplarının hareket
   * (RollMovement: adım giriş/çıkış) ve operasyon (RollOperation: kurşun/QC2/tambur/
   * fason) log'unu ADIMA göre toplar. Performans: per-top `/rolls/:id/history` yerine
   * TEK istek + toplu (in-list) sorgu (1 round-trip). Tambur-split kopya operasyonları
   * (inheritedFromParentRollId) hariç → çift sayım yok.
   */
  async getBatchTimeline(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, workOrderId },
      select: { id: true, batchNumber: true },
    });
    if (!batch) {
      return { success: false, data: null, message: "Parti bulunamadı" };
    }

    // Fasondan-sevk split ÇOCUKLARINI dışla: kısmi doğrudan sevkte orijinal top bölünür,
    // sevk edilen parça yeni bir çocuk roll olur (parentRollId + directShipmentId dolu),
    // batchId'yi miras alır ve fason adımında bir RollMovement yaratır. Bunlar sevk için
    // kesilen efemer parçalardır (FASON SEVKLER / Sevkiyatlar'da izlenir), partinin gerçek
    // üyesi/adım sakini DEĞİL — sayılırsa adım "3 top" gibi şişer (aslında 1 top duruyor).
    const rolls = await prisma.roll.findMany({
      where: { batchId },
      select: { id: true, parentRollId: true, directShipmentId: true },
    });
    const rollIds = rolls
      .filter((r) => !(r.parentRollId != null && r.directShipmentId != null))
      .map((r) => r.id);

    const [steps, movements, operations] = await Promise.all([
      prisma.workOrderStep.findMany({
        where: { workOrderId },
        orderBy: { stepSequence: "asc" },
        select: { id: true, stepSequence: true, station: { select: { name: true, type: true } } },
      }),
      prisma.rollMovement.findMany({
        where: { ...ACTIVE_MOVEMENT, rollId: { in: rollIds } },
        select: { workOrderStepId: true, rollId: true, enteredAt: true, exitedAt: true },
      }),
      prisma.rollOperation.findMany({
        where: { ...ACTIVE_OPERATION, ...OWN_OPERATION, rollId: { in: rollIds } },
        select: {
          workOrderStepId: true,
          operationType: true,
          createdAt: true,
          operator: { select: { fullName: true, username: true } },
        },
      }),
    ]);

    const timelineSteps = steps.map((s) => {
      const stepMovements = movements.filter((m) => m.workOrderStepId === s.id);
      const stepOps = operations.filter((o) => o.workOrderStepId === s.id);
      const enteredTimes = stepMovements.map((m) => m.enteredAt.getTime());
      const exitedMovements = stepMovements.filter((m) => m.exitedAt != null);
      const allExited = stepMovements.length > 0 && exitedMovements.length === stepMovements.length;

      const opMap = new Map<
        string,
        { type: string; count: number; lastAt: Date; operators: Set<string> }
      >();
      for (const o of stepOps) {
        const cur =
          opMap.get(o.operationType) ??
          { type: o.operationType, count: 0, lastAt: o.createdAt, operators: new Set<string>() };
        cur.count += 1;
        if (o.createdAt > cur.lastAt) cur.lastAt = o.createdAt;
        const name = o.operator?.fullName ?? o.operator?.username;
        if (name) cur.operators.add(name);
        opMap.set(o.operationType, cur);
      }

      return {
        stepId: s.id,
        stepSequence: s.stepSequence,
        stationName: s.station?.name ?? "—",
        stationType: s.station?.type ?? null,
        visited: stepMovements.length > 0,
        rollCount: new Set(stepMovements.map((m) => m.rollId)).size,
        enteredAt: enteredTimes.length ? new Date(Math.min(...enteredTimes)) : null,
        exitedAt:
          allExited && exitedMovements.length
            ? new Date(Math.max(...exitedMovements.map((m) => m.exitedAt!.getTime())))
            : null,
        operations: [...opMap.values()].map((o) => ({
          type: o.type,
          count: o.count,
          lastAt: o.lastAt,
          operators: [...o.operators],
        })),
      };
    });

    return {
      success: true,
      data: {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        rollCount: rollIds.length,
        steps: timelineSteps,
      },
    };
  }

  // ===========================================================================
  // PARTİYİ AYIR (redye üç yolu) — workorder-split.service.ts'e delege.
  // REDYE_SAME_COLOR uygulandı; NEW_COLOR/UNDYED_MOVE (WO klonlu) sonraki iterasyon.
  // ===========================================================================

  /** Parti ayırma ÖNİZLEMESİ (izinli modlar + taşınacak toplar). */
  async getSplitPreview(
    workOrderId: string,
    batchId: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.getSplitPreview(workOrderId, batchId);
  }

  /** Partiyi ayır: REDYE_SAME_COLOR (aynı renk yeniden boyama) / NEW_COLOR / UNDYED_MOVE. */
  async splitBranch(
    workOrderId: string,
    data: {
      batchId: string;
      mode: "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";
      newColorId?: string | null;
      orderMode?: "stock" | "keep";
      rollIds?: string[];
      /**
       * Tebdil sebebi (opsiyonel) — audit'e/parti kaydına yazılır.
       * Bu ince cephe (facade) tipi `reason`'ı TAŞIMIYORDU: hem controller'ın Zod
       * şeması hem de asıl `workOrderSplitService.splitBranch` onu kabul edip
       * DB'ye yazdığı için HTTP yolu doğru çalışıyor, yalnız doğrudan TS
       * çağrıcıları (testler) "fazla alan" hatası alıyordu. Tip driftiydi.
       */
      reason?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.splitBranch(workOrderId, data, userId);
  }

  /** Manuel konum düzeltme önizlemesi (süpervizör override) — hiçbir şeyi değiştirmez. */
  async getManualMovePreview(
    workOrderId: string,
    input: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.getManualMovePreview(workOrderId, input);
  }

  /** Parti/top bazında rotada manuel taşıma (süpervizör override). */
  async manualMove(
    workOrderId: string,
    input: {
      batchId?: string;
      rollIds?: string[];
      targetStepId: string;
      partyMode?: PartyMode;
      joinBatchId?: string;
      reason: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.manualMove(workOrderId, input, userId);
  }

  /** Parti düşürme önizlemesi — bkz. `workorder-batch-drop.service.ts`. */
  async getBatchDropPreview(workOrderId: string, batchId: string) {
    return workOrderBatchDropService.getDropPreview(workOrderId, batchId);
  }

  /** Partiyi iş emrinden düşür — iş emri diğer partileriyle DEVAM eder. */
  async dropBatch(
    workOrderId: string,
    batchId: string,
    input: BatchDropInput,
    userId?: string,
  ) {
    return workOrderBatchDropService.dropBatch(workOrderId, batchId, input, userId);
  }

  /**
   * İptal etkisini ÖNİZLER (yıkıcı işlem onayı için). Hiçbir şeyi değiştirmez.
   * Döner: STOCK'a çekilecek toplar + VOID olacak ACTIVE refakat kartı sayısı.
   */
  async getCancelImpact(id: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true } } },
    });
    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    const stepIds = wo.steps.map((s) => s.id);
    // Ölü top (iptal/tüketilmiş) önizlemeye GİRMEZ: iptal ona dokunmaz (softDelete
    // yalnız IN_PRODUCTION'ı çeker) ve aşağıdaki parti kırılımı zaten K18 ile süzüyor
    // — iki bölüm ayrışmasın. Ölçüldü 2026-09-14 (fabrika kopyası): 67 açık WO'nun
    // listesinde ölü satır vardı, 3'ünün "işlenmiş" sayısı değişir.
    const rollWhere = {
      OR: [
        { producedInStepId: { in: stepIds } },
        { currentStepId: { in: stepIds } },
      ],
      status: { notIn: K18_DEAD_STATUSES },
    };
    // M-11: liste 200 ile sınırlı (UI) ama SAYILAR limitsiz count'tan gelir —
    // 200+ toplu WO'da onay ekranı eksik sayı göstermesin; truncated bayrağı
    // UI'a "tamamı bu kadar değil" der.
    const totalRollCount =
      stepIds.length > 0 ? await prisma.roll.count({ where: rollWhere }) : 0;
    const rolls =
      stepIds.length > 0
        ? await prisma.roll.findMany({
            where: rollWhere,
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              colorId: true,
              currentStepId: true,
              entrySource: true,
              batchId: true,
              color: { select: { name: true, hex: true } },
              // İstasyon adı: iptal ekranı topları istasyona göre gruplar (düz liste
              // 50 topta okunmuyor). Parti kimliği kapsam seçici için.
              currentStep: { select: { station: { select: { name: true } } } },
              batch: { select: { batchNumber: true } },
              _count: { select: { properties: { where: ACTIVE_ROLL_PROPERTY } } },
            },
            take: 200,
            orderBy: { createdAt: "asc" },
          })
        : [];
    const travelerCardCount = await prisma.travelerCard.count({
      where: { workOrderId: id, status: "ACTIVE" },
    });

    // Fasonda (boyahanede) işlem gören/görmüş in-flight top sayısı — varsa iptal
    // bloklanır (fason malı ham stoğa dönemez). softDelete'teki guard ile aynı.
    const fasonInFlightCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [
                {
                  OR: [
                    { currentStepId: { in: stepIds } },
                    { producedInStepId: { in: stepIds } },
                  ],
                },
                {
                  OR: [
                    { status: RollStatus.AT_SUBCONTRACTOR },
                    { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                    {
                      status: RollStatus.IN_PRODUCTION,
                      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
                    },
                  ],
                },
              ],
            },
          })
        : 0;

    // Her top için: ham mı işlenmiş mi (boyalı/özellikli/fason-dönüşü) + hâlâ
    // fasonda mı + İPTALDE GERÇEKTEN STOCK'A DÖNECEK Mİ (M-11: softDelete'in
    // mutasyon predicate'iyle birebir aynı koşul — onay ekranı değişmeyecek
    // depo/bitmiş topları "etkilenecek" gibi göstermesin).
    const stepIdSet = new Set(stepIds);
    const mappedRolls = rolls.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      // `Number()` — kardeş yüzeylerle (getCompletePreview, getBranches) aynı.
      // Ham `Decimal` JSON'a STRING olarak çıkıyordu ve istemci tipi `number`
      // diyordu; kırılma üretmiyordu (Intl string'i sayıya çeviriyor) ama
      // sıralama/aritmetik ekleyen ilk kişiyi sessizce yanıltırdı.
      currentQty: Number(r.currentQty),
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      propertyCount: r._count.properties,
      processed:
        Boolean(r.colorId) ||
        r._count.properties > 0 ||
        String(r.entrySource) === "SUBCONTRACTOR_RETURN" ||
        r.status === RollStatus.AT_SUBCONTRACTOR ||
        r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR,
      atSubcontractor: r.status === RollStatus.AT_SUBCONTRACTOR,
      willRevertToStock:
        r.currentStepId !== null &&
        stepIdSet.has(r.currentStepId) &&
        r.status === RollStatus.IN_PRODUCTION &&
        String(r.entrySource) !== "SUBCONTRACTOR_RETURN",
      stationName: r.currentStep?.station?.name ?? null,
      batchId: r.batchId,
      batchNumber: r.batch?.batchNumber ?? null,
      /** Fason dönüşü mal ham stoğa DÖNEMEZ — arayüz seçeneği kilitler. */
      canReturnToStock: String(r.entrySource) !== "SUBCONTRACTOR_RETURN",
      /** Karar verilebilir mi (yalnız işlemdeki toplar). */
      decidable:
        r.currentStepId !== null &&
        stepIdSet.has(r.currentStepId) &&
        r.status === RollStatus.IN_PRODUCTION,
    }));
    // Sayılar LİMİTSİZ count'lardan (liste 200 ile kırpılı olabilir).
    const atSubcontractorCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: { AND: [rollWhere, { status: RollStatus.AT_SUBCONTRACTOR }] },
          })
        : 0;
    const processedCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [
                rollWhere,
                {
                  OR: [
                    { colorId: { not: null } },
                    { properties: { some: ACTIVE_ROLL_PROPERTY } },
                    { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
                    { status: RollStatus.AT_SUBCONTRACTOR },
                    { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                  ],
                },
              ],
            },
          })
        : 0;

    // ── AÇIK FASON SEVKLERİ ───────────────────────────────────────────────────
    // Fason bloğunun ÇÖZÜM YOLU bu listedir: kullanıcı parti parti gezmek yerine
    // buradan toplu iptal eder ve mal içeri döner. Her satır kendi iptal
    // edilebilirliğini TEK KAYNAKTAN (`resolveDispatchCancelBlockReason`) taşır —
    // ekran "iptal edilebilir" derken ucun 409 vermesi bu sayede imkânsız.
    const openDispatchRows =
      stepIds.length > 0
        ? await prisma.subcontractorDispatch.findMany({
            where: { stepId: { in: stepIds }, cancelledAt: null, directShippedAt: null },
            select: {
              id: true,
              dispatchNo: true,
              dispatchedAt: true,
              totalQty: true,
              stepId: true,
              subcontractor: { select: { name: true } },
              batch: { select: { id: true, batchNumber: true } },
              step: { select: { stepSequence: true, station: { select: { name: true } } } },
              items: { select: { rollId: true } },
              // Kısmi/alt küme doğrudan sevkin TEK izi (damga basılmaz) — iptal
              // edilebilirlik yüklemi bunu okur.
              directShipments: { select: { shipmentNo: true }, take: 1 },
              _count: { select: { items: true } },
            },
            orderBy: { dispatchedAt: "asc" },
          })
        : [];

    // Kabul izi ve "sevkten sonra taşınmış top" bilgisi toplu okunur (sevk başına
    // ayrı sorgu, tipik 1-3 sevkte gereksiz tur demekti).
    const openDispatchIds = openDispatchRows.map((d) => d.id);
    const activeReceiptRows = openDispatchIds.length
      ? await prisma.subcontractorReceiptItem.findMany({
          where: {
            sourceDispatchItem: { is: { dispatchId: { in: openDispatchIds } } },
            receipt: { cancelledAt: null },
          },
          select: {
            sourceDispatchItem: { select: { dispatchId: true } },
            receipt: { select: { receiptNo: true } },
          },
        })
      : [];
    const receiptNoByDispatch = new Map<string, string>();
    for (const r of activeReceiptRows) {
      const did = r.sourceDispatchItem?.dispatchId;
      if (did && !receiptNoByDispatch.has(did)) {
        receiptNoByDispatch.set(did, r.receipt.receiptNo);
      }
    }
    const dispatchRollIds = openDispatchRows.flatMap((d) => d.items.filter(isRollItem).map((i) => i.rollId));
    // "Taşınmış" tanımı SEVKE GÖREDİR (`cancel`'ın guard'ıyla aynı): top ya artık
    // AT_SUBCONTRACTOR değildir ya da o sevkin adımında değildir. Tek bir global
    // koşulla süzmek ikinci şartı kaybederdi.
    const dispatchRollRows = dispatchRollIds.length
      ? await prisma.roll.findMany({
          where: { id: { in: dispatchRollIds } },
          select: { id: true, currentStepId: true, status: true },
        })
      : [];
    const rollStateById = new Map(dispatchRollRows.map((r) => [r.id, r]));

    const openDispatches = openDispatchRows.map((d) => {
      // "Taşınmış" TOP kalemine bakar — levent kalemi (F1) top okumaz, iptal engeli levent dönüşünde ayrı sinyaldir.
      const movedCount = d.items.filter(isRollItem).filter((i) => {
        const st = rollStateById.get(i.rollId);
        if (!st) return true; // top okunamıyorsa güvenli taraf: "değişmiş" say
        return st.status !== RollStatus.AT_SUBCONTRACTOR || st.currentStepId !== d.stepId;
      }).length;
      const dispatchBlock = resolveDispatchCancelBlockReason({
        cancelledAt: null,
        directShipmentNo: d.directShipments[0]?.shipmentNo ?? null,
        activeReceiptNo: receiptNoByDispatch.get(d.id) ?? null,
        movedRollCount: movedCount,
      });
      return {
        dispatchId: d.id,
        dispatchNo: d.dispatchNo,
        dispatchedAt: d.dispatchedAt,
        subcontractorName: d.subcontractor?.name ?? "—",
        stationName: d.step?.station?.name ?? "—",
        stepSequence: d.step?.stepSequence ?? 0,
        batchId: d.batch?.id ?? null,
        batchNumber: d.batch?.batchNumber ?? null,
        rollCount: d._count.items,
        totalQty: Number(d.totalQty ?? 0),
        cancellable: dispatchBlock === null,
        blockReason: dispatchBlock,
      };
    });

    // ── PARTİ KIRILIMI ────────────────────────────────────────────────────────
    // ⚠️ AGGREGATE'ten üretilir, yukarıdaki 200 ile KIRPILMIŞ `rolls` dizisinden
    // DEĞİL. JS'te gruplamak cazip ama tam da dialogun en çok işe yaradığı büyük
    // iş emirlerinde sessizce yanlış sayı basar.
    const batchGroups =
      stepIds.length > 0
        ? await prisma.roll.groupBy({
            by: ["batchId"],
            where: {
              batch: { workOrderId: id },
              status: { notIn: K18_DEAD_STATUSES },
            },
            _count: { _all: true },
            _sum: { currentQty: true },
          })
        : [];
    const batchRows = await prisma.batch.findMany({
      where: { workOrderId: id },
      select: {
        id: true,
        batchNumber: true,
        createdAt: true,
        mergedInto: { select: { batchNumber: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const groupByBatch = new Map(batchGroups.map((g) => [g.batchId ?? "", g]));
    const lockedBatchIds = new Set(
      openDispatches.filter((d) => d.batchId).map((d) => d.batchId as string),
    );
    const atSubBatchRows =
      stepIds.length > 0
        ? await prisma.roll.groupBy({
            by: ["batchId"],
            where: { batch: { workOrderId: id }, status: RollStatus.AT_SUBCONTRACTOR },
            _count: { _all: true },
          })
        : [];
    for (const r of atSubBatchRows) if (r.batchId) lockedBatchIds.add(r.batchId);

    const batches = batchRows.map((b) => {
      const g = groupByBatch.get(b.id);
      const liveRollCount = g?._count._all ?? 0;
      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        liveRollCount,
        meters: Number(g?._sum.currentQty ?? 0),
        locked: lockedBatchIds.has(b.id),
        mergedIntoBatchNumber: b.mergedInto?.batchNumber ?? null,
      };
    });

    let blockReason: string | null = null;
    if (wo.status === WorkOrderStatus.CANCELLED) {
      blockReason = "İş emri zaten iptal edilmiş.";
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = "Devredilmiş iş emri iptal edilemez (malzemesi yeni iş emrine taşındı).";
    } else if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = "Tamamlanmış iş emri iptal edilemez.";
    }
    // ⚠️ FASON ARTIK ENGEL DEĞİL (2026-08-17). Eskiden burada `blockReason`
    // yazılıyordu ve kullanıcının çıkışı yoktu ("iptal etmek çok zor" şikâyeti).
    // Artık iptal MÜMKÜN; yalnız fasondaki mal için karar sorulur. Arayüz bunu
    // `fasonInFlightCount > 0` ile anlar ve İKİ DÜĞME çizer:
    // "ham stoğa al" / "fire yaz". Karar `POST /:id/cancel` gövdesinde
    // `fasonAction` olarak gider.

    // ── FASON BLOĞUNUN KIRILIMI ───────────────────────────────────────────────
    // İki tür fason engeli aynı cümleye sığdırılınca kullanıcı ne yapacağını
    // bilemiyor. Ayrımı yapan şey basit: mal HÂLÂ dışarıdaysa sevk iptaliyle
    // içeri gelir; mal DÖNDÜYSE (boyanmış) iptal yolu tanım gereği kapalıdır ve
    // doğru araç KAPATMA'dır.
    const returnedCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [rollWhere, { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR }],
            },
          })
        : 0;
    const returnInProductionCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [
                rollWhere,
                {
                  status: RollStatus.IN_PRODUCTION,
                  entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
                },
              ],
            },
          })
        : 0;

    // ── "İPTAL EDİLEMEZ AMA KAPATILABİLİR" ÇIKIŞI ─────────────────────────────
    // Kapatmanın kurallarını KOPYALAMAZ, aynı modüldeki sabitleri KULLANIR —
    // kopyalansaydı kapatma bir gün değiştiğinde ikisi sessizce ayrışırdı.
    const closeBlockedRolls =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: { currentStepId: { in: stepIds }, status: { in: CLOSE_BLOCKED_STATUSES } },
          })
        : 0;
    const inFlightForClose =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: { currentStepId: { in: stepIds }, status: { in: CLOSE_IN_FLIGHT_STATUSES } },
          })
        : 0;
    const closeOpenDispatchItems =
      stepIds.length > 0
        ? await prisma.subcontractorDispatchItem.count({
            where: {
              dispatch: { cancelledAt: null },
              roll: { currentStepId: { in: stepIds }, status: { in: CLOSE_IN_FLIGHT_STATUSES } },
            },
          })
        : 0;
    const canSwitchToClose =
      blockReason !== null &&
      wo.status === WorkOrderStatus.IN_PROGRESS &&
      closeBlockedRolls === 0 &&
      closeOpenDispatchItems === 0 &&
      inFlightForClose <= CLOSE_DISPOSITION_MAX_ROLLS;

    // Kısmi kabul edilmiş (kapatılamayan) sevk kalemleri: iptal bunları
    // `cancelBulk` ile kapatamaz ve operatörden karar ister.
    const fasonRemainders = await prisma.subcontractorDispatchItem.findMany({
      // ⚠️ `AND` ŞART, spread DEĞİL: `outstandingItemOfOpenDispatch` kendi
      // `receiptItems: { none: … }` koşulunu taşır ve aynı anahtarı ikinci kez
      // yazmak onu EZİYORDU → tamamen dönmüş kalemler de "fasonda kalan" sayılıp
      // iptal diyaloğunda gereksiz fire onayı istiyordu.
      where: {
        AND: [
          outstandingItemOfOpenDispatch({ workOrderId: id }),
          // Yalnız kabulü BAŞLAMIŞ olanlar: kabulsüz sevk `cancelBulk` ile
          // sorunsuz kapanır, operatöre sorulacak bir şey yoktur.
          { receiptItems: { some: { receipt: { cancelledAt: null } } } },
        ],
      },
      select: {
        dispatch: { select: { dispatchNo: true } },
        roll: { select: { barcode: true, currentQty: true } },
      },
    });

    return {
      success: true,
      data: {
        workOrderId: id,
        batchNumber: wo.workOrderNumber,
        status: wo.status,
        canCancel: blockReason === null,
        blockReason,
        travelerCardCount,
        rollCount: totalRollCount,
        processedCount,
        atSubcontractorCount,
        fasonInFlightCount,
        rolls: mappedRolls,
        // Liste 200 ile kırpıldıysa UI "ilk 200 gösteriliyor" diyebilsin.
        rollsTruncated: totalRollCount > rolls.length,
        // ── 2026-08-06 eklemeleri (hepsi ADDITIVE — eski istemciler yok sayar) ──
        openDispatches,
        batches,
        fasonBlock: {
          /** Sevk iptaliyle ÇÖZÜLÜR. */
          atSubcontractorCount,
          /** Çözülmez — doğru araç KAPATMA. */
          returnedFromSubcontractorCount: returnedCount,
          subcontractorReturnInProductionCount: returnInProductionCount,
        },
        canSwitchToClose,
        // ── AÇIKTA KALAN FASON KALEMİ (2026-08-29 / BULGU-T1-009) ────────────
        // Modal soruyu ÖNDEN sorabilsin diye önizlemeye taşınıyor — mevcut
        // `fasonAction` deseninin birebir aynısı (o da 409'u yakalamıyor,
        // önizlemedeki sayıya bakıp soruyu baştan soruyor). Bu alan olmasaydı
        // operatör iptale basıp işlenmemiş bir 409 görürdü.
        // ADDITIVE — eski istemciler yok sayar.
        fasonRemainder: {
          count: fasonRemainders.length,
          totalQty: Number(
            fasonRemainders.reduce((t, k) => t + Number(k.roll?.currentQty ?? 0), 0).toFixed(1),
          ),
          items: fasonRemainders.map((k) => ({
            dispatchNo: k.dispatch.dispatchNo,
            barcode: k.roll?.barcode ?? null,
            qty: Number(k.roll?.currentQty ?? 0),
          })),
        },
        closeHint: canSwitchToClose
          ? "Bu iş emri iptal edilemez ama kapatılabilir — istasyondaki toplara depo / 2. kalite / devir kararı verilir."
          : null,
      },
    };
  }

  /**
   * Soft-delete: sets status = CANCELLED (WorkOrder has no isActive field).
   * Veritabanı mantığı:
   * 0. GUARD: Fasonda (boyahanede) işlem gören/görmüş in-flight top varsa iptal
   *    REDDEDİLİR — fason malı ham stoğa dönemez, sipariş kopsa bile stok için
   *    üretilmeye devam eder. (AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR,
   *    veya boyanmış-dönmüş IN_PRODUCTION açık kumaş = SUBCONTRACTOR_RETURN.)
   * 1. İş Emri iptal edilir.
   * 2. Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen üretimdeki
   *    (currentStepId + IN_PRODUCTION) toplar STOCK'a çekilir; producedInStepId
   *    (üretim izi) KORUNUR. Bitmiş depo malları (WAREHOUSE/
   *    TAMBUR_CONSUMED) dokunulmaz.
   * 3. ACTIVE refakat kartları VOIDED'a düşer.
   * Tüm bu işlemler güvenli bir transaction bloğunda gerçekleşir.
   *
   * KARAR VEREREK İPTAL (2026-08-06): üçüncü parametre ile istasyonda kalan topların
   * bir kısmı `STOCK` yerine `SCRAP` (fire) ya da `CANCELLED` (hatalı kayıt) olarak
   * çözülebilir. Parametre VERİLMEZSE davranış bire bir eskisidir — `DELETE /:id`
   * (eski mobil APK, gövdesiz) tam olarak bu yoldan geçer, yani geriye uyum
   * ispatlanacak bir şey değil YAPISAL bir sonuçtur.
   */
  /**
   * İptal öncesi fason kararını uygular ve FİRE yazılacak top id'lerini döner.
   *
   * Neden `softDelete` içinde değil de ayrı: burada BAŞKA BİR SERVİSİN tx'i
   * çağrılıyor (`subcontractorService.cancelBulk`). İç içe tx açmak pg
   * adapter'ında tek bağlantıyı kilitler; ayrıca sevk iptali kendi başına
   * anlamlı ve geri alınabilir bir işlemdir — iptal yarıda kalsa bile mal
   * kayden içeri girmiş olur (fiziksel gerçeğe daha yakın son durum).
   */
  private async prepareFasonCancelDecision(
    workOrderId: string,
    stepIds: string[],
    input: CancelWorkOrderInput,
    userId: string | undefined,
    reason: string,
  ): Promise<{ scrapRollIds: string[]; residualRollIds: string[]; remainderClosed: boolean }> {
    if (stepIds.length === 0) return { scrapRollIds: [], residualRollIds: [], remainderClosed: false };

    const fasonRolls = await prisma.roll.findMany({
      where: {
        AND: [
          { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }] },
          {
            OR: [
              { status: RollStatus.AT_SUBCONTRACTOR },
              { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
              { status: RollStatus.IN_PRODUCTION, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (fasonRolls.length === 0) return { scrapRollIds: [], residualRollIds: [], remainderClosed: false };

    if (!input.fasonAction) {
      // Modal iki seçeneği çizsin diye MAKİNE-OKUR kod. Uzun açıklama metni
      // YOK — saha kullanıcısı paragraf okumuyor, düğme arıyor.
      throw AppError.conflict(
        `Bu iş emrinin ${fasonRolls.length} topu fasonda. Ne yapılsın?`,
        { code: "FASON_DECISION_REQUIRED", fasonRollCount: fasonRolls.length },
      );
    }
    if (reason.length < 3) {
      throw AppError.badRequest("İptal nedeni (en az 3 karakter) zorunludur");
    }

    // "Kalan gelmeyecek" kararı uygulandı mı — iptal claim'i bunu bilmek ZORUNDA
    // (aşağıdaki gerekçe). Varsayılan false: kapatma yapılmadıysa davranış aynı.
    let remainderClosed = false;

    // Açık (iptal edilmemiş, kabulü yapılmamış) sevkleri kapat — iki kararda da
    // gerekli: iptal edilmiş bir iş emrine bağlı AÇIK sevk bırakmak, fason
    // ekranlarında sahipsiz bir satır üretirdi.
    const openDispatches = await prisma.subcontractorDispatch.findMany({
      // Koşul TEK KAYNAKTAN: eski elle yazım `directShippedAt`/`receipt.cancelledAt`
      // taşımıyordu → tamamen doğrudan-sevk edilmiş (mal müşteriye çıkmış) sevk
      // boşuna `cancelBulk`'a veriliyor, kabul iptali sonrası yeniden açılan sevk
      // ise iptal edilmeden kalıyordu.
      where: { workOrderId, ...OPEN_OUTSTANDING },
      select: { id: true },
    });
    if (openDispatches.length > 0) {
      // `SubcontractorService` bu dosyada zaten üst seviyede import edilmiş
      // (fason sevk yolu onu kullanıyor) — ikinci bir yükleme yolu açmıyoruz.
      const bulk = await new SubcontractorService().cancelBulk(
        { dispatchIds: openDispatches.map((d) => d.id), reason: `İş emri iptali: ${reason}` },
        userId,
      );
      // ⚠️ SONUÇ OKUNUR — `cancelBulk` PARÇALI başarır (BULGU-T1-009).
      // `cancel()` iş kuralı hatasını fırlatır ama toplu sarmalayıcı onu yutup
      // `failed[]`e yazar (bilinçli: tek kötü id 20 sevki fasonda bırakmasın).
      // Dönüş atıldığında iptal, sevk KAPANMAMIŞKEN devam ediyor ve aşağıdaki
      // artık-yazımı topu içeri alıp blanket geri-çekmeye teslim ediyordu →
      // boyahanedeki mal Ham Stok'ta görünüyor, açık sevk ortada kalıyor.
      //
      // ⚠️⚠️ BURADA SERT ENGEL YOK — ve bu bilinçli bir DÖNÜŞ (2026-08-29, ikinci
      // tur). İlk yazımda 409 ile durduruyordum; o, 2026-08-17'de SAHA ŞİKÂYETİ
      // üzerine kaldırılan sert engeli geri getiriyordu ("bir iş emrini iptal
      // etmek çok zor, bazen iptal edilemiyor"). O gün kurulan desen "engelleme,
      // AÇIKÇA SOR"du ve doğru olan oydu — eksik olan tek şey, aynı sorunun
      // AÇIKTA KALAN SEVK KALEMİ için sorulmamasıydı. Şimdi soruluyor.
      const failed = bulk.data.failed;
      if (failed.length > 0) {
        // Kapanmayan sevklerin OUTSTANDING kalemleri: operatörün karar vereceği
        // fiziksel gerçek — "şu kadar metre hâlâ fasonda".
        const kalanlar = await prisma.subcontractorDispatchItem.findMany({
          where: {
            ...outstandingItemOfOpenDispatch(),
            dispatchId: { in: failed.map((f) => f.dispatchId) },
          },
          select: {
            id: true,
            rollId: true,
            dispatch: { select: { dispatchNo: true, workOrderId: true, stepId: true } },
            roll: { select: { barcode: true, currentQty: true } },
          },
        });

        if (input.fasonRemainderAction !== "CLOSE_AS_SCRAP") {
          // MAKİNE-OKUR kod + kararın dayanacağı SOMUT liste. Modal bu listeyi
          // çizer: hangi sevk, hangi top, kaç metre.
          throw AppError.conflict(
            `${kalanlar.length} top hâlâ fasonda (${kalanlar
              .reduce((t, k) => t + Number(k.roll?.currentQty ?? 0), 0)
              .toFixed(1)} m). İş emrini iptal etmek için bu malın ne olacağına karar verin.`,
            {
              code: "FASON_REMAINDER_DECISION_REQUIRED",
              remainders: kalanlar.map((k) => ({
                dispatchNo: k.dispatch.dispatchNo,
                barcode: k.roll?.barcode ?? null,
                qty: Number(k.roll?.currentQty ?? 0),
              })),
              failed: failed.map((f) => ({ dispatchNo: f.dispatchNo, message: f.message })),
            },
          );
        }

        // KARAR VERİLDİ: kalan gelmeyecek → mevcut `closeRemainder` motoruna
        // havale. Kural TEK YERDE kalsın diye burada YENİDEN YAZILMIYOR: fire
        // sapma defterine (`SUBCONTRACTOR_REMAINDER`) düşer, kalem damgalanır,
        // fason karnesi kalemi "kapandı" sayar. Sebep ZORUNLU (2026-08-19
        // kullanıcı kararı) — iptal sebebini taşıyoruz, uydurma bir metin değil.
        const fasonSvc = new SubcontractorService();
        remainderClosed = kalanlar.length > 0;
        for (const k of kalanlar.filter(isRollItem)) {
          await fasonSvc.closeRemainder(
            {
              stepId: workOrderStepIdOf(k.dispatch),
              rollId: k.rollId,
              reasonCode: input.fasonRemainderReasonCode ?? SHRINK_REASON_CODE,
              reasonText: `İş emri iptali: ${reason}`,
            },
            userId,
          );
        }
      }
    }

    // ── ARTIK KALAN FASON TOPLARI ──────────────────────────────────────────
    // Sevk iptali topları normalde geri getirir. Ama getirmediği durumlar var
    // ve sahada BUNLAR takılmaya sebep oluyordu:
    //   · top AT_SUBCONTRACTOR ama AÇIK sevki yok (kısmi kabul sonrası kalıntı,
    //     elle düzeltilmiş kayıt, eski veri),
    //   · dönüş topu (SUBCONTRACTOR_RETURN) zaten içeride ama fason statüsünde.
    // Bunları burada AÇIKÇA içeri alıyoruz; yoksa aşağıdaki guard yine tetikler
    // ve kullanıcı kararı verdiği hâlde iptal edemez (ilk yazımdaki hata buydu).
    //
    // Hedef IN_PRODUCTION: sevk iptalinin ürettiği son durumun aynısı. Böylece
    // bundan sonrası SIRADAN bir "işlemdeki top" olur ve karar motoru (fire /
    // varsayılan stok) TEK yerde çalışır — ikinci bir dispozisyon yolu açmıyoruz.
    // ⚠️ YAZIM BURADA DEĞİL, İPTAL TX'İNİN İÇİNDE (2026-08-29 / BULGU-T1-009).
    // Eskiden bu satırlar havuz client'ıyla, tx DIŞINDA ve koşulsuz koşuyordu:
    // aşağıdaki iptal tx'i herhangi bir sebeple düşerse (WO'yu başkası bu sırada
    // tamamladı → claim 409, karar kapsamı guard'ı, dispozisyon hatası) statü
    // çevirmesi KALICI oluyordu — yani iş emri hâlâ açıkken topları fason
    // statüsünden çıkmış, "işlemdeki top" gibi görünen bir kalıntı bırakıyordu.
    // Artık yalnız ADAY id'ler dönüyor; çevirme tx içinde ve claim'li yapılıyor.
    const residual = await prisma.roll.findMany({
      where: {
        id: { in: fasonRolls.map((r) => r.id) },
        status: {
          in: [RollStatus.AT_SUBCONTRACTOR, RollStatus.RETURNED_FROM_SUBCONTRACTOR],
        },
      },
      select: { id: true },
    });

    // FİRE kararında topları normal dispozisyon motoruna havale et (kural tek
    // yerde kalsın); RETURN_TO_STOCK'ta ekstra iş yok — iptalin varsayılanı
    // zaten STOCK'tur ve toplu geri çekme onu uygular.
    return {
      scrapRollIds: input.fasonAction === "SCRAP" ? fasonRolls.map((r) => r.id) : [],
      residualRollIds: residual.map((r) => r.id),
      remainderClosed,
    };
  }

  async softDelete(
    id: string,
    userId?: string,
    input: CancelWorkOrderInput = {},
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: true,
        orderLinks: { where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" }, include: { orderLine: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.badRequest("İş emri zaten iptal edilmiş");
    }
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.badRequest("Devredilmiş iş emri iptal edilemez (malzemesi yeni iş emrine taşındı)");
    }
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("Tamamlanmış iş emri iptal edilemez");
    }

    const stepIds = existing.steps.map((step) => step.id);

    // ⚠️ STOCK MOTORA VERİLMEZ. İptalde `STOCK` VARSAYILANDIR ve aşağıdaki toplu
    // yolda (blanket updateMany + hareket süpürmesi) uygulanır. İstemci listede
    // açıkça göndermiş olsa bile motora geçirilmez — aksi halde AYNI kullanıcı
    // kararı, istemcinin satırı gönderip göndermemesine göre `roll_movements`'ta
    // iki farklı not/metraj üretirdi (sessiz, kalıcı, raporlanamaz).
    const decided = (input.dispositions ?? []).filter((d) => d.action !== "STOCK");
    const reason = (input.reason ?? "").trim();
    // Sebep KODU (CANCELLED topların `cancelReasonCode`'u) — tx DIŞINDA çözülür; açık
    // kod doğrulanır, yoksa metinden türetilir (serbest metin → NULL).
    const { code: cancelReasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
      reasonCode: input.reasonCode,
      reasonText: reason,
    });

    if (decided.length > 0) {
      if (reason.length < 3) {
        throw AppError.badRequest("İptal nedeni (en az 3 karakter) zorunludur");
      }
      if (decided.length > DISPOSITION_MAX_ROLLS) {
        throw AppError.badRequest(
          `Tek iptalde en fazla ${DISPOSITION_MAX_ROLLS} top için karar verilebilir`,
        );
      }
      const seen = new Set<string>();
      for (const d of decided) {
        if (seen.has(d.rollId)) {
          throw AppError.badRequest("Aynı top için birden fazla karar gönderildi");
        }
        seen.add(d.rollId);
      }
      if (stepIds.length === 0) {
        throw AppError.badRequest("İş emrinin adımı yok — karar verilebilecek top da yok");
      }
    }

    // ── FASON KARARI — iptal tx'inden ÖNCE (2026-08-17) ────────────────────
    // Sıra bilinçli: açık fason sevkleri MEVCUT ve test edilmiş `cancelBulk`
    // servisiyle iptal edilir (kendi tx'i, kendi hareket/iz kayıtları). Aynı işi
    // burada yeniden yazsaydık iki fason muhasebesi doğardı ve zamanla ayrışırdı.
    //
    // Sevk iptali topları geri getirdiği için, buradan sonra normal iptal yolu
    // (aşağıdaki tx) onları sıradan "işlemdeki top" gibi görür — FİRE kararı da
    // oradaki dispozisyon motoruna devredilir.
    const fasonPlan = await this.prepareFasonCancelDecision(id, stepIds, input, userId, reason);
    // FİRE seçilen fason topları normal dispozisyon listesine katılır — karar
    // motoru TEK yerde kalsın (hareket notu, sapma defteri, audit hepsi orada).
    const decidedWithFason = [
      ...decided,
      ...fasonPlan.scrapRollIds
        .filter((rid) => !decided.some((d) => d.rollId === rid))
        .map((rid) => ({ rollId: rid, action: "SCRAP" as CancelDisposition })),
    ];
    const { updated, applied } = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM ÖNCE (F57): WO satırını status-koşullu updateMany ile
      // kilitle. Fason in-flight guard'ı BUNDAN SONRA çalışır — böylece guard,
      // WO satır kilidini tutarken okur ve eşzamanlı bir fason sevkinin (dispatch
      // tx başında touchWorkOrderTx ile AYNI satırı kilitler) COMMIT'li
      // AT_SUBCONTRACTOR toplarını her zaman görür. Guard önce çalışsaydı, READ
      // COMMITTED'da commit'siz dispatch topları görülmez (count=0), sonra claim
      // dispatch commit'inden sonra geçer ve mal fasondayken WO iptal olurdu.
      // Ayrıca eşzamanlı son-top finalize (tambur.finalize / kursun.finishStep)
      // WO'yu COMPLETED yaparsa bu claim count===0 görür → 409. tx-DIŞI ön-kontrol
      // (2371-2376) yalnız UX; asıl koruma burada.
      // ⚠️ KENDİ ÜRETTİĞİMİZ TAMAMLANMA (2026-08-29 / BULGU-T1-009): "kalan
      // gelmeyecek" kararı uygulandıysa `closeRemainder` fason adımını kapatır
      // ve TEK ADIMLI iş emrinde bu, iş emrini COMPLETED'a çeker. O durumda bu
      // claim kendi eylemimizi "başkası bu sırada tamamladı" sanıp 409 verir ve
      // operatörün AZ ÖNCE onayladığı iptal sessizce yapılmamış olur — üstelik
      // kalan zaten fire yazılmıştır, yani yarım iş kalır.
      // Muafiyet DAR: yalnız bu istekte kalan kapatıldıysa ve yalnız COMPLETED
      // için. CANCELLED/SUPERSEDED kapıları AYNEN duruyor.
      const claimBlocked = fasonPlan.remainderClosed
        ? [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED]
        : [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED];
      const cancelClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: claimBlocked },
        },
        // İptal izi KOLONDA (2026-08-17): audit 6 ayda bir arşivleniyor, sebep
        // orada kalırsa "bu iş emri neden iptal edildi" sorusu sessizce
        // cevapsız kalırdı. Audit yine yazılır — ikisi farklı soruları
        // cevaplıyor ("her değişiklik" ↔ "son karar").
        data: {
          status: WorkOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason || null,
        },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        throw AppError.conflict(
          `İş emri bu sırada ${
            fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, iptal edilemez. Listeyi yenileyin.`
        );
      }

      // ── ARTIK KALAN FASON TOPLARI — TX İÇİNDE, CLAIM'Lİ (BULGU-T1-009) ────
      // Sevk iptali topları normalde geri getirir. Getirmediği durumlar var ve
      // sahada BUNLAR takılmaya sebep oluyordu:
      //   · top AT_SUBCONTRACTOR ama AÇIK sevki yok (kısmi kabul kalıntısı,
      //     elle düzeltilmiş kayıt, eski veri),
      //   · dönüş topu (SUBCONTRACTOR_RETURN) zaten içeride ama fason statüsünde.
      // Bunları AÇIKÇA içeri alıyoruz; yoksa aşağıdaki guard yine tetikler ve
      // kullanıcı kararı verdiği hâlde iptal edemez.
      //
      // Hedef IN_PRODUCTION: sevk iptalinin ürettiği son durumun aynısı — bundan
      // sonrası SIRADAN bir "işlemdeki top" olur ve karar motoru (fire /
      // varsayılan stok) TEK yerde çalışır.
      //
      // ⚠️ İKİ ŞEY LOAD-BEARING: (1) yazım bu tx'in İÇİNDE — tx düşerse çevirme
      // de geri sarılır (eskiden havuz client'ıyla dışarıda koşuyor ve kalıcı
      // kalıyordu); (2) `where`'deki statü süzgeci bir CLAIM'dir — id listesi
      // tx'ten ÖNCE okundu, arada bir top meşru olarak başka statüye geçmiş
      // olabilir ve onu körlemesine IN_PRODUCTION'a çekmek o işlemi ezerdi.
      // Bu arada FASONA ÇIKAN yeni bir top ise listede olmadığı için aşağıdaki
      // guard'a takılır ve iptal reddedilir (fail-closed, doğru yön).
      if (fasonPlan.residualRollIds.length > 0) {
        await tx.roll.updateMany({
          where: {
            id: { in: fasonPlan.residualRollIds },
            status: {
              in: [RollStatus.AT_SUBCONTRACTOR, RollStatus.RETURNED_FROM_SUBCONTRACTOR],
            },
          },
          data: { status: RollStatus.IN_PRODUCTION },
        });
      }

      // GUARD (claim'den SONRA — F57): Fasonda (boyahanede) işlem gören/görmüş
      // in-flight top varsa iptal edilemez. Fason malı asla ham stoğa dönemez —
      // sipariş kopsa bile bu mal stok için üretilmeye devam eder. Guard triplerse
      // tüm tx (claim dahil) geri sarılır → WO IN_PROGRESS kalır.
      //   - AT_SUBCONTRACTOR                     → halen boyahanede
      //   - RETURNED_FROM_SUBCONTRACTOR          → fason dönüşü (eski model)
      //   - IN_PRODUCTION + SUBCONTRACTOR_RETURN → boyanmış açık kumaş, KK2'de
      if (stepIds.length > 0) {
        const fasonInFlight = await tx.roll.count({
          where: {
            AND: [
              {
                OR: [
                  { currentStepId: { in: stepIds } },
                  { producedInStepId: { in: stepIds } },
                ],
              },
              {
                OR: [
                  { status: RollStatus.AT_SUBCONTRACTOR },
                  { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                  {
                    status: RollStatus.IN_PRODUCTION,
                    entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
                  },
                ],
              },
            ],
          },
        });
        if (fasonInFlight > 0) {
          // 2026-08-17: SERT ENGEL KALDIRILDI. Eskiden burada iptal tamamen
          // reddediliyordu ve kullanıcının hiçbir çıkışı yoktu. Artık karar
          // AÇIKÇA sorulur; karar gelmemişse istemciye MAKİNE-OKUR bir kod
          // döner ve modal iki seçeneği çizer (uzun bir açıklama metni değil).
          //
          // ⚠️ Karar gelmişse fason topları bu tx'e GİRMEDEN ÖNCE (aşağıdaki
          // `applyFasonDecisionBeforeCancel`) işlenmiş olur; buraya düşmek,
          // kararın uygulanamadığı (ör. sevk iptali başarısız) anlamına gelir.
          throw AppError.conflict(
            "Fasondaki toplar için karar verilmeden iş emri iptal edilemez.",
            { code: "FASON_DECISION_REQUIRED", fasonRollCount: fasonInFlight },
          );
        }
      }

      // KARARLI TOPLAR (fire / hatalı kayıt) — varsayılan STOCK dışına çıkanlar.
      // Guard'lardan SONRA, toplu geri çekmeden ÖNCE koşar: motor topları
      // IN_PRODUCTION'dan çıkarır, böylece aşağıdaki blanket updateMany onları
      // kendiliğinden kapsam dışı bırakır — bakımı gereken bir `notIn` listesi YOK.
      const applied: AppliedRollDisposition[] = [];
      if (decidedWithFason.length > 0) {
        // Kapsam guard'ı: karar verilen her top tx içinde TAZE okunan işlemdeki
        // kümede olmalı. Kapatmadan farklı olarak BİREBİR eşleşme aranmaz (alt küme
        // yeterli) — listelenmeyen her top zaten varsayılan STOCK'a gider ve
        // gövdesiz eski çağrıyı yapısal olarak aynı bırakan şey budur.
        const inFlight = await tx.roll.findMany({
          where: { currentStepId: { in: stepIds }, status: RollStatus.IN_PRODUCTION },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            weightKg: true,
            entrySource: true,
          },
        });
        const inFlightById = new Map(inFlight.map((r) => [r.id, r]));
        const missing = decidedWithFason.filter((d) => !inFlightById.has(d.rollId));
        if (missing.length > 0) {
          throw AppError.badRequest(
            `${missing.length} top artık işlemde değil — liste bu sırada değişti. ` +
              "Sayfayı yenileyip tekrar deneyin.",
          );
        }
        applied.push(
          ...(await applyRollDispositionsTx(tx, {
            origin: "WO_CANCEL",
            reason,
            reasonCode: cancelReasonCode,
            userId,
            rolls: inFlight,
            dispositions: decidedWithFason,
            stepIds,
            // İptalde parti üyeliği KORUNUR (`inventory.softDelete` emsali): "hangi
            // partiye yanlış top yazılmıştı" izi iptalle birlikte silinmemeli.
            clearBatchId: () => false,
            // Üç aksiyonun hiçbiri satılabilir değil → barkod üretimi gereksiz.
            generateBarcodes: false,
          })),
        );
      }

      if (stepIds.length > 0) {
        // Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen
        // üretimdeki topları STOCK'a geri çek. `producedInStepId` (üretim izi)
        // KORUNUR. Bitmiş depo malları (WAREHOUSE/TAMBUR_CONSUMED) ve
        // fason ürünleri (yukarıda bloklandı) DOKUNULMAZ.
        // ⚠️ DAMGA STATÜ FLIP'İNDEN ÖNCE: terfi topu STOK KÜMESİNE sokuyor ve
        // deposuz bir top orada "depoda ama hangi depoda belli değil" hâline
        // düşerdi (defter kapısı onu sessizce atlardı). Flip'ten SONRA aynı yüklem
        // artık eşleşmez — `status` ve `currentStepId` değişmiş olur. Damga mevcut
        // depoyu EZMEZ, yalnız NULL'u doldurur.
        const hamTopWhere = {
          currentStepId: { in: stepIds },
          status: RollStatus.IN_PRODUCTION,
          entrySource: { not: RollEntrySource.SUBCONTRACTOR_RETURN },
        } satisfies Prisma.RollWhereInput;
        await warehouseStampWhereTx(tx, hamTopWhere);
        await tx.roll.updateMany({
          where: hamTopWhere,
          data: {
            status: RollStatus.STOCK,
            currentStepId: null,
          },
        });
      }

      // M-12: iptal edilen WO'nun adımlarındaki TÜM açık movement'ları kapat —
      // yoksa süresiz açık kalır: dashboard WIP sayacı kalıcı şişer, açık-kart
      // partial index'i ölü adımlarla dolar, serbest STOCK top "istasyonda
      // aktif" görünür. qtyOut topun son metrajından (detachRolls deseni).
      if (stepIds.length > 0) {
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          SET "exitedAt" = now(),
              "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_CANCELLED'
                           ELSE m.notes || ' | WO_CANCELLED' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
            AND m."revokedAt" IS NULL
        `;
        // Başlamamış/yarım adımlar terminal duruma (SKIPPED) — ölü WO'nun
        // adımları kuyruk/WIP istatistiklerinde "içeride" sayılmasın.
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "WO_CANCELLED" },
        });
      }

      // Kurşun bypass: iş emri artık YOK → açık kurşun dağıtımı da yok. `force`
      // ile TÜM açık atamalar iptal edilir (adım durumuna bakılmaz): yukarıdaki
      // blok adımları zaten SKIPPED'a çekiyor ama `stepIds` boşsa hiç çalışmıyor,
      // ve bayat kalan bir atama dağıtım ekranında "bu iş bizde bekliyor" diye
      // sonsuza dek görünür + partial unique yüzünden adım yeniden kullanılamazdı.
      // İSTASYON GERİ YÜKLENMEZ (helper sözleşmesi) — kapanmış movement'ların
      // istasyon atfı, işi fiilen yapan kurşun istasyonunda kalmalı.
      await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CANCELLED", { force: true });

      // WO iptal olunca tüm ACTIVE refakat kartlarını VOIDED'a çek
      await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_CANCELLED" });

      const cancelledWO = await tx.workOrder.findUnique({ where: { id } });
      return { updated: cancelledWO!, applied };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { batchNumber: existing.workOrderNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.CANCELLED,
        ...(applied.length > 0 ? { dispositionCount: applied.length, reason } : {}),
      },
    });

    // Top başına ayrı iz — sabit olay koduyla ayrıştırılabilir olmalı: altı ay sonra
    // "bu top neden fire yazılmış" sorusunun cevabı burada. `WO_CLOSE_DISPOSITION`
    // ile aynı desen, farklı kod (kapatma ile iptal karışmasın).
    for (const a of applied) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          status: a.to,
          event: "WO_CANCEL_DISPOSITION",
          action: a.action,
          reason,
          workOrderNumber: existing.workOrderNumber,
        },
      });
    }

    const scrapCount = applied.filter((a) => a.action === "SCRAP").length;
    const voidCount = applied.filter((a) => a.action === "CANCELLED").length;
    const extra = [
      scrapCount > 0 ? `${scrapCount} fire` : null,
      voidCount > 0 ? `${voidCount} hatalı kayıt` : null,
    ].filter(Boolean);

    return {
      success: true,
      data: updated,
      message:
        extra.length > 0
          ? `İş emri iptal edildi (${extra.join(", ")}), kalan ham toplar STOCK'a çekildi: ${existing.workOrderNumber}`
          : `İş emri iptal edildi, ham toplar STOCK'a çekildi: ${existing.workOrderNumber}`,
    };
  }

  /**
   * MANUEL KAPATMA ÖNİZLEMESİ (read-only): kalan (atlanacak) adımlar + in-flight
   * topların DİSPOZİSYON listesi. In-flight toplar iki kümeye ayrılır:
   *   - `dispositionRolls` → içeride (IN_PRODUCTION, açık fason sevki yok): kapatan
   *     kişi her biri için karar verir (ham stok / depo / 2. kalite / fire / hatalı
   *     kayıt / devir).
   *   - `blockedRolls`     → fasonda ya da açık fason sevkinde: KARAR VERİLEMEZ,
   *     kapatma bloklanır (mal fiziksel olarak dışarıda).
   * `canComplete` artık "WIP var" diye false OLMAZ — yalnız blocked küme (ya da WO'nun
   * kendi durumu) engeller.
   */
  async getCompletePreview(id: string) {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: {
          include: { station: { select: { name: true } } },
          orderBy: { stepSequence: "asc" },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const stepIds = wo.steps.map((s) => s.id);
    const stepName = new Map(wo.steps.map((s) => [s.id, s.station?.name ?? "—"]));

    // In-flight = bu WO'nun bir adımında halen işlemde/fasonda olan toplar.
    const inFlightRolls = stepIds.length
      ? await prisma.roll.findMany({
          where: {
            currentStepId: { in: stepIds },
            status: { in: CLOSE_IN_FLIGHT_STATUSES },
          },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            colorId: true,
            currentStepId: true,
            entrySource: true,
            qualityGrade: true,
            color: { select: { name: true, hex: true } },
            _count: { select: { properties: { where: ACTIVE_ROLL_PROPERTY } } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // Açık (iptal edilmemiş) fason sevkine bağlı toplar — statüsü IN_PRODUCTION olsa
    // bile fason izinde sayılır (getRescuePreview'ın guard'ıyla aynı).
    const openDispatchRollIds = new Set(
      inFlightRolls.length
        ? (
            await prisma.subcontractorDispatchItem.findMany({
              where: {
                rollId: { in: inFlightRolls.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
              select: { rollId: true },
            })
          ).map((d) => d.rollId)
        : [],
    );

    const mapRoll = (r: (typeof inFlightRolls)[number]) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentQty: Number(r.currentQty ?? 0),
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      propertyCount: r._count.properties,
      // "Ham değil" — cancel-impact'teki processed tanımıyla aynı.
      processed:
        Boolean(r.colorId) ||
        r._count.properties > 0 ||
        r.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN ||
        CLOSE_BLOCKED_STATUSES.includes(r.status),
      qualityGrade: r.qualityGrade,
      stepId: r.currentStepId as string,
      stationName: stepName.get(r.currentStepId as string) ?? "—",
      // Fason dönüşü mal ham stoğa DÖNEMEZ (softDelete'in fason invariant'ı).
      canReturnToStock: r.entrySource !== RollEntrySource.SUBCONTRACTOR_RETURN,
    });

    type PreviewRoll = ReturnType<typeof mapRoll>;
    const dispositionRolls: PreviewRoll[] = [];
    const blockedRolls: (PreviewRoll & { blockReason: string })[] = [];
    for (const r of inFlightRolls) {
      const mapped = mapRoll(r);
      if (r.status !== RollStatus.IN_PRODUCTION) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Fasonda (fiziksel olarak dışarıda) — önce fason kabul/iade yapılmalı",
        });
      } else if (openDispatchRollIds.has(r.id)) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Açık bir fason sevkine bağlı — önce fason kapatılmalı",
        });
      } else {
        dispositionRolls.push(mapped);
      }
    }

    const byStep = new Map<string, { stationName: string; count: number; meters: number }>();
    for (const r of inFlightRolls) {
      const key = r.currentStepId!;
      const e = byStep.get(key) ?? { stationName: stepName.get(key) ?? "—", count: 0, meters: 0 };
      e.count += 1;
      e.meters += Number(r.currentQty ?? 0);
      byStep.set(key, e);
    }
    const inFlightCount = inFlightRolls.length;
    const inFlightMeters = inFlightRolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const remainingSteps = wo.steps
      .filter((s) => s.status === StepStatus.PENDING || s.status === StepStatus.ACTIVE)
      .map((s) => ({ stepId: s.id, stationName: s.station?.name ?? "—", stepSequence: s.stepSequence }));

    let blockReason: string | null = null;
    if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = "İş emri zaten tamamlanmış.";
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = "Devredilmiş iş emri kapatılamaz (malzemesi yeni iş emrine taşındı).";
    } else if (wo.status === WorkOrderStatus.CANCELLED) {
      blockReason = "İptal edilmiş iş emri kapatılamaz.";
    } else if (wo.status === WorkOrderStatus.PLANNED) {
      blockReason =
        "İş emri henüz üretime başlamadı (Planlandı). Başlamamış iş emrini kapatmak yerine iptal edin.";
    } else if (blockedRolls.length > 0) {
      blockReason =
        `${blockedRolls.length} top fasonda / açık fason sevkinde — mal fiziksel olarak ` +
        "dışarıda olduğu için kapatılamaz. Önce fason kabul/iade yapılmalı.";
    } else if (dispositionRolls.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      blockReason =
        `${dispositionRolls.length} top işlemde — kapanış dispozisyonu en fazla ` +
        `${CLOSE_DISPOSITION_MAX_ROLLS} top için yapılabilir. Önce topları istasyonlardan çözün.`;
    }

    return {
      success: true,
      data: {
        workOrderId: id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        canComplete: blockReason === null,
        blockReason,
        /** true ise kapatma isteği her dispozisyon topu için karar taşımak ZORUNDA. */
        requiresDisposition: dispositionRolls.length > 0,
        /**
         * Devirde yeni WO'nun sipariş bağı default'u için ("keep" mi "stock" mu).
         *
         * Kaynak: `WorkOrder.type` — bağın AYNASI. Eskiden `_count.orderLinks > 0`
         * okunuyordu ve bu, siparişe özel açılmış ama bağı sonradan çözülmüş
         * (ya da henüz kurulmamış) bir WO'yu "stoka üretim" gibi devrederdi;
         * tip ise iş emrinin NİYETİDİR ve devir klonuna taşınması gereken de odur.
         */
        orderLinked: wo.type === WorkOrderType.ORDER_PRODUCTION,
        remainingSteps,
        inFlight: {
          count: inFlightCount,
          totalMeters: inFlightMeters,
          byStep: [...byStep.values()],
        },
        dispositionRolls,
        blockedRolls,
      },
    };
  }

  /**
   * MANUEL KAPATMA + KAPANIŞ DİSPOZİSYONU: IN_PROGRESS bir iş emrini elle COMPLETED'a
   * çeker. İstasyonda kalan (IN_PRODUCTION) her top için ÇAĞIRAN karar verir
   * (`data.dispositions`) — kapatma artık "işlemde top var" diye reddedilmez; karar
   * kapanışın parçasıdır ve sebebiyle audit'e yazılır. Hâlâ hard-block olan tek şey
   * FASON: mal fiziksel olarak dışarıdaysa ofis kararı onu geri getirmez.
   *
   * Kalan PENDING/ACTIVE adımlar SKIPPED(MANUAL_COMPLETE), açık movement'lar kapatılır,
   * ACTIVE refakat kartları COMPLETED olur. Atomik claim + guard'lar tx-içinde
   * (eşzamanlı finalize/iptal ile yarış güvenli — cancel deseninin aynısı).
   */
  async completeWorkOrder(
    id: string,
    data: CompleteWorkOrderInput = {},
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true, stepSequence: true } } },
    });
    if (!existing) throw AppError.notFound("İş emri bulunamadı");
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.badRequest("İş emri zaten tamamlanmış");
    }
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.conflict("Devredilmiş iş emri kapatılamaz (malzemesi yeni iş emrine taşındı)");
    }
    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.conflict("İptal edilmiş iş emri kapatılamaz");
    }
    if (existing.status === WorkOrderStatus.PLANNED) {
      throw AppError.badRequest("İş emri henüz üretime başlamadı — kapatmak yerine iptal edin");
    }

    const dispositions = data.dispositions ?? [];
    const reason = (data.reason ?? "").trim();
    // Sebep KODU — yalnız CANCELLED dispozisyonunda anlamlı; tx DIŞINDA çözülür.
    const { code: cancelReasonCode } = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
      reasonCode: data.reasonCode,
      reasonText: reason,
    });
    if (dispositions.length > 0 && reason.length < 3) {
      throw AppError.badRequest(
        "Kapanış dispozisyonu için işlem nedeni (en az 3 karakter) zorunludur",
      );
    }
    if (dispositions.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      throw AppError.badRequest(
        `Tek kapanışta en fazla ${CLOSE_DISPOSITION_MAX_ROLLS} top için dispozisyon verilebilir`,
      );
    }
    const seenRollIds = new Set<string>();
    for (const d of dispositions) {
      if (seenRollIds.has(d.rollId)) {
        throw AppError.badRequest("Aynı top için birden fazla dispozisyon gönderildi");
      }
      seenRollIds.add(d.rollId);
      if (d.qualityGradeId && d.action !== "WAREHOUSE" && d.action !== "A1_STOCK") {
        throw AppError.badRequest(
          "Kalite yalnız depo / 2. kalite dispozisyonunda verilebilir",
        );
      }
    }

    // ── KALİTE ZORUNLU (D6) — YALNIZ SATILABİLİR DİSPOZİSYONLAR ─────────────
    // Kapanışta istasyonda kalan top depoya (`WAREHOUSE`) ya da 2. kaliteye
    // (`A1_STOCK`) çekiliyorsa artık SATILABİLİR bir maldır — kalitesi belirsiz
    // kalamaz. Diğer dört karar KAPSAM DIŞI ve bu bilinçli: `STOCK` (ham stok)
    // ve `TRANSFER` (yeni WO'ya devir) topu üretimde bırakır, `SCRAP`/`CANCELLED`
    // ise topu zaten defterden düşürür — hiçbirinde "kalite" bir karar değildir.
    // Okuma KOŞULLU: eksik kalite yoksa bayrağa hiç bakılmaz.
    const gradelessSellable = dispositions.filter(
      (d) => (d.action === "WAREHOUSE" || d.action === "A1_STOCK") && !d.qualityGradeId,
    );
    if (gradelessSellable.length > 0 && (await readQualityGradeRequiredEnabled())) {
      throw AppError.badRequest(
        `Depoya / 2. kaliteye çekilen ${gradelessSellable.length} top için kalite zorunlu`,
        { code: "GRADE_REQUIRED", rollIds: gradelessSellable.map((d) => d.rollId) },
      );
    }

    const stepIds = existing.steps.map((s) => s.id);
    const stepSeqById = new Map(existing.steps.map((s) => [s.id, s.stepSequence]));
    // Adımsız WO'da in-flight top olamaz — gelen dispozisyon sessizce yutulmasın.
    if (stepIds.length === 0 && dispositions.length > 0) {
      throw AppError.badRequest("İş emrinin adımı yok — dispozisyon verilebilecek top da yok");
    }

    const { updated, applied, transferredWorkOrderNumber, bypassRepointed } = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ATOMİK CLAIM ÖNCE: WO satırını IN_PROGRESS→COMPLETED koşullu kilitle.
        // Eşzamanlı son-top finalize (tambur/kursun) ya da iptal WO'yu başka duruma
        // çekmişse count===0 → 409 (çift geçiş önlenir).
        const claim = await tx.workOrder.updateMany({
          where: { id, status: WorkOrderStatus.IN_PROGRESS },
          data: { status: WorkOrderStatus.COMPLETED },
        });
        if (claim.count === 0) {
          const fresh = await tx.workOrder.findUnique({ where: { id }, select: { status: true } });
          throw AppError.conflict(
            `İş emri bu sırada ${
              fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "değişti"
            }, kapatılamaz. Sayfayı yenileyin.`,
          );
        }

        const appliedRows: AppliedDisposition[] = [];
        let transferredWoNumber: string | null = null;
        /** Devirde yeni WO'ya taşınan AÇIK kurşun bypass ataması adedi (audit izi). */
        let transferredBypassRepointed = 0;

        if (stepIds.length > 0) {
          // Guard'lar claim'den SONRA (cancel deseni): tripleyince tüm tx (claim dahil)
          // geri sarılır → WO IN_PROGRESS kalır, mal "kapalı WO'da takılı" limbosuna
          // düşmez.
          const inFlight = await tx.roll.findMany({
            where: {
              currentStepId: { in: stepIds },
              status: { in: CLOSE_IN_FLIGHT_STATUSES },
            },
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              weightKg: true,
              currentStepId: true,
              entrySource: true,
              batchId: true,
            },
          });

          // GUARD 1 — FASON: mal fiziksel olarak dışarıda, karar verilemez.
          const outside = inFlight.filter((r) => CLOSE_BLOCKED_STATUSES.includes(r.status));
          if (outside.length > 0) {
            throw AppError.conflict(
              `${outside.length} top fasonda (fiziksel olarak dışarıda) — iş emri ` +
                "kapatılamaz. Önce fason kabul/iade yapılmalı.",
            );
          }

          // GUARD 1b — statüsü IN_PRODUCTION olsa da açık fason sevkine bağlı toplar
          // fason izindedir (rescueStuckRoll'un guard'ıyla aynı).
          if (inFlight.length > 0) {
            const openDispatchCount = await tx.subcontractorDispatchItem.count({
              where: {
                rollId: { in: inFlight.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
            });
            if (openDispatchCount > 0) {
              throw AppError.conflict(
                `${openDispatchCount} top açık bir fason sevkine bağlı — iş emri ` +
                  "kapatılamaz. Önce fason kapatılmalı.",
              );
            }
          }

          // GUARD 2 — KAPSAM: tx içinde TAZE okunan in-flight küme ile gönderilen
          // dispozisyonlar birebir örtüşmeli. Eksik/fazla → istemcinin gördüğü liste
          // bayat; sessizce yarım kapatma yapmaktansa reddet.
          const byId = new Map(inFlight.map((r) => [r.id, r]));
          if (
            inFlight.length !== dispositions.length ||
            dispositions.some((d) => !byId.has(d.rollId))
          ) {
            throw AppError.badRequest(
              `İşlemde ${inFlight.length} top var, ${dispositions.length} dispozisyon ` +
                "gönderildi — liste bu sırada değişti. Sayfayı yenileyip tekrar deneyin.",
            );
          }

          // GUARD 3 — fason dönüşü mal ham stoğa DÖNEMEZ (softDelete invariant'ı).
          for (const d of dispositions) {
            const roll = byId.get(d.rollId)!;
            if (d.action === "STOCK" && roll.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN) {
              throw AppError.badRequest(
                `${roll.barcode ?? "Açık kumaş"}: fason dönüşü top ham stoğa çekilemez — ` +
                  "depo / 2. kalite / fire seçin.",
              );
            }
          }

          // Kalite (opsiyonel) — verilen id'ler aktif katalogda olmalı.
          const qualityIds = Array.from(
            new Set(dispositions.map((d) => d.qualityGradeId).filter((q): q is string => !!q)),
          );
          const qualityById = new Map<string, { id: string; code: string }>();
          if (qualityIds.length > 0) {
            const rows = await tx.qualityGrade.findMany({
              where: { id: { in: qualityIds }, isActive: true },
              select: { id: true, code: true },
            });
            if (rows.length !== qualityIds.length) {
              throw AppError.badRequest("Seçilen kalite bulunamadı veya aktif değil");
            }
            for (const q of rows) qualityById.set(q.id, q);
          }

          // 1) DEVİR — üretim yeni (devam) iş emrinde sürsün.
          const transferRolls = dispositions
            .filter((d) => d.action === "TRANSFER")
            .map((d) => byId.get(d.rollId)!);
          if (transferRolls.length > 0) {
            const transferRes = await this.transferRollsToNewWorkOrderTx(tx, {
              sourceWorkOrderId: id,
              rolls: transferRolls,
              stepSeqById,
              orderMode: data.transferOrderMode ?? "stock",
              userId,
            });
            transferredWoNumber = transferRes.workOrderNumber;
            transferredBypassRepointed = transferRes.bypassRepointed;
            for (const r of transferRolls) {
              appliedRows.push({
                rollId: r.id,
                barcode: r.barcode,
                from: r.status,
                to: r.status,
                action: "TRANSFER",
              });
            }
          }

          // 2) STATÜ DİSPOZİSYONLARI — ORTAK MOTOR (`applyRollDispositionsTx`).
          //
          // Eskiden burada per-top bir döngü vardı ve aynı kararı iptal / parti
          // düşürme yolları KENDİ kopyalarıyla uyguluyordu. Üç kopya, aynı kelimeye
          // ("Hatalı kayıt") üç farklı hareket satırı yazma riski demekti.
          //
          // ⚠️ BU TAŞIMA İKİ DAVRANIŞI BİLİNÇLİ OLARAK DEĞİŞTİRİR (`CANCELLED`):
          //   • `qtyOut = 0` (storno) — eskiden `qtyIn` yazılıyordu. "Mal hiç yoktu"
          //     diyen bir karar, istasyon iş hacmine metraj yazamaz; `inventory.
          //     softDelete` bu semantiği zaten böyle tanımlamıştı.
          //   • İptal izi kolonları (`cancelledAt/ById/Reason/preCancelStatus`)
          //     artık DOLDURULUR — eskiden boştu, yani kapatmada iptal edilen topun
          //     satırında "neden" yazmıyordu ve geri alma yanlış rafa dönerdi.
          // Diğer dört aksiyonun çıktısı bayt-bayt aynıdır (`qtyOut = qtyIn`,
          // `WO_CLOSE_<AKSİYON>` öneki, barkod ve kalite yazımı).
          //
          // `stepIds` GEÇİLMEZ: kapatma, topun TÜM açık hareketlerini kapatır
          // (eski `where: { rollId, exitedAt: null }` sözleşmesi). İptal ve parti
          // düşürme kendi adımlarıyla sınırlar.
          const statusDispositions = dispositions.filter((d) => d.action !== "TRANSFER");
          if (statusDispositions.length > 0) {
            appliedRows.push(
              ...(await applyRollDispositionsTx(tx, {
                origin: "WO_CLOSE",
                reason,
                reasonCode: cancelReasonCode,
                userId,
                rolls: statusDispositions.map((d) => byId.get(d.rollId)!),
                dispositions: statusDispositions.map((d) => ({
                  rollId: d.rollId,
                  action: d.action as Exclude<CloseDisposition, "TRANSFER">,
                  qualityGradeId: d.qualityGradeId,
                })),
                qualityById,
                generateBarcodes: true,
              })),
            );
          }
        }

        // Bayat açık movement kalmışsa kapat (defansif — WIP yok ama iz temiz olsun).
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          SET "exitedAt" = now(),
              -- qtyIn ÖNCE (istasyon iş-hacmi paritesi — yukarıdaki dispozisyon
              -- kapanışıyla aynı gerekçe): kesilmiş topta currentQty ile kapatmak
              -- üretim raporunda hayalet kayıp yaratır. qtyIn 0/null ise kalan metraj.
              "qtyOut" = COALESCE(m."qtyOut", NULLIF(m."qtyIn", 0), r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", m."weightIn", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_MANUAL_COMPLETE'
                           ELSE m.notes || ' | WO_MANUAL_COMPLETE' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
            AND m."revokedAt" IS NULL
        `;

        // Kalan PENDING/ACTIVE adımları SKIPPED — kapatılan WO adımları kuyruk/WIP
        // istatistiklerinde "içeride" sayılmasın (fason-tamamla / iptal ile aynı).
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "MANUAL_COMPLETE" },
        });

        // Kurşun bypass: kapanış dispozisyonu WO'yu terminal duruma çeker → açık
        // kurşun dağıtımı anlamsız kalır (Tambur'da okutulacak kart artık yok).
        // `force` gerekçesi iptaldeki ile aynı: adımsız/atlanmış hallerde de temizle.
        // İSTASYON GERİ YÜKLENMEZ — kapanmış movement'ların atfı, tablet akışıyla
        // birebir aynı kalsın (dağıtılan kurşun istasyonu hacmi geriye dönük silinmez).
        await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CLOSE", { force: true });

        // ACTIVE refakat kartları COMPLETED (otomatik-tamamlama yollarıyla aynı).
        await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "COMPLETED");

        const done = await tx.workOrder.findUnique({ where: { id } });
        return {
          updated: done!,
          applied: appliedRows,
          transferredWorkOrderNumber: transferredWoNumber,
          bypassRepointed: transferredBypassRepointed,
        };
      }),
    );

    // Audit tx DIŞINDA (best-effort). WO satırı + her top için ayrı iz: kapanış
    // dispozisyonu sabit sebep kodu (`WO_CLOSE_DISPOSITION`) ile ayrıştırılabilir
    // olmalı — 6 ay sonra "bu top depoda ne arıyor" sorusunun cevabı burada.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { workOrderNumber: existing.workOrderNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.COMPLETED,
        manualComplete: true,
        ...(applied.length > 0 ? { dispositionCount: applied.length, reason } : {}),
        ...(transferredWorkOrderNumber ? { transferredTo: transferredWorkOrderNumber } : {}),
        // Devirde MALLA BİRLİKTE taşınan açık kurşun bypass ataması adedi. 0 ise
        // yazılmaz (gürültü); >0 ise "dağıtım kayboldu mu" sorusunun cevabı burada.
        ...(bypassRepointed > 0 ? { bypassRepointed } : {}),
      },
    });
    for (const a of applied) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          event: "WO_CLOSE_DISPOSITION",
          action: a.action,
          from: a.from,
          to: a.to,
          barcode: a.barcode,
          workOrderNumber: existing.workOrderNumber,
          ...(a.action === "TRANSFER" && transferredWorkOrderNumber
            ? { transferredTo: transferredWorkOrderNumber }
            : {}),
          reason,
        },
      });
    }

    const messageParts = [`İş emri manuel kapatıldı: ${existing.workOrderNumber}`];
    if (applied.length > 0) messageParts.push(`${applied.length} top için dispozisyon uygulandı`);
    if (transferredWorkOrderNumber) {
      messageParts.push(`devredilen toplar yeni iş emrinde: ${transferredWorkOrderNumber}`);
    }

    return {
      success: true,
      data: updated,
      message: messageParts.join(" — "),
    };
  }

  /**
   * DEVİR (dispozisyon: TRANSFER) — kapanan WO'da işlemi bitmemiş topları YENİ bir
   * (devam) iş emrine taşır. Şablon: workorder-split `undyedMove` (klon + repoint).
   * Toplar `IN_PRODUCTION` KALIR, barkod/kalite değişmez — üretim sürüyor.
   *
   * `reEntryStepSequence` = taşınan topların EN KÜÇÜK adım sırası; klon o adımdan
   * başlar ve sonrasını içerir, böylece her top `oldToNew` ile kendi adımına oturur.
   *
   * `supersedeEmptiedSourceWorkOrderTx` BİLİNÇLİ olarak çağrılmaz: kaynak WO bu
   * çağrıda COMPLETED'a claim edildi; SUPERSEDED'e çekmek claim'i bozar ve "malzemesi
   * devredildi" yanlış anlamını verir (burada malzemenin bir kısmı devrediliyor).
   *
   * Döner: yeni iş emri numarası + taşınan açık kurşun bypass ataması adedi.
   */
  private async transferRollsToNewWorkOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      sourceWorkOrderId: string;
      rolls: Array<{
        id: string;
        currentStepId: string | null;
        currentQty: Prisma.Decimal | null;
        batchId: string | null;
      }>;
      stepSeqById: Map<string, number>;
      orderMode: "stock" | "keep";
      userId?: string;
    },
  ): Promise<{ workOrderNumber: string; bypassRepointed: number }> {
    const { sourceWorkOrderId, rolls, stepSeqById, orderMode, userId } = params;
    const rollIds = rolls.map((r) => r.id);

    const sequences = rolls.map((r) => stepSeqById.get(r.currentStepId as string));
    if (sequences.some((s) => s === undefined)) {
      throw AppError.conflict("Devredilecek top bu iş emrinin bir adımında değil — listeyi yenileyin");
    }
    const reEntryStepSequence = Math.min(...(sequences as number[]));
    const movedTotalQty = rolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const src = await tx.workOrder.findUnique({
      where: { id: sourceWorkOrderId },
      select: { targetColorId: true },
    });

    const { newWo, oldToNew, newReEntryStepId } = await cloneWorkOrderTx(tx, {
      sourceWorkOrderId,
      reEntryStepSequence,
      targetColorId: src?.targetColorId ?? null,
      orderMode,
      movedTotalQty,
      userId,
    });

    // Her top KENDİ adımının klonuna taşınır (hepsi aynı adımda olmak zorunda değil).
    for (const roll of rolls) {
      const newStepId = oldToNew.get(roll.currentStepId as string);
      if (!newStepId) {
        throw AppError.conflict("Yeni iş emrinde hedef adım bulunamadı (rota kopyası tutarsız)");
      }
      const claim = await tx.roll.updateMany({
        where: {
          id: roll.id,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: roll.currentStepId,
          shipmentId: null,
          sackId: null,
        },
        data: { currentStepId: newStepId },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Devredilecek top bu sırada değişti — yenileyip tekrar deneyin");
      }
    }

    // Ayak izi (movement/operation/error) yeni WO'nun adımlarına repoint — aksi hâlde
    // kaynak WO'nun adımları "hâlâ bekleyen top var" sanır.
    await repointRollsTx(tx, rollIds, oldToNew);

    // Kurşun bypass ataması da MALLA BİRLİKTE taşınır: mal fiziksel olarak hâlâ
    // aynı kurşun makinesinde, yalnız iş emri değişti. `stepMap` TAŞINAN topların
    // adımlarıyla SÜZÜLÜR — `oldToNew`'in tamamı verilseydi, topu devredilmemiş
    // bir adımın ataması da yeni WO'ya kaçardı (kaynakta o iş sürüyor olabilir).
    // ⚠️ Bu çağrı, kapanış akışının sonundaki force-void'den ÖNCE koşmak ZORUNDA:
    // taşınan satır artık hedef WO id'si taşır, force-void (kaynak WO id'siyle)
    // onu görmez; ters sırada atama önce iptal edilir ve taşınacak satır kalmaz.
    const movedStepIds = new Set(
      rolls.map((r) => r.currentStepId).filter((x): x is string => !!x),
    );
    const transferStepMap = new Map(
      [...oldToNew].filter(([oldStepId]) => movedStepIds.has(oldStepId)),
    );
    const bypassRepointed = await repointPendingBypassAssignmentsTx(tx, {
      sourceWorkOrderId,
      targetWorkOrderId: newWo.id,
      stepMap: transferStepMap,
    });

    // Kısmi seçim olduğu için parti TAŞINMAZ: yeni WO'da yeni parti doğar, kaynak
    // parti izsiz boşaldıysa silinir (manual-move'un kısmi taşıma yolu ile aynı).
    const sourceBatchIds = Array.from(
      new Set(rolls.map((r) => r.batchId).filter((b): b is string => !!b)),
    );
    await createBatchTx(tx, {
      workOrderId: newWo.id,
      rollIds,
      splitFromId: sourceBatchIds.length === 1 ? sourceBatchIds[0] : null,
      userId,
    });
    for (const batchId of sourceBatchIds) {
      await deleteIfEmptyAndTracelessTx(tx, batchId);
    }

    await recomputeStepStatus(tx, newReEntryStepId);

    return { workOrderNumber: newWo.workOrderNumber, bypassRepointed };
  }

  /**
   * Soft-delete: arşivler — `isActive=false` yapar.
   *
   * Geçmiş (RollOperation, RollMovement, TravelerCard + scan, Manifest, Swatch,
   * SubcontractorDispatch/Receipt, WorkOrderStep, WorkOrderToOrderLine)
   * silinmez — izlenebilirlik ve audit için saklanır. Listeler arşivli WO'yu
   * gizler; detay endpoint (findById) hala görüntüler.
   *
   * Roll kurtarma: bu WO'nun adımlarına bağlı (currentStepId) topları STOCK'a
   * geri çeker ki yeni üretimde tekrar kullanılabilsin. `producedInStepId`
   * lineage olarak korunur (FK hala valid — step silinmedi).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: { select: { id: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.IN_PROGRESS) {
      throw AppError.conflict(
        "Üretimdeki iş emri arşivlenemez. Önce iptal edin."
      );
    }

    if (!existing.isActive) {
      throw AppError.conflict("Bu iş emri zaten arşivli.");
    }

    const stepIds = existing.steps.map((s) => s.id);

    const archived = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: tx başında WO satırını write-kilitle + "arşivlenebilir"
      // (isActive + IN_PROGRESS değil) olduğunu iddia et. tx-DIŞI ön-kontrol
      // (2520/2526) UX; eşzamanlı bir geçiş WO'yu IN_PROGRESS yaparsa ya da başka
      // bir istek aynı anda arşivlerse bu claim count===0 → 409 (çift-arşiv / çift
      // top-geri-çekme önlenir). Asıl isActive=false yazımı aşağıda kalır.
      const archiveClaim = await tx.workOrder.updateMany({
        where: { id, isActive: true, status: { not: WorkOrderStatus.IN_PROGRESS } },
        data: { updatedAt: new Date() },
      });
      if (archiveClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { isActive: true, status: true },
        });
        throw AppError.conflict(
          fresh && !fresh.isActive
            ? "İş emri bu sırada arşivlendi."
            : "İş emri bu sırada üretime geçti, arşivlenemez. Önce iptal edin."
        );
      }

      if (stepIds.length > 0) {
        // Aktif üretimdeki topları STOCK'a geri çek (currentStepId null,
        // status STOCK). producedInStepId KORUNUR — lineage; step kaydı
        // hala DB'de (soft delete). Bu sayede ileride "bu top hangi WO'dan
        // çıktı?" sorgusu cevap verir.
        // Damga flip'ten ÖNCE (gerekçe: `softDelete` yolundaki aynı not).
        const arsivTopWhere = {
          currentStepId: { in: stepIds },
          status: RollStatus.IN_PRODUCTION,
        } satisfies Prisma.RollWhereInput;
        await warehouseStampWhereTx(tx, arsivTopWhere);
        await tx.roll.updateMany({
          where: arsivTopWhere,
          data: {
            status: RollStatus.STOCK,
            currentStepId: null,
          },
        });

        // M-12: arşivlenen WO'nun açık movement'larını kapat + adımları
        // terminal duruma çek (softDelete ile aynı gerekçe).
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          SET "exitedAt" = now(),
              "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_ARCHIVED'
                           ELSE m.notes || ' | WO_ARCHIVED' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
            AND m."revokedAt" IS NULL
        `;
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "WO_ARCHIVED" },
        });
      }

      // ACTIVE refakat kartı VOID edilir — quickStart zero-attach telafisi ve
      // planlamacı arşivi DB'de arşivli WO'ya bağlı hayalet ACTIVE kart
      // bırakmasın (softDelete'teki bloğun simetriği).
      await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_ARCHIVED" });

      return tx.workOrder.update({
        where: { id },
        // clientToken serbest bırakılır: zero-attach telafisi sonrası operatör
        // AYNI form oturumundan (aynı token) düzeltip tekrar denediğinde taze
        // create arşivli WO'nun token'ına çarpmasın.
        data: { isActive: false, clientToken: null },
      });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: {
        batchNumber: existing.workOrderNumber,
        type: existing.type,
        status: existing.status,
        stepCount: existing.steps.length,
      },
      newData: { isActive: false, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: archived,
      message: `İş emri arşivlendi: ${existing.workOrderNumber}`,
    };
  }

  /**
   * Attach rolls to a work order by barcode scan.
   * Business Rule: Rolls must be in STOCK status.
   * Changes status to IN_PRODUCTION and links to first step.
   */
  async attachRolls(
    workOrderId: string,
    rawBarcodes: string[],
    userId?: string
  ): Promise<ApiResponse<{ attached: number; errors: string[]; batch: { id: string; batchNumber: string } | null }>> {
    // Okutulan kod DEPOLANMIŞ biçime çekilir — el tarayıcısı küçük harf
    // gönderebiliyor (2026-08-17 saha vakası; bkz. normalizeScanCode).
    const barcodes = rawBarcodes.map(normalizeScanCode).filter(Boolean);
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          orderBy: { stepSequence: "asc" },
          include: { station: { select: { type: true } } },
        },
      },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emrine top bağlanamaz.",
      );
    }

    if (wo.steps.length === 0) {
      throw AppError.badRequest("İş emrinde rota adımı tanımlanmamış");
    }

    const firstStep = wo.steps[0];
    const firstStepId = firstStep.id;
    // EXTERNAL ilk step (boyahane/fason): roller commit edilir ama henüz fiziksel
    // olarak orada değiller — sevk belgesi oluşturulduğunda RollMovement açılır.
    // INTERNAL ilk step: roller fabrikada, bağlama anında ilk adıma giriş yaparlar.
    const firstStepIsExternal = firstStep.station.type === "EXTERNAL";

    // Envanterdeki serbest + satılabilir toplar üretime bağlanabilir: ham (STOCK) VE
    // bitmiş depo malı (WAREHOUSE / A1_STOCK). "Her işlem final üretir" modelinde bir depo
    // topu yeni bir WO'ya (örn. zımpara, ya da WAREHOUSE açık kumaşı Tambur'a) sokulabilir;
    // bitince finalize depoya geri döndürür. Çuval/sevkiyattaki top hariç (F5: aşağıdaki
    // doğrulama + atomik claim'de sackId/shipmentId null guard'ı).
    const acceptedRollStatuses: RollStatus[] = [RollStatus.STOCK, RollStatus.WAREHOUSE, RollStatus.A1_STOCK];

    // Faz 1.1: tx withBarcodeRetry ile sarıldı — bugün içeride @unique üretimi yok
    // (no-op); parti modeli geçişinde tx'e P (parti) + RK (kart) sequence üretimi
    // girecek, "sequence okuma closure İÇİNDE" iskeleti şimdiden hazır. Sonuç dizileri
    // closure İÇİNDE tanımlı — retry mükerrer biriktirmesin.
    const { attached, errorMessages, batchRes } = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İŞİ (2026-08-29 / BULGU-T1-004): iş emri satırını KİLİTLE
      // ve durumunu TAZE doğrula. Statü tx DIŞINDA okunuyordu: planlamacı iş
      // emrini iptal ederken operatör "Yeniden Üretime Al" basarsa 3 top
      // İPTAL EDİLMİŞ iş emrinin adımına IN_PRODUCTION olarak bağlanıyor,
      // hareket açılıyor, parti doğuyor ve `ensureWorkOrderInProgress` sessiz
      // no-op yapıyordu — İKİ istek de success. Satılabilir bitmiş depo malı
      // hiçbir yüzeyde bulunamaz hâle geliyordu (depo ekranında yok, tablette
      // okutulamaz çünkü kart VOIDED, iş emri iptal göründüğü için kimse
      // aramaz). CLAUDE.md'nin `manualMove` için BİLEREK engellediği "canlı ama
      // kimsenin okutamadığı top" çıkmazının aynısı.
      // Kilit ayrıca sırayı fason ailesiyle hizalar (ABBA kolu kapanır).
      await touchWorkOrderTx(tx, workOrderId);
      const woFresh = await tx.workOrder.findUnique({
        where: { id: workOrderId },
        select: { status: true, workOrderNumber: true },
      });
      if (
        woFresh &&
        (woFresh.status === WorkOrderStatus.CANCELLED || woFresh.status === WorkOrderStatus.SUPERSEDED)
      ) {
        throw AppError.conflict(
          `${woFresh.workOrderNumber} iş emri bu sırada ${
            woFresh.status === WorkOrderStatus.CANCELLED ? "iptal edildi" : "devredildi"
          } — top bağlanamaz. Listeyi yenileyin.`,
          { code: "WORKORDER_TERMINAL_DURING_ATTACH" },
        );
      }
      const attached: { id: string; barcode: string | null; prevStatus: RollStatus; qtyIn: number }[] = [];
      const errorMessages: string[] = [];
      // Bu attach dalgasının doğurduğu parti (K3) — succeeded>0 ise dolar.
      // Retry mükerrer biriktirmesin diye closure İÇİNDE tanımlı (Faz 1.1 deseni).
      let batchRes: CreateBatchResult | null = null;
      // 1) Tüm rulolar tek query'de — N round-trip yerine 1.
      const rolls = await tx.roll.findMany({
        where: { barcode: { in: barcodes } },
      });
      const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

      // 2) Per-barkod validation — bellek üstünde, query yok.
      const candidates: typeof rolls = [];
      for (const barcode of barcodes) {
        const roll = byBarcode.get(barcode);
        if (!roll) {
          errorMessages.push(`${barcode}: Barkod bulunamadı`);
          continue;
        }
        if (!acceptedRollStatuses.includes(roll.status)) {
          errorMessages.push(
            `${barcode}: Top uygun durumda değil (mevcut: ${roll.status}, beklenen: ${acceptedRollStatuses.join("/")})`
          );
          continue;
        }
        // F5: WAREHOUSE/A1 topu bir çuvalda/sevkiyatta olabilir → üretime alınamaz.
        if (roll.sackId != null || roll.shipmentId != null) {
          errorMessages.push(`${barcode}: Top bir çuvalda/sevkiyatta — önce oradan çıkarın`);
          continue;
        }
        candidates.push(roll);
      }

      if (candidates.length > 0) {
        const candidateIds = candidates.map((r) => r.id);

        // 3) Atomik bulk claim — status guard race condition'ı yakalar. RETURNING
        //    ile FİİLEN BİZİM kazandığımız id'ler döner.
        //
        //    NEDEN updateManyAndReturn (yeniden-sorgu DEĞİL): eskiden count
        //    beklenenden azsa kazanan küme `{id in candidateIds, status:
        //    IN_PRODUCTION, producedInStepId: firstStepId}` ile TAHMİN ediliyordu.
        //    Bu filtre eşzamanlı ikinci bir attach çağrısının AYNI adıma commit
        //    ettiği topu bizden ayırt edemez (READ COMMITTED'de commit'li satır
        //    görünür) → başkasının topu bizim kümemize sızardı. Sonuç: aşağıdaki
        //    rollMovement.createMany `roll_movements_one_open_per_roll_step_uq`
        //    partial unique'ine çarpar (P2002) ve TÜM tx düşer — operatör temiz
        //    "başka işlemde değişti" mesajı yerine 500 görürdü; ayrıca
        //    createBatchTx sahibi olmadığımız topa batchId damgalardı.
        const claimed = await tx.roll.updateManyAndReturn({
          where: {
            id: { in: candidateIds },
            status: { in: acceptedRollStatuses },
            sackId: null,
            shipmentId: null,
          },
          data: {
            status: RollStatus.IN_PRODUCTION,
            producedInStepId: firstStepId,
            currentStepId: firstStepId,
          },
          select: { id: true },
        });

        // 4) Kaybedilen toplar (varsa) tek tek raporlanır.
        const claimedIds = new Set(claimed.map((r) => r.id));
        const succeeded =
          claimedIds.size === candidates.length
            ? candidates
            : candidates.filter((r) => claimedIds.has(r.id));

        // DEPO DEFTERİ — üretime alma bir ÇIKIŞTIR: mal raftan iniyor. Yön ve
        // metraj claim ÖNCESİ durumdan okunur (`candidates` tx içinde tazedir);
        // claim sonrası statü artık IN_PRODUCTION'dır ve "nereden çıktı"yı söylemez.
        // Yazıcı TEK (`production-issue-ledger.helper`): manuel taşıma · elle top ·
        // redye ayırma aynı yüklemi ve aynı satırı yazar (2026-09-13, hüküm §5).
        await postProductionIssuesTx(tx, succeeded, { workOrderStepId: firstStepId, userId: userId ?? null });
        if (claimedIds.size !== candidates.length) {
          for (const r of candidates) {
            if (!claimedIds.has(r.id)) {
              errorMessages.push(
                `${r.barcode}: Top başka bir işlemde değişti, tekrar deneyin`
              );
            }
          }
        }

        if (succeeded.length > 0) {
          // 5) Bulk movement insert — sadece INTERNAL ilk step için.
          //    EXTERNAL'da fiziksel sevk olmadan step'in ACTIVE olması yanlış
          //    ("Boyahane'de" gibi görünür) → movement dispatch anında açılır.
          if (!firstStepIsExternal) {
            await tx.rollMovement.createMany({
              data: succeeded.map((r) => ({
                rollId: r.id,
                workOrderStepId: firstStepId,
                qtyIn: r.currentQty,
                weightIn: r.weightKg,
                operatorId: userId ?? null,
              })),
            });
          }

          for (const r of succeeded) {
            attached.push({
              id: r.id,
              barcode: r.barcode,
              prevStatus: r.status,
              qtyIn: Number(r.currentQty),
            });
          }

          // Parti doğuşu (K3): bu attach dalgası YENİ bir parti oluşturur; sahiplenilen
          // toplara batchId damgalanır + refakat kartı (RK) basılır. (Faz 2: her attach =
          // yeni parti; K4 "mevcut sevksiz partiye ekle" Faz 4'te targetBatchId ile gelir.)
          batchRes = await createBatchTx(tx, {
            workOrderId,
            rollIds: succeeded.map((r) => r.id),
            userId,
          });
        }
      }

      // INTERNAL ilk step: bağlama = üretim başlangıcı → step ACTIVE + WO IN_PROGRESS.
      // EXTERNAL ilk step: roller henüz fasona gönderilmedi → step PENDING + WO PLANNED
      //                    olarak kalmalı; dispatch oluşturulunca ikisi de güncellenir.
      if (attached.length > 0 && !firstStepIsExternal) {
        await recomputeStepStatus(tx, firstStepId);
        await ensureWorkOrderInProgress(tx, workOrderId);
      }

      return { attached, errorMessages, batchRes };
    }));

    // Audit log'lar tx dışında, TEK createMany ile (eski N ayrı INSERT yerine).
    // R8 fix: recordId roll.id (UUID), barcode newData'ya meta olarak gidiyor.
    await AuditService.logMany(
      attached.map((r) => ({
        userId,
        action: "UPDATE" as const,
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: r.prevStatus },
        newData: {
          status: "IN_PRODUCTION",
          workOrderId,
          firstStepId,
          barcode: r.barcode,
          qtyIn: r.qtyIn,
        },
      }))
    );

    // Parti + kart audit'i tx DIŞINDA (F273): bu dalga bir parti doğurduysa yaz.
    if (batchRes) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "BATCH",
        recordId: batchRes.batch.id,
        newData: {
          batchNumber: batchRes.batch.batchNumber,
          workOrderId,
          rollCount: attached.length,
        },
      });
      // Kart audit'i YOK — kart parti doğuşunda değil, iş emri açılışında üretilir.
    }

    return {
      success: true,
      data: {
        attached: attached.length,
        errors: errorMessages,
        batch: batchRes
          ? { id: batchRes.batch.id, batchNumber: batchRes.batch.batchNumber }
          : null,
      },
      message: `${attached.length} top iş emrine bağlandı`,
    };
  }

  /**
   * İş emrinin temel alanlarını günceller. Planlamacının kontrolünde — üretim
   * sırasında değişikliklere izin verilir (örn. boyahane mavi yerine kırmızı
   * boyasın denildi → targetColorId değişir; henüz colorId almamış rulolar
   * Fason Kabul'de yeni rengi otomatik alır). Sadece COMPLETED/CANCELLED
   * iş emirlerinde değişiklik yapılamaz (geriye dönük tutarlılık).
   *
   * Steps/orderLinks/targetProperties gibi koleksiyonlar bu endpoint'in
   * scope'unda DEĞİL — onlar için `replace`/`updateStepPlanning`/
   * `updateTargetProperties` kullan.
   */
  async update(
    id: string,
    data: {
      batchNumber?: string;
      width?: number | null;
      targetQuantity?: number | null;
      targetWeight?: number | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      targetItemId?: string | null;
      targetColorId?: string | null;
      foldType?: string | null;
    },
    userId?: string,
    /** Renk değişikliğinde kısmi-boya onayı (409 `COLOR_PARTIAL_CONFIRM` sonrası tekrar). */
    opts: { confirmPartial?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emri düzenlenemez.",
      );
    }
    // Renk gerçekten değişiyor mu — TEK BEKÇİ yalnız gerçek değişiklikte koşar
    // (PATCH kısmi semantiği: aynı değeri yeniden göndermek serbesttir).
    const colorChanging =
      data.targetColorId !== undefined &&
      (wo.targetColorId ?? null) !== (data.targetColorId ?? null);
    const colorWarnings: string[] = [];

    // Kat katalog doğrulaması — kilit karşılaştırmalarından ÖNCE kanonikleştir.
    // Sonra yapılsaydı "tüp" gönderen istemci, WO'da "TÜP" dururken alanı
    // DEĞİŞMİŞ sayılır ve hiç dokunmadığı bir alandan kilit hatası alırdı.
    await applyFoldTypeForWriteInPlace(data as Record<string, unknown>);

    // ── Fiziksel taahhüt kilitleri (replace() ile AYNI kurallar — PUT/PATCH
    // drift'i kapatıldı: bu yol mobil düzenlemede aktif kullanılıyor). PATCH
    // kısmi semantik: yalnız GÖNDERİLEN ve fiilen DEĞİŞEN alan kilide çarpar;
    // değişmeyen alanın yeniden gönderilmesi serbesttir (bayat form zararsız).
    const locks = await computeWorkOrderLocks(prisma, id);
    if (
      // F59: null'a çekme de kilide çarpmalı (width artık NULL yazılabildiğinden);
      // `!= null` kilitli en'in NULL'lanmasını kaçırıyordu → `!== undefined`.
      data.width !== undefined &&
      normNum(wo.width) !== normNum(data.width) &&
      locks.width
    ) {
      throw AppError.conflict(locks.reasons.width ?? "En kilitli.");
    }
    if (
      data.targetItemId !== undefined &&
      (wo.targetItemId ?? null) !== (data.targetItemId ?? null) &&
      locks.targetItem
    ) {
      throw AppError.conflict(locks.reasons.targetItem ?? "Hedef ürün kilitli.");
    }
    // Renk: TEK BEKÇİ (2026-08-21, `workorder-target-color.helper`) — terminal
    // statü + renk aktif + izinli renk listesi + boya-bitti kilidi + kısmi-boya
    // onayı + rota kapsaması uyarısı. "Rengi Değiştir" ucu da aynı bekçiden geçer;
    // eskiden kilit yalnız buradaydı ve öbür kapı onu atlıyordu.
    if (colorChanging) {
      const gate = await assertTargetColorChange(prisma, wo, data.targetColorId ?? null, {
        confirmPartial: opts.confirmPartial,
      });
      colorWarnings.push(...gate.warnings);
    }
    if (
      data.foldType !== undefined &&
      (wo.foldType ?? null) !== (data.foldType ?? null) &&
      locks.foldType
    ) {
      throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");
    }

    // STOCK_PRODUCTION'da targetItemId zorunlu — null'a çevirme yasak
    if (wo.type === "STOCK_PRODUCTION" && data.targetItemId === null) {
      throw AppError.badRequest(
        "Stoğa üretim iş emrinde hedef ürün boş bırakılamaz."
      );
    }
    // Hedef ürünü bu karta ÇEVİRMEK yeni üretim planıdır (A3); değişmeyen hedef kontrol edilmez.
    const retargetItemId =
      data.targetItemId && data.targetItemId !== (wo.targetItemId ?? null) ? data.targetItemId : null;
    if (retargetItemId) await assertItemUsable(prisma, retargetItemId, "NEW_PLAN");
    if (data.targetColorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.targetColorId },
        select: { isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
      }
    }

    // Hedef ürün/renk değişiyorsa ürünün izinli renk listesi doğrulanır
    // (dolu = bu listeden; boş = sınırsız — create/replace ile aynı kural).
    const finalItemId =
      data.targetItemId === undefined ? wo.targetItemId : data.targetItemId;
    const finalColorId =
      data.targetColorId === undefined ? wo.targetColorId : data.targetColorId;
    const targetPairChanged =
      (data.targetItemId !== undefined &&
        (wo.targetItemId ?? null) !== (data.targetItemId ?? null)) ||
      (data.targetColorId !== undefined &&
        (wo.targetColorId ?? null) !== (data.targetColorId ?? null));
    if (targetPairChanged && finalItemId && finalColorId) {
      const itemFull = await prisma.item.findUnique({
        where: { id: finalItemId },
        select: { allowedColors: { select: { colorId: true } } },
      });
      const allowedColorSet = new Set(
        (itemFull?.allowedColors ?? []).map((c) => c.colorId),
      );
      if (allowedColorSet.size > 0 && !allowedColorSet.has(finalColorId)) {
        throw AppError.badRequest(
          "Hedef renk bu ürünün izinli renk listesinde değil",
        );
      }
    }

    // Parti kodu değiştiriliyorsa benzersizliğini doğrula (kendini hariç tut).
    if (
      data.batchNumber &&
      data.batchNumber.trim().length > 0 &&
      data.batchNumber.trim() !== wo.workOrderNumber
    ) {
      await this.assertWorkOrderNumberUnique(data.batchNumber.trim(), id);
    }

    // ATOMİK CLAIM (check-then-act DEĞİL): terminal-durum reddini yazmanın WHERE'ine
    // koy. tx-DIŞI ön-kontrol (2815-2822) UX; eşzamanlı finalize WO'yu COMPLETED
    // yaparsa bu updateMany count===0 → 409 (terminal WO'ya alan yazımı engellenir).
    await prisma.$transaction(async (tx) => {
      // İLK ifade (WO satır kilidinden ÖNCE — birleştirme 8030 EXCL tutup WO satırı ister).
      if (retargetItemId) await assertItemUsableTx(tx, retargetItemId, "NEW_PLAN");
      // F58: WO satırını kilitle → locks'u kilit ALTINDA taze hesapla ve kilit
      // guard'larını yeniden doğrula. 3085'teki tx-DIŞI locks eşzamanlı adım-tamamlama/
      // sevkle bayatlayabilir; bu turda finishStep/finalize/createOpenFabric/cutOpenFabric
      // WO satırını kilitlediğinden ara-adım geçişleri de bu kilitle serileşir.
      await touchWorkOrderTx(tx, id);
      const freshLocks = await computeWorkOrderLocks(tx, id);
      // F59: tx-içi taze kilit kontrolü de `!== undefined` (NULL'a çekme kilide çarpsın).
      if (data.width !== undefined && normNum(wo.width) !== normNum(data.width) && freshLocks.width) {
        throw AppError.conflict(freshLocks.reasons.width ?? "En kilitli.");
      }
      if (
        data.targetItemId !== undefined &&
        (wo.targetItemId ?? null) !== (data.targetItemId ?? null) &&
        freshLocks.targetItem
      ) {
        throw AppError.conflict(freshLocks.reasons.targetItem ?? "Hedef ürün kilitli.");
      }
      if (colorChanging) {
        // Kilit ALTINDA taze bekçi: arada fason kabul / adım bitişi olduysa kilit ya da
        // kısmi-boya kararı değişmiş olabilir (F58 deseni). Onay pre-tx ile aynı.
        await assertTargetColorChange(tx, wo, data.targetColorId ?? null, {
          confirmPartial: opts.confirmPartial,
        });
      }
      if (
        data.foldType !== undefined &&
        (wo.foldType ?? null) !== (data.foldType ?? null) &&
        freshLocks.foldType
      ) {
        throw AppError.conflict(freshLocks.reasons.foldType ?? "Kat tipi kilitli.");
      }
      // ATOMİK CLAIM: terminal-durum reddini yazmanın WHERE'ine koy (kilit altında).
      const updateClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
        },
        data: {
          workOrderNumber: data.batchNumber?.trim() || undefined,
          // F59: null'ı gerçek NULL olarak yaz (gönderilmeyen=undefined ile ayrış);
          // `?? undefined` null'ı sessizce yutup temizlemeyi kaçırıyordu.
          width: data.width === undefined ? undefined : data.width,
          targetQuantity: data.targetQuantity === undefined ? undefined : data.targetQuantity,
          targetWeight: data.targetWeight === undefined ? undefined : data.targetWeight,
          plannedStartDate: data.plannedStartDate
            ? new Date(data.plannedStartDate)
            : data.plannedStartDate === null
              ? null
              : undefined,
          plannedEndDate: data.plannedEndDate
            ? new Date(data.plannedEndDate)
            : data.plannedEndDate === null
              ? null
              : undefined,
          targetItemId: data.targetItemId === undefined ? undefined : data.targetItemId,
          targetColorId: data.targetColorId === undefined ? undefined : data.targetColorId,
          foldType: data.foldType === undefined ? undefined : data.foldType,
        },
      });
      if (updateClaim.count === 0) {
        throw AppError.conflict(
          "İş emri bu sırada tamamlandı veya iptal edildi, düzenlenemez. Sayfayı yenileyin."
        );
      }
      // Kart snapshot'ı bu alanları DONDURUYOR (ürün/renk/en/miktar/kat/tarihler) —
      // WO değişince eldeki kâğıt yanlışlanır. Snapshot yalnız `reprint` ile tazelenir.
      await markTravelerCardDirtyTx(tx, id);
    });
    const updated = await prisma.workOrder.findUnique({ where: { id } });

    // ── ALAN-BAZLI DEĞİŞİKLİK (Faz B2) ────────────────────────────────────
    // İş emri, "kim ne değiştirdi" sorusunun EN ÇOK sorulduğu kayıt. Eskiden
    // yalnız `newData` yazılıyordu (eski değer YOK) → "500 metre demiştik"
    // tartışmasında hangi değerin ne zaman değiştiği gösterilemiyordu.
    const woChanges = diffFields(wo as Record<string, unknown> | null, data as Record<string, unknown>);
    if (woChanges.length > 0) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "WORK_ORDER",
        recordId: id,
        oldData: wo as Record<string, unknown> | null,
        newData: data as Record<string, unknown>,
        changes: woChanges,
      });
    }

    return {
      success: true,
      data: updated!,
      message: "İş emri güncellendi",
      // Engel olmayan notlar (örn. "rotada renk veren adım yok") — istemci toast basar.
      ...(colorWarnings.length > 0 ? { warnings: colorWarnings } : {}),
    };
  }

  /**
   * İş emrini tüm ilişkileri ile birlikte yeniden yazar. Planlamacının
   * kontrolünde — üretim sırasında değişikliklere izin verilir. Sadece
   * COMPLETED/CANCELLED iş emirlerinde yapılamaz.
   *
   * Smart merge stratejisi (rota için):
   * - `steps[i].id` mevcut step'i işaret ediyorsa → güncellenir (notes,
   *   stationId, sequence, requiredCategoryId, plannedSubcontractorId).
   * - `steps[i].id` boşsa → yeni step eklenir.
   * - Mevcut listede olup yeni listede olmayan step → status=PENDING ve
   *   hiçbir bağlı kayıt (rulo, movement, dispatch, vb.) yoksa silinir;
   *   aksi halde "tamamlanmış/aktif/bağlı adım silinemez" hatası.
   *
   * orderLinks ve targetProperties drop-and-recreate.
   */
  async replace(
    id: string,
    data: WorkOrderCreateInput,
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } } },
    });
    if (!existing) throw AppError.notFound("İş emri bulunamadı");
    if (
      existing.status === WorkOrderStatus.COMPLETED ||
      existing.status === WorkOrderStatus.CANCELLED ||
      existing.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emri düzenlenemez.",
      );
    }

    // Kat katalog doğrulaması — kilit karşılaştırmalarından ÖNCE (update ile
    // aynı gerekçe: kanonikleştirme sonra yapılırsa değişmemiş alan kilide çarpar).
    await applyFoldTypeForWriteInPlace(data as Record<string, unknown>);

    // ── Fiziksel taahhüt kilitleri ──────────────────────────────────────────
    // Sevk gittiyse / herhangi adım başladıysa kumaş/en/metraj artık değişmez.
    // Renk/özellik/kat tipi her birinin istasyonu adımı bitmediyse editable.
    const locks = await computeWorkOrderLocks(prisma, id);

    if (
      normNum(existing.width) !== normNum(data.width) &&
      locks.width
    ) {
      throw AppError.conflict(locks.reasons.width ?? "En kilitli.");
    }
    // targetQuantity bilinçli "fazla gönderdik / az kaldı" durumlarında
    // değişebilir; fazla mal Tambur'da stok kalır, eksik kalan yeni sevkle
    // tamamlanır. Backend yalnızca uyumsuz sipariş bağlamayı engeller.
    if (
      (existing.targetItemId ?? null) !== (data.targetItemId ?? null) &&
      locks.targetItem
    ) {
      throw AppError.conflict(
        locks.reasons.targetItem ?? "Hedef ürün kilitli.",
      );
    }
    if (
      (existing.targetColorId ?? null) !== (data.targetColorId ?? null) &&
      locks.targetColor
    ) {
      throw AppError.conflict(
        locks.reasons.targetColor ?? "Hedef renk kilitli.",
      );
    }
    if (
      (existing.foldType ?? null) !== (data.foldType ?? null) &&
      locks.foldType
    ) {
      throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");
    }

    // Özellik diff: kilitli özelliği kaldırma yasak; eklenen özelliğin
    // applicable (route'ta + COMPLETED olmayan istasyon var) olması zorunlu.
    if (data.targetPropertyIds) {
      const existingPropIds = new Set(
        existing.targetProperties.map((p) => p.propertyId),
      );
      const incomingSet = new Set(data.targetPropertyIds);
      for (const lockedId of locks.lockedPropertyIds) {
        if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
          throw AppError.conflict(
            locks.reasons.properties?.[lockedId] ??
              "Bu özellik artık kaldırılamaz.",
          );
        }
      }
      const applicableSet = new Set(locks.applicablePropertyIds);
      for (const newId of data.targetPropertyIds) {
        if (existingPropIds.has(newId)) continue;
        if (!applicableSet.has(newId)) {
          throw AppError.conflict(
            "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
          );
        }
      }
    }

    let type = (data.type as WorkOrder["type"]) ?? existing.type;

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) — create() ile aynı.
    // `id?` smart-merge için propagasyonla taşınır; routeTemplate'tan gelenler id'siz.
    let finalSteps: {
      id?: string;
      stationId: string;
      notes: string | null;
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      dispatchWithoutColor?: boolean;
    }[] = [];

    if (data.routeTemplateId) {
      if (data.steps && data.steps.length > 0) {
        throw AppError.badRequest(
          "Aynı anda hem routeTemplateId hem steps veremezsiniz. Birini seçin.",
        );
      }
      const template = await prisma.route.findUnique({
        where: { id: data.routeTemplateId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!template) throw AppError.notFound("Rota şablonu bulunamadı");
      if (!template.isActive) throw AppError.badRequest("Pasif bir rota şablonu kullanılamaz");
      if (template.steps.length === 0) throw AppError.badRequest("Rota şablonunda adım yok");

      const planBySeq = new Map<number, NonNullable<WorkOrderCreateInput["stepPlanning"]>[number]>();
      for (const p of data.stepPlanning ?? []) planBySeq.set(p.sequence, p);

      // Rota şablonu değişmiyorsa mevcut step ID'lerini sequence eşleşmesiyle
      // taşı — aksi halde smart-merge bütün step'leri "yeni" sayıp siler,
      // ACTIVE/COMPLETED step varsa düşer. Kullanıcı sadece tip/sipariş gibi
      // alanları değiştirmek istediğinde de bu yol bug üretiyordu.
      let existingStepIdBySeq = new Map<number, string>();
      if (data.routeTemplateId === existing.routeTemplateId) {
        const rows = await prisma.workOrderStep.findMany({
          where: { workOrderId: id },
          select: { id: true, stepSequence: true },
        });
        existingStepIdBySeq = new Map(rows.map((r) => [r.stepSequence, r.id]));
      }

      finalSteps = template.steps.map((s) => {
        const overlay = planBySeq.get(s.sequence);
        return {
          id: existingStepIdBySeq.get(s.sequence),
          stationId: s.stationId,
          notes: overlay?.notes ?? s.defaultNotes ?? null,
          // Saha #14: şablondaki fason planlaması replace'te de default klonlanır.
          requiredCategoryId: overlay?.requiredCategoryId ?? s.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? s.plannedSubcontractorId ?? null,
          dispatchWithoutColor: overlay?.dispatchWithoutColor ?? s.dispatchWithoutColor ?? false,
        };
      });
    } else {
      if (!data.steps || data.steps.length === 0) {
        throw AppError.badRequest(
          "En az bir rota adımı (steps) veya bir routeTemplateId gerekli",
        );
      }
      finalSteps = data.steps.map((s) => ({
        id: s.id,
        stationId: s.stationId,
        notes: s.notes ?? null,
        requiredCategoryId: s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        dispatchWithoutColor: s.dispatchWithoutColor ?? false,
      }));
    }

    // ── Soft-delete guard (SEC-3, create() ile ortak helper) ────────────────
    await assertRouteRefsActive(finalSteps);

    // ── Sipariş bağları + tahsis miktarları ─────────────────────────────────
    let allocations: { orderLineId: string; allocatedQty: number }[] = [];
    if (data.orderLineAllocations && data.orderLineAllocations.length > 0) {
      allocations = data.orderLineAllocations.map((a) => ({
        orderLineId: a.orderLineId,
        allocatedQty: a.allocatedQty ?? 0,
      }));
    } else if (data.orderLineIds && data.orderLineIds.length > 0) {
      allocations = data.orderLineIds.map((lid) => ({ orderLineId: lid, allocatedQty: 0 }));
    }

    // TİP = BAĞIN AYNASI (2026-08-21) — create() ile aynı kural: satır geldiyse
    // tip STOK olamaz, sunucu çevirir (istemci `type`'ı atlasa da).
    if (allocations.length > 0 && type === "STOCK_PRODUCTION") {
      type = "ORDER_PRODUCTION";
    }

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        "Siparişe özel üretim iş emri en az bir sipariş kalemine bağlanmalıdır.",
      );
    }

    // ── Hedef ürün doğrulaması ───────────────────────────────────────────────
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;

    if (type === "STOCK_PRODUCTION" && !resolvedTargetItemId) {
      throw AppError.badRequest(
        "Stoğa üretim iş emri için hedef ürün seçmelisiniz.",
      );
    }

    // Değişmeyen hedef mevcut işi yürütür (E); yeni hedef create ile aynı kural.
    const replaceItemUsage: ItemUsage =
      resolvedTargetItemId === (existing.targetItemId ?? null) || allocations.length > 0
        ? "EXISTING_GOODS"
        : "NEW_PLAN";
    if (resolvedTargetItemId) await assertItemUsable(prisma, resolvedTargetItemId, replaceItemUsage);

    let resolvedTargetColorId: string | null = data.targetColorId ?? null;
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const orderLineItems = await prisma.orderLine.findMany({
        where: { id: { in: allocations.map((a) => a.orderLineId) } },
        select: {
          id: true, itemId: true, colorId: true,
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor",
          );
        }
        resolvedTargetItemId = onlyItemId;
      } else if (distinctItems.size > 1 && !resolvedTargetItemId) {
        throw AppError.badRequest(
          "Sipariş satırları farklı ürünler içeriyor; hedef ürünü açıkça belirtin",
        );
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
        throw AppError.badRequest(
          "Sipariş satırları farklı renkler içeriyor; hedef rengi açıkça belirtin",
        );
      }
    }

    // ── targetProperties doğrulaması ─────────────────────────────────────────
    /** Engel olmayan planlama notları — yanıtta `warnings` olarak döner. */
    const replaceWarnings: string[] = [];
    let targetPropertyIds = [...new Set(data.targetPropertyIds ?? [])];
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

    if (resolvedTargetItemId) {
      const targetItemFull = await prisma.item.findUnique({
        where: { id: resolvedTargetItemId },
        select: {
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });

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
        await assertTargetablePropertyIds(targetPropertyIds, "iş emri hedef özelliği");
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

      if (resolvedTargetColorId || targetPropertyIds.length > 0) {
        // `replace` de UYARIR, reddetmez — "tek kural" (2026-08-27). Bu yol
        // üçüncü bir kapıydı: create 400 veriyordu, "Rengi Değiştir" uyarıyordu,
        // replace de 400 veriyordu. Üçü de aynı soruyu soruyor.
        //
        // Mal bilgisi BURADA canlıdan okunur (create'te çağıran verir): iş emrine
        // bağlı toplar zaten hedef rengi taşıyorsa uyarı YANLIŞ olurdu.
        const attachedRolls = await prisma.roll.findMany({
          where: { currentStep: { workOrderId: id } },
          select: { colorId: true, properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } } },
        });
        const colorOnGoods =
          attachedRolls.length > 0 &&
          !!resolvedTargetColorId &&
          attachedRolls.every((r) => r.colorId === resolvedTargetColorId);
        const uncoveredProps =
          attachedRolls.length > 0
            ? targetPropertyIds.filter(
                (pid) => !attachedRolls.every((r) => r.properties.some((p) => p.propertyId === pid)),
              )
            : targetPropertyIds;
        replaceWarnings.push(
          ...(await collectRouteCoverageWarnings(finalSteps, {
            color: !!resolvedTargetColorId && !colorOnGoods,
            property: uncoveredProps.length > 0,
          })),
        );
      }
    }

    // Parti kodu değiştiriliyorsa benzersizliğini doğrula (kendini hariç tut).
    if (
      data.batchNumber &&
      data.batchNumber.trim().length > 0 &&
      data.batchNumber.trim() !== existing.workOrderNumber
    ) {
      await this.assertWorkOrderNumberUnique(data.batchNumber.trim(), id);
    }

    const workOrderNumber =
      data.batchNumber && data.batchNumber.trim().length > 0
        ? data.batchNumber.trim()
        : existing.workOrderNumber;

    // ── Transaction: smart merge (steps id-bazlı diff) ───────────────────────
    const updated = await prisma.$transaction(async (tx) => {
      // İLK ifade: 8030 SHARED → kart FOR SHARE (WO satır claim'inden önce, kilit sırası).
      if (resolvedTargetItemId) await assertItemUsableTx(tx, resolvedTargetItemId, replaceItemUsage);
      // ATOMİK CLAIM: tx başında (yıkıcı drop-and-recreate'ten ÖNCE) WO satırını
      // write-kilitle + COMPLETED/CANCELLED'e geçmediğini iddia et. tx-DIŞI
      // ön-kontrol (2978-2985) UX; eşzamanlı son-top finalize bu satırı tx süresince
      // güncelleyemez, önce commit ettiyse count===0 → 409 (terminal WO'nun rotası/
      // bağları ezilmez). Asıl alan yazımı aşağıdaki tx.workOrder.update'te kalır.
      const replaceClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
        },
        data: { updatedAt: new Date() },
      });
      if (replaceClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        throw AppError.conflict(
          `İş emri bu sırada ${
            fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, düzenlenemez. Sayfayı yenileyin.`
        );
      }

      // F58: locks'u WO satır kilidi (replaceClaim) ALTINDA taze hesapla ve kilit
      // guard'larını yeniden doğrula — 3295'teki tx-DIŞI locks eşzamanlı adım-
      // tamamlama/sevkle bayatlayabilir (tx-dışı guard'lar 3297+ yalnız UX fast-fail).
      const freshLocks = await computeWorkOrderLocks(tx, id);
      if (normNum(existing.width) !== normNum(data.width) && freshLocks.width) {
        throw AppError.conflict(freshLocks.reasons.width ?? "En kilitli.");
      }
      if (
        (existing.targetItemId ?? null) !== (data.targetItemId ?? null) &&
        freshLocks.targetItem
      ) {
        throw AppError.conflict(freshLocks.reasons.targetItem ?? "Hedef ürün kilitli.");
      }
      if (
        (existing.targetColorId ?? null) !== (data.targetColorId ?? null) &&
        freshLocks.targetColor
      ) {
        throw AppError.conflict(freshLocks.reasons.targetColor ?? "Hedef renk kilitli.");
      }
      if (
        (existing.foldType ?? null) !== (data.foldType ?? null) &&
        freshLocks.foldType
      ) {
        throw AppError.conflict(freshLocks.reasons.foldType ?? "Kat tipi kilitli.");
      }
      // ── Hedef özellik kapısı — tx İÇİNDE TAZE aktif küme (plan §3.2, 2026-09-14) ──
      // ① KİLİTLİ mevcut hedef çözülmüş listeye DAİMA BİRLEŞTİRİLİR: istemci alanı
      //    göndermese (`undefined` → STOCK'ta boş / ORDER'da sipariş satırından türer)
      //    bile kilitli hedef sessizce DÜŞMEZ (eski sessiz silme yolu) ve türetilmiş
      //    listede kilit kapısı hiç ateşlenemez (kalıcı 409 üretmez).
      // ② Kapsama (applicable) kapısı yalnız DELTA'ya: zaten yazılı satır için 409 yok.
      // ③ Fark bazlı + damgalı yazım (Y7): çıkan `WO_REPLACE` ile damgalanır, giren
      //    yazılır, değişmeyen satıra dokunulmaz.
      const freshTargets = await tx.workOrderTargetProperty.findMany({
        where: { workOrderId: id, ...ACTIVE_TARGET_PROPERTY },
        select: { propertyId: true },
      });
      const freshTargetIds = new Set(freshTargets.map((p) => p.propertyId));
      const lockedKept = freshLocks.lockedPropertyIds.filter((pid) => freshTargetIds.has(pid));
      if (data.targetPropertyIds) {
        const incomingSet = new Set(data.targetPropertyIds);
        for (const lockedId of lockedKept) {
          if (!incomingSet.has(lockedId)) {
            throw AppError.conflict(
              freshLocks.reasons.properties?.[lockedId] ??
                "Bu özellik artık kaldırılamaz.",
            );
          }
        }
      }
      const resolvedTargetIds = new Set([...targetPropertyIds, ...lockedKept]);
      const enteringTargetIds = [...resolvedTargetIds].filter((pid) => !freshTargetIds.has(pid));
      const leavingTargetIds = [...freshTargetIds].filter((pid) => !resolvedTargetIds.has(pid));
      {
        const applicableSet = new Set(freshLocks.applicablePropertyIds);
        for (const newId of enteringTargetIds) {
          if (!applicableSet.has(newId)) {
            throw AppError.conflict(
              "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
            );
          }
        }
      }

      // Gevşek model: per-kalem aşırı-tahsis kontrolü YOK (fazla üretim → stok).
      // Yalnız (a) satır varlığı, (b) material committed iken kumaş + en uyumu.
      if (allocations.length > 0) {
        const orderLines = await tx.orderLine.findMany({
          where: { id: { in: allocations.map((a) => a.orderLineId) } },
          select: { id: true, itemId: true, width: true },
        });
        if (orderLines.length !== allocations.length) {
          throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
        }

        // Material committed iken yeni sipariş bağlamada kumaş + en uyumluluğu
        // zorunlu — boyahaneye gönderdiğimiz kumaşı uyumsuz siparişe yamamak yasak.
        // F58: kilit altında taze hesaplanan freshLocks kullan (bayat locks değil).
        if (freshLocks.materialCommitted) {
          // Sadece **yeni** bağlanan satırları kontrol et — mevcut bağlar zaten
          // geçmişten geliyor (en/kumaş kilitli, değişmiyorlar).
          const previousLinkIds = new Set(
            (
              await tx.workOrderToOrderLine.findMany({
                where: { workOrderId: id, ...ACTIVE_ORDER_LINK },
                select: { orderLineId: true },
              })
            ).map((l) => l.orderLineId),
          );
          for (const line of orderLines) {
            if (previousLinkIds.has(line.id)) continue;
            if (line.itemId !== existing.targetItemId) {
              throw AppError.conflict(
                "Sevk yapılmış iş emrine farklı kumaş içeren sipariş bağlanamaz.",
              );
            }
            if (normNum(line.width) !== normNum(existing.width)) {
              throw AppError.conflict(
                "Sevk yapılmış iş emrine farklı eninde sipariş bağlanamaz.",
              );
            }
          }
        }
      }

      // ── Step diff (smart merge) ─────────────────────────────────────────
      // Mevcut step'leri çek + bağlı kayıt sayılarını topla.
      const existingStepRows = await tx.workOrderStep.findMany({
        where: { workOrderId: id },
        select: {
          id: true,
          stepSequence: true,
          status: true,
          stationId: true,
          _count: {
            select: {
              // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): geri alınmış hareket ve operasyon da
              // adımın defter geçmişidir — istasyonu/sırası değişirse "ne oldu" yalan
              // söyler; silmeyi de RESTRICT FK'ları engeller.
              movements: true,
              operations: true,
              cardScans: true,
              dispatches: true,
              receipts: true,
              currentRolls: true,
              producedRolls: true,
              detectedErrors: true,
              processedErrors: true,
              // Kurşun bypass atamaları (append-only, iptal edilse bile satır kalır):
              // sayılmazsa PENDING görünen bir kurşun adımı silinmeye çalışılır ve
              // FK ihlali ham P2003/500 olarak dışarı sızardı. Burada sayılınca
              // aşağıdaki "bağlı kayıt var" 409'una düşer.
              kursunBypasses: true,
            },
          },
        },
      });
      const existingStepById = new Map(existingStepRows.map((s) => [s.id, s]));
      const incomingExistingIds = new Set(
        finalSteps
          .map((s) => s.id)
          .filter((sid): sid is string => !!sid && existingStepById.has(sid)),
      );

      // 1) Yeni listede olmayan eski step'leri sil — sadece PENDING + bağlısız.
      for (const old of existingStepRows) {
        if (incomingExistingIds.has(old.id)) continue;
        if (old.status !== "PENDING") {
          throw AppError.conflict(
            `${old.stepSequence}. adım silinemez — sadece henüz başlamamış (bekleyen) adımlar silinebilir.`,
          );
        }
        const refCount = Object.values(old._count).reduce((a, b) => a + (b as number), 0);
        if (refCount > 0) {
          throw AppError.conflict(
            `${old.stepSequence}. adım silinemez — bu adıma bağlı rulo, hareket (geri alınmışlar dahil), sevk veya kurşun dağıtım kaydı var.`,
          );
        }
        await tx.workOrderStep.delete({ where: { id: old.id } });
      }

      // ⚠️ "BAŞLAMIŞ ADIM" = statü PENDING değil **VEYA** üzerinde hareket var
      // (2026-08-15 denetim düzeltmesi). Eskiden yalnız statüye bakılıyordu ve
      // statü TÜRETİLEN bir alandır: `recomputeStepStatus` bir adımı COMPLETED'tan
      // PENDING'e düşürebilir (o adımdan geçmiş son topun iptali / kapanış
      // dispozisyonu). Adımın `roll_movements` satırları YERİNDE DURUR; guard
      // yalnız statüye baksaydı, üzerinde geçmiş kayıt olan bir adımın İSTASYONU
      // değiştirilebilir ve o adım yeniden sıralanabilir hâle gelirdi → `GET
      // /rolls/:id/history` ve istasyon iş-hacmi raporu, topun HİÇ uğramadığı bir
      // istasyondan geçtiğini söylerdi (hata yok, log yok). Guard'ın kendi
      // gerekçesi zaten "üzerinde açık movement/geçmiş kayıt var" diyordu —
      // yüklem artık o cümleyle birebir aynı şeyi ölçüyor. Silme guard'ı bu sınıfı
      // `refCount`(=_count toplamı) ile zaten kapatıyordu.
      const stepHasStarted = (s: (typeof existingStepRows)[number]): boolean =>
        s.status !== "PENDING" || s._count.movements > 0;

      // 1b) Başlamış adımların GÖRELİ SIRASI değişemez —
      //     COMPLETED bir adım ACTIVE'in arkasına taşınırsa kart okutma ve
      //     "sonraki adım" hesabı (stepSequence) bozulur. Silme zaten guard'lı;
      //     bu kontrol yeniden sıralamayı yakalar. (Araya yeni PENDING adım
      //     eklemek serbesttir — göreli sıra korunur.)
      const startedOldOrder = existingStepRows
        .filter(stepHasStarted)
        .sort((a, b) => a.stepSequence - b.stepSequence)
        .map((s) => s.id);
      const startedNewOrder = finalSteps
        .map((s) => s.id)
        .filter(
          (sid): sid is string =>
            !!sid && existingStepById.has(sid) && stepHasStarted(existingStepById.get(sid)!),
        );
      if (startedOldOrder.join("|") !== startedNewOrder.join("|")) {
        throw AppError.conflict(
          "Başlamış (aktif/tamamlanmış) adımların sırası değiştirilemez.",
        );
      }

      // 2) Step'leri güncelle veya ekle. stepSequence yeni listedeki indeks
      //    bazlı yeniden numaralandırılır. (workOrderId, stepSequence)
      //    üzerinde unique kısıtı olmadığı için iki-aşamalı güncelleme gerekmez.
      for (const [index, incoming] of finalSteps.entries()) {
        const stepSequence = index + 1;
        if (incoming.id && existingStepById.has(incoming.id)) {
          // Başlamış adımın İSTASYONU değişemez (üzerinde açık movement/geçmiş
          // kayıt var — silme guard'ının güncelleme simetriği). Not/kategori/
          // planlanan firma serbest kalır.
          //
          // KURŞUN BYPASS ETKİLEŞİMİ (2026-07-31 — atama MAKİNE bazına geçti):
          // dağıtım artık adımın `stationId`'sini DEĞİŞTİRMEZ. Tek bir PROCESS_QC
          // istasyonu (KURŞUN+KK2) vardır ve atama o istasyonun altındaki fiziksel
          // MAKİNEYE yapılır (`KursunBypassAssignment.machineId`) — istasyon repoint'i
          // ve geri-yükleme zinciri tamamen kalktı. Yani bu guard'ın kurşun bypass'a
          // özel bir görevi KALMADI; kendi gerekçesiyle (başlamış adımın üzerinde açık
          // movement/geçmiş kayıt var) ayakta duruyor. Rota düzenlemesi bir atamayı
          // sessizce bozamaz, çünkü atama adımın istasyonunda değil kendi satırında yaşar.
          const old = existingStepById.get(incoming.id)!;
          if (stepHasStarted(old) && old.stationId !== incoming.stationId) {
            throw AppError.conflict(
              `${old.stepSequence}. adım başlamış — istasyonu değiştirilemez (yalnız not/kategori/planlanan firma güncellenebilir).`,
            );
          }
          await tx.workOrderStep.update({
            where: { id: incoming.id },
            data: {
              stationId: incoming.stationId,
              stepSequence,
              notes: incoming.notes,
              requiredCategoryId: incoming.requiredCategoryId ?? null,
              plannedSubcontractorId: incoming.plannedSubcontractorId ?? null,
              dispatchWithoutColor: incoming.dispatchWithoutColor ?? false,
            },
          });
        } else {
          await tx.workOrderStep.create({
            data: {
              workOrderId: id,
              stationId: incoming.stationId,
              stepSequence,
              notes: incoming.notes,
              requiredCategoryId: incoming.requiredCategoryId ?? null,
              plannedSubcontractorId: incoming.plannedSubcontractorId ?? null,
              dispatchWithoutColor: incoming.dispatchWithoutColor ?? false,
            },
          });
        }
      }

      // ── orderLinks FARK bazlı + damgalı (③a, WOTOL-BAG-DAMGA-PLAN S2): bağ SİLİNMEZ ──
      //    Çıkan bağ `WO_REPLACE` ile damgalanır, giren yeni satır, kalanın `allocatedQty`si
      //    yerinde güncellenir (bağın kimliği ve `createdAt`i = "ne zaman bağlandı" korunur).
      const freshLinks = await tx.workOrderToOrderLine.findMany({
        where: { workOrderId: id, ...ACTIVE_ORDER_LINK },
        select: { id: true, orderLineId: true },
      });
      const wantedAlloc = new Map(allocations.map((a) => [a.orderLineId, a.allocatedQty]));
      const leavingLinks = freshLinks.filter((l) => !wantedAlloc.has(l.orderLineId));
      const keptLinks = freshLinks.filter((l) => wantedAlloc.has(l.orderLineId));
      const enteringAlloc = allocations.filter((a) => !freshLinks.some((l) => l.orderLineId === a.orderLineId));
      if (leavingLinks.length > 0) {
        await unlinkOrderLinesTx(tx, {
          pairs: leavingLinks.map((l) => ({ workOrderId: id, orderLineId: l.orderLineId })),
          reason: "WO_REPLACE",
          userId: userId ?? null,
        });
      }
      for (const l of keptLinks) {
        await tx.workOrderToOrderLine.updateMany({
          where: { id: l.id, ...ACTIVE_ORDER_LINK },
          data: { allocatedQty: wantedAlloc.get(l.orderLineId) ?? 0 },
        });
      }
      if (enteringAlloc.length > 0) {
        await tx.workOrderToOrderLine.createMany({
          data: enteringAlloc.map((a) => ({ workOrderId: id, orderLineId: a.orderLineId, allocatedQty: a.allocatedQty })),
          skipDuplicates: true,
        });
      }
      // ── targetProperties FARK bazlı + damgalı (③a, Y7): silme YOK ──
      if (leavingTargetIds.length > 0) {
        await revokeTargetProperties(tx, {
          workOrderId: id,
          propertyIds: leavingTargetIds,
          reason: "WO_REPLACE",
          userId: userId ?? null,
        });
      }
      if (enteringTargetIds.length > 0) {
        await tx.workOrderTargetProperty.createMany({
          data: enteringTargetIds.map((propertyId) => ({ workOrderId: id, propertyId })),
          skipDuplicates: true,
        });
      }

      const planDates = await resolvePlanDates(
        data.plannedStartDate,
        data.plannedEndDate,
      );

      const wo = await tx.workOrder.update({
        where: { id },
        data: {
          workOrderNumber,
          type,
          width: data.width ?? null,
          targetQuantity: data.targetQuantity ?? null,
          targetWeight: data.targetWeight ?? null,
          parameters: (data.parameters as Prisma.InputJsonValue) ?? undefined,
          plannedStartDate: planDates.plannedStartDate,
          plannedEndDate: planDates.plannedEndDate,
          routeTemplateId: data.routeTemplateId ?? null,
          targetItemId: resolvedTargetItemId,
          targetColorId: resolvedTargetColorId,
          foldType: data.foldType ?? null,
        },
        include: {
          steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: {
            where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" },
            include: {
              orderLine: {
                include: {
                  order: { include: { customer: true } },
                  item: true,
                  color: true,
                },
              },
            },
          },
          routeTemplate: true,
        },
      });

      // `replace` rotayı, sipariş bağlarını ve hedef özellikleri baştan yazar —
      // kart snapshot'ındaki adım listesi/sipariş tablosu topluca yanlışlanır.
      await markTravelerCardDirtyTx(tx, id);

      return wo;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        replace: true,
        batchNumber: updated.workOrderNumber,
        type: updated.type,
        stepCount: finalSteps.length,
        routeTemplateId: updated.routeTemplateId,
        allocationCount: allocations.length,
        targetItemId: updated.targetItemId,
        targetColorId: updated.targetColorId,
        targetPropertyIds,
      },
    });

    return {
      success: true,
      data: updated,
      message: `İş emri güncellendi: ${updated.workOrderNumber}`,
      ...(replaceWarnings.length > 0 ? { warnings: replaceWarnings } : {}),
    };
  }

  /**
   * WO targetProperties güncelle. Bağlı tüm Roll'ların properties'i
   * senkronize edilir. Fiziksel taahhüt kilitleri replace() ile AYNI:
   * istasyonu adımını tamamlamış (fiilen uygulanmış) özellik kaldırılamaz,
   * eklenen özelliği uygulayabilecek açık istasyon rotada olmalı.
   *
   * Frontend bu çağrıdan ÖNCE getRollImpact ile etkilenecek rulo sayısını
   * göstermeli ve onay almalıdır.
   */
  async updateTargetProperties(
    id: string,
    propertyIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ workOrderId: string; affectedRollCount: number }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: {
        id: true,
        targetItemId: true,
        targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } },
        targetItem: {
          select: {
            allowedProperties: { select: { propertyId: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const dedupedIds = [...new Set(propertyIds)];

    // ── Fiziksel taahhüt kilitleri (replace()'teki özellik diff'inin aynısı —
    // bu endpoint eskiden kilitsizdi ve COMPLETED adımda uygulanmış özelliği
    // hem WO'dan hem toplardan silebiliyordu).
    const locks = await computeWorkOrderLocks(prisma, id);
    const existingPropIds = new Set(wo.targetProperties.map((p) => p.propertyId));
    const incomingSet = new Set(dedupedIds);
    for (const lockedId of locks.lockedPropertyIds) {
      if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
        throw AppError.conflict(
          locks.reasons.properties?.[lockedId] ?? "Bu özellik artık kaldırılamaz.",
        );
      }
    }
    const applicableSet = new Set(locks.applicablePropertyIds);
    for (const newId of dedupedIds) {
      if (existingPropIds.has(newId)) continue;
      if (!applicableSet.has(newId)) {
        throw AppError.conflict(
          "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
        );
      }
    }

    if (dedupedIds.length > 0) {
      const propRows = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedIds }, isActive: true },
        select: { id: true, name: true },
      });
      if (propRows.length !== dedupedIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      // SEÇİM tipli özellik HEDEF olamaz — isTargetableProperty'nin sunucu
      // karşılığı (denetim Q2). Buradaki istemci aktif seçim yapıyor → 400 doğru.
      await assertTargetablePropertyIds(dedupedIds, "iş emri hedef özelliği");

      const allowedSet = new Set(
        (wo.targetItem?.allowedProperties ?? []).map((p) => p.propertyId),
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

    const result = await prisma.$transaction(async (tx) => {
      // 0) WO satır kilidi tx'in İLK ifadesi (Y8, F58 deseni): eskiden bu uç kilitsizdi,
      //    kilit/kapsama yalnız tx DIŞINDA hesaplanıyordu. Kilit altında TAZE aktif hedef
      //    kümesi ve taze kilitler okunur; kapı §3.2 ile aynı üç parça (kilitli mevcut
      //    hedef listeye birleştirilir · kapsama yalnız DELTA'ya · fark bazlı damga).
      await touchWorkOrderTx(tx, id);
      const freshLocks = await computeWorkOrderLocks(tx, id);
      const freshTargets = await tx.workOrderTargetProperty.findMany({
        where: { workOrderId: id, ...ACTIVE_TARGET_PROPERTY },
        select: { propertyId: true },
      });
      const freshTargetIds = new Set(freshTargets.map((p) => p.propertyId));
      const lockedKept = freshLocks.lockedPropertyIds.filter((pid) => freshTargetIds.has(pid));
      for (const lockedId of lockedKept) {
        if (!incomingSet.has(lockedId)) {
          throw AppError.conflict(
            freshLocks.reasons.properties?.[lockedId] ?? "Bu özellik artık kaldırılamaz.",
          );
        }
      }
      const resolvedIds = new Set([...dedupedIds, ...lockedKept]);
      const enteringIds = [...resolvedIds].filter((pid) => !freshTargetIds.has(pid));
      const leavingIds = [...freshTargetIds].filter((pid) => !resolvedIds.has(pid));
      {
        const freshApplicable = new Set(freshLocks.applicablePropertyIds);
        for (const newId of enteringIds) {
          if (!freshApplicable.has(newId)) {
            throw AppError.conflict(
              "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
            );
          }
        }
      }

      // 1) WO targetProperties FARK bazlı + damgalı (③a, Y8): silme YOK
      if (leavingIds.length > 0) {
        await revokeTargetProperties(tx, { workOrderId: id, propertyIds: leavingIds, reason: "WO_TARGET_UPDATE", userId: userId ?? null });
      }
      if (enteringIds.length > 0) {
        await tx.workOrderTargetProperty.createMany({
          data: enteringIds.map((propertyId) => ({ workOrderId: id, propertyId })),
          skipDuplicates: true,
        });
      }

      // 2) Bağlı + DEĞİŞTİRİLEBİLİR durumdaki Roll'ları bul. SHIPPED (müşteride),
      //    SCRAP/CANCELLED (ölü), *_CONSUMED (emekli parent), AT_KARTELA hariç —
      //    geçmiş/sevk edilmiş malın özelliği geri-dönük çarpıtılmaz. Önizleme
      //    (getTargetPropertyChangeImpact) ile birebir aynı küme.
      const affectedRolls = await tx.roll.findMany({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_MUTABLE_STATUSES },
        },
        select: { id: true },
      });
      const rollIds = affectedRolls.map((r) => r.id);

      // 3) Bağlı topların özelliği — YALNIZ BAYRAK EVRENİ ve YALNIZ DELTA (Y9, 2026-09-14):
      //    damgalanan küme `(eski hedef − yeni hedef)`, topun tüm FLAG evreni DEĞİL — aynı
      //    fonksiyon SEÇİM satırlarına tam bu sebeple dokunmuyor ("SEÇİM satırlarını
      //    İSTASYON OPERATÖRÜ yazar, hedef listesi değil", denetim F4). Bilinen sınır (plan
      //    §8.4): kaynak kolonu olmadığından hem hedef hem istasyon-AUTO olan özellik
      //    (KURSUN) hedeften çıkarılınca topta yine damgalanır. Girenler damgasız yazılır,
      //    değişmeyen satıra dokunulmaz. Sıralı döngü: `tx.*` + `Promise.all` YASAK.
      if (rollIds.length > 0) {
        if (leavingIds.length > 0) {
          await revokeRollProperties(tx, {
            rollIds,
            propertyIds: leavingIds,
            valueType: "FLAG",
            reason: "WO_TARGET_UPDATE",
            userId: userId ?? null,
          });
        }
        if (enteringIds.length > 0) {
          await tx.rollProperty.createMany({
            data: rollIds.flatMap((rollId) => enteringIds.map((propertyId) => ({ rollId, propertyId }))),
            skipDuplicates: true,
          });
        }
      }

      // Hedef özellikler kartın "İSTENEN ÖZELLİKLER" bloğunda basılı.
      await markTravelerCardDirtyTx(tx, id);

      return { affectedRollCount: rollIds.length, leavingIds, enteringIds };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        targetPropertyIds: dedupedIds,
        revokedPropertyIds: result.leavingIds,
        addedPropertyIds: result.enteringIds,
        affectedRollCount: result.affectedRollCount,
      },
    });

    return {
      success: true,
      data: { workOrderId: id, affectedRollCount: result.affectedRollCount },
      message:
        result.affectedRollCount > 0
          ? `Hedef özellikler güncellendi. ${result.affectedRollCount} rulo etkilendi.`
          : "Hedef özellikler güncellendi.",
    };
  }

  /**
   * Frontend "değişiklik X rulo etkileyecek, devam mı?" uyarısı için.
   * WO'ya bağlı + henüz Tambur'dan geçmemiş ve geçmiş rulo sayılarını döner.
   */
  async getTargetPropertyChangeImpact(
    id: string,
  ): Promise<ApiResponse<{ tamburPassedCount: number; inProductionCount: number }>> {
    // Önizleme kümeleri = mutasyonun (updateTargetProperties) dokunduğu küme.
    // İki bucket'ın toplamı = gerçek etkilenecek rulo sayısı (onay = gerçek kapsam).
    const [tamburPassed, inProduction] = await Promise.all([
      prisma.roll.count({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_FINISHED_STATUSES },
        },
      }),
      prisma.roll.count({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_INPROD_STATUSES },
        },
      }),
    ]);
    return {
      success: true,
      data: { tamburPassedCount: tamburPassed, inProductionCount: inProduction },
    };
  }

  /**
   * EXTERNAL adım planlaması — gerekli kategori ve planlanan firma seçimi.
   * Adım hangi durumda olursa olsun (PENDING/ACTIVE/COMPLETED/SKIPPED/CANCELLED)
   * planlamacı kategori veya firma değiştirebilir. Tek istisna: WO COMPLETED
   * veya CANCELLED ise hiçbir değişiklik yapılamaz.
   *
   * Subcontractor seçilirse kategoriye uygun olmalıdır.
   */
  async updateStepPlanning(
    workOrderId: string,
    stepId: string,
    data: {
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      /** 2026-08-17 — adım fasona renksiz gitsin ("ekru" kuralı). */
      dispatchWithoutColor?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, status: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        `Tamamlanmış/iptal edilmiş iş emrinde adım planlaması değiştirilemez (durum: ${wo.status}).`,
      );
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { type: true, name: true } },
        requiredCategory: true,
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.workOrderId !== workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
    }
    if (step.station.type !== "EXTERNAL") {
      throw AppError.badRequest(
        `Sadece fason (EXTERNAL) adımlar planlanabilir. Mevcut: ${step.station.type}`
      );
    }

    // Kategori validasyonu
    if (data.requiredCategoryId) {
      const cat = await prisma.subcontractorCategory.findUnique({
        where: { id: data.requiredCategoryId },
      });
      if (!cat) throw AppError.notFound("Kategori bulunamadı");
      if (!cat.isActive) throw AppError.badRequest("Pasif kategori atanamaz");
    }

    // Subcontractor validasyonu — kategori uyumu kontrolü
    if (data.plannedSubcontractorId) {
      const sub = await prisma.subcontractor.findUnique({
        where: { id: data.plannedSubcontractorId },
        include: { categories: true },
      });
      if (!sub) throw AppError.notFound("Fason firma bulunamadı");
      if (!sub.isActive) throw AppError.badRequest("Pasif firma atanamaz");

      const effectiveCategoryId =
        data.requiredCategoryId !== undefined
          ? data.requiredCategoryId
          : step.requiredCategoryId;

      if (effectiveCategoryId) {
        const hasCategory = sub.categories.some(
          (c) => c.categoryId === effectiveCategoryId
        );
        if (!hasCategory) {
          throw AppError.badRequest(
            "Seçilen firma bu kategoride hizmet vermiyor"
          );
        }
      }
    }

    // F66: ATOMİK CLAIM (check-then-act DEĞİL) — WO terminal-durum kontrolünü yazmanın
    // WHERE'ine koy; eşzamanlı finalize WO'yu COMPLETED yaptıktan sonra planlama sızmasın.
    const claim = await prisma.workOrderStep.updateMany({
      where: {
        id: stepId,
        workOrder: { status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
      },
      data: {
        requiredCategoryId: data.requiredCategoryId,
        plannedSubcontractorId: data.plannedSubcontractorId,
        dispatchWithoutColor: data.dispatchWithoutColor,
      },
    });
    if (claim.count === 0) {
      throw AppError.conflict(
        "İş emri bu sırada tamamlandı/iptal edildi — adım planlaması güncellenemedi. Sayfayı yenileyin.",
      );
    }
    // Planlanan fasoncu kartın OPERASYON tablosunda basılı ("Boyahane (Fason) —
    // Yıldız Boyahane"). Bu metodun tx'i YOK (tek atomik claim); helper `prisma`
    // ile de çalışır — işaret bağımsız ve idempotent, claim'e bağlı değil.
    await markTravelerCardDirtyTx(prisma, workOrderId);

    const updated = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        requiredCategory: true,
        plannedSubcontractor: true,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: stepId,
      newData: {
        requiredCategoryId: data.requiredCategoryId,
        plannedSubcontractorId: data.plannedSubcontractorId,
      },
    });

    return { success: true, data: updated, message: "Adım planlaması güncellendi" };
  }

  /**
   * Topları İş Emrinden (Sepetten) Çıkarma
   * Sepet mantığı için eklendi: Yanlış bağlanan stok topların rotasını ve durumunu temizler.
   */
  async detachRolls(workOrderId: string, rollIds: string[], userId?: string): Promise<ApiResponse<{ detached: number; errors: string[] }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // Tamamlanmış/iptal edilmiş WO'da değişiklik yapılamaz; diğer durumlarda
    // planlamacının kontrolünde top çıkarılabilir (örn. yanlış bağlanmış top
    // boyahaneye gönderildikten sonra fark edildi → çıkar, sevki iptal et).
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        `Tamamlanmış/iptal edilmiş iş emrinden top çıkarılamaz (durum: ${wo.status}).`,
      );
    }

    const stepIds = wo.steps.map(s => s.id);
    if (stepIds.length === 0) {
      throw AppError.badRequest("İş emrinin adımları bulunamadı.");
    }

    // Çıkarılabilir statüler: bu WO'da üretimde olan + (bilinçli kurtarma akışı)
    // fasona gitmiş/dönmüş toplar. WAREHOUSE/SHIPPED/CANCELLED/CONSUMED toplar
    // "STOCK'a diriltilemez" — bayat UI/yanlış istek sessizce depo-sevk
    // muhasebesini bozamaz (attachRolls'taki claim deseninin simetriği).
    const DETACHABLE_STATUSES: RollStatus[] = [
      RollStatus.IN_PRODUCTION,
      RollStatus.AT_SUBCONTRACTOR,
      RollStatus.RETURNED_FROM_SUBCONTRACTOR,
    ];

    const detached: { id: string; barcode: string | null; prevStatus: RollStatus }[] = [];
    const errorMessages: string[] = [];

    await prisma.$transaction(async (tx) => {
      // TOPLU (eski kod top başına findUnique+update+updateMany = N+1).
      const found = await tx.roll.findMany({
        where: { id: { in: rollIds } },
        select: { id: true, barcode: true, status: true, currentStepId: true, colorId: true, qualityGrade: true },
      });
      const foundIds = new Set(found.map((r) => r.id));
      for (const reqId of rollIds) {
        if (!foundIds.has(reqId)) errorMessages.push(`${reqId}: top bulunamadı`);
      }

      // ÜYELİK + STATÜ GUARD'I: top BU iş emrinin bir adımında olmalı ve
      // çıkarılabilir statüde olmalı. Başka WO'nun topu / depodaki / sevk
      // edilmiş / iptal top sessizce sıfırlanamaz — sebep belirtilerek raporlanır.
      const stepIdSet = new Set(stepIds);
      const detachable = found.filter(
        (r) =>
          r.currentStepId !== null &&
          stepIdSet.has(r.currentStepId) &&
          DETACHABLE_STATUSES.includes(r.status),
      );
      const detachableIds = detachable.map((r) => r.id);
      for (const r of found) {
        if (detachableIds.includes(r.id)) continue;
        const ref = r.barcode ?? r.id;
        if (!r.currentStepId || !stepIdSet.has(r.currentStepId)) {
          errorMessages.push(`${ref}: top bu iş emrine bağlı değil`);
        } else {
          errorMessages.push(`${ref}: top çıkarılabilir durumda değil (${r.status})`);
        }
      }
      if (detachableIds.length === 0) return;

      // 1) Toplar → STOCK + pointer/dal kimliği temizle (currentQty'ye
      //    dokunulmaz). ATOMİK CLAIM: aynı koşullar WHERE'de — okuma ile
      //    update arasına başka işlem girerse count uyuşmaz → 409 + rollback.
      // F1: detach RESTORE — attach ÖNCESİ duruma en yakın hale getir. prevStatus saklanmadığından
      // colorId tek doğruluk kaynağı (createInitialEntry hüristiğinin aynası): renksiz (ham) → STOCK;
      // renkli (işlenmiş) → kaliteden çözülen final durum (varsayılan WAREHOUSE). Aksi halde WAREHOUSE
      // bir top attach→detach ile sessizce STOCK'a (ham) düşerdi. currentQty'ye dokunulmaz.
      // Parti (Batch) üyeliği de koparılır (batchId=null); boşalan parti izsizse sonra temizlenir.
      const { statusByCode } = await loadQualityTargetMaps(tx, detachable.map((r) => r.qualityGrade));
      const idsByTarget = new Map<RollStatus, string[]>();
      for (const r of detachable) {
        const target = r.colorId == null ? RollStatus.STOCK : resolveFinalStatus(r.qualityGrade, statusByCode);
        const arr = idsByTarget.get(target);
        if (arr) arr.push(r.id);
        else idsByTarget.set(target, [r.id]);
      }
      // Hedef duruma göre gruplanmış ATOMİK claim'ler (aynı WHERE guard'ı; toplam count kontrolü).
      let claimedCount = 0;
      for (const [target, ids] of idsByTarget) {
        // Hedef STOK KÜMESİNDEYSE depo damgası terfinin parçası (flip'ten ÖNCE —
        // sonra yüklem eşleşmez). Damga mevcut depoyu EZMEZ.
        if (WAREHOUSE_STOCK_STATUSES.includes(target)) {
          await warehouseStampManyTx(tx, ids);
        }
        const res = await tx.roll.updateMany({
          where: {
            id: { in: ids },
            currentStepId: { in: stepIds },
            status: { in: DETACHABLE_STATUSES },
          },
          data: {
            status: target,
            currentStepId: null,
            batchId: null,
          },
        });
        claimedCount += res.count;
      }
      if (claimedCount !== detachableIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.",
        );
      }

      // DEPO DEFTERİ — top üretimden çıkıp stoğa döndü: GİRİŞ satırı. Bu yol
      // `attachRolls`ın ÇIKIŞ satırının karşılığıdır; yazılmazsa iş emrinden
      // çıkarılan top defterde sonsuza dek "üretimde" kalır.
      //
      // ⚠️ TERS KAYIT DEĞİL, yeni bir İLERİ satır — iki ölçülebilir sebeple:
      //   (a) çıkıştan bu yana metraj üretimde değişmiş olabilir; ters kayıt
      //       miktarı ileri satırdan kopyalar ve bugün olmayan metrajı stoğa yazardı,
      //   (b) detach hedef statüyü renk/kaliteden YENİDEN çözüyor (attach öncesi
      //       statü saklanmıyor), yani mal eski rafa değil bugün hesaplanan rafa
      //       dönüyor. Defter topun gerçekte gittiği yeri söylemeli.
      // Statü/metraj claim'den SONRA taze okunur.
      const defterIcin = await tx.roll.findMany({
        where: { id: { in: detachableIds } },
        select: { id: true, warehouseId: true, currentQty: true, status: true },
      });
      for (const f of defterIcin) {
        if (!f.warehouseId || !WAREHOUSE_STOCK_STATUSES.includes(f.status)) continue;
        if (!qtyYazilabilir(f.currentQty)) continue;
        await postStockMove(tx, {
          rollId: f.id,
          eventType: WarehouseEventType.PRODUCTION,
          qty: f.currentQty,
          to: { warehouseId: f.warehouseId, status: f.status },
          reasonCode: STOCK_MOVE_REASON.WO_DETACH,
        });
      }

      // 1b) producedInStepId yalnız BU WO'nun adımını gösteriyorsa temizlenir
      //     (attachRolls'un set ettiği işaretin geri alınması). Başka WO'da
      //     üretilmiş topun soy izi korunur.
      await tx.roll.updateMany({
        where: { id: { in: detachableIds }, producedInStepId: { in: stepIds } },
        data: { producedInStepId: null },
      });

      // 2) Açık RollMovement'ları DETACH notuyla kapat. qtyOut/weightOut her top
      //    için KENDİ currentQty/weightKg'sinden (join) gelir — satır-bazlı farklı
      //    değer olduğu için tek raw UPDATE (Prisma updateMany tek değer yazardı).
      //    Tek sorgu = O(1) (eski per-roll updateMany yerine).
      await tx.$executeRaw`
        UPDATE roll_movements m
        -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
        SET "exitedAt" = now(),
            "qtyOut" = r."currentQty",
            "weightOut" = r."weightKg",
            notes = 'DETACHED_FROM_WO'
        FROM rolls r
        WHERE m."rollId" = r.id
          AND m."rollId" = ANY(${detachableIds}::uuid[])
          AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
          AND m."exitedAt" IS NULL
          AND m."revokedAt" IS NULL
      `;

      // 3) Boşalan adımların durumunu yeniden hesapla (tüm toplar çıkarıldıysa
      //    adım ACTIVE kalmasın).
      const affectedStepIds = [
        ...new Set(detachable.map((r) => r.currentStepId!).filter(Boolean)),
      ];
      for (const sid of affectedStepIds) {
        await recomputeStepStatus(tx, sid);
      }

      detached.push(
        ...detachable.map((r) => ({ id: r.id, barcode: r.barcode, prevStatus: r.status })),
      );
    });

    // R8 fix: audit recordId = UUID. oldData GERÇEK önceki statü (hardcode değil).
    // TEK createMany (eski sıralı for-loop INSERT yerine).
    await AuditService.logMany(
      detached.map((r) => ({
        userId,
        action: "UPDATE" as const,
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: r.prevStatus, workOrderId },
        newData: { status: "STOCK", workOrderId: null, barcode: r.barcode },
      }))
    );

    return {
      success: true,
      data: { detached: detached.length, errors: errorMessages },
      message:
        errorMessages.length > 0
          ? `${detached.length} top çıkarıldı, ${errorMessages.length} top çıkarılamadı.`
          : `${detached.length} top iş emrinden başarıyla çıkarıldı.`,
    };
  }

  /**
   * İş Emrini Kilitle (Üretime Al)
   * Sepetteki (PLANNED) siparişi onaylayıp IN_PROGRESS durumuna sokar, top eklemeye/çıkarmaya kapatır.
   */
  async lockWorkOrder(workOrderId: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }
    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.badRequest("Sadece 'Planlandı' durumundaki iş emirleri kilitlenebilir/başlatılabilir.");
    }

    // ATOMİK CLAIM (check-then-act DEĞİL): PLANNED→IN_PROGRESS geçişini status-koşullu
    // updateMany ile sahiplen. İki paralel kilitle / kilitle+iptal yarışında yalnız biri
    // kazanır; üst ön-kontrol (4082) UX, asıl koruma bu claim.
    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, status: WorkOrderStatus.PLANNED },
      data: { status: WorkOrderStatus.IN_PROGRESS },
    });
    if (claim.count === 0) {
      const fresh = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { status: true },
      });
      throw AppError.conflict(
        `İş emri bu sırada ${fresh?.status} durumuna geçti — kilitlenemedi. Sayfayı yenileyin.`
      );
    }
    const updated = await prisma.workOrder.findUnique({ where: { id: workOrderId } });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { status: wo.status },
      newData: { status: WorkOrderStatus.IN_PROGRESS },
    });

    return {
      success: true,
      data: updated!,
      message: "İş emri kilitlendi ve üretime (IN_PROGRESS) alındı.",
    };
  }

  /**
   * BİR İŞ EMRİNİN TÜM BELGELERİ — tek liste, tek sözleşme.
   *
   * Neden ayrı uç: belgeler dört ayrı kaynakta yaşıyor (TravelerCard + üç
   * PrintedDocument tipi) ve `findById` yalnız `steps[].dispatches`'i taşıyor.
   * Sonuç: fason **kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** iki
   * istemcide de iş emrinden ULAŞILAMIYORDU — belge vardı, kapısı yoktu.
   * İstemciler artık bu listeyi basar; yeni bir belge tipi eklendiğinde tek yer
   * güncellenir (aksi halde her istemci kendi listesini kurar ve ayrışırlar).
   *
   * ⚠️ İPTAL EDİLMİŞ belgeler LİSTEDE KALIR (`cancelled: true`). Donmuş belge
   * silinmez, VOIDED'e çekilir ve baskıda İPTAL filigranı alır — dosyaya bakan
   * kişi onu yeniden basabilmeli. İstemci rozetle ayırır. (Electron'un eski
   * Belgeler diyaloğu iptalleri gizliyor; bu uca geçtiğinde davranış birleşir.)
   *
   * Sıralama: kart önce (iş emri belgesi), sonra fason belgeleri TARİH DESC —
   * sahada en çok aranan "en son basılan"dır.
   */
  async getDocuments(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    // Dört kaynak paralel değil SERİ okunur (pg adapter tek connection —
    // `Promise.all([tx.*])` yasağıyla aynı gerekçe; burada tx yok ama havuz
    // davranışı için de seri okumak güvenli ve fark ölçülemez: 4 küçük sorgu).
    const card = await prisma.travelerCard.findUnique({
      where: { workOrderId },
      select: { id: true, cardNumber: true, printedAt: true, createdAt: true, version: true, status: true, contentDirty: true },
    });

    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId },
      orderBy: { dispatchedAt: "desc" },
      select: {
        id: true,
        dispatchNo: true,
        dispatchedAt: true,
        totalQty: true,
        cancelledAt: true,
        directShippedAt: true,
        subcontractor: { select: { name: true } },
        batch: { select: { batchNumber: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        receiptNo: true,
        manifestNo: true,
        receivedAt: true,
        cancelledAt: true,
        subcontractor: { select: { name: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    // Doğrudan sevk WO'ya DOLAYLI bağlı (DirectShipment → dispatch → workOrder).
    const directShipments = dispatches.length
      ? await prisma.directShipment.findMany({
          where: { dispatchId: { in: dispatches.map((d) => d.id) } },
          orderBy: { shippedAt: "desc" },
          select: {
            id: true,
            shipmentNo: true,
            shippedAt: true,
            totalQty: true,
            customer: { select: { name: true } },
            dispatch: { select: { step: { select: { station: { select: { name: true } } } } } },
          },
        })
      : [];

    const docs: Record<string, unknown>[] = [];

    if (card) {
      docs.push({
        docType: "TRAVELER_CARD",
        sourceId: card.id,
        documentNo: card.cardNumber,
        // Belge listesinde tarih SIRALAMA anahtarıdır. Hiç basılmamış kartın
        // basım tarihi YOKTUR (K8) — kartın doğduğu ana düşülür, çünkü liste
        // "bu iş emrinin belgeleri" sorusunu tarih sırasıyla cevaplıyor ve
        // tarihsiz satır sıranın dışına düşerdi.
        date: (card.printedAt ?? card.createdAt).toISOString(),
        group: "İş Emri Belgeleri",
        title: "Refakat Kartı",
        subtitle: `v${card.version} · Üretim sahasında topla birlikte dolaşır`,
        cancelled: card.status === "VOIDED",
        // İstemci "güncel değil" rozetini bu alandan basar (bkz. contentDirty).
        contentDirty: card.contentDirty,
      });
    }

    for (const d of dispatches) {
      const station = d.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_DISPATCH",
        sourceId: d.id,
        documentNo: d.dispatchNo,
        date: d.dispatchedAt.toISOString(),
        group: station,
        title: "Fason Sevk İrsaliyesi",
        subtitle: [
          d.subcontractor?.name,
          d.batch?.batchNumber ? `Parti ${d.batch.batchNumber}` : null,
          `${d._count.items} top · ${Number(d.totalQty)} m`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: d.cancelledAt != null,
      });
    }

    for (const r of receipts) {
      const station = r.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_RECEIPT",
        sourceId: r.id,
        documentNo: r.receiptNo,
        date: r.receivedAt.toISOString(),
        group: station,
        title: "Fason Kabul Makbuzu",
        subtitle: [
          r.subcontractor?.name,
          r.manifestNo ? `Fason İrs. ${r.manifestNo}` : null,
          `${r._count.items} top`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: r.cancelledAt != null,
      });
    }

    for (const ds of directShipments) {
      docs.push({
        docType: "SUBCONTRACTOR_DIRECT_SHIP",
        sourceId: ds.id,
        documentNo: ds.shipmentNo,
        date: ds.shippedAt.toISOString(),
        group: ds.dispatch?.step?.station?.name ?? "Fason",
        title: "Fasondan Sevk İrsaliyesi",
        subtitle: [ds.customer?.name, `${Number(ds.totalQty)} m`].filter(Boolean).join(" · "),
        // Doğrudan sevk terminaldir — iptal yolu yok (buildFasonDirectShipDoc da
        // `voidInfo: null` der); alan sözleşme bütünlüğü için sabit false.
        cancelled: false,
      });
    }

    return {
      success: true,
      data: { workOrderNumber: wo.workOrderNumber, documents: docs },
    };
  }

  /**
   * Sepetteki (Bağlanmış) Topları Getir
   */
  async getAttachedRolls(workOrderId: string): Promise<ApiResponse<unknown[]>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    const stepIds = wo.steps.map((s) => s.id);
    if (stepIds.length === 0) {
      return { success: true, data: [] };
    }

    // PERF (#12 select>include): tüketiciler (mobil WorkOrderDetailSheet +
    // printWorkOrder) yalnız id/barcode/status/currentQty/item.name okuyor; color
    // savunma amaçlı dar select'le tutulur. item:true / color:true tüm sütunları
    // çekiyordu (over-fetch).
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { producedInStepId: { in: stepIds } },
          { currentStepId: { in: stepIds } },
        ],
      },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        colorId: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, code: true, name: true, hex: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: rolls };
  }

  /**
   * Generate Traveler Card (Refakat Kartı) data for a work order.
   * Contains work order info, route steps, and linked order info.
   */
  async getTravelCard(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        targetColor: true,
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          where: ACTIVE_ORDER_LINK,
          orderBy: { createdAt: "asc" },
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
                color: true,
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    const travelCard = {
      batchNumber: wo.workOrderNumber,
      type: wo.type,
      width: wo.width,
      targetColor: wo.targetColor
        ? { id: wo.targetColor.id, code: wo.targetColor.code, name: wo.targetColor.name }
        : null,
      status: wo.status,
      parameters: wo.parameters,
      route: wo.steps.map((step) => ({
        sequence: step.stepSequence,
        stationCode: step.station.code,
        stationName: step.station.name,
        stationType: step.station.type,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      })),
      linkedOrders: wo.orderLinks.map((link) => ({
        orderNumber: link.orderLine.order.orderNumber,
        customerName: link.orderLine.order.customer.name,
        itemName: link.orderLine.item.name,
        colorName: link.orderLine.color?.name ?? null,
        requestedQty: link.orderLine.quantity,
      })),
      createdAt: wo.createdAt,
    };

    return { success: true, data: travelCard };
  }

  /**
   * Canlı önizleme — snapshot'a bakmaz, mevcut roll durumunu hesaplar.
   * `createManifest` (yeni belge basma) ve henüz Manifest kaydı bulunmayan
   * `getManifest` çağrıları bu yardımcıyı kullanır.
   */
  private async computeLiveManifest(
    workOrderId: string
  ): Promise<Record<string, unknown> | null> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
      },
    });
    if (!wo) return null;

    const rolls = await prisma.roll.findMany({
      where: {
        parentRollId: null,
        status: { notIn: [RollStatus.CANCELLED] },
        OR: [
          { producedInStepId: { in: wo.steps.map((s) => s.id) } },
          { currentStepId: { in: wo.steps.map((s) => s.id) } },
        ],
      },
      // F69: manifest yalnız bu alanları kullanıyor — tüm item satırını çekme (over-fetch).
      select: {
        barcode: true,
        currentQty: true,
        weightKg: true,
        status: true,
        item: { select: { name: true } },
      },
    });

    // Hedef adım (rota'nın ilk istasyonu) — dyehouse alanı kaldırıldığı için
    // destination her zaman ilk istasyon üzerinden türetilir. Bir EXTERNAL adım
    // varsa fason firma bilgisi WorkOrderStep.plannedSubcontractor üzerinden
    // ileride buraya eklenebilir (ayrı bir task).
    const destination = wo.steps[0]
      ? {
          kind: "STATION" as const,
          stationCode: wo.steps[0].station.code,
          stationName: wo.steps[0].station.name,
        }
      : null;

    return {
      batchNumber: wo.workOrderNumber,
      type: wo.type,
      width: wo.width,
      totalRolls: rolls.length,
      // Decimal aritmetik — float drift'i önler. Serializer Decimal'i number'a çevirir.
      totalMeterage: rolls.reduce(
        (sum, r) => sum.plus(r.currentQty),
        new Prisma.Decimal(0)
      ),
      totalWeight: rolls.reduce(
        (sum, r) => sum.plus(r.weightKg ?? 0),
        new Prisma.Decimal(0)
      ),
      rolls: rolls.map((r) => ({
        barcode: r.barcode,
        itemName: r.item.name,
        currentQty: r.currentQty,
        weightKg: r.weightKg,
        status: r.status,
      })),
      destination,
    };
  }

  /**
   * Generate Manifest / Çeki Listesi data.
   *
   * Davranış:
   *   - Eğer bu WO için daha önce Manifest basılmışsa, SON snapshot döner
   *     (dondurulmuş belge — Tambur'da kesilen çocuk toplar vs. artık listeyi
   *     değiştiremez). Frontend `isSnapshot: true` ile bunu ayırt edebilir.
   *   - Snapshot yoksa canlı önizleme döner; ama sadece orijinal (split olmayan)
   *     toplar listeye girer — SCRAP/A1_STOCK çocukları hariç.
   *   - Listeyi değiştirmek isteyen operatör yeni bir `createManifest` çağrısı
   *     yapmalı (reprint = yeni belge).
   */
  async getManifest(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const latestManifest = await prisma.manifest.findFirst({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (latestManifest) {
      const snapshot = (latestManifest.snapshot ?? {}) as Record<string, unknown>;
      return {
        success: true,
        data: {
          ...snapshot,
          isSnapshot: true,
          manifestNo: latestManifest.manifestNo,
          printedAt: latestManifest.printedAt,
          printedBy: latestManifest.printedBy,
          notes: latestManifest.notes,
        },
      };
    }

    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }
    return { success: true, data: { ...live, isSnapshot: false } };
  }

  /**
   * 3.5 — Çeki Listesi kalıcı belge (Manifest) oluştur.
   * Mevcut WO'nun anlık durumunu snapshot'layıp Manifest tablosuna yazar.
   * Aynı WO için birden fazla manifest basılabilir (reprint mantığı — eski belgeler korunur).
   */
  async createManifest(
    workOrderId: string,
    userId?: string,
    notes?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // Çeki listesi numarası biçimi VERİDİR (numara serisi `manifest`); ön ek,
    // tarih segmenti ve hane fabrikanın ayarından gelir.
    const now = new Date();

    // manifestNo @unique + günlük sequence TÜM WO'lar arasında paylaşımlı —
    // eşzamanlı iki basım aynı NNN'i hesaplardı; projedeki diğer tüm belge
    // numaraları gibi withBarcodeRetry ile sarıldı (P2002'de sequence closure
    // içinde yeniden okunur).
    const manifest = await withBarcodeRetry(async () => {
      // O-4: collation-güvenli (gte + startsWith) + NUMERIC max — lexicographic
      // "999">"1000" taşmasını önler (findFirst+orderBy desc "...999"da sıkışıp
      // withBarcodeRetry'ı kalıcı 409'a düşürüyordu). withBarcodeRetry sarması
      // korunur: P2002'de closure taze max okur.
      // ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan
      // kodlara bakar (`formatChangedAt`); tarih segmenti düşünce eski rejimin
      // kodları sayaca girerdi. `nextSeriesNo` kapsamı ve çakışma atlamasını TEK
      // YERDE tutar — `withBarcodeRetry` sarması korunur (yarışta taze okuma).
      const manifestNo = await nextManifestNo(now);

      return prisma.manifest.create({
        data: {
          manifestNo,
          workOrderId,
          printedById: userId ?? null,
          snapshot: live as Prisma.InputJsonValue,
          notes: notes ?? null,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: manifest.id,
      newData: { packingListNo: manifest.manifestNo, workOrderId },
    });

    return {
      success: true,
      data: {
        id: manifest.id,
        manifestNo: manifest.manifestNo,
        printedAt: manifest.printedAt,
        snapshot: manifest.snapshot,
      },
      message: `Çeki listesi oluşturuldu: ${manifest.manifestNo}`,
    };
  }

  /**
   * 3.5 — İş emrinin geçmiş tüm manifest belgeleri.
   */
  async listManifests(workOrderId: string): Promise<ApiResponse<unknown>> {
    const manifests = await prisma.manifest.findMany({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      // snapshot (JSON) liste görünümünde yüklenmez; sadece detail/print endpoint'i çeker
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });
    return { success: true, data: manifests };
  }

  /**
   * Tek bir manifest'i ID ile getir — kayıtlı snapshot'ı döner (yeniden hesaplama yok).
   * Liste endpoint'i snapshot'ı çekmiyor (over-fetch); print/detail için bu kullanılır.
   */
  async getManifestById(manifestId: string): Promise<ApiResponse<unknown>> {
    const manifest = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        snapshot: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!manifest) {
      throw AppError.notFound("Çeki listesi bulunamadı");
    }

    return { success: true, data: manifest };
  }
}
