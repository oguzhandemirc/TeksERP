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

import prisma from "../lib/prisma";
import { randomUUID } from "crypto";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  RollError,
  RollOperation,
  RollOperationType,
  RollStatus,
  StationKind,
  StationPropertyMode,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { assertWoAtStepKind } from "./helpers/roll-step.helper";
import {
  assertRequiredPropertiesSelected,
  copyStationCapabilitiesToRoll,
  loadStationPropertyCaps,
} from "./helpers/station-capability-transfer.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import { finalizeRollsAtLastStep } from "./helpers/roll-finalize.helper";
import {
  assertKursunTabletMayWrite,
  resolveStepBypassEligibility,
} from "./helpers/kursun-bypass-eligibility.helper";
import { readKursunBypassEnabled } from "./system-setting.service";

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
  startMeter: number;
  defectTypeId: string | null;
  errorType: string | null; // snapshot'lanmış ad (DefectType.name)
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
  }[];
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
  rolls: RollSummary[];
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

export class KursunQcService {
  // ---------------------------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------------------------
  /**
   * Refakat kartı barkoduyla PROCESS_QC adımını ve bu adıma giren rolleri çöz.
   * Operatör tablette kartı okutur, bu metot hangi step'te olduğunu ve hangi
   * rollerin bu step'e girmiş olduğunu döner.
   */
  async getByCardBarcode(cardBarcode: string): Promise<ApiResponse<StepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
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

    // PROCESS_QC adımı KAPALI ise (finishStep yapılmış, toplar Tambur'a geçmiş):
    // assertWoAtStepKind "açık top yok, mevcut konum: Tambur" diye 400 atardı.
    // Bunun yerine COMPLETED özeti dön (rolls=[]) → frontend reopen-confirm
    // akışını tetikler (operatör yanlışlıkla kapattıysa onayla geri açabilsin).
    // Açık top varken status COMPLETED olamaz (recomputeStepStatus ACTIVE yapar),
    // o yüzden bu kısayol normal akıştaki açık kartları etkilemez.
    const pqStep = await prisma.workOrderStep.findFirst({
      where: { workOrderId: card.workOrderId, station: { kind: StationKind.PROCESS_QC } },
      orderBy: { stepSequence: "asc" },
      select: { id: true, status: true },
    });
    if (pqStep?.status === StepStatus.COMPLETED) {
      return this.buildStepSummary(pqStep.id);
    }

    // İş emrindeki PROCESS_QC step'ini doğrula. Multi-batch: WO'nun rulları
    // farklı adımlarda olabilir; helper bu durumda net mesaj döner.
    const { stepId } = await assertWoAtStepKind(
      card.workOrderId,
      StationKind.PROCESS_QC,
    );

