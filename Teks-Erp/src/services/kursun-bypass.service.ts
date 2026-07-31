// =============================================================================
// TeksERP — Kurşun Dağıtım (Kurşun Bypass) Service
// =============================================================================
// Fabrika kurşun makinelerine TABLET KOYMUYOR. Kurşun işlemi fiziksel olarak
// yapılır ama dijital izlenmez (hatalar kâğıda yazılır). Yetkili personel,
// kurşun adımında bekleyen iş emrini bu ekrandan fiziksel bir kurşun
// MAKİNESİNE ATAR; adım daha sonra iki yoldan biriyle kapanır:
//   • Tambur tabletinde refakat kartının karekodu okutulur → önizleme + onay
//     (completeFromTambur) → toplar Tambur adımına geçer, KALİTE NULL kalır
//     (kaliteyi Tambur belirler).
//   • Kurşun rotanın SON adımıysa dağıtım ekranındaki "İşi Bitir"
//     (completeFromDistribution) → finalizeRollsAtLastStep → WAREHOUSE.
//
// ⚠️ ATAMA MAKİNE BAZINDADIR — İSTASYON BAZINDA DEĞİL. Fabrikada PROCESS_QC
// türünde TEK istasyon vardır (KURSUN_KK2) ve altında N adet fiziksel kurşun
// MAKİNESİ (`Machine`) durur; dağıtımcının seçtiği şey o makinelerden biridir.
// Üç sonucu:
//   • `WorkOrderStep.stationId` REPOINT EDİLMEZ. İstasyon tek olduğu için adımın
//     istasyonu hiç değişmiyor; atama bilgisi ADIMDA değil ATAMA SATIRINDA
//     yaşar. (`WorkOrderStep`'e `machineId` kolonu da EKLENMEDİ — bilinçli.)
//   • Kapanan kurşun movement'ı `RollMovement.machineId = ATANAN MAKİNE` ile
//     damgalanır → makine bazlı hacim raporları hiçbir ek kod olmadan çalışır.
//   • İstasyon yetenekleri MAKİNENİN İSTASYONUNDAN okunur (`machine.stationId`).
//
// ⚠️ BU "SKIPPED" DEĞİLDİR. Adım atlanmaz: `RollMovement`'lar normal şekilde
// kapanır (qtyOut=qtyIn) ve `recomputeStepStatus` adımı COMPLETED yapar. Fark:
//   • `RollOperation` (QC2_COMPLETED / KURSUN_APPLIED) YAZILMAZ — kimse tablette
//     "bu topun kalitesini gördüm" demedi, yalan iz bırakmayız.
//   • `RollError` açılmaz (hatalar kâğıtta).
//   • İstasyon yetenekleri (copyStationCapabilitiesToRoll) YİNE kopyalanır —
//     KURSUN özelliği fiziksel olarak uygulandı, topta görünmeli.
// İz üçlüsü: movement notes marker'ı `KURSUN_BYPASS_FINISHED:<uuid>` +
// `KursunBypassAssignment` satırı + audit kaydı.
//
// AYAR: `production.kursunBypassEnabled` (varsayılan KAPALI) YALNIZ YENİ ATAMA
// OLUŞTURMAYI kapılar. Dağıtılmış WO'lar bayrak sonradan kapansa da bypass ile
// biter — rejim ATAMA SATIRINDA kalıcıdır, ayarda değil.
//
// ⚠️ IMPORT DÖNGÜSÜ: bu servis `kursun-qc.service` ya da `tambur.service`'i
// İMPORT ETMEZ (tambur.service bunu import edecek). Ortak guard'lar
// `helpers/kursun-bypass-guard.helper.ts` dosyasında yaşar.
// =============================================================================

import { randomUUID } from "crypto";
import {
  KursunBypassCompletionSource,
  Prisma,
  RollOperationType,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { ApiResponse } from "../types/api.types";
import { p2002Mentions } from "../utils/p2002";
import { readKursunBypassEnabled } from "./system-setting.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { copyStationCapabilitiesToRoll } from "./helpers/station-capability-transfer.helper";
import { finalizeRollsAtLastStep } from "./helpers/roll-finalize.helper";
import {
  completeWorkOrderIfStepsDone,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import {
  findPendingBypassAssignmentTx,
  KURSUN_BYPASS_MARKER_PREFIX,
} from "./helpers/kursun-bypass-guard.helper";

/**
 * Bypass kapanışının movement notes marker ÖN EKİ. Tur kimliği (uuid) suffix
 * olarak eklenir — QC2_STEP_FINISHED emsali: aynı adımda çok-parti kapanışları
 * (fason 2. tur) birbirine karışmasın.
 *
 * TEK KAYNAK `helpers/kursun-bypass-guard.helper.ts`'tedir (`inventory.service`
 * de okuyor ve bu servisi import edemiyor); buradan yalnız yeniden ihraç edilir
 * ki mevcut çağrı yerleri (test scripti dahil) kırılmasın.
 */
export { KURSUN_BYPASS_MARKER_PREFIX };

/** Emniyet tavanı — listQueue emsali. Dolarsa liste kırpılmış olabilir, uyarı loglanır. */
const LIST_CAP = 500;

/** Atama YAPILABİLİR WO durumları (terminal WO'ya dağıtım yok). */
const ASSIGNABLE_WO_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
];

// -----------------------------------------------------------------------------
// Payload tipleri (Electron + mobil AYNI payload'ı tüketir — mobile'a ayrı
// makine servisi gerekmesin diye MAKİNE listesi de bu yanıtta gelir).
// -----------------------------------------------------------------------------

/** Dağıtılabilir fiziksel kurşun makinesi (PROCESS_QC istasyonuna bağlı, aktif). */
export interface KursunBypassMachineOption {
  id: string;
  code: string;
  name: string;
  /** Makinenin bağlı olduğu istasyon — yetenek okuması bu id üzerinden yapılır. */
  stationId: string;
  stationName: string;
}

/** Dağıtım ekranındaki bir satırın ORTAK gövdesi (waiting + assigned). */
export interface KursunDistributionRowBase {
  workOrderStepId: string;
  workOrderId: string;
  workOrderNumber: string;
  /**
   * Adımdaki AÇIK topların DISTINCT parti numaraları — planlamacı "hangi iş emri
   * ve hangi partiler" sorusunu tek bakışta yanıtlasın. Partisiz top varsa liste
   * kısalır (null'lar atlanır).
   */
  batchNumbers: string[];
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  /** Açık topların TOPLAM güncel metrajı (Decimal ile toplanır, float drift yok). */
  totalMeters: number;
  oldestEnteredAt: Date | null;
  isUrgent: boolean;
  urgentMarkedAt: Date | null;
  /** Kurşun rotanın son (non-SKIPPED) adımı mı → "İşi Bitir" butonu bu satırda çıkar. */
  isLastStep: boolean;
}

export interface KursunDistributionWaitingRow extends KursunDistributionRowBase {
  /** Bu adım bypass'a dağıtılabilir mi? */
  eligible: boolean;
  /** Uygunluk kurallarından HANGİSİ düştü — somut sebep (null = uygun). */
  blockReason: string | null;
}

export interface KursunDistributionAssignedRow extends KursunDistributionRowBase {
  assignmentId: string;
  /** ATANAN fiziksel kurşun makinesi — izleme/gruplama bu alan üzerinden yapılır. */
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Makinenin istasyonu (pratikte hep tek PROCESS_QC istasyonu) — bağlam bilgisi. */
  stationId: string;
  stationName: string;
  assignedAt: Date;
  assignedByName: string | null;
  notes: string | null;
  /** Atama artık anlamsız (adım kapandı / açık top kalmadı) → UI "iptal et" önerir. */
  stale: boolean;
  staleReason: string | null;
}

export interface KursunDistributionPayload {
  /** `production.kursunBypassEnabled` — false ise YENİ atama yapılamaz (mevcutlar biter). */
  flagEnabled: boolean;
  /** Atama hedefleri: PROCESS_QC istasyonlarına bağlı AKTİF kurşun makineleri. */
  machines: KursunBypassMachineOption[];
  waiting: KursunDistributionWaitingRow[];
  assigned: KursunDistributionAssignedRow[];
}

export interface KursunBypassPreviewRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
}

