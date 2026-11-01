// =============================================================================
// TeksERP - Kurşun + Kalite Kontrol 2 (PROCESS_QC) Service
// =============================================================================
// Kurşun ve Kalite Kontrol 2 tek fiziksel istasyon, tek WorkOrderStep.
// Her TOP (roll) için QC2_COMPLETED log'u operatör tarafından yazılır.
//
// Kurşun yeteneği per-station tanımlanır: istasyonun propertyCapabilities
// listesinde FabricProperty(code='KURSUN') varsa, QC2 tamamlanan her top
// otomatik olarak KURSUN_APPLIED log'u + RollProperty(KURSUN) kazanır.
// Per-roll "kurşun geçtim/geçmedim" toggle'ı yoktur — istasyon yeteneği
// tek doğruluk kaynağıdır.
//
// Hata tespiti (RollError) bu istasyonda açılır, Tambur'da karara bağlanır.
// Tespitte `detectedAtStepId` + `detectedByUserId` + `detectedAt` doldurulur.
// =============================================================================

import { ACTIVE_OPERATION, OWN_OPERATION, prepareWidthTracedStepOpTx, revokeWidthTracedStepOperationsTx } from "./helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT, reopenClosedMovementsTx, revokeRollMovements } from "./helpers/roll-movement.helper";
import { readActiveTargetValues } from "./helpers/workorder-target-value.helper";
import prisma from "../lib/prisma";
import { normalizeScanCode } from "../utils/code-format";
import { randomUUID } from "crypto";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  MeterPhase,
  MeterStockMode,
  Prisma,
  RollError,
  RollErrorOrigin,
  RollMeterAck,
  RollMeterReading,
  RollOperation,
  RollOperationType,
  RollStatus,
  FabricPropertyValueType,
  StationKind,
  StationPropertyMode,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { resolveWoStepForStation } from "./helpers/station-step-resolve.helper";
import { reopenWorkOrderTx } from "./helpers/workorder-event.helper";
import {
  STEP_FLOW_WHERE,
  STEP_FLOW_ERROR,
  STEP_FLOW_SELECT,
  stepRunsStepFlow,
  QUALITY_STEP_ERROR,
  STEP_QUALITY_SELECT,
  stepCanApplyQuality,
  KURSUN_PROPERTY_CODE,
} from "./helpers/quality-station.helper";
import {
  assertPropertySelectionsValid,
  type PropertySelection,
  copyStationCapabilitiesToRoll,
  loadStationPropertyCaps,
  resolveKursunApplication,
} from "./helpers/station-capability-transfer.helper";
import { applyKursunOperationTx } from "./helpers/kursun-operation.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { applyMeasuredWidthTx, assertStationCapturesWidth, measuredWidthLimit, type MeasuredWidthLimit } from "./helpers/measured-width.helper";
import { awaitsMeterSignature, loadRollMeterBases, type RollMeterBase } from "./helpers/kursun-meter-variance-sql.helper";
import { listMeterDeviations, type MeterDeviationFilter } from "./helpers/kursun-meter-deviation-list.helper";
import {
  ackMeterReadingTx,
  assertMeterInputAllowed,
  auditMeterAck,
  auditMeterReadingWrite,
  evaluateReadingVarianceTx,
  pendingMeterAcksTx,
  resolveKursunMeterPolicy,
  type MeterPolicyCopy,
  resolveSupervisorByPin,
  type MeterAckReason,
  meterReadingReplay,
  phaseAllowed,
  revokeStepMeterReadingsTx,
  writeMeterReadingTx,
  type MeterReadingInput,
  type WriteMeterReadingResult,
} from "./helpers/kursun-meter.helper";
import { readingPolicyOf } from "./helpers/meter-reading.helper";
import { applyExitMeterToStockTx, applyPendingExitMetersTx, auditExitMeterStock } from "./helpers/kursun-meter-stock.helper";
import { setWorkOrderCardStatusesTx } from "./helpers/traveler-card-fanout.helper";
import { finalizeRollsAtLastStep } from "./helpers/roll-finalize.helper";
import { reverseLatestScopedStockMove } from "./helpers/warehouse-ledger-reverse.helper";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import {
  assertKursunTabletMayWrite,
  resolveStepBypassEligibility,
} from "./helpers/kursun-bypass-eligibility.helper";
import { effectiveTamburPlanWidthGate, readFinanceServiceBillingBrodeUnit, resolveKursunBypassEnabled, resolveKursunMeterCapture, type KursunMeterCapture } from "./system-setting.service";
import { BRODE_PROPERTY_CODE, brodePieceInputOf } from "./helpers/service-quantity.helper";
import { uyari } from "../lib/logger";
import { assertRollsRevivable } from "./helpers/item-usage.helper";
import { processMeterNumber, requireProcessMeter } from "./helpers/roll-error-meter.helper";
import { recordRollDefectTx } from "./helpers/roll-defect.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE, isActionableRollError } from "./helpers/roll-error-scope.helper";

/** Muayene satırı KK2/Tambur silme ucundan silinemez (belge parçası; düzeltme revizyondur). */
const INSPECTION_ERROR_IMMUTABLE_MESSAGE = "Muayene hatası buradan silinemez; muayeneyi panelden düzeltin";

/**
 * "Açık (pending) bypass ataması" yüklemi — `kursun-bypass-guard.helper`
 * içindeki `findPendingBypassAssignmentTx` ile BİREBİR aynı tanım
 * (`completedAt IS NULL AND cancelledAt IS NULL`). Helper tekil adım sorgusu
 * döndürdüğü için `some`/`none` filtrelerinde ve nested select'lerde
 * kullanılamıyor; yüklemin üç yerde elle kopyalanmaması için tek sabit.
 */
const PENDING_BYPASS_WHERE: Prisma.KursunBypassAssignmentWhereInput = {
  completedAt: null,
  cancelledAt: null,
};

interface RollDefectSummary {
  id: string;
  /// Hata noktası (tek metre değeri). KK2/Kurşun operatörü "60. metrede hata"
  /// olarak girer; aralık bilgisi tutulmaz. Tambur operatörü ekranda görüp
  /// fiziksel kesim kararı verir.
  /// `includeInspection` istenmediyse hep sayı; muayene satırında NULL olabilir.
  startMeter: number | null;
  defectTypeId: string | null;
  errorType: string | null; // snapshot'lanmış ad (DefectType.name)
  /// Yalnız `includeInspection` isteğinde döner — eski istemcinin yanıtı bayt-eşit kalır.
  origin?: RollErrorOrigin;
}

interface RollSummary {
  rollId: string;
  /// Açık kumaş Roll'larında NULL olabilir.
  barcode: string | null;
  currentQty: number;
  qc2Completed: boolean;
  errorCount: number;
  defects: RollDefectSummary[];
  /// Kumaş cinsi + renk — WO.targetItem/targetColor (kart geneli aynı). Açık
  /// kumaş toplarında barkod yok; mobil liste bunları ad + renkle tanımlar.
  itemName: string | null;
  colorName: string | null;
  /// KQ-D7: topun BAŞKA adımda açılmış AÇIK hataları (gri, salt-okunur, künyeli). Eski APK yok sayar.
  priorDefects: PriorDefectSummary[];
  priorOpenErrorCount: number;
  /// H3b: sapma tabanı — YALNIZ `kursun.meterCapture` OUT/IN_OUT iken eklenir (OFF'ta anahtar yok, yanıt bayt-aynı).
  meter?: RollMeterBase;
  /// D4-KUC3b: ölçülen en sınırı — YALNIZ `capturesWidth` adımda (tablet isteği göndermeden uyarır; sınır yazım kapısıyla aynı hesap).
  widthLimit?: MeasuredWidthLimit;
}

interface PriorDefectSummary {
  id: string;
  startMeter: number | null;
  errorType: string | null;
  detectedStationName: string | null;
  detectedByName: string | null;
  detectedAt: Date;
}

interface StepSummary {
  workOrderStepId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  status: StepStatus;
  /// İstasyona KURSUN özelliği yetenek olarak atanmış mı? Mobil UI'da
  /// "her top otomatik kurşunlanır" banner'ı için.
  ///
  /// ⚠️ 2026-08-10: bu alan "İSTASYON verebilir mi" der, "BU TOPA yazılacak mı"
  /// DEMEZ — mod modelinde ikisi ayrıldı. Uygulanma kararı için `properties`
  /// içindeki KURSUN satırının `mode`'una bak. Alan eski APK sözleşmesi olduğu
  /// için anlamı değiştirilmeden bırakıldı.
  appliesKursun: boolean;
  /// İstasyonun özellik yetenekleri + MODLARI — tablet bu listeden tuş çizer.
  /// AUTO → salt bilgi satırı · OPTIONAL → tuş · REQUIRED → tuş + kapanış engeli.
  /// Eski APK bu alanı yok sayar (davranış: bugünkü gibi, yalnız AUTO yazılır).
  properties: {
    propertyId: string;
    code: string;
    name: string;
    mode: StationPropertyMode;
    /// BAYRAK → aç/kapa çipi · SEÇİM → değer çipleri (2026-08-11).
    valueType: FabricPropertyValueType;
    /// SEÇİM tipliyse operatöre sunulacak AKTİF değerler (BAYRAK'ta boş).
    /// Tablet tuşlarını BURADAN çizer — kodda sabit liste YOK.
    values: { code: string; name: string }[];
    /// Bu SEÇİM hangi BAYRAĞIN çeşidi (KQ-D4; çeşit değilse null).
    variantOfPropertyId: string | null;
  }[];
  /// KQ-D6: İE'nin AKTİF hedef çeşit değerleri (hedef kurşun gramajı). Tablet hedef
  /// düğmeyi vurgular, sapmayı işaretler, ENGELLEMEZ (D5). Eski APK yok sayar.
  /// `valueCode`: `properties[].values` id taşımaz, tablet düğmeyi koddan eşler.
  targetValues: { propertyId: string; valueId: string; valueCode: string }[];
  /// Bu adıma (Kurşun + KK2) yazılan serbest talimat — WorkOrderStep.notes
  /// (rotadaki RouteStep.defaultNotes'tan WO açılırken kopyalanır). Operatöre
  /// kart açıkken üstte sticky şerit olarak gösterilir (Tambur stepNote ile aynı).
  stepNote: string | null;
  /// Bu adım kurşun bypass'ına DAĞITILMIŞ mı (açık atama)? Doluysa tabletteki
  /// tüm yazma yolları 409 verir (assertStepNotBypassAssigned). Tablet ham 409
  /// beklemek yerine kartı okutur okutmaz "bu iş <makine>'ye dağıtıldı, kâğıtla
  /// işleniyor" bilgi ekranını gösterebilsin diye okuma yanıtında taşınır.
  ///
  /// MAKİNE adı taşınır, İSTASYON adı DEĞİL: atama makine bazındadır ve bu
  /// adımın istasyonu zaten tabletin bulunduğu tek PROCESS_QC istasyonudur —
  /// istasyon adını basmak operatöre "kendi istasyonuna dağıtıldı" dedirtirdi.
  bypassAssignment: { machineName: string; assignedAt: Date } | null;
  /**
   * TABLET SALT-OKUNUR MU? (2026-08-05 — "bayrak açıkken kurşun istasyonu yalnız
   * bilgi görür, hiçbir yetkisi yoktur") Non-null ise mobil ekran TÜM yazma
   * aksiyonlarını gizler ve `reason`'ı banda basar.
   *
   * İki sebepten doğar ve ikisi de aynı kapıdır (`assertKursunTabletMayWrite`):
   * adım bir kurşun makinesine dağıtılmış, ya da bayrak açık + adım dağıtıma
   * uygun. Uygun OLMAYAN adımlarda null kalır — o iş tablette yürümeye devam
   * eder (kurşundan sonra Tambur gelmeyen rotalar çıkmaza girmesin).
   *
   * ⚠️ Bu alan BİLGİDİR, koruma DEĞİL: gerçek kapı sunucudaki guard'tır (tablet
   * offline kuyruk taşır, ekranı hiç görmeyen istek gelebilir). İkisi aynı
   * fonksiyondan beslenir ki ekran ile red sebebi ayrışmasın.
   */
  tabletReadOnly: { reason: string } | null;
  /// Adım istasyonu MUAYENE yapar mı (KQ-D3; kalite ikizi `stepCanApplyQuality`).
  /// Tablet hata panelini buradan çizer; eski APK yok sayar (paneli hep çizer,
  /// kapalı istasyonda yazma 400 alır).
  inspectionEnabled: boolean;
  /// D4-E2b: adım istasyonu en ölçer mi (`Station.capturesWidth`). Yalnız true iken anahtar VAR —
  /// kapalı istasyonda yanıt eskisiyle bayt-aynı; tablet alan yoksa "Ölçülen en" girişini çizmez.
  capturesWidth?: true;
  /// Atlanmamış sonraki adımın istasyon adı ("Adımı Kapat — Toplar X'e"); son adımsa null.
  nextStepName: string | null;
  /// Adımda açık top yoksa NEDEN boş + topların şu anki istasyonu (KQ-D3, D2 kararı):
  /// tablet bunu hata değil bilgi olarak gösterir. Açık top varsa ya da adım bittiyse null.
  emptyStep: EmptyStepInfo | null;
  /// H3b: sayaç kipi + sapma politikası (tablet `KursunStepSummary.meter`). OFF'ta anahtar YOK — eski
  /// istemci ve OFF fabrikanın yanıtı bayt-aynı; tablet alan yoksa OFF davranır.
  meter?: { capture: Exclude<KursunMeterCapture, "OFF">; policy: MeterPolicyCopy };
  /// GK-H1b: brode istasyonunda ADET/VURUŞ fiyatlamasında tablet çıkış okumasına "Adet" ister. METER'de anahtar YOK.
  pieceInput?: "PIECE" | "STITCH";
  rolls: RollSummary[];
}