    return this.buildStepSummary(stepId);
  }

  /** Step ID ile doğrudan çek (admin/test ekranları). */
  async getStep(stepId: string): Promise<ApiResponse<StepSummary>> {
    return this.buildStepSummary(stepId);
  }

  /**
   * Şu an PROCESS_QC istasyonlarında açık top bekleyen tüm aktif refakat kartları.
   * Mobil "kamera simülasyonu" modal'ı için — operatör fiziksel kart yokken
   * bu listeden seçim yapabilir.
   *
   * Filtre: station.kind = PROCESS_QC, step.status != COMPLETED, en az 1 açık top
   * (currentStepId = step.id), ve WO'nun ACTIVE refakat kartı mevcut.
   */
  async listOpenCards(): Promise<
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
        station: { kind: StationKind.PROCESS_QC },
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
      console.warn(
        `[kursun-qc] listOpenCards: ${OPEN_CARDS_CAP} açık-kart tavanına ulaşıldı — liste kırpılmış olabilir.`
      );
    }

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
          priority: s.priority,
          isUrgent: s.isUrgent,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { success: true, data };
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
   * OPTIONAL/REQUIRED satırlar yalnız operatör işaretlediyse (`propertyIds`)
   * Roll'a yazılır. REQUIRED bir özellik işaretlenmemişse adım kapanmaz.
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
      /** Operatörün işaretlediği OPTIONAL/REQUIRED özellikler. AUTO'lar
       *  gönderilmese de yazılır; eski APK bu alanı hiç göndermez. */
      propertyIds?: string[] | null;
    },
    userId?: string,
    machineId?: string | null
  ): Promise<ApiResponse<RollOperation>> {
    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      select: { stationId: true },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");

    const caps = await loadStationPropertyCaps(prisma, step.stationId);
    assertRequiredPropertiesSelected(caps, data.propertyIds);

    // KURSUN bu topa yazılacak mı? AUTO ise evet, OPTIONAL/REQUIRED ise ancak
    // operatör işaretlediyse. Log ile RollProperty aynı karardan beslenir.
    const selectedSet = new Set(data.propertyIds ?? []);
    const kursunCap = caps.find((c) => c.code === "KURSUN");
    const kursunApplied =
      !!kursunCap &&
      (kursunCap.mode === StationPropertyMode.AUTO || selectedSet.has(kursunCap.propertyId));

    // F283: Idempotency — op zaten varsa (offline outbox replay: sunucu commit etti
    // ama yanıt istemciye ulaşmadı) upsert no-op'tur. RollOperation append-only
    // (updatedAt YOK) → no-op'ta hiçbir şey değişmez; audit'i CREATE olarak TEKRAR
    // yazma (createInitialEntry replay-skip deseni).
    const existedBefore = await prisma.rollOperation.findUnique({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
      select: { id: true },
    });

    const op = await prisma.$transaction(async (tx) => {
      // Kurşun bypass: adım fiziksel bir kurşun MAKİNESİNE dağıtılmışsa iş
      // KÂĞITTA yürüyor — tablet KK2 kaydı yazamaz. Guard tx İÇİNDE ve ilk
      // sırada: `existedBefore` / yetenek okumaları tx DIŞINDA yapıldığı
      // için pencerede araya giren `assign` bu QC2 op'unu commit ettirirdi.
      // (Ters yön zaten kapalı: `assign` de adımda fiilen yapılmış QC2 op'u
      // görürse dağıtımı reddediyor — iki yön birbirini eler.)
      await assertKursunTabletMayWrite(tx, data.stepId, "KK2 tamamlama");

      const qc2Op = await tx.rollOperation.upsert({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: data.rollId,
            workOrderStepId: data.stepId,
            operationType: RollOperationType.QC2_COMPLETED,
          },
        },
        create: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
          operatorId: userId ?? null,
          machineId: machineId ?? null,
          metadata: data.notes ? { notes: data.notes } : undefined,
        },
        update: {},
      });

      if (kursunApplied) {
        await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: data.rollId,
              workOrderStepId: data.stepId,
              operationType: RollOperationType.KURSUN_APPLIED,
            },
          },
          create: {
            rollId: data.rollId,
            workOrderStepId: data.stepId,
            operationType: RollOperationType.KURSUN_APPLIED,
            operatorId: userId ?? null,
            machineId: machineId ?? null,
          },
          update: {},
        });
      }

      await copyStationCapabilitiesToRoll(tx, {
        stationId: step.stationId,
        rollId: data.rollId,
        selectedPropertyIds: data.propertyIds,
        caps,
      });

      return qc2Op;
    });

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
          // Operatörün elle işaretledikleri — AUTO'lar bu listede olmayabilir.
          selectedPropertyIds: data.propertyIds ?? [],
        },
      });
    }

    return { success: true, data: op, message: "Kalite Kontrol 2 tamamlandı" };
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

    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (data.startMeter > Number(roll.currentQty)) {
      throw AppError.badRequest(
        `Hata metresi (${data.startMeter}) topun metrajını (${Number(roll.currentQty)}) aşıyor`
      );
    }

    const defectType = await prisma.defectType.findUnique({
      where: { id: data.defectTypeId },
    });
    if (!defectType) throw AppError.notFound("Hata tipi bulunamadı");
    if (!defectType.isActive) {
      throw AppError.badRequest(
        `Hata tipi pasif durumda (${defectType.name}) — aktif bir tip seçin`
      );
    }

    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    // Kurşun bypass: dağıtılmış adımda hatalar KÂĞITTA tutulur (fabrika kurşun
    // istasyonuna tablet koymuyor). Dijital RollError açmak iki soruna yol açar:
    // (a) Tambur bypass onayı hatasız bir iş bekler, (b) `assign` de "bu adımda
    // hata kaydı var" diye dağıtımı reddediyor — ters yönde açılan kayıt o
    // kontrolü anlamsızlaştırırdı. Guard idempotent clientErrorId dönüşünden
    // SONRA: zaten kayıtlı hatanın replay'i 409'a düşmemeli (kayıt ya dağıtım
    // öncesinde açıldı ya da yarışı kaybetti; ikisinde de yeni yazma yok).
    await assertKursunTabletMayWrite(prisma, data.stepId, "hata kaydı");

    // Mükerrer engeli: aynı top + aynı metre + aynı hata tipi tekrar girilemez.
    // Aynı metrede FARKLI tip serbest (50. metrede hem delik hem leke olabilir).
    const existing = await prisma.rollError.findFirst({
      where: {
        rollId: data.rollId,
        startMeter: data.startMeter,
        defectTypeId: defectType.id,
      },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(
        `Bu metrede (${data.startMeter}) "${defectType.name}" hatası zaten kayıtlı`,
        { code: "DUPLICATE_ROLL_ERROR", existingErrorId: existing.id }
      );
    }

    let err: RollError;
    try {
      err = await prisma.rollError.create({
        data: {
          // clientErrorId verildiyse onu id olarak kullan (offline idempotency);
          // verilmediyse undefined → Prisma @default(uuid()) üretir.
          id: data.clientErrorId,
          rollId: data.rollId,
          startMeter: data.startMeter,
          defectTypeId: defectType.id,
          errorType: defectType.name, // snapshot — katalog rename olsa bile sabit kalır
          isProcessed: false,
          detectedAtStepId: data.stepId,
          detectedByUserId: userId ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // (a) Eşzamanlı replay yarışı: aynı clientErrorId ile 2. create araya girdiyse
        //     PK üzerinde P2002 → mevcut kaydı idempotent dön.
        if (data.clientErrorId) {
          const dup = await prisma.rollError.findUnique({
            where: { id: data.clientErrorId },
          });
          if (dup) {
            this.assertClientErrorIdMatches(dup, data);
            return {
              success: true,
              data: dup,
              message: "Hata zaten kayıtlı (idempotent retry)",
            };
          }
        }
        // (b) İş-anahtarı (rollId,startMeter,defectTypeId) çakışması: EŞZAMANLI çift-tık
        //     (farklı PK ile) — partial unique roll_errors_roll_meter_defect_uq P2002 →
        //     409 DUPLICATE_ROLL_ERROR (sıralı findFirst guard'ının eşzamanlı kardeşi).
        const existing = await prisma.rollError.findFirst({
          where: { rollId: data.rollId, startMeter: data.startMeter, defectTypeId: defectType.id },
          select: { id: true },
        });
        if (existing) {
          throw AppError.conflict(
            `Bu metrede (${data.startMeter}) "${defectType.name}" hatası zaten kayıtlı`,
            { code: "DUPLICATE_ROLL_ERROR", existingErrorId: existing.id }
          );
        }
      }
      throw e;
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_ERROR",
      recordId: err.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        startMeter: data.startMeter,
        defectTypeId: defectType.id,
        errorType: defectType.name,
      },
    });

    return {
      success: true,
      data: err,
      message: `${defectType.name} · ${data.startMeter}. metrede`,
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

    // ATOMİK guard: yalnız İŞLENMEMİŞ kayıt silinir — findUnique↔delete arası
    // eşzamanlı Tambur finalize'ı isProcessed=true yaparsa count=0 → silinmez
    // (eski bare delete TOCTOU'su: işlenen hata kaydı sessizce silinebiliyordu).
    const deleted = await prisma.rollError.deleteMany({
      where: { id: data.errorId, isProcessed: false },
    });
    if (deleted.count === 0) {
      // Pencerede ya Tambur işledi ya başka bir silme aldı — taze duruma bak.
      const after = await prisma.rollError.findUnique({
        where: { id: data.errorId },
        select: { id: true },
      });
      if (!after) {
        return { success: true, data: { deleted: true }, message: "Hata kaydı zaten yok" };
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
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "finishStep yalnızca PROCESS_QC adımları için çağrılabilir"
      );
    }

    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: step.id, exitedAt: null },
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
      where: {
        workOrderStepId: step.id,
        operationType: RollOperationType.QC2_COMPLETED,
        rollId: { in: rollIds },
        inheritedFromParentRollId: null,
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
            -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
            -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
            "exitedAt" = (now() AT TIME ZONE 'UTC'),
            "machineId" = COALESCE(${machineId ?? null}::uuid, "machineId"),
            "notes" = ${finishMarker}
        WHERE "workOrderStepId" = ${step.id}::uuid
          AND "exitedAt" IS NULL
          AND "rollId" = ANY(${rollIds}::uuid[])
        RETURNING "rollId", "qtyIn", "weightIn"
      `;

      // Eşzamanlı çağrı zaten kapatmışsa hiç satır dönmez → sonraki adım movement'i
      // AÇMA (idempotent). Sıralı retry zaten yukarıda (openMovements.length===0) yakalanır.
      if (closed.length === 0) {
        return { moved: 0 };
      }
      const closedRollIds = closed.map((m) => m.rollId);

      if (nextStep) {
        // 2a) Sonraki step için movement'leri toplu oluştur (yalnız biz kapatanlar).
        await tx.rollMovement.createMany({
          data: closed.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: nextStep.id,
            qtyIn: m.qtyIn,
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
        await finalizeRollsAtLastStep(tx, closedRollIds);
      }

      await recomputeStepStatus(tx, step.id);

      if (!nextStep) {
        // F162: kursunFinish ile ORTAK yardımcı (drift önlenir; davranış birebir).
        await completeWorkOrderIfStepsDone(tx, step.workOrderId);
      }

      return { moved: closed.length };
    });

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
      where: {
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
   *   - Bu hareketler için sonraki step'te oluşturulmuş açık movement'ler silinir
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
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest("Bu adım Kurşun + QC2 tipinde değil");
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

    await prisma.$transaction(async (tx) => {
      // F159: O-2 write-skew guard (finishStep paritesi) — son-adım WO/kart geri
      // alma ile eşzamanlı finish/finalize'ı serileştir.
      await touchWorkOrderTx(tx, step.workOrderId);

      if (nextStep) {
        // Sonraki adımda finishStep'in oluşturduğu açık movement'leri sil
        await tx.rollMovement.deleteMany({
          where: {
            workOrderStepId: nextStep.id,
            exitedAt: null,
            rollId: { in: rollIds },
          },
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
        // finishStep son-adım dalı WO/kartı COMPLETED yapmış olabilir → geri al.
        await tx.workOrder.updateMany({
          where: { id: step.workOrderId, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        await setWorkOrderCardStatuses(tx, step.workOrderId, "COMPLETED", "ACTIVE");
      }

      // Bu step'in kapatılmış movement'lerini geri aç
      await tx.rollMovement.updateMany({
        where: { id: { in: movementIds } },
        data: { qtyOut: null, weightOut: null, exitedAt: null, notes: null },
      });

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
      },
    });

    return {
      success: true,
      data: { reopenedRollCount: rollIds.length },
      message: `Adım yeniden açıldı — ${rollIds.length} top geri çekildi`,
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
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest("Bu adım Kurşun + QC2 tipinde değil");
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
      new Prisma.Decimal(data.startMeter).equals(cached.startMeter);
    if (!matches) {
      throw AppError.conflict(
        "Bu hata kimliği (clientErrorId) farklı bir kayıt için kullanılmış — " +
          "aynı id ile farklı top/metre/hata tipi gönderilemez. Listeyi yenileyin.",
        { code: "CLIENT_ERROR_ID_MISMATCH", existingErrorId: cached.id },
      );
    }
  }

  private async assertRollInStep(
    rollId: string,
    stepId: string,
    expectedKind: StationKind
  ): Promise<void> {
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
      select: { station: { select: { kind: true } } },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== expectedKind) {
      throw AppError.badRequest(
        `Bu adım ${expectedKind} tipinde değil (mevcut: ${step.station.kind})`
      );
    }
  }

  private async buildStepSummary(stepId: string): Promise<ApiResponse<StepSummary>> {
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
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "Bu adım Kurşun + QC2 tipinde değil"
      );
    }

    // Adımda şu anda açık olan rollerin hareket kayıtları.
    // Sıralama: enteredAt (en eski önce) — operatör fiziksel sırayı görür.
    // WO-level priority/acil rozeti `open-cards` listesinde yer alır,
    // tek bir kart açıldığında ruloların kendi içinde sıralama önemsiz.
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: stepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true } },
      },
      orderBy: { enteredAt: "asc" },
    });

    const rollIds = openMovements.map((m) => m.roll.id);
    const [qc2Ops, errors, stationCaps, bypass] = await Promise.all([
      // Tambur kalıtım kayıtları sayılmaz — bu step'te fiilen yapılan QC2.
      prisma.rollOperation.findMany({
        where: {
          workOrderStepId: stepId,
          rollId: { in: rollIds },
          operationType: RollOperationType.QC2_COMPLETED,
          inheritedFromParentRollId: null,
        },
        select: { rollId: true },
      }),
      prisma.rollError.findMany({
        where: { rollId: { in: rollIds }, detectedAtStepId: stepId },
        select: {
          id: true,
          rollId: true,
          startMeter: true,
          defectTypeId: true,
          errorType: true,
        },
        orderBy: { startMeter: "asc" },
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

    const qc2DoneSet = new Set(qc2Ops.map((o) => o.rollId));
    const defectsByRoll = new Map<string, RollDefectSummary[]>();
    for (const e of errors) {
      if (!defectsByRoll.has(e.rollId)) defectsByRoll.set(e.rollId, []);
      defectsByRoll.get(e.rollId)!.push({
        id: e.id,
        startMeter: Number(e.startMeter),
        defectTypeId: e.defectTypeId,
        errorType: e.errorType,
      });
    }

    // Kumaş cinsi + renk kart geneli aynı (WO target) — her role kopyalanır ki
    // barkodsuz açık kumaş topları listede ad + renkle görünsün.
    const itemName = step.workOrder.targetItem?.name ?? null;
    const colorName = step.workOrder.targetColor?.name ?? null;
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
        appliesKursun: stationCaps.some((c) => c.code === "KURSUN"),
        // Yeni: mod güdümlü ekran çizimi. Eski APK bu alanı yok sayar.
        properties: stationCaps.map((c) => ({
          propertyId: c.propertyId,
          code: c.code,
          name: c.name,
          mode: c.mode,
        })),
        stepNote: step.notes,
        bypassAssignment: bypass
          ? { machineName: bypass.machine.name, assignedAt: bypass.assignedAt }
          : null,
        tabletReadOnly: await this.resolveTabletReadOnly(
          stepId,
          bypass?.machine.name ?? null,
        ),
        rolls,
      },
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
    const flagEnabled = await readKursunBypassEnabled();
    if (!flagEnabled) return null;

    const eligibility = await resolveStepBypassEligibility(prisma, stepId);
    if (!eligibility?.eligible) return null;

    return {
      reason:
        "Kurşun dağıtımı açık — bu iş emri Kurşun Planlama ekranından bir kurşun makinesine dağıtılacak. Tablette işlem yapılmaz.",
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
        station: { kind: StationKind.PROCESS_QC },
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
          where: { exitedAt: null },
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
      console.warn("[kursun-qc] listQueue: 500 açık-adım tavanına ulaşıldı — liste kırpılmış olabilir.");
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
        station: { kind: StationKind.PROCESS_QC },
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
        station: { kind: StationKind.PROCESS_QC },
      },
      data: { isUrgent, urgentMarkedAt: isUrgent ? new Date() : null },
    });
    if (claimed.count === 0) {
      const existing = await prisma.workOrderStep.findUnique({
        where: { id: stepId },
        select: { status: true, station: { select: { kind: true } } },
      });
      if (!existing) throw AppError.notFound("Adım bulunamadı");
      if (existing.station.kind !== StationKind.PROCESS_QC) {
        throw AppError.badRequest("Bu adım Kurşun + QC2 tipinde değil");
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _PrismaKeep = Prisma.TransactionClient;
