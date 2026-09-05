// =============================================================================
// TeksERP — K16 Sevk Cerrahisi (fasondayken parti böl/taşı — belge kalemi izler)
// =============================================================================
// PARTI-AYIR-BIRLESTIR-V2 K16: splitBatch/moveRolls kilitli (fasonda mallı)
// partide de çalışır; taşınan topların AÇIK+OUTSTANDING sevk kalemleri hedef
// partiyi İZLER (OSFM kuralı — K15 merge belge cerrahisinin split/move simetriği):
//
//   1. Hedef partinin AYNI adımda açık+outstanding sevki varsa (guard: aynı
//      firma) taşınan kalemler ORAYA birleştirilir (P2002 kesişim seddi, MINOR-1
//      deseni); kaynak sevk boşalırsa K16_MOVE sebebiyle kapanır (K15_MERGE-
//      benzeri: totalQty=0 + irsaliye VOID), boşalmazsa totalQty kalemlerden
//      yeniden hesaplanır + belge notu düşülür.
//   2. Yoksa: kaynak sevkin TÜM kalemleri taşınıyorsa kayıt OLDUĞU GİBİ hedef
//      partiye RETARGET edilir (dispatch.batchId=hedef; yeni belge DOĞMAZ);
//      KISMI ise aynı meta'lı (firma/adım/plaka/şoför/talimat + ORİJİNAL
//      dispatchedAt — fiziksel gerçek: mal o gün gitti) YENİ SubcontractorDispatch
//      doğar; dispatchNo mevcut üreteç kalıbıyla YENİ üretilir, notes'a
//      "K16: <kaynakSevkNo> sevkinden bölündü" APPEND edilir, irsaliyesi
//      dondurulur (yeniden basılabilir).
//   3. Guard (K15 mesaj kalıbı, HİÇBİR mutasyondan önce): bir adımda kaynak +
//      hedef sevkleri FARKLI firmalara ise 409 + somut çakışma listesi.
//   4. Savunma: DÖNMÜŞ (kabul edilmiş) kalem taşınamaz — dönen top zaten
//      SUBCONTRACTOR_CONSUMED olur ve taşınmaz; yine de kalem dönmüşse 409.
//
// DEĞİŞMEZ korunur: her (parti, adım) çiftinde ≤1 açık+outstanding sevk —
// kaynakta zaten ≤1 vardı; hedefte adım başına TEK alıcı sevk (mevcut /
// retarget edilen / yeni doğan) targetByStep ile takip edilir, aynı adımdaki
// sonraki kaynak kalemleri ona birleşir.
//
// NOT: FS numarası üreteci subcontractor.service.nextPrefixedSequenceTx ile AYNI
// desen/kaynaktır (aynı tablo taraması, collation-güvenli gte+startsWith) —
// import EDİLMEZ çünkü subcontractor.service → batch.service → bu helper yönlü
// zincir var; ters import modül döngüsü kurardı.
// =============================================================================

import { Prisma, PrintedDocType } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../../utils/code-format";
import { printedDocumentService } from "../printed-document.service";
import { OPEN_OUTSTANDING } from "./fason-open-dispatch.helper";

export interface DispatchSurgeryResult {
  /** Bu operasyonda sevk cerrahisi gören kaynak parti id'leri (boşalma → K17 izi kararı için). */
  touchedSourceBatchIds: Set<string>;
  /** OLDUĞU GİBİ hedefe retarget edilen sevk no'ları (yeni belge doğmadı). */
  retargetedDispatchNos: string[];
  /** K16 kısmi bölmeyle doğan yeni sevkler. */
  bornDispatches: Array<{ dispatchNo: string; fromDispatchNo: string }>;
  /** Kalemleri hedefin mevcut sevkine birleştirilen kaynaklar. */
  mergedItems: Array<{ fromDispatchNo: string; intoDispatchNo: string; itemCount: number }>;
  /** Boşaldığı için K16_MOVE sebebiyle kapanan kaynak sevk no'ları. */
  closedDispatchNos: string[];
}

function emptyResult(): DispatchSurgeryResult {
  return {
    touchedSourceBatchIds: new Set(),
    retargetedDispatchNos: [],
    bornDispatches: [],
    mergedItems: [],
    closedDispatchNos: [],
  };
}

/**
 * FS sevk no üretici — tx İÇİNDE, mevcut üreteç kalıbı (PREFIX+GGAAYY+NNNN,
 * günün NUMERIC max'ı +1). Çağıran withBarcodeRetry kapsamında olmalı (P2002 → retry).
 */
