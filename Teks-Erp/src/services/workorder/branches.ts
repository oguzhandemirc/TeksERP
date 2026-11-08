// =============================================================================
// TeksERP - WorkOrder (Parti) Service / branches
// =============================================================================
// Parti dalları (getBranches) ve parti zaman çizelgesi (getBatchTimeline).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import { ACTIVE_OPERATION, OWN_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import {
  K18_DEAD_STATUSES,
} from "../batch.service";
import { TERIM } from "../../constants/terim";

export async function getBranches(workOrderId: string): Promise<ApiResponse<unknown>> {
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
      return { success: false, data: null, message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı` };
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

export async function getBatchTimeline(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
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
