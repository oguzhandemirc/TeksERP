// =============================================================================
// Tambur Service / finalize
// =============================================================================
// Tambur kararı (finalize): KES/hata kararları, çocuk top doğumu, kalan kumaş kararı, defter + adım ilerletme tx'i.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { consumeForOperationTx } from "../helpers/consumable-stock.helper";
import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import {
  loadStationPropertyCaps,
} from "../helpers/station-capability-transfer.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { postStockMove, qtyYazilabilir } from "../helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import { pickFinalizeChildWidthTx } from "../helpers/finalize-child-width.helper";
import { auditBornCustomerCodes, birthCustomerCodesTx, type BornCustomerCode } from "../helpers/customer-code-birth.helper";
import {
  resolveTamburOverQuantityEnabled,
  readQualityGradeRequiredEnabled,
  readLabelCustomerCodeAt,
} from "../system-setting.service";
import { recordVarianceTx, overageOf } from "../helpers/roll-variance.helper";
import {
  assertTamburMeasuresAllowed,
  auditCutReadings,
  toMachineDataSource,
  weakestMeasureSource,
  writeCutReadingsTx,
  type CutReadingInput,
  type MeterSourceInput,
} from "../helpers/meter-reading.helper";
import {
  VARIANCE_SOURCES,
} from "../../constants/variance-reasons";
import { WarehouseEventType, RollVarianceKind } from "@prisma/client";
import { resolveFoldTypeForWrite } from "../helpers/fold-type";
import { assertRollMatchesPlan, recordPlanDeviationTx } from "../helpers/tambur-plan-gate.helper";
import {
  Prisma,
  Roll,
  RollMeterReading,
  RollStatus,
  RollEntrySource,
  RollOperationType,
  StationKind,
  WorkOrderStatus,
} from "@prisma/client";
import {
  completeWorkOrderIfStepsDone,
  recomputeStepStatus,
} from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { reserveRollBarcodesInOrderTx } from "../helpers/roll-barcode.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "../helpers/roll-error-scope.helper";
import { TERIM } from "../../constants/terim";
import { resolveTamburCutWeight, resolveTamburLabelBatchNo } from "../helpers/tambur-customer-settings.helper";
import { resolveRollLabelTexts } from "../helpers/label-batch-no.helper";
import { isConsignedRoll } from "../helpers/stock-ownership.helper";
import { applyTamburCapabilitiesTx, closeOrphanRollErrors } from "./shared";

// Kesim etiket NİYETİ (hedef sipariş kalemi / müşteri var-mı + müşteri isActive;
// hiçbiri yoksa stok) `helpers/label-intent.helper.ts`'te yaşar — eskiden bu
// dosyanın yerel `resolveCutLabelIntent` fonksiyonuydu, 2026-08-03'te TAŞINDI:
// aynı çözümü Tambur MANUEL ÜRETİMİ de (`tambur-manual.service.produceFinishedRoll`)
// çağırıyor ve ikinci bir kopya "pasif müşteri etikete atanamaz" guard'ının tek
// yolda kalmasıyla biterdi. Sonuç `buildIntentSnapshot`'a verilip child'ın
// `lastLabelSnapshot`'ına yazılır (gevşek model: BAĞ değil, baskı-anı bağlamı).


