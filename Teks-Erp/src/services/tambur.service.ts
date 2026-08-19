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
import { normalizeScanCode } from "../utils/code-format";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { resolveQualityGradeId, resolveQualityGradeIdStrict } from "./helpers/quality-grade.helper";
import { resolveEntryStationId } from "./helpers/roll-entry-station.helper";
import { readTamburOverQuantityEnabled } from "./system-setting.service";
import { recordVarianceTx, overageOf } from "./helpers/roll-variance.helper";
import {
  VARIANCE_SOURCES,
  varianceKindForRemainingAction,
} from "../constants/variance-reasons";
import { RollVarianceKind } from "@prisma/client";
import { factoryDayStart } from "../constants/time";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import { buildTextSearch } from "../utils/query-parser";
import type { CursorPaginatedResponse } from "./base.service";
import { K18_DEAD_STATUSES } from "./batch.service";
import { resolveFoldTypeForWrite } from "./helpers/fold-type";
import { assertRollMatchesPlan } from "./helpers/tambur-plan-gate.helper";
import { sackBlockMessage } from "./helpers/sack-invariants.helper";

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
  Swatch,
  WorkOrderStatus,
} from "@prisma/client";
import {
  assertWoAtStepKind,
  completeWorkOrderIfStepsDone,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { buildIntentSnapshot } from "./label.service";
import { resolveLabelIntent, labelCustomerIdOf } from "./helpers/label-intent.helper";
import { generateRollBarcode, reserveRollBarcodesInOrder } from "./helpers/roll-barcode.helper";
// ⚠️ TEK YÖNLÜ BAĞIMLILIK: tambur.service → kursun-bypass.service.
// `kursun-bypass.service` bu dosyayı (ya da onu import eden bir modülü) ASLA
// import etmez — ortak guard'lar `helpers/kursun-bypass-guard.helper.ts`'te
// yaşar. Bu kural bozulursa statik import döngüsü doğar (lazy import gerekir).
import {
  KursunBypassService,
  type KursunBypassTamburContext,
} from "./kursun-bypass.service";


// Kesim etiket NİYETİ (hedef sipariş kalemi / müşteri var-mı + müşteri isActive;
// hiçbiri yoksa stok) `helpers/label-intent.helper.ts`'te yaşar — eskiden bu
// dosyanın yerel `resolveCutLabelIntent` fonksiyonuydu, 2026-08-03'te TAŞINDI:
// aynı çözümü Tambur MANUEL ÜRETİMİ de (`tambur-manual.service.produceFinishedRoll`)
// çağırıyor ve ikinci bir kopya "pasif müşteri etikete atanamaz" guard'ının tek
// yolda kalmasıyla biterdi. Sonuç `buildIntentSnapshot`'a verilip child'ın
// `lastLabelSnapshot`'ına yazılır (gevşek model: BAĞ değil, baskı-anı bağlamı).


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
  qualityGradeCode: string | null,
  targetStatusByCode: Map<string, RollStatus>
): RollStatus {
  // qualityGrade nullable — null (kaliteye bakılmadı) → katalog override yok → WAREHOUSE.
  if (qualityGradeCode == null) return RollStatus.WAREHOUSE;
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
): Promise<string[]> {
  const open = await tx.rollError.findMany({
    where: { rollId, isProcessed: false },
    select: { id: true },
  });
  if (open.length === 0) return [];
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
  return open.map((e) => e.id);
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
  qualityGrade: string | null;
  /** Parent'tan miras FabricProperty özet listesi (mobil karar ekranı gösterir). */
  properties: { id: string; name: string }[];
  errorCount: number;
  errors: TamburRollErrorSummary[];
  /** Parti (Batch) kimliği — null = partisiz/doğrudan top. */
  batchId: string | null;
  /** Parti numarası (Batch.batchNumber, P+GGAAYY+NNNN) — partisiz topta null. */
  batchNumber: string | null;
  /** Partinin İPTAL EDİLMEMİŞ en güncel fason sevk numarası
   *  (SubcontractorDispatch.dispatchNo) — hiç sevk görmemiş partide null. */
  dispatchNo: string | null;
  /** WO içindeki 1-based parti sırası (Batch.createdAt'e göre, stabil — bir
   *  parti Tambur'dan çıksa bile numarası kaymaz). */
  branchOrdinal: number | null;
}

interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  /** DİKKAT: legacy alan adı — İŞ EMRİ numarasıdır (WorkOrder.workOrderNumber),
   *  Batch değil. Gerçek parti numarası per-roll `TamburRollSummary.batchNumber`. */
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export class TamburService {
  /** Kurşun Dağıtım (bypass) okuma yolu — yalnız `getTamburContext` kullanır. */
  private readonly bypassService = new KursunBypassService();

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
      // Emniyet tavanı (listOpenCards/kursun-qc paritesi): mobil Tambur panosu bu ucu
      // periyodik yokluyor; take yokken patolojik durumda tüm IN_PRODUCTION@TAMBUR
      // rulolar + nested join çekilirdi. Gerçekte bu kadar eş zamanlı Tambur topu
      // görülmez → emniyet ağı; dolarsa sessiz kalma.
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    if (rolls.length === 500) {
      console.warn("[tambur] getPendingRolls: 500 tavanına ulaşıldı — liste kırpılmış olabilir.");
    }

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
   * batchId (parti) → { batchNumber, dispatchNo, ordinal } haritası.
   *   - batchNumber : Batch.batchNumber (P+GGAAYY+NNNN).
   *   - dispatchNo  : partinin İPTAL EDİLMEMİŞ en güncel fason sevki
   *                   (dispatchedAt desc) — hiç sevk görmemiş partide null.
   *   - ordinal     : WO'nun TÜM partileri içinde createdAt sırasına göre
   *                   1-based parti sırası — bir parti Tambur'dan çıksa bile
   *                   numarası kaymaz. Tambur listesinde partileri ayırt
   *                   etmek için kullanılır.
   */
  private async buildBranchInfoMap(
    workOrderId: string,
    batchIds: (string | null)[],
  ): Promise<
    Map<string, { batchNumber: string; dispatchNo: string | null; ordinal: number }>
  > {
    const map = new Map<
      string,
      { batchNumber: string; dispatchNo: string | null; ordinal: number }
    >();
    const present = new Set(batchIds.filter((x): x is string => Boolean(x)));
    if (present.size === 0) return map;
    const [batches, dispatches] = await Promise.all([
      // Ordinal WO'nun TÜM partileri üzerinden hesaplanır (yalnız listedekiler
      // değil) — bir parti Tambur'dan düşünce kalanların numarası kaymasın.
      prisma.batch.findMany({
        where: { workOrderId },
        orderBy: { createdAt: "asc" },
        select: { id: true, batchNumber: true },
      }),
      prisma.subcontractorDispatch.findMany({
        where: { batchId: { in: [...present] }, cancelledAt: null },
        orderBy: { dispatchedAt: "desc" },
        select: { batchId: true, dispatchNo: true },
      }),
    ]);
    // dispatchedAt DESC → parti başına ilk görülen kayıt en güncel sevki.
    const latestDispatchNo = new Map<string, string>();
    for (const d of dispatches) {
      if (!latestDispatchNo.has(d.batchId)) {
        latestDispatchNo.set(d.batchId, d.dispatchNo);
      }
    }
    batches.forEach((b, i) => {
      if (present.has(b.id)) {
        map.set(b.id, {
          batchNumber: b.batchNumber,
          dispatchNo: latestDispatchNo.get(b.id) ?? null,
          ordinal: i + 1,
        });
      }
    });
    return map;
  }

  /**
   * Tambur adımında bekleyen açık RollMovement'leri TamburRollSummary[]'e çevirir
   * — parti bilgisiyle (batchId/batchNumber/dispatchNo/branchOrdinal) zenginleştirilmiş.
   * getByCardBarcode + getStep ortak kullanır (önceki kopyala-yapıştır birleşti).
   */
  private async loadTamburRolls(step: {
    id: string;
    workOrderId: string;
  }): Promise<TamburRollSummary[]> {
    // LIFO (enteredAt desc): KK2'den son çıkan açık kumaş Tambur'a ilk gelir.
    // İkincil anahtar id: toplu taşıma (finishStep createMany) aynı timestamp'i
    // yazar — tie-break'siz sıra refetch'ler arasında zıplıyordu (deterministik olsun).
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: step.id, exitedAt: null },
      orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
      select: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
            properties: {
              // value: Tambur FINAL KARAR noktasıdır — kurşunda seçilen GRAMAJ
              // değeri kesim/kalite kararını veren operatörün gözü önünde olmalı
              // (denetim VAL-03: ad basılıyordu, değer basılmıyordu).
              select: {
                property: { select: { id: true, name: true } },
                value: { select: { code: true, name: true } },
              },
            },
            errors: {
              where: { isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: { id: true, startMeter: true, errorType: true },
            },
          },
        },
      },
    });
    const branchInfo = await this.buildBranchInfoMap(
      step.workOrderId,
      openMovements.map((m) => m.roll.batchId),
    );
    return openMovements.map((m) => {
      const bi = m.roll.batchId
        ? branchInfo.get(m.roll.batchId)
        : undefined;
      return {
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
          value: p.value ?? null,
        })),
        errorCount: m.roll.errors.length,
        errors: m.roll.errors.map((e) => ({
          id: e.id,
          startMeter: Number(e.startMeter),
          errorType: e.errorType,
        })),
        batchId: m.roll.batchId ?? null,
        batchNumber: bi?.batchNumber ?? null,
        dispatchNo: bi?.dispatchNo ?? null,
        branchOrdinal: bi?.ordinal ?? null,
      };
    });
  }

  /**
   * `assertWoAtStepKind(TAMBUR)` + mal kurşunda bekliyorsa SOMUT SEBEP.
   *
   * Ham 400 *"Tabletinizi yanlış istasyonda okutmuş olabilirsiniz"* diyor; mal
   * kurşun adımında beklerken operatör TAM DOĞRU istasyonda duruyor ve bu cümle
   * onu yanlış yere bakmaya gönderiyor (saha bulgusu 2026-08-06). Sebep kuralı
   * `kursun-bypass.service`'te yaşar — burada yalnız mesaja iliştirilir.
   *
   * Zenginleştirme SESSİZ başarısız olur: sebep sorgusu düşerse operatör en
   * azından eski (doğru ama eksik) mesajı görür — baskın hatayı maskelemeyiz.
   */
  private async enrichTamburScanError(
    err: unknown,
    workOrderId: string,
  ): Promise<unknown> {
    if (!(err instanceof AppError) || err.statusCode !== 400) return err;
    const reason = await this.bypassService
      .explainTamburScanBlock(workOrderId)
      .catch(() => null);
    if (!reason) return err;
    return AppError.badRequest(
      `Bu iş emrinin "Tambur" adımında şu an açık top yok. ${reason}`,
    );
  }

  private async assertAtTamburWithReason(
    workOrderId: string,
  ): Promise<{ stepId: string; openRollCount: number }> {
    try {
      return await assertWoAtStepKind(workOrderId, StationKind.TAMBUR);
    } catch (err) {
      throw await this.enrichTamburScanError(err, workOrderId);
    }
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
      where: { barcode: normalizeScanCode(cardBarcode) },
      // Kart iş emri başına — doğrudan workOrderId.
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
    const { stepId } = await this.assertAtTamburWithReason(card.workOrderId);
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { workOrderNumber: true } },
      },
    });
    if (!step) {
      throw AppError.notFound("Bu iş emrinde Tambur adımı tanımlı değil");
    }

    // Adıma girmiş ama henüz tamamlanmamış roller (RollMovement.exitedAt = null).
    // Sıra LIFO (enteredAt desc): KK2'den en son çıkan = yeni sepetin en üstü =
    // Tambur operatörünün ilk eline aldığı top. KK2 ilk işlediği parça sepetin
    // en altına düşer, Tambur'a son sırada gider.
    const rolls = await this.loadTamburRolls(step);

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.workOrderNumber,
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
      /** Operatörün seçtiği kat. 2026-08-10'dan beri KATALOĞA bağlı (2-KAT /
       *  4-KAT / TÜP / fabrikanın eklediği 6-KAT…) → literal union DEĞİL.
       *  Geçerlilik `resolveFoldTypeForWrite` ile ölçülür. */
      foldType?: string | null;
      /** Çıktı topları (depoya gidenler) kartelalık işaretlensin — depoda
       *  kartela sevki için kolay bulunsun. Sevki engellemez. */
      markedForKartela?: boolean;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer.
       *  Sapma yokken gönderilmesi zararsız (kapı hiç açılmaz). */
      confirmMismatch?: boolean;
    },
    userId?: string,
    /** TAMBUR makine atfı — aktif çalışma oturumundan (controller çözer).
     *  TAMBUR_PROCESSED op'una + kapanan movement'a damgalanır. */
    machineId?: string | null
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
        // WO, topun KÖKENİNDEN (producedInStep) değil ŞU ANKİ ADIMINDAN çözülür:
        // Top Kesme çocuğu producedInStepId=null doğar ve Konumu-Düzelt ile Tambur'a
        // sokulabilir — köken üzerinden çözüm bu topta WO kilidini + tamamlama
        // sayımını atlıyordu (WO sonsuza dek IN_PROGRESS kalırdı).
        currentStep: {
          select: {
            id: true,
            workOrderId: true,
            // stationId 2026-08-05te EKLENDI: kesim cocuklarinin entryStationId
            // damgasi buradan cozulur. Ek sorgu YOK — ayni select.
            stationId: true,
            station: { select: { kind: true } },
            workOrder: {
              select: {
                id: true,
                status: true,
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
      // Cevap yalnız FİNALİZE'IN KENDİ çocuklarını dönmeli — parent'ın önceki
      // cutOpenFabric çocukları dahil edilirse istemci retry'de onlara mükerrer
      // etiket basar. Finalize, çocuk id'lerini TAMBUR_PROCESSED metadata'sına
      // yazar; yoksa (legacy kayıt / metadata öncesi finalize) tüm TAMBUR_SPLIT
      // çocuklara düşülür (eski davranış).
      const tamburOp = await prisma.rollOperation.findFirst({
        where: {
          rollId: data.rollId,
          operationType: RollOperationType.TAMBUR_PROCESSED,
        },
        select: { metadata: true },
        orderBy: { createdAt: "desc" },
      });
      const meta = (tamburOp?.metadata ?? null) as { childRollIds?: unknown } | null;
      const childRollIds = Array.isArray(meta?.childRollIds)
        ? (meta.childRollIds.filter((x): x is string => typeof x === "string"))
        : null;
      const cachedChildren = await prisma.roll.findMany({
        where: childRollIds
          ? { id: { in: childRollIds } }
          : {
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

    // DURUM GUARD'LARI (kardeş yollar cutOpenFabric/cutWarehouseRoll ile aynı):
    // KK2 reopen ile geri çekilmiş (KK2 adımındaki), çuvala rezerve WAREHOUSE,
    // SHIPPED, CANCELLED/SCRAP top bayat tablet listesinden finalize EDİLEMEZ.
    // Bu kontroller olmadan claim ("not TAMBUR_CONSUMED") her statüyü tüketirdi.
    if (roll.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.badRequest(
        `Top Tambur'da işlenebilir durumda değil (${roll.status}). Listeyi yenileyip tekrar deneyin.`
      );
    }
    if (!roll.currentStep || roll.currentStep.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Top Tambur adımında değil (${roll.currentStep?.station.kind ?? "STEPSIZ"}). ` +
          `KK2'ye geri çekilmiş olabilir — listeyi yenileyin.`
      );
    }

    const totalQty = Number(roll.currentQty);
    const wo = roll.currentStep.workOrder;
    const plannedFoldType = wo?.foldType ?? null;

    // Kat katalog doğrulaması — tx DIŞINDA (salt okuma; kilit süresini uzatmaz).
    // `undefined` korunur: aşağıdaki "operatör override etti mi" dalları buna bakar.
    const foldType = await resolveFoldTypeForWrite(data.foldType);

    // Savunma katmanı (cutOpenFabric BUG-2 paritesi): iptal/devredilmiş iş emrinin
    // Tambur adımında sıkışmış top finalize EDİLEMEZ — ölü WO'ya çocuk top üretimi
    // + iptalin COMPLETED'a dirilmesi olmaz. Taze hali kilit altında tekrar okunur.
    if (
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict("İptal/devredilmiş iş emrinin topu finalize edilemez");
    }

    // Renk kontrolü — Tambur'a gelen rulonun renk kazanmış olması beklenir
    // (boyahane Fason Kabul'ünde set edilir). Renksiz rulo Tambur'da operatöre
    // uyarı gösterir ama bloklanmaz; iş sahibi kararı: ham bitmiş ürün de
    // mümkün (örn. ham talep eden müşteri).
    const colorWarning =
      wo?.targetColorId && !roll.colorId
        ? "Bu rulo henüz renk kazanmadı (boyahane atlandı veya başarısız oldu). Ham olarak depoya geçecek."
        : null;

    // ── PLAN-GERÇEK SAPMA KAPISI (2026-08-19, ONAYLI DEVAM) ────────────────
    // Ortak yüklem: helpers/tambur-plan-gate.helper (üç depo-indiriş yolu aynı
    // kapı). Pre-tx; idempotent retry erken döndüğü için onaylı işin replay'i
    // kapıya çarpmaz.
    await assertRollMatchesPlan(
      { id: roll.id, barcode: roll.barcode, colorId: roll.colorId, width: roll.width },
      { workOrderId: wo?.id ?? null, targetColorId: wo?.targetColorId ?? null, width: wo?.width ?? null },
      data.confirmMismatch,
      userId,
      "finalize",
    );

    // Defect kararlarını topla — sadece lifecycle marker (isProcessed, actionTaken).
    // Kesim üretmez — kesimler `data.cuts` listesinden geliyor.
    const errorDecisions = data.decisions ?? [];
    const errorIds = errorDecisions.map((d) => d.errorId);
    const errors = errorIds.length
      ? await prisma.rollError.findMany({
          // F134: yalnız AÇIK hatalar — daha önce idari NO_CUT ile kapanmış bir
          // errorId decisions'da gelirse tarihçesi (actionTaken/processedAt/By)
          // ezilmesin. Kapanmış hata errorById'de olmaz → aşağıdaki loop atlar.
          where: { id: { in: errorIds }, rollId: data.rollId, isProcessed: false },
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
      // Aşım: kesimlerin toplamı kayıtlı metrajı geçiyor. Tambur asıl ölçüm noktası —
      // flag açıksa kabul edilir (parent toptan TAMBUR_CONSUMED olur; segmentler
      // operatörün ölçtüğü uzunlukla yaratılır, "kalan kuyruk" bloğu offsetD >= totalQtyD
      // olduğu için atlanır → negatif kalan oluşmaz). Flag kapalıyken bugünkü davranış: reddet.
      const overEnabled = await readTamburOverQuantityEnabled();
      if (!overEnabled) {
        throw AppError.badRequest(
          `Kesim uzunlukları toplamı (${cumulativeLenD.toString()}m) topun metrajını (${totalQtyD.toString()}m) aşıyor`
        );
      }
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
      // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
      select: { workOrderStepId: true, operationType: true, operatorId: true, metadata: true, machineId: true },
    });

    // Cut'lardaki + parent qualityGrade'lerini topla → katalog target status'larını çek.
    const allQualityCodes = Array.from(
      new Set([...inputCuts.map((c) => c.qualityGrade), roll.qualityGrade])
    ).filter((c): c is string => c != null);
    const qualityGradeRows = allQualityCodes.length
      ? await prisma.qualityGrade.findMany({
          where: { code: { in: allQualityCodes } },
          select: { id: true, code: true, targetStatus: true, isActive: true },
        })
      : [];
    const targetStatusByCode = new Map<string, RollStatus>(
      qualityGradeRows.map((q) => [q.code, q.targetStatus])
    );
    const qualityGradeIdByCode = new Map<string, string>(
      qualityGradeRows.map((q) => [q.code, q.id])
    );

    // OPERATÖR GİRDİSİ kalite kodları katalogda VAR + AKTİF olmalı (soft-delete
    // giriş guard'ı): typo'lu kod ("FİRE" gibi) eskiden sessizce WAREHOUSE'a
    // düşüp satılabilir stok oluyordu, qualityGradeId null kalıyordu. Parent'ın
    // kendi snapshot kodu lenient kalır (legacy/pasif kod finalize'ı bloklamaz).
    const activeCodeSet = new Set(
      qualityGradeRows.filter((q) => q.isActive).map((q) => q.code)
    );
    for (const c of inputCuts) {
      if (!activeCodeSet.has(c.qualityGrade)) {
        throw AppError.badRequest(
          `Bilinmeyen veya pasif kalite kodu: ${c.qualityGrade}`
        );
      }
    }

    // ── SEGMENT KURULUMU + BARKOD REZERVASYONU — tx AÇILMADAN ÖNCE ────────────
    // (2026-08-10 denetimi, F-CORE-VER-001) Bu blok eskiden transaction'ın
    // İÇİNDEYDİ ve her segment için ayrı ayrı `generateRollBarcode(tx, …)`
    // çağırıyordu. Sayaç satırının kilidi artışı yapan tx COMMIT edene kadar
    // tutulduğu için, İLK segmentin barkodu kalan tüm segmentler + 225 satır
    // kuyruk (8 yazma + 3 tx-helper) boyunca tutuluyordu; o süre boyunca
    // sahadaki HER KK1 ham top girişi aynı satırda kuyruğa giriyordu. Ölçüm:
    // paralel istek **1345 ms** bekliyordu, blok dışarı alınınca **39 ms**.
    //
    // ⚠️ TAŞIMA NEDEN GÜVENLİ — iki dayanak, ikisi de ölçüldü:
    //   1. Blok tx'e ait TEK BİR değer kullanmıyor: `inputCuts` (payload),
    //      `totalQtyD`, `targetStatusByCode`, `qualityGradeIdByCode` ve
    //      `roll.qualityGrade` zaten tx'ten ÖNCE hesaplanıyordu.
    //   2. Tx içindeki BAYAT METRAJ GUARD'I (`freshQtyRow.currentQty` ≠
    //      `totalQtyD` → 409) tam olarak bu varsayımı korumak için yazılmıştı
    //      ("segment hesabı tx DIŞINDA okunan currentQty ile yapıldı"). Yani
    //      segmentlerin tx dışında kurulmuş olması yeni bir durum DEĞİL; yeni
    //      olan tek şey, artık barkodun da orada alınması.
    // ⚠️ O GUARD'I KALDIRMA: tek doğrulama noktası odur — kaldırılırsa okuma ile
    //    claim arasına giren bir kesim bayat toplamla FAZLA metraj üretir.
    // ⚠️ REZERVASYON İDEMPOTENCY KAPISININ ALTINDA KALMALI. Yukarıdaki
    //    `if (roll.status === TAMBUR_CONSUMED) return buildIdempotentResponse()`
    //    (~satır 642) çevrimdışı replay'i ve çift dokunuşu tx'e hiç sokmadan
    //    döndürüyor; rezervasyon onun ALTINDA olduğu için o çağrılar sayaca
    //    dokunmuyor. Bloğu fonksiyonun başına taşımak "daha erken hazırlansın"
    //    diye cazip görünür ama her replay N barkod yakardı — ve replay tam da
    //    sahada en sık olan şeydir (tablet kuyruğu flush ederken).
    // ⚠️ Rezervasyonu `prisma` ile ama tx callback'inin İÇİNDE çağırmak da
    //    ÇÖZÜM DEĞİLDİR: ikinci bağlantı ister ve havuzu tüketir (30 eş zamanlı
    //    işlemin yalnız 3'ü tamamlandı). Kabul kriteri iki koşulludur —
    //    T1 < 100 ms VE T2 = 30/30 (bekçi: scripts/test_barcode_reservation.ts).

    // Cumulative length-based segment'leri oluştur.
    // inputCuts sıralı (operatörün makinede yaptığı sırayla); her cut bir
    // child Roll. Kalan kısım son child Roll (parent.qualityGrade ile).
    type Segment = {
      start: number; // parent metresinde başlangıç offset
      end: number; // parent metresinde bitiş offset
      qty: number;
      status: RollStatus;
      qualityGrade: string | null;
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

    // Split çocuğu FRESH kısa barkod alır (soy-ağacı parentRollId'de tutulur;
    // eski `parent+KS+suffix` biçimi hem uzundu hem hiçbir yerde parse edilmiyordu).
    // Tip başına TEK ifade; dönen dizi segment SIRASINI korur (yer değiştirirse
    // fiziksel toplara yanlış etiket basılır — bkz. helper'daki uyarı).
    const segmentBarcodes = await reserveRollBarcodesInOrder(
      prisma,
      segments.map((seg) => (seg.status === RollStatus.WAREHOUSE ? "F" : "H")),
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
    // F140: kapatılan RollError'lar için tx-sonrası per-satır audit (agregat log
    // kapatılan tekil hatayı iz tutmuyordu). tx İÇİNDE toplanır, commit sonrası emit.
    const closedErrorAudits: Array<{ errorId: string; actionTaken: string }> = [];
    const updatedRoll = await prisma.$transaction(async (tx) => {
      // O-2 write-skew guard: WO satırını kilitle → son-top tamamlama sayımı
      // (~1024) eşzamanlı finalize/finalizeOpenFabric/receive/cancel/directShip ile
      // serileşsin; hepsi WO satırını tx başında kilitlediğinden sayım COMMIT'li
      // adım statülerini görür (yoksa iki tx birbirinin adımını açık sayıp WO
      // IN_PROGRESS'te takılır). Lock sırası WO→roll (kardeşlerle tutarlı).
      await touchWorkOrderTx(tx, wo.id);
      // F130 paritesi: iptal-guard'ını kilit ALTINDA taze oku — pre-tx guard ile
      // claim arasında WO iptal edilmiş olabilir (softDelete cancelClaim aynı WO
      // satırını kilitler → burada serileşir).
      const freshWo = await tx.workOrder.findUnique({
        where: { id: wo.id },
        select: { status: true },
      });
      if (
        freshWo?.status === WorkOrderStatus.CANCELLED ||
        freshWo?.status === WorkOrderStatus.SUPERSEDED
      ) {
        throw AppError.conflict("İptal/devredilmiş iş emrinin topu finalize edilemez");
      }
      // ATOMIK CLAIM: parent'ı tek hamlede sahiplen. Koşullu updateMany satır
      // kilidi + status guard ile iki eşzamanlı finalize'dan yalnız BİRİNE
      // count=1 verir; kaybeden count=0 alır → tx geri sarılır, mükerrer child
      // Roll üretilmez. (Ön-kontrol tek başına yetmez: iki çağrı da henüz commit
      // etmeden ön-kontrolü geçebilir.)
      // Claim koşulu IN_PRODUCTION + aynı Tambur adımına daraltıldı: yukarıdaki
      // guard'lar tx DIŞINDA olduğundan pencerede statü DEĞİL ama adım da
      // değişebilir (KK2 reopen statüyü korur, currentStepId'yi değiştirir).
      const claim = await tx.roll.updateMany({
        where: {
          id: data.rollId,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: roll.currentStepId,
        },
        data: { status: RollStatus.TAMBUR_CONSUMED },
      });
      if (claim.count === 0) {
        // Ayrım: paralel finalize mi (idempotent dön), başka işlem mi (409)?
        const fresh = await tx.roll.findUnique({
          where: { id: data.rollId },
          select: { status: true },
        });
        if (fresh?.status === RollStatus.TAMBUR_CONSUMED) {
          raceLost = true;
          throw new Error("TAMBUR_RACE_LOST");
        }
        throw AppError.conflict(
          `Top bu sırada başka bir işlemle değişti (durum: ${fresh?.status ?? "?"}). Listeyi yenileyip tekrar deneyin.`
        );
      }

      // BAYAT METRAJ GUARD'I: cuts validasyonu ve segment hesabı tx DIŞINDA
      // okunan currentQty ile yapıldı. Okuma ile claim arasına bir kesim
      // (cutOpenFabric/cutWarehouseRoll) commit ettiyse bayat toplamla fazla
      // metraj üretirdik. Claim satır kilidini aldı; taze değer artık sabit —
      // uyuşmuyorsa operatöre yenile dedir.
      const freshQtyRow = await tx.roll.findUnique({
        where: { id: data.rollId },
        select: { currentQty: true },
      });
      if (!freshQtyRow || !new Prisma.Decimal(freshQtyRow.currentQty).equals(totalQtyD)) {
        throw AppError.conflict(
          `Topun metrajı bu sırada değişti (${totalQtyD.toString()}m → ${freshQtyRow?.currentQty ?? "?"}m). Listeyi yenileyip tekrar deneyin.`
        );
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
        closedErrorAudits.push({ errorId: d.errorId, actionTaken });
      }

      // #8 — decisions'ta geçmeyen açık hatalar NO_CUT olarak otomatik kapansın.
      const orphanClosedIds = await closeOrphanRollErrors(
        tx,
        data.rollId,
        roll.currentStepId,
        userId
      );
      processedCount += orphanClosedIds.length;
      for (const eid of orphanClosedIds) closedErrorAudits.push({ errorId: eid, actionTaken: "NO_CUT" });

      // Parent'ın FabricProperty listesini bir kez çek — her çocuğa miras kalır.
      // (Renk veren fason adımında WO.targetProperties parent.properties'e zaten
      // kopyalanmış durumda; Tambur sadece propagate eder.)
      const parentProperties = await tx.rollProperty.findMany({
        where: { rollId: data.rollId },
        // valueId: miras DEĞER-FARKINDA (denetim F6) — GRAMAJ=50GR çocuğa geçer.
        select: { propertyId: true, valueId: true },
      });

      // Her segment için yeni Roll + property + kalıtım op'ları + audit.
      // (Segmentler ve barkodları tx AÇILMADAN ÖNCE hazırlandı — gerekçe ve
      // ölçüm yukarıdaki blokta; barkodu burada üretmek sayaç kilidini bu tx'in
      // sonuna kadar tutardı.)
      for (const [segIndex, seg] of segments.entries()) {
        const splitBarcode = segmentBarcodes[segIndex]!;
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
            // seg.qualityGrade nullable → null anahtarla katalog araması yok, id null.
            qualityGradeId:
              seg.qualityGrade != null
                ? qualityGradeIdByCode.get(seg.qualityGrade) ?? null
                : null,
            // Çocuk, İŞLEMİN YAPILDIĞI Tambur adımını damgalar (cutOpenFabric
            // paritesi) — parent kalıtımı değil: parent producedInStepId=null
            // olabilir (Top Kesme çocuğu) ve üretim atfı/istatistik çocuğun
            // doğduğu adıma aittir.
            producedInStepId: roll.currentStep!.id,
            parentRollId: roll.id,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen toplar depoya
            // gitse bile hangi partiden geldiği lane'de izlenir.
            batchId: roll.batchId,
            // GİRİŞ İSTASYONU — kesim hangi Tambur adımındaysa çocuk orada doğdu.
            // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
            // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
            entryStationId: resolveEntryStationId({ stepStationId: roll.currentStep?.stationId }),
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            // Sadece depoya giden (WAREHOUSE) çıktılar kartelalık işaretlenir;
            // fire/scrap işaretlenmez (zaten sevke uygun değil).
            markedForKartela:
              (data.markedForKartela ?? false) && seg.status === RollStatus.WAREHOUSE,
            // finalize toplu kesim — per-segment müşteri niyeti yok → stok etiketi.
            // (Müşteri istenirse baskı anında seed edilir.)
            lastLabelSnapshot: { stock: true },
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
              valueId: p.valueId,
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
              machineId: op.machineId,
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
      if (foldType !== undefined && roll.currentStepId) {
        const step = await tx.workOrderStep.findUnique({
          where: { id: roll.currentStepId },
          select: { stepData: true },
        });
        const existing = (step?.stepData as Record<string, unknown> | null) ?? {};
        const merged: Record<string, unknown> = {
          ...existing,
          tamburDecidedAt: new Date().toISOString(),
          foldType,
        };
        await tx.workOrderStep.update({
          where: { id: roll.currentStepId },
          data: { stepData: merged as Prisma.InputJsonValue },
        });
      }

      // Tambur adımındaki açık RollMovement'i kapat. qtyOut = movement'ın KENDİ
      // qtyIn'i (istasyona giren işlenmiş metraj — kursun finishStep paritesi):
      // finalize öncesi cutOpenFabric/cutWarehouseRoll kesimleri currentQty'yi
      // düşürmüş olabilir; kalanla (totalQty) kapatmak istasyon iş-hacmi
      // raporundan kesilen metrajı kaybettirirdi. qtyIn ölçülmemişse (0/null,
      // KK1 kenarı) kalan metraja düşülür.
      const now = new Date();
      const oldStepId = roll.currentStepId;
      if (oldStepId) {
        const openMove = await tx.rollMovement.findFirst({
          where: { rollId: data.rollId, workOrderStepId: oldStepId, exitedAt: null },
          select: { qtyIn: true },
        });
        const qtyOutD =
          openMove && new Prisma.Decimal(openMove.qtyIn).greaterThan(0)
            ? new Prisma.Decimal(openMove.qtyIn)
            : new Prisma.Decimal(totalQty);
        await tx.rollMovement.updateMany({
          where: {
            rollId: data.rollId,
            workOrderStepId: oldStepId,
            exitedAt: null,
          },
          data: {
            exitedAt: now,
            qtyOut: qtyOutD,
            weightOut: roll.weightKg,
            notes: `TAMBUR_CONSUMED`,
            // İşin YAPILDIĞI makine kapanışta damgalanır (oturumdan).
            ...(machineId ? { machineId } : {}),
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
          // KAPANIŞ ÖNCESİ METRAJ (2026-08-09) — geri alma bunu çocukların
          // toplamından TÜRETMESİN (aşımda `currentQty > initialQty` üretiyordu).
          preTamburCloseQty: totalQtyD,
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
            machineId: machineId ?? null,
            createdAt: now,
            metadata: {
              // Planlanan (WO.foldType) — Tambur ekranına bilgi olarak gelir.
              plannedFoldType,
              // Operatörün gerçek seçimi (override etmiş olabilir).
              foldType: foldType ?? null,
              childRollCount: segments.length,
              // BU finalize çağrısında doğan çocuklar — idempotent retry cevabı
              // yalnız bunları döner (öncesindeki cutOpenFabric çocukları değil;
              // yoksa retry'de istemci C1/C2 için mükerrer etiket basardı).
              childRollIds: splitRolls.map((r) => r.id),
              cutCount: inputCuts.length,
              tailCount: offsetD.lessThan(totalQtyD) ? 1 : 0,
              processedErrors: processedCount,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });
        await recomputeStepStatus(tx, oldStepId);
      }

      // AŞIM DEFTERİ (2026-08-09) — klasik karar akışının artı yönü.
      // `cumulativeLenD > totalQtyD` kontrolü yukarıda zaten yapıldı ve bayrak
      // açıkken kabul edildi; burada YALNIZ kayda geçirilir. Üç kesim yolunun
      // (bu, cutOpenFabric, cutWarehouseRoll) üçü de aynı hesabı kullanır —
      // `overageOf` tek kaynak, kopyalanırsa defter sessizce eksik kalır.
      await recordVarianceTx(tx, {
        rollId: data.rollId,
        workOrderStepId: oldStepId,
        kind: RollVarianceKind.OVERAGE,
        qty: overageOf(cumulativeLenD, totalQtyD),
        source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
        userId,
      });

      // WO completion — Tambur production'ın son istasyonu. Tüm üretim step'leri
      // COMPLETED/SKIPPED ise WO kapanır. (Tartı/paket/sevkiyat artık step değil,
      // fulfillment akışı — WO'yu tutmaz.) Terminal-durum guard'lı ORTAK helper:
      // CANCELLED/SUPERSEDED buradan COMPLETED'a DİRİLMEZ (kart fanout helper içinde).
      await completeWorkOrderIfStepsDone(tx, wo.id);

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

    // Tx commit etti — child Roll CREATE audit'lerini TEK createMany ile emit et
    // (eski sıralı for-loop INSERT yerine; bir Tambur kesimi N child üretebilir).
    await AuditService.logMany(
      childAudits.map((a) => ({
        userId,
        action: "CREATE" as const,
        tableName: "ROLL",
        recordId: a.recordId,
        newData: a.newData,
      }))
    );

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

    // F140: kapatılan RollError'ların per-satır izini emit et (best-effort, tx dışı).
    if (closedErrorAudits.length > 0) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL_ERROR",
        recordId: closedErrorAudits.map((e) => e.errorId).join(","),
        newData: { tamburFinalize: true, rollId: data.rollId, closures: closedErrorAudits },
      });
    }

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
   * Her kartela kendi barkodunu (KRT+GGAAYY+NNNN) ve kart numarasını alır.
   */
  // NOT: Kartela artık Tambur'da kesilmez. Kartela = bitmiş bir topun kartela
  // fason firmasında işlenmesiyle doğar (KartelaService.receive). Bkz.
  // docs/design/KARTELA-TASARIM.md. Eski createSwatch / nextSwatchSequence kaldırıldı.

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
    /**
     * HIZLI TARİH: kaç FABRİKA GÜNÜ geriye bakılacak (1 = bugün, 2 = son 2 gün).
     * `dateFrom`/`dateTo` ile birlikte gönderilirse BU KAZANIR — hızlı seçim
     * operatörün son dokunduğu şeydir; ikisini AND'lemek "bugün" derken boş
     * liste döndürebilirdi (aralık dünü gösteriyorsa kesişim boş).
     */
    dayRange?: number;
    /** Serbest aralık (mutlak an — istemci yerel gün sınırlarını kendisi yollar). */
    dateFrom?: Date;
    dateTo?: Date;
    /** Kalite kodu (1.KALITE / A1 / FIRE). */
    qualityGrade?: string;
    /** Etiket hedefindeki müşteri (`Roll.labelCustomerId`). */
    customerId?: string;
    /** Kumaş (2026-08-12) — KK1 "Tüm Girişler" ile ORTAK filtre şeridinden. */
    itemId?: string;
    /** Kesimi yapan makine / personel (2026-08-12): "Bu makine" + Personel çipi. */
    createdMachineId?: string;
    createdById?: string;
  }): Promise<ApiResponse<Roll[]> | CursorPaginatedResponse<Roll>> {
    const where: Prisma.RollWhereInput = {
      // Tambur istasyonundan ÇIKAN her top — iki doğum yolu var:
      //   TAMBUR_SPLIT  → kesim çocuğu (kart okutulmuş normal akış)
      //   TAMBUR_MANUAL → "Manuel Ekle" modu, kartsız bitmiş top
      //
      // ⚠️ TAMBUR_MANUAL 2026-08-03'te EKLENDİ ve bu bir hata düzeltmesidir:
      // liste yalnız TAMBUR_SPLIT gösterdiği için manuel eklenen top buraya HİÇ
      // düşmüyordu. Bu ekranda etiketi yeniden basmanın TEK yolu Çıkanlar
      // önizlemesindeki "Bas / Yeni Etiket" olduğundan, yazıcı hata verdiğinde
      // operatörün elinde tek çıkar yol topu SIFIRDAN tekrar girmekti — yani
      // envantere mükerrer ("yalancı kopya") stok yazmak. Kaydın kendisi
      // doğruydu, kayıp olan şey ONA ULAŞMAKTI.
      entrySource: { in: [RollEntrySource.TAMBUR_SPLIT, RollEntrySource.TAMBUR_MANUAL] },
      // Sonradan tüketilen/iptal edilen çocuk (re-cut'ta TAMBUR_CONSUMED,
      // kartela/fason tüketimi, CANCELLED) fiziksel top değil — etiket basılmaz.
      status: { notIn: K18_DEAD_STATUSES },
      // İş emri süzgeci verilirse manuel toplar DOĞAL OLARAK düşer
      // (`producedInStepId` null — hiçbir WO'nun çıktısı değiller). Bu doğru:
      // "şu iş emrinden ne çıktı" sorusunun cevabı onlar değil. Mobil Çıkanlar
      // modalı bu süzgeci GEÇMEZ, o yüzden manuel toplar orada görünür.
      ...(params?.workOrderId
        ? { producedInStep: { workOrderId: params.workOrderId } }
        : {}),
    };
    // ── TARİH SÜZGECİ (2026-08-09) ──────────────────────────────────────────
    // Saha isteği: "bugün / son 2 gün / belli tarih aralığı". Gün sınırı
    // `factoryDayStart()` ile çözülür — düz `new Date()` gece vardiyasının
    // 00:00-03:00 arasındaki işini BİR ÖNCEKİ güne yazardı (kök CLAUDE.md'nin
    // "fabrika günü" kuralı). Çıpa `createdAt`: bu liste ÜRETİM anına bakar,
    // "son işlem"e değil (etiket yeniden basımı tarihi kaydırmasın).
    if (params?.dayRange) {
      // Çıpayı N-1 gün geri al, SONRA gün başına yasla — `factoryDayStart`
      // hedef günün kendi UTC ofsetini yeniden türettiği için yaz/kış saati
      // geçişinde de doğru sınır çıkar (düz ms çıkarma tek başına kayardı).
      const anchor = new Date(Date.now() - (params.dayRange - 1) * 86_400_000);
      where.createdAt = { gte: factoryDayStart(anchor) };
    } else if (params?.dateFrom || params?.dateTo) {
      // Serbest aralık: sınırlar İSTEMCİNİNDİR (raporlardaki `resolveDateRange`
      // sözleşmesi) — backend ek gün yuvarlaması YAPMAZ, yaparsa istemcinin
      // niyeti iki kez yorumlanır.
      where.createdAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    if (params?.qualityGrade) where.qualityGrade = params.qualityGrade;
    // Kumaş: düz eşitlik (tekil seçim). Çoklu seçim istenirse `readIdCondition`
    // ile `{ in: [...] }`e çevrilir — ham CSV geçirmek P2007/400 demektir.
    if (params?.itemId) where.itemId = params.itemId;
    if (params?.createdMachineId) where.createdMachineId = params.createdMachineId;
    if (params?.createdById) where.createdById = params.createdById;
    if (params?.customerId) {
      // Etiket hedefindeki müşteri — `Roll.labelCustomerId` (B4). Kolon
      // yazılmadan önce basılmış toplarda NULL'dur ve süzgece takılmaz;
      // bu bilinçli (geri doldurma ayrı bir adım).
      where.labelCustomerId = params.customerId;
    }

    const search = params?.search?.trim();
    if (search) {
      // Barkod: TAM eşleşme (unique index seek) — `contains`/ILIKE en_US.UTF-8
      // collation'da barcode indeksini KULLANAMAZ → seq scan (ana rulo listesiyle
      // aynı karar, bkz. inventory.service buildRollWhere). Barkod okutulur/
      // yapıştırılır; ortasından substring araması saha akışı değil. Ürün/renk/
      // parti küçük master tablolarda kaldığı için `contains` (fuzzy) korunur.
      where.OR = [
        // ⚠️ `normalizeScanCode` ZORUNLU: el tarayıcısı barkodu KÜÇÜK harfle
        // gönderebiliyor (2026-08-17 saha vakası) ve burada TAM EŞİTLİK arandığı
        // için küçük harfli girdi SESSİZCE 0 sonuç verir — top listede "yok"
        // görünür ama yan panelde açılır (okutma yolu normalize ediyor). Ana top
        // listesi 2026-08-19'da düzeltilmişti; bu üç yüzey (Tambur çıktı listesi +
        // kartela liste/istatistik) atlanmıştı.
        { barcode: normalizeScanCode(search) },
        ...buildTextSearch<Prisma.RollWhereInput>(search, {
          text: ["item.name", "color.name", "item.customerAliases.some.alias"],
          code: ["item.code", "producedInStep.workOrder.workOrderNumber"],
        }),
      ];
    }

    const include = {
      item: true,
      color: true,
      producedInStep: {
        select: { workOrder: { select: { id: true, workOrderNumber: true } } },
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
      where: { barcode: normalizeScanCode(barcode) },
      include: {
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
        parentRoll: { select: { id: true, barcode: true } },
      },
    });
    // F292: kardeş getByCardBarcode/getStep deseniyle hizala — bulunamayan barkod
    // 404 (controller {success:false}'u incelemiyor → servis-throw güvenli).
    if (!swatch) throw AppError.notFound("Kartela bulunamadı");
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
        // ⚠️ Barkod/kart no TAM eşleşme → girdi normalize EDİLMEK ZORUNDA
        // (bkz. `listRecentOutputRolls` notu; aynı sessiz-0-sonuç arızası).
        { barcode: normalizeScanCode(search) },
        { cardNumber: normalizeScanCode(search) },
        ...buildTextSearch<Prisma.SwatchWhereInput>(search, {
          text: ["item.name"],
          code: ["item.code"],
        }),
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

    // F170: legacy dal da cursor moduyla AYNI 1..200 clamp'ini uygular — controller
    // ham Number(req.query.limit) geçiyor (NaN / negatif / 500000 mümkün); ağır
    // parentRoll+properties+color include'lu sınırsız satır çekimini önle.
    const legacyLimit = Math.min(
      Math.max(1, Number.isFinite(params?.limit) ? (params!.limit as number) : 100),
      200,
    );
    const swatches = await prisma.swatch.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      take: legacyLimit,
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
        // ⚠️ Barkod/kart no TAM eşleşme → girdi normalize EDİLMEK ZORUNDA
        // (bkz. `listRecentOutputRolls` notu; aynı sessiz-0-sonuç arızası).
        { barcode: normalizeScanCode(search) },
        { cardNumber: normalizeScanCode(search) },
        ...buildTextSearch<Prisma.SwatchWhereInput>(search, {
          text: ["item.name"],
          code: ["item.code"],
        }),
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
        workOrder: { select: { workOrderNumber: true } },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest("Bu adım Tambur tipinde değil");
    }

    // LIFO sıralama: KK2'nin sepete son koyduğu açık kumaş Tambur'a ilk önce
    // gelir (operatör en üstten alır). `enteredAt DESC` ile son giren listenin
    // başında olur.
    const rolls = await this.loadTamburRolls(step);

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.workOrderNumber,
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

    // Mükerrer engeli (KK2 KursunQcService.reportError ile AYNI kural — iki giriş
    // yolu arası parite): aynı top + aynı metre + aynı hata tipi tekrar girilemez.
    // RollError'da DB-level @@unique YOK → çift-tık/bayat-liste/retry'de sessiz
    // mükerrer kayıt + şişen açık-hata sayaçları olurdu. Aynı metrede FARKLI tip serbest.
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

    // Üstteki findFirst SIRALI çift-tıkı yakalar; bu try/catch EŞZAMANLI yarışı
    // DB-level partial unique (roll_errors_roll_meter_defect_uq) üzerinden kapatır:
    // iki paralel istek findFirst'te boş görse de ikincinin create'i P2002 alır → 409.
    let err: RollError;
    try {
      err = await prisma.$transaction(async (tx) => {
        // ATOMİK CLAIM (finalize ile yarış): create'ten önce top satır-kilitlenir
        // ve hâlâ bu Tambur adımında IN_PRODUCTION olduğu tx İÇİNDE doğrulanır.
        // Yukarıdaki currentStepId pre-check'i check-then-act — eşzamanlı finalize
        // (closeOrphanRollErrors) parent'ı tüketirken bu create ondan SONRA commit
        // ederse RollError sonsuza dek açık yetim kalırdı (TAMBUR_CONSUMED topun
        // hatasını hiçbir ekran bir daha karara bağlayamaz). Kilit sayesinde
        // finalize bu hatayı ya görür (NO_CUT kapatır) ya da bu çağrı 409 alır.
        const claim = await tx.roll.updateMany({
          where: {
            id: data.rollId,
            status: RollStatus.IN_PRODUCTION,
            currentStepId: data.stepId,
          },
          data: { updatedAt: new Date() },
        });
        if (claim.count === 0) {
          throw AppError.conflict(
            "Top bu sırada başka bir işlemle değişti (finalize edilmiş olabilir). Listeyi yenileyip tekrar deneyin."
          );
        }
        return tx.rollError.create({
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
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
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
            workOrderNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true, hex: true } },
            // Kart iş emri başına — WO'nun aktif kartı Kanban'da gösterilir.
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { id: true, cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        currentRolls: {
          select: { currentQty: true },
        },
        movements: {
          where: { exitedAt: null },
          select: { enteredAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      // Emniyet tavanı (kursun-qc.listOpenCards/listQueue ile parite): tablet Tambur
      // panosu bu ucu 5sn'de bir yokluyor; take yokken patolojik durumda tüm açık
      // adımları + nested payload çekerdi. Gerçekte bu kadar eş zamanlı açık Tambur
      // adımı görülmez → emniyet ağı; dolarsa sessiz kalma.
      take: 500,
    });
    if (steps.length === 500) {
      console.warn("[tambur] listOpenCards: 500 açık-adım tavanına ulaşıldı — liste kırpılmış olabilir.");
    }

    const data = steps
      .map((s) => {
        // İş emrinin aktif kartı (kart WO başına).
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
          batchNumber: s.workOrder.workOrderNumber,
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
      /** Parçanın katı — verilmezse parent'tan devralınır (bu yolda WO yok). */
      foldType?: string | null;
      /** Etiket niyeti — WAREHOUSE child'ın `lastLabelSnapshot`'ına yazılır;
       *  raw→STOCK (üretime devam) child stok'a düşer. İkisi de boş = stok. */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID). Barkod sunucuda sıralı atanır;
       *  aynı token'la 2. çağrı child'ı idempotent döner (ikinci kesim/decrement YOK). */
      clientToken?: string;
    },
    userId?: string,
    /**
     * Aktif çalışma oturumunun istasyonu — çıkan parçanın GİRİŞ İSTASYONU damgası.
     *
     * Bu yolda İŞ EMRİ/ADIM YOKTUR (depo topu kesimi), dolayısıyla adım kaynağı
     * kullanılamaz ve tek doğru kaynak oturumdur. Verilmezse damga NULL kalır —
     * eski istemciler ve dahili çağrılar kırılmaz.
     */
    sessionStationId?: string | null,
    /** Kesimin yapıldığı makine — "Bu makine" süzgeci + makine raporları için.
     *  (2026-08-12: kesim çocukları createdById alıyordu ama createdMachineId
     *  ALMIYORDU → makine süzgeci kesimleri hiç göremiyordu.) */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> {
    if (!(data.cutLength > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }

    // Kat katalog doğrulaması — `undefined` korunur (parent'tan miras dalı ona bakar).
    const foldType = await resolveFoldTypeForWrite(data.foldType);

    const parent = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        properties: { select: { propertyId: true, valueId: true } },
        // Çuval kodu — aşağıdaki çuval guard'ının mesajı için (operatör çuvalı bulmalı).
        sack: { select: { sackNo: true } },
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
    // Çuvala/sevkiyata rezerve top serbest stok DEĞİL — kesilirse sevkiyat içeriği
    // ve karşılanma bozulur. WAREHOUSE statüsüyle görünse de önce çıkarılmalı.
    // ÇUVAL ÖNCE (2026-07-30): DEPO çuvalındaki topun `shipmentId`'si NULL'dır, o
    // yüzden aşağıdaki kontrol onu KAÇIRIYORDU. Kesilirse üç şey bozulur:
    //   (1) parent'ın metrajı çuvalın İÇİNDE sessizce eksilir (aşağıda decrement),
    //   (2) burada `resetSackWeightsTx` ÇAĞRILMADIĞI için çuvalın brüt kg'si bayatlar,
    //   (3) çocuk top çuval DIŞINDA doğar → çuval içeriği ile fiziksel gerçek ayrışır.
    if (parent.sackId) {
      throw AppError.badRequest(
        sackBlockMessage(parent.barcode ?? parent.id, parent.sack?.sackNo ?? null, "kesilemez"),
      );
    }
    if (parent.shipmentId) {
      throw AppError.badRequest(
        "Bu top bir sevkiyatın çuvalında (rezerve) — kesilemez. Önce sevkiyattan çıkar.",
      );
    }
    // Çocuk top statüsü: ham parent → operatör hedefi (default üretime devam =
    // STOCK; sevke hazır = WAREHOUSE). Bitmiş parent → her zaman WAREHOUSE.
    const childStatus: RollStatus = isRawParent
      ? data.rawDestination === "WAREHOUSE"
        ? RollStatus.WAREHOUSE
        : RollStatus.STOCK
      : RollStatus.WAREHOUSE;
    // Aşım: operatör topu kayıtlıdan fazla ölçtü (tambur asıl ölçüm noktası).
    // Flag kapalıyken reddet (bugünkü davranış); açıkken kabul → parent top tamamen
    // tüketilir (aşağıda currentQty/initialQty=0).
    const exceedsRemaining = data.cutLength > Number(parent.currentQty);
    if (exceedsRemaining && !(await readTamburOverQuantityEnabled())) {
      throw AppError.badRequest(
        `Kesim metresi (${data.cutLength}) topun kalan metresinden (${parent.currentQty}) büyük olamaz`,
      );
    }

    const resolvedQualityGrade = data.qualityGrade ?? parent.qualityGrade;
    const resolvedQualityGradeId =
      data.qualityGrade && data.qualityGrade !== parent.qualityGrade
        ? await resolveQualityGradeIdStrict(data.qualityGrade)
        : parent.qualityGradeId;
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));
    // Barkod SUNUCU'da sıralı atanır (atomik sayaç). WAREHOUSE child → "F", raw→STOCK → "H".
    const childBarcode = await generateRollBarcode(prisma, childStatus === RollStatus.WAREHOUSE ? "F" : "H");
    // Etiket niyeti (pre-tx çözüm) — yalnız WAREHOUSE child anlamlı; raw→STOCK
    // (üretime devam) child stok etiketle doğar.
    // Niyeti BİR KEZ çöz, hem snapshot'a hem sorgulanabilir aynaya kullan —
    // iki kez çözülseydi araya giren bir müşteri pasifleştirmesi ikisini
    // ayrıştırabilirdi.
    const cutIntent =
      childStatus === RollStatus.WAREHOUSE
        ? await resolveLabelIntent(data)
        : { stock: true as const };
    const cutIntentSnapshot = buildIntentSnapshot(cutIntent);
    const cutLabelCustomerId = labelCustomerIdOf(cutIntent);

    let result: { child: Roll; newParentQty: number; updatedParent: Roll };
    try {
      result = await prisma.$transaction(async (tx) => {
      const child = await tx.roll.create({
        data: {
          barcode: childBarcode,
          clientToken: data.clientToken ?? null,
          itemId: parent.itemId,
          colorId: parent.colorId,
          width: parent.width,
          // KAT — kesim anında seçilen değer KAZANIR. Bu yolda iş emri/adım YOK
          // (depo topu kesimi), tek bağlam parent → fallback yalnız parent.
          foldType: foldType !== undefined ? foldType : (parent.foldType ?? null),
          initialQty: data.cutLength,
          currentQty: data.cutLength,
          weightKg: null,
          // Bitmiş re-cut → WAREHOUSE; ham kesim → operatör hedefi (STOCK/WAREHOUSE).
          status: childStatus,
          qualityGrade: resolvedQualityGrade,
          qualityGradeId: resolvedQualityGradeId,
          parentRollId: parent.id,
          // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
          batchId: parent.batchId,
          // GİRİŞ İSTASYONU — bu yolda ADIM YOK (depo topu kesimi) → oturum tek kaynak.
          // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
          // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
          entryStationId: resolveEntryStationId({ sessionStationId }),
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          createdById: userId ?? null,
          createdMachineId: sessionMachineId ?? null,
          // Kartelalık yalnız depoya (WAREHOUSE) inen çıktıda anlamlı; ham stoğa
          // dönen (üretime devam) parçada işaretlenmez.
          markedForKartela:
            (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
          // Etiket niyeti kesim anında kalıcı (yazıcı/ekran bağımsız).
          lastLabelSnapshot: cutIntentSnapshot,
          // Sorgulanabilir ayna — snapshot ile AYNI create'te (bkz. Roll.labelCustomerId).
          labelCustomerId: cutLabelCustomerId,
        },
      });

      if (propertySnapshot.length > 0) {
        await tx.rollProperty.createMany({
          data: propertySnapshot.map((p) => ({
            rollId: child.id,
            propertyId: p.propertyId,
            valueId: p.valueId,
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
        // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
        select: {
          workOrderStepId: true,
          operationType: true,
          operatorId: true,
          metadata: true,
          machineId: true,
        },
      });
      if (inheritedOps.length > 0) {
        await tx.rollOperation.createMany({
          data: inheritedOps.map((op) => ({
            rollId: child.id,
            workOrderStepId: op.workOrderStepId,
            operationType: op.operationType,
            operatorId: op.operatorId,
            machineId: op.machineId,
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
      // Aşımda (cutLength > currentQty) decrement negatife düşer → bunun yerine topu
      // tamamen tüket (currentQty/initialQty=0). gt:0 guard eşzamanlı çift-tüketimi engeller.
      // F128: guarded-decrement = atomik claim. WHERE'e status + shipmentId:null +
      // sackId:null eklenerek pre-tx (check-then-act) statü/rezervasyon/çuval kontrolü
      // tx içine alınır: eşzamanlı sevkiyat rezervasyonu (shipping updateMany {id,
      // shipmentId:null, status:WAREHOUSE}) ya da ÇUVALA OKUTMA (scanIntoSack
      // updateMany {id, sackId:null}) araya girerse WHERE eşleşmez → P2025 → 409.
      // `sackId: null` şart: çuvaldaki topun metrajını eksiltmek çuval içeriğini
      // sessizce bozar (2026-07-30 hayalet-içerik bulgusu).
      let updatedParent;
      try {
        updatedParent = exceedsRemaining
          ? await tx.roll.update({
              // ⚠️ `currentQty > 0` YOK — cutOpenFabric aşım dalıyla aynı gerekçe
              // (0'a inmiş topta ek kesim; 2026-08-12). Çuval/sevk guard'ları duruyor.
              where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null },
              data: { currentQty: 0, initialQty: 0 },
            })
          : await tx.roll.update({
              where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null, currentQty: { gte: data.cutLength } },
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
            "Top bu sırada değişti (statü değişmiş / çuvala okutulmuş / sevkiyata rezerve edilmiş / kalan metre yetersiz) — listeyi yenileyip tekrar deneyin"
          );
        }
        throw err;
      }
      const newParentQty = Number(updatedParent.currentQty);

      // AŞIM DEFTERİ — `cutOpenFabric` ikizi. Depo kesimi adıma bağlı DEĞİL.
      if (exceedsRemaining) {
        await recordVarianceTx(tx, {
          rollId: parent.id,
          workOrderStepId: null,
          kind: RollVarianceKind.OVERAGE,
          qty: overageOf(data.cutLength, parent.currentQty),
          source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
          userId,
        });
      }

      return { child, newParentQty, updatedParent };
      });
    } catch (err) {
      // Offline/ağ-retry idempotency: aynı clientToken ile 2. çağrı → clientToken @unique
      // P2002. tx geri sarıldığından İKİNCİ decrement UYGULANMAZ; ilk çağrının oluşturduğu
      // child + güncel parent idempotent döner (createInitialEntry deseni).
      if (
        data.clientToken &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.roll.findUnique({ where: { clientToken: data.clientToken } });
        const freshParent = await prisma.roll.findUnique({ where: { id: rollId } });
        if (existing && freshParent) {
          return {
            success: true,
            data: {
              childRoll: existing,
              parentRoll: freshParent,
              parentRemainingQty: Number(freshParent.currentQty),
            },
            message: "Kesim zaten kaydedilmiş (idempotent retry)",
          };
        }
      }
      throw err;
    }

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
      /// SAPMA SEBEBİ (2026-08-09) — `finalizeOpenFabric` ile aynı sözleşme.
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
    },
    userId?: string,
    /** Oturum istasyonu — KALAN parçanın giriş istasyonu damgası (cutWarehouseRoll ikizi). */
    sessionStationId?: string | null,
    /** Kesimin makinesi — kesilen parçayla AYNI damga (cutWarehouseRoll ikizi). */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>> {
    const parent = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        properties: { select: { propertyId: true, valueId: true } },
        // Çuval kodu — aşağıdaki çuval guard'ının mesajı için.
        sack: { select: { sackNo: true } },
      },
    });
    if (!parent) throw AppError.notFound("Top bulunamadı");
    if (parent.barcode === null) {
      throw AppError.badRequest("Bu Roll açık kumaş; finalizeWarehouseCut sadece barkodlu depo topu için");
    }
    // F132: Ağ-retry idempotency (finalizeOpenFabric kardeşi). Barkodlu bir top YALNIZ
    // bu yol ile TAMBUR_CONSUMED'a düşer → TAMBUR_CONSUMED = 'finalize zaten koştu' güvenli
    // sinyali. 2. çağrı 400 yerine success döner (kalan child zaten depoda; adımsız depo topu
    // durable RollOperation yazmadığından kalan child/qty replay'de yeniden türetilemez → null/0).
    if (parent.status === RollStatus.TAMBUR_CONSUMED) {
      return {
        success: true,
        data: { rollId: parent.id, remainingChild: null, remainingQty: 0 },
        message: "Top zaten kesim ile tamamlanmış (idempotent retry).",
      };
    }
    // Ham (renksiz STOCK) kesimi de bu fonksiyonla bitirilir — parent arşivlenir.
    const isRawParent =
      parent.status === RollStatus.STOCK && parent.colorId === null;
    if (parent.status !== RollStatus.WAREHOUSE && !isRawParent) {
      throw AppError.badRequest(`Top kesime uygun değil (${parent.status})`);
    }
    // Çuvala/sevkiyata rezerve top arşivlenemez (cutWarehouseRoll ile aynı kural).
    // ÇUVAL ÖNCE (2026-07-30): aşağıdaki mesaj zaten "çuvaldan çıkarın" diyordu ama
    // ÇUVALI HİÇ KONTROL ETMİYORDU — mesaj doğruydu, kontrol eksikti. DEPO çuvalında
    // `shipmentId` NULL olduğu için top TAMBUR_CONSUMED'a çekilip çuvalda kalıyordu:
    // kartela hatasının birebir ikizi (sevkte SHIPPED'e ezilir → çift tüketim).
    if (parent.sackId) {
      throw AppError.badRequest(
        sackBlockMessage(
          parent.barcode ?? parent.id,
          parent.sack?.sackNo ?? null,
          "Top Kesme işlemi bitirilemez",
        ),
      );
    }
    if (parent.shipmentId) {
      throw AppError.badRequest(
        "Top bir sevkiyata rezerve edilmiş — önce sevkiyattan çıkarın."
      );
    }

    const action = data.remainingAction ?? "discard";
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
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));

    // Koşulsuz resolve: wantChild kararı artık tx İÇİNDE taze metrajla veriliyor.
    // childQualityGrade nullable (ham parent + keep → parent.qualityGrade null olabilir).
    const childQualityGradeId = childQualityGrade
      ? await resolveQualityGradeId(childQualityGrade)
      : null;

    // Barkod tx AÇILMADAN ÖNCE rezerve edilir (F-CORE-VER-001): tx içinde
    // alınırsa sayaç kilidi kalan 108 satır + 4 yazma + 2 tx-helper boyunca
    // tutulur ve sahadaki tüm KK1 girişleri o satırda kuyruğa girer.
    // ⚠️ `wantChild` tx İÇİNDEKİ taze metrajdan çözülüyor, yani burada henüz
    // kesin değil. `action === "discard"` tarafı kesin (payload'dan) → o durumda
    // sayaca hiç dokunulmaz. Kalan belirsizlik yalnız "taze metraj 0 çıkarsa"
    // hâlidir ve bedeli TEK numaralık boşluktur; barkod bir KİMLİKTİR, sayaç
    // değil (helper'ın sözleşmesi). Ters tercih — kesinliği beklemek — kilidi
    // tam da kaçınılan yere, tx'in içine geri koyardı.
    //
    // ⚠️ BİLİNÇLİ DAVRANIŞ DEĞİŞİKLİĞİ — REPLAY ARTIK BİR NUMARA YAKIYOR.
    // Bu yolun idempotency'si `finalize`ınkinden FARKLI: orada tx'ten ÖNCE bir
    // kapı var (`status === TAMBUR_CONSUMED` → erken dön), burada mekanizma
    // tx'in İÇİNDE `clientToken @unique` → P2002 → rollback → catch'te idempotent
    // yanıt. Eskiden barkod da tx içinde alındığı için o rollback sayaç artışını
    // da geri sarıyordu (boşluk yoktu); artık rezervasyon tx'ten önce commit
    // ettiği için aynı token'la gelen her tekrar TEK numara boşluğu bırakır.
    // Kabul edildi: `stationRetry` denemeleri sınırlı (4), kapasite 9.999/gün/tip
    // ve barkod bir kimliktir. Rahatsız ederse doğru çözüm rezervasyonu tx'e geri
    // koymak DEĞİL, buraya `finalize`daki gibi tx-öncesi bir clientToken kapısı
    // eklemektir — o, replay'de koca bir transaction'ı da kurtarır.
    const reservedChildBarcode =
      action === "discard"
        ? null
        : (await reserveRollBarcodesInOrder(prisma, [
            childStatus === RollStatus.WAREHOUSE ? "F" : "H",
          ]))[0]!;

    const result = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (finalize()'daki desen): tüm ön-kontroller tx DIŞINDA —
      // eşzamanlı çift çağrı ikisinde de geçer ve kalan child İKİ kez basılırdı
      // (uuid barkodlar çakışmaz, P2002 dedup yok). Statü+shipmentId+sackId koşulu
      // ile kaybeden 409 alır; ardışık çift çağrıyı zaten pre-check 400'lüyor.
      // `sackId: null` = pre-check'in tx-içi ikizi: araya giren `scanIntoSack` topu
      // çuvala alırsa WHERE eşleşmez ve top TAMBUR_CONSUMED olarak çuvalda KALMAZ.
      const claim = await tx.roll.updateMany({
        where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null },
        data: { status: RollStatus.TAMBUR_CONSUMED },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işlemle değişmiş (eşzamanlı kesim/çift dokunuş/çuvala okutma olabilir). Listeyi yenileyip tekrar deneyin."
        );
      }

      // TAZE KALAN METRAJ: pre-tx okuma ile claim arasına bir kesim commit'i
      // girmiş olabilir — kalan child bayat (kesim öncesi) metrajla doğmasın.
      // Claim satır kilidini aldı; bu değer artık değişemez.
      const freshRow = await tx.roll.findUnique({
        where: { id: parent.id },
        select: { currentQty: true },
      });
      const remainingQty = Number(freshRow?.currentQty ?? 0);
      const wantChild = remainingQty > 0 && action !== "discard";

      let remainingChild: Roll | null = null;

      if (wantChild) {
        // `action !== "discard"` olduğu için rezervasyon yapılmış olmak zorunda.
        const childBarcode = reservedChildBarcode!;
        const child = await tx.roll.create({
          data: {
            barcode: childBarcode,
            itemId: parent.itemId,
            colorId: parent.colorId,
            width: parent.width,
            // KAT — bu "kalan" parçadır, aynı sarımın devamı: parent'ın katını
            // DEVRALIR (kesilen parça yeni değer alabilir, kalan almaz).
            foldType: parent.foldType,
            initialQty: remainingQty,
            currentQty: remainingQty,
            weightKg: null,
            // Ham parent → kalan ham STOCK/SCRAP; bitmiş parent → WAREHOUSE.
            status: childStatus,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            parentRollId: parent.id,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
            batchId: parent.batchId,
            // GİRİŞ İSTASYONU — kesilen parçayla AYNI kaynak — ikisi aynı kesimin ürünü.
            // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
            // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
            entryStationId: resolveEntryStationId({ sessionStationId }),
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            createdById: userId ?? null,
            createdMachineId: sessionMachineId ?? null,
            // Kalan (leftover) parça — müşteri niyeti yok → stok etiketi.
            lastLabelSnapshot: { stock: true },
            },
        });
        if (propertySnapshot.length > 0) {
          await tx.rollProperty.createMany({
            data: propertySnapshot.map((p) => ({
              rollId: child.id,
              propertyId: p.propertyId,
              valueId: p.valueId,
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
          // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
          select: {
            workOrderStepId: true,
            operationType: true,
            operatorId: true,
            metadata: true,
            machineId: true,
          },
        });
        if (inheritedOps.length > 0) {
          await tx.rollOperation.createMany({
            data: inheritedOps.map((op) => ({
              rollId: child.id,
              workOrderStepId: op.workOrderStepId,
              operationType: op.operationType,
              operatorId: op.operatorId,
              machineId: op.machineId,
              metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
              inheritedFromParentRollId: parent.id,
            })),
          });
        }
        remainingChild = child as Roll;
      }

      // L (düşük bulgu): depo kesiminde de parent'ın açık hataları NO_CUT ile
      // kapansın — finalize/finalizeOpenFabric ile aynı hijyen, yoksa tüketilmiş
      // topta sonsuza dek "açık hata" kalıyordu. Depo topu adımsız → stepId null.
      await closeOrphanRollErrors(tx, parent.id, null, userId);

      // Parent retire — statüyü claim çevirdi; metrajı sıfırla.
      // KAPANIŞ ÖNCESİ HÂL kaydedilir (2026-08-09): geri alma bunları TÜRETMEYE
      // çalışmasın. `parent.status` claim'in eşleştirdiği değerdir (WHERE koşulu
      // onu doğruladı), `remainingQty` de claim kilidi altında okundu.
      await tx.roll.update({
        where: { id: parent.id },
        data: {
          currentQty: 0,
          preTamburCloseQty: new Prisma.Decimal(remainingQty),
          preTamburCloseStatus: parent.status,
        },
      });

      // SAPMA DEFTERİ — depo kesimi kapanışının kalan metraj kararı.
      const varianceKind = varianceKindForRemainingAction(action);
      if (varianceKind) {
        await recordVarianceTx(tx, {
          rollId: parent.id,
          // Depo kesimi hiçbir iş emri adımına bağlı DEĞİL — uydurma step yazma.
          workOrderStepId: null,
          kind: varianceKind,
          qty: remainingQty,
          source: VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE,
          reasonCode: data.varianceReasonCode ?? null,
          reasonText: data.varianceReasonText ?? null,
          userId,
        });
      }

      return { remainingChild, remainingQty };
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
        remainingQty: result.remainingQty,
        notes: data.notes ?? null,
      },
    });

    return {
      success: true,
      data: {
        rollId: parent.id,
        remainingChild: result.remainingChild,
        remainingQty: result.remainingQty,
      },
      message: result.remainingChild
        ? `Top Kesme bitti: ${parent.barcode} arşivlendi · kalan ${result.remainingQty}m ${childQualityGrade} olarak kayıtlı`
        : `Top Kesme bitti: ${parent.barcode} arşivlendi${result.remainingQty > 0 ? ` · ${result.remainingQty}m fire` : ""}`,
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
      /** Etiket niyeti — açık kumaş child her zaman WAREHOUSE → lastLabelSnapshot.
       *  İkisi de boş = stok (müşterisiz). */
      targetOrderLineId?: string | null;
      targetCustomerId?: string | null;
      /**
       * Bu kesimde doğan ÇOCUĞUN katı (kalıcı özellik, 2026-08-04).
       * Verilmezse parent → iş emri planı sırasıyla fallback uygulanır — bu
       * MİRAS değil, alanı göndermeyen eski istemciler için geri-uyumluluktur.
       */
      foldType?: string | null;
      /** Offline/ağ-retry idempotency anahtarı (UUID) — cutWarehouseRoll ile aynı. */
      clientToken?: string;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer. */
      confirmMismatch?: boolean;
    },
    userId?: string,
    /** Kesimin makinesi — "Bu makine" süzgeci + makine raporları (2026-08-12). */
    sessionMachineId?: string | null,
  ): Promise<ApiResponse<{ childRoll: Roll; parentRemainingQty: number }>> {
    if (!(data.lengthMeters > 0)) {
      throw AppError.badRequest("Kesim metresi pozitif olmalı");
    }

    // Kat katalog doğrulaması — `undefined` korunur (parent → WO fallback zinciri).
    const foldType = await resolveFoldTypeForWrite(data.foldType);

    const parent = await prisma.roll.findUnique({
      where: { id: openFabricRollId },
      include: {
        currentStep: {
          include: {
            station: { select: { kind: true } },
            // WO.foldType = PLANLAMA değeri; istemci ve parent susarsa son fallback.
            // id/targetColorId/width: plan-gerçek sapma kapısı için (aynı select).
            workOrder: { select: { id: true, status: true, foldType: true, targetColorId: true, width: true } },
          },
        },
        properties: { select: { propertyId: true, valueId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Roll bulunamadı");
    // Barkod-reddi KALDIRILDI (2026-07-16): Tambur adımındaki HER top kesilebilir —
    // barkodsuz açık kumaş VE Konumu-Düzelt ile buraya gelmiş barkodlu TOP. Barkod artık
    // dispatch anahtarı değil, yalnız çocuk-etiketleme semantiği (çocuk hep taze "F" barkod).
    // Ayrım kriteri form/barkod değil, KONUM (canlı Tambur step + IN_PRODUCTION). Barkodlu top
    // eskiden iki kesim metodunun arasındaki delikte kalıp kesilemiyordu (ölü rulo).
    if (!parent.currentStep || parent.currentStep.station.kind !== StationKind.TAMBUR) {
      throw AppError.badRequest(
        `Roll Tambur step'inde değil (${parent.currentStep?.station.kind ?? "STEPSIZ"})`,
      );
    }
    // Savunma katmanı (BUG-2): iptal edilmiş iş emrinin Tambur adımına eşzamanlı yarışla
    // sıkışmış açık kumaş kesilmesin — ölü WO'ya çocuk top + bozuk üretim muhasebesi olmaz.
    if (
      parent.currentStep.workOrder?.status === WorkOrderStatus.CANCELLED ||
      parent.currentStep.workOrder?.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict("İptal/devredilmiş iş emrinin açık kumaşı kesilemez");
    }
    if (parent.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.badRequest(
        `Açık kumaş aktif değil (${parent.status})`,
      );
    }
    // PLAN-GERÇEK SAPMA KAPISI: per-cut modelde çocuk KESİM ANINDA depoya iner —
    // kapı bitirmeyi bekleyemez. Operatör topta BİR KEZ onaylar; istemci aynı
    // topun sonraki kesimlerine bayrağı kendisi taşır (tek soru / top).
    await assertRollMatchesPlan(
      { id: parent.id, barcode: parent.barcode, colorId: parent.colorId, width: parent.width },
      {
        workOrderId: parent.currentStep.workOrder?.id ?? null,
        targetColorId: parent.currentStep.workOrder?.targetColorId ?? null,
        width: parent.currentStep.workOrder?.width ?? null,
      },
      data.confirmMismatch,
      userId,
      "cut",
    );
    // Aşım: operatör açık kumaşı kayıtlıdan fazla ölçtü (tambur asıl ölçüm noktası).
    // Flag kapalıyken reddet (bugünkü davranış); açıkken kabul → açık kumaşın tamamı
    // tek topa dönüşür, parent tamamen tüketilir (aşağıda currentQty=0).
    const exceedsRemaining = data.lengthMeters > Number(parent.currentQty);
    if (exceedsRemaining && !(await readTamburOverQuantityEnabled())) {
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
    const woId = parent.currentStep.workOrderId;
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));
    // Açık kumaş child her zaman WAREHOUSE → "F" (final). Barkod sunucudan (atomik sayaç).
    const childBarcode = await generateRollBarcode(prisma, "F");
    // Etiket niyeti (pre-tx çözüm) — açık kumaş child her zaman WAREHOUSE.
    const cutIntent = await resolveLabelIntent(data);
    const cutIntentSnapshot = buildIntentSnapshot(cutIntent);
    const cutLabelCustomerId = labelCustomerIdOf(cutIntent);

    // Operatör explicit kod verdiyse SIKI doğrula (katalog+aktif); sistem-türetimli
    // ("1.KALITE"/"A1"/"FIRE" sabitleri) lenient kalır.
    const resolvedQualityGradeId = data.qualityGrade
      ? await resolveQualityGradeIdStrict(resolvedQualityGrade)
      : await resolveQualityGradeId(resolvedQualityGrade);

    let result: { child: Roll; newParentQty: number };
    try {
      result = await prisma.$transaction(async (tx) => {
      // F130: WO satırını kilitle → eşzamanlı WO iptaliyle (softDelete cancelClaim
      // aynı WO satırını kilitler) serileş; iptal-guard'ını kilit ALTINDA TAZE oku
      // (pre-tx 2169 guard'ının atomik hali). Lock sırası WO→roll (kardeşlerle tutarlı).
      await touchWorkOrderTx(tx, woId);
      const freshWo = await tx.workOrder.findUnique({
        where: { id: woId },
        select: { status: true },
      });
      if (
        freshWo?.status === WorkOrderStatus.CANCELLED ||
        freshWo?.status === WorkOrderStatus.SUPERSEDED
      ) {
        throw AppError.conflict("İptal/devredilmiş iş emrinin açık kumaşı kesilemez");
      }
      // Child Roll oluştur
      const child = await tx.roll.create({
        data: {
          barcode: childBarcode,
          clientToken: data.clientToken ?? null,
          itemId: parent.itemId,
          colorId: parent.colorId,
          width: parent.width,
          // KAT — kesim anında seçilen değer KAZANIR (kullanıcı kararı: "top
          // kesilerek yeni bir kat değeri kazanabilir"). `undefined` = istemci
          // alanı hiç GÖNDERMEDİ → parent, o da yoksa iş emri planı (eski APK
          // geri-uyumluluğu; MİRAS DEĞİL). `null` = istemci açıkça "kat yok" dedi.
          foldType:
            foldType !== undefined
              ? foldType
              : (parent.foldType ?? parent.currentStep?.workOrder?.foldType ?? null),
          initialQty: data.lengthMeters,
          currentQty: data.lengthMeters,
          weightKg: null,
          status: childStatus,
          qualityGrade: resolvedQualityGrade,
          qualityGradeId: resolvedQualityGradeId,
          producedInStepId: tamburStepId,
          parentRollId: parent.id,
          // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
          batchId: parent.batchId,
          // GİRİŞ İSTASYONU — kesim hangi Tambur adımındaysa çocuk orada doğdu.
          // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
          // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
          entryStationId: resolveEntryStationId({ stepStationId: parent.currentStep?.stationId }),
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          createdById: userId ?? null,
          createdMachineId: sessionMachineId ?? null,
          // Sadece depoya giden (WAREHOUSE) çıktı kartelalık işaretlenir.
          markedForKartela:
            (data.markedForKartela ?? false) && childStatus === RollStatus.WAREHOUSE,
          // Etiket niyeti kesim anında kalıcı (yazıcı/ekran bağımsız).
          lastLabelSnapshot: cutIntentSnapshot,
          // Sorgulanabilir ayna — snapshot ile AYNI create'te (bkz. Roll.labelCustomerId).
          labelCustomerId: cutLabelCustomerId,
          // currentStepId: child Tambur'dan çıktı (depo değil bir step) — null.
        },
      });

      if (propertySnapshot.length > 0) {
        await tx.rollProperty.createMany({
          data: propertySnapshot.map((p) => ({
            rollId: child.id,
            propertyId: p.propertyId,
            valueId: p.valueId,
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
        // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
        select: {
          workOrderStepId: true,
          operationType: true,
          operatorId: true,
          metadata: true,
          machineId: true,
        },
      });
      if (inheritedOps.length > 0) {
        await tx.rollOperation.createMany({
          data: inheritedOps.map((op) => ({
            rollId: child.id,
            workOrderStepId: op.workOrderStepId,
            operationType: op.operationType,
            operatorId: op.operatorId,
            machineId: op.machineId,
            metadata: (op.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            inheritedFromParentRollId: parent.id,
          })),
        });
      }

      // Parent atomic decrement — hesap DB-side, gte guard concurrent overdraw'a karşı.
      // Aşımda (lengthMeters > currentQty) decrement negatife düşer → bunun yerine açık
      // kumaşı tamamen tüket (currentQty=0). gt:0 guard eşzamanlı çift-tüketimi engeller.
      let updatedParent;
      try {
        // F130: guarded-decrement = atomik claim. status + currentStepId eklendi:
        // eşzamanlı KK2 reopen (currentStepId'yi KK2 step'e çeker) araya girerse
        // WHERE eşleşmez → P2025 → 409 (KK2'ye geri çekilmiş top kesilmez).
        updatedParent = exceedsRemaining
          ? await tx.roll.update({
              // ⚠️ AŞIM DALINDA `currentQty > 0` ŞARTI YOK (2026-08-12 saha
              // vakası): 500 m kayıtlı kumaş fiziksel 550 m çıkabilir ve fazlalık
              // TEK kesimde bitmeyebilir (50 m'den 3 top). İlk aşım kesimi kalanı
              // 0'a çeker; guard `gt: 0` olarak kalsaydı 0'daki topta İKİNCİ kesim
              // P2025'e düşüp "bu sırada değişti" yarış mesajını basıyordu —
              // oysa yarış yok, mal fiziksel olarak elde. Çifte-harcama koruması
              // burada ANLAMSIZ: 0'ın altına inilecek gerçek stok kalmadı; her
              // aşım kesimi çocuk + sapma satırı üretir (aşağıdaki defter), yani
              // iz kaybolmaz. KK2 reopen/statü guard'ları AYNEN duruyor.
              where: { id: parent.id, status: RollStatus.IN_PRODUCTION, currentStepId: tamburStepId },
              data: { currentQty: 0 },
            })
          : await tx.roll.update({
              where: { id: parent.id, status: RollStatus.IN_PRODUCTION, currentStepId: tamburStepId, currentQty: { gte: data.lengthMeters } },
              data: { currentQty: { decrement: data.lengthMeters } },
            });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          throw AppError.conflict(
            "Açık kumaş bu sırada değişti (KK2'ye geri çekilmiş / statü değişmiş / kalan metre yetersiz) — listeyi yenileyip tekrar deneyin"
          );
        }
        throw err;
      }
      const newParentQty = Number(updatedParent.currentQty);

      // AŞIM DEFTERİ (2026-08-09) — sapmanın ARTI yönü. 2026-08-09 öncesinde
      // hiçbir yere yazılmıyordu: bayrak aşımı kabul ediyor, parent tamamen
      // tüketiliyor ve "N m fazla çıktı" bilgisi buharlaşıyordu. Sonuç: rapor
      // yalnız eksi yönü görüyordu ("giriş 100, çıkış 140" açıklamasız kalıyordu).
      // Sebep SORULMAZ — aşımı sistem tespit eder, operatör beyan etmez.
      if (exceedsRemaining) {
        await recordVarianceTx(tx, {
          rollId: parent.id,
          workOrderStepId: tamburStepId,
          kind: RollVarianceKind.OVERAGE,
          qty: overageOf(data.lengthMeters, parent.currentQty),
          source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
          userId,
        });
      }

      return { child, newParentQty };
      });
    } catch (err) {
      // Offline/ağ-retry idempotency (cutWarehouseRoll ile aynı): aynı clientToken ile
      // 2. çağrı → clientToken @unique P2002, tx geri sarılır (ikinci decrement YOK) →
      // mevcut child + güncel parent metresi idempotent döner.
      if (
        data.clientToken &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.roll.findUnique({ where: { clientToken: data.clientToken } });
        const freshParent = await prisma.roll.findUnique({ where: { id: openFabricRollId } });
        if (existing && freshParent) {
          return {
            success: true,
            data: { childRoll: existing, parentRemainingQty: Number(freshParent.currentQty) },
            message: "Kesim zaten kaydedilmiş (idempotent retry)",
          };
        }
      }
      throw err;
    }

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
      /// SAPMA SEBEBİ (2026-08-09) — yalnız `scrap` / `discard` aksiyonlarında
      /// anlamlı. Gönderilmezse satır `BELIRTILMEDI` ile yazılır (eski istemci);
      /// bkz. `constants/variance-reasons.LEGACY_REASON_CODE`.
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
      /** Plan-gerçek sapma onayı (renk/en) — 409 PLAN_MISMATCH'i geçer. */
      confirmMismatch?: boolean;
    },
    userId?: string,
    /** TAMBUR makine atfı — aktif çalışma oturumundan (controller çözer). */
    machineId?: string | null,
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
        properties: { select: { propertyId: true, valueId: true } },
      },
    });
    if (!parent) throw AppError.notFound("Roll bulunamadı");
    // Barkod-reddi KALDIRILDI (2026-07-16): Tambur adımındaki barkodlu top da finalize
    // edilebilir (bkz. cutOpenFabric aynı gerekçe). Idempotency status=TAMBUR_CONSUMED'a
    // bakar (barkoda değil), child taze "F" barkod alır → barkodlu parent'ta da güvenli.

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
    // Savunma katmanı (cutOpenFabric BUG-2 paritesi): iptal/devredilmiş iş emrinin
    // adımında sıkışmış açık kumaş finalize edilemez. Taze hali kilit altında okunur.
    if (
      parent.currentStep.workOrder.status === WorkOrderStatus.CANCELLED ||
      parent.currentStep.workOrder.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict("İptal/devredilmiş iş emrinin açık kumaşı finalize edilemez");
    }
    // PLAN-GERÇEK SAPMA KAPISI — yalnız kalan kuyruk DEPOYA inerken (keep_*).
    // scrap/discard kapı dışı: fire satılabilir stok üretmez, sormak gürültü.
    {
      // Aşağıdaki gerçek türetmeyle (3100) BİREBİR aynı: varsayılan "discard".
      const act = data.remainingAction ?? (data.scrapRemaining === true ? "scrap" : "discard");
      if ((act === "keep_1kalite" || act === "keep_a1") && Number(parent.currentQty) > 0) {
        await assertRollMatchesPlan(
          { id: parent.id, barcode: parent.barcode, colorId: parent.colorId, width: parent.width },
          {
            workOrderId: parent.currentStep.workOrder.id,
            targetColorId: parent.currentStep.workOrder.targetColorId,
            width: parent.currentStep.workOrder.width,
          },
          data.confirmMismatch,
          userId,
          "finalize-open-fabric",
        );
      }
    }

    // remainingAction varsa onu kullan; yoksa eski scrapRemaining'den türet.
    const action: "keep_1kalite" | "keep_a1" | "scrap" | "discard" =
      data.remainingAction ?? (data.scrapRemaining === true ? "scrap" : "discard");
    const childQualityGrade: string =
      action === "keep_1kalite" ? "1.KALITE" : action === "keep_a1" ? "A1" : "FIRE";
    const tamburStepId = parent.currentStep.id;
    const woId = parent.currentStep.workOrderId;
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));

    // Planlanan foldType WO'dan — operatör override etmemişse bu kullanılır.
    // Override + planlanan ikisini de metadata'ya yaz ki sapma izlenebilsin.
    // Kat katalog doğrulaması: `undefined` korunur, override dalı ona bakıyor.
    const foldType = await resolveFoldTypeForWrite(data.foldType);
    const plannedFoldType = parent.currentStep.workOrder.foldType ?? null;
    const actualFoldType = foldType !== undefined ? foldType : plannedFoldType;
    const overriddenFoldType =
      foldType !== undefined && foldType !== plannedFoldType;

    // Koşulsuz resolve: wantChild kararı artık tx İÇİNDE taze metrajla veriliyor.
    const childQualityGradeId = await resolveQualityGradeId(childQualityGrade);

    // Barkod tx AÇILMADAN ÖNCE (F-CORE-VER-001) — burası kilidi finalize'dan
    // sonra en uzun tutan ikinci yoldu (146 satır + 5 yazma + 4 tx-helper).
    // Koşulsuzluk gerekçesi, replay'de tek-numaralık boşluk kabulü ve "rahatsız
    // ederse çözüm nedir" notu için `cutWarehouseRoll` içindeki aynı desenin
    // açıklamasına bak (idempotency mekanizması burada da P2002 tabanlı).
    // Tip her zaman "F" (hepsi depoya iner).
    const reservedChildBarcode =
      action === "discard" ? null : (await reserveRollBarcodesInOrder(prisma, ["F"]))[0]!;

    const result = await prisma.$transaction(async (tx) => {
      // O-2 write-skew guard: WO satırını kilitle → son-top tamamlama sayımı
      // (~2620) eşzamanlı finalize/finalizeOpenFabric/receive/cancel/directShip ile
      // serileşsin (yoksa iki tx birbirinin adımını açık sayıp WO IN_PROGRESS'te takılır).
      await touchWorkOrderTx(tx, woId);
      // F130 paritesi: iptal-guard'ını kilit ALTINDA taze oku (pre-tx guard ile
      // claim arasında WO iptal edilmiş olabilir).
      const freshWo = await tx.workOrder.findUnique({
        where: { id: woId },
        select: { status: true },
      });
      if (
        freshWo?.status === WorkOrderStatus.CANCELLED ||
        freshWo?.status === WorkOrderStatus.SUPERSEDED
      ) {
        throw AppError.conflict("İptal/devredilmiş iş emrinin açık kumaşı finalize edilemez");
      }
      // ATOMİK CLAIM (finalize()'daki desen): idempotency ön-kontrolü tx DIŞINDA
      // check-then-act — eşzamanlı çift çağrı ikisinde de geçer ve kalan child
      // İKİ kez basılırdı (TAMBUR_PROCESSED upsert'i ikinci tx'i düşürmez:
      // update:{} dalına düşer, child create upsert'ten önce). Kaybeden 409 alır;
      // istemci retry'ı idempotent ön-kontrole düşer.
      const claim = await tx.roll.updateMany({
        where: {
          id: parent.id,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: tamburStepId,
        },
        data: { status: RollStatus.TAMBUR_CONSUMED },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Açık kumaş bu sırada başka bir işlemle değişmiş (eşzamanlı finalize/kesim olabilir). Listeyi yenileyip tekrar deneyin."
        );
      }

      // TAZE KALAN METRAJ: okuma ile claim arasına bir cutOpenFabric commit'i
      // girmiş olabilir — kalan child bayat (kesim öncesi) metrajla doğmasın.
      const freshRow = await tx.roll.findUnique({
        where: { id: parent.id },
        select: { currentQty: true },
      });
      const remainingQty = Number(freshRow?.currentQty ?? 0);
      const wantChild = remainingQty > 0 && action !== "discard";

      let remainingChildId: string | null = null;

      // Kalan metre için child Roll oluştur (action != discard ve kalan > 0).
      // Kalite operatörün seçimine göre: 1.KALITE / A1 / FIRE. Hepsi WAREHOUSE'a iner.
      if (wantChild) {
        // `action !== "discard"` olduğu için rezervasyon yapılmış olmak zorunda.
        const childBarcode = reservedChildBarcode!; // hepsi depoya → final
        const child = await tx.roll.create({
          data: {
            barcode: childBarcode,
            itemId: parent.itemId,
            colorId: parent.colorId,
            width: parent.width,
            // KAT — `actualFoldType` bu fonksiyonda zaten hesaplı (operatör
            // kararı, yoksa WO planı); eskiden YALNIZ RollOperation.metadata'ya
            // yazılıyordu, artık topun kendi kolonuna da yazılır.
            foldType: actualFoldType,
            initialQty: remainingQty,
            currentQty: remainingQty,
            weightKg: null,
            status: RollStatus.WAREHOUSE,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            producedInStepId: tamburStepId,
            parentRollId: parent.id,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
            batchId: parent.batchId,
            // GİRİŞ İSTASYONU — kalan parça da aynı kesimin ürünü.
            // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
            // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
            entryStationId: resolveEntryStationId({ stepStationId: parent.currentStep?.stationId }),
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            createdById: userId ?? null,
            createdMachineId: machineId ?? null,
            // Kalan (leftover) parça — müşteri niyeti yok → stok etiketi.
            lastLabelSnapshot: { stock: true },
            },
        });
        if (propertySnapshot.length > 0) {
          await tx.rollProperty.createMany({
            data: propertySnapshot.map((p) => ({
              rollId: child.id,
              propertyId: p.propertyId,
              valueId: p.valueId,
            })),
            skipDuplicates: true,
          });
        }
        remainingChildId = child.id;
      }

      // #8 — parent tüketilmeden kalan açık hatalar NO_CUT olarak kapansın.
      await closeOrphanRollErrors(tx, parent.id, tamburStepId, userId);

      // Parent CONSUMED_AT_TAMBUR — statüyü claim çevirdi; metraj+adım temizle.
      // KAPANIŞ ÖNCESİ METRAJ kaydedilir (2026-08-09): `applyFull` bunu eskiden
      // çocukların toplamından TÜRETİYORDU ve aşımlı kesimde `currentQty >
      // initialQty` üretiyordu (saha vakası IE0808260001 — 520,5 / 500).
      // Statü kaydedilmez: üretim akışında kapanış öncesi her zaman IN_PRODUCTION
      // (yukarıdaki claim onu WHERE koşuluyla doğruladı).
      await tx.roll.update({
        where: { id: parent.id },
        data: {
          currentQty: 0,
          currentStepId: null,
          preTamburCloseQty: new Prisma.Decimal(remainingQty),
        },
      });

      // Tambur movement'ı kapat. qtyOut = movement'ın KENDİ qtyIn'i (finalize()
      // ile aynı kural — istasyona giren işlenmiş metraj): initialQty artık
      // güvenilir değil (cutWarehouseRoll parent initialQty'yi resetler).
      const movementNote =
        wantChild && remainingChildId
          ? `TAMBUR_FINALIZED:REMAINING_${remainingQty}_${childQualityGrade}`
          : "TAMBUR_FINALIZED";
      const openMove = await tx.rollMovement.findFirst({
        where: { rollId: parent.id, workOrderStepId: tamburStepId, exitedAt: null },
        select: { qtyIn: true },
      });
      const qtyOutD =
        openMove && new Prisma.Decimal(openMove.qtyIn).greaterThan(0)
          ? new Prisma.Decimal(openMove.qtyIn)
          : new Prisma.Decimal(parent.initialQty);
      await tx.rollMovement.updateMany({
        where: {
          rollId: parent.id,
          workOrderStepId: tamburStepId,
          exitedAt: null,
        },
        data: {
          qtyOut: qtyOutD,
          exitedAt: new Date(),
          notes: movementNote,
          // İşin YAPILDIĞI makine kapanışta damgalanır (oturumdan).
          ...(machineId ? { machineId } : {}),
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
          machineId: machineId ?? null,
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

      // SAPMA DEFTERİ (2026-08-09) — kalan metrajın kaderi sorgulanabilir hale gelir.
      // `keep_*` sapma DEĞİLDİR (kalan gerçek bir top olarak stoğa girer); yalnız
      // `scrap` (mal vardı, çöpe gitti) ve `discard` (mal hiç yoktu) yazılır.
      const varianceKind = varianceKindForRemainingAction(action);
      if (varianceKind) {
        await recordVarianceTx(tx, {
          rollId: parent.id,
          workOrderStepId: tamburStepId,
          kind: varianceKind,
          qty: remainingQty,
          source: VARIANCE_SOURCES.TAMBUR_FINALIZE,
          reasonCode: data.varianceReasonCode ?? null,
          reasonText: data.varianceReasonText ?? null,
          userId,
        });
      }

      await recomputeStepStatus(tx, tamburStepId);

      // WO completion check — Tambur production'ın son istasyonu (paketleme/sevk
      // fulfillment, WO step değil). Terminal-durum guard'lı ORTAK helper:
      // CANCELLED/SUPERSEDED buradan COMPLETED'a dirilmez.
      await completeWorkOrderIfStepsDone(tx, woId);

      return { remainingChildId, remainingQty, wantChild };
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
        remainingChildQuality: result.wantChild ? childQualityGrade : null,
        remainingQty: result.remainingQty,
        notes: data.notes ?? null,
      },
    });

    const message = result.wantChild
      ? `Açık kumaş finalize: kalan ${result.remainingQty} mt ${childQualityGrade} kalitede top olarak kaydedildi.`
      : action === "discard" && result.remainingQty > 0
        ? `Açık kumaş finalize: kalan ${result.remainingQty} mt kayıt dışı (operatör attı).`
        : "Açık kumaş finalize edildi.";

    return {
      success: true,
      data: {
        rollId: parent.id,
        remainingChildId: result.remainingChildId,
        remainingQty: result.remainingQty,
      },
      message,
    };
  }

  /**
   * Tambur ekran context — refakat kartı barkoduyla:
   *   - WO bilgisi
   *   - WO'ya bağlı orderlar + her order için shippedQty / orderedQty progress
   *   - Tambur step'indeki açık kumaş Roll'ları LIFO sıralı + RollError'lar
   *   - KURŞUN BYPASS: iş emri Kurşun Dağıtım'a verilmişse `bypassPending`
   *     (önizleme + onay verisi) — bkz. aşağıdaki blok.
   */
  async getTamburContext(
    cardBarcode: string,
    /**
     * `allowEmptyStep`: Tambur adımında açık top olmasa da kartı AÇ (boş bağlam).
     * Yalnız saha düzeltmesi yetkisi olan operatör için controller true geçer —
     * "Topu Buraya Al / Manuel Top Ekle" gerektiği anda ulaşılabilir olsun diye.
     * Yetkisiz operatörde false → davranış eskisi gibi (hata).
     */
    opts?: { allowEmptyStep?: boolean },
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
          /// Sipariş satırı kesim notu + eşit-parça önerisi (Tambur talimatı).
          cutNote: string | null;
          pieceLengthM: number | null;
        }>;
      }>;
      openFabricRolls: Array<{
        rollId: string;
        /** Barkodlu top adıma alınmışsa dolu (2026-07-27); açık kumaşta null. */
        barcode: string | null;
        currentQty: number;
        initialQty: number;
        receiptNo: string | null;
        colorCode: string | null;
        colorName: string | null;
        kursunFinishedAt: string | null;
        errors: TamburRollErrorSummary[];
      }>;
      /**
       * Bu iş emrinde bekleyen KURŞUN DAĞITIM (bypass) işi. Non-null ise Tambur
       * ekranı "Kurşun adımını tamamla" önizlemesi + onayı gösterir ve
       * `POST /api/tambur/bypass-complete` ile kapatır. null = normal akış.
       *
       * Payload `kursun-bypass.service.findPendingForTambur`'un dönüşüdür ve
       * OLDUĞU GİBİ iletilir (burada yeniden şekillendirme YOK — alan eklemek
       * gerekirse tek kaynak orasıdır). Operatöre gösterilecek yer bilgisi
       * `machineName`'dir (atanan fiziksel kurşun makinesi); `stationName` tek
       * PROCESS_QC istasyonunun adıdır ve bağlam olarak taşınır — ekranda
       * "hangi makinede yapıldı" sorusunu YANITLAMAZ.
       */
      bypassPending?: KursunBypassTamburContext | null;
      /**
       * Adımda AÇIK TOP YOK ama kart yetkili operatör için yine de açıldı.
       * Ekran bunu görünce "bekleyen top yok" bandı basıp yalnız saha
       * düzeltmesini sunar (kesim/finalize aksiyonları anlamsızdır).
       */
      emptyStep?: boolean;
    }>
  > {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: normalizeScanCode(cardBarcode) },
      // Kart iş emri başına — doğrudan workOrderId.
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
    }

    // ── KURŞUN BYPASS ────────────────────────────────────────────────────────
    // Kurşun Dağıtım'a verilmiş bir iş emrinde toplar HENÜZ kurşun adımında açık
    // durur (Tambur adımında hiç movement yoktur) → `assertWoAtStepKind` "bu
    // adımda açık top yok" diye 400 atardı ve operatör kartı okutamazdı. Bekleyen
    // dağıtım varsa Tambur adımını doğrudan çözer, önizleme+onay verisini
    // `bypassPending` ile ekrana iletiriz.
    //
    // Dağıtım BAŞARILI assert'te de iliştirilir: çok partili senaryoda 1. parti
    // Tambur'da işlenirken 2. parti kurşunda bekliyor olabilir (ekran hem açık
    // kumaşları hem bekleyen kurşun işini aynı anda göstermeli).
    const pendingBypass = await this.bypassService.findPendingForTambur(card.workOrderId);
    // `rollCount === 0` = "stale" atama (adımda açık top kalmamış). Onaylanacak iş
    // olmadığı için ekranda ölü bir onay butonu doğurur — Dağıtım ekranındaki
    // stale rozetiyle planlamacı iptal eder, Tambur burada YOK sayar.
    const bypassPending = pendingBypass && pendingBypass.rollCount > 0 ? pendingBypass : null;

    let stepId: string;
    let emptyStep = false;
    try {
      // ⚠️ Burada ZENGİNLEŞTİRİLMEMİŞ assert kullanılır: `bypassPending` dolu
      // olduğunda bu hata zaten YUTULUYOR ve sebep sorgusu (rota + üç iz
      // sorgusu) boşa koşardı — üstelik bypass rejiminin EN SIK yolunda.
      // Zenginleştirme yalnız gerçekten fırlatılacak dalda yapılır (aşağıda).
      ({ stepId } = await assertWoAtStepKind(card.workOrderId, StationKind.TAMBUR));
    } catch (err) {
      // Bekleyen dağıtım YOKSA **ve** saha düzeltmesi yetkisi YOKSA davranış birebir
      // eskisi gibi — hata aynen çıkar. Altyapı hatası (DB/bağlantı) hiçbir durumda
      // MASKELENMEZ: yalnız assert'in kendi iş kuralı hataları (AppError) bu yollara düşer.
      //
      // ⚠️ `allowEmptyStep` (2026-08-03): Tambur adımında AÇIK TOP YOKKEN kart hiç
      // açılamıyordu ve "Topu Buraya Al / Manuel Top Ekle" saha aksiyonları TAM DA
      // gerektikleri anda ulaşılamaz kalıyordu (aksiyonlar `activeJob`'a bağlı, o da
      // karta). Yetkili operatör (`mobile:tambur-duzelt` / `roll:manual-adjust`) için
      // kartı BOŞ olarak açıyoruz: `emptyStep: true` ile ekran "bu adımda bekleyen top
      // yok" bandını gösterip yalnız saha düzeltmesini sunar. Yetkisiz operatörde
      // davranış DEĞİŞMEZ — boş kart kafa karıştırır, hata doğru cevaptır.
      if (!(err instanceof AppError)) throw err;
      if (!bypassPending && !opts?.allowEmptyStep) {
        throw await this.enrichTamburScanError(err, card.workOrderId);
      }
      if (!bypassPending) emptyStep = true;
      // Rotanın ilk Tambur adımı (assertWoAtStepKind ile aynı seçim kuralı).
      const tamburStep = await prisma.workOrderStep.findFirst({
        where: {
          workOrderId: card.workOrderId,
          station: { kind: StationKind.TAMBUR },
        },
        select: { id: true },
        orderBy: { stepSequence: "asc" },
      });
      // Rotada Tambur adımı hiç yoksa (assert'in 404'ü) bypass da kurtaramaz:
      // kapanış Kurşun Dağıtım ekranındaki "İşi Bitir" ile yapılır.
      if (!tamburStep) throw err;
      stepId = tamburStep.id;
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            workOrderNumber: true,
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
          cutNote: string | null;
          pieceLengthM: number | null;
          requiredProperties: { id: string; name: string }[];
        }>;
      }
    >();
    for (const link of links) {
      const ol = link.orderLine;
      const order = ol.order;
      // F133: daima-0 shippedQty alanı kaldırıldı — loose modelde top→sipariş satırı
      // bağı yok, per-line karşılanma türetilemez (spec-toplam üzerinden işler).
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
        cutNote: ol.cutNote ?? null,
        pieceLengthM: ol.pieceLengthM !== null ? Number(ol.pieceLengthM) : null,
        requiredProperties: ol.requiredProperties.map((rp) => ({
          id: rp.property.id,
          name: rp.property.name,
        })),
      });
    }
    const orders = Array.from(ordersMap.values());

    // Adımdaki kesilebilir Roll'lar (LIFO — Tambur movement enteredAt DESC).
    // `barcode: null` filtresi KALDIRILDI (2026-07-27): "Tambur adımındaki HER top
    // kesilebilir" (2026-07-16, bkz. cutOpenFabric) — Konumu-Düzelt ile gelen
    // barkodlu TOP bu listede görünmüyordu; adım listesi (loadTamburRolls) ile
    // sayılar çelişiyordu. Barkod payload'a eklendi (UI etiketleyebilsin).
    const openMovements = await prisma.rollMovement.findMany({
      where: {
        workOrderStepId: stepId,
        exitedAt: null,
        roll: {
          status: RollStatus.IN_PRODUCTION,
        },
      },
      // LIFO: en son giren en üstte; id tie-break — toplu taşımada eşit enteredAt
      // sırayı refetch'ler arasında zıplatmasın (loadTamburRolls paritesi).
      orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
      select: {
        enteredAt: true,
        roll: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            initialQty: true,
            color: { select: { code: true, name: true } },
            parentReceipt: { select: { receiptNo: true } },
            errors: {
              // F131: kardeş sorgularla (getPendingRolls/getRollForDecision/loadTamburRolls)
              // aynı işlenmemiş-hata filtresi — NO_CUT ile idari kapatılmış (isProcessed=true)
              // hata, fason turundan sonra dönen açık kumaşta 'açık hata' olarak listelenmesin.
              where: { isProcessed: false },
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
      barcode: m.roll.barcode,
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
        batchNumber: step.workOrder.workOrderNumber,
        stepId: step.id,
        stationName: step.station.name,
        plannedFoldType: step.workOrder.foldType,
        stepNote: step.notes,
        orders,
        openFabricRolls,
        bypassPending,
        emptyStep,
      },
    };
  }

}
