// =============================================================================
// Tambur Service / open-fabric-finalize
// =============================================================================
// Açık kumaş kesim kapanışı (finalizeOpenFabric).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (tambur/finalize.ts sayılır) */

import { consumeForOperationTx } from "../helpers/consumable-stock.helper";
import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import {
  loadStationPropertyCaps,
} from "../helpers/station-capability-transfer.helper";
import { postOpenFabricChildEntryTx } from "../helpers/production-entry-ledger.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { resolveQualityGradeId } from "../helpers/quality-grade.helper";
import {
  resolveRemainingGradeCode,
  type RemainingAction,
} from "../helpers/quality-role.helper";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import { recordVarianceTx } from "../helpers/roll-variance.helper";
import {
  cutChildrenMeasureSourceTx,
} from "../helpers/meter-reading.helper";
import {
  VARIANCE_SOURCES,
  varianceKindForRemainingAction,
} from "../../constants/variance-reasons";
import { resolveFoldTypeForWrite } from "../helpers/fold-type";
import { assertRollMatchesPlan, recordPlanDeviationTx } from "../helpers/tambur-plan-gate.helper";
import type { PlanMismatchItem } from "../../constants/tambur-plan-gate";
import {
  Prisma,
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
import { TERIM } from "../../constants/terim";
import { resolveTamburCutWeight, resolveTamburLabelBatchNo } from "../helpers/tambur-customer-settings.helper";
import { resolveRollLabelTexts } from "../helpers/label-batch-no.helper";
import { applyTamburCapabilitiesTx, closeOrphanRollErrors, liveCutChildIdsTx } from "./shared";

export async function finalizeOpenFabric(
    openFabricRollId: string,
    data: {
      remainingAction?: RemainingAction;
      /// KALAN için AÇIK katalog seçimi (yeni tablet). Verilirse `remainingAction`
      /// rol eşlemesini EZER; verilmezse eski sözleşme aynen çalışır.
      remainingGradeId?: string | null;
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
      /** S5: kalan topun kg'ı (tartım kapısı). */
      weightKg?: number | null;
      /** Kalan topun etiket parti no'su (müşteri ayarı açıksa). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
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
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true, valueId: true } },
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
        where: { ...ACTIVE_OPERATION,
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
      throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} açık kumaşı finalize edilemez`);
    }
    // PLAN-GERÇEK SAPMA KAPISI — yalnız kalan kuyruk DEPOYA inerken (keep_*).
    // scrap/discard kapı dışı: fire satılabilir stok üretmez, sormak gürültü.
    let planDeviations: PlanMismatchItem[] = [];
    {
      // Aşağıdaki gerçek türetmeyle (3100) BİREBİR aynı: varsayılan "discard".
      const act = data.remainingAction ?? (data.scrapRemaining === true ? "scrap" : "discard");
      if ((act === "keep_1kalite" || act === "keep_a1") && Number(parent.currentQty) > 0) {
        planDeviations = await assertRollMatchesPlan(
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
    const action: RemainingAction =
      data.remainingAction ?? (data.scrapRemaining === true ? "scrap" : "discard");
    // Tamburda tartım (S5) — kalan top DOĞACAKSA kesim yollarıyla aynı kapı; discard/kalan 0 top
    // doğurmaz. Metraj claim'e kadar yalnız AZALIR → tx öncesi karar güvenli.
    const remainingWeightKg =
      action !== "discard" && Number(parent.currentQty) > 0
        ? await resolveTamburCutWeight({ weightKg: data.weightKg, targetCustomerId: null, ownerCustomerId: parent.ownerCustomerId })
        : null;
    const remainingLabelBatchNo =
      action !== "discard" && Number(parent.currentQty) > 0
        ? await resolveTamburLabelBatchNo({ labelBatchNo: data.labelBatchNo, targetCustomerId: null, ownerCustomerId: parent.ownerCustomerId })
        : null;
    // Kalan topun etiket kumaş adı / rengi — yalnız top doğuyorsa; miras yok, ayara bağlı değil.
    const labelTexts =
      action !== "discard" && Number(parent.currentQty) > 0
        ? resolveRollLabelTexts(data)
        : { labelItemName: null, labelColorName: null };
    // Kod KATALOGDAN (karar ①) — `finalizeWarehouseCut` ile AYNI kapı; eşleme
    // burada ikinci kez yazılsaydı iki yüzey sessizce ayrışırdı.
    const childQualityGrade: string = await resolveRemainingGradeCode(
      prisma,
      action,
      data.remainingGradeId,
    );
    const tamburStepId = parent.currentStep.id;
    const woId = parent.currentStep.workOrderId;
    // Miras kopyası DEĞER-FARKINDA (2026-08-11, denetim F6): kesim çocuğu
    // ebeveynin GRAMAJ=50GR seçimini de devralır — fiziksel gerçek bu (aynı
    // kumaşın parçası), valueId düşürülürse çocuk "gramajı belirsiz" doğardı.
    const propertySnapshot = parent.properties.map((p) => ({
      propertyId: p.propertyId,
      valueId: p.valueId ?? null,
    }));
    // İstasyon yeteneği (T1) — tx DIŞINDA bir kez (salt okuma, yapılandırma).
    const tamburStationId = parent.currentStep.stationId;
    const tamburCaps = await loadStationPropertyCaps(prisma, tamburStationId);

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
      action === "discard" ? null : (await reserveRollBarcodesInOrderTx(prisma, ["F"]))[0]!;

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
        throw AppError.conflict(`İptal/devredilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} açık kumaşı finalize edilemez`);
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
            weightKg: remainingWeightKg,
            labelBatchNo: remainingLabelBatchNo,
            labelItemName: labelTexts.labelItemName,
            labelColorName: labelTexts.labelColorName,
            status: RollStatus.WAREHOUSE,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            producedInStepId: tamburStepId,
            parentRollId: parent.id,
            // EMANET sahipliği doğum niteliğidir: müşterinin kumaşından kesilen parça da onundur (H10).
            ownerCustomerId: parent.ownerCustomerId ?? null,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
            batchId: parent.batchId,
            // DEPO parent'tan MİRAS ALINIR — kesmek malı taşımaz (bkz. kesim çocuğu).
            warehouseId: parent.warehouseId ?? (await resolveTargetWarehouseId(tx)),
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
          await inheritRollPropertiesTx(tx, { childId: child.id, rows: propertySnapshot });
        }
        await applyTamburCapabilitiesTx(tx, { caps: tamburCaps, stationId: tamburStationId, rollId: child.id, userId });
        remainingChildId = child.id;
        // STOK DEFTERİ — kalan parça da depoda doğar: `cutOpenFabric` çocuğuyla AYNI
        // giriş (2026-09-14'e kadar satırsızdı; tipli `rollData` yüzünden K
        // listesinin kör noktasıydı, 6e ölçtü). Fire kalitesi de WAREHOUSE'a
        // iner ⇒ o da stok kümesine girer, satır alır (durum = defter).
        await postOpenFabricChildEntryTx(tx, child, tamburStepId, userId);

        // PLAN-SAPMA DEFTERİ — YALNIZ bu dalda: kapı pre-tx `currentQty > 0`
        // gördü ama tx içindeki TAZE kalan 0'a düşmüş olabilir (araya kesim
        // girdi). O durumda depoya inen bir şey yok → 0 metrajlık satır
        // gürültüsü yazılmaz. Metraj da taze `remainingQty`dir.
        await recordPlanDeviationTx(tx, {
          mismatches: planDeviations,
          rollId: parent.id,
          childRollId: child.id,
          workOrderId: woId,
          workOrderStepId: tamburStepId,
          qtyM: remainingQty,
          source: "finalize-open-fabric",
          confirmedById: userId,
        });
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
      // ile aynı kural — istasyona giren işlenmiş metraj). Yedek kaynak
      // `parent.initialQty`dir ve 2026-08-29'dan beri GÜVENİLİRDİR: depo kesimi
      // artık o kolona dokunmuyor (BULGU-T2-016). Birincil kaynak yine movement'ın
      // kendi `qtyIn`i — "istasyona giren metraj" sorusunun tek doğru cevabı odur;
      // `initialQty` topun DOĞUŞTAKİ metrajıdır ve istasyona girerken kesilmiş
      // olabilir.
      const movementNote =
        wantChild && remainingChildId
          ? `TAMBUR_FINALIZED:REMAINING_${remainingQty}_${childQualityGrade}`
          : "TAMBUR_FINALIZED";
      const openMove = await tx.rollMovement.findFirst({
        where: { ...ACTIVE_MOVEMENT, rollId: parent.id, workOrderStepId: tamburStepId, exitedAt: null },
        select: { qtyIn: true },
      });
      const qtyOutD =
        openMove && new Prisma.Decimal(openMove.qtyIn).greaterThan(0)
          ? new Prisma.Decimal(openMove.qtyIn)
          : new Prisma.Decimal(parent.initialQty);
      await tx.rollMovement.updateMany({
        where: {
          ...ACTIVE_MOVEMENT,
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

      // TAMBUR_PROCESSED log — upsert yalnız aktif satıra bakar (partial unique;
      // geri alınmış iz bulunursa yeniden finalize yeni satır yazmazdı).
      const tamburOp = await tx.rollOperation.upsert({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: parent.id,
            workOrderStepId: tamburStepId,
            operationType: RollOperationType.TAMBUR_PROCESSED,
          },
          ...ACTIVE_OPERATION,
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
      // Kuşak sarf düşümü (ayar kapalıysa no-op; eksi bakiye engellemez).
      const consumableWarnings = (await consumeForOperationTx(tx, tamburOp.id, userId ?? null, { processedQty: qtyOutD })).map((w) => w.message);

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
          // D4-B1b: kalan = kayıt − kesimler → kaynağı kesimlerin CUT okumalarının zayıf halkası.
          measureSource: await cutChildrenMeasureSourceTx(tx, await liveCutChildIdsTx(tx, parent.id, remainingChildId)),
          userId,
        });
      }

      await recomputeStepStatus(tx, tamburStepId);

      // WO completion check — Tambur production'ın son istasyonu (paketleme/sevk
      // fulfillment, WO step değil). Terminal-durum guard'lı ORTAK helper:
      // CANCELLED/SUPERSEDED buradan COMPLETED'a dirilmez.
      await completeWorkOrderIfStepsDone(tx, woId, { trigger: "TAMBUR_FINALIZE_OPEN_FABRIC" });

      return { remainingChildId, remainingQty, wantChild, consumableWarnings };
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
        ...(labelTexts.labelItemName || labelTexts.labelColorName ? labelTexts : {}),
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
      ...(result.consumableWarnings.length > 0 ? { warnings: result.consumableWarnings } : {}),
    };
  }
