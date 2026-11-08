// =============================================================================
// TeksERP - WorkOrder (Parti) Service / cancel-impact
// =============================================================================
// İptal etki önizlemesi (getCancelImpact) ve fason iptal kararı hazırlığı.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import {
  ACTIVE_ROLL_PROPERTY,
} from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { SHRINK_REASON_CODE } from "../../constants/variance-reasons";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  WorkOrderStatus,
  RollStatus,
  RollEntrySource,
} from "@prisma/client";
import {
  K18_DEAD_STATUSES,
} from "../batch.service";
import { resolveDispatchCancelBlockReason } from "../helpers/subcontractor-cancel.helper";
import { SubcontractorService } from "../subcontractor.service";
import { OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import { workOrderStepIdOf } from "../helpers/dispatch-header.helper";
import { isRollItem } from "../helpers/dispatch-item-kind.helper";
import { TERIM } from "../../constants/terim";
import { CLOSE_BLOCKED_STATUSES, CLOSE_DISPOSITION_MAX_ROLLS, CLOSE_IN_FLIGHT_STATUSES, type CancelWorkOrderInput } from "./shared";

export async function getCancelImpact(id: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true } } },
    });
    if (!wo) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
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
      blockReason = `${TERIM.terbiyeIsEmri.cumleBasi.yalin} zaten iptal edilmiş.`;
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = `Devredilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez (malzemesi yeni ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} taşındı).`;
    } else if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = `Tamamlanmış ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez.`;
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
          ? `Bu ${TERIM.terbiyeIsEmri.tekilKucuk} iptal edilemez ama kapatılabilir — istasyondaki toplara depo / 2. kalite / devir kararı verilir.`
          : null,
      },
    };
  }

export async function prepareFasonCancelDecision(
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
        `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} ${fasonRolls.length} topu fasonda. Ne yapılsın?`,
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
        { dispatchIds: openDispatches.map((d) => d.id), reason: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} iptali: ${reason}` },
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
              .toFixed(1)} m). ${TERIM.terbiyeIsEmri.cumleBasi.belirtme} iptal etmek için bu malın ne olacağına karar verin.`,
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
              reasonText: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} iptali: ${reason}`,
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