export interface KursunBypassCompletePreview {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  /** İşin ATANDIĞI kurşun makinesi (onay ekranında "hangi makinede" yazar). */
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi (tek PROCESS_QC istasyonu). */
  stationName: string;
  isLastStep: boolean;
  canComplete: boolean;
  blockReason: string | null;
  rollCount: number;
  totalMeters: number;
  rolls: KursunBypassPreviewRoll[];
  willFinalize: {
    targetStatus: "WAREHOUSE";
    /** Kalite bypass'ta ASLA yazılmaz — "Belirsiz" kalır (finalize WAREHOUSE'a çeker). */
    qualityStaysNull: true;
    /** Barkodsuz açık kumaşa finalize sırasında üretilecek barkod adedi. */
    barcodesToGenerate: number;
  };
  /** Bu tamamlama iş emrini de COMPLETED yapacak mı (başka açık adım kalmıyorsa). */
  workOrderWillComplete: boolean;
}

export interface KursunBypassTamburRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
  receiptNo: string | null;
  colorCode: string | null;
  colorName: string | null;
}

export interface KursunBypassTamburContext {
  assignmentId: string;
  stepId: string;
  /** İşin ATANDIĞI kurşun makinesi — Tambur onay ekranı bunu gösterir. */
  machineId: string;
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi (tek PROCESS_QC istasyonu). */
  stationId: string;
  stationName: string;
  assignedAt: Date;
  assignedByName: string | null;
  notes: string | null;
  rollCount: number;
  totalMeters: number;
  /** Tambur onay ekranının hem gösterimi hem `confirm`'e gidecek rollIds kaynağı. */
  rolls: KursunBypassTamburRoll[];
}

// -----------------------------------------------------------------------------
// Ortak yükleyiciler / saf yardımcılar
// -----------------------------------------------------------------------------

/** Adım + WO + açık movement özeti. Dönüş tipi ÇIKARIMLA türetilir (elle tip kopyası yok). */
async function loadDistributionSteps(
  where: Prisma.WorkOrderStepWhereInput,
  orderBy: Prisma.WorkOrderStepOrderByWithRelationInput[],
) {
  return prisma.workOrderStep.findMany({
    where,
    select: {
      id: true,
      status: true,
      stepSequence: true,
      stationId: true,
      isUrgent: true,
      urgentMarkedAt: true,
      workOrder: {
        select: {
          id: true,
          workOrderNumber: true,
          status: true,
          targetItem: { select: { name: true } },
          targetColor: { select: { name: true, hex: true } },
          travelerCards: {
            where: { status: TravelerCardStatus.ACTIVE },
            select: { cardNumber: true, barcode: true },
            take: 1,
          },
          steps: {
            orderBy: { stepSequence: "asc" },
            select: {
              id: true,
              stepSequence: true,
              status: true,
              station: { select: { kind: true, name: true } },
            },
          },
        },
      },
      movements: {
        where: { exitedAt: null },
        select: {
          enteredAt: true,
          qtyIn: true,
          roll: {
            select: { currentQty: true, batch: { select: { batchNumber: true } } },
          },
        },
      },
    },
    orderBy,
    take: LIST_CAP,
  });
}

type DistributionStepRow = Awaited<ReturnType<typeof loadDistributionSteps>>[number];

/** Rotadaki bir adımın sıralı listesi için minimum şekil (kind + status yeter). */
interface RouteStepRef {
  id: string;
  stepSequence: number;
  status: StepStatus;
  station: { kind: StationKind; name: string };
}

/**
 * Verilen adımdan SONRAKİ ilk NON-SKIPPED adım (yoksa null = son adım).
 *
 * SKIPPED atlanır çünkü SKIPPED terminaldir: `recomputeStepStatus` ona dokunmaz,
 * oraya bağlanan top akışta görünmez ve WO tamamlanamaz (F76 emsali).
 */
