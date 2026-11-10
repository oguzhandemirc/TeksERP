// =============================================================================
// Tambur Service / warehouse-cut-finalize
// =============================================================================
// Depo topu kesim kapanışı (finalizeWarehouseCut): ebeveyn arşivi + kalan kumaş kararı.
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (tambur/finalize.ts sayılır) */

import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import {
  loadStationPropertyCaps,
} from "../helpers/station-capability-transfer.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { postStockMove, qtyYazilabilir } from "../helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { randomUUID } from "node:crypto";
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
import { WarehouseEventType, RollVarianceKind } from "@prisma/client";
import { sackBlockMessage } from "../helpers/sack-invariants.helper";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  RollOperationType,
  StationKind,
} from "@prisma/client";
import { reserveRollBarcodesInOrderTx } from "../helpers/roll-barcode.helper";
import { resolveTamburCutWeight, resolveTamburLabelBatchNo } from "../helpers/tambur-customer-settings.helper";
import { resolveRollLabelTexts } from "../helpers/label-batch-no.helper";
import { applyTamburCapabilitiesTx, closeOrphanRollErrors, liveCutChildIdsTx } from "./shared";

// eslint-disable-next-line max-params -- özgün metot 5 parametreli ve uyarısı cephedeki imzada sayılır; ailenin max-params katkısı bölme öncesi gibi İKİ
export async function finalizeWarehouseCut(
    rollId: string,
    data: {
      remainingAction?: RemainingAction;
      /// KALAN için AÇIK katalog seçimi (yeni tablet). Verilirse `remainingAction`
      /// rol eşlemesini EZER; verilmezse eski sözleşme aynen çalışır.
      remainingGradeId?: string | null;
      notes?: string | null;
      /// SAPMA SEBEBİ (2026-08-09) — `finalizeOpenFabric` ile aynı sözleşme.
      varianceReasonCode?: string | null;
      varianceReasonText?: string | null;
      /** S5: kalan topun kg'ı (tartım kapısı). */
      weightKg?: number | null;
      /** Kalan topun etiket parti no'su (müşteri ayarı açıksa). */
      labelBatchNo?: string | null;
      labelItemName?: string | null;
      labelColorName?: string | null;
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
        properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true, valueId: true } },
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
    // Ham parent: kalan parça ham kalır — "keep_*" → ham STOCK (üretime devam),
    // "scrap" → fire rolü. Bitmiş parent: klasik kalite kodu, çıktı WAREHOUSE.
    //
    // KOD KATALOGDAN (karar ①): sözleşme adı → ROL → katalog satırı. Rolsüz
    // katalogda 400 (fail-closed) — eskiden gömülü literal yazılıyor,
    // `resolveQualityGradeId` lenient olduğu için `qualityGradeId` null kalıyor
    // ve fire SATILABİLİR STOK sayılıyordu.
    // ⚠️ Ham parent'ın "keep_*" dalı `parent.qualityGrade`i MİRAS alır ve
    // katalogdan ÇÖZÜLMEZ: ebeveynin snapshot'ı pasifleşmiş bir kademeyi
    // gösteriyor olabilir ve geçmişi cezalandırmak yanlış cevap.
    const childQualityGrade = isRawParent
      ? action === "scrap"
        ? await resolveRemainingGradeCode(prisma, "scrap", data.remainingGradeId)
        : parent.qualityGrade
      : await resolveRemainingGradeCode(prisma, action, data.remainingGradeId);
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
    // İstasyon yeteneği (T1) — oturum istasyonu YALNIZ Tambur türündeyse (Top Kesme başka
    // istasyonun oturumundan da yapılabilir; o istasyonun yeteneği kesim çocuğuna yazılmaz).
    const tamburStationId = sessionStationId ?? null;
    const tamburCaps = tamburStationId
      ? await loadStationPropertyCaps(prisma, tamburStationId, { kind: StationKind.TAMBUR })
      : [];

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
        : (await reserveRollBarcodesInOrderTx(prisma, [
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
            weightKg: remainingWeightKg,
            labelBatchNo: remainingLabelBatchNo,
            labelItemName: labelTexts.labelItemName,
            labelColorName: labelTexts.labelColorName,
            // Ham parent → kalan ham STOCK/SCRAP; bitmiş parent → WAREHOUSE.
            status: childStatus,
            qualityGrade: childQualityGrade,
            qualityGradeId: childQualityGradeId,
            parentRollId: parent.id,
            // EMANET sahipliği doğum niteliğidir: müşterinin kumaşından kesilen parça da onundur (H10).
            ownerCustomerId: parent.ownerCustomerId ?? null,
            // Parti (batch) kimliğini parent'tan kalıt → bölünen top depoya gitse bile partisi lane'de izlenir.
            batchId: parent.batchId,
            // DEPO parent'tan MİRAS ALINIR — kesmek malı taşımaz (bkz. kesim çocuğu).
            warehouseId: parent.warehouseId ?? (await resolveTargetWarehouseId(tx)),
            // GİRİŞ İSTASYONU — kesilen parçayla AYNI kaynak — ikisi aynı kesimin ürünü.
            // Parent'tan MİRAS ALINMAZ: parent başka bir istasyonda girmiş olabilir
            // (depo topu yeni bir iş emrine sokulabiliyor); doğru cevap KESİMİN yeri.
            entryStationId: resolveEntryStationId({ sessionStationId }),
            entrySource: RollEntrySource.TAMBUR_SPLIT,
            stage: parent.stage, // Top Kesme çocuğu atanın aşamasını alır
            createdById: userId ?? null,
            createdMachineId: sessionMachineId ?? null,
            // Kalan (leftover) parça — müşteri niyeti yok → stok etiketi.
            lastLabelSnapshot: { stock: true },
            },
        });
        if (propertySnapshot.length > 0) {
          await inheritRollPropertiesTx(tx, { childId: child.id, rows: propertySnapshot });
        }
        await applyTamburCapabilitiesTx(tx, { caps: tamburCaps, stationId: tamburStationId, rollId: child.id, userId });
        // Kalan child'a da KURSUN/QC2 kalıtımı uygula. Filter YOK — zincirleme
        // inherit (depo topundaki op'lar zaten inherit'li).
        const inheritedOps = await tx.rollOperation.findMany({
          where: { ...ACTIVE_OPERATION,
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
            propertyValueId: true,
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
              propertyValueId: op.propertyValueId, // KQ-D4: gramaj mirası
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
      let varianceId: string | null = null;
      if (varianceKind) {
        varianceId = await recordVarianceTx(tx, {
          rollId: parent.id,
          // Depo kesimi hiçbir iş emri adımına bağlı DEĞİL — uydurma step yazma.
          workOrderStepId: null,
          kind: varianceKind,
          qty: remainingQty,
          source: VARIANCE_SOURCES.TAMBUR_WAREHOUSE_FINALIZE,
          reasonCode: data.varianceReasonCode ?? null,
          reasonText: data.varianceReasonText ?? null,
          // D4-B1b: adımsız depo kesimi CUT okuması yazamaz → kaynak bugün hep NULL (tek kural, aynı türetim).
          measureSource: await cutChildrenMeasureSourceTx(tx, await liveCutChildIdsTx(tx, parent.id, remainingChild?.id ?? null)),
          userId,
        });
      }

      // ── STOK DEFTERİ — KALANIN KARARI ─────────────────────────────────────
      // Kapanış ebeveynin kalanını her hâlde sıfırlar; defter bu metrajın
      // NEREYE gittiğini MALIN YERİNDEN okur, kod yolundan değil: kalan çocuk
      // stok kümesinde doğduysa kesim ÇİFTİ (grup net sıfır), doğmadıysa ya da
      // stok DIŞINA doğduysa tek ÇIKIŞ satırı.
      //
      // ⚠️ BİTMİŞ ebeveynde `scrap` malı stoktan ÇIKARMAZ: çocuk FIRE
      // kalitesiyle ama WAREHOUSE statüsünde doğar, mal rafta kalır. Sapma
      // defteri "fire kararı verildi", stok defteri "mal depoda kaldı" der —
      // bu yüzden sebep `varianceKind`den DEĞİL çocuğun statüsünden türetilir.
      let ledgerPairWritten = false;
      let ledgerExitWritten = false;
      if (
        parent.warehouseId !== null &&
        WAREHOUSE_STOCK_STATUSES.includes(parent.status) &&
        qtyYazilabilir(remainingQty)
      ) {
        const exitEnd = { warehouseId: parent.warehouseId, status: parent.status };
        const childRow = remainingChild;
        if (
          childRow !== null &&
          childRow.warehouseId !== null &&
          WAREHOUSE_STOCK_STATUSES.includes(childRow.status)
        ) {
          const transformGroupId = randomUUID();
          await postStockMove(tx, {
            rollId: parent.id,
            eventType: WarehouseEventType.TRANSFORM,
            qty: remainingQty,
            from: exitEnd,
            reasonCode: STOCK_MOVE_REASON.CUT_SPLIT,
            transformGroupId,
            userId: userId ?? null,
          });
          await postStockMove(tx, {
            rollId: childRow.id,
            eventType: WarehouseEventType.TRANSFORM,
            qty: remainingQty,
            to: { warehouseId: childRow.warehouseId, status: childRow.status },
            reasonCode: STOCK_MOVE_REASON.CUT_SPLIT,
            transformGroupId,
            userId: userId ?? null,
          });
          ledgerPairWritten = true;
        } else {
          // Mal defterden düşüyor: `SCRAP` = mal vardı kullanılamaz (fire
          // KPI'sına girer), `CUT_DISCARD` = mal hiç yoktu (kayıt düzeltmesi).
          await postStockMove(tx, {
            rollId: parent.id,
            eventType: WarehouseEventType.ADJUST,
            qty: remainingQty,
            from: exitEnd,
            reasonCode:
              varianceKind === RollVarianceKind.SCRAP
                ? STOCK_MOVE_REASON.SCRAP
                : STOCK_MOVE_REASON.CUT_DISCARD,
            rollVarianceId: varianceId,
            userId: userId ?? null,
          });
          ledgerExitWritten = true;
        }
      }

      return {
        remainingChild,
        remainingQty,
        defter: { pair: ledgerPairWritten, exit: ledgerExitWritten },
      };
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
        defter: result.defter,
        notes: data.notes ?? null,
        ...(labelTexts.labelItemName || labelTexts.labelColorName ? labelTexts : {}),
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