interface EmptyStepInfo {
  code: "NOT_ARRIVED" | "PASSED" | "NO_ACTIVE_ROLLS";
  message: string;
  /// Topların bulunduğu istasyon adları (sıralı; "KK Masa 2 (3 rulo)" değil, salt ad).
  currentStations: string[];
}

export interface KursunQueueItem {
  /// WorkOrderStep.id — reorder/urgent endpoint'leri bu id'yi alır.
  /// Tablet `open-cards` listesi ve Electron Kurşun Sırası ortak okur.
  workOrderStepId: string;
  /// Adımın İSTASYONU. Fabrikada PROCESS_QC türünde TEK istasyon var → bu alan
  /// pratikte her satırda AYNIDIR; gruplama/ayırt etme anahtarı DEĞİLDİR,
  /// yalnızca bağlam/başlık bilgisidir.
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  /// Refakat kartı (ACTIVE) numarası — bulunamazsa null.
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  /// Kumaş cinsi — WO.targetItem.name.
  itemName: string | null;
  /// Renk adı + hex — WO.targetColor.
  colorName: string | null;
  colorHex: string | null;
  /// PROCESS_QC adımı bekleyen açık top sayısı.
  openRollCount: number;
  /// Bekleyen toplarda kalan toplam metre.
  totalCurrentQty: number;
  /// İlk topun girişi (en eski) — UI'da bekleme süresi göstermek için.
  oldestEnteredAt: Date | null;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: Date | null;
  /**
   * Bu adım kurşun dağıtımına (bypass) verilmiş mi — açık atama var mı?
   *
   * ⚠️ BU ALAN GRUPLAMA ANAHTARI DEĞİL, BİLGİLENDİRME BAYRAĞIDIR. Kurşun Sırası
   * ekranı bypass AÇIKKEN tamamen gizlenir (kuyruk sıralamasının tek tüketicisi
   * kurşun tabletiydi; bypass rejiminde kurşunda tablet yok, izleme + acil
   * işaretleme Kurşun Dağıtım ekranına taşındı). Bu alanların tek anlamı KARIŞIK
   * REJİMDİR: bayrak yeni açıldığında hâlâ tablet rejiminde bekleyen işler
   * varken planlamacı hangisinin dağıtıldığını ayırt edebilsin. Bu yüzden
   * listQueue MAKİNE BAZINDA GRUPLAMA YAPMAZ — gruplama/sıra izleme yüzeyi
   * Kurşun Dağıtım ekranıdır.
   */
  bypassAssigned: boolean;
  /**
   * Dağıtımın atandığı fiziksel kurşun makinesinin adı (rozet metni).
   * null = dağıtılmamış (`bypassAssigned === false`).
   *
   * İki alan da AYNI sorgunun AYNI satırından türer (aşağıdaki nested select) —
   * ayrı kaynaklardan gelmedikleri için birbirine göre bayatlayamazlar; ad ayrı
   * taşınır çünkü UI rozeti "dağıtıldı" demekle yetinmeyip "hangi makinede"yi
   * yazar. Makine `id`'si BİLİNÇLİ olarak taşınmaz: id yalnız gruplama anahtarı
   * olarak işe yarardı ve bu ekranda gruplama yok.
   */
  bypassMachineName: string | null;
}

/** H2: completeQc2 cevabında metre okuması + sapma işareti (tablet bekleyen imzayı buradan bilir). */
export interface KursunMeterSummary {
  readingId: string;
  meters: number;
  approvalMode: string;
  deviated: boolean;
  baseMeters: number | null;
  diffMeters: number | null;
  allowedMeters: number | null;
  pendingAck: boolean;
}

