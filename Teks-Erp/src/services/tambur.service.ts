// =============================================================================
// TeksERP - Tambur Service
// =============================================================================
// Handles final quality decisions and roll splitting.
//
// CRITICAL BUSINESS RULES:
//   - Kurşun'da tespit edilen hatalar Tambur'da karar verme noktasına gelir.
//   - "KES" kararı verildiğinde mevcut topun metrajı azaltılmaz!
//     Yeni bir Roll kaydı (yeni barkod) oluşturulur → SCRAP veya A1.
//   - Orijinal topun currentQty'si net değere güncellenir → status WAREHOUSE,
//     currentStepId=null. Depo bir istasyon değil, saf bir statü; paketleme
//     RollMovement'i Tambur'da AÇILMAZ, tartı/paket finalize anında atomic
//     açılır + kapanır.
//   - Tambur'dan sonraki akış: Depo (WAREHOUSE) → Tartı/Paket → Sevkiyat.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { resolveQualityGradeId } from "./helpers/quality-grade.helper";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import type { CursorPaginatedResponse } from "./base.service";

export interface SwatchStats {
  count: number;
  /** Filtreye uyan tüm kartelaların `length` toplamı — cm. */
  totalLength: number;
}
import {
  Prisma,
  Roll,
  RollStatus,
  RollError,
  RollEntrySource,
  RollOperationType,
  StationKind,
  StepStatus,
  Swatch,
  WorkOrderStatus,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { assertWoAtStepKind, recomputeStepStatus } from "./helpers/roll-step.helper";

/** Generate a barcode for a split-off roll */
function generateSplitBarcode(originalBarcode: string): string {
  const suffix = uuidv4().replace(/-/g, "").substring(0, 6).toUpperCase();
  return `${originalBarcode}-KS-${suffix}`;
}

/**
 * Generate a barcode for a Tambur-born physical roll (open fabric child).
 * Open fabric'ın parent barkodu olmadığı için TEKS-YYYYMMDD-XXXX formatı kullanılır.
 */
function generateTamburChildBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const randomPart = uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();
  return `TEKS-${datePart}-${randomPart}`;
}

interface ErrorDecision {
  errorId: string;
  decision: "CUT" | "NO_CUT";
}

/**
 * Yeni cumulative-length model — operatör tambur makinesinde sayaç sıfırdan
 * başlatılarak her kesim ayrı uzunluk olarak girer. Sıralı; cumulative pozisyon
 * backend tarafından hesaplanır.
 *
 * Senaryo örneği (parent 500m, 2 defect @60 ve @150):
 *   [
 *     { length: 59,  qualityGrade: "1.KALITE" },
 *     { length: 10,  qualityGrade: "A2", relatedErrorIds: ["err-60m"] },
 *     { length: 149, qualityGrade: "1.KALITE" },
 *     { length: 10,  qualityGrade: "A2", relatedErrorIds: ["err-150m"] }
 *     // kalan 272m otomatik son top (parent.qualityGrade)
 *   ]
 *   Toplam = 59 + 10 + 149 + 10 = 228 ≤ 500; kalan 272m → 1.KALITE child.
 */
interface CutInput {
  length: number;
  qualityGrade: string;
  relatedErrorIds: string[];
}

/**
 * qualityGrade kodu → RollStatus eşlemesi.
 * Yeni kurguda kalite (qualityGrade) ile durum (status) ayrıdır: tüm yeni
 * üretim rulolar varsayılan olarak WAREHOUSE'a iner; kalite farkı yalnız
 * `Roll.qualityGrade` alanında yaşar. Katalogda explicit farklı bir
 * targetStatus tanımlanmadıkça WAREHOUSE döner.
 */
function resolveCutStatus(
  qualityGradeCode: string,
  targetStatusByCode: Map<string, RollStatus>
): RollStatus {
  return targetStatusByCode.get(qualityGradeCode) ?? RollStatus.WAREHOUSE;
}

/**
 * #8 — Tambur bir topu tüketmeden önce kalan AÇIK RollError'ları NO_CUT olarak
 * kapatır (top tüketildikten sonra hata bir daha kapanamaz → yetim hata sızar).
 * tx içinde çağrılır; kapatılan hata sayısını döner.
 */
async function closeOrphanRollErrors(
  tx: Prisma.TransactionClient,
  rollId: string,
  stepId: string | null,
  userId?: string
): Promise<number> {
  const open = await tx.rollError.findMany({
    where: { rollId, isProcessed: false },
    select: { id: true },
  });
  if (open.length === 0) return 0;
  await tx.rollError.updateMany({
    where: { id: { in: open.map((e) => e.id) } },
    data: {
      isProcessed: true,
      actionTaken: "NO_CUT",
      processedAtStepId: stepId,
      processedByUserId: userId ?? null,
      processedAt: new Date(),
    },
  });
  return open.length;
}

interface TamburRollErrorSummary {
  id: string;
  /// Hata noktası (tek metre). KK2/Kurşun veya tambur operatörü "60. metrede
  /// hata" olarak girer; aralık tutulmaz. Tambur kesim kararı operatörün.
  startMeter: number;
  errorType: string | null;
}

interface TamburRollSummary {
  rollId: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  errorCount: number;
  errors: TamburRollErrorSummary[];
}

interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export class TamburService {
  /**
   * Get rolls pending at Tambur station.
   *
   * Filtre kuralı: `currentStep.station.kind === TAMBUR` zorunlu. Bu sayede
   * önceki istasyonlarda (Boyahane, KK2) takılı olan ve sadece hatası olan
   * roll'lar yanlışlıkla listede çıkmıyor (BUG-36 fix).
   *
   * Hatası olsun olmasın **tüm** tambur-step roll'ları döner — operatör
   * hatasız roll'ları da sarıp `finalize` çağırmak zorunda (cumulative
   * length model ile child Roll'ları yaratır). UI hatalı/hatasız ayrımı
   * için `errors.length` üzerinden filtreleme yapabilir.
   */
  async getPendingRolls(): Promise<ApiResponse<Roll[]>> {
    const rolls = await prisma.roll.findMany({
      where: {
        status: RollStatus.IN_PRODUCTION,
        currentStep: {
          station: { kind: StationKind.TAMBUR },
        },
      },
      include: {
        item: true,
        color: true,
        errors: {
          where: { isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
      },
    });

    return { success: true, data: rolls };
  }

  /**
   * Get a single roll with its unprocessed errors for Tambur decision screen.
   */
  async getRollForDecision(rollId: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        item: true,
        color: true,
        errors: {
          where: { isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
        // En güncel iade kaydı — depo topu iade gelmişse operatör notunu/nedenini
        // burada görür (kesime gitmeden önce). İade hep WAREHOUSE'a döner; not topa bağlı.
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Refakat kartı barkoduyla TAMBUR adımını çöz ve o adımda şu an bekleyen
   * rolleri (stok kodu, lot/varyant kodu, en, hata özeti ile birlikte) döndür.
   *
   * Operatör tambur tabletine kartı okutur, bu metot hangi iş emrinin Tambur
   * adımında olduğumuzu ve işlenecek kumaşların listesini verir.
   */
  async getByCardBarcode(
    cardBarcode: string
  ): Promise<ApiResponse<TamburStepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    // Multi-batch destekli doğrulama. Eğer WO'nun rulları şu an Tambur'da
    // değilse net mesaj döner ("şu an Boyahane'de" gibi).
    const { stepId } = await assertWoAtStepKind(
      card.workOrderId,
      StationKind.TAMBUR,
    );
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { batchNumber: true } },
      },
    });
    if (!step) {
      throw AppError.notFound("Bu iş emrinde Tambur adımı tanımlı değil");
    }

    // Adıma girmiş ama henüz tamamlanmamış roller (RollMovement.exitedAt = null).
    // Sıra LIFO (enteredAt desc): KK2'den en son çıkan = yeni sepetin en üstü =
    // Tambur operatörünün ilk eline aldığı top. KK2 ilk işlediği parça sepetin
    // en altına düşer, Tambur'a son sırada gider.
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: step.id, exitedAt: null },
      orderBy: { enteredAt: "desc" },
      select: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            properties: {
              select: {
                property: { select: { id: true, name: true } },
              },
            },
            errors: {
              where: { isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: {
                id: true,
                startMeter: true,
                errorType: true,
              },
            },
          },
        },
      },
    });

    const rolls: TamburRollSummary[] = openMovements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      itemCode: m.roll.item.code,
      itemName: m.roll.item.name,
      colorCode: m.roll.color?.code ?? null,
      colorName: m.roll.color?.name ?? null,
      currentQty: Number(m.roll.currentQty),
      width: m.roll.width !== null ? Number(m.roll.width) : null,
      qualityGrade: m.roll.qualityGrade,
      properties: m.roll.properties.map((p) => ({
        id: p.property.id,
        name: p.property.name,
      })),
      errorCount: m.roll.errors.length,
      errors: m.roll.errors.map((e) => ({
        id: e.id,
        startMeter: Number(e.startMeter),
        errorType: e.errorType,
      })),
    }));

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.batchNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        rolls,
      },
    };
  }

  /**
   * Finalize a roll at Tambur station.
   *
   * YENİ MODEL (cumulative length-based):
   *   - Tambur operatörü makinede kumaşı sarar; sayaç sıfırdan başlar.
   *   - Her "kes" tuşu basışında: o ana kadar sarılan uzunluk yeni bir top
   *     olur (parent'ın 0 metresinden itibaren), sayaç sıfırlanır, devam edilir.
   *   - API'de `cuts: [{ length, qualityGrade, relatedErrorIds }]` sıralı liste.
   *     Backend cumulative offset hesaplar:
   *        cut1: 0     ..  cut1.length
   *        cut2: cut1.length .. cut1.length+cut2.length
   *        ...
   *     Son cut'tan sonra kalan kısım otomatik son child top
   *     (parent.qualityGrade ile, sum(lengths) < totalQty ise).
   *   - sum(lengths) > totalQty → hata. sum(lengths) ≤ totalQty zorunlu.
   *   - cuts boş ise → tüm metraj tek child top (parent.qualityGrade).
   *
   *   Defect lifecycle:
   *   - `decisions[]` her defect için karar (CUT veya NO_CUT). CUT kararı bir
   *     `cuts[].relatedErrorIds`'da görünen defect'i ifade eder. NO_CUT defect
   *     işlenmiş ama kesilmemiş — top içinde kayıtlı kalır.
   *   - `RollError.isProcessed=true`, `actionTaken="CUT"` veya `"NO_CUT"`.
   *
   *   Parent retire: `status=TAMBUR_CONSUMED`, `currentQty=0`, `currentStepId=null`.
   *   Çocuk topların KURSUN_APPLIED ve QC2_COMPLETED RollOperation kayıtları
   *   parent'tan kopyalanır (`inheritedFromParentRollId`).
   */
  async finalize(
    data: {
      rollId: string;
      decisions: ErrorDecision[];
      cuts: CutInput[];
      foldType?: "2-KAT" | "4-KAT";
      /** Çıktı topları (depoya gidenler) kartelalık işaretlensin — depoda
       *  kartela sevki için kolay bulunsun. Sevki engellemez. */
      markedForKartela?: boolean;
    },
    userId?: string
  ): Promise<
    ApiResponse<{
      originalRoll: Roll;
      splitRolls: Roll[];
      processedErrors: number;
    }>
  > {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      include: {
        item: true,
        producedInStep: {
          select: {
            workOrder: {
              select: {
                id: true,
                targetItemId: true,
                targetColorId: true,
                foldType: true,
                width: true,
              },
            },
          },
        },
      },
    });

    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    // IDEMPOTENCY: Tambur finalize her çağrıda yeni child Roll yaratır
    // (uuid-based barkod — P2002 ile mükerrer yakalanamaz). Aynı çağrı 2. kez
    // gelirse (offline replay / çift-tık) mükerrer child üretilmemeli. İki
    // savunma katmanı:
    //   1) Ön-kontrol (burada): önceki çağrı TAM commit etmişse parent
    //      TAMBUR_CONSUMED olur → mevcut child'ları döndür, tx'i hiç açma.
    //   2) Atomik claim (tx başında): iki çağrı eşzamanlı gelip ikisi de bu
    //      ön-kontrolü geçerse (henüz commit yok), koşullu updateMany yalnız
    //      birine count=1 verir; kaybeden idempotent döner.
    // Bu yardımcı her iki yolda da aynı cevabı üretir.
    const buildIdempotentResponse = async () => {
      const cachedOriginal = await prisma.roll.findUnique({
        where: { id: data.rollId },
        include: { item: true, color: true },
      });
      const cachedChildren = await prisma.roll.findMany({
        where: {
          parentRollId: data.rollId,
          entrySource: RollEntrySource.TAMBUR_SPLIT,
        },
        include: { item: true, color: true },
        orderBy: { createdAt: "asc" },
      });
      const processedErrors = await prisma.rollError.count({
        where: { rollId: data.rollId, isProcessed: true },
      });
      return {
        success: true,
        data: {
          originalRoll: cachedOriginal as Roll,
          splitRolls: cachedChildren as Roll[],
          processedErrors,
        },
        message: "Tambur zaten tamamlanmış (idempotent retry).",
      };
    };

    if (roll.status === RollStatus.TAMBUR_CONSUMED) {
      return buildIdempotentResponse();
    }

    // Parent barkodlu (klasik) ise child barkodlar parent prefix'i ile üretilir;
    // açık kumaş (barcode=null, boyahane dönüşü) ise TEKS-YYYYMMDD-XXXX formatı.
    const parentBarcode = roll.barcode;

    const totalQty = Number(roll.currentQty);
    const wo = roll.producedInStep?.workOrder ?? null;
    const plannedFoldType = wo?.foldType ?? null;

    // Renk kontrolü — Tambur'a gelen rulonun renk kazanmış olması beklenir
    // (boyahane Fason Kabul'ünde set edilir). Renksiz rulo Tambur'da operatöre
    // uyarı gösterir ama bloklanmaz; iş sahibi kararı: ham bitmiş ürün de
    // mümkün (örn. ham talep eden müşteri).
    const colorWarning =
      wo?.targetColorId && !roll.colorId
        ? "Bu rulo henüz renk kazanmadı (boyahane atlandı veya başarısız oldu). Ham olarak depoya geçecek."
        : null;

    // Defect kararlarını topla — sadece lifecycle marker (isProcessed, actionTaken).
    // Kesim üretmez — kesimler `data.cuts` listesinden geliyor.
    const errorDecisions = data.decisions ?? [];
    const errorIds = errorDecisions.map((d) => d.errorId);
    const errors = errorIds.length
      ? await prisma.rollError.findMany({
          where: { id: { in: errorIds }, rollId: data.rollId },
        })
      : [];
    const errorById = new Map(errors.map((e) => [e.id, e]));

    // cuts validasyonu: cumulative length toplamı totalQty'yi aşmasın.
    // Decimal aritmetik — JS float drift'i YANLIŞ red üretmesin (0.1+0.2 > 0.3 gibi).
    const inputCuts = data.cuts ?? [];
    const totalQtyD = new Prisma.Decimal(roll.currentQty);
    let cumulativeLenD = new Prisma.Decimal(0);
    for (const c of inputCuts) {
      if (!(c.length > 0)) {
        throw AppError.badRequest("Kesim uzunluğu pozitif olmalı");
      }
      cumulativeLenD = cumulativeLenD.plus(c.length);
    }
    if (cumulativeLenD.greaterThan(totalQtyD)) {
      throw AppError.badRequest(
        `Kesim uzunlukları toplamı (${cumulativeLenD.toString()}m) topun metrajını (${totalQtyD.toString()}m) aşıyor`
      );
    }
    // Defect ID referansları parent'a ait olmalı.
    for (const c of inputCuts) {
      for (const eid of c.relatedErrorIds) {
        const err = errorById.get(eid);
        if (!err) {
          throw AppError.badRequest(
            `Kesim relatedErrorIds içindeki hata ID'si decisions listesinde yok veya başka topa ait: ${eid}`
          );
        }
      }
    }

    // Item ve renk artık fason kabul aşamasında set edilmiş durumda. Tambur
    // kimlik değişikliği yapmaz — sadece bölme + Roll.properties parent'tan
    // miras alma.

    // Parent'tan çocuklara kopyalanacak operasyon kalıtımı (Kurşun + KK2).
    // Parent o istasyonlardan geçtiyse çocuklar da geçmiş sayılır. TAMBUR_PROCESSED
    // kopyalanmaz; bu Tambur'un parent üzerindeki kararıdır.
    // Filter YOK: zincirleme inherit destekle (parent depo topundaysa op'lar
    // zaten kendi parent'tan inherit'lidir; sadece orijinal'e bakmak chain'i koparır).
    const inheritedOps = await prisma.rollOperation.findMany({
      where: {
        rollId: data.rollId,
        operationType: { in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED] },
      },
      select: { workOrderStepId: true, operationType: true, operatorId: true, metadata: true },
    });

    // Cut'lardaki + parent qualityGrade'lerini topla → katalog target status'larını çek.
    // Map<code, RollStatus> — katalogda yoksa SCRAP fallback'i resolveCutStatus'ta.
    const allQualityCodes = Array.from(
      new Set([...inputCuts.map((c) => c.qualityGrade), roll.qualityGrade])
    );
    const qualityGradeRows = allQualityCodes.length
      ? await prisma.qualityGrade.findMany({
          where: { code: { in: allQualityCodes } },
          select: { id: true, code: true, targetStatus: true },
        })
      : [];
    const targetStatusByCode = new Map<string, RollStatus>(
      qualityGradeRows.map((q) => [q.code, q.targetStatus])
    );
    const qualityGradeIdByCode = new Map<string, string>(
      qualityGradeRows.map((q) => [q.code, q.id])
    );

    const splitRolls: Roll[] = [];
    let processedCount = 0;

    // Eşzamanlı ikinci çağrı tx içindeki atomik claim'i kaybederse set edilir →
    // tx geri sarılır, idempotent cevap döndürülür (mükerrer child üretilmez).
    let raceLost = false;
    // Child Roll CREATE audit'leri tx İÇİNDE atılmaz: tx sonradan rollback ederse
    // (movement/step/WO completion hatası) AuditService global prisma'da hemen
    // commit ettiğinden hayalet kayıt kalırdı. Döngüde topla, tx commit ettikten
    // SONRA emit et.
    const childAudits: Array<{ recordId: string; newData: Record<string, unknown> }> = [];
    const updatedRoll = await prisma.$transaction(async (tx) => {
      // ATOMIK CLAIM: parent'ı tek hamlede sahiplen. Koşullu updateMany satır
      // kilidi + status guard ile iki eşzamanlı finalize'dan yalnız BİRİNE
      // count=1 verir; kaybeden count=0 alır → tx geri sarılır, mükerrer child
      // Roll üretilmez. (Ön-kontrol tek başına yetmez: iki çağrı da henüz commit
      // etmeden ön-kontrolü geçebilir.)
      const claim = await tx.roll.updateMany({
        where: { id: data.rollId, status: { not: RollStatus.TAMBUR_CONSUMED } },
        data: { status: RollStatus.TAMBUR_CONSUMED },
      });
      if (claim.count === 0) {
        raceLost = true;
        throw new Error("TAMBUR_RACE_LOST");
      }

      // Defect lifecycle — relatedErrorIds'da geçen defect'ler CUT, diğerleri NO_CUT.
      // decisions[].decision sadece operatörün niyetini bildirir; gerçek aksiyon
      // cuts.relatedErrorIds ile eşleştirilir.
      const cutErrorIds = new Set<string>(
        inputCuts.flatMap((c) => c.relatedErrorIds)
      );
      for (const d of errorDecisions) {
        const err = errorById.get(d.errorId);
        if (!err) continue;
        const actuallyCut = cutErrorIds.has(d.errorId);
        // decisions ile relatedErrorIds tutarsız olabilir; gerçek aksiyon
        // relatedErrorIds'a göre (CUT işaretlenenler kesildi).
        const actionTaken = actuallyCut ? "CUT" : "NO_CUT";
        await tx.rollError.update({
          where: { id: d.errorId },
          data: {
            isProcessed: true,
            actionTaken,
            processedAtStepId: roll.currentStepId,
            processedByUserId: userId ?? null,
            processedAt: new Date(),
          },
        });
        processedCount++;
      }

      // #8 — decisions'ta geçmeyen açık hatalar NO_CUT olarak otomatik kapansın.
      processedCount += await closeOrphanRollErrors(
        tx,
        data.rollId,
        roll.currentStepId,
        userId
      );

      // Parent'ın FabricProperty listesini bir kez çek — her çocuğa miras kalır.
      // (Renk veren fason adımında WO.targetProperties parent.properties'e zaten
      // kopyalanmış durumda; Tambur sadece propagate eder.)
      const parentProperties = await tx.rollProperty.findMany({
        where: { rollId: data.rollId },
        select: { propertyId: true },
      });

      // Cumulative length-based segment'leri oluştur.
      // inputCuts sıralı (operatörün makinede yaptığı sırayla); her cut bir
      // child Roll. Kalan kısım son child Roll (parent.qualityGrade ile).
      type Segment = {
        start: number; // parent metresinde başlangıç offset
        end: number; // parent metresinde bitiş offset
        qty: number;
        status: RollStatus;
        qualityGrade: string;
        inheritProperties: boolean;
        auditSource: string;
        auditErrorIds: string[];
      };

      // Decimal offset — float drift'le sahte ~0.000m kuyruk top yaratma.
      const segments: Segment[] = [];
      let offsetD = new Prisma.Decimal(0);
      for (const c of inputCuts) {
        const cutStatus = resolveCutStatus(c.qualityGrade, targetStatusByCode);
        const nextOffsetD = offsetD.plus(c.length);
        segments.push({
          start: offsetD.toNumber(),
          end: nextOffsetD.toNumber(),
          qty: c.length,
          status: cutStatus,
          qualityGrade: c.qualityGrade,
          // Tüm kalite seviyeleri (1.KALITE/A1/FIRE) WAREHOUSE'a iner; fabric
          // özellikleri kalite seviyesinden bağımsız olduğu için her child miras alır.
          inheritProperties: cutStatus === RollStatus.WAREHOUSE,
          auditSource: "OPERATOR_CUT",
          auditErrorIds: c.relatedErrorIds,
        });
        offsetD = nextOffsetD;
      }
      // Kalan kısım (sum(lengths) < totalQty) otomatik son child top.
      if (offsetD.lessThan(totalQtyD)) {
        const remaining = totalQtyD.minus(offsetD).toNumber();
        const remainStatus = resolveCutStatus(
          roll.qualityGrade,
          targetStatusByCode
        );
        segments.push({
          start: offsetD.toNumber(),
          end: totalQtyD.toNumber(),
          qty: remaining,
          status: remainStatus,
          qualityGrade: roll.qualityGrade,
          inheritProperties: remainStatus === RollStatus.WAREHOUSE,
          auditSource: "REMAINING_TAIL",
          auditErrorIds: [],
        });
      }

      // Her segment için yeni Roll + property + kalıtım op'ları + audit.
      for (const seg of segments) {
        const splitBarcode = parentBarcode
          ? generateSplitBarcode(parentBarcode)
          : generateTamburChildBarcode();
        const splitRoll = await tx.roll.create({
          data: {
            barcode: splitBarcode,
            itemId: roll.itemId,
            colorId: roll.colorId,
            // Bitmiş topun eni = WO hedef eni (ham en KK1'de opsiyonel; ham
            // top eni null olabilir). WO eni yoksa ham parent'ın enine düşülür.
            width: wo?.width ?? roll.width,
            initialQty: seg.qty,
            currentQty: seg.qty,
            weightKg: null,
            status: seg.status,
            qualityGrade: seg.qualityGrade,
            qualityGradeId: qualityGradeIdByCode.get(seg.qualityGrade) ?? null,
            producedInStepId: roll.producedInStepId,
            parentRollId: roll.id,
            // Phase 4: dal kimliğini parent'tan kalıt → bölünen toplar depoya
            // gitse bile hangi fason partisinden geldiği lane'de izlenir.
            batchSplitId: roll.batchSplitId,
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            // Sadece depoya giden (WAREHOUSE) çıktılar kartelalık işaretlenir;
            // fire/scrap işaretlenmez (zaten sevke uygun değil).
            markedForKartela:
              (data.markedForKartela ?? false) && seg.status === RollStatus.WAREHOUSE,
          },
          include: {
            item: true,
            color: true,
          },
        });

        // Parent'tan çocuğa özellik mirası (renk veren fason adımında zaten
        // parent'a kopyalanmıştı).
        if (seg.inheritProperties && parentProperties.length > 0) {
          await tx.rollProperty.createMany({
            data: parentProperties.map((p) => ({
              rollId: splitRoll.id,
              propertyId: p.propertyId,
            })),
          });
        }

        // Kurşun/KK2 yaşam döngüsü kalıtımı: parent'taki op'ları yeni rollId
        // ile çoğalt, inheritedFromParentRollId=parent.id — aggregation
        // filtresi çift sayımı önler.
        if (inheritedOps.length > 0) {
          await tx.rollOperation.createMany({
            data: inheritedOps.map((op) => ({
              rollId: splitRoll.id,
              workOrderStepId: op.workOrderStepId,
              operationType: op.operationType,
              operatorId: op.operatorId,
              metadata: op.metadata ?? undefined,
              inheritedFromParentRollId: roll.id,
            })),
          });
        }

        splitRolls.push(splitRoll);

        // Audit tx dışına ertelenir (yukarıdaki childAudits notu).
        childAudits.push({
          recordId: splitRoll.id,
          newData: {
            barcode: splitRoll.barcode,
            status: splitRoll.status,
            qualityGrade: splitRoll.qualityGrade,
            currentQty: splitRoll.currentQty,
            parentOffsetStart: seg.start,
            parentOffsetEnd: seg.end,
            source: seg.auditSource,
            relatedErrorIds: seg.auditErrorIds,
            splitFromRollId: data.rollId,
            inheritedOpCount: inheritedOps.length,
          },
        });
      }

      // Tambur parametrelerini (kat tipi vs.) step.stepData'ya yaz.
      if (data.foldType !== undefined && roll.currentStepId) {
        const step = await tx.workOrderStep.findUnique({
          where: { id: roll.currentStepId },
          select: { stepData: true },
        });
        const existing = (step?.stepData as Record<string, unknown> | null) ?? {};
        const merged: Record<string, unknown> = {
          ...existing,
          tamburDecidedAt: new Date().toISOString(),
          foldType: data.foldType,
        };
        await tx.workOrderStep.update({
          where: { id: roll.currentStepId },
          data: { stepData: merged as Prisma.InputJsonValue },
        });
      }

      // Tambur adımındaki açık RollMovement'i kapat. Parent'ın tüm metrajı
      // çocuk toplara dağıldığı için qtyOut = totalQty.
      const now = new Date();
      const oldStepId = roll.currentStepId;
      if (oldStepId) {
        await tx.rollMovement.updateMany({
          where: {
            rollId: data.rollId,
            workOrderStepId: oldStepId,
            exitedAt: null,
          },
          data: {
            exitedAt: now,
            qtyOut: totalQty,
            weightOut: roll.weightKg,
            notes: `TAMBUR_CONSUMED`,
          },
        });
      }

      // Parent retire: currentQty=0, TAMBUR_CONSUMED, aktif step yok.
      const updated = await tx.roll.update({
        where: { id: data.rollId },
        data: {
          currentQty: 0,
          status: RollStatus.TAMBUR_CONSUMED,
          currentStepId: null,
        },
        include: {
          item: true,
          color: true,
        },
      });

      // Parent retire olduğu için RollProperty bindirme gereksiz — sil.
      await tx.rollProperty.deleteMany({ where: { rollId: data.rollId } });

      // Per-roll Tambur işlem log'u (parent üzerinde — kopyalanmaz).
      if (oldStepId) {
        await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: data.rollId,
              workOrderStepId: oldStepId,
              operationType: RollOperationType.TAMBUR_PROCESSED,
            },
          },
          create: {
            rollId: data.rollId,
            workOrderStepId: oldStepId,
            operationType: RollOperationType.TAMBUR_PROCESSED,
            operatorId: userId ?? null,
            createdAt: now,
            metadata: {
              // Planlanan (WO.foldType) — Tambur ekranına bilgi olarak gelir.
              plannedFoldType,
              // Operatörün gerçek seçimi (override etmiş olabilir).
              foldType: data.foldType ?? null,
              childRollCount: segments.length,
              cutCount: inputCuts.length,
              tailCount: offsetD.lessThan(totalQtyD) ? 1 : 0,
              processedErrors: processedCount,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });
        await recomputeStepStatus(tx, oldStepId);
      }

      // WO completion — Tambur production'ın son istasyonu. Tüm üretim step'leri
      // COMPLETED/SKIPPED ise WO kapanır. (Tartı/paket/sevkiyat artık step
      // değil, fulfillment akışı — WO'yu tutmaz.)
      if (wo?.id) {
        const remaining = await tx.workOrderStep.count({
          where: {
            workOrderId: wo.id,
            status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
          },
        });
        if (remaining === 0) {
          await tx.workOrder.update({
            where: { id: wo.id },
            data: { status: WorkOrderStatus.COMPLETED },
          });
          await tx.travelerCard.updateMany({
            where: { workOrderId: wo.id, status: "ACTIVE" },
            data: { status: "COMPLETED" },
          });
        }
      }

      return updated;
    }).catch((e) => {
      // Yarışı kaybeden eşzamanlı çağrı (raceLost): kazanan parent'ı tüketip
      // child'ları zaten üretti. null dön → aşağıda idempotent cevaba düşülür.
      // Gerçek hatalar yeniden fırlatılır.
      if (raceLost) return null;
      throw e;
    });

    if (!updatedRoll) {
      return buildIdempotentResponse();
    }

    // Tx commit etti — child Roll CREATE audit'lerini şimdi emit et.
    for (const a of childAudits) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "ROLL",
        recordId: a.recordId,
        newData: a.newData,
      });
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      oldData: { currentQty: roll.currentQty, status: roll.status },
      newData: {
        currentQty: 0,
        status: updatedRoll.status,
        splitRollCount: splitRolls.length,
        cutCount: inputCuts.length,
        hadRemainingTail: cumulativeLenD.lessThan(totalQtyD),
      },
    });

    const tailNote = cumulativeLenD.lessThan(totalQtyD) ? " + kalan kuyruk top" : "";
    const baseMsg = `Tambur tamamlandı. Parent bölündü, ${splitRolls.length} yeni top oluşturuldu (${inputCuts.length} kesim${tailNote}, ${processedCount} hata işlendi).`;
    return {
      success: true,
      data: {
        originalRoll: updatedRoll,
        splitRolls,
        processedErrors: processedCount,
      },
      message: colorWarning ? `${baseMsg} Uyarı: ${colorWarning}` : baseMsg,
    };
  }

  // ===========================================================================
  // SWATCH — Kartela üretimi
  // ===========================================================================
  /**
   * Kaynak rolden uzunluk*adet kadar metraj düşerek `count` adet kartela üretir.
   * Her kartela kendi barkodunu (SW-YYMM-XXXXXX-C) ve kart numarasını alır.
   */
  // NOT: Kartela artık Tambur'da kesilmez. Kartela = bitmiş bir topun kartela
  // fason firmasında işlenmesiyle doğar (KartelaService.receive). Bkz.
  // KARTELA-TASARIM.md. Eski createSwatch / nextSwatchSequence kaldırıldı.

  /**
   * Tambur'dan çıkmış son N rolü listeler — operatör etiketleri tekrar basabilsin
   * diye. Sadece split çocukları (`entrySource: TAMBUR_SPLIT`); retired parent
   * (`TAMBUR_CONSUMED`, currentQty=0) etiket basılacak fiziksel bir top değil.
   * Default 50 kayıt, createdAt DESC.
   */
  async listRecentOutputRolls(params?: {
    workOrderId?: string;
    limit?: number;
    /** Cursor mode aktivasyonu — verilirse pagination cursor response döner. */
    cursor?: string;
    /** `cursor=...` yokken bile cursor formatı istemek için (ilk sayfa). */
    mode?: string;
    /** Barkod / ürün adı-kodu / renk / parti araması. */
    search?: string;
    /** Cursor mode ilk fetch'te totalEstimate doldur. */
    withTotal?: boolean;
  }): Promise<ApiResponse<Roll[]> | CursorPaginatedResponse<Roll>> {
    const where: Prisma.RollWhereInput = {
      entrySource: RollEntrySource.TAMBUR_SPLIT,
      ...(params?.workOrderId
        ? { producedInStep: { workOrderId: params.workOrderId } }
        : {}),
    };
    const search = params?.search?.trim();
    if (search) {
      // Barkod: TAM eşleşme (unique index seek) — `contains`/ILIKE en_US.UTF-8
      // collation'da barcode indeksini KULLANAMAZ → seq scan (ana rulo listesiyle
      // aynı karar, bkz. inventory.service buildRollWhere). Barkod okutulur/
      // yapıştırılır; ortasından substring araması saha akışı değil. Ürün/renk/
      // parti küçük master tablolarda kaldığı için `contains` (fuzzy) korunur.
      where.OR = [
        { barcode: search },
        { item: { name: { contains: search, mode: "insensitive" } } },
        { item: { code: { contains: search, mode: "insensitive" } } },
        { color: { name: { contains: search, mode: "insensitive" } } },
        {
          producedInStep: {
            workOrder: { batchNumber: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    const include = {
      item: true,
      color: true,
      producedInStep: {
        select: { workOrder: { select: { id: true, batchNumber: true } } },
      },
    } as const;

    // Cursor mode (mobil infinite scroll + arama). Legacy çağrı (cursor/mode
    // yok) eski `ApiResponse<Roll[]>` "en yeni N" cevabını alır.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.roll.findMany({
          where: cursorWhereClause,
          include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.roll.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
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

    const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);
    const rolls = await prisma.roll.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include,
    });
    return { success: true, data: rolls };
  }

  /**
   * Barkoddan kartela bul — TartıPaket akışında scan input'u kartela barkodunu
   * (SW- prefix) tespit ettiğinde kullanılır.
   */
  async getSwatchByBarcode(
    barcode: string
  ): Promise<ApiResponse<Swatch | null>> {
    const swatch = await prisma.swatch.findUnique({
      where: { barcode },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        parentRoll: { select: { id: true, barcode: true } },
      },
    });
    if (!swatch) {
      return { success: false, data: null, message: "Kartela bulunamadı" };
    }
    return { success: true, data: swatch };
  }

  async listSwatches(params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
    /** Cursor mode aktivasyonu — verilirse pagination cursor response döner. */
    cursor?: string;
    /** `cursor=...` parametresi yokken bile cursor formatı istemek için. */
    mode?: string;
    /** Barkod / kart no / ürün adı/kodu / parti araması (cursor mode'da geçerli). */
    search?: string;
    /** Cursor mode ilk fetch'te totalEstimate doldur. */
    withTotal?: boolean;
  }): Promise<ApiResponse<Swatch[]> | CursorPaginatedResponse<Swatch>> {
    // Soft-delete: iptal edilmiş kartela kabulünden gelen kartelalar listelenmez.
    const where: Prisma.SwatchWhereInput = { cancelledAt: null };
    if (params?.itemId) where.itemId = params.itemId;
    const search = params?.search?.trim();
    if (search) {
      // Barkod + kart no: TAM eşleşme (ikisi de @unique → index seek). `contains`/
      // ILIKE en_US.UTF-8'de unique indeksi KULLANAMAZ → tüm swatch tablosunu seq
      // scan eder. SW- barkod/kart hep tam okutulur; kısmi tarama saha akışı değil.
      // Ürün adı/kodu küçük master tabloya join (itemId IN) olduğu için contains kalır.
      where.OR = [
        { barcode: search },
        { cardNumber: search },
        { item: { name: { contains: search, mode: "insensitive" } } },
        { item: { code: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Kartela kendi `properties` alanı taşımaz; özellikler kaynak rolden
    // miras (kartela fasonda kaynak Roll'dan üretilir, aynı kumaş).
    // Side panel'in "Renk + Özellikler" bölmesi parentRoll üzerinden okur.
    const include = {
      item: { select: { id: true, code: true, name: true } },
      color: { select: { id: true, code: true, name: true, hex: true } },
      parentRoll: {
        select: {
          id: true,
          barcode: true,
          qualityGrade: true,
          color: { select: { id: true, code: true, name: true, hex: true } },
          properties: {
            select: {
              propertyId: true,
              property: { select: { id: true, code: true, name: true } },
            },
          },
        },
      },
    } as const;

    // Cursor mode (mobil infinite scroll, büyük katalog). Legacy çağrılar
    // (Electron paneli, tartı/paket scan akışı) cursor/mode vermez ve eski
    // `ApiResponse<Swatch[]>` cevabını alır.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 50), 200);
      const cursor = decodeDynamicCursor(params?.cursor);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "createdAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.swatch.findMany({
          where: cursorWhereClause,
          include,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal ? prisma.swatch.count({ where }) : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
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

    const swatches = await prisma.swatch.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      take: params?.limit ?? 100,
    });
    return { success: true, data: swatches };
  }

  /**
   * Kartela özet istatistikleri — listenin sayfaya bağlı toplamlarını değil,
   * filtreye uyan TÜM kartelaların aggregate'ini döner. Depo panelinin
   * "Toplam Kartela / Toplam Uzunluk" bölmesi için.
   */
  async getSwatchStats(params?: {
    itemId?: string;
    search?: string;
  }): Promise<ApiResponse<SwatchStats>> {
    const where: Prisma.SwatchWhereInput = { cancelledAt: null };
    if (params?.itemId) where.itemId = params.itemId;
    const search = params?.search?.trim();
    if (search) {
      // Barkod + kart no: TAM eşleşme (ikisi de @unique → index seek). `contains`/
      // ILIKE en_US.UTF-8'de unique indeksi KULLANAMAZ → tüm swatch tablosunu seq
      // scan eder. SW- barkod/kart hep tam okutulur; kısmi tarama saha akışı değil.
      // Ürün adı/kodu küçük master tabloya join (itemId IN) olduğu için contains kalır.
      where.OR = [
        { barcode: search },
        { cardNumber: search },
        { item: { name: { contains: search, mode: "insensitive" } } },
        { item: { code: { contains: search, mode: "insensitive" } } },
      ];
    }

    const aggregate = await prisma.swatch.aggregate({
      where,
      _count: { _all: true },
      _sum: { length: true },
    });

    return {
      success: true,
      data: {
        count: aggregate._count._all,
        totalLength: Number(aggregate._sum.length ?? 0),
      },
    };
  }

  /**
   * Step ID ile direkt çek — mobil aksiyon sonrası refresh için.
   * `getByCardBarcode`'un step çözüm kısmını atlar; barkod kullanımını saklar.
   */
  async getStep(stepId: string): Promise<ApiResponse<TamburStepSummary>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { batchNumber: true } },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest("Bu adım Tambur tipinde değil");
    }

    // LIFO sıralama: KK2'nin sepete son koyduğu açık kumaş Tambur'a ilk önce
    // gelir (operatör en üstten alır). `enteredAt DESC` ile son giren listenin
    // başında olur.
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: stepId, exitedAt: null },
      orderBy: { enteredAt: "desc" },
      select: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            properties: {
              select: {
                property: { select: { id: true, name: true } },
              },
            },
            errors: {
              where: { isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: {
                id: true,
                startMeter: true,
                errorType: true,
              },
            },
          },
        },
      },
    });

    const rolls: TamburRollSummary[] = openMovements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      itemCode: m.roll.item.code,
      itemName: m.roll.item.name,
      colorCode: m.roll.color?.code ?? null,
      colorName: m.roll.color?.name ?? null,
      currentQty: Number(m.roll.currentQty),
      width: m.roll.width !== null ? Number(m.roll.width) : null,
      qualityGrade: m.roll.qualityGrade,
      properties: m.roll.properties.map((p) => ({
        id: p.property.id,
        name: p.property.name,
      })),
      errorCount: m.roll.errors.length,
      errors: m.roll.errors.map((e) => ({
        id: e.id,
        startMeter: Number(e.startMeter),
        errorType: e.errorType,
      })),
    }));

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.batchNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        rolls,
      },
    };
  }

  /**
   * Tambur'da yeni hata tespiti — Kurşun'da yakalanmamış ama Tambur'da
   * görülen hatalar bu metotla eklenir. Kayıt RollError olarak açılır,
   * `isProcessed=false` olur; aynı `finalize` akışıyla karara bağlanır
   * (Kurşun'dan gelenlerle birlikte aynı liste).
   */
  async reportError(
    data: {
      rollId: string;
      stepId: string;
      startMeter: number;
      defectTypeId: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (data.startMeter > Number(roll.currentQty)) {
      throw AppError.badRequest(
        `Hata metresi (${data.startMeter}) topun metrajını (${roll.currentQty}) aşıyor`
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

    // Top bu Tambur adımında olmalı
    if (roll.currentStepId !== data.stepId) {
      throw AppError.badRequest(
        `Top (${roll.barcode}) şu anda bu Tambur adımında değil`
      );
    }
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      select: { station: { select: { kind: true } } },
    });
    if (!step || step.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest("Bu adım Tambur tipinde değil");
    }

    const err = await prisma.rollError.create({
      data: {
        rollId: data.rollId,
        startMeter: data.startMeter,
        defectTypeId: defectType.id,
        errorType: defectType.name,
        isProcessed: false,
        detectedAtStepId: data.stepId,
        detectedByUserId: userId ?? null,
      },
    });

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
        source: "TAMBUR",
      },
    });

    return {
      success: true,
      data: err,
      message: `${defectType.name} · ${data.startMeter}. metrede`,
    };
  }

  /**
   * Tambur adımlarında açık top bekleyen aktif refakat kartları.
   * Mobil "kamera simülasyonu" modal'ı için.
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
        totalCurrentQty: number;
        /** WO.targetItem/targetColor — Kanban kartında kumaş + renk göstermek için. */
        itemName: string | null;
        colorName: string | null;
        colorHex: string | null;
        /** Tambur'a giriş tarihi — en eski açık RollMovement.enteredAt. Liste
         *  ekranında operatöre "ne kadar zamandır bekliyor" göstergesi için. */
        oldestEnteredAt: Date | null;
      }>
    >
  > {
    const steps = await prisma.workOrderStep.findMany({
      where: {
        station: { kind: StationKind.TAMBUR },
        status: { not: "COMPLETED" },
        currentRolls: { some: {} },
      },
      select: {
        id: true,
        workOrderId: true,
        station: { select: { name: true, code: true } },
        workOrder: {
          select: {
            batchNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true, hex: true } },
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { id: true, cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        currentRolls: { select: { currentQty: true } },
        movements: {
          where: { exitedAt: null },
          select: { enteredAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const data = steps
      .map((s) => {
        const card = s.workOrder.travelerCards[0];
        if (!card) return null;
        const oldest = s.movements.reduce<Date | null>((acc, m) => {
          if (acc === null) return m.enteredAt;
          return m.enteredAt < acc ? m.enteredAt : acc;
        }, null);
        return {
          cardId: card.id,
          cardNumber: card.cardNumber,
          cardBarcode: card.barcode,
          workOrderId: s.workOrderId,
          batchNumber: s.workOrder.batchNumber,
          stepId: s.id,
          stationName: s.station.name,
          stationCode: s.station.code,
          openRollCount: s.currentRolls.length,
          totalCurrentQty: s.currentRolls.reduce((sum, r) => sum + Number(r.currentQty), 0),
          itemName: s.workOrder.targetItem?.name ?? null,
          colorName: s.workOrder.targetColor?.name ?? null,
          colorHex: s.workOrder.targetColor?.hex ?? null,
          oldestEnteredAt: oldest,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { success: true, data };
  }


  // ===========================================================================
  // WAREHOUSE ROLL CUT — Top Kesme akışı
  // ===========================================================================
  // Senaryo: depodaki barkodlu bir topun Tambur operatörü tarafından birden çok
  // parçaya kesilmesi (cutOpenFabric pattern'inin WAREHOUSE topu varyantı).
  //
  //  - Her cutWarehouseRoll çağrısı: child Roll doğar (parent özellikleri inherit),
  //    parent.currentQty düşer. Multi-cut: operatör istediği kadar çağırır.
  //  - finalizeWarehouseCut: parent TAMBUR_CONSUMED'a çekilir (arşive),
  //    kalan kumaş için karar (1.KALITE/A1/FIRE/discard).
  //
  // Farklar (vs cutOpenFabric):
  //  - Parent WAREHOUSE'da (currentStepId null), step/movement işlemi yok
  //  - producedInStepId parent'tan değil null olarak yazılır (depo topu, Tambur
  //    step'inin parçası değil)
  // ===========================================================================

  async cutWarehouseRoll(
    rollId: string,
    data: {
      cutLength: number;
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
      /**
       * Ham (renksiz STOCK) top kesiminde çıkan parçanın hedefi:
       *   STOCK     → üretime geri döner (yeni iş emrine bağlanabilir: boyahane/KK2/tambur),
       *   WAREHOUSE → ham-bitmiş, sevke hazır (renksiz olarak depoya iner).
       * Bitmiş depo topu (WAREHOUSE parent) kesiminde YOK SAYILIR — çıktı her zaman WAREHOUSE.
       */
      rawDestination?: "STOCK" | "WAREHOUSE";
    },
    userId?: string,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> {
    if (!(data.cutLength > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }

    const parent = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        properties: { select: { propertyId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Top bulunamadı");
    if (parent.barcode === null) {
      throw AppError.badRequest(
        "Bu Roll açık kumaş; cutWarehouseRoll sadece barkodlu depo topu için",
      );
    }
    // Ham (renksiz STOCK) top da "Top Kesme" aracında kesilebilir. Bitmiş depo
    // topu (WAREHOUSE) klasik akış; ham stok ise operatörün seçtiği hedefe göre
    // çıktı verir. Diğer statüler (IN_PRODUCTION vb.) kesime uygun değil.
    const isRawParent =
      parent.status === RollStatus.STOCK && parent.colorId === null;
    if (parent.status !== RollStatus.WAREHOUSE && !isRawParent) {
      throw AppError.badRequest(
        `Top kesime uygun değil (${parent.status}) — yalnız depodaki bitmiş toplar veya renksiz ham stok kesilebilir`,
      );
    }
    // Çocuk top statüsü: ham parent → operatör hedefi (default üretime devam =
    // STOCK; sevke hazır = WAREHOUSE). Bitmiş parent → her zaman WAREHOUSE.
    const childStatus: RollStatus = isRawParent
      ? data.rawDestination === "WAREHOUSE"
        ? RollStatus.WAREHOUSE
        : RollStatus.STOCK
      : RollStatus.WAREHOUSE;
    if (data.cutLength > Number(parent.currentQty)) {
      throw AppError.badRequest(
        `Kesim metresi (${data.cutLength}) topun kalan metresinden (${parent.currentQty}) büyük olamaz`,
      );
    }

    const resolvedQualityGrade = data.qualityGrade ?? parent.qualityGrade;
    const resolvedQualityGradeId =
      data.qualityGrade && data.qualityGrade !== parent.qualityGrade
        ? await resolveQualityGradeId(resolvedQualityGrade)
        : parent.qualityGradeId;
    const propertyIds = parent.properties.map((p) => p.propertyId);
    const childBarcode = generateTamburChildBarcode();

    const result = await prisma.$transaction(async (tx) => {
      const child = await tx.roll.create({
        data: {
          barcode: childBarcode,
          itemId: parent.itemId,
          colorId: parent.colorId,
          width: parent.width,
          initialQty: data.cutLength,
          currentQty: data.cutLength,
          weightKg: null,
          // Bitmiş re-cut → WAREHOUSE; ham kesim → operatör hedefi (STOCK/WAREHOUSE).
          status: childStatus,
          qualityGrade: resolvedQualityGrade,
          qualityGradeId: resolvedQualityGradeId,
          parentRollId: parent.id,
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          createdById: userId ?? null,
          // Kartelalık yalnız depoya (WAREHOUSE) inen çıktıda anlamlı; ham stoğa
          // dönen (üretime devam) parçada işaretlenmez.
          markedForKartela:
            (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
        },
      });

      if (propertyIds.length > 0) {
        await tx.rollProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            rollId: child.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // KURSUN_APPLIED + QC2_COMPLETED kalıtım — parent topta yapılmış operasyonlar
      // child'a `inheritedFromParentRollId=parent.id` ile kopyalanır. Aksi halde
      // child Bitmiş Depo'da "kurşun/KK2 yapılmadı" gözüküyor.
      // Filter KALDIRILDI: zincirleme inherit destekle. Depo topundaki KURSUN/QC2
      // op'ları zaten parent'tan inherit edilmiştir (inheritedFromParentRollId
      // set). Sadece "orijinal" op'lara bakarsak chain kopar, child'da hiç op
      // kalmaz. Çoklu kayıt olabilir; sorun değil — UI find() ilki bulur.
      const inheritedOps = await tx.rollOperation.findMany({
        where: {
          rollId: parent.id,
          operationType: {
            in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED],
          },
        },
        select: {
          workOrderStepId: true,
          operationType: true,
          operatorId: true,
          metadata: true,
        },
      });
      if (inheritedOps.length > 0) {
        await tx.rollOperation.createMany({
          data: inheritedOps.map((op) => ({
            rollId: child.id,
            workOrderStepId: op.workOrderStepId,
            operationType: op.operationType,
            operatorId: op.operatorId,
            metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            inheritedFromParentRollId: parent.id,
          })),
        });
      }

      // Parent kısalıyor — initialQty'i de güncelle (her kesim sonrası reset).
      // UI "currentQty / initialQty" ayrımı Top Kesme'de anlamsız: kesim
      // sonrası eski etiket fiziksel olarak da geçersiz, operatör yenisini
      // basar; sistemde "70 / 100" gösterimi yanıltıcı.
      // Atomic decrement — hesap DB-side, gte guard concurrent overdraw'a karşı.
      // Önceki kesim de initialQty=currentQty yaptığı için iki decrement aynı sonucu verir.
      let updatedParent;
      try {
        updatedParent = await tx.roll.update({
          where: { id: parent.id, currentQty: { gte: data.cutLength } },
          data: {
            currentQty: { decrement: data.cutLength },
            initialQty: { decrement: data.cutLength },
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          throw AppError.conflict(
            "Topun kalan metresi yetersiz — başka bir işlem aynı topu kullanıyor olabilir"
          );
        }
        throw err;
      }
      const newParentQty = Number(updatedParent.currentQty);

      return { child, newParentQty, updatedParent };
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: result.child.id,
      newData: {
        kind: isRawParent ? "TAMBUR_CUT_RAW" : "TAMBUR_CUT_FROM_WAREHOUSE",
        parentRollId: parent.id,
        parentBarcode: parent.barcode,
        cutLength: data.cutLength,
        childBarcode: result.child.barcode,
        childQualityGrade: result.child.qualityGrade,
        childStatus,
        rawDestination: isRawParent ? (data.rawDestination ?? "STOCK") : null,
        parentRemainingQty: result.newParentQty,
        notes: data.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        childRoll: result.child,
        parentRoll: result.updatedParent as Roll,
        parentRemainingQty: result.newParentQty,
      },
      message: `Kesim: ${data.cutLength} mt → ${result.child.barcode}. Top kalan: ${result.newParentQty} mt.`,
    };
  }

  /**
   * Top Kesme akışını bitir — parent topu TAMBUR_CONSUMED'a (arşive) çek, kalan
   * kumaş için karar uygula (1.KALITE/A1/FIRE/discard).
   *
   * `remainingAction`:
   *  - "keep_1kalite" → kalan için 1.KALITE child Roll oluştur (WAREHOUSE)
   *  - "keep_a1"      → A1 child Roll
   *  - "scrap"        → FIRE child Roll (stokta kalır)
   *  - "discard"      → kalan tamamen kayıp
   *  - remainingQty=0 → no-op
   */
  async finalizeWarehouseCut(
    rollId: string,
    data: {
      remainingAction?: "keep_1kalite" | "keep_a1" | "scrap" | "discard";
      notes?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>> {
    const parent = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        properties: { select: { propertyId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Top bulunamadı");
    if (parent.barcode === null) {
      throw AppError.badRequest("Bu Roll açık kumaş; finalizeWarehouseCut sadece barkodlu depo topu için");
    }
    // Ham (renksiz STOCK) kesimi de bu fonksiyonla bitirilir — parent arşivlenir.
    const isRawParent =
      parent.status === RollStatus.STOCK && parent.colorId === null;
    if (parent.status !== RollStatus.WAREHOUSE && !isRawParent) {
      throw AppError.badRequest(`Top kesime uygun değil (${parent.status})`);
    }

    const remainingQty = Number(parent.currentQty);
    const action = data.remainingAction ?? "discard";
    const wantChild = remainingQty > 0 && action !== "discard";
    // Ham parent: kalan parça ham kalır — "keep_*" → ham STOCK (üretime devam),
    // "scrap" → FIRE/SCRAP. Bitmiş parent: klasik kalite kodu, çıktı WAREHOUSE.
    const childQualityGrade = isRawParent
      ? action === "scrap"
        ? "FIRE"
        : parent.qualityGrade
      : action === "keep_1kalite"
        ? "1.KALITE"
        : action === "keep_a1"
          ? "A1"
          : "FIRE";
    const childStatus: RollStatus = isRawParent
      ? action === "scrap"
        ? RollStatus.SCRAP
        : RollStatus.STOCK
      : RollStatus.WAREHOUSE;
    const propertyIds = parent.properties.map((p) => p.propertyId);

    const childQualityGradeId = wantChild
      ? await resolveQualityGradeId(childQualityGrade)
      : null;

    const result = await prisma.$transaction(async (tx) => {
      let remainingChild: Roll | null = null;

      if (wantChild) {
        const child = await tx.roll.create({
          data: {
            barcode: generateTamburChildBarcode(),
            itemId: parent.itemId,
            colorId: parent.colorId,
            width: parent.width,
            initialQty: remainingQty,
            currentQty: remainingQty,
            weightKg: null,
            // Ham parent → kalan ham STOCK/SCRAP; bitmiş parent → WAREHOUSE.
            status: childStatus,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            parentRollId: parent.id,
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            createdById: userId ?? null,
            },
        });
        if (propertyIds.length > 0) {
          await tx.rollProperty.createMany({
            data: propertyIds.map((propertyId) => ({
              rollId: child.id,
              propertyId,
            })),
            skipDuplicates: true,
          });
        }
        // Kalan child'a da KURSUN/QC2 kalıtımı uygula. Filter YOK — zincirleme
        // inherit (depo topundaki op'lar zaten inherit'li).
        const inheritedOps = await tx.rollOperation.findMany({
          where: {
            rollId: parent.id,
            operationType: {
              in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED],
            },
          },
          select: {
            workOrderStepId: true,
            operationType: true,
            operatorId: true,
            metadata: true,
          },
        });
        if (inheritedOps.length > 0) {
          await tx.rollOperation.createMany({
            data: inheritedOps.map((op) => ({
              rollId: child.id,
              workOrderStepId: op.workOrderStepId,
              operationType: op.operationType,
              operatorId: op.operatorId,
              metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
              inheritedFromParentRollId: parent.id,
            })),
          });
        }
        remainingChild = child as Roll;
      }

      // Parent retire — TAMBUR_CONSUMED (arşive)
      await tx.roll.update({
        where: { id: parent.id },
        data: {
          status: RollStatus.TAMBUR_CONSUMED,
          currentQty: 0,
        },
      });

      return { remainingChild };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: parent.id,
      newData: {
        kind: "WAREHOUSE_CUT_FINALIZED",
        parentBarcode: parent.barcode,
        remainingAction: action,
        remainingChildId: result.remainingChild?.id ?? null,
        remainingQty,
        notes: data.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId: parent.id,
        remainingChild: result.remainingChild,
        remainingQty,
      },
      message: result.remainingChild
        ? `Top Kesme bitti: ${parent.barcode} arşivlendi · kalan ${remainingQty}m ${childQualityGrade} olarak kayıtlı`
        : `Top Kesme bitti: ${parent.barcode} arşivlendi${remainingQty > 0 ? ` · ${remainingQty}m fire` : ""}`,
    };
  }

  // ===========================================================================
  // OPEN FABRIC TAMBUR — yeni model: tek-kesim + finalize + context
  // ===========================================================================
  //
  // Senaryo: Boyahane'den dönen açık kumaş Roll'lar Kurşun/KK2'de işlendi
  // (kursun-finish), Tambur step'ine ilerletildi. Tambur operatörü sırasıyla
  // (LIFO — araba en üstten alta) kumaşları işler.
  //
  // Operatör 100. metreye gelince "kes" basar → cutOpenFabric çağrılır →
  // yeni child Roll (gerçek top, barkodlu) oluşur. Açık kumaş'ın currentQty
  // kalan metreye düşer. Operatör tekrar 100. metreye gelince yine kes basar.
  //
  // Açık kumaş bittiğinde operatör finalize çağırır → parent CONSUMED_AT_TAMBUR.

  /**
   * Tek kesim — açık kumaştan child Roll oluştur.
   * Tüm yeni rulolar WAREHOUSE statüsünde doğar; kalite ayrımı `qualityGrade`
   * alanında. Geri uyum: tablet eski `status` enum'unu (A1_STOCK/SCRAP)
   * göndermeye devam edebilir; karşılık gelen qualityGrade'e otomatik dönüşür.
   */
  async cutOpenFabric(
    openFabricRollId: string,
    data: {
      lengthMeters: number;
      status: "WAREHOUSE" | "SCRAP" | "A1_STOCK";
      qualityGrade?: string | null;
      notes?: string | null;
      /** Çıktı top kartelalık işaretlensin (depoda kartela sevki için). */
      markedForKartela?: boolean;
    },
    userId?: string,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRemainingQty: number }>> {
    if (!(data.lengthMeters > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }

    const parent = await prisma.roll.findUnique({
      where: { id: openFabricRollId },
      include: {
        currentStep: { include: { station: { select: { kind: true } } } },
        properties: { select: { propertyId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Açık kumaş Roll bulunamadı");
    if (parent.barcode !== null) {
      throw AppError.badRequest(
        "Bu Roll açık kumaş değil (barkodlu); cutOpenFabric sadece açık kumaş için kullanılır",
      );
    }
    if (!parent.currentStep || parent.currentStep.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Roll Tambur step'inde değil (${parent.currentStep?.station.kind ?? "STEPSIZ"})`,
      );
    }
    if (parent.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.badRequest(
        `Açık kumaş aktif değil (${parent.status})`,
      );
    }
    if (data.lengthMeters > Number(parent.currentQty)) {
      throw AppError.badRequest(
        `Kesim metresi (${data.lengthMeters}) açık kumaşın kalan metresinden (${parent.currentQty}) büyük olamaz`,
      );
    }

    // Geri uyum: tablet eski input'u (status A1_STOCK/SCRAP) gönderebilir.
    // Yeni kurguda status her zaman WAREHOUSE; eski status değerleri
    // qualityGrade'e dönüştürülür (explicit qualityGrade override eder).
    const statusToQuality: Record<string, string> = {
      WAREHOUSE: "1.KALITE",
      A1_STOCK: "A1",
      SCRAP: "FIRE",
    };
    const resolvedQualityGrade =
      data.qualityGrade ?? statusToQuality[data.status] ?? "1.KALITE";
    const childStatus = RollStatus.WAREHOUSE;
    const tamburStepId = parent.currentStep.id;
    const propertyIds = parent.properties.map((p) => p.propertyId);
    const childBarcode = generateTamburChildBarcode();

    const resolvedQualityGradeId = await resolveQualityGradeId(resolvedQualityGrade);

    const result = await prisma.$transaction(async (tx) => {
      // Child Roll oluştur
      const child = await tx.roll.create({
        data: {
          barcode: childBarcode,
          itemId: parent.itemId,
          colorId: parent.colorId,
          width: parent.width,
          initialQty: data.lengthMeters,
          currentQty: data.lengthMeters,
          weightKg: null,
          status: childStatus,
          qualityGrade: resolvedQualityGrade,
          qualityGradeId: resolvedQualityGradeId,
          producedInStepId: tamburStepId,
          parentRollId: parent.id,
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          createdById: userId ?? null,
          // Sadece depoya giden (WAREHOUSE) çıktı kartelalık işaretlenir.
          markedForKartela:
            (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
          // currentStepId: child Tambur'dan çıktı (depo değil bir step) — null.
        },
      });

      if (propertyIds.length > 0) {
        await tx.rollProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            rollId: child.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // KURSUN_APPLIED + QC2_COMPLETED kalıtım — parent açık kumaşta yapılan
      // işlemler child top'a `inheritedFromParentRollId=parent.id` ile kopyalanır.
      // Aksi halde child Bitmiş Depo'da "kurşun/KK2 yapılmadı" gözüküyor; oysa
      // operasyonlar fiziksel olarak parent üzerinde yapılmış ve sonucu child'a
      // geçmiş. Bulk split (satır 407-414 / 561-575) bunu yapıyor — open fabric
      // split'te de aynı semantik gerek.
      // Filter KALDIRILDI: zincirleme inherit destekle. Depo topundaki KURSUN/QC2
      // op'ları zaten parent'tan inherit edilmiştir (inheritedFromParentRollId
      // set). Sadece "orijinal" op'lara bakarsak chain kopar, child'da hiç op
      // kalmaz. Çoklu kayıt olabilir; sorun değil — UI find() ilki bulur.
      const inheritedOps = await tx.rollOperation.findMany({
        where: {
          rollId: parent.id,
          operationType: {
            in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED],
          },
        },
        select: {
          workOrderStepId: true,
          operationType: true,
          operatorId: true,
          metadata: true,
        },
      });
      if (inheritedOps.length > 0) {
        await tx.rollOperation.createMany({
          data: inheritedOps.map((op) => ({
            rollId: child.id,
            workOrderStepId: op.workOrderStepId,
            operationType: op.operationType,
            operatorId: op.operatorId,
            metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            inheritedFromParentRollId: parent.id,
          })),
        });
      }

      // Parent atomic decrement — hesap DB-side, gte guard concurrent overdraw'a karşı.
      let updatedParent;
      try {
        updatedParent = await tx.roll.update({
          where: { id: parent.id, currentQty: { gte: data.lengthMeters } },
          data: { currentQty: { decrement: data.lengthMeters } },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          throw AppError.conflict(
            "Açık kumaşın kalan metresi yetersiz — başka bir işlem aynı topu kullanıyor olabilir"
          );
        }
        throw err;
      }
      const newParentQty = Number(updatedParent.currentQty);

      return { child, newParentQty };
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: result.child.id,
      newData: {
        kind: "TAMBUR_CUT_FROM_OPEN_FABRIC",
        parentOpenFabricId: parent.id,
        parentReceiptId: parent.parentReceiptId,
        lengthMeters: data.lengthMeters,
        status: childStatus,
        qualityGrade: result.child.qualityGrade,
        barcode: result.child.barcode,
        parentRemainingQty: result.newParentQty,
        notes: data.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        childRoll: result.child,
        parentRemainingQty: result.newParentQty,
      },
      message: `Kesim tamam: ${data.lengthMeters} mt → ${childStatus} (${result.child.barcode}). Açık kumaş kalan: ${result.newParentQty} mt.`,
    };
  }

  /**
   * Açık kumaşı bitir — parent CONSUMED_AT_TAMBUR'a çek, Tambur movement'ı kapat.
   *
   * `remainingAction` operatörün kalan metre (currentQty) için kararı:
   *   - "keep_1kalite" → 1.KALITE barkodlu top oluştur (status=WAREHOUSE)
   *   - "keep_a1"      → A1 barkodlu top oluştur (status=WAREHOUSE)
   *   - "scrap"        → FIRE barkodlu top oluştur (status=WAREHOUSE, fiziksel olarak fire ama stokta kalır)
   *   - "discard"      → kalan metre tamamen kayıp (eski scrapRemaining=false davranışı)
   *
   * Geri uyum: `remainingAction` verilmezse, eski `scrapRemaining` boolean'ından
   * türetir (true→"scrap", false/undefined→"discard"). Mobile yeni param'a geçince
   * scrapRemaining deprecate edilir.
   *
   * remainingQty=0 ise hiçbir child oluşmaz (action verilse bile no-op).
   */
  async finalizeOpenFabric(
    openFabricRollId: string,
    data: {
      remainingAction?: "keep_1kalite" | "keep_a1" | "scrap" | "discard";
      scrapRemaining?: boolean;
      notes?: string | null;
      /// Tambur kararı — WO.foldType (planlama) override. Verilmezse planlanan
      /// kullanılır (WO.foldType). Bu değer audit/RollOperation metadata'ya yazılır.
      foldType?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; remainingChildId: string | null; remainingQty: number }>> {
    const parent = await prisma.roll.findUnique({
      where: { id: openFabricRollId },
      include: {
        currentStep: {
          include: {
            station: { select: { kind: true } },
            workOrder: {
              include: {
                steps: {
                  select: { id: true, status: true },
                },
              },
            },
          },
        },
        properties: { select: { propertyId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Açık kumaş Roll bulunamadı");
    if (parent.barcode !== null) {
      throw AppError.badRequest("Bu Roll açık kumaş değil (barkodlu)");
    }

    // IDEMPOTENCY: Sync replay'inde 2. çağrı için. Parent zaten TAMBUR_CONSUMED
    // ise (status + currentStepId=null) finalize tamamlanmış. TAMBUR_PROCESSED
    // RollOperation metadata'sından kalan child + qty bilgisini okuyup cached
    // response döner — duplicate child roll yaratılmaz.
    if (parent.status === RollStatus.TAMBUR_CONSUMED) {
      const tamburOp = await prisma.rollOperation.findFirst({
        where: {
          rollId: parent.id,
          operationType: RollOperationType.TAMBUR_PROCESSED,
        },
        select: { metadata: true },
        orderBy: { createdAt: "desc" },
      });
      const meta = (tamburOp?.metadata ?? null) as {
        remainingChildId?: string | null;
        remainingQty?: number;
      } | null;
      return {
        success: true,
        data: {
          rollId: parent.id,
          remainingChildId: meta?.remainingChildId ?? null,
          remainingQty: Number(meta?.remainingQty ?? 0),
        },
        message: "Açık kumaş zaten finalize edilmiş (idempotent retry).",
      };
    }

    if (!parent.currentStep || parent.currentStep.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Roll Tambur step'inde değil (${parent.currentStep?.station.kind ?? "STEPSIZ"})`,
      );
    }
    if (parent.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.badRequest(`Açık kumaş aktif değil (${parent.status})`);
    }

    const remainingQty = Number(parent.currentQty);
    // remainingAction varsa onu kullan; yoksa eski scrapRemaining'den türet.
    const action: "keep_1kalite" | "keep_a1" | "scrap" | "discard" =
      data.remainingAction ?? (data.scrapRemaining === true ? "scrap" : "discard");
    const wantChild = remainingQty > 0 && action !== "discard";
    const childQualityGrade: string =
      action === "keep_1kalite" ? "1.KALITE" : action === "keep_a1" ? "A1" : "FIRE";
    const tamburStepId = parent.currentStep.id;
    const woId = parent.currentStep.workOrderId;
    const propertyIds = parent.properties.map((p) => p.propertyId);

    // Planlanan foldType WO'dan — operatör override etmemişse bu kullanılır.
    // Override + planlanan ikisini de metadata'ya yaz ki sapma izlenebilsin.
    const plannedFoldType = parent.currentStep.workOrder.foldType ?? null;
    const actualFoldType =
      data.foldType !== undefined ? data.foldType : plannedFoldType;
    const overriddenFoldType =
      data.foldType !== undefined && data.foldType !== plannedFoldType;

    const childQualityGradeId = wantChild
      ? await resolveQualityGradeId(childQualityGrade)
      : null;

    const result = await prisma.$transaction(async (tx) => {
      let remainingChildId: string | null = null;

      // Kalan metre için child Roll oluştur (action != discard ve kalan > 0).
      // Kalite operatörün seçimine göre: 1.KALITE / A1 / FIRE. Hepsi WAREHOUSE'a iner.
      if (wantChild) {
        const child = await tx.roll.create({
          data: {
            barcode: generateTamburChildBarcode(),
            itemId: parent.itemId,
            colorId: parent.colorId,
            width: parent.width,
            initialQty: remainingQty,
            currentQty: remainingQty,
            weightKg: null,
            status: RollStatus.WAREHOUSE,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            producedInStepId: tamburStepId,
            parentRollId: parent.id,
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            createdById: userId ?? null,
            },
        });
        if (propertyIds.length > 0) {
          await tx.rollProperty.createMany({
            data: propertyIds.map((propertyId) => ({
              rollId: child.id,
              propertyId,
            })),
            skipDuplicates: true,
          });
        }
        remainingChildId = child.id;
      }

      // #8 — parent tüketilmeden kalan açık hatalar NO_CUT olarak kapansın.
      await closeOrphanRollErrors(tx, parent.id, tamburStepId, userId);

      // Parent CONSUMED_AT_TAMBUR — currentQty=0, currentStepId=null
      await tx.roll.update({
        where: { id: parent.id },
        data: {
          status: RollStatus.TAMBUR_CONSUMED,
          currentQty: 0,
          currentStepId: null,
        },
      });

      // Tambur movement'ı kapat
      const movementNote =
        wantChild && remainingChildId
          ? `TAMBUR_FINALIZED:REMAINING_${remainingQty}_${childQualityGrade}`
          : "TAMBUR_FINALIZED";
      await tx.rollMovement.updateMany({
        where: {
          rollId: parent.id,
          workOrderStepId: tamburStepId,
          exitedAt: null,
        },
        data: {
          qtyOut: parent.initialQty,
          exitedAt: new Date(),
          notes: movementNote,
        },
      });

      // TAMBUR_PROCESSED log
      await tx.rollOperation.upsert({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: parent.id,
            workOrderStepId: tamburStepId,
            operationType: RollOperationType.TAMBUR_PROCESSED,
          },
        },
        create: {
          rollId: parent.id,
          workOrderStepId: tamburStepId,
          operationType: RollOperationType.TAMBUR_PROCESSED,
          operatorId: userId ?? null,
          metadata: {
            finalizedAt: new Date().toISOString(),
            remainingAction: action,
            remainingChildId,
            remainingChildQuality: wantChild ? childQualityGrade : null,
            remainingQty,
            notes: data.notes ?? null,
            plannedFoldType,
            actualFoldType,
            overriddenFoldType,
          } as Prisma.InputJsonValue,
        },
        update: {},
      });

      await recomputeStepStatus(tx, tamburStepId);

      // WO completion check — Tambur production'ın son istasyonu (paketleme/sevk
      // fulfillment, WO step değil).
      const remainingSteps = await tx.workOrderStep.count({
        where: {
          workOrderId: woId,
          status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
        },
      });
      if (remainingSteps === 0) {
        await tx.workOrder.update({
          where: { id: woId },
          data: { status: WorkOrderStatus.COMPLETED },
        });
        await tx.travelerCard.updateMany({
          where: { workOrderId: woId, status: "ACTIVE" },
          data: { status: "COMPLETED" },
        });
      }

      return { remainingChildId };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: parent.id,
      newData: {
        finalizedAt: new Date().toISOString(),
        remainingAction: action,
        remainingChildId: result.remainingChildId,
        remainingChildQuality: wantChild ? childQualityGrade : null,
        remainingQty,
        notes: data.notes ?? null,
      },
    });

    const message = wantChild
      ? `Açık kumaş finalize: kalan ${remainingQty} mt ${childQualityGrade} kalitede top olarak kaydedildi.`
      : action === "discard" && remainingQty > 0
        ? `Açık kumaş finalize: kalan ${remainingQty} mt kayıt dışı (operatör attı).`
        : "Açık kumaş finalize edildi.";

    return {
      success: true,
      data: {
        rollId: parent.id,
        remainingChildId: result.remainingChildId,
        remainingQty,
      },
      message,
    };
  }

  /**
   * Tambur ekran context — refakat kartı barkoduyla:
   *   - WO bilgisi
   *   - WO'ya bağlı orderlar + her order için shippedQty / orderedQty progress
   *   - Tambur step'indeki açık kumaş Roll'ları LIFO sıralı + RollError'lar
   */
  async getTamburContext(
    cardBarcode: string,
  ): Promise<
    ApiResponse<{
      workOrderId: string;
      batchNumber: string | null;
      stepId: string;
      stationName: string;
      /// Tambur planlama bilgisi — operatöre ekranda gösterilir, override edilebilir.
      plannedFoldType: string | null;
      /// Tambur adımına yazılan not (WorkOrderStep.notes) — operatöre gösterilir.
      stepNote: string | null;
      orders: Array<{
        orderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        lines: Array<{
          lineId: string;
          itemId: string;
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          orderedQty: number;
          shippedQty: number;
          /// Sipariş satırı kesim notu + eşit-parça önerisi (Tambur talimatı).
          cutNote: string | null;
          pieceLengthM: number | null;
        }>;
      }>;
      openFabricRolls: Array<{
        rollId: string;
        currentQty: number;
        initialQty: number;
        receiptNo: string | null;
        colorCode: string | null;
        colorName: string | null;
        kursunFinishedAt: string | null;
        errors: TamburRollErrorSummary[];
      }>;
    }>
  > {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
    }

    const { stepId } = await assertWoAtStepKind(card.workOrderId, StationKind.TAMBUR);
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            batchNumber: true,
            foldType: true,
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Tambur adımı bulunamadı");

    // WO'ya bağlı OrderLine'lar
    const links = await prisma.workOrderToOrderLine.findMany({
      where: { workOrderId: card.workOrderId },
      select: {
        orderLine: {
          select: {
            id: true,
            itemId: true,
            quantity: true,
            width: true,
            cutNote: true,
            pieceLengthM: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            requiredProperties: {
              select: {
                property: { select: { id: true, name: true } },
              },
            },
            order: {
              select: {
                id: true,
                orderNumber: true,
                customer: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Order başına grupla
    const ordersMap = new Map<
      string,
      {
        orderId: string;
        orderNumber: string;
        customerId: string;
        customerName: string;
        lines: Array<{
          lineId: string;
          itemId: string;
          itemCode: string;
          itemName: string;
          colorCode: string | null;
          colorName: string | null;
          width: number | null;
          orderedQty: number;
          shippedQty: number;
          cutNote: string | null;
          pieceLengthM: number | null;
          requiredProperties: { id: string; name: string }[];
        }>;
      }
    >();
    for (const link of links) {
      const ol = link.orderLine;
      const order = ol.order;
      // Sevkiyat modülü 2026-05-25 silindi, yeniden yazılacak. O zamana kadar
      // shippedQty her zaman 0 — frontend tarafında gösterilmiyor.
      const shippedQty = 0;
      if (!ordersMap.has(order.id)) {
        ordersMap.set(order.id, {
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customer.id,
          customerName: order.customer.name,
          lines: [],
        });
      }
      ordersMap.get(order.id)!.lines.push({
        lineId: ol.id,
        itemId: ol.itemId,
        itemCode: ol.item.code,
        itemName: ol.item.name,
        colorCode: ol.color?.code ?? null,
        colorName: ol.color?.name ?? null,
        width: ol.width !== null ? Number(ol.width) : null,
        orderedQty: Number(ol.quantity),
        shippedQty,
        cutNote: ol.cutNote ?? null,
        pieceLengthM: ol.pieceLengthM !== null ? Number(ol.pieceLengthM) : null,
        requiredProperties: ol.requiredProperties.map((rp) => ({
          id: rp.property.id,
          name: rp.property.name,
        })),
      });
    }
    const orders = Array.from(ordersMap.values());

    // Açık kumaş Roll'ları (LIFO — Tambur movement enteredAt DESC)
    const openMovements = await prisma.rollMovement.findMany({
      where: {
        workOrderStepId: stepId,
        exitedAt: null,
        roll: {
          barcode: null,
          status: RollStatus.IN_PRODUCTION,
        },
      },
      orderBy: { enteredAt: "desc" }, // LIFO: en son giren en üstte
      select: {
        enteredAt: true,
        roll: {
          select: {
            id: true,
            currentQty: true,
            initialQty: true,
            color: { select: { code: true, name: true } },
            parentReceipt: { select: { receiptNo: true } },
            errors: {
              orderBy: { startMeter: "asc" },
              select: {
                id: true,
                startMeter: true,
                
                errorType: true,
              },
            },
            operations: {
              where: { operationType: RollOperationType.QC2_COMPLETED },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });

    const openFabricRolls = openMovements.map((m) => ({
      rollId: m.roll.id,
      currentQty: Number(m.roll.currentQty),
      initialQty: Number(m.roll.initialQty),
      receiptNo: m.roll.parentReceipt?.receiptNo ?? null,
      colorCode: m.roll.color?.code ?? null,
      colorName: m.roll.color?.name ?? null,
      kursunFinishedAt: m.roll.operations[0]?.createdAt.toISOString() ?? null,
      errors: m.roll.errors.map((e) => ({
        id: e.id,
        startMeter: Number(e.startMeter),
        errorType: e.errorType,
      })),
    }));

    return {
      success: true,
      data: {
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.batchNumber,
        stepId: step.id,
        stationName: step.station.name,
        plannedFoldType: step.workOrder.foldType,
        stepNote: step.notes,
        orders,
        openFabricRolls,
      },
    };
  }

}