export interface ErrorDecision {
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
export interface CutInput {
  length: number;
  qualityGrade: string;
  relatedErrorIds: string[];
  /** D4-B1: kesim metresinin ölçüm kaynağı; eski APK göndermez (sapma kaynağı NULL kalır). */
  measure?: MeterSourceInput | null;
  /** S5: parçanın tartım kg'ı; müşteri tartım istiyorsa WAREHOUSE parçasında zorunlu. */
  weightKg?: number | null;
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

export async function finalize(
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
      /** S5: otomatik kalan kuyruk parçasının kg'ı (tartım kapısı). */
      remainingWeightKg?: number | null;
      /** Müşterinin etikete istediği parti metni — bu finalize'da doğan HER parçaya yazılır. */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
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
      /** D4-F2: yalnız kod doğduysa (label.customerCodeAt=TAMBUR_OUTPUT + müşteri serisi). */
      customerCodes?: Array<{ rollId: string; code: string }>;
    }>
  > {
    // D4-B1 ölçüm kapıları tx AÇILMADAN (SIMULATED kapalı · kaynak zorunlu · kart örneği yok).
    await assertTamburMeasuresAllowed(data.cuts.map((c) => c.measure));
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
        where: { ...ACTIVE_OPERATION,
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
        where: { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId: data.rollId, isProcessed: true },
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

    // İstasyon yeteneği (T1) — tx DIŞINDA bir kez (salt okuma, yapılandırma).
    const tamburCaps = await loadStationPropertyCaps(prisma, roll.currentStep.stationId);

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
      throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} topu finalize edilemez`);
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
    // Dönüş = ONAYLANAN sapmalar; tx İÇİNDE deftere yazılır (aşağıda).
    const planDeviations = await assertRollMatchesPlan(
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
          where: { ...ACTIONABLE_ROLL_ERROR_WHERE, id: { in: errorIds }, rollId: data.rollId, isProcessed: false },
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
      const overEnabled = await resolveTamburOverQuantityEnabled();
      if (!overEnabled) {
        throw AppError.badRequest(
          `Kesim uzunlukları toplamı (${cumulativeLenD.toString()}m) topun metrajını (${totalQtyD.toString()}m) aşıyor`
        );
      }
    }

    // ── KALİTE ZORUNLU (D6) — KALAN-KUYRUK TOPU ────────────────────────────
    // Kesimlerin toplamı metrajın ALTINDA kalırsa sistem otomatik bir "kalan"
    // child üretir ve onun kalitesi PARENT'tan devralınır (aşağıdaki
    // REMAINING_TAIL segmenti). Parent gradesizse o top KALİTESİZ doğar —
    // operatörün kesimlerde seçtiği kaliteler bu topa uygulanmaz.
    //
    // ⚠️ Koşul aşımla SIMETRİK okunur: aşım varsa (`cumulativeLenD >=
    // totalQtyD`) kuyruk bloğu zaten atlanır, dolayısıyla kapı da susar.
    // Bayrak okuması ancak GERÇEKTEN gradesiz kuyruk doğacaksa yapılır.
    //
    // ⚠️ ÖNKOŞUL (reçetede yazılı): bu dal bayrak açıkken 400 verir ve
    // tabletin "kalan parça için kalite" alanı olan APK'sı ŞARTTIR — aksi
    // halde gradesiz parent'lı HER finalize durur.
    if (
      cumulativeLenD.lessThan(totalQtyD) &&
      !roll.qualityGrade &&
      (await readQualityGradeRequiredEnabled())
    ) {
      throw AppError.badRequest(
        "Kalan parçanın kalitesi belirsiz — kesim toplamı topun metrajını doldurmuyor ve " +
          "kaynak topun kalitesi yok. Kalan için kalite seçin ya da kesimlerle metrajın tamamını kapatın.",
        { code: "GRADE_REQUIRED" }
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
      where: { ...ACTIVE_OPERATION,
        rollId: data.rollId,
        operationType: { in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED] },
      },
      // machineId: parent'ın işlendiği makine kopyada KORUNUR (yeni damga uygulanmaz).
      select: { workOrderStepId: true, operationType: true, operatorId: true, metadata: true, machineId: true, propertyValueId: true },
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
    // İÇİNDEYDİ ve her segment için ayrı ayrı `generateRollBarcodeTx(tx, …)`
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
      /** D4-B1b: kesimin ölçüm beyanı — CUT okuması bundan doğar; otomatik kalan parça ölçülmedi (null). */
      measure: MeterSourceInput | null;
      /** S5 tartım: istemcinin verdiği kg (kapıdan önce ham). */
      rawWeightKg: number | null;
      weightKg: Prisma.Decimal | null;
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
        measure: c.measure ?? null,
        rawWeightKg: c.weightKg ?? null,
        weightKg: null,
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
        measure: null,
        rawWeightKg: data.remainingWeightKg ?? null,
        weightKg: null,
      });
    }
    // Etiket parti no — müşteri ayarı kapalıyken değer 400 (kesim yollarıyla aynı kapı).
    const labelBatchNo = await resolveTamburLabelBatchNo({
      labelBatchNo: data.labelBatchNo,
      targetCustomerId: null,
      ownerCustomerId: roll.ownerCustomerId,
    });
    // Etikete basılacak kumaş adı / renk — topun kendi değeri (miras yok), ayara bağlı değil.
    const labelTexts = resolveRollLabelTexts(data);
    // Tamburda tartım (S5) — depoya inen her parça kesim yollarıyla AYNI kapıdan; tx/barkoddan önce.
    for (const seg of segments) {
      if (seg.status !== RollStatus.WAREHOUSE && seg.rawWeightKg == null) continue;
      seg.weightKg = await resolveTamburCutWeight({
        weightKg: seg.rawWeightKg,
        targetCustomerId: null,
        ownerCustomerId: roll.ownerCustomerId,
      });
    }