export class KursunQcService {
  // ---------------------------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------------------------
  /**
   * Refakat kartı barkoduyla PROCESS_QC adımını ve bu adıma giren rolleri çöz.
   * Operatör tablette kartı okutur, bu metot hangi step'te olduğunu ve hangi
   * rollerin bu step'e girmiş olduğunu döner.
   */
  async getByCardBarcode(
    cardBarcode: string,
    stationId: string | null = null,
  ): Promise<ApiResponse<StepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: normalizeScanCode(cardBarcode) },
      select: {
        id: true,
        status: true,
        workOrderId: true,
      },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    // Adım okutan tabletin OTURUM istasyonundan çözülür (KQ-D2): Kurşun→KK→Tambur
    // rotasında KK tableti kurşun adımına düşmez. Oturumsuz istek bugünkü "ilk
    // akış adımı" davranışında kalır; COMPLETED adım özeti reopen-confirm'i açar.
    const { stepId } = await resolveWoStepForStation(card.workOrderId, stationId);
    return this.buildStepSummary(stepId);
  }

  /** Step ID ile doğrudan çek (admin/test ekranları). */
  async getStep(
    stepId: string,
    opts: { includeInspection?: boolean } = {},
  ): Promise<ApiResponse<StepSummary>> {
    return this.buildStepSummary(stepId, opts);
  }

  /**
   * Şu an PROCESS_QC istasyonlarında açık top bekleyen tüm aktif refakat kartları.
   * Mobil "kamera simülasyonu" modal'ı için — operatör fiziksel kart yokken
   * bu listeden seçim yapabilir.
   *
   * Filtre: station.kind = PROCESS_QC, step.status != COMPLETED, en az 1 açık top
   * (currentStepId = step.id), ve WO'nun ACTIVE refakat kartı mevcut.
   * `stationId` (oturum istasyonu, KQ-D2) verilirse yalnız o istasyonun adımları;
   * oturumsuz istek bugünkü gibi tüm akış adımlarını görür.
   */
  async listOpenCards(stationId: string | null = null): Promise<
    ApiResponse<
      Array<{
        cardId: string;
        cardNumber: string;
        cardBarcode: string;
        workOrderId: string;
        batchNumber: string;
        stepId: string;
        stationName: string;
        stationCode: string;
        openRollCount: number;
        /** KQ-D7: karttaki açık topların açık hata toplamı (⚠N rozeti). Eski APK yok sayar. */
        openErrorCount: number;
        priority: number;
        isUrgent: boolean;
      }>
    >
  > {
    // Emniyet tavanı: tablet açık-kart paneli bu ucu 5sn'de bir yokluyor; `take`
    // yokken patolojik durumda tüm açık adımları çekerdi. Öncelik-sıralı kuyruk
    // olduğundan ilk OPEN_CARDS_CAP zaten en kritikleri. Gerçekte bu kadar eş
    // zamanlı açık QC adımı görülmez → emniyet ağı; dolarsa sessiz kalma (loglar).
    const OPEN_CARDS_CAP = 500;
    const steps = await prisma.workOrderStep.findMany({
      where: {
        station: { ...STEP_FLOW_WHERE },
        // Adım KOLONU — `station` spread'ine ek anahtar yazılmaz (OR ezilir).
        ...(stationId ? { stationId } : {}),
        status: { not: "COMPLETED" },
        currentRolls: { some: {} },
        // Kurşun bypass'a DAĞITILMIŞ adımlar bu listede GÖRÜNMEZ: bu liste
        // "kamera simülasyonu" seçim listesidir ve seçilen her kart tabletin
        // yazma akışına (completeQc2 → finishStep) girer. Dağıtılmış adımda o
        // akışın her adımı 409 döner → operatöre seçtirip sonra reddetmek
        // yerine hiç göstermiyoruz. (Fiziksel kart yine okutulabilir; o yolda
        // getByCardBarcode `bypassAssignment` ile durumu açıklar.)
        //
        // ⚠️ BAYRAK AÇIKKEN "dağıtıma UYGUN" adımlar burada SÜZÜLMEZ (2026-08-05
        // bilinçli kararı). İki gerekçe: (a) uygunluk kuralı rota + üç dijital-iz
        // sorgusu ister ve bu uç tablet tarafından 5 SANİYEDE BİR yoklanıyor —
        // filtre, hiç yapılmayacak bir işi elemek için sürekli maliyet demekti;
        // (b) artık gereksiz: kart açıldığında `tabletReadOnly` bandı sebebi
        // SOMUT olarak söylüyor, yani eski "sessiz 409" sorunu kaynağında çözüldü.
        // Uygun OLMAYAN adımlar zaten listede KALMALI (tablet onları işlemeye
        // devam eder) — kör bir bayrak filtresi onları da yutardı.
        kursunBypasses: { none: PENDING_BYPASS_WHERE },
      },
      select: {
        id: true,
        workOrderId: true,
        priority: true,
        isUrgent: true,
        urgentMarkedAt: true,
        station: { select: { name: true, code: true } },
        workOrder: {
          select: {
            workOrderNumber: true,
            // Kart iş emri başına — WO'nun aktif kartı.
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { id: true, cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        // Parti no (görüntü): step'teki ilk partili topun batch no'su (opsiyonel).
        currentRolls: {
          where: { batchId: { not: null } },
          take: 1,
          select: { batch: { select: { batchNumber: true } } },
        },
        _count: { select: { currentRolls: true } },
      },
      // Planlamanın belirlediği kuyruk sırasıyla aynı: acil → priority → en eski
      orderBy: [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
      take: OPEN_CARDS_CAP,
    });
    if (steps.length === OPEN_CARDS_CAP) {
      uyari("kursun-qc", `listOpenCards: ${OPEN_CARDS_CAP} açık-kart tavanına ulaşıldı — liste kırpılmış olabilir.`
      );
    }

    // ⚠N rozeti: TEK groupBy (adım başına sorgu yok — uç 5 sn'de bir yoklanır).
    const openErrorsByStep = await this.countOpenErrorsByStep(steps.map((s) => s.id));

    const data = steps
      .map((s) => {
        const card = s.workOrder.travelerCards[0];
        if (!card) return null;
        const batchNumber = s.currentRolls[0]?.batch?.batchNumber ?? s.workOrder.workOrderNumber;
        return {
          cardId: card.id,
          cardNumber: card.cardNumber,
          cardBarcode: card.barcode,
          workOrderId: s.workOrderId,
          batchNumber,
          stepId: s.id,
          stationName: s.station.name,
          stationCode: s.station.code,
          openRollCount: s._count.currentRolls,
          openErrorCount: openErrorsByStep.get(s.id) ?? 0,
          priority: s.priority,
          isUrgent: s.isUrgent,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { success: true, data };
  }

  /** Adımdaki açık topların açık (karar yolu) hata sayısı — `roll.currentStepId` üzerinden tek groupBy. */
  private async countOpenErrorsByStep(stepIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (stepIds.length === 0) return out;
    const groups = await prisma.rollError.groupBy({
      by: ["rollId"],
      where: { ...ACTIONABLE_ROLL_ERROR_WHERE, isProcessed: false, roll: { currentStepId: { in: stepIds } } },
      _count: { _all: true },
    });
    if (groups.length === 0) return out;
    const rolls = await prisma.roll.findMany({
      where: { id: { in: groups.map((g) => g.rollId) } },
      select: { id: true, currentStepId: true },
    });
    const stepOf = new Map(rolls.map((r) => [r.id, r.currentStepId]));
    for (const g of groups) {
      const st = stepOf.get(g.rollId);
      if (st) out.set(st, (out.get(st) ?? 0) + g._count._all);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // PER-ROLL ACTIONS
  // ---------------------------------------------------------------------------
  /**
   * Bir topun Kalite Kontrol 2 işlemini tamamla (per-roll).
   * Toplar teker teker `QC2_COMPLETED` işaretlenir; tüm roller bittiğinde
   * operatör `finishStep` çağrısıyla adımı kapatır.
   *
   * Yetenek aktarımı MODA bağlıdır (2026-08-10): AUTO satırlar her zaman,
   * OPTIONAL/REQUIRED satırlar yalnız operatör işaretlediyse (`properties`)
   * Roll'a yazılır. REQUIRED bir özellik işaretlenmemişse adım kapanmaz.
   * SEÇİM tipli özellikte işaret yetmez, DEĞER de gelir (2026-08-11):
   * `{ propertyId, valueCode }` → `RollProperty.valueId`.
   *
   * KURSUN_APPLIED log'u, KURSUN özelliğinin bu topa GERÇEKTEN yazılıp
   * yazılmadığına bağlıdır — eski per-roll "Kurşun geçildi mi?" toggle'ının yerini
   * alır. ⚠️ Eskiden yalnız "istasyonun listesinde KURSUN var mı" diye bakılıyordu;
   * mod modelinde bu, operatörün işaretlemediği bir kurşunu log'a yazmak olurdu.
   */
  async completeQc2(
    data: {
      rollId: string;
      stepId: string;
      notes?: string | null;
      /** Operatörün cevapları (OPTIONAL/REQUIRED). AUTO'lar gönderilmese de
       *  yazılır; eski APK bu alanı hiç göndermez → yalnız AUTO uygulanır.
       *  SEÇİM tipli özellikte `valueCode` ZORUNLUDUR. */
      properties?: PropertySelection[] | null;
      /** H1 çıkış metresi; `kursun.meterCapture` OFF iken yok sayılır (bugünkü davranış). */
      meterOut?: MeterReadingInput | null;
      /** D4-E2a ölçülen en (cm); yalnız `Station.capturesWidth` istasyonunda. Yok = en değişmez. */
      measuredWidthCm?: number | null;
    },
    userId?: string,
    machineId?: string | null
  ): Promise<ApiResponse<RollOperation & { meter?: KursunMeterSummary }>> {
    await this.assertRollInFlowStep(data.rollId, data.stepId);

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      select: { stationId: true, workOrderId: true },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    const measuredWidthCm = data.measuredWidthCm ?? null;
    if (measuredWidthCm != null) await assertStationCapturesWidth(prisma, step.stationId);

    // H1: okuma yalnız kip açıkken yazılır; açıkken SIMULATED/cihaz kapısı fail-closed (§4).
    const meterOut =
      data.meterOut && phaseAllowed(await resolveKursunMeterCapture(), MeterPhase.OUT) ? data.meterOut : null;
    if (meterOut) await assertMeterInputAllowed(MeterPhase.OUT, meterOut);
    const meterReplay = meterOut
      ? meterReadingReplay({ rollId: data.rollId, stepId: data.stepId, phase: MeterPhase.OUT, meters: meterOut.meters, pieceCount: meterOut.pieceCount ?? null })
      : null;

    const caps = await loadStationPropertyCaps(prisma, step.stationId);
    assertPropertySelectionsValid(caps, data.properties);

    // KURSUN bu topa yazılacak mı + hangi gramajla? TEK karar (KQ-D4,
    // `resolveKursunApplication`): defter satırı ile RollProperty aynı karardan.
    const kursun = resolveKursunApplication(caps, data.properties);
    const kursunApplied = kursun.applied;

    // F283: Idempotency — op zaten varsa (offline outbox replay: sunucu commit etti
    // ama yanıt istemciye ulaşmadı) upsert no-op'tur. RollOperation append-only
    // (updatedAt YOK) → no-op'ta hiçbir şey değişmez; audit'i CREATE olarak TEKRAR
    // yazma (createInitialEntry replay-skip deseni).
    const existedBefore = await prisma.rollOperation.findUnique({
      where: { ...ACTIVE_OPERATION,
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
      select: { id: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      // H1 tx sırası (§3-4, §12-1): 8036 token kilidi İLK ifade → WO kilidi (finishStep ile
      // serileşir) → tablet kapısı. Metresiz çağrı bugünkü sırada kalır.
      const meterPrior = meterOut && meterReplay ? await meterReplay.inTx(tx, meterOut.clientToken) : null;
      if (meterOut || measuredWidthCm != null) await touchWorkOrderTx(tx, step.workOrderId);

      // Kurşun bypass: adım fiziksel bir kurşun MAKİNESİNE dağıtılmışsa iş
      // KÂĞITTA yürüyor — tablet KK2 kaydı yazamaz. Guard tx İÇİNDE ve ilk
      // sırada: `existedBefore` / yetenek okumaları tx DIŞINDA yapıldığı
      // için pencerede araya giren `assign` bu QC2 op'unu commit ettirirdi.
      // (Ters yön zaten kapalı: `assign` de adımda fiilen yapılmış QC2 op'u
      // görürse dağıtımı reddediyor — iki yön birbirini eler.)
      await assertKursunTabletMayWrite(tx, data.stepId, "KK2 tamamlama");

      // D4-E2a: kilit sırası token → iş emri → top FOR UPDATE → yazım. Satır zaten varsa
      // (replay / yeniden basış) en yeniden yazılmaz: aynı değer no-op, farklı değer 409.
      // Karar tek boğazda: aynı değer no-op, izsiz satır damgalanıp yeniden yazılır, farklı değer 409.
      const widthMode = measuredWidthCm != null
        ? await prepareWidthTracedStepOpTx(tx, { rollId: data.rollId, stepId: data.stepId, measuredWidthCm, userId: userId ?? null })
        : null;
      const widthTrace = measuredWidthCm != null && widthMode === "APPLY"
        ? await applyMeasuredWidthTx(tx, { rollId: data.rollId, measuredWidthCm })
        : null;

      // Upsert yalnız AKTİF satıra bakar: unique partial'dır; geri alınmış iz
      // bulunursa yeniden yapılan KK2 yeni satır yazmaz ve top adımda takılırdı.
      const qc2Op = await tx.rollOperation.upsert({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: data.rollId,
            workOrderStepId: data.stepId,
            operationType: RollOperationType.QC2_COMPLETED,
          },
          ...ACTIVE_OPERATION,
        },
        create: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
          operatorId: userId ?? null,
          machineId: machineId ?? null,
          metadata:
            data.notes || widthTrace
              ? { ...(data.notes ? { notes: data.notes } : {}), ...(widthTrace ?? {}) }
              : undefined,
        },
        update: {},
      });

      // Gramaj düzeltmesi defteri değiştirmez: eski satır damgalanır, yenisi
      // yazılır (`applyKursunOperationTx`); aynı değer replay'i no-op.
      const kursunOutcome = kursunApplied
        ? await applyKursunOperationTx(tx, {
            rollId: data.rollId,
            stepId: data.stepId,
            valueId: kursun.valueId,
            userId: userId ?? null,
            machineId: machineId ?? null,
          })
        : "noop";

      const copied = await copyStationCapabilitiesToRoll(tx, {
        stationId: step.stationId,
        rollId: data.rollId,
        selections: data.properties,
        caps,
        userId: userId ?? null,
      });

      // Okuma KURSUN_APPLIED'dan sonra; replay'de (aynı token) yeni satır yazılmaz.
      const meterWrite: WriteMeterReadingResult | null =
        meterOut && !meterPrior
          ? await writeMeterReadingTx(tx, {
              rollId: data.rollId,
              stepId: data.stepId,
              phase: MeterPhase.OUT,
              input: meterOut,
              userId: userId ?? null,
              machineId: machineId ?? null,
              reason: "KURSUN_METER_REPRESS",
            })
          : null;

      return { qc2Op, kursunOutcome, propertiesChanged: copied.changed, meterWrite, widthTrace };
    });
    const op = result.qc2Op;
    if (result.meterWrite) await auditMeterReadingWrite(userId, result.meterWrite, "COMPLETE_QC2");
    if (result.meterWrite) await auditExitMeterStock(userId, result.meterWrite.reading.id, result.meterWrite.stock ?? null);
    if (result.meterWrite?.ack) await auditMeterAck(userId, result.meterWrite.ack);
    const meter = await this.meterSummary(result.meterWrite?.reading ?? null, data.rollId, data.stepId, meterOut != null);

    // F283: yalnız gerçekten yeni oluşturulduysa audit yaz (replay'de mükerrer önlenir).
    if (!existedBefore) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "ROLL_OPERATION",
        recordId: op.id,
        newData: {
          rollId: data.rollId,
          stepId: data.stepId,
          type: RollOperationType.QC2_COMPLETED,
          kursunApplied,
          // Basılan gramaj kodu (çeşit bağı yoksa / seçilmediyse null).
          valueCode: kursun.valueCode,
          // Operatörün elle işaretledikleri — AUTO'lar bu listede olmayabilir.
          selections: data.properties ?? [],
          ...(result.widthTrace ?? {}),
        },
      });
    } else if (result.kursunOutcome !== "noop" || result.propertiesChanged) {
      // Op zaten vardı ve operatör FARKLI seçimle tekrar bastı — meşru düzeltme
      // yolu (gramaj 25GR → 50GR: defter satırı damga + yeni satır, RollProperty
      // sürüm). Sessiz bırakmak değerin kayıtsız değişmesi demekti (denetim F2).
      // KQ-D4: aynı seçimin replay'i artık audit YAZMAZ — değişim ölçülüyor.
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL_OPERATION",
        recordId: op.id,
        newData: {
          rollId: data.rollId,
          stepId: data.stepId,
          type: RollOperationType.QC2_COMPLETED,
          reappliedSelections: data.properties,
          kursunOutcome: result.kursunOutcome,
          valueCode: kursun.valueCode,
        },
      });
    }

    return { success: true, data: meter ? { ...op, meter } : op, message: "Kalite Kontrol 2 tamamlandı" };
  }

  /** completeQc2 cevabındaki metre özeti (H2 işareti) — replay'de aynı token'ın aktif okumasından. */
  private async meterSummary(written: RollMeterReading | null, rollId: string, stepId: string, sent: boolean): Promise<KursunMeterSummary | null> {
    if (!sent) return null;
    const reading =
      written ??
      (await prisma.rollMeterReading.findFirst({ where: { rollId, workOrderStepId: stepId, phase: MeterPhase.OUT, revokedAt: null } }));
    if (!reading) return null;
    const v = await evaluateReadingVarianceTx(prisma, reading);
    const acked = (await prisma.rollMeterAck.count({ where: { readingId: reading.id, revokedAt: null } })) > 0;
    return {
      readingId: reading.id,
      meters: Number(reading.meters),
      approvalMode: readingPolicyOf(reading).approvalMode,
      deviated: v.deviated,
      baseMeters: v.baseMeters,
      diffMeters: v.diffMeters,
      allowedMeters: v.allowedMeters,
      pendingAck: awaitsMeterSignature(readingPolicyOf(reading).approvalMode, v.needsAck, acked),
    };
  }

  /**
   * H2 sapma imzası — SUPERVISOR_PIN (tablet, yalnız çevrimiçi) ya da OFFICE (panel). PIN yalnız burada
   * çözülür; kuyruğa, log'a, audit'e girmez. İkinci imza 409 `METER_ALREADY_ACKED`.
   */
  async ackMeterReading(
    data: { readingId: string; mode: "SUPERVISOR_PIN" | "OFFICE"; pin?: string | null; reason?: MeterAckReason | null },
    userId?: string,
  ): Promise<ApiResponse<RollMeterAck>> {
    if (!userId) throw AppError.unauthorized();
    const approvedById = data.mode === "SUPERVISOR_PIN" ? (await resolveSupervisorByPin(data.pin ?? "")).id : userId;
    const target = await prisma.rollMeterReading.findUnique({ where: { id: data.readingId }, select: { workOrderStepId: true } });
    if (!target) throw AppError.notFound("Metre okuması bulunamadı");
    const targetStep = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: target.workOrderStepId }, select: { workOrderId: true } });
    const { ack, stock } = await prisma.$transaction(async (tx) => {
      // H1b kilit sırası: WO kilidi İLK ifade (elle taşıma / yeniden açma / kapanışla aynı sıra: WO → okuma → top).
      await touchWorkOrderTx(tx, targetStep.workOrderId);
      const signed = await ackMeterReadingTx(tx, { readingId: data.readingId, mode: data.mode, approvedById, reason: data.reason ?? null });
      // H1b: imzayla okuma etkin olur — APPLY kopyalıysa stoğa şimdi uygulanır (okuma satırı imzada kilitli).
      const reading = await tx.rollMeterReading.findUniqueOrThrow({ where: { id: signed.readingId } });
      return { ack: signed, stock: await applyExitMeterToStockTx(tx, reading, approvedById) };
    });
    await auditMeterAck(userId, ack);
    await auditExitMeterStock(userId, ack.readingId, stock);
    return { success: true, data: ack, message: "Metre sapması onaylandı" };
  }

  /** H4 ofis listesi: sapmalı okumalar + özet şeridi (tek where; durum `finishStep` kapısıyla aynı yüklemden). */
  async listMeterDeviations(filter: MeterDeviationFilter, page: { cursor?: string; limit: number }) {
    const res = await listMeterDeviations(filter, page);
    return {
      success: true,
      data: res.rows,
      pagination: { nextCursor: res.nextCursor, hasMore: res.nextCursor !== null, limit: page.limit },
      summary: res.summary,
    };
  }

  // K6 (2026-06-12): undoQc2 kaldırıldı — yarım geri alıyordu (KURSUN op +
  // RollProperty topta kalıyordu), UI butonu 2026-06-07'de silinmişti, endpoint
  // çağrısızdı. Kurtarma yolu: kapalı kartı tekrar okut (reopenStep).

  // ---------------------------------------------------------------------------
  // DEFECT ENTRY
  // ---------------------------------------------------------------------------
  /**
   * Topta hata tespit et. RollError detectedAtStep/User/At ile kayıt açar.
   * Tambur'da karara bağlanır (isProcessed=true olana kadar pending).
   *
   * Hata tipi DefectType kataloğundan seçilir — serbest metin kabul edilmez.
   * Katalog ileride yeniden adlandırılsa bile historik etiket `errorType`
   * alanına snapshot olarak yazılır.
   */
  async reportError(
    data: {
      rollId: string;
      stepId: string;
      startMeter: number;
      defectTypeId: string;
      /** Mobil offline kuyruğu için client-üretimi UUID. Verilirse RollError.id
       *  olarak kullanılır → resume/retry idempotent olur (aynı id'li 2. çağrı
       *  mevcut kaydı döner). KK1 client-barkod pattern'iyle aynı. */
      clientErrorId?: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    // Offline retry/resume idempotency: client kendi UUID'sini verdiyse ve bu id
    // zaten kayıtlıysa, tekrar oluşturma — mevcut kaydı dön (audit ilk çağrıda
    // yazıldı). Mobil paused mutation online dönünce tek sefer çalışır; ama
    // network retry'ında yanıt kaybolursa 2. çağrı buraya düşer.
    if (data.clientErrorId) {
      const cached = await prisma.rollError.findUnique({
        where: { id: data.clientErrorId },
      });
      if (cached) {
        this.assertClientErrorIdMatches(cached, data);
        return {
          success: true,
          data: cached,
          message: "Hata zaten kayıtlı (idempotent retry)",
        };
      }
    }

    const roll = await prisma.roll.findUnique({ where: { id: data.rollId }, select: { id: true } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Akış adımı (kart akışı) burada; muayene kapısı, konum, tip ve mükerrer
    // kuralları TEK boğazda (`recordRollDefectTx`, KQ-D7).
    await this.assertRollInFlowStep(data.rollId, data.stepId);

    // Kurşun bypass: dağıtılmış adımda hatalar KÂĞITTA tutulur (fabrika kurşun
    // istasyonuna tablet koymuyor). Dijital RollError açmak iki soruna yol açar:
    // (a) Tambur bypass onayı hatasız bir iş bekler, (b) `assign` de "bu adımda
    // hata kaydı var" diye dağıtımı reddediyor. Guard idempotent clientErrorId
    // dönüşünden SONRA: zaten kayıtlı hatanın replay'i 409'a düşmemeli.
    await assertKursunTabletMayWrite(prisma, data.stepId, "hata kaydı");

    let rec: Awaited<ReturnType<typeof recordRollDefectTx>>;
    try {
      rec = await prisma.$transaction((tx) =>
        recordRollDefectTx(tx, {
          id: data.clientErrorId,
          rollId: data.rollId,
          stepId: data.stepId,
          startMeter: data.startMeter,
          defectTypeId: data.defectTypeId,
          userId,
          stationGate: "FLOW",
        }),
      );
    } catch (e) {
      // Eşzamanlı replay yarışı: aynı clientErrorId ile 2. create PK'de P2002 →
      // mevcut kaydı idempotent dön (iş-anahtarı çakışması helper'da 409 olur).
      if (data.clientErrorId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const dup = await prisma.rollError.findUnique({ where: { id: data.clientErrorId } });
        if (dup) {
          this.assertClientErrorIdMatches(dup, data);
          return { success: true, data: dup, message: "Hata zaten kayıtlı (idempotent retry)" };
        }
      }
      throw e;
    }
    const err = rec.error;
    const created = rec.auditPayload.defects[0];

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_ERROR",
      recordId: err.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        startMeter: data.startMeter,
        defectTypeId: created.defectTypeId,
        errorType: created.errorType,
      },
    });

    return {
      success: true,
      data: err,
      message: `${created.errorType} · ${data.startMeter}. metrede`,
    };
  }

  /**
   * Hatalı tespit edilen kaydı sil (Tambur karar vermeden önce).
   */
  async deleteError(
    data: { errorId: string },
    userId?: string
  ): Promise<ApiResponse<{ deleted: true }>> {
    const err = await prisma.rollError.findUnique({ where: { id: data.errorId } });
    if (!err) {
      // Idempotent: kayıt zaten yok (delete replay'i veya offline'da ekle→sil
      // sırasında ekleme hiç sunucuya ulaşmamış olabilir) → başarı dön.
      return { success: true, data: { deleted: true }, message: "Hata kaydı zaten yok" };
    }
    if (err.origin !== ACTIONABLE_ROLL_ERROR_WHERE.origin) {
      throw AppError.badRequest(INSPECTION_ERROR_IMMUTABLE_MESSAGE, { code: "INSPECTION_ERROR_IMMUTABLE" });
    }

    await this.assertDeleteStationInspects(err);

    // ATOMİK guard: yalnız İŞLENMEMİŞ kayıt silinir — findUnique↔delete arası
    // eşzamanlı Tambur finalize'ı isProcessed=true yaparsa count=0 → silinmez
    // (eski bare delete TOCTOU'su: işlenen hata kaydı sessizce silinebiliyordu).
    // Köken de WHERE'de: muayene satırı bu uçtan hiçbir pencerede silinmez.
    const deleted = await prisma.rollError.deleteMany({
      where: { ...ACTIONABLE_ROLL_ERROR_WHERE, id: data.errorId, isProcessed: false },
    });
    if (deleted.count === 0) {
      // Pencerede ya Tambur işledi ya başka bir silme aldı — taze duruma bak.
      const after = await prisma.rollError.findUnique({
        where: { id: data.errorId },
        select: { id: true, origin: true },
      });
      if (!after) {
        return { success: true, data: { deleted: true }, message: "Hata kaydı zaten yok" };
      }
      if (after.origin !== ACTIONABLE_ROLL_ERROR_WHERE.origin) {
        throw AppError.badRequest(INSPECTION_ERROR_IMMUTABLE_MESSAGE, { code: "INSPECTION_ERROR_IMMUTABLE" });
      }
      throw AppError.badRequest("Tambur kararı verilmiş hata kaydı silinemez");
    }

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL_ERROR",
      recordId: data.errorId,
      oldData: {
        rollId: err.rollId,
        startMeter: err.startMeter,
        errorType: err.errorType,
        // F163: fiziksel DELETE geri-alınamaz → tüm alanları denetime al (yeniden kurmak için).
        defectTypeId: err.defectTypeId,
        detectedAtStepId: err.detectedAtStepId,
        detectedByUserId: err.detectedByUserId,
        detectedAt: err.detectedAt,
        isProcessed: err.isProcessed,
      },
    });

    return { success: true, data: { deleted: true }, message: "Hata kaydı silindi" };
  }

  // ---------------------------------------------------------------------------
  // FINISH STEP (batch-level)
  // ---------------------------------------------------------------------------
  /**
   * Tüm topların QC2'si tamamlandıysa step'i kapatır:
   *   - Açık RollMovement'leri (exitedAt=null) kapatır
   *   - Her top bir sonraki adıma taşınır (openMovementForNextStep)
   *   - Step COMPLETED olarak işaretlenir
   *
   * Aşağıdaki durum hata döndürür:
   *   - QC2_COMPLETED olmayan en az bir aktif top varsa
   */
  async finishStep(
    data: { stepId: string },
    userId?: string,
    machineId?: string | null
  ): Promise<ApiResponse<{ movedRollCount: number }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        workOrder: {
          include: { steps: { orderBy: { stepSequence: "asc" } } },
        },
      },
    });
    if (!step) throw AppError.notFound("Terbiye iş emri adımı bulunamadı");
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(STEP_FLOW_ERROR);
    }

    const openMovements = await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: step.id, exitedAt: null },
      select: { id: true, rollId: true, weightIn: true, qtyIn: true },
    });

    if (openMovements.length === 0) {
      // Idempotent: offline resume/retry'da adım zaten kapatılmış olabilir
      // (toplar taşınmış → açık movement kalmaz). "Adımı Kapat" butonu yalnız
      // top varken çıktığı için boş = zaten kapanmış → hata değil, başarı dön.
      return {
        success: true,
        data: { movedRollCount: 0 },
        message: "Adım zaten kapalı (idempotent retry)",
      };
    }

    // Kurşun bypass guard'ı — MESAJ SIRASI için burada, TX'te yeniden (aşağıda 0b).
    // Aşağıdaki "QC2 tamamlanmamış N top var" 400'ü dağıtılmış adımda HER ZAMAN
    // önce düşerdi: bypass rejiminde QC2 kaydı yazılmaz (`assign` zaten QC2 op'u
    // varsa dağıtımı reddediyor), dolayısıyla tablet "işi bitir"e bastığında
    // gerçek sebep yerine yanıltıcı bir kalite mesajı görürdü. Guard'ın tx içindeki
    // ikizi KALDIRILMADI: burası tx dışı olduğu için eşzamanlı `assign` ile yarışır,
    // asıl serileşme WO kilidinin altındaki kopyada sağlanır.
    await assertKursunTabletMayWrite(prisma, step.id, "tablet adım kapatma");

    // Tüm açık rollerde QC2_COMPLETED olmalı — tek IN sorgusuyla kontrol et.
    // Tambur kalıtım kayıtları sayılmaz — sadece bu step'te fiilen yapılan QC2.
    const rollIds = openMovements.map((m) => m.rollId);
    const completedQc2 = await prisma.rollOperation.findMany({
      where: { ...ACTIVE_OPERATION,
        ...OWN_OPERATION,
        workOrderStepId: step.id,
        operationType: RollOperationType.QC2_COMPLETED,
        rollId: { in: rollIds },
      },
      select: { rollId: true },
    });
    const completedSet = new Set(completedQc2.map((q) => q.rollId));
    const missingCount = rollIds.filter((id) => !completedSet.has(id)).length;
    if (missingCount > 0) {
      throw AppError.badRequest(
        `Kalite Kontrol 2 tamamlanmamış ${missingCount} top var. Tüm toplar bitmeden adım kapatılamaz.`
      );
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // Lazily import helper to avoid circular (roll-step.helper → prisma)
    const { recomputeStepStatus, completeWorkOrderIfStepsDone } = await import(
      "./helpers/roll-step.helper"
    );

    const result = await prisma.$transaction(async (tx) => {
      // 0) O-2 write-skew guard: WO satırını tx başında write-kilitle → son-adım
      //    WO oto-tamamlama sayımını (aşağıdaki remainingSteps) eşzamanlı fason
      //    receive/cancel/dispatch ve finalize (tambur) yollarıyla serileştir.
      //    Paylaşımlı kilit olmadan iki tx birbirinin commit'ini görmez → WO ya
      //    mal fasondayken COMPLETED'a kaçar ya da tüm adımlar bittiği halde
      //    IN_PROGRESS'te asılı kalır. Lock sırası WO→movement/roll (kardeşlerle tutarlı).
      await touchWorkOrderTx(tx, step.workOrderId);

      // 0b) Kurşun bypass guard'ı — WO kilidinden SONRA (assign de aynı kilidi
      //     alır, böylece "dağıtım mı önce, kapanış mı önce" yarışı serileşir)
      //     ve movement'lara dokunmadan ÖNCE. Adım dağıtılmışsa tablet kapanışı
      //     (QC2_STEP_FINISHED marker'ı) bypass kapanışının (KURSUN_BYPASS_FINISHED)
      //     altından malı çekerdi; iki marker karışınca reopen hangi turu geri
      //     alacağını bilemez.
      //
      //     SIRA GEREKÇESİ (idempotency): "0 açık movement → başarı" erken dönüşü
      //     bu guard'dan ÖNCE, tx'e hiç girmeden çalışır (yukarıdaki
      //     `openMovements.length === 0` dalı). Bilinçli:
      //       • Dağıtılmış ve HÂLÂ AÇIK adımda tablet retry'ı buraya ulaşır → 409
      //         alır; doğru davranış, çünkü ortada gerçekten yapılmaya çalışılan
      //         bir yazma var.
      //       • Zaten kapanmış adımda (bypass kapanışı da movement'ları kapatır)
      //         hiç yazma yok → guard'ı önce koşturmak offline kuyruğun geç gelen
      //         mükerrer isteğine gereksiz 409 üretirdi. Erken dönüş sessizce
      //         "zaten kapalı" der ve tablet kuyruğu temizler.
      await assertKursunTabletMayWrite(tx, step.id, "tablet adım kapatma");

      // 0c) H2 §3-6: imza bekleyen metre sapması (SUPERVISOR_PIN/OFFICE) WO kilidi ALTINDA sayılır —
      //     tx dışı KK2 sayımı ack/okuma yazımıyla yarışırdı. Makine durmaz; adım kapanışı bekler.
      const pendingAcks = await pendingMeterAcksTx(tx, { stepId: step.id, rollIds, limit: 50 });
      if (pendingAcks.length > 0) {
        throw AppError.conflict(`Onay bekleyen ${pendingAcks.length} metre sapması var — onaylanmadan adım kapatılamaz`, {
          code: "METER_DEVIATION_UNACKED",
          pending: pendingAcks.map((p) => ({ readingId: p.readingId, rollId: p.rollId, approvalMode: p.approvalMode })),
        });
      }

      // 0d) H1b: imza beklentisi sonradan kalkan (IN düzeltmesi vb.) APPLY okuması hiç uygulanmadıysa şimdi uygulanır.
      const pendingStock = await applyPendingExitMetersTx(tx, { stepId: step.id, rollIds, userId: userId ?? null });

      // 1) Açık movement'leri ATOMİK kapat (qty/weight per-row eşitlik) + RETURNING
      //    ile fiilen BİZİM kapattığımız rolleri al. `exitedAt IS NULL` guard'ı:
      //    movement seti tx DIŞINDA okunduğundan (satır ~577) bu guard olmasa iki
      //    eşzamanlı finishStep aynı seti kapatıp createMany'yi iki kez çalıştırır →
      //    rol sonraki adıma çift açık IN movement ile ilerlerdi. Guard ile her satır
      //    yalnız tek tx'e düşer; ilerletme yalnız RETURNING'deki rollere yapılır.
      //
      //    KAPSAM DARALTMASI ("rollId" = ANY): QC2 doğrulaması yukarıda tx DIŞI
      //    okunan rollIds setine yapıldı. Bu kısıt olmadan, doğrulama ile tx
      //    arasında adıma yeni giren top (fason kabul / önceki adım FINISH)
      //    QC2_COMPLETED'sız süpürülüp Tambur'a ilerlerdi. Yeni gelen top açık
      //    kalır; recomputeStepStatus adımı ACTIVE tutar.
      // F161: kapanış marker'ına TUR kimliği (uygulamada üretilen tek uuid — PARAMETRE
      // bağlı). gen_random_uuid() VOLATILE olup çok-satırlı UPDATE'te SATIR-BAŞINA
      // farklı değer üretirdi; app-marker tüm satırlara AYNI turu damgalar → reopen
      // yalnız SON turu geri çeker (fason çoklu-sevk: batch1 A,B ile batch2 C,D karışmaz).
      const finishMarker = `QC2_STEP_FINISHED:${randomUUID()}`;
      const closed = await tx.$queryRaw<
        Array<{ rollId: string; qtyIn: Prisma.Decimal; weightIn: Prisma.Decimal | null }>
      >`
        UPDATE "roll_movements"
        SET "qtyOut" = "qtyIn",
            "weightOut" = "weightIn",
            -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
            "exitedAt" = now(),
            "machineId" = COALESCE(${machineId ?? null}::uuid, "machineId"),
            "notes" = ${finishMarker}
        WHERE "workOrderStepId" = ${step.id}::uuid
          AND "exitedAt" IS NULL
          AND "revokedAt" IS NULL
          AND "rollId" = ANY(${rollIds}::uuid[])
        RETURNING "rollId", "qtyIn", "weightIn"
      `;

      // Eşzamanlı çağrı zaten kapatmışsa hiç satır dönmez → sonraki adım movement'i
      // AÇMA (idempotent). Sıralı retry zaten yukarıda (openMovements.length===0) yakalanır.
      if (closed.length === 0) {
        return { moved: 0, pendingStock };
      }
      const closedRollIds = closed.map((m) => m.rollId);

      if (nextStep) {
        // H1b: APPLY okumalı topun sonraki girişi TAZE metrajdır (okuma değil — uygulanmamışsa ikisi ayrışır);
        // bu adımın `qtyOut = qtyIn` kalır. RECORD okuması stoğu değiştirmediği için giriş aynen taşınır.
        const appliedOut = await tx.rollMeterReading.findMany({
          where: { workOrderStepId: step.id, rollId: { in: closedRollIds }, phase: MeterPhase.OUT, revokedAt: null, stockMode: MeterStockMode.APPLY },
          select: { rollId: true },
        });
        const fresh = appliedOut.length === 0 ? [] : await tx.roll.findMany({ where: { id: { in: appliedOut.map((r) => r.rollId) } }, select: { id: true, currentQty: true } });
        const outByRoll = new Map(fresh.map((r) => [r.id, r.currentQty]));
        // 2a) Sonraki step için movement'leri toplu oluştur (yalnız biz kapatanlar).
        await tx.rollMovement.createMany({
          data: closed.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: nextStep.id,
            qtyIn: outByRoll.get(m.rollId) ?? m.qtyIn,
            weightIn: m.weightIn ?? null,
            operatorId: userId ?? null,
            notes: null,
          })),
        });
        // 3a) Roll currentStepId'leri toplu güncelle.
        await tx.roll.updateMany({
          where: { id: { in: closedRollIds } },
          data: { currentStepId: nextStep.id },
        });
        // 4a) Step durumlarını birer kez recompute et (per-roll değil).
        await recomputeStepStatus(tx, nextStep.id);
      } else {
        // 2b) SON adım (rotada Tambur yok / bu istasyon son) → toplar FİNAL'e çekilir:
        // kaliteye göre WAREHOUSE (finalizeRollsAtLastStep — Tambur ile aynı mantık;
        // artık PRODUCED limbosu YOK). currentStepId=null, form=ACIK, barkodsuz açık
        // kumaşa barkod üretilir. Ardından completeWorkOrderIfStepsDone WO/kartı kapatır.
        // Adım damgası: "hangi finish turunun girişi" sorusu defterden
        // cevaplanabilsin — yeniden açma yalnız KENDİ girişini tersler.
        await finalizeRollsAtLastStep(tx, closedRollIds, { workOrderStepId: step.id });
      }

      await recomputeStepStatus(tx, step.id);

      if (!nextStep) {
        // F162: kursunFinish ile ORTAK yardımcı (drift önlenir; davranış birebir).
        await completeWorkOrderIfStepsDone(tx, step.workOrderId, { trigger: "KURSUN_QC_FINISH" });
      }

      return { moved: closed.length, pendingStock };
    });

    for (const p of result.pendingStock) await auditExitMeterStock(userId, p.readingId, p.result);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      newData: {
        status: "COMPLETED_FROM_QC2",
        movedRollCount: result.moved,
        nextStepId: nextStep?.id ?? null,
      },
    });

    return {
      success: true,
      data: { movedRollCount: result.moved },
      message: `Adım kapatıldı, ${result.moved} top bir sonraki istasyona taşındı`,
    };
  }

  /**
   * F161: Bir PROCESS_QC adımının EN SON finish turunun kapalı movement'lerini yükler.
   * Kapanış marker'ı (QC2_STEP_FINISHED:<uuid>) tur başına benzersizdir; exitedAt DESC
   * ile en son turun bir satırını bulup o turun marker'ıyla filtreleriz → farklı turlar
   * (fason çoklu-sevk) karışmaz. Eski suffix'siz 'QC2_STEP_FINISHED' satırları da
   * startsWith ile yakalanır (reseed öncesi test verisi).
   */
  private async loadLatestFinishTurn(stepId: string): Promise<{
    closed: Array<{
      id: string;
      rollId: string;
      notes: string | null;
      roll: {
        id: string;
        status: RollStatus;
        currentStepId: string | null;
        shipmentId: string | null;
        sackId: string | null;
        barcode: string | null;
        currentQty: Prisma.Decimal;
      };
    }>;
    latestMarker: string | null;
  }> {
    const finishMoves = await prisma.rollMovement.findMany({
      // Geri alınmış tur "son tur" sayılmaz — yoksa reopen onu yeniden açardı.
      where: {
        ...ACTIVE_MOVEMENT,
        workOrderStepId: stepId,
        exitedAt: { not: null },
        notes: { startsWith: "QC2_STEP_FINISHED" },
      },
      orderBy: { exitedAt: "desc" },
      select: {
        id: true,
        rollId: true,
        notes: true,
        roll: {
          select: { id: true, status: true, currentStepId: true, shipmentId: true, sackId: true, barcode: true, currentQty: true },
        },
      },
    });
    if (finishMoves.length === 0) return { closed: [], latestMarker: null };
    const latestMarker = finishMoves[0].notes;
    const closed = finishMoves.filter((m) => m.notes === latestMarker);
    return { closed, latestMarker };
  }

  // ---------------------------------------------------------------------------
  // REOPEN STEP (geliştirme aşaması — operatör yanlışlıkla kapatırsa)
  // ---------------------------------------------------------------------------
  /**
   * Daha önce `finishStep` ile kapatılmış bir PROCESS_QC adımını yeniden açar.
   *   - Bu adımda QC2_STEP_FINISHED notuyla kapatılmış movement'ler exitedAt=null'a döner
   *   - Bu hareketler için sonraki step'te oluşturulmuş açık movement'ler geri alınır
   *     (silinmez, `revokedAt` ile damgalanır)
   *   - Roll.currentStepId geriye (bu step'e) çekilir
   *   - Her iki step için recomputeStepStatus çağrılır
   *
   * Güvenlik kontrolü: yalnızca roller hâlâ sonraki step'te bekliyor ve üretimdeyse
   * (IN_PRODUCTION) yapılır. İleri taşınmış veya status değişmişse hata döner —
   * admin müdahalesi gerekir.
   */
  async reopenStep(
    data: { stepId: string },
    userId?: string
  ): Promise<ApiResponse<{ reopenedRollCount: number }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        workOrder: {
          select: {
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stepSequence: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(STEP_FLOW_ERROR);
    }
    if (step.status !== StepStatus.COMPLETED) {
      throw AppError.badRequest(
        `Bu adım zaten kapalı değil (durum: ${step.status})`
      );
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // F161: yalnız EN SON finish turunu geri aç (aynı step birden çok turda kapatıldıysa
    // — fason çoklu-sevk — eski turun rulolarını yanlış geri çekme/eski turu bloklama).
    const { closed: closedMovements } = await this.loadLatestFinishTurn(step.id);

    if (closedMovements.length === 0) {
      throw AppError.badRequest(
        "Bu adımı yeniden açacak kapalı hareket yok"
      );
    }

    // Güvenlik: her top hâlâ sonraki adımda bekliyor olmalı, ileri gitmemiş olmalı.
    if (nextStep) {
      for (const cm of closedMovements) {
        if (cm.roll.currentStepId !== nextStep.id) {
          throw AppError.badRequest(
            `Top (${cm.roll.barcode}) sonraki adımdan ileri taşınmış — yeniden açılamaz`
          );
        }
        if (cm.roll.status !== RollStatus.IN_PRODUCTION) {
          throw AppError.badRequest(
            `Top (${cm.roll.barcode}) artık üretimde değil (${cm.roll.status}) — yeniden açılamaz`
          );
        }
      }
    }

    const { recomputeStepStatus } = await import("./helpers/roll-step.helper");
    const rollIds = closedMovements.map((m) => m.rollId);
    const movementIds = closedMovements.map((m) => m.id);

    /** Defter özeti — audit yüküne yazılır (yeni kayıt AÇILMAZ, alan eklenir). */
    let ledgerSummary: { reversed: number; statusuzAtlanan: number; bulunamayan: string[] } | null = null;
    let meterRevoked = 0;
    let widthRestored = 0;

    await prisma.$transaction(async (tx) => {
      // F159: O-2 write-skew guard (finishStep paritesi) — son-adım WO/kart geri
      // alma ile eşzamanlı finish/finalize'ı serileştir.
      await touchWorkOrderTx(tx, step.workOrderId);

      if (nextStep) {
        // Sonraki adımda finishStep'in açtığı hareketleri geri al — silinmez,
        // damgalanır; geri alınmış satır adım durumuna ve açık-hareket seddine girmez.
        await revokeRollMovements(tx, {
          rollIds,
          workOrderStepIds: [nextStep.id],
          onlyOpen: true,
          reason: "KURSUN_REOPEN",
          userId,
        });
        // Roll.currentStepId'yi bu step'e geri al — ATOMİK CLAIM: yukarıdaki
        // güvenlik kontrolleri tx DIŞINDA okunuyor; onay penceresinde Tambur
        // operatörü bir topu finalize ederse (TAMBUR_CONSUMED, adım null) top
        // yine de KK2'ye geri çekilir ve çelişik durumda kalırdı. WHERE'e
        // "hâlâ sonraki adımda + üretimde" koşulları kondu; uyuşmazsa 409 +
        // rollback (finishStep'in atomik kapatmasıyla aynı sertlik).
        const pulledBack = await tx.roll.updateMany({
          where: {
            id: { in: rollIds },
            currentStepId: nextStep.id,
            status: RollStatus.IN_PRODUCTION,
          },
          data: { currentStepId: step.id },
        });
        if (pulledBack.count !== rollIds.length) {
          throw AppError.conflict(
            "Toplardan biri bu sırada ilerledi/değişti (örn. Tambur'da işlendi). Listeyi yenileyip tekrar deneyin."
          );
        }
      } else {
        // F159: SON adım (nextStep yok) — finishStep artık toplari FİNAL'e (WAREHOUSE/
        // A1_STOCK/SCRAP, kaliteye göre) çekiyor. Bunun TERSİ: topları IN_PRODUCTION'a ve
        // bu adıma geri çek (atomik claim: biri sevk edildi / çuvala girdi / tüketildiyse
        // count uyuşmaz → 409). Barkod/form GERİ ALINMAZ (kalıcı kimlik; re-finalize idempotent).
        // Dirilme (SCRAP → IN_PRODUCTION dahil): kart Pasif olamaz (S5) — DB seddinin uygulama ikizi.
        await assertRollsRevivable(tx, rollIds);
        const pulledBack = await tx.roll.updateMany({
          where: {
            id: { in: rollIds },
            status: { in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.SCRAP] },
            currentStepId: null,
            shipmentId: null,
            sackId: null,
          },
          data: { status: RollStatus.IN_PRODUCTION, currentStepId: step.id },
        });
        if (pulledBack.count !== rollIds.length) {
          throw AppError.conflict(
            "Toplardan biri artık üretim dışı (sevk/çuval/tüketim) — yeniden açılamaz. Listeyi yenileyin."
          );
        }
        // DEPO DEFTERİ — `finalizeRollsAtLastStep`in yazdığı GİRİŞ satırı terslenir:
        // top stok kümesinden çıkıp üretime geri döndü. Yazılmazsa finish → yeniden
        // aç → finish turunda İKİ giriş bir çıkışsız kalır ve sapma topun metrajı ×
        // tur kadar birikir.
        //
        // ⚠️ KAPSAM ZORUNLU: "topun tüm izini tersle" kapısı BURADA KULLANILAMAZ.
        // Ölçüldü (2026-09-12): kapsamsız çağrı `attachRolls`ın ÇIKIŞ satırını da
        // tersliyordu — top üretime dönmesine rağmen defter neti 0 çıkıyor, yani
        // depoda HAYALET stok kalıyordu; üstelik o çıkış kalıcı "terslenmiş"
        // damgası yediği için sapma ileri yolla bir daha kapanmıyordu.
        const ledgerResult = await reverseLatestScopedStockMove(
          tx,
          rollIds,
          { reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT, workOrderStepId: step.id },
          {
            reasonCode: STOCK_MOVE_REASON.KURSUN_REOPEN,
            userId: userId ?? null,
            notes: "Kurşun/KK2 adımı yeniden açıldı",
          },
        );
        // Terslenemeyen top SESSİZCE geçilmez: "defterde olması gereken giriş yok"
        // demektir. Sayı audit yüküne yazılır (aşağıda) — yeni kayıt açılmaz.
        ledgerSummary = ledgerResult;
        // finishStep son-adım dalı WO/kartı COMPLETED yapmış olabilir → geri al.
        await reopenWorkOrderTx(tx, step.workOrderId, { trigger: "KURSUN_QC_REOPEN" });
        await setWorkOrderCardStatusesTx(tx, step.workOrderId, "COMPLETED", "ACTIVE");
      }

      // Bu step'in kapatılmış movement'lerini geri aç — id'ler tx DIŞINDA okundu;
      // arada geri alınmış bir satır yeniden AÇILMAZ.
      await reopenClosedMovementsTx(tx, {
        where: { id: { in: movementIds } },
        reason: "KURSUN_REOPEN",
        notes: null,
        userId: userId ?? null,
      });

      // H1 §3-7: metre okumaları (ve bağlı onaylar) damgalanır — yeniden kapanışta yeniden okunur.
      meterRevoked = await revokeStepMeterReadingsTx(tx, {
        rollIds,
        stepId: step.id,
        userId: userId ?? null,
        reason: "KURSUN_REOPEN",
      });

      // D4-E2a: en ölçülmüş topun QC2 satırı damgalanır ve en geri konur (simetrik claim,
      // araya Düzelt girdiyse 409 ROLL_CHANGED); yeniden kapanışta en yeniden ölçülür.
      widthRestored = await revokeWidthTracedStepOperationsTx(tx, { rollIds, stepId: step.id, userId: userId ?? null });

      // QC2_COMPLETED / KURSUN_APPLIED işaretleri ve RollProperty kayıtları
      // korunur — operatör eski veriyi görsün, üzerinde oynayabilsin.
      // Sıfırlamak isterse kartı yeniden okutup reopen akışını kullanır.

      // Step durumlarını güncelle
      await recomputeStepStatus(tx, step.id);
      if (nextStep) await recomputeStepStatus(tx, nextStep.id);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      newData: {
        status: "REOPENED_FROM_COMPLETED",
        reopenedRollCount: rollIds.length,
        prevStatus: StepStatus.COMPLETED,
        // Terslenemeyen satırlar sessizce kaybolmasın: "defterde olması gereken
        // giriş yok" (bulunamayan) ve "ucu kurulamayan eski satır" (statüsüz)
        // sayıları burada görünür.
        ...(ledgerSummary ? { defter: ledgerSummary } : {}),
        ...(meterRevoked > 0 ? { meterReadingsRevoked: meterRevoked } : {}),
        ...(widthRestored > 0 ? { widthRestoredRollCount: widthRestored } : {}),
      },
    });

    return {
      success: true,
      data: { reopenedRollCount: rollIds.length },
      message: `Adım yeniden açıldı — ${rollIds.length} top geri çekildi`,
    };
  }

  /**
   * H1 metre okuması — giriş (IN_OUT kipinde) ya da çıkış düzeltmesi (§3-4). Tablet yazma
   * kapısının altıncı yolu; tx sırası completeQc2 ile aynı. Aktif okuma damgalanır, yenisi yazılır.
   */
  async recordMeterReading(
    data: { rollId: string; stepId: string; phase: MeterPhase; input: MeterReadingInput },
    userId?: string,
    machineId?: string | null,
  ): Promise<ApiResponse<RollMeterReading>> {
    await this.assertRollInFlowStep(data.rollId, data.stepId);
    await assertMeterInputAllowed(data.phase, data.input);
    const step = await prisma.workOrderStep.findUnique({ where: { id: data.stepId }, select: { workOrderId: true } });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    const replay = meterReadingReplay({ rollId: data.rollId, stepId: data.stepId, phase: data.phase, meters: data.input.meters, pieceCount: data.input.pieceCount ?? null });

    const out = await prisma.$transaction(async (tx) => {
      const prior = await replay.inTx(tx, data.input.clientToken);
      if (prior) return { reading: prior, written: null };
      await touchWorkOrderTx(tx, step.workOrderId);
      await assertKursunTabletMayWrite(tx, data.stepId, "metre okuması");
      // WO kilidi altında yeniden: tx dışı kontrol ile kilit arasında top adımdan çıkmış olabilir.
      const stillHere = await tx.roll.findFirst({ where: { id: data.rollId, currentStepId: data.stepId }, select: { id: true } });
      if (!stillHere) throw AppError.conflict("Top bu adımdan çıkmış — okuma kaydedilmedi", { code: "ROLL_NOT_IN_STEP" });
      const written = await writeMeterReadingTx(tx, {
        rollId: data.rollId,
        stepId: data.stepId,
        phase: data.phase,
        input: data.input,
        userId: userId ?? null,
        machineId: machineId ?? null,
        reason: "KURSUN_METER_CORRECTION",
      });
      return { reading: written.reading, written };
    });
    if (out.written) await auditMeterReadingWrite(userId, out.written, "CORRECTION");
    if (out.written) await auditExitMeterStock(userId, out.written.reading.id, out.written.stock ?? null);
    return {
      success: true,
      data: out.reading,
      message: out.written ? (out.written.revokedId ? "Metre okuması düzeltildi" : "Metre okuması kaydedildi") : "Metre okuması zaten kayıtlı",
    };
  }

  /**
   * `reopenStep`'in salt-okunur önizlemesi — kapalı bir kart okutulduğunda
   * operatöre "yeniden açarsan şu toplar Tambur'dan geri çekilecek" onayını
   * SOMUT göstermek için. Hiçbir şeyi değiştirmez; reopenStep'in güvenlik
   * kontrollerini (top ileri taşınmış / üretimde değil) aynen uygular ve
   * engel varsa canReopen=false + sebep döner.
   */
  async reopenPreview(
    stepId: string
  ): Promise<
    ApiResponse<{
      canReopen: boolean;
      blockReason: string | null;
      rollCount: number;
      rolls: Array<{ rollId: string; barcode: string | null; currentQty: number }>;
    }>
  > {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: {
          select: {
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stepSequence: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(STEP_FLOW_ERROR);
    }

    const block = (reason: string) => ({
      success: true as const,
      data: { canReopen: false, blockReason: reason, rollCount: 0, rolls: [] },
    });

    if (step.status !== StepStatus.COMPLETED) {
      return block(`Bu adım zaten kapalı değil (durum: ${step.status})`);
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // F161: yalnız EN SON finish turu (reopenStep ile aynı kaynak).
    const { closed: closedMovements } = await this.loadLatestFinishTurn(step.id);

    if (closedMovements.length === 0) {
      return block("Bu adımı yeniden açacak kapalı hareket yok");
    }

    // reopenStep ile aynı güvenlik kontrolü — ama burada throw etmek yerine
    // engeli operatöre rapor ediyoruz (önizleme yıkıcı değil).
    if (nextStep) {
      for (const cm of closedMovements) {
        if (cm.roll.currentStepId !== nextStep.id) {
          return block(
            `Top (${cm.roll.barcode ?? cm.rollId.slice(0, 8)}) sonraki adımdan ileri taşınmış — yeniden açılamaz`
          );
        }
        if (cm.roll.status !== RollStatus.IN_PRODUCTION) {
          return block(
            `Top (${cm.roll.barcode ?? cm.rollId.slice(0, 8)}) artık üretimde değil (${cm.roll.status}) — yeniden açılamaz`
          );
        }
      }
    } else {
      // F159: son adımda toplar FİNAL (WAREHOUSE/A1_STOCK/SCRAP) + currentStepId=null +
      // henüz sevk/çuval GÖRMEMİŞ olmalı; aksi halde reopenStep 409 verir — preview bunu
      // canReopen=false ile önceden gösterir.
      const finalStatuses: RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.SCRAP];
      for (const cm of closedMovements) {
        if (
          !finalStatuses.includes(cm.roll.status) ||
          cm.roll.currentStepId !== null ||
          cm.roll.shipmentId !== null ||
          cm.roll.sackId !== null
        ) {
          return block(
            `Top (${cm.roll.barcode ?? cm.rollId.slice(0, 8)}) artık üretimde değil / sevkte (${cm.roll.status}) — yeniden açılamaz`
          );
        }
      }
    }

    const rolls = closedMovements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      currentQty: Number(m.roll.currentQty),
    }));

    return {
      success: true,
      data: {
        canReopen: true,
        blockReason: null,
        rollCount: rolls.length,
        rolls,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  /**
   * F160: clientErrorId idempotent dönüşünde, mevcut kaydın gelen istekle AYNI
   * mantıksal hatayı (aynı top + hata tipi + adım + metre) temsil ettiğini doğrula.
   * Aynı id başka bir kayıt için kullanılmışsa (yabancı kayıt / istemci id-yeniden-
   * kullanım bug'ı) sessizce "başarı" dönmek amaçlanan hatayı kaybettirir → 409.
   */
  private assertClientErrorIdMatches(
    cached: RollError,
    data: { rollId: string; stepId: string; startMeter: number; defectTypeId: string },
  ): void {
    const matches =
      cached.rollId === data.rollId &&
      cached.defectTypeId === data.defectTypeId &&
      cached.detectedAtStepId === data.stepId &&
      new Prisma.Decimal(data.startMeter).equals(requireProcessMeter(cached));
    if (!matches) {
      throw AppError.conflict(
        "Bu hata kimliği (clientErrorId) farklı bir kayıt için kullanılmış — " +
          "aynı id ile farklı top/metre/hata tipi gönderilemez. Listeyi yenileyin.",
        { code: "CLIENT_ERROR_ID_MISMATCH", existingErrorId: cached.id },
      );
    }
  }

  /**
   * Top gerçekten BU adımda mı ve bu adım kart AKIŞINDA mı (`stepRunsStepFlow`)?
   * İstasyonun muayene alanını da döner: hata yazan çağıran (reportError)
   * ayrıca kalite ikizini sorar; QC2 tamamlama sormaz.
   */
  private async assertRollInFlowStep(
    rollId: string,
    stepId: string,
  ): Promise<{ kind: StationKind; appliesQuality: boolean; inspectionEnabled: boolean }> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, currentStepId: true, barcode: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.currentStepId !== stepId) {
      throw AppError.badRequest(
        `Top (${roll.barcode}) şu anda bu istasyonda değil`
      );
    }
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: { station: { select: { ...STEP_FLOW_SELECT, ...STEP_QUALITY_SELECT } } },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(STEP_FLOW_ERROR);
    }
    return step.station;
  }

  /**
   * Hata SİLME muayene kapısı (KQ-D1). Bu uç Tambur ekranınca da kullanılır,
   * bu yüzden AKIŞ ikizi uygulanmaz (Tambur akışta değildir); soru "silmenin
   * yapıldığı istasyonda muayene açık mı": topun bulunduğu adım, yoksa hatanın
   * tespit adımı. İkisi de yoksa (adımsız eski kayıt) bugünkü davranış.
   */
  private async assertDeleteStationInspects(err: {
    rollId: string;
    detectedAtStepId: string | null;
  }): Promise<void> {
    const roll = await prisma.roll.findUnique({
      where: { id: err.rollId },
      select: { currentStepId: true },
    });
    const stepId = roll?.currentStepId ?? err.detectedAtStepId;
    if (!stepId) return;
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: { station: { select: STEP_QUALITY_SELECT } },
    });
    if (step && !stepCanApplyQuality(step.station)) {
      throw AppError.badRequest(QUALITY_STEP_ERROR);
    }
  }

  private async buildStepSummary(
    stepId: string,
    opts: { includeInspection?: boolean } = {},
  ): Promise<ApiResponse<StepSummary>> {
    const includeInspection = opts.includeInspection === true;
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: {
          select: {
            id: true,
            workOrderNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true } },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(STEP_FLOW_ERROR);
    }

    // Adımda şu anda açık olan rollerin hareket kayıtları.
    // Sıralama: enteredAt (en eski önce) — operatör fiziksel sırayı görür.
    // WO-level priority/acil rozeti `open-cards` listesinde yer alır,
    // tek bir kart açıldığında ruloların kendi içinde sıralama önemsiz.
    const openMovements = await prisma.rollMovement.findMany({
      where: { ...ACTIVE_MOVEMENT, workOrderStepId: stepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true, width: true } },
      },
      orderBy: { enteredAt: "asc" },
    });

    const rollIds = openMovements.map((m) => m.roll.id);
    const [qc2Ops, errors, priorErrors, stationCaps, bypass] = await Promise.all([
      // Tambur kalıtım kayıtları sayılmaz — bu step'te fiilen yapılan QC2.
      prisma.rollOperation.findMany({
        where: { ...ACTIVE_OPERATION,
          ...OWN_OPERATION,
          workOrderStepId: stepId,
          rollId: { in: rollIds },
          operationType: RollOperationType.QC2_COMPLETED,
        },
        select: { rollId: true },
      }),
      // Varsayılan yalnız PROCESS (eski tablet metresiz satır görmez); tarihçe isteği iki kökeni de alır.
      prisma.rollError.findMany({
        where: includeInspection
          ? { rollId: { in: rollIds }, detectedAtStepId: stepId }
          : { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId: { in: rollIds }, detectedAtStepId: stepId },
        select: {
          id: true,
          rollId: true,
          startMeter: true,
          defectTypeId: true,
          errorType: true,
          origin: true,
        },
        orderBy: { startMeter: "asc" },
      }),
      // Önceki adım hataları (KQ-D7): açık + karar yolu kökeni + BAŞKA adımda (ya da adımsız) açılmış.
      prisma.rollError.findMany({
        where: {
          ...ACTIONABLE_ROLL_ERROR_WHERE,
          rollId: { in: rollIds },
          isProcessed: false,
          OR: [{ detectedAtStepId: null }, { detectedAtStepId: { not: stepId } }],
        },
        select: {
          id: true,
          rollId: true,
          startMeter: true,
          errorType: true,
          origin: true,
          detectedAt: true,
          detectedAtStep: { select: { station: { select: { name: true } } } },
          detectedBy: { select: { fullName: true } },
        },
        orderBy: [{ startMeter: "asc" }, { id: "asc" }],
      }),
      // İstasyonun özellik yetenekleri + MODLARI. Tablet bu listeden tuş çizer:
      // AUTO → salt bilgi, OPTIONAL → tuş, REQUIRED → tuş + kapanış engeli.
      loadStationPropertyCaps(prisma, step.stationId),
      // Kurşun bypass: adımın AÇIK ataması (varsa). Partial unique
      // (kursun_bypass_one_pending_per_step_uq) en fazla bir satır garanti eder.
      prisma.kursunBypassAssignment.findFirst({
        where: { workOrderStepId: stepId, ...PENDING_BYPASS_WHERE },
        select: { assignedAt: true, machine: { select: { name: true } } },
      }),
    ]);

    // Sonraki adım: atlanmamış ilk büyük sıra (rota sırası stepSequence'tır).
    const nextStep = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId: step.workOrderId,
        stepSequence: { gt: step.stepSequence },
        status: { not: StepStatus.SKIPPED },
      },
      orderBy: { stepSequence: "asc" },
      select: { station: { select: { name: true } } },
    });
    const nextStepName = nextStep?.station.name ?? null;

    const qc2DoneSet = new Set(qc2Ops.map((o) => o.rollId));
    const defectsByRoll = new Map<string, RollDefectSummary[]>();
    for (const e of errors) {
      if (!defectsByRoll.has(e.rollId)) defectsByRoll.set(e.rollId, []);
      const actionable = isActionableRollError(e);
      defectsByRoll.get(e.rollId)!.push({
        id: e.id,
        startMeter: actionable ? processMeterNumber(e) : e.startMeter === null ? null : Number(e.startMeter),
        defectTypeId: e.defectTypeId,
        errorType: e.errorType,
        ...(includeInspection ? { origin: e.origin } : {}),
      });
    }

    const priorByRoll = new Map<string, PriorDefectSummary[]>();
    for (const e of priorErrors) {
      const list = priorByRoll.get(e.rollId) ?? [];
      list.push({
        id: e.id,
        startMeter: processMeterNumber(e),
        errorType: e.errorType,
        detectedStationName: e.detectedAtStep?.station.name ?? null,
        detectedByName: e.detectedBy?.fullName ?? null,
        detectedAt: e.detectedAt,
      });
      priorByRoll.set(e.rollId, list);
    }

    // Kumaş cinsi + renk kart geneli aynı (WO target) — her role kopyalanır ki
    // barkodsuz açık kumaş topları listede ad + renkle görünsün.
    const itemName = step.workOrder.targetItem?.name ?? null;
    const colorName = step.workOrder.targetColor?.name ?? null;
    // H3b: sayaç kipi kapalıyken (varsayılan) yalnız kip okunur; taban/politika okunmaz, anahtar eklenmez.
    const capture = await resolveKursunMeterCapture();
    const meterOn = capture !== "OFF";
    const meterPolicy = meterOn ? await resolveKursunMeterPolicy(prisma) : null;
    const meterBases = meterOn ? await loadRollMeterBases(prisma, stepId, rollIds) : null;
    // GK-H1b: ayar yalnız sayaç açık brode istasyonunda okunur; diğer adımda sorgu da anahtar da yok.
    const stationCodes = stationCaps.map((c) => c.code);
    const pieceInput = meterOn && stationCodes.includes(BRODE_PROPERTY_CODE)
      ? brodePieceInputOf({ meterOn, stationPropertyCodes: stationCodes, brodeUnit: await readFinanceServiceBillingBrodeUnit() })
      : null;
    // D4-KUC3b: eşik tek kaynaktan (Tambur en kapısı ayarı); en ölçmeyen istasyonda okunmaz, anahtar eklenmez.
    const widthToleranceCm = step.station.capturesWidth ? (await effectiveTamburPlanWidthGate()).toleranceCm : null;
    const rolls: RollSummary[] = openMovements.map((m) => {
      const defects = defectsByRoll.get(m.roll.id) ?? [];
      return {
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        currentQty: Number(m.roll.currentQty),
        qc2Completed: qc2DoneSet.has(m.roll.id),
        errorCount: defects.length,
        defects,
        itemName,
        colorName,
        priorDefects: priorByRoll.get(m.roll.id) ?? [],
        priorOpenErrorCount: priorByRoll.get(m.roll.id)?.length ?? 0,
        ...(meterBases ? { meter: meterBases.get(m.roll.id) ?? { declaredIn: null, measuredIn: null } } : {}),
        ...(widthToleranceCm != null
          ? { widthLimit: measuredWidthLimit(m.roll.width == null ? null : Number(m.roll.width), widthToleranceCm) }
          : {}),
      };
    });

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        workOrderId: step.workOrder.id,
        batchNumber: step.workOrder.workOrderNumber,
        status: step.status,
        // Eski APK sözleşmesi — KORUNUYOR. Mod modelinde "istasyon kurşun
        // uygulayabilir mi" ile "bu topa uygulanacak mı" ayrıştı; bu alan
        // BİRİNCİYİ söyler (eskiden de öyleydi).
        appliesKursun: stationCaps.some((c) => c.code === KURSUN_PROPERTY_CODE),
        // Yeni: mod güdümlü ekran çizimi. Eski APK bu alanı yok sayar.
        properties: stationCaps.map((c) => ({
          propertyId: c.propertyId,
          code: c.code,
          name: c.name,
          mode: c.mode,
          valueType: c.valueType,
          values: c.values.map((v) => ({ code: v.code, name: v.name })),
          // KQ-D4: bu SEÇİM hangi BAYRAĞIN çeşidi (gramaj → Kurşunlu). Eski APK yok sayar.
          variantOfPropertyId: c.variantOfPropertyId,
        })),
        targetValues: (await readActiveTargetValues(prisma, step.workOrder.id)).map((t) => ({
          propertyId: t.propertyId,
          valueId: t.valueId,
          valueCode: t.value.code,
        })),
        stepNote: step.notes,
        bypassAssignment: bypass
          ? { machineName: bypass.machine.name, assignedAt: bypass.assignedAt }
          : null,
        tabletReadOnly: await this.resolveTabletReadOnly(
          stepId,
          bypass?.machine.name ?? null,
        ),
        inspectionEnabled: stepCanApplyQuality(step.station),
        ...(step.station.capturesWidth ? { capturesWidth: true as const } : {}),
        nextStepName,
        emptyStep:
          rolls.length === 0 && step.status !== StepStatus.COMPLETED
            ? await this.describeEmptyStep(step.workOrderId, step.stepSequence)
            : null,
        ...(meterOn && meterPolicy ? { meter: { capture, policy: meterPolicy } } : {}),
        ...(pieceInput ? { pieceInput } : {}),
        rolls,
      },
    };
  }

  /**
   * Boş adım bilgisi: İE'nin topları şu an hangi akış dışı/içi adımda? Önceki bir
   * adımdaysa "henüz gelmedi", sonrakindeyse "geçti". Salt okuma, tx dışı.
   */
  private async describeEmptyStep(
    workOrderId: string,
    stepSequence: number,
  ): Promise<EmptyStepInfo> {
    const holders = await prisma.workOrderStep.findMany({
      where: { workOrderId, currentRolls: { some: {} } },
      select: { stepSequence: true, station: { select: { name: true } } },
      orderBy: { stepSequence: "asc" },
    });
    const currentStations = holders.map((h) => h.station.name);
    const where = currentStations.join(", ");
    if (holders.some((h) => h.stepSequence < stepSequence)) {
      return {
        code: "NOT_ARRIVED",
        message: `Bu top henüz bu istasyona gelmedi — şu an: ${where}`,
        currentStations,
      };
    }
    if (holders.length > 0) {
      return {
        code: "PASSED",
        message: `Bu kartın topları bu istasyonu geçti — şu an: ${where}`,
        currentStations,
      };
    }
    return {
      code: "NO_ACTIVE_ROLLS",
      message: "Bu kartın şu an hiçbir istasyonda açık topu yok.",
      currentStations,
    };
  }

  /**
   * `StepSummary.tabletReadOnly` üretici — yazma guard'ıyla AYNI üç dalı sorar
   * (`assertKursunTabletMayWrite`), yalnız fırlatmak yerine sebebi döner.
   *
   * Kuralı ikinci kez YAZMAZ: uygunluk `resolveStepBypassEligibility`'den gelir.
   * Guard fırlatır, bu anlatır — ikisi aynı kaynaktan beslendiği için "ekran
   * yazabilirsin diyor ama sunucu reddediyor" durumu doğamaz.
   */
  private async resolveTabletReadOnly(
    stepId: string,
    assignedMachineName: string | null,
  ): Promise<{ reason: string } | null> {
    if (assignedMachineName) {
      return {
        reason: `Bu iş ${assignedMachineName} makinesine dağıtıldı — kâğıtla işleniyor. Tambur'da kart okutulduğunda kurşun adımı kapanır.`,
      };
    }
    const flagEnabled = await resolveKursunBypassEnabled();
    if (!flagEnabled) return null;

    const eligibility = await resolveStepBypassEligibility(prisma, stepId);
    if (!eligibility?.eligible) return null;

    return {
      reason:
        "Kurşun dağıtımı açık — bu terbiye iş emri Kurşun Planlama ekranından bir kurşun makinesine dağıtılacak. Tablette işlem yapılmaz.",
    };
  }

  // ---------------------------------------------------------------------------
  // PLANLAMA — KURŞUN KUYRUĞU (WO seviyesinde)
  // ---------------------------------------------------------------------------
  /**
   * Tüm açık PROCESS_QC adımlarının (WO seviyesinde) birleşik kuyruğu.
   * Planlama Electron sayfası bu listeyi alır, drag-drop ile WO sıralar;
   * tablet `open-cards` listesi de aynı priority'i okur, operatör aynı
   * sırada görür.
   *
   * Filtre: station.kind = PROCESS_QC + status != COMPLETED + en az 1 açık top.
   * Sıralama: önce isUrgent, sonra urgentMarkedAt, sonra priority, son
   * startedAt (en eski adım önce).
   *
   * ⚠️ BYPASS REJİMİ: Kurşun Sırası ekranı `production.kursunBypassEnabled`
   * AÇIKKEN tamamen GİZLENİR. Buradaki sıralamanın (priority / drag-drop) tek
   * tüketicisi kurşun TABLETİYDİ (`listOpenCards` aynı orderBy'ı okur); bypass
   * düzeninde kurşunda tablet yoktur, dolayısıyla sırayı okuyacak kimse kalmaz —
   * izleme ve acil işaretleme Kurşun Dağıtım ekranında (aynı sıralamayla) yapılır.
   * Bu yüzden burada MAKİNE BAZLI GRUPLAMA YOKTUR; satırdaki `bypassAssigned` +
   * `bypassMachineName` yalnız KARIŞIK REJİM içindir (bayrak yeni açıldı, bir
   * kısım iş hâlâ tablet rejiminde bekliyor → planlamacı ayırt edebilsin).
   */
  async listQueue(): Promise<ApiResponse<KursunQueueItem[]>> {
    const steps = await prisma.workOrderStep.findMany({
      where: {
        station: { ...STEP_FLOW_WHERE },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      },
      select: {
        id: true,
        priority: true,
        isUrgent: true,
        urgentMarkedAt: true,
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            workOrderNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true, hex: true } },
            // Kart iş emri başına — WO'nun aktif kartı.
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        movements: {
          where: { ...ACTIVE_MOVEMENT, exitedAt: null },
          select: {
            enteredAt: true,
            roll: {
              select: {
                currentQty: true,
                // Parti no (görüntü): topun parti no'su.
                batch: { select: { batchNumber: true } },
              },
            },
          },
        },
        // Kurşun bypass: adımın AÇIK ataması hangi MAKİNEDE? Kuyruk satırı
        // dağıtılmış olsa da LİSTEDE KALIR (listOpenCards'ın aksine) — burası
        // planlamacının izleme yüzeyi, seçim yüzeyi değil: dağıtılan işin
        // kuyruktan sessizce kaybolması "iş kayboldu" paniği doğururdu.
        // `take: 1` yeter (partial unique en fazla bir açık satır bırakır).
        //
        // NESTED SELECT = TEK SORGU: makine adı için satır başına ayrı çağrı
        // YOK (N+1 yasağı) — Prisma bunu tek round-trip'te join'ler. Açık
        // atamanın yüklemi (`completedAt IS NULL AND cancelledAt IS NULL`)
        // PENDING_BYPASS_WHERE ile tek kaynaktan gelir.
        kursunBypasses: {
          where: PENDING_BYPASS_WHERE,
          select: { machine: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
      // Emniyet tavanı: kuyruk öncelik-sıralı; ilk QUEUE_CAP zaten en kritikleri.
      // Gerçekte bu kadar eş zamanlı açık PROCESS_QC adımı görülmez → emniyet ağı
      // (sınırsız findMany + nested movement payload'ını sınırlar). Dolarsa loglar.
      take: 500,
    });
    if (steps.length === 500) {
      uyari("kursun-qc", "listQueue: 500 açık-adım tavanına ulaşıldı — liste kırpılmış olabilir.");
    }

    const data: KursunQueueItem[] = steps.map((s) => {
      const oldest = s.movements.reduce<Date | null>((acc, m) => {
        if (acc === null) return m.enteredAt;
        return m.enteredAt < acc ? m.enteredAt : acc;
      }, null);
      // Decimal aritmetik — JS float drift'i önlenir; serializer number'a çevirir.
      const totalQty = s.movements.reduce(
        (sum, m) => sum.plus(m.roll.currentQty),
        new Prisma.Decimal(0),
      );
      const batch = s.movements[0]?.roll.batch ?? null;
      const card = s.workOrder.travelerCards[0] ?? null;
      const bypass = s.kursunBypasses[0] ?? null;
      return {
        workOrderStepId: s.id,
        stationName: s.station.name,
        workOrderId: s.workOrder.id,
        batchNumber: batch?.batchNumber ?? s.workOrder.workOrderNumber,
        travelerCardNumber: card?.cardNumber ?? null,
        travelerCardBarcode: card?.barcode ?? null,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.movements.length,
        totalCurrentQty: totalQty.toNumber(),
        oldestEnteredAt: oldest,
        priority: s.priority,
        isUrgent: s.isUrgent,
        urgentMarkedAt: s.urgentMarkedAt,
        bypassAssigned: bypass !== null,
        bypassMachineName: bypass?.machine.name ?? null,
      };
    });

    return { success: true, data };
  }

  /**
   * Drag-drop sonrası planlama gönderir. WorkOrderStep.priority batch update.
   * Sadece açık (status != COMPLETED) PROCESS_QC step'leri günceller.
   */
  async reorderQueue(
    items: Array<{ id: string; priority: number }>,
    userId: string | undefined,
  ): Promise<ApiResponse<{ updated: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (items.length === 0) return { success: true, data: { updated: 0 } };

    const ids = items.map((i) => i.id);
    const existing = await prisma.workOrderStep.findMany({
      where: {
        id: { in: ids },
        status: { not: StepStatus.COMPLETED },
        station: { ...STEP_FLOW_WHERE },
      },
      select: { id: true },
    });
    const editable = new Set(existing.map((e) => e.id));
    const filtered = items.filter((i) => editable.has(i.id));
    if (filtered.length === 0) return { success: true, data: { updated: 0 } };

    const updateIds = filtered.map((i) => i.id);
    const updatePriorities = filtered.map((i) => i.priority);
    await prisma.$executeRaw`
      UPDATE "work_order_steps" AS wos
      SET "priority" = data."priority"
      FROM unnest(${updateIds}::uuid[], ${updatePriorities}::int[]) AS data("id", "priority")
      WHERE wos."id" = data."id"
    `;

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: filtered.map((i) => i.id).join(","),
      newData: { reorderedCount: filtered.length, kursunQueue: true },
    });

    return { success: true, data: { updated: filtered.length } };
  }

  /**
   * Acil rozeti aç/kapat (WO bazında — PROCESS_QC step üzerinde).
   * Sadece açık (COMPLETED olmayan) step'lerde anlamlı.
   */
  async setQueueUrgent(
    stepId: string,
    isUrgent: boolean,
    userId: string | undefined,
  ): Promise<ApiResponse<{ id: string; isUrgent: boolean; urgentMarkedAt: Date | null }>> {
    if (!userId) throw AppError.unauthorized();

    // F167: atomik claim — eşzamanlı finishStep step'i COMPLETED'e çekerken
    // check-then-act tamamlanmış adıma acil rozeti yazabilirdi. updateMany
    // status/station koşulunu tek sorguda pinler; 0 satır → nedeni ayır.
    const claimed = await prisma.workOrderStep.updateMany({
      where: {
        id: stepId,
        status: { not: StepStatus.COMPLETED },
        station: { ...STEP_FLOW_WHERE },
      },
      data: { isUrgent, urgentMarkedAt: isUrgent ? new Date() : null },
    });
    if (claimed.count === 0) {
      const existing = await prisma.workOrderStep.findUnique({
        where: { id: stepId },
        select: { status: true, station: { select: STEP_FLOW_SELECT } },
      });
      if (!existing) throw AppError.notFound("Adım bulunamadı");
      // ⚠️ Bu tanı, hemen üstteki atomik claim'in WHERE'inin İKİZİdir — ikisi
      // AYNI yüklemden beslenmezse yarışın kaybedenine yanlış sebep basılır.
      if (!stepRunsStepFlow(existing.station)) {
        throw AppError.badRequest(STEP_FLOW_ERROR);
      }
      throw AppError.badRequest("Adım tamamlanmış, acil işaretlenemez");
    }

    const updated = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: { id: true, isUrgent: true, urgentMarkedAt: true },
    });
    if (!updated) throw AppError.notFound("Adım bulunamadı");

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: stepId,
      newData: { isUrgent: updated.isUrgent, kursunQueue: true },
    });

    return { success: true, data: updated };
  }
}

// Satisfy strict unused-locals for import Prisma (type-only usage).
type _PrismaKeep = Prisma.TransactionClient;