async function generateDispatchNoTx(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const prefix = dailyCodePrefix("FS", date);
  const rows = await tx.subcontractorDispatch.findMany({
    where: { dispatchNo: { gte: prefix, startsWith: prefix } },
    select: { dispatchNo: true },
  });
  return buildDailyCode("FS", nextDailySeq(rows.map((r) => r.dispatchNo), prefix), date);
}

/**
 * totalQty'yi kalem toplamından yeniden hesapla + notes'a belge notu APPEND et.
 * ATOMİK CLAIM: sevk bu sırada iptal/DSK edildiyse 409 (K15 keeper deseniyle aynı).
 */
async function recomputeTotalAndAppendNoteTx(
  tx: Prisma.TransactionClient,
  dispatchId: string,
  note: string,
): Promise<void> {
  const agg = await tx.subcontractorDispatchItem.aggregate({
    where: { dispatchId },
    _sum: { dispatchedQty: true },
  });
  const row = await tx.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    select: { dispatchNo: true, notes: true },
  });
  const claim = await tx.subcontractorDispatch.updateMany({
    where: { id: dispatchId, cancelledAt: null, directShippedAt: null },
    data: {
      totalQty: agg._sum.dispatchedQty ?? new Prisma.Decimal(0),
      notes: row?.notes ? `${row.notes} | ${note}` : note,
    },
  });
  if (claim.count === 0) {
    throw AppError.conflict(
      `Sevk ${row?.dispatchNo ?? dispatchId} bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
    );
  }
}

/**
 * K16 sevk cerrahisi (tx-içi): kaynak partilerin açık+outstanding sevklerinden,
 * taşınan toplara ait kalemleri hedef partiye taşır. Çağıran topların ÜYELİĞİNİ
 * (roll.batchId) ayrıca taşır — bu fonksiyon yalnız SEVK katmanını düzenler.
 * Kaynak/hedef aynı iş emrinde olmalı (çağıran doğrular); WO kilidi
 * (touchWorkOrderTx) çağıranda alınmış olmalı.
 */
export async function performDispatchSurgeryTx(
  tx: Prisma.TransactionClient,
  params: {
    sourceBatchIds: string[];
    movedRollIds: ReadonlySet<string>;
    targetBatchId: string;
    targetBatchNumber: string;
    userId?: string;
  },
): Promise<DispatchSurgeryResult> {
  const result = emptyResult();
  if (params.sourceBatchIds.length === 0) return result;

  // Kaynak partilerin açık+outstanding sevkleri + kalemleri (dönmüşlük bilgisiyle).
  const sourceOpen = await tx.subcontractorDispatch.findMany({
    where: { batchId: { in: params.sourceBatchIds }, ...OPEN_OUTSTANDING },
    select: {
      id: true,
      dispatchNo: true,
      batchId: true,
      stepId: true,
      workOrderId: true,
      subcontractorId: true,
      plannedSubcontractorId: true,
      plateNumber: true,
      driverName: true,
      instruction: true,
      notes: true,
      dispatchedAt: true,
      dispatchedById: true,
      subcontractor: { select: { name: true } },
      step: { select: { station: { select: { name: true } } } },
      items: {
        select: {
          id: true,
          rollId: true,
          roll: { select: { barcode: true } },
          // Dönmüş mü? İptal-olmamış makbuz kalemi varsa kalem DÖNMÜŞTÜR.
          receiptItems: { where: { receipt: { cancelledAt: null } }, select: { id: true } },
        },
      },
    },
    orderBy: [{ dispatchedAt: "asc" }, { createdAt: "asc" }],
  });

  const affected = sourceOpen
    .map((d) => ({ d, movedItems: d.items.filter((i) => params.movedRollIds.has(i.rollId)) }))
    .filter((x) => x.movedItems.length > 0);
  if (affected.length === 0) return result;

  // ── Savunma (K16 madde 4): dönmüş kalem taşınamaz. Dönen top zaten CONSUMED
  // olur ve normal akışta seçilemez — yine de sed: kalem dönmüşse 409.
  for (const { d, movedItems } of affected) {
    const returned = movedItems.filter((i) => i.receiptItems.length > 0);
    if (returned.length > 0) {
      throw AppError.conflict(
        `Taşınamaz — dönmüş (kabul edilmiş) sevk kalemi taşınamaz: ` +
          `${returned.map((i) => i.roll.barcode ?? i.rollId).join(", ")} (sevk ${d.dispatchNo}).`,
      );
    }
  }

  // Hedefin açık+outstanding sevkleri — adım başına TEK alıcı sevk haritası.
  // splitBatch'te hedef yeni doğduğundan boş gelir; moveRolls'ta kalem birleştirme
  // hedefi budur. Retarget/yeni-doğan sevkler döngü içinde haritaya eklenir ki
  // aynı adımdaki SONRAKİ kaynaklar ona birleşsin (≤1 açık sevk değişmezi).
  const targetOpen = await tx.subcontractorDispatch.findMany({
    where: { batchId: params.targetBatchId, ...OPEN_OUTSTANDING },
    select: {
      id: true,
      dispatchNo: true,
      stepId: true,
      subcontractorId: true,
      subcontractor: { select: { name: true } },
      items: { select: { rollId: true, roll: { select: { barcode: true } } } },
    },
  });
  const targetByStep = new Map<
    string,
    { id: string; dispatchNo: string; subcontractorId: string; rollIds: Set<string> }
  >();
  for (const t of targetOpen) {
    targetByStep.set(t.stepId, {
      id: t.id,
      dispatchNo: t.dispatchNo,
      subcontractorId: t.subcontractorId,
      rollIds: new Set(t.items.map((i) => i.rollId)),
    });
  }

  // ── Guard (K15 mesaj kalıbı) — HİÇBİR mutasyondan önce: bir adımda kaynak
  // sevkleri + hedefin mevcut açık sevki FARKLI firmalara ise 409 (fiziksel
  // gerçek: mal iki ayrı firmada; firma çözümü F74 bozulur).
  const byStep = new Map<string, typeof affected>();
  for (const a of affected) {
    const arr = byStep.get(a.d.stepId) ?? [];
    arr.push(a);
    byStep.set(a.d.stepId, arr);
  }
  const conflicts: string[] = [];
  for (const [stepId, list] of byStep) {
    const firmLabels = new Map<string, string>();
    for (const a of list) {
      firmLabels.set(a.d.subcontractorId, `${a.d.subcontractor.name} (sevk ${a.d.dispatchNo})`);
    }
    const t = targetOpen.find((x) => x.stepId === stepId);
    if (t) {
      firmLabels.set(t.subcontractorId, `${t.subcontractor.name} (hedef sevk ${t.dispatchNo})`);
    }
    if (firmLabels.size > 1) {
      conflicts.push(`"${list[0].d.step.station.name}" adımında: ${[...firmLabels.values()].join(", ")}`);
    }
  }
  if (conflicts.length > 0) {
    throw AppError.conflict(
      `Taşıma/bölme yapılamaz — aynı fason adımında farklı firmalara açık sevkler var: ` +
        `${conflicts.join("; ")}. Önce mal kabul edilmeli ya da ilgili sevk iptal edilmeli.`,
    );
  }

  const now = new Date();
  for (const { d, movedItems } of affected) {
    result.touchedSourceBatchIds.add(d.batchId);
    const movedItemIds = movedItems.map((i) => i.id);
    const target = targetByStep.get(d.stepId);

    if (target) {
      // ── Dal 1: hedefin aynı adımda açık sevki var (guard gereği aynı firma) —
      // kalemler ORAYA birleşir. P2002 kesişim seddi (MINOR-1 deseni).
      const overlap = movedItems.filter((i) => target.rollIds.has(i.rollId));
      if (overlap.length > 0) {
        throw AppError.conflict(
          `Taşınamaz — sevk ${d.dispatchNo} ile ${target.dispatchNo} aynı top(lar)ı içeriyor: ` +
            `${overlap.map((i) => i.roll.barcode ?? i.rollId).join(", ")}. Sevk kayıtları tutarsız, önce düzeltilmeli.`,
        );
      }
      // ATOMİK CLAIM: kalem hâlâ kaynak sevkte mi (eşzamanlı cerrahi kaybedeni yakalar).
      const movedRes = await tx.subcontractorDispatchItem.updateMany({
        where: { id: { in: movedItemIds }, dispatchId: d.id },
        data: { dispatchId: target.id },
      });
      if (movedRes.count !== movedItemIds.length) {
        throw AppError.conflict(
          `Sevk ${d.dispatchNo} kalemleri bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
        );
      }
      for (const i of movedItems) target.rollIds.add(i.rollId);
      await recomputeTotalAndAppendNoteTx(
        tx,
        target.id,
        `K16: ${d.dispatchNo} sevkinden ${movedItems.length} kalem bu sevke birleştirildi (parti ${params.targetBatchNumber})`,
      );
      result.mergedItems.push({
        fromDispatchNo: d.dispatchNo,
        intoDispatchNo: target.dispatchNo,
        itemCount: movedItems.length,
      });

      const remaining = await tx.subcontractorDispatchItem.count({ where: { dispatchId: d.id } });
      if (remaining === 0) {
        // Kaynak sevk boşaldı → K15_MERGE-benzeri kapanış (atomik claim + irsaliye VOID).
        const reason = `K16_MOVE: kalemler ${target.dispatchNo} sevkine taşındı (parti ${params.targetBatchNumber})`;
        const closed = await tx.subcontractorDispatch.updateMany({
          where: { id: d.id, cancelledAt: null, directShippedAt: null },
          data: {
            cancelledAt: now,
            cancelledById: params.userId ?? null,
            cancelReason: reason,
            totalQty: new Prisma.Decimal(0),
          },
        });
        if (closed.count === 0) {
          throw AppError.conflict(
            `Sevk ${d.dispatchNo} bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
          );
        }
        await printedDocumentService.voidForSource(tx, PrintedDocType.SUBCONTRACTOR_DISPATCH, d.id, reason);
        result.closedDispatchNos.push(d.dispatchNo);
      } else {
        await recomputeTotalAndAppendNoteTx(
          tx,
          d.id,
          `K16: ${movedItems.length} kalem ${target.dispatchNo} sevkine taşındı (parti ${params.targetBatchNumber})`,
        );
      }
    } else if (movedItems.length === d.items.length) {
      // ── Dal 2a: sevkin TÜM kalemleri taşınıyor → kayıt OLDUĞU GİBİ retarget
      // (yeni belge doğmaz, dispatchNo/dispatchedAt/irsaliye aynen). ATOMİK CLAIM.
      const claim = await tx.subcontractorDispatch.updateMany({
        where: { id: d.id, batchId: d.batchId, cancelledAt: null, directShippedAt: null },
        data: { batchId: params.targetBatchId },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          `Sevk ${d.dispatchNo} bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
        );
      }
      targetByStep.set(d.stepId, {
        id: d.id,
        dispatchNo: d.dispatchNo,
        subcontractorId: d.subcontractorId,
        rollIds: new Set(d.items.map((i) => i.rollId)),
      });
      result.retargetedDispatchNos.push(d.dispatchNo);
    } else {
      // ── Dal 2b: KISMİ → hedef partiye bağlı YENİ sevk doğar. Meta kopya +
      // dispatchedAt = ORİJİNAL sevkin tarihi (fiziksel gerçek: mal o gün gitti);
      // dispatchNo bugünün sırasından YENİ üretilir.
      const newNo = await generateDispatchNoTx(tx, now);
      const splitNote = `K16: ${d.dispatchNo} sevkinden bölündü`;
      const born = await tx.subcontractorDispatch.create({
        data: {
          dispatchNo: newNo,
          workOrderId: d.workOrderId,
          batchId: params.targetBatchId,
          stepId: d.stepId,
          subcontractorId: d.subcontractorId,
          plannedSubcontractorId: d.plannedSubcontractorId,
          plateNumber: d.plateNumber,
          driverName: d.driverName,
          instruction: d.instruction,
          dispatchedAt: d.dispatchedAt,
          dispatchedById: d.dispatchedById,
          notes: d.notes ? `${d.notes} | ${splitNote}` : splitNote,
          totalQty: new Prisma.Decimal(0), // aşağıda kalem toplamından
        },
        select: { id: true },
      });
      const movedRes = await tx.subcontractorDispatchItem.updateMany({
        where: { id: { in: movedItemIds }, dispatchId: d.id },
        data: { dispatchId: born.id },
      });
      if (movedRes.count !== movedItemIds.length) {
        throw AppError.conflict(
          `Sevk ${d.dispatchNo} kalemleri bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
        );
      }
      // İki tarafın totalQty'si kalemlerden yeniden (yeni kayıt: düz update yeter).
      const aggBorn = await tx.subcontractorDispatchItem.aggregate({
        where: { dispatchId: born.id },
        _sum: { dispatchedQty: true },
      });
      await tx.subcontractorDispatch.update({
        where: { id: born.id },
        data: { totalQty: aggBorn._sum.dispatchedQty ?? new Prisma.Decimal(0) },
      });
      await recomputeTotalAndAppendNoteTx(
        tx,
        d.id,
        `K16: ${movedItems.length} kalem ${newNo} sevkine bölündü (parti ${params.targetBatchNumber})`,
      );
      // RESMİ BELGE: yeni sevkin irsaliyesi de dondurulur (dispatch() ile simetri;
      // basılı orijinal fasoncuda — bölünmüş sevk belgesi yeniden basılabilir).
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        born.id,
        params.userId,
      );
      targetByStep.set(d.stepId, {
        id: born.id,
        dispatchNo: newNo,
        subcontractorId: d.subcontractorId,
        rollIds: new Set(movedItems.map((i) => i.rollId)),
      });
      result.bornDispatches.push({ dispatchNo: newNo, fromDispatchNo: d.dispatchNo });
    }
  }

  return result;
}