function nextNonSkippedStep(
  steps: RouteStepRef[],
  stepId: string,
): RouteStepRef | null {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  return steps.slice(idx + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null;
}

/** Kapanmış movement BYPASS turuna mı ait? (marker ön eki ile başlıyor mu) */
function isBypassClosure(notes: string | null): boolean {
  return notes != null && notes.startsWith(KURSUN_BYPASS_MARKER_PREFIX);
}

// -----------------------------------------------------------------------------

export class KursunBypassService {
  // ---------------------------------------------------------------------------
  // LİSTE
  // ---------------------------------------------------------------------------
  /**
   * Kurşun Dağıtım ekranının TEK payload'ı: bayrak + MAKİNELER + bekleyenler +
   * dağıtılmışlar. Electron ve mobil AYNI yanıtı tüketir (mobile'ın ayrıca
   * makine servisi çağırması gerekmesin).
   */
  async listDistribution(): Promise<ApiResponse<KursunDistributionPayload>> {
    const flagEnabled = await readKursunBypassEnabled();

    // ATAMA HEDEFLERİ = PROCESS_QC istasyonuna bağlı AKTİF makineler.
    // Filtre `assign`'ın kabul koşuluyla BİREBİR aynı tutulur (aktif makine +
    // istasyon kind'ı PROCESS_QC) — aksi halde listede görünen bir makine
    // seçildiğinde 400 alınır ve dağıtımcı sebebi anlamaz.
    const machineRows = await prisma.machine.findMany({
      where: { isActive: true, station: { kind: StationKind.PROCESS_QC } },
      select: {
        id: true,
        code: true,
        name: true,
        stationId: true,
        station: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }],
    });
    const machines: KursunBypassMachineOption[] = machineRows.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      stationId: m.stationId,
      stationName: m.station.name,
    }));

    // AÇIK atamalar liste kaynağıdır (adımın açık topu kalmasa / adım kapansa
    // bile satır GÖRÜNMELİ — planlamacı "stale" rozetiyle iptal edebilsin).
    const pendingRows = await prisma.kursunBypassAssignment.findMany({
      where: { completedAt: null, cancelledAt: null },
      select: {
        id: true,
        workOrderStepId: true,
        machineId: true,
        assignedAt: true,
        notes: true,
        machine: {
          select: {
            code: true,
            name: true,
            stationId: true,
            station: { select: { name: true } },
          },
        },
        assignedBy: { select: { fullName: true } },
      },
      orderBy: { assignedAt: "asc" },
      take: LIST_CAP,
    });
    if (pendingRows.length === LIST_CAP) {
      console.warn(
        `[kursun-bypass] listDistribution: ${LIST_CAP} açık atama tavanına ulaşıldı — liste kırpılmış olabilir.`,
      );
    }
    const pendingStepIds = pendingRows.map((r) => r.workOrderStepId);

    const assignedSteps = pendingStepIds.length
      ? await loadDistributionSteps({ id: { in: pendingStepIds } }, [
          { stepSequence: "asc" },
        ])
      : [];
    const assignedStepById = new Map(assignedSteps.map((s) => [s.id, s]));

    // BEKLEYENLER: PROCESS_QC + açık movement var + açık atama YOK.
    // Terminal WO (CANCELLED/SUPERSEDED) listeye hiç girmez — "uygun değil"
    // satırı olarak göstermek gürültü olurdu; oraya dağıtım zaten anlamsız.
    const waitingSteps = await loadDistributionSteps(
      {
        station: { kind: StationKind.PROCESS_QC },
        movements: { some: { exitedAt: null } },
        workOrder: { status: { in: ASSIGNABLE_WO_STATUSES } },
        ...(pendingStepIds.length ? { id: { notIn: pendingStepIds } } : {}),
      },
      // listQueue ile aynı sıra: acil önce, sonra planlama önceliği.
      [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
    );
    if (waitingSteps.length === LIST_CAP) {
      console.warn(
        `[kursun-bypass] listDistribution: ${LIST_CAP} bekleyen adım tavanına ulaşıldı — liste kırpılmış olabilir.`,
      );
    }

    // ── Uygunluk sinyalleri (yalnız bekleyenler için; toplu sorgu, N+1 yok) ──
    const waitingIds = waitingSteps.map((s) => s.id);

    // BYPASS-DIŞI kapanmış movement: KK2 finish / manuel taşıma / WO kapanışı izi.
    // `notes IS NULL` AYRI dal — SQL'de `NOT (notes LIKE 'x%')` null'da NULL döner
    // ve satırı sessizce ELER; oysa notsuz kapanış da bypass-dışıdır.
    const closedNonBypass = waitingIds.length
      ? await prisma.rollMovement.findMany({
          where: {
            workOrderStepId: { in: waitingIds },
            exitedAt: { not: null },
            OR: [
              { notes: null },
              { notes: { not: { startsWith: KURSUN_BYPASS_MARKER_PREFIX } } },
            ],
          },
          select: { workOrderStepId: true },
          distinct: ["workOrderStepId"],
        })
      : [];
    const closedNonBypassSteps = new Set(closedNonBypass.map((m) => m.workOrderStepId));

    const qc2Ops = waitingIds.length
      ? await prisma.rollOperation.findMany({
          where: {
            workOrderStepId: { in: waitingIds },
            operationType: RollOperationType.QC2_COMPLETED,
            inheritedFromParentRollId: null,
          },
          select: { workOrderStepId: true },
          distinct: ["workOrderStepId"],
        })
      : [];
    const qc2Steps = new Set(qc2Ops.map((o) => o.workOrderStepId));

    const errorRows = waitingIds.length
      ? await prisma.rollError.findMany({
          where: { detectedAtStepId: { in: waitingIds } },
          select: { detectedAtStepId: true },
          distinct: ["detectedAtStepId"],
        })
      : [];
    const errorSteps = new Set(
      errorRows.map((e) => e.detectedAtStepId).filter((x): x is string => !!x),
    );

    const waiting: KursunDistributionWaitingRow[] = waitingSteps.map((step) => {
      const base = this.buildRowBase(step);
      const next = nextNonSkippedStep(step.workOrder.steps, step.id);
      let blockReason: string | null = null;

      if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
        blockReason = "Adım kapanmış (tamamlandı/atlandı)";
      } else if (step.movements.some((m) => m.qtyIn.lte(0))) {
        blockReason = "Ölçümsüz açık kumaş var (metrajı girilmemiş top)";
      } else if (closedNonBypassSteps.has(step.id)) {
        blockReason = "Bu adımda bypass dışı kapanmış hareket var (KK2 kapatma / manuel taşıma)";
      } else if (qc2Steps.has(step.id)) {
        blockReason = "Bu adımda KK2 kaydı var — iş dijital olarak işlenmiş";
      } else if (errorSteps.has(step.id)) {
        blockReason = "Bu adımda hata kaydı açılmış — kâğıt akışına çevrilemez";
      } else if (next && next.station.kind !== StationKind.TAMBUR) {
        blockReason = `Kurşundan sonraki adım Tambur değil (${next.station.name}) — bypass kapanışını yapacak istasyon yok`;
      }

      return { ...base, eligible: blockReason === null, blockReason };
    });

    const assigned: KursunDistributionAssignedRow[] = [];
    for (const a of pendingRows) {
      const step = assignedStepById.get(a.workOrderStepId);
      // Adım satırı bulunamazsa (silinmiş rota — pratikte imkânsız, FK RESTRICT)
      // satırı düşürmek yerine atlamak yeterli; UI'da hayalet kayıt istemiyoruz.
      if (!step) continue;
      const base = this.buildRowBase(step);
      let staleReason: string | null = null;
      if (
        step.workOrder.status === WorkOrderStatus.CANCELLED ||
        step.workOrder.status === WorkOrderStatus.SUPERSEDED
      ) {
        // Terminal WO: tamamlama yolları 409 verir (assertWorkOrderAliveTx) —
        // tek çıkış iptal. Bunu satırda söylemezsek planlamacı "İşi Bitir"e basıp
        // anlamsız bir hata alır.
        staleReason = "İş emri iptal/devredilmiş — dağıtımı iptal edin";
      } else if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
        staleReason = "Adım kapanmış — atama artık anlamsız, iptal edin";
      } else if (base.openRollCount === 0) {
        staleReason = "Adımda açık top kalmadı — atama artık anlamsız, iptal edin";
      }
      assigned.push({
        ...base,
        assignmentId: a.id,
        machineId: a.machineId,
        machineCode: a.machine.code,
        machineName: a.machine.name,
        stationId: a.machine.stationId,
        stationName: a.machine.station.name,
        assignedAt: a.assignedAt,
        assignedByName: a.assignedBy?.fullName ?? null,
        notes: a.notes,
        stale: staleReason !== null,
        staleReason,
      });
    }

    return {
      success: true,
      data: { flagEnabled, machines, waiting, assigned },
    };
  }

  /** Adım satırından ortak liste gövdesini üretir (waiting + assigned paylaşır). */
  private buildRowBase(step: DistributionStepRow): KursunDistributionRowBase {
    // Decimal aritmetiği — JS float drift'i yok; serializer number'a çevirir.
    const totalMeters = step.movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );
    const oldest = step.movements.reduce<Date | null>(
      (acc, m) => (acc === null || m.enteredAt < acc ? m.enteredAt : acc),
      null,
    );
    const batchNumbers = [
      ...new Set(
        step.movements
          .map((m) => m.roll.batch?.batchNumber)
          .filter((x): x is string => !!x),
      ),
    ].sort();
    const card = step.workOrder.travelerCards[0] ?? null;
    const next = nextNonSkippedStep(step.workOrder.steps, step.id);

    return {
      workOrderStepId: step.id,
      workOrderId: step.workOrder.id,
      workOrderNumber: step.workOrder.workOrderNumber,
      batchNumbers,
      travelerCardNumber: card?.cardNumber ?? null,
      travelerCardBarcode: card?.barcode ?? null,
      itemName: step.workOrder.targetItem?.name ?? null,
      colorName: step.workOrder.targetColor?.name ?? null,
      colorHex: step.workOrder.targetColor?.hex ?? null,
      openRollCount: step.movements.length,
      totalMeters: totalMeters.toNumber(),
      oldestEnteredAt: oldest,
      isUrgent: step.isUrgent,
      urgentMarkedAt: step.urgentMarkedAt,
      isLastStep: next === null,
    };
  }

  // ---------------------------------------------------------------------------
  // ATAMA
  // ---------------------------------------------------------------------------
  /**
   * İş emrinin kurşun adımını fiziksel bir kurşun MAKİNESİNE atar (ya da zaten
   * dağıtılmışsa başka makineye TAŞIR).
   *
   * NEDEN `step.stationId` REPOINT EDİLMİYOR: PROCESS_QC türünde tek istasyon
   * var, adımın istasyonu zaten hiç değişmiyor. Atamanın taşıdığı tek yeni bilgi
   * MAKİNEDİR ve o bilgi bu satırda (`machineId`) yaşar; üretim atfı ise
   * movement kapanışında `RollMovement.machineId` damgasıyla tutulur
   * (`closeBypassMovementsTx`). Adımın istasyonuna dokunulmadığı için iptalde
   * "geri yükleme" diye bir şey de yoktur.
   */
  async assign(
    input: { workOrderId: string; machineId: string; notes?: string | null },
    userId?: string,
  ): Promise<
    ApiResponse<{
      assignmentId: string;
      workOrderId: string;
      workOrderNumber: string;
      workOrderStepId: string;
      machineId: string;
      machineName: string;
      stationId: string;
      stationName: string;
      isLastStep: boolean;
      reassigned: boolean;
    }>
  > {
    // assignedById NOT NULL — anonim atama olamaz (dağıtım bir sorumluluk kaydıdır).
    if (!userId) throw AppError.unauthorized();
    const notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        // 1) O-2 write-skew guard: WO satırını kilitle → eşzamanlı finish/fason/
        //    finalize yollarıyla serileş (kardeşlerle aynı kilit sırası: WO → step).
        await touchWorkOrderTx(tx, input.workOrderId);

        // 2) WO'yu TAZE oku (kilit altında).
        const wo = await tx.workOrder.findUnique({
          where: { id: input.workOrderId },
          select: {
            id: true,
            status: true,
            workOrderNumber: true,
            // `stationId` ÇEKİLMEZ: adımın istasyonuna ne yazılıyor ne de
            // okunuyor (repoint kalktı) — rota kararları yalnız kind üzerinden.
            steps: {
              orderBy: { stepSequence: "asc" },
              select: {
                id: true,
                stepSequence: true,
                status: true,
                station: { select: { kind: true, name: true } },
              },
            },
          },
        });
        if (!wo) throw AppError.notFound("İş emri bulunamadı");
        if (!ASSIGNABLE_WO_STATUSES.includes(wo.status)) {
          throw AppError.conflict(
            `İş emri durumu dağıtıma uygun değil (${wo.status}) — yalnız planlanan/üretimdeki iş emirleri kurşuna dağıtılır.`,
          );
        }

        // 3) Kurşun adımı = stepSequence'a göre İLK PROCESS_QC adımı
        //    (assertWoAtStepKind ile aynı semantik).
        const routeSteps: RouteStepRef[] = wo.steps.map((s) => ({
          id: s.id,
          stepSequence: s.stepSequence,
          status: s.status,
          station: s.station,
        }));
        const step = wo.steps.find((s) => s.station.kind === StationKind.PROCESS_QC);
        if (!step) {
          throw AppError.badRequest("Bu iş emrinde Kurşun + KK2 adımı tanımlı değil");
        }
        if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
          throw AppError.badRequest(
            "Kurşun adımı kapanmış (tamamlandı/atlandı) — dağıtım yapılamaz",
          );
        }

        // 4) Zaten dağıtılmış mı?
        const existingPending = await findPendingBypassAssignmentTx(tx, step.id);

        // 5) BAYRAK YALNIZ YENİ ATAMAYI KAPILAR. Var olan atamanın MAKİNESİNİ
        //    değiştirmek (re-assign) bayrak kapansa da çalışır: rejim atama
        //    satırında kalıcıdır, aksi halde bayrağı kapatmak sahadaki yarım işi
        //    kilitlerdi (iş bir makineden diğerine alınamazdı).
        if (!existingPending) {
          const enabled = await readKursunBypassEnabled(tx);
          if (!enabled) {
            throw AppError.badRequest(
              "Kurşun bypass özelliği kapalı — yeni dağıtım yapılamaz. Ayarlardan açın.",
            );
          }
        }

        // 6) UYGUNLUK — hepsi tx içinde TAZE okunur (ön-kontrol ile atama arasında
        //    sahada iş değişmiş olabilir).
        const openMovements = await tx.rollMovement.findMany({
          where: { workOrderStepId: step.id, exitedAt: null },
          select: { rollId: true, qtyIn: true },
        });
        // 6a
        if (openMovements.length === 0) {
          throw AppError.badRequest("Kurşun adımında bekleyen top yok");
        }
        // 6b — `createOpenFabricRoll` qtyIn=0 ile top doğurabilir (ölçüm sonraki
        //      istasyonda girilir). Bypass onu 0 metre olarak Tambur'a/depoya
        //      itmemeli: metraj bir daha ASLA sorulmazdı.
        if (openMovements.some((m) => m.qtyIn.lte(0))) {
          throw AppError.badRequest(
            "Ölçümsüz açık kumaş var (metrajı girilmemiş top) — önce metrajı girin",
          );
        }
        // 6c — BYPASS-DIŞI kapanmış movement varsa bu adım dijital olarak
        //      işlenmiş demektir (QC2_STEP_FINISHED / MANUAL_MOVE_* / WO_CLOSE_*).
        //      Kendi marker'ımız MUAF: çok-parti 2. turunda aynı adım yeniden
        //      dağıtılabilmeli.
        const closedMovements = await tx.rollMovement.findMany({
          where: { workOrderStepId: step.id, exitedAt: { not: null } },
          select: { notes: true },
        });
        if (closedMovements.some((m) => !isBypassClosure(m.notes))) {
          throw AppError.conflict(
            "Bu adımda bypass dışı kapanmış hareket var (KK2 kapatma / manuel taşıma) — dağıtılamaz",
          );
        }
        // 6d — Tambur kalıtımı (inheritedFromParentRollId) sayılmaz; yalnız bu
        //      adımda FİİLEN yapılmış QC2 engeller.
        const qc2Count = await tx.rollOperation.count({
          where: {
            workOrderStepId: step.id,
            operationType: RollOperationType.QC2_COMPLETED,
            inheritedFromParentRollId: null,
          },
        });
        if (qc2Count > 0) {
          throw AppError.conflict(
            "Bu adımda KK2 kaydı var — iş dijital olarak işlenmiş, bypass'a dağıtılamaz",
          );
        }
        // 6e
        const errorCount = await tx.rollError.count({
          where: { detectedAtStepId: step.id },
        });
        if (errorCount > 0) {
          throw AppError.conflict(
            "Bu adımda hata kaydı açılmış — kâğıt akışına çevrilemez, önce hataları karara bağlayın",
          );
        }
        // 6f — Kapanışı YAPACAK istasyon var mı? Bypass'ın iki çıkışı vardır:
        //      Tambur okutması ya da son-adım "İşi Bitir". Araya fason/başka
        //      istasyon girerse ne biri ne öteki adımı kapatabilir → mal kilitlenir.
        const next = nextNonSkippedStep(routeSteps, step.id);
        if (next && next.station.kind !== StationKind.TAMBUR) {
          throw AppError.badRequest(
            `Kurşundan sonraki adım Tambur değil (${next.station.name}) — bypass kapanışını yapacak istasyon yok, dağıtım engellendi.`,
          );
        }
        const isLastStep = next === null;

        // 7) Hedef MAKİNE — istasyonu da birlikte çözülür: yetenek okuması ve
        //    tür kontrolü makinenin İSTASYONU üzerinden yapılır (makinenin kendi
        //    "kind"i yoktur, istasyonundan miras alır).
        const machine = await tx.machine.findUnique({
          where: { id: input.machineId },
          select: {
            id: true,
            name: true,
            isActive: true,
            stationId: true,
            station: { select: { name: true, kind: true } },
          },
        });
        if (!machine) throw AppError.notFound("Makine bulunamadı");
        if (!machine.isActive) throw AppError.badRequest("Seçilen makine pasif");
        if (machine.station.kind !== StationKind.PROCESS_QC) {
          throw AppError.badRequest(
            `Seçilen makine Kurşun + KK2 (PROCESS_QC) istasyonuna bağlı değil (bağlı olduğu istasyon: ${machine.station.name})`,
          );
        }

        // 8) YETENEK KONTROLÜ — makinenin İSTASYONU kurşun uygulayabiliyor mu?
        //    NEDEN: bypass kapanışında `copyStationCapabilitiesToRoll` bu
        //    istasyonun yeteneklerini toplara kopyalar. İstasyonda KURSUN
        //    özelliği tanımlı değilse özellik topa hiç geçmez, buna karşılık
        //    `computeWorkOrderLocks` "bu özelliği veren adım tamamlandı" der →
        //    WO kilit modeli yalan söyler. Atama makine bazına indiği için
        //    kontrol de sadeleşti: istasyon zaten tek, "hangi istasyon neyi
        //    karşılıyor" karşılaştırması anlamsız — tek soru kaldı, sebebini
        //    dağıtımcıya söylemek yine değerli.
        const kursunCap = await tx.stationProperty.findFirst({
          where: { stationId: machine.stationId, property: { code: "KURSUN" } },
          select: { id: true },
        });
        if (!kursunCap) {
          throw AppError.badRequest(
            `Seçilen makinenin istasyonu (${machine.station.name}) kurşun uygulayamıyor — istasyon yeteneklerine KURSUN özelliğini ekleyin.`,
          );
        }

        // 9) Atama satırı. ADIM REPOINT YOK — adımın istasyonu (tek PROCESS_QC
        //    istasyonu) değişmiyor; atamanın tek bilgisi makinedir ve o bu
        //    satırda yaşar. Yazma ATOMİK CLAIM ile yapılır (check-then-act yok).
        let assignmentId: string;
        if (existingPending) {
          const claim = await tx.kursunBypassAssignment.updateMany({
            where: { id: existingPending.id, completedAt: null, cancelledAt: null },
            data: { machineId: machine.id, notes },
          });
          if (claim.count === 0) {
            throw AppError.conflict(
              "Bu dağıtım az önce tamamlandı/iptal edildi — listeyi yenileyin.",
            );
          }
          assignmentId = existingPending.id;
        } else {
          const created = await tx.kursunBypassAssignment.create({
            data: {
              workOrderId: wo.id,
              workOrderStepId: step.id,
              machineId: machine.id,
              assignedById: userId,
              notes,
            },
            select: { id: true },
          });
          assignmentId = created.id;
        }

        return {
          assignmentId,
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber,
          workOrderStepId: step.id,
          machineId: machine.id,
          machineName: machine.name,
          stationId: machine.stationId,
          stationName: machine.station.name,
          isLastStep,
          reassigned: existingPending !== null,
          previousMachineId: existingPending?.machineId ?? null,
        };
      });
    } catch (err) {
      // Partial unique `kursun_bypass_one_pending_per_step_uq` = "bir adımda en
      // fazla BİR açık atama" DB seddi. Eşzamanlı iki dağıtımın kaybedeni buraya düşer.
      if (p2002Mentions(err, /kursun_bypass_one_pending_per_step/i)) {
        throw AppError.conflict("Bu iş emri az önce dağıtıldı, listeyi yenileyin");
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: result.reassigned ? "UPDATE" : "CREATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: result.assignmentId,
      newData: {
        event: "KURSUN_BYPASS_ASSIGN",
        workOrderId: result.workOrderId,
        workOrderNumber: result.workOrderNumber,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        stationId: result.stationId,
        stationName: result.stationName,
        previousMachineId: result.previousMachineId,
        reassigned: result.reassigned,
        isLastStep: result.isLastStep,
        notes,
      },
    });

    return {
      success: true,
      data: {
        assignmentId: result.assignmentId,
        workOrderId: result.workOrderId,
        workOrderNumber: result.workOrderNumber,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        stationId: result.stationId,
        stationName: result.stationName,
        isLastStep: result.isLastStep,
        reassigned: result.reassigned,
      },
      message: result.reassigned
        ? `${result.workOrderNumber} dağıtımı "${result.machineName}" makinesine taşındı`
        : `${result.workOrderNumber} "${result.machineName}" makinesine dağıtıldı`,
    };
  }

  // ---------------------------------------------------------------------------
  // İPTAL
  // ---------------------------------------------------------------------------
  /**
   * Açık dağıtımı iptal eder → iş normal (tabletli) akışa döner.
   *
   * YALNIZ ATAMA SATIRI soft-cancel edilir; başka HİÇBİR ŞEYE dokunulmaz.
   * NEDEN: atama makine bazındadır ve adımın istasyonu (tek PROCESS_QC
   * istasyonu) atama sırasında hiç değiştirilmedi — dolayısıyla geri
   * yüklenecek bir istasyon da yok. Makine atfı yalnız FİİLEN yapılmış işin
   * izinde, yani kapanan movement'ın `machineId` damgasında tutulur; iptal
   * edilen atamada öyle bir iş hiç olmadığı için silinecek damga da yoktur.
   */
  async cancelAssignment(
    assignmentId: string,
    input: { reason?: string | null },
    userId?: string,
  ): Promise<ApiResponse<{ assignmentId: string; workOrderId: string }>> {
    const reason = input.reason?.trim() ? input.reason.trim().slice(0, 200) : null;

    const result = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM — "pending" koşulu where'de; eşzamanlı tamamlama/iptalin
      // kaybedeni 0 satır alır (findUnique→if→update YASAK).
      const claim = await tx.kursunBypassAssignment.updateMany({
        where: { id: assignmentId, completedAt: null, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: reason,
        },
      });
      if (claim.count === 0) {
        const existing = await tx.kursunBypassAssignment.findUnique({
          where: { id: assignmentId },
          select: { completedAt: true, cancelledAt: true },
        });
        if (!existing) throw AppError.notFound("Dağıtım kaydı bulunamadı");
        if (existing.completedAt) {
          throw AppError.conflict("Bu dağıtım tamamlanmış — iptal edilemez");
        }
        throw AppError.conflict("Bu dağıtım zaten iptal edilmiş");
      }

      // Audit gövdesi için atamanın kimliği (iptal SONRASI okunur — satır
      // append-only, claim dışında hiçbir alanı değişmiyor).
      const row = await tx.kursunBypassAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        select: {
          workOrderId: true,
          workOrderStepId: true,
          machineId: true,
          machine: { select: { name: true } },
        },
      });

      return {
        workOrderId: row.workOrderId,
        workOrderStepId: row.workOrderStepId,
        machineId: row.machineId,
        machineName: row.machine.name,
      };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: assignmentId,
      newData: {
        event: "KURSUN_BYPASS_UNASSIGN",
        workOrderId: result.workOrderId,
        workOrderStepId: result.workOrderStepId,
        machineId: result.machineId,
        machineName: result.machineName,
        reason,
      },
    });

    return {
      success: true,
      data: { assignmentId, workOrderId: result.workOrderId },
      message: "Dağıtım iptal edildi",
    };
  }

  // ---------------------------------------------------------------------------
  // SON ADIM: ÖNİZLEME + "İŞİ BİTİR"
  // ---------------------------------------------------------------------------
  /** Salt okunur — hiçbir şeyi değiştirmez. "İşi Bitir" onay ekranının kaynağı. */
  async getCompletePreview(
    assignmentId: string,
  ): Promise<ApiResponse<KursunBypassCompletePreview>> {
    const a = await prisma.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        workOrderId: true,
        workOrderStepId: true,
        completedAt: true,
        cancelledAt: true,
        machine: { select: { name: true, station: { select: { name: true } } } },
        workOrder: {
          select: {
            workOrderNumber: true,
            status: true,
            steps: {
              orderBy: { stepSequence: "asc" },
              select: {
                id: true,
                stepSequence: true,
                status: true,
                station: { select: { kind: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!a) throw AppError.notFound("Dağıtım kaydı bulunamadı");

    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    const isLastStep = next === null;

    const movements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: a.workOrderStepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true } },
      },
      orderBy: { enteredAt: "asc" },
    });
    const rolls: KursunBypassPreviewRoll[] = movements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      currentQty: m.roll.currentQty.toNumber(),
    }));
    const totalMeters = movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );

    let blockReason: string | null = null;
    if (a.cancelledAt) blockReason = "Bu dağıtım iptal edilmiş";
    else if (a.completedAt) blockReason = "Bu dağıtım zaten tamamlanmış";
    else if (
      a.workOrder.status === WorkOrderStatus.CANCELLED ||
      a.workOrder.status === WorkOrderStatus.SUPERSEDED
    ) {
      blockReason = "İş emri iptal/devredilmiş — tamamlanamaz";
    } else if (!isLastStep) {
      blockReason = "Kurşun son adım değil — Tambur kartı okutmasıyla tamamlanır";
    } else if (rolls.length === 0) {
      blockReason = "Adımda açık top yok — tamamlanacak iş kalmamış";
    }

    // WO bu tamamlamayla kapanır mı: kurşun adımı DIŞINDA açık adım kalmıyorsa.
    const otherOpenSteps = a.workOrder.steps.filter(
      (s) =>
        s.id !== a.workOrderStepId &&
        s.status !== StepStatus.COMPLETED &&
        s.status !== StepStatus.SKIPPED,
    ).length;

    return {
      success: true,
      data: {
        assignmentId: a.id,
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        machineName: a.machine.name,
        stationName: a.machine.station.name,
        isLastStep,
        canComplete: blockReason === null,
        blockReason,
        rollCount: rolls.length,
        totalMeters: totalMeters.toNumber(),
        rolls,
        willFinalize: {
          targetStatus: "WAREHOUSE",
          qualityStaysNull: true,
          barcodesToGenerate: rolls.filter((r) => r.barcode === null).length,
        },
        workOrderWillComplete: blockReason === null && otherOpenSteps === 0,
      },
    };
  }

  /**
   * SON ADIM yolu — kurşun rotanın son adımıysa dağıtım ekranındaki "İşi Bitir".
   * Toplar `finalizeRollsAtLastStep` ile WAREHOUSE'a çekilir (kalite NULL kalır →
   * finalize varsayılanı WAREHOUSE), barkodsuz açık kumaşa barkod üretilir.
   */
  async completeFromDistribution(
    assignmentId: string,
    input: { rollIds: string[] },
    userId?: string,
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      finalizedRollCount: number;
      barcodesGenerated: number;
    }>
  > {
    // Yinelenen id gönderimi kapsam kontrolünü (closed.length === rollIds.length)
    // yanlış negatife düşürürdü → tekilleştir.
    const rollIds = [...new Set(input.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("Tamamlanacak top seçilmedi");

    const a = await this.loadAssignmentForCompletion(assignmentId);
    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    if (next) {
      throw AppError.badRequest(
        "Kurşun son adım değil — Tambur kartı okutmasıyla tamamlanır",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await touchWorkOrderTx(tx, a.workOrderId);
      await this.assertWorkOrderAliveTx(tx, a.workOrderId);

      const claimed = await this.claimAssignmentTx(
        tx,
        assignmentId,
        a.workOrderStepId,
        userId,
        KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP,
      );
      if (!claimed) {
        return { alreadyDone: true, finalized: [] as Awaited<ReturnType<typeof finalizeRollsAtLastStep>> };
      }

      const closed = await this.closeBypassMovementsTx(
        tx,
        a.workOrderStepId,
        rollIds,
        a.machineId,
      );
      const closedRollIds = closed.map((m) => m.rollId);

      // İstasyon yetenekleri (KURSUN vb.) — bypass'ta da kopyalanır: iş fiziksel
      // olarak YAPILDI. Yetenekler ATANAN MAKİNENİN İSTASYONUNDAN okunur
      // (makinenin kendi özellik listesi yok). SIRALI (tx'te Promise.all YASAK
      // — pg tek bağlantı).
      for (const rollId of closedRollIds) {
        await copyStationCapabilitiesToRoll(tx, { stationId: a.machineStationId, rollId });
      }

      const finalized = await finalizeRollsAtLastStep(tx, closedRollIds);
      await recomputeStepStatus(tx, a.workOrderStepId);
      await completeWorkOrderIfStepsDone(tx, a.workOrderId);

      return { alreadyDone: false, finalized };
    });

    if (result.alreadyDone) {
      return {
        success: true,
        data: { alreadyDone: true, finalizedRollCount: 0, barcodesGenerated: 0 },
        message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
      };
    }

    const barcodesGenerated = result.finalized.filter((f) => f.barcodeGenerated).length;
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: assignmentId,
      newData: {
        event: "KURSUN_BYPASS_LAST_STEP_COMPLETE",
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        workOrderStepId: a.workOrderStepId,
        // Kapanan kurşun movement'larına damgalanan makine (RollMovement.machineId).
        machineId: a.machineId,
        machineName: a.machineName,
        stationId: a.machineStationId,
        rollIds,
        rollCount: result.finalized.length,
        barcodesGenerated,
        completedVia: KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP,
      },
    });

    return {
      success: true,
      data: {
        alreadyDone: false,
        finalizedRollCount: result.finalized.length,
        barcodesGenerated,
      },
      message: `${result.finalized.length} top depoya alındı`,
    };
  }

  // ---------------------------------------------------------------------------
  // TAMBUR YOLU
  // ---------------------------------------------------------------------------
  /**
   * Tambur ekranının okuma ucu — `tambur.service` bunu çağırır (ters yönde import
   * YOK). null = bu iş emrinde bekleyen kurşun dağıtımı yok (normal akış).
   */
  async findPendingForTambur(
    workOrderId: string,
  ): Promise<KursunBypassTamburContext | null> {
    const a = await prisma.kursunBypassAssignment.findFirst({
      where: { workOrderId, completedAt: null, cancelledAt: null },
      select: {
        id: true,
        workOrderStepId: true,
        machineId: true,
        assignedAt: true,
        notes: true,
        machine: {
          select: { name: true, stationId: true, station: { select: { name: true } } },
        },
        assignedBy: { select: { fullName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });
    if (!a) return null;

    const movements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: a.workOrderStepId, exitedAt: null },
      select: {
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            parentReceipt: { select: { receiptNo: true } },
            color: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { enteredAt: "asc" },
    });

    const totalMeters = movements.reduce(
      (sum, m) => sum.plus(m.roll.currentQty),
      new Prisma.Decimal(0),
    );

    return {
      assignmentId: a.id,
      stepId: a.workOrderStepId,
      machineId: a.machineId,
      machineName: a.machine.name,
      stationId: a.machine.stationId,
      stationName: a.machine.station.name,
      assignedAt: a.assignedAt,
      assignedByName: a.assignedBy?.fullName ?? null,
      notes: a.notes,
      rollCount: movements.length,
      totalMeters: totalMeters.toNumber(),
      rolls: movements.map((m) => ({
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        currentQty: m.roll.currentQty.toNumber(),
        receiptNo: m.roll.parentReceipt?.receiptNo ?? null,
        colorCode: m.roll.color?.code ?? null,
        colorName: m.roll.color?.name ?? null,
      })),
    };
  }

  /**
   * TAMBUR yolu — operatör refakat kartının karekodunu okutur, önizlemeyi onaylar:
   * Kurşun/KK2 adımı COMPLETED sayılır ve toplar Tambur adımına geçer.
   *
   * KALİTEYE DOKUNULMAZ (null kalır) — kaliteyi Tambur belirler. `RollOperation`
   * yazılmaz, `RollError` açılmaz (bypass tanımı).
   */
  async completeFromTambur(
    input: { cardBarcode: string; rollIds: string[] },
    userId?: string,
    machineId?: string | null,
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      movedRollCount: number;
      tamburStepId: string | null;
      workOrderId: string;
    }>
  > {
    const rollIds = [...new Set(input.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("Tamamlanacak top seçilmedi");

    // ── Ön kontroller (tx dışı) ────────────────────────────────────────────
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: input.cardBarcode },
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${input.cardBarcode}`);
    }
    if (card.status !== TravelerCardStatus.ACTIVE) {
      throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
    }

    const pending = await prisma.kursunBypassAssignment.findFirst({
      where: { workOrderId: card.workOrderId, completedAt: null, cancelledAt: null },
      select: { id: true },
      orderBy: { assignedAt: "desc" },
    });
    if (!pending) {
      // İDEMPOTENT TEKRAR. Tambur tabletinin isteği commit oldu ama yanıt
      // istemciye ulaşmadıysa (ağ kesintisi / offline kuyruk replay'i) operatör
      // AYNI okutmayı tekrar gönderir. O noktada açık atama YOKTUR — bu dal
      // olmadan kullanıcı, işi kendisi bitirmiş olmasına rağmen "bekleyen
      // dağıtım yok" 404'ü görür ve ekranda ne yapacağını bilemez.
      // `completeFromDistribution` bu davranışı zaten taşıyor (assignmentId ile
      // çağrıldığı için tamamlanmış satırı bulup `alreadyDone` dönüyor); Tambur
      // yolu atamayı KART üzerinden çözdüğü için aynı sonucu burada üretiyoruz.
      const done = await this.findCompletedTamburBypass(card.workOrderId);
      if (done) {
        return {
          success: true,
          data: {
            alreadyDone: true,
            movedRollCount: 0,
            tamburStepId: done.tamburStepId,
            workOrderId: card.workOrderId,
          },
          message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
        };
      }
      throw AppError.notFound("Bu iş emrinde bekleyen kurşun dağıtımı yok");
    }

    const a = await this.loadAssignmentForCompletion(pending.id);
    const next = nextNonSkippedStep(a.workOrder.steps, a.workOrderStepId);
    // Rota atama sonrası değişmiş olabilir (adım eklendi / SKIPPED kaldırıldı).
    if (!next || next.station.kind !== StationKind.TAMBUR) {
      throw AppError.conflict(
        next
          ? `Kurşundan sonraki adım Tambur değil (${next.station.name}) — rota dağıtımdan sonra değişmiş. Dağıtımı iptal edin.`
          : "Kurşun rotanın son adımı — Tambur okutmasıyla değil, Kurşun Dağıtım ekranındaki 'İşi Bitir' ile tamamlanır.",
      );
    }
    const tamburStep = next;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await touchWorkOrderTx(tx, a.workOrderId);
        await this.assertWorkOrderAliveTx(tx, a.workOrderId);

        const claimed = await this.claimAssignmentTx(
          tx,
          a.assignmentId,
          a.workOrderStepId,
          userId,
          KursunBypassCompletionSource.TAMBUR_SCAN,
        );
        if (!claimed) return { alreadyDone: true, moved: 0 };

        const closed = await this.closeBypassMovementsTx(
          tx,
          a.workOrderStepId,
          rollIds,
          a.machineId,
        );
        const closedRollIds = closed.map((m) => m.rollId);

        // İstasyon yetenekleri (KURSUN) — iş fiziksel olarak yapıldı; yetenekler
        // ATANAN MAKİNENİN İSTASYONUNDAN okunur. SIRALI.
        for (const rollId of closedRollIds) {
          await copyStationCapabilitiesToRoll(tx, {
            stationId: a.machineStationId,
            rollId,
          });
        }

        // Tambur adımına GİRİŞ movement'ları. `machineId` BURADA BİLİNÇLİ olarak
        // yazılmaz — kurşun makinesi damgası KAPANAN kurşun movement'ına konur;
        // AÇILAN Tambur girişinin makine damgası Tambur FINISH'inde konacaktır
        // (kursun-qc.finishStep ile aynı sözleşme). Buraya kurşun makinesini
        // yazmak "bu top Tambur'da şu kurşun makinesinde işlendi" yalanı olurdu.
        // Çift açılışa karşı DB seddi partial unique
        // `roll_movements_one_open_per_roll_step_uq`.
        await tx.rollMovement.createMany({
          data: closed.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: tamburStep.id,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn ?? null,
            operatorId: userId ?? null,
            notes: null,
          })),
        });
        // KALİTEYE DOKUNMA — qualityGrade null kalır, Tambur belirler.
        await tx.roll.updateMany({
          where: { id: { in: closedRollIds } },
          data: { currentStepId: tamburStep.id },
        });

        await recomputeStepStatus(tx, tamburStep.id);
        await recomputeStepStatus(tx, a.workOrderStepId);

        return { alreadyDone: false, moved: closedRollIds.length };
      });
    } catch (err) {
      if (p2002Mentions(err, /one_open_per_roll_step/i)) {
        throw AppError.conflict(
          "Toplar bu sırada Tambur'a taşınmış — ekranı yenileyin.",
        );
      }
      throw err;
    }

    if (result.alreadyDone) {
      return {
        success: true,
        data: {
          alreadyDone: true,
          movedRollCount: 0,
          tamburStepId: tamburStep.id,
          workOrderId: a.workOrderId,
        },
        message: "Bu dağıtım zaten tamamlanmış (idempotent tekrar)",
      };
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "KURSUN_BYPASS_ASSIGNMENT",
      recordId: a.assignmentId,
      newData: {
        event: "KURSUN_BYPASS_TAMBUR_COMPLETE",
        workOrderId: a.workOrderId,
        workOrderNumber: a.workOrder.workOrderNumber,
        workOrderStepId: a.workOrderStepId,
        tamburStepId: tamburStep.id,
        // ATANAN kurşun makinesi — kapanan kurşun movement'larına damgalanan
        // makine budur (dağıtımı yapan kişi makineyi seçti, atıf BİLİNİYOR).
        machineId: a.machineId,
        machineName: a.machineName,
        stationId: a.machineStationId,
        cardBarcode: input.cardBarcode,
        rollIds,
        rollCount: result.moved,
        // Okutmanın yapıldığı TAMBUR cihazının makinesi — kurşun makinesiyle
        // karıştırılmasın diye ayrı alanda, yalnız denetim izi olarak durur.
        scannedOnMachineId: machineId ?? null,
        completedVia: KursunBypassCompletionSource.TAMBUR_SCAN,
      },
    });

    return {
      success: true,
      data: {
        alreadyDone: false,
        movedRollCount: result.moved,
        tamburStepId: tamburStep.id,
        workOrderId: a.workOrderId,
      },
      message: `Kurşun adımı tamamlandı, ${result.moved} top Tambur'a alındı`,
    };
  }

  // ---------------------------------------------------------------------------
  // ORTAK ÖZEL YARDIMCILAR
  // ---------------------------------------------------------------------------

  /**
   * "Bu iş emrinin Tambur bypass'ı ZATEN tamamlandı mı?" — idempotent tekrar
   * dalının kaynağı (salt okunur).
   *
   * `null` döner (yani çağıran 404 atar) iki halde:
   *  • WO'da hiç TAMBUR_SCAN ile tamamlanmış atama yok → gerçekten dağıtım yok.
   *  • Adımda YENİDEN açık top var (çok-parti 2. turu geldi ama daha dağıtılmadı)
   *    → bekleyen İŞ var ama bekleyen DAĞITIM yok; "zaten bitti" demek yanlış
   *    olurdu, operatör 2. partiyi sessizce yok sayılmış sanırdı.
   */
  private async findCompletedTamburBypass(
    workOrderId: string,
  ): Promise<{ tamburStepId: string | null } | null> {
    const done = await prisma.kursunBypassAssignment.findFirst({
      where: {
        workOrderId,
        completedAt: { not: null },
        completedVia: KursunBypassCompletionSource.TAMBUR_SCAN,
      },
      orderBy: { completedAt: "desc" },
      select: {
        workOrderStepId: true,
        workOrder: {
          select: {
            steps: {
              orderBy: { stepSequence: "asc" },
              select: {
                id: true,
                stepSequence: true,
                status: true,
                station: { select: { kind: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!done) return null;

    const stillOpen = await prisma.rollMovement.count({
      where: { workOrderStepId: done.workOrderStepId, exitedAt: null },
    });
    if (stillOpen > 0) return null;

    const next = nextNonSkippedStep(done.workOrder.steps, done.workOrderStepId);
    return {
      tamburStepId:
        next && next.station.kind === StationKind.TAMBUR ? next.id : null,
    };
  }

  /**
   * Tamamlama yollarının ortak ön-yüklemesi (atama + MAKİNE + adım + WO rotası).
   *
   * Düzleştirilmiş `machineStationId`/`machineName` alanları çağıranların iki
   * ihtiyacını karşılar: yetenek kopyalaması makinenin İSTASYONUNU ister
   * (`copyStationCapabilitiesToRoll`), movement damgası ise MAKİNENİN kendisini.
   */
  private async loadAssignmentForCompletion(assignmentId: string) {
    const a = await prisma.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        workOrderId: true,
        workOrderStepId: true,
        machineId: true,
        machine: { select: { name: true, stationId: true } },
        completedAt: true,
        cancelledAt: true,
        workOrder: {
          select: {
            workOrderNumber: true,
            status: true,
            steps: {
              orderBy: { stepSequence: "asc" },
              select: {
                id: true,
                stepSequence: true,
                status: true,
                station: { select: { kind: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!a) throw AppError.notFound("Dağıtım kaydı bulunamadı");
    if (a.cancelledAt) throw AppError.conflict("Bu dağıtım iptal edilmiş");
    return {
      ...a,
      assignmentId: a.id,
      machineName: a.machine.name,
      machineStationId: a.machine.stationId,
    };
  }

  /**
   * WO ÖLÜ MÜ? (kilit altında taze okuma). İptal/devredilmiş iş emrinin topu
   * finalize/ilerletme kabul etmez — Tambur finalize guard'ıyla aynı gerekçe:
   * kartlar VOIDED, top "canlı ama kimsenin okutamadığı" çıkmaza düşerdi.
   */
  private async assertWorkOrderAliveTx(
    tx: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<void> {
    const wo = await tx.workOrder.findUnique({
      where: { id: workOrderId },
      select: { status: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        "İptal/devredilmiş iş emrinde kurşun dağıtımı tamamlanamaz — dağıtımı iptal edin.",
      );
    }
  }

  /**
   * Atamayı ATOMİK CLAIM ile "tamamlandı" damgalar.
   *  • true  → claim BİZE düştü, kapatmaya devam.
   *  • false → idempotent tekrar (zaten tamamlanmış VE adımda açık top yok).
   *  • throw → gerçek çakışma (iptal edilmiş / hâlâ açık top varken tamamlanmış).
   */
  private async claimAssignmentTx(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    stepId: string,
    userId: string | undefined,
    via: KursunBypassCompletionSource,
  ): Promise<boolean> {
    const claim = await tx.kursunBypassAssignment.updateMany({
      where: { id: assignmentId, completedAt: null, cancelledAt: null },
      data: {
        completedAt: new Date(),
        completedById: userId ?? null,
        completedVia: via,
      },
    });
    if (claim.count > 0) return true;

    const fresh = await tx.kursunBypassAssignment.findUnique({
      where: { id: assignmentId },
      select: { completedAt: true, cancelledAt: true },
    });
    if (!fresh) throw AppError.notFound("Dağıtım kaydı bulunamadı");
    if (fresh.cancelledAt) {
      throw AppError.conflict("Bu dağıtım iptal edilmiş — tamamlanamaz");
    }
    // Zaten tamamlanmış: adımda açık top KALMADIYSA işi gerçekten biten bir
    // tekrar isteğidir (offline resume / çift dokunuş) → idempotent başarı.
    const stillOpen = await tx.rollMovement.count({
      where: { workOrderStepId: stepId, exitedAt: null },
    });
    if (stillOpen === 0) return false;
    throw AppError.conflict(
      "Bu dağıtım az önce tamamlandı ama adımda hâlâ açık top var — ekranı yenileyin.",
    );
  }

  /**
   * Adımın açık movement'larını BYPASS marker'ıyla kapatır ve kapatılan satırları
   * döner (finishStep şablonuyla birebir mekanik).
   *
   * • `qtyOut = qtyIn` / `weightOut = weightIn`: istasyona giren metraj olduğu
   *   gibi çıktı — bypass'ta kesim/fire kararı YOK.
   * • `exitedAt IS NULL` guard'ı: movement seti tx DIŞINDA seçildiği için bu
   *   koşul olmasa iki eşzamanlı istek aynı satırları kapatıp topu sonraki adıma
   *   İKİ kez ilerletirdi. Guard ile her satır tek tx'e düşer.
   * • `rollId = ANY(...)`: kapsam DARALTMASI — önizleme ile onay arasında adıma
   *   yeni top girmişse (fason kabul / önceki adım FINISH) o top süpürülmez.
   * • Marker uuid'si UYGULAMADA üretilir: `gen_random_uuid()` VOLATILE olup
   *   çok-satırlı UPDATE'te SATIR BAŞINA farklı değer üretir ve "tur" kimliğini
   *   bozardı (F161 dersi).
   * • `machineId` = ATANAN MAKİNE. Atama makine bazında yapıldığı için işi
   *   hangi fiziksel kurşun makinesinin yaptığı BİLİNİYOR — dağıtımı yapan kişi
   *   onu seçti. Damga bu yüzden konur; makine bazlı hacim raporları (kurşun
   *   makinesi başına metraj) bu sayede bypass işlerini de görür. Koşulsuz
   *   yazılır: satır zaten `exitedAt IS NULL` olduğundan bu tur bu adımda
   *   makine damgası koyan İLK ve TEK yazımdır.
   */
  private async closeBypassMovementsTx(
    tx: Prisma.TransactionClient,
    stepId: string,
    rollIds: string[],
    machineId: string,
  ): Promise<
    Array<{ rollId: string; qtyIn: Prisma.Decimal; weightIn: Prisma.Decimal | null }>
  > {
    const marker = `${KURSUN_BYPASS_MARKER_PREFIX}:${randomUUID()}`;
    const closed = await tx.$queryRaw<
      Array<{ rollId: string; qtyIn: Prisma.Decimal; weightIn: Prisma.Decimal | null }>
    >`
      UPDATE "roll_movements"
      SET "qtyOut" = "qtyIn",
          "weightOut" = "weightIn",
          "exitedAt" = NOW(),
          "machineId" = ${machineId}::uuid,
          "notes" = ${marker}
      WHERE "workOrderStepId" = ${stepId}::uuid
        AND "exitedAt" IS NULL
        AND "rollId" = ANY(${rollIds}::uuid[])
      RETURNING "rollId", "qtyIn", "weightIn"
    `;

    // KAPSAM PARİTESİ: istenen her top gerçekten kapatılmalı. Eksikse sessizce
    // daha az iş yapma (yıkıcı-onay ilkesi) — operatör önizlemeyi yenilesin.
    if (closed.length !== rollIds.length) {
      throw AppError.conflict(
        `Seçilen ${rollIds.length} topun ${closed.length} tanesi kapatılabildi — toplar bu sırada değişmiş. Önizlemeyi yenileyin.`,
      );
    }
    // Adımda BAŞKA açık top kaldıysa adım COMPLETED olamaz; yarım kapanış
    // bırakmak yerine tümünü geri al ve operatöre yeni durumu göster.
    const leftover = await tx.rollMovement.count({
      where: { workOrderStepId: stepId, exitedAt: null },
    });
    if (leftover > 0) {
      throw AppError.conflict(
        `Adıma bu sırada yeni top girdi (${leftover} adet) — önizlemeyi yenileyin.`,
      );
    }
    return closed;
  }
}