    // Split çocuğu FRESH kısa barkod alır (soy-ağacı parentRollId'de tutulur;
    // eski `parent+KS+suffix` biçimi hem uzundu hem hiçbir yerde parse edilmiyordu).
    // Tip başına TEK ifade; dönen dizi segment SIRASINI korur (yer değiştirirse
    // fiziksel toplara yanlış etiket basılır — bkz. helper'daki uyarı).
    const segmentBarcodes = await reserveRollBarcodesInOrderTx(
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
    let cutReadings: RollMeterReading[] = [];
    // F140: kapatılan RollError'lar için tx-sonrası per-satır audit (agregat log
    // kapatılan tekil hatayı iz tutmuyordu). tx İÇİNDE toplanır, commit sonrası emit.
    const closedErrorAudits: Array<{ errorId: string; actionTaken: string }> = [];
    // D4-F2: müşteri kodu doğum yeri — yalnız emanet topta okunur (NONE iken tx ve cevap bayt-aynı).
    const birthCustomerCodes = isConsignedRoll(roll) && (await readLabelCustomerCodeAt()) === "TAMBUR_OUTPUT";
    let bornCustomerCodes: BornCustomerCode[] = [];
    let customerCodeWarning: string | null = null;
    // Sarf (kuşak) uyarıları — eksi bakiye işi durdurmaz, yanıtın `warnings`ine taşınır.
    let consumableWarnings: string[] = [];
    const updatedRoll = await prisma.$transaction(async (tx) => {
      consumableWarnings = [];
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
        throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} topu finalize edilemez`);
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
          where: { ...ACTIONABLE_ROLL_ERROR_WHERE, id: d.errorId },
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
        where: { rollId: data.rollId, ...ACTIVE_ROLL_PROPERTY },
        // valueId: miras DEĞER-FARKINDA (denetim F6) — GRAMAJ=50GR çocuğa geçer.
        select: { propertyId: true, valueId: true },
      });

      // Parent deposuz ise (backfill öncesi kayıt) düşülecek depo — döngü DIŞINDA
      // bir kez çözülür (segment başına sorgu açmamak için).
      const cutWarehouseFallbackId = roll.warehouseId ?? (await resolveTargetWarehouseId(tx));

      // Her segment için yeni Roll + property + kalıtım op'ları + audit.
      // (Segmentler ve barkodları tx AÇILMADAN ÖNCE hazırlandı — gerekçe ve
      // ölçüm yukarıdaki blokta; barkodu burada üretmek sayaç kilidini bu tx'in
      // sonuna kadar tutardı.)
      // Çocuk eni kaynağı fabrika ayarı (D4-E3; varsayılan bugünkü `wo.width ?? roll.width`).
      const childWidth = await pickFinalizeChildWidthTx(tx, {
        parentRollId: roll.id, parentWidth: roll.width, woWidth: wo?.width ?? null,
      });
      const cutMeasures: CutReadingInput[] = [];
      for (const [segIndex, seg] of segments.entries()) {
        const splitBarcode = segmentBarcodes[segIndex]!;
        const splitRoll = await sequentialTx(tx).roll.create({
          data: {
            barcode: splitBarcode,
            itemId: roll.itemId,
            colorId: roll.colorId,
            // Bitmiş topun eni: ayar WO_TARGET_FIRST → WO hedef eni, yoksa ham parent;
            // MEASURED_FIRST → ölçülmüş parent eni önce (pickFinalizeChildWidthTx).
            width: childWidth,
            initialQty: seg.qty,
            currentQty: seg.qty,
            weightKg: seg.weightKg,
            labelBatchNo,
            labelItemName: labelTexts.labelItemName,
            labelColorName: labelTexts.labelColorName,
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
            // EMANET sahipliği doğum niteliğidir: müşterinin kumaşından kesilen parça da onundur (H10).
            ownerCustomerId: roll.ownerCustomerId ?? null,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen toplar depoya
            // gitse bile hangi partiden geldiği lane'de izlenir.
            batchId: roll.batchId,
            // DEPO parent'tan MİRAS ALINIR — giriş istasyonunun TERSİNE. Sebep:
            // kesmek malı TAŞIMAZ; çocuk fiziksel olarak ebeveynin durduğu
            // depodadır. (Giriş istasyonu "nerede doğdu"yu sorar, depo "nerede
            // duruyor"u.) Parent deposuz ise (backfill öncesi kayıt) varsayılan.
            warehouseId: roll.warehouseId ?? cutWarehouseFallbackId,
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
          // Doğum-anı damgalı miras (geri kurulum donörü bunu sayar).
          await inheritRollPropertiesTx(tx, { childId: splitRoll.id, rows: parentProperties });
        }
        if (seg.inheritProperties) {
          await applyTamburCapabilitiesTx(tx, { caps: tamburCaps, stationId: roll.currentStep!.stationId, rollId: splitRoll.id, userId });
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
              propertyValueId: op.propertyValueId, // KQ-D4: gramaj mirası
              inheritedFromParentRollId: roll.id,
            })),
          });
        }

        // DEPO DEFTERİ — çocuk DEPODA doğuyorsa giriş satırı. Ebeveyn satır
        // YAZMAZ: o IN_PRODUCTION'dı, yani zaten stok dışındaydı — "çift sayım"
        // korkusunun yapısal cevabı bu, ayrı bir kural değil.
        if (
          WAREHOUSE_STOCK_STATUSES.includes(splitRoll.status) &&
          splitRoll.warehouseId &&
          qtyYazilabilir(splitRoll.initialQty)
        ) {
          await postStockMove(tx, {
            rollId: splitRoll.id,
            eventType: WarehouseEventType.PRODUCTION,
            qty: splitRoll.initialQty,
            to: { warehouseId: splitRoll.warehouseId, status: splitRoll.status },
            reasonCode: STOCK_MOVE_REASON.TAMBUR_FINALIZE,
            workOrderStepId: roll.currentStep?.id ?? null,
          });
        }

        splitRolls.push(splitRoll);
        cutMeasures.push({ rollId: splitRoll.id, meters: splitRoll.initialQty, measure: seg.measure });

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
            ...(labelTexts.labelItemName || labelTexts.labelColorName ? labelTexts : {}),
            inheritedOpCount: inheritedOps.length,
          },
        });
      }
      if (birthCustomerCodes) {
        // Depo topu müşteri serisinden kodunu çocukla AYNI tx'te alır (numaralandirma.md: doğuşta materyalize).
        const shippable = splitRolls.filter((r) => r.status === RollStatus.WAREHOUSE).map((r) => r.id);
        ({ born: bornCustomerCodes, warning: customerCodeWarning } = await birthCustomerCodesTx(tx, { customerId: roll.ownerCustomerId!, rollIds: shippable, userId: userId ?? null }));
      }
      // D4-B1b: CUT okumaları çocuklar doğduktan sonra AYNI tx'te (measure'sız kesim okuma yazmaz).
      cutReadings = await writeCutReadingsTx(tx, { stepId: roll.currentStep!.id, machineId: machineId ?? null, userId: userId ?? null, cuts: cutMeasures });

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
      let processedQtyD: Prisma.Decimal | null = null;
      if (oldStepId) {
        const openMove = await tx.rollMovement.findFirst({
          where: { ...ACTIVE_MOVEMENT, rollId: data.rollId, workOrderStepId: oldStepId, exitedAt: null },
          select: { qtyIn: true },
        });
        const qtyOutD =
          openMove && new Prisma.Decimal(openMove.qtyIn).greaterThan(0)
            ? new Prisma.Decimal(openMove.qtyIn)
            : new Prisma.Decimal(totalQty);
        processedQtyD = qtyOutD;
        await tx.rollMovement.updateMany({
          where: {
            ...ACTIVE_MOVEMENT,
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
      const updated = await sequentialTx(tx).roll.update({
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

      // Parent'ın RollProperty'si SİLİNMEZ (2026-09-14): TAMBUR_CONSUMED ebeveyn
      // özelliğini taşımaya devam eder — geri almada (`tambur-undo` donör dalı,
      // count === 0 koşullu) çocuktan kopyalamak yerine kendi satırları durur.

      // Per-roll Tambur işlem log'u (parent üzerinde — kopyalanmaz).
      if (oldStepId) {
        // Geri alınmış iz dururken üçlü anahtar onu bulur ve yeni satır YAZILMAZ —
        // unique PARTIAL'dır, upsert de yalnız aktif satıra bakmalı.
        const tamburOp = await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: data.rollId,
              workOrderStepId: oldStepId,
              operationType: RollOperationType.TAMBUR_PROCESSED,
            },
            ...ACTIVE_OPERATION,
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
        // Kuşak sarf düşümü (ayar kapalıysa no-op; eksi bakiye engellemez).
        consumableWarnings = (await consumeForOperationTx(tx, tamburOp.id, userId ?? null, { processedQty: processedQtyD })).map((w) => w.message);
        await recomputeStepStatus(tx, oldStepId);
      }

      // PLAN-SAPMA DEFTERİ (2026-08-19) — onaylı plan-dışı kabulün KALICI izi.
      // Granülerlik GEÇİŞ başına (çocuk başına DEĞİL): sapan şey topun KİMLİĞİdir,
      // kaç parçaya bölündüğü değil — çocuk başına satır "onay sayısı" metriğini
      // kesim adedi kadar şişirirdi (operatör BİR kez imzaladı). Çocuklar zaten
      // `parentRollId` üzerinden türetilebilir.
      await recordPlanDeviationTx(tx, {
        mismatches: planDeviations,
        rollId: data.rollId,
        childRollId: null,
        workOrderId: wo.id,
        workOrderStepId: oldStepId ?? null,
        // Topun TAMAMI o kimlikle depoya iner (fire dahil — mal öyle kaydedildi).
        qtyM: totalQty,
        source: "finalize",
        confirmedById: userId,
      });

      // AŞIM DEFTERİ (2026-08-09) — klasik karar akışının artı yönü.
      // `cumulativeLenD > totalQtyD` kontrolü yukarıda zaten yapıldı ve bayrak
      // açıkken kabul edildi; burada YALNIZ kayda geçirilir. Üç kesim yolunun
      // (bu, cutOpenFabric, cutWarehouseRoll) üçü de aynı hesabı kullanır —
      // `overageOf` tek kaynak, kopyalanırsa defter sessizce eksik kalır.
      // ⚠️ `sourceRollId` BİLEREK YOK (hüküm ② "klasik finalize bugünkü davranış
      // BEYANLA"): aşım N çocuğun TOPLAMINDAN doğar, tek bir çocuğa atfedilemez.
      // Geri alma bu keşfi kimseye saymaz ve bump'ı bugünkü gibi yazar — atıfsız
      // keşif "karşılanmamış" sayılır (sessiz yanlış atıf yerine açık fazla sayım).
      await recordVarianceTx(tx, {
        rollId: data.rollId,
        workOrderStepId: oldStepId,
        kind: RollVarianceKind.OVERAGE,
        qty: overageOf(cumulativeLenD, totalQtyD),
        source: VARIANCE_SOURCES.TAMBUR_OVERCUT,
        // Aşım N kesimin toplamından doğar → kaynak hepsinin zayıf halkası.
        measureSource: toMachineDataSource(weakestMeasureSource(data.cuts.map((c) => c.measure?.source))),
        userId,
      });

      // WO completion — Tambur production'ın son istasyonu. Tüm üretim step'leri
      // COMPLETED/SKIPPED ise WO kapanır. (Tartı/paket/sevkiyat artık step değil,
      // fulfillment akışı — WO'yu tutmaz.) Terminal-durum guard'lı ORTAK helper:
      // CANCELLED/SUPERSEDED buradan COMPLETED'a DİRİLMEZ (kart fanout helper içinde).
      await completeWorkOrderIfStepsDone(tx, wo.id, { trigger: "TAMBUR_FINALIZE" });

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
    await auditCutReadings(userId, cutReadings);
    await auditBornCustomerCodes(userId, bornCustomerCodes);

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
        ...(bornCustomerCodes.length > 0 ? { customerCodes: bornCustomerCodes.map((c) => ({ rollId: c.rollId, code: c.code })) } : {}),
      },
      message: colorWarning ? `${baseMsg} Uyarı: ${colorWarning}` : baseMsg,
      // D4-F2: seri tükendiyse kodsuz kalan toplar — üretim sürer, uyarı görünür.
      ...(customerCodeWarning || consumableWarnings.length > 0
        ? { warnings: [...(customerCodeWarning ? [customerCodeWarning] : []), ...consumableWarnings] }
        : {}),
    };
  }
