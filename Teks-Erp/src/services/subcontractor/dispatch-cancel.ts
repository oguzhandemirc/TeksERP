// =============================================================================
// TeksERP - Subcontractor (Fason) Service / dispatch-cancel
// =============================================================================
// Fason sevkin ters yolları: sevk iptali (tekil + toplu) ve aktarmayı geri alma.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { ACTIVE_OPERATION, revokeRollOperations } from "../helpers/roll-operation.helper";
import { revokeRollProperties } from "../helpers/property-revoke.helper";
import { ACTIVE_MOVEMENT, reopenClosedMovementsTx, revokeRollMovements } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { warehouseStampManyTx } from "../helpers/warehouse.helper";
import { MOVEMENT_DESC } from "../helpers/warehouse-ledger.helper";
import { reverseStockMove } from "../helpers/warehouse-ledger-reverse.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { ApiResponse } from "../../types/api.types";
import { PrintedDocType, RollOperationType, SubcontractorDispatchItemKind, RollStatus, StepStatus, ScanType, WarehouseEventType } from "@prisma/client";
import { printedDocumentService } from "../printed-document.service";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { resolveDispatchCancelBlockReason } from "../helpers/subcontractor-cancel.helper";
import { cancelWarpBeamItemsTx, countReturnedBeamItems } from "../subcontractor-beam.service";
import { cancelYarnItemsTx, countReturnedYarnItems } from "../subcontractor-yarn.service";
import { recomputeStepStatus, completeWorkOrderIfStepsDone } from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { OPEN_OUTSTANDING } from "../helpers/fason-open-dispatch.helper";
import { assertWorkOrderBound, workOrderBoundOnly } from "../helpers/dispatch-header.helper";
import { hasRoll } from "../helpers/dispatch-item-kind.helper";
import { assertRollsRevivable } from "../helpers/item-usage.helper";
import { logTravelerScan } from "./receive";
import type { SubcontractorServiceThis } from "./shared";

/**
 * Tek çağrıda iptal edilebilecek en fazla fason sevki. Bir iş emrinin açık sevk
 * sayısı parti sayısıyla sınırlıdır (K10: bir sevk = bir parti) — pratikte tek
 * haneli. Sınır sessiz kırpma DEĞİL, aşılırsa 400 döner.
 */
const BULK_DISPATCH_CANCEL_MAX = 50;

export async function cancel(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        items: true,
        step: { select: { id: true, status: true, stationId: true, workOrderId: true } },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // iş emri yolu iptali; dokuma sevki kendi servisinden iptal edilir

    // F1: levent kalemi top listesine girmez (null bağ); iptal yolu leventi ayrıca geri alır.
    const rollIds = dispatch.items.map((i) => i.rollId).filter((x): x is string => !!x);
    const hasBeamItems = dispatch.items.some((i) => i.kind === SubcontractorDispatchItemKind.WARP_BEAM);
    const hasYarnItems = dispatch.items.some((i) => i.kind === SubcontractorDispatchItemKind.YARN);
    // Dönmüş levent (açık RETURNED_IN) / dönmüş iplik sevk iptalini engeller — LIFO; önizleme ile aynı kaynak.
    const returnedBeamCount = hasBeamItems ? await countReturnedBeamItems(prisma, dispatchId) : 0;
    const returnedYarnCount = hasYarnItems ? await countReturnedYarnItems(prisma, dispatchId) : 0;

    // Mal kabul edilmiş sevk iptal edilemez (ReceiptItem.sourceDispatchItem
    // üzerinden bağlı). cancelledAt:null filtresi şart — iptal edilmiş receipt
    // ReceiptItem'larını da tutar; o durumda dispatch cancel'ı yanlış
    // engellenirdi ("önce kabulü iptal edin" derken zaten iptal edilmiş).
    const acceptedReceiptItem = await prisma.subcontractorReceiptItem.findFirst({
      where: {
        sourceDispatchItem: { is: { dispatchId } },
        receipt: { cancelledAt: null },
      },
      select: { receipt: { select: { receiptNo: true } } },
    });

    // Defansif state check: dispatch'te listelenen tüm rolls hala
    // AT_SUBCONTRACTOR + bu step'te olmalı. Bir şey "fason sevkten sonraki
    // adıma" geçtiyse (receive sonrası, admin manuel taşıma, scrap vs.)
    // dispatch iptali tutarsız state yaratır — engelle. ReceiptItem kontrolü
    // çoğu durumu yakalar; bu ek kontrol exotic durumlar (manuel müdahale)
    // ve cancelled-receipt-then-re-moved senaryoları için savunma derinliği.
    const movedRolls = await prisma.roll.findMany({
      where: {
        id: { in: rollIds },
        OR: [
          { status: { not: RollStatus.AT_SUBCONTRACTOR } },
          { currentStepId: { not: dispatch.stepId } },
        ],
      },
      select: { id: true, barcode: true, status: true, currentStepId: true },
    });

    // Bu sevkten müşteriye çıkmış mal var mı (kısmi/alt küme doğrudan sevk).
    // Damga (`directShippedAt`) yalnız TÜM toplar gidince basılır; kısmi sevkte
    // iz yalnız DSK kaydıdır.
    const directShipment = await prisma.directShipment.findFirst({
      where: { dispatchId },
      select: { shipmentNo: true },
      orderBy: { shippedAt: "asc" },
    });

    // Engel kararı TEK KAYNAKTAN (`resolveDispatchCancelBlockReason`) — iptal
    // önizlemesi (`getCancelImpact.openDispatches[].cancellable`) aynı yüklemi
    // çağırır. Kopyalanırsa ekran "iptal edilebilir" der, uç 409 verir.
    const blockReason = resolveDispatchCancelBlockReason({
      cancelledAt: dispatch.cancelledAt,
      directShipmentNo: directShipment?.shipmentNo ?? null,
      activeReceiptNo: acceptedReceiptItem?.receipt?.receiptNo ?? null,
      movedRollCount: movedRolls.length,
      returnedBeamCount,
      returnedYarnCount,
    });
    if (blockReason) {
      throw AppError.conflict(
        blockReason,
        movedRolls.length > 0 && !dispatch.cancelledAt && !acceptedReceiptItem
          ? {
              code: "ROLLS_MOVED_PAST_DISPATCH",
              movedRolls: movedRolls.map((r) => ({
                id: r.id,
                barcode: r.barcode,
                status: r.status,
                currentStepId: r.currentStepId,
              })),
            }
          : undefined,
      );
    }

    await prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — adım/WO yeniden
      // değerlendirmesi (openDispatchCount/remainingAtSub) eşzamanlı dispatch'le serileşsin.
      await touchWorkOrderTx(tx, dispatch.workOrderId);
      // 1) Dispatch'i soft-cancel — ATOMİK CLAIM: yukarıdaki guard'lar tx
      //    DIŞINDA; eşzamanlı çift iptal ikisinde de geçerdi. cancelledAt:null
      //    koşuluyla kaybeden burada 409 alır.
      // ⚠️ DSK KOŞULU CLAIM'İN İÇİNDE: yukarıdaki `directShipment` okuması tx
      // DIŞINDA ve bayat olabilir — eşzamanlı `executeDirectShip` kısmi sevk
      // yaparsa (çocuk toplar tüketilir, EBEVEYNLER fasonda kalır, damga basılmaz)
      // iptalin top claim'i ebeveynleri bulur ve iptal BAŞARIRDI: DSK ile tahsisler
      // iptal edilmiş sevke asılı kalır, karne müşteriye çıkmış metreyi kaybederdi.
      const cancelClaim = await tx.subcontractorDispatch.updateMany({
        where: { id: dispatchId, cancelledAt: null, directShipments: { none: {} } },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });
      if (cancelClaim.count === 0) {
        // Tanı TX İÇİNDE taze okunur ve mesaj TEK KAYNAKTAN gelir (önizlemeyle
        // simetri): "zaten iptal" ile "arada DSK oluştu" ayrı cümlelerdir.
        const taze = await tx.subcontractorDispatch.findUnique({
          where: { id: dispatchId },
          select: {
            cancelledAt: true,
            directShipments: { select: { shipmentNo: true }, orderBy: { shippedAt: "asc" }, take: 1 },
          },
        });
        throw AppError.conflict(
          resolveDispatchCancelBlockReason({
            cancelledAt: taze?.cancelledAt ?? new Date(),
            directShipmentNo: taze?.directShipments[0]?.shipmentNo ?? null,
            activeReceiptNo: null,
            movedRollCount: 0,
          }) ?? "Bu sevk az önce başka bir kullanıcı tarafından iptal edilmiş.",
        );
      }
      // Sevk iptal edildi → kartın parti bloğundaki "Sevk" sütunu boşalır (ya da
      // varsa bir önceki sevke düşer). Basılı kâğıt iptal edilmiş sevki gösteriyor.
      await markTravelerCardDirtyTx(tx, dispatch.workOrderId);

      // 1a) F1 LEVENT: SHIP_OUT_CANCEL (SHIPPED_OUT → READY) — dönmüş kalem tx İÇİNDE de 409 (LIFO;
      //     yukarıdaki sayım tx dışında ve bayat olabilir).
      if (hasBeamItems) {
        await cancelWarpBeamItemsTx(tx, { dispatchId, reason: trimmedReason, userId });
      }
      // 1a′) G1 İPLİK: SUBCONTRACT_OUT_CANCEL (depoya +kg) — dönmüş kalem tx İÇİNDE de 409 (LIFO).
      if (hasYarnItems) {
        await cancelYarnItemsTx(tx, { dispatchId, reason: trimmedReason, userId });
      }

      // 1b) RESMİ BELGE — irsaliye VOIDED'e çekilir (baskıda İPTAL filigranı).
      // Belge silinmez; tarihsel kayıt korunur.
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        dispatchId,
        trimmedReason
      );

      // 2) Toplar: STOCK + currentStepId temizle — ATOMİK CLAIM (movedRolls
      //    kontrolü tx dışında; eşzamanlı kabul/başka işlem pencerede araya
      //    girdiyse count uyuşmaz → 409 + rollback). batchId BİLİNÇLİ KORUNUR:
      //    parti üyeliği attach'te doğar, sevk iptali üyeliği bozmaz — iptal
      //    yalnız sevk belgesini geri alır; top aynı iş emrinde yeniden sevk
      //    edilirse aynı partiyle yola çıkar (lot kimliği kalıcı). Korunan
      //    batchId'nin BAŞKA iş emrinin sevkine sızması dispatch() içindeki
      //    cross-WO parti guard'ı (FOREIGN_BATCH → 400) ile engellenir.
      // Terfi topu STOK KÜMESİNE sokuyor ⇒ depo damgası terfinin parçası
      // (flip'ten ÖNCE; mevcut depoyu EZMEZ). Fasona çıkış yolunda depo kapısı
      // olmadığı için deposuz bir top tur atıp buradan stok kümesine dönebiliyordu.
      await warehouseStampManyTx(tx, rollIds);
      const reverted = await tx.roll.updateMany({
        where: {
          id: { in: rollIds },
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: dispatch.stepId,
        },
        data: { status: RollStatus.STOCK, currentStepId: null },
      });
      if (reverted.count !== rollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle (kabul/taşıma) değişmiş — sevk iptal edilemedi. Listeyi yenileyip tekrar deneyin."
        );
      }

      // 2b) STOK DEFTERİ — ters satır BAĞLI doğar (kartela emsali). Mal stok
      //     kümesine GERİ GİRDİ (`AT_SUBCONTRACTOR → STOCK`); bu yol 2026-09-13'e
      //     kadar deftere hiçbir şey yazmıyordu ve defter malı sonsuza kadar
      //     fasonda sayıyordu. Uçları `reverseStockMove` aynalar, yani geri dönüş
      //     deposu İLERİ SATIRDAN gelir — yukarıdaki `warehouseStampManyTx`
      //     varsayılan depoyu yazmış olabilir ve mal başka raftan çıkmış olabilir.
      //
      // ⚠️ İLERİ SATIR YOKSA HİÇBİR ŞEY YAZILMAZ (ufuktan önceki sevkler):
      //     bağsız bir giriş satırı, çıkışı hiç kaydedilmemiş malı stoğa EKLER ve
      //     Σ'yı şişirirdi. Kaydı olmayan çıkışın kaydı olmayan dönüşü — Σ tutarlı.
      for (const rollId of rollIds) {
        const ileri = await tx.warehouseMovement.findFirst({
          where: {
            rollId,
            eventType: WarehouseEventType.EXTERNAL,
            reasonCode: STOCK_MOVE_REASON.FASON_DISPATCH,
            reversesMovementId: null,
            reversedBy: { none: {} },
          },
          orderBy: MOVEMENT_DESC,
          select: { id: true },
        });
        if (!ileri) continue;
        await reverseStockMove(tx, ileri.id, {
          eventType: WarehouseEventType.EXTERNAL,
          reasonCode: STOCK_MOVE_REASON.FASON_DISPATCH_CANCEL,
          userId: userId ?? null,
          notes: trimmedReason,
        });
      }

      // 3) Açık RollMovement'ları CANCEL notuyla kapat — tek raw UPDATE (eski kod
      //    movement başına findMany+update = N+1; iptal edilen sevkte yüzlerce roll
      //    olabilir). notes per-row eski değere bağlı olduğundan CASE ile concat:
      //    doluysa "eski | CANCEL:x", boş/null ise "CANCEL:x".
      const cancelTag = `CANCEL:${dispatch.dispatchNo}`;
      await tx.$executeRaw`
        UPDATE "roll_movements"
        -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
        SET "exitedAt" = now(),
            "notes" = CASE
              WHEN "notes" IS NULL OR "notes" = '' THEN ${cancelTag}
              ELSE "notes" || ' | ' || ${cancelTag}
            END
        WHERE "rollId" = ANY(${rollIds}::uuid[])
          AND "workOrderStepId" = ${dispatch.stepId}::uuid
          AND "exitedAt" IS NULL
          AND "revokedAt" IS NULL
      `;

      // 4) SUBCONTRACTOR_SENT izini GERİ AL (silme değil — defter doktrini).
      await revokeRollOperations(tx, {
        rollIds,
        workOrderStepIds: [dispatch.stepId],
        operationTypes: [RollOperationType.SUBCONTRACTOR_SENT],
        reason: "FASON_SEVK_IPTAL",
        userId,
      });

      // 5) Adım durumunu yeniden değerlendir. Eski sayaç KABUL EDİLMİŞ sevkleri
      //    de "aktif" sayıyordu ve COMPLETED'a dönüş yolu yoktu: D1 tamamen
      //    kabul edildi + ek parti D2 iptal edildi → adım boş ama sonsuza dek
      //    ACTIVE kalıyor, WO hiç tamamlanamıyordu (tek kurtarma yeni fiziksel
      //    sevk ya da DB müdahalesiydi).
      if (dispatch.step.status === StepStatus.ACTIVE) {
        // Hâlâ AÇIK sevk (kabul görmemiş kalemi olan) veya bekleyen top var mı?
        // ⚠️ TEK KAYNAK (`OPEN_OUTSTANDING`) DAVRANIŞ DEĞİŞTİRİR: eski elle yazım
        //    `directShippedAt` süzgecini TAŞIMIYORDU, yani tamamen doğrudan-sevk
        //    edilmiş (mal fasondan müşteriye çıkmış, dönmeyecek) bir kardeş sevk
        //    adımı sonsuza dek ACTIVE tutuyordu. Artık o sevk "açık" sayılmaz →
        //    adım COMPLETED'a dönebilir. Fiziksel gerçekle uyumlu.
        const openDispatchCount = await tx.subcontractorDispatch.count({
          where: { stepId: dispatch.stepId, id: { not: dispatchId }, ...OPEN_OUTSTANDING },
        });
        const remainingAtSub = await tx.roll.count({
          where: { currentStepId: dispatch.stepId, status: RollStatus.AT_SUBCONTRACTOR },
        });
        if (openDispatchCount === 0 && remainingAtSub === 0) {
          const receiptCount = await tx.subcontractorReceipt.count({
            where: { stepId: dispatch.stepId, cancelledAt: null },
          });
          if (receiptCount > 0) {
            // Geçmişte kabul var → adım tamamlanmış sayılır (COMPLETED'a geri dön).
            await tx.workOrderStep.update({
              where: { id: dispatch.stepId },
              data: { status: StepStatus.COMPLETED, completedAt: new Date() },
            });
            // Bu adım WO'nun son eksik adımıysa WO'yu tamamla (receive'daki
            // kontrolün aynası — iptal sonrası WO IN_PROGRESS'te takılmasın).
            // Adım sayımı + kart geçişi helper'ın İÇİNDE; burada elle tekrarlama.
            await completeWorkOrderIfStepsDone(tx, dispatch.workOrderId, { trigger: "FASON_DISPATCH_CANCEL" });
          } else {
            // Hiç kabul yok → sevk öncesi duruma (PENDING) dön.
            await tx.workOrderStep.update({
              where: { id: dispatch.stepId },
              data: { status: StepStatus.PENDING, startedAt: null },
            });
          }
        }
      }

      // 6) Refakat kartı INFO scan (sevk iptal bildirimi)
      await logTravelerScan(
        tx,
        dispatch.workOrderId,
        dispatch.step.stationId,
        dispatch.stepId,
        ScanType.INFO,
        userId,
        `Fason sevk iptal: ${dispatch.dispatchNo} — ${trimmedReason}`
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: dispatchId,
      newData: {
        cancelled: true,
        cancelReason: trimmedReason,
        rolledBackRollCount: rollIds.length,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Sevk iptal edildi: ${dispatch.dispatchNo}`,
    };
  }

export async function cancelBulk(this: SubcontractorServiceThis, 
    input: { dispatchIds: string[]; reason: string },
    userId?: string
  ): Promise<
    ApiResponse<{
      cancelled: number;
      cancelledNos: string[];
      failed: Array<{ dispatchId: string; dispatchNo: string | null; message: string }>;
    }>
  > {
    const trimmedReason = input.reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }
    // Tekrarlı id gönderimi ikinci turda "zaten iptal edilmiş" hatası üretirdi —
    // kullanıcının görmediği bir çift tıklama, uydurma bir başarısızlık satırına
    // dönüşmemeli.
    const ids = [...new Set(input.dispatchIds)];
    if (ids.length === 0) {
      throw AppError.badRequest("İptal edilecek sevk seçilmedi");
    }
    if (ids.length > BULK_DISPATCH_CANCEL_MAX) {
      throw AppError.badRequest(
        `Tek seferde en fazla ${BULK_DISPATCH_CANCEL_MAX} sevk iptal edilebilir`
      );
    }

    // Sevk numaraları başarısızlık satırında da görünsün — kullanıcı "hangisi
    // atlandı" sorusunu id ile değil belge numarasıyla sorar. Bilinmeyen id de
    // `failed` satırıdır: tek yanlış id yüzünden 404 ile tüm çağrıyı düşürmek,
    // geri kalan 20 sevki sebepsiz yere fasonda bırakırdı.
    const known = workOrderBoundOnly(await prisma.subcontractorDispatch.findMany({
      where: { id: { in: ids } },
      select: { id: true, dispatchNo: true, workOrderId: true, dispatchedAt: true },
    })); // dokuma sevki bilinmeyen sayılır → `cancel()` 409'u satır bazında raporlar
    const byId = new Map(known.map((d) => [d.id, d]));

    // ⚠️ DETERMİNİSTİK SIRA — deadlock önlemi, süs değil. Bir toplu seçim çoğunlukla
    // AYNI iş emrinin partilerini taşır ve `cancel()` her satırda `touchWorkOrderTx`
    // ile o WO satırını kilitler. İki kullanıcı çakışan kümeleri farklı sırayla
    // gönderirse kilitler ters sırada alınır ve deadlock doğar. Global sıra bunu
    // yapısal olarak imkânsız kılar.
    const ordered = [...ids].sort((a, b) => {
      const da = byId.get(a);
      const db = byId.get(b);
      if (!da || !db) return da ? -1 : db ? 1 : a.localeCompare(b);
      if (da.workOrderId !== db.workOrderId) return da.workOrderId.localeCompare(db.workOrderId);
      const ta = da.dispatchedAt?.getTime() ?? 0;
      const tb = db.dispatchedAt?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    });

    const cancelledNos: string[] = [];
    const failed: Array<{ dispatchId: string; dispatchNo: string | null; message: string }> = [];

    // SIRALI koşar (Promise.all DEĞİL): her `cancel()` aynı WO satırını kilitler;
    // paralel çalıştırmak kilitleri rastgele sırada alıp deadlock üretirdi.
    for (const dispatchId of ordered) {
      const dispatchNo = byId.get(dispatchId)?.dispatchNo ?? null;
      try {
        await this.cancel(dispatchId, trimmedReason, userId);
        cancelledNos.push(dispatchNo ?? dispatchId);
      } catch (e) {
        // ⚠️ YALNIZ iş kuralı hatası `failed` satırına dönüşür. DB kesintisi ya da
        // programlama hatası (`AppError` olmayan her şey) YUTULMAZ — yoksa gerçek
        // bir arıza "2 sevk atlandı" diye rapor edilir ve kimse bakmaz.
        if (!(e instanceof AppError)) throw e;
        failed.push({ dispatchId, dispatchNo, message: e.message });
      }
    }

    return {
      success: true,
      data: { cancelled: cancelledNos.length, cancelledNos, failed },
      message:
        failed.length === 0
          ? `${cancelledNos.length} sevk iptal edildi, toplar depoya döndü`
          : `${cancelledNos.length} sevk iptal edildi, ${failed.length} tanesi atlandı`,
    };
  }

export async function getUndoTransferPreview(dispatchId: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        subcontractor: { select: { id: true, name: true } },
        step: {
          select: {
            id: true,
            stepSequence: true,
            station: { select: { name: true } },
            workOrder: { select: { id: true, workOrderNumber: true, status: true } },
          },
        },
        items: {
          select: {
            roll: {
              select: {
                id: true,
                barcode: true,
                currentQty: true,
                status: true,
                currentStepId: true,
                parentReceiptId: true,
                operations: { where: ACTIVE_OPERATION, select: { id: true, workOrderStepId: true, operationType: true } },
                movements: { where: ACTIVE_MOVEMENT, select: { exitedAt: true } },
                children: { select: { id: true }, take: 1 },
                dispatchItems: {
                  where: { dispatch: { is: { cancelledAt: null, id: { not: dispatchId } } } },
                  select: { id: true },
                  take: 1,
                },
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // transfer geri alma önizlemesi iş emri yolunda

    const targetStep = dispatch.step; // sonraki fason (ör. boyahane)
    const bornRolls = dispatch.items.filter(hasRoll).map((it) => it.roll);

    const reasons: string[] = [];
    if (dispatch.cancelledAt) reasons.push("Bu sevk zaten iptal edilmiş.");
    if (dispatch.directShippedAt) reasons.push("Bu sevk fasondan sevk edilmiş — geri alınamaz.");

    // Aktarım çıktısı mı? Tüm sevk topları born (parentReceiptId dolu) olmalı.
    const isTransferOutput =
      bornRolls.length > 0 && bornRolls.every((r) => r.parentReceiptId != null);
    if (!isTransferOutput) {
      reasons.push(
        "Bu sevk bir fason→fason aktarım çıktısı değil (doğrudan stok sevki). Bunun yerine 'Sevki İptal Et' kullanın.",
      );
    }

    // Born topların downstream güvenliği: TEK meşru op = bu adımdaki kendi
    // SUBCONTRACTOR_SENT'i; başka her şey "işlenmiş" demektir.
    if (isTransferOutput) {
      for (const r of bornRolls) {
        const tag = r.barcode ?? r.id.slice(0, 8) + "…";
        if (r.status !== RollStatus.AT_SUBCONTRACTOR || r.currentStepId !== targetStep.id) {
          reasons.push(`Top ${tag} artık ${targetStep.station.name}'de beklemiyor (durum: ${r.status}).`);
          continue;
        }
        const extraOps = r.operations.filter(
          (o) =>
            !(o.workOrderStepId === targetStep.id &&
              o.operationType === RollOperationType.SUBCONTRACTOR_SENT),
        );
        if (extraOps.length > 0) reasons.push(`Top ${tag} üzerinde işlem yapılmış.`);
        if (r.movements.some((m) => m.exitedAt !== null)) reasons.push(`Top ${tag} sonraki istasyona geçmiş.`);
        if (r.children.length > 0) reasons.push(`Top ${tag} Tambur'da bölünmüş.`);
        if (r.dispatchItems.length > 0) reasons.push(`Top ${tag} başka bir sevkte.`);
      }
    }

    // Kaynak kabul(ler) = born topların distinct parentReceiptId'si (paralel
    // partilerde farklı firmalardan birden çok olabilir).
    const sourceReceiptIds = [
      ...new Set(bornRolls.map((r) => r.parentReceiptId).filter((x): x is string => !!x)),
    ];
    const sourceReceipts = sourceReceiptIds.length
      ? await prisma.subcontractorReceipt.findMany({
          where: { id: { in: sourceReceiptIds } },
          select: {
            id: true,
            receiptNo: true,
            cancelledAt: true,
            step: { select: { id: true, stepSequence: true, station: { select: { name: true } } } },
            items: {
              select: {
                newRoll: {
                  select: {
                    id: true,
                    barcode: true,
                    currentQty: true,
                    status: true,
                    item: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        })
      : [];
    for (const sr of sourceReceipts) {
      if (sr.cancelledAt) reasons.push(`Kaynak kabul ${sr.receiptNo} zaten iptal edilmiş.`);
    }

    // SPLIT GUARD: undo, kaynak kabul(ler)i ATOMİK iptal eder (kabulün TÜM consumed
    // orijinallerini topluca canlandırır). Bu yalnız kabulün doğan TÜM topları bu
    // sevkte ise doğru. Born toplar birden çok sevke dağılmışsa (tek receipt → >1
    // dispatch) veya kısmen ileri taşınmışsa, bu sevki geri almak orijinalleri
    // canlandırırken DİĞER sevkteki kardeş born topları öksüz bırakır + malzemeyi
    // çift sayar → reddet.
    if (isTransferOutput && sourceReceiptIds.length) {
      const bornIdSet = bornRolls.map((r) => r.id);
      const strayBorn = await prisma.roll.count({
        where: {
          parentReceiptId: { in: sourceReceiptIds },
          status: { not: RollStatus.CANCELLED },
          id: { notIn: bornIdSet },
        },
      });
      if (strayBorn > 0) {
        reasons.push(
          "Kaynak kabulden doğan toplar birden çok sevke dağılmış (veya kısmen işlenmiş) — bu aktarım tek başına geri alınamaz; önce diğer sevk(ler)i geri alın.",
        );
      }
    }

    const sourceStationName = sourceReceipts[0]?.step?.station?.name ?? null;

    return {
      success: true,
      data: {
        dispatchId,
        dispatchNo: dispatch.dispatchNo,
        safe: reasons.length === 0,
        blockingReasons: reasons,
        subcontractorName: dispatch.subcontractor.name,
        workOrder: targetStep.workOrder,
        targetStationName: targetStep.station.name,
        sourceStationName,
        bornRolls: bornRolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: Number(r.currentQty),
          status: r.status,
          itemCode: r.item?.code ?? "",
          itemName: r.item?.name ?? "",
          colorName: r.color?.name ?? null,
        })),
        sourceReceipts: sourceReceipts.map((sr) => ({
          id: sr.id,
          receiptNo: sr.receiptNo,
          stationName: sr.step?.station?.name ?? null,
          originalRolls: sr.items.map((it) => ({
            id: it.newRoll.id,
            barcode: it.newRoll.barcode,
            currentQty: Number(it.newRoll.currentQty),
            status: it.newRoll.status,
            itemCode: it.newRoll.item?.code ?? "",
            itemName: it.newRoll.item?.name ?? "",
          })),
        })),
      },
    };
  }

export async function undoTransfer(
    dispatchId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; dispatchNo: string }>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("Geri alma sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        step: { select: { id: true, stationId: true, workOrderId: true } },
        items: {
          select: { roll: { select: { id: true, parentReceiptId: true } } },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // transfer geri alma iş emri yolunda
    if (dispatch.cancelledAt) throw AppError.conflict("Bu sevk zaten iptal edilmiş");
    if (dispatch.directShippedAt) {
      throw AppError.conflict("Fasondan sevk edilmiş sevk geri alınamaz");
    }

    const targetStep = dispatch.step; // boyahane
    const bornRolls = dispatch.items.filter(hasRoll).map((it) => it.roll);
    const bornRollIds = bornRolls.map((r) => r.id);
    if (bornRollIds.length === 0) throw AppError.badRequest("Bu sevkte top yok");

    if (!bornRolls.every((r) => r.parentReceiptId != null)) {
      throw AppError.badRequest(
        "Bu sevk bir fason→fason aktarım çıktısı değil. Bunun yerine 'Sevki İptal Et' kullanın.",
      );
    }
    const sourceReceiptIds = [
      ...new Set(bornRolls.map((r) => r.parentReceiptId).filter((x): x is string => !!x)),
    ];
    const workOrderId = targetStep.workOrderId;

    await prisma.$transaction(async (tx) => {
      // WO satırını kilitle — adım recompute'u eşzamanlı dispatch/receive ile serileşsin.
      await touchWorkOrderTx(tx, workOrderId);

      // 1) Born topların TAZE güvenlik kontrolü (downstream yok + hâlâ boyahanede +
      //    bu sevkin lane'inde). Preview ile tx arasında boyahane operatörü kabul/
      //    işlem yapmış olabilir.
      const freshBorn = await sequentialTx(tx).roll.findMany({
        where: { id: { in: bornRollIds } },
        select: {
          id: true,
          status: true,
          currentStepId: true,
          batchId: true,
          operations: { where: ACTIVE_OPERATION, select: { id: true, workOrderStepId: true, operationType: true } },
          movements: { where: ACTIVE_MOVEMENT, select: { exitedAt: true } },
          children: { select: { id: true }, take: 1 },
          dispatchItems: {
            where: { dispatch: { is: { cancelledAt: null, id: { not: dispatchId } } } },
            select: { id: true },
            take: 1,
          },
        },
      });
      for (const r of freshBorn) {
        if (
          r.status !== RollStatus.AT_SUBCONTRACTOR ||
          r.currentStepId !== targetStep.id ||
          r.batchId !== dispatch.batchId
        ) {
          throw AppError.conflict(
            `Top ${r.id.slice(0, 8)}… artık aktarım geri almaya uygun değil (durum değişmiş). Listeyi yenileyin.`,
          );
        }
        const extraOps = r.operations.filter(
          (o) =>
            !(o.workOrderStepId === targetStep.id &&
              o.operationType === RollOperationType.SUBCONTRACTOR_SENT),
        );
        if (
          extraOps.length > 0 ||
          r.movements.some((m) => m.exitedAt !== null) ||
          r.children.length > 0 ||
          r.dispatchItems.length > 0
        ) {
          throw AppError.conflict(
            `Top ${r.id.slice(0, 8)}… bu sırada işlenmiş — aktarım geri alınamaz.`,
          );
        }
      }

      // SPLIT GUARD (tx-içi taze): kaynak kabul(ler) ATOMİK geri alınır (TÜM consumed
      // orijinaller canlanır), bu yüzden kabulün doğan TÜM topları bu sevkte olmalı.
      // Born toplar birden çok sevke dağılmışsa (tek receipt → >1 dispatch) veya kısmen
      // ileri taşınmışsa, orijinalleri topluca canlandırmak diğer sevkteki kardeş born
      // topları öksüz bırakır + malzemeyi çift sayar. bornRollIds bu noktada hâlâ
      // AT_SUBCONTRACTOR (henüz CANCELLED değil) → notIn + status!=CANCELLED canlı strayı yakalar.
      const strayBorn = await tx.roll.count({
        where: {
          parentReceiptId: { in: sourceReceiptIds },
          status: { not: RollStatus.CANCELLED },
          id: { notIn: bornRollIds },
        },
      });
      if (strayBorn > 0) {
        throw AppError.conflict(
          "Bu sevkin kaynak kabulünden doğan toplar birden çok sevke dağılmış (veya kısmen işlenmiş) — aktarım tek başına geri alınamaz. Önce diğer sevk(ler)i geri alın veya manuel düzeltin.",
        );
      }

      // 2) Boyahane sevkini geri al (soft-cancel + belge void)
      const cancelClaim = await tx.subcontractorDispatch.updateMany({
        where: { id: dispatchId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: `AKTARIM GERİ ALMA: ${trimmedReason}`,
        },
      });
      if (cancelClaim.count === 0) {
        throw AppError.conflict("Bu sevk az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }
      // Aktarım geri alma da bir sevk iptalidir → kart "Sevk" sütunu bayat.
      await markTravelerCardDirtyTx(tx, workOrderId);
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        dispatchId,
        trimmedReason,
      );

      // Born topların boyahane izini geri al (op + movement damgalanır, inherit
      // property silinir), sonra CANCELLED'a çek (atomik claim).
      await revokeRollOperations(tx, {
        rollIds: bornRollIds,
        workOrderStepIds: [targetStep.id],
        operationTypes: [RollOperationType.SUBCONTRACTOR_SENT],
        reason: "FASON_TRANSFER_GERI_AL",
        userId,
      });
      await revokeRollMovements(tx, {
        rollIds: bornRollIds,
        workOrderStepIds: [targetStep.id],
        reason: "FASON_TRANSFER_GERI_AL",
        userId,
      });
      // RollProperty SİLİNMEZ, DAMGALANIR (③a, Faz 2e): kardeş `revokeRollMovements`
      // ile aynı sebep — born top CANCELLED'a giderken özelliği damgalı durur.
      await revokeRollProperties(tx, { rollIds: bornRollIds, reason: "FASON_TRANSFER_GERI_AL", userId });
      const cancelledBorn = await tx.roll.updateMany({
        where: {
          id: { in: bornRollIds },
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: targetStep.id,
          batchId: dispatch.batchId,
        },
        data: { status: RollStatus.CANCELLED, currentStepId: null, cancelledAt: new Date(), cancelledById: userId ?? null },
      });
      if (cancelledBorn.count !== bornRollIds.length) {
        throw AppError.conflict(
          "Born toplardan biri bu sırada değişmiş — aktarım geri alınamadı. Listeyi yenileyin.",
        );
      }

      // 3) Kaynak kabul(ler)i geri al — orijinaller AT_SUBCONTRACTOR'a, kaynak
      //    fason adımına döner (batchId DOKUNULMAZ → zımpara lane'i kendiliğinden
      //    geri gelir; receive consume'da değişmemişti).
      const sourceStepIds = new Set<string>();
      for (const receiptId of sourceReceiptIds) {
        const receipt = await sequentialTx(tx).subcontractorReceipt.findUnique({
          where: { id: receiptId },
          select: {
            id: true,
            workOrderId: true,
            receiptNo: true,
            stepId: true,
            cancelledAt: true,
            step: { select: { stationId: true } },
            items: { select: { newRollId: true } },
          },
        });
        if (!receipt) throw AppError.conflict("Kaynak kabul belgesi bulunamadı.");
        assertWorkOrderBound(receipt, "Kaynak kabul belgesi");
        if (receipt.cancelledAt) {
          throw AppError.conflict(`Kaynak kabul ${receipt.receiptNo} zaten iptal edilmiş.`);
        }
        const origRollIds = receipt.items.map((it) => it.newRollId);
        sourceStepIds.add(receipt.stepId);

        const rClaim = await tx.subcontractorReceipt.updateMany({
          where: { id: receiptId, cancelledAt: null },
          data: {
            cancelledAt: new Date(),
            cancelledById: userId ?? null,
            cancelReason: `AKTARIM GERİ ALMA: ${trimmedReason}`,
          },
        });
        if (rClaim.count === 0) {
          throw AppError.conflict(`Kaynak kabul ${receipt.receiptNo} az önce iptal edilmiş.`);
        }

        // Kapatılmış dönüş movement'larını geri aç (RETURNED_VIA_RECEIPT notuyla).
        await reopenClosedMovementsTx(tx, {
          where: {
            workOrderStepId: receipt.stepId,
            rollId: { in: origRollIds },
            notes: `RETURNED_VIA_RECEIPT:${receipt.receiptNo}`,
          },
          reason: "FASON_TRANSFER_GERI_AL",
          notes: `REOPENED_FROM_RECEIPT:${receipt.receiptNo}`,
          userId: userId ?? null,
        });

        // Dirilme: kart Pasif olamaz (S5) — DB seddinin uygulama ikizi, çıkış yolunu söyler.
        await assertRollsRevivable(tx, origRollIds);
        const revertedOrig = await tx.roll.updateMany({
          where: { id: { in: origRollIds }, status: RollStatus.SUBCONTRACTOR_CONSUMED },
          data: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: receipt.stepId },
        });
        if (revertedOrig.count !== origRollIds.length) {
          throw AppError.conflict(
            "Kaynak orijinal toplardan biri bu sırada değişmiş — geri alınamadı. Listeyi yenileyin.",
          );
        }

        await revokeRollOperations(tx, {
          rollIds: origRollIds,
          workOrderStepIds: [receipt.stepId],
          operationTypes: [RollOperationType.SUBCONTRACTOR_RETURNED],
          reason: "FASON_KABUL_IPTAL",
          userId,
        });
        await tx.subcontractorReceiptProperty.deleteMany({ where: { receiptId } });

        await logTravelerScan(
          tx,
          workOrderId,
          receipt.step.stationId,
          receipt.stepId,
          ScanType.INFO,
          userId,
          `Aktarım geri alma — kaynak kabul iptal: ${receipt.receiptNo}`,
        );
      }

      // 4) Adım statülerini yeniden hesapla: kaynak fason → ACTIVE (orijinaller
      //    geri döndü), boyahane → PENDING (born toplar gitti).
      for (const sId of sourceStepIds) {
        await recomputeStepStatus(tx, sId);
      }
      await recomputeStepStatus(tx, targetStep.id);

      // 5) Refakat kartı INFO (boyahane adımında geri-alma bildirimi)
      await logTravelerScan(
        tx,
        workOrderId,
        targetStep.stationId,
        targetStep.id,
        ScanType.INFO,
        userId,
        `Aktarım geri alındı: ${dispatch.dispatchNo} — ${trimmedReason}`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: dispatchId,
      newData: {
        undoTransfer: true,
        dispatchNo: dispatch.dispatchNo,
        cancelledReceiptIds: sourceReceiptIds,
        cancelledBornCount: bornRollIds.length,
        reason: trimmedReason,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Aktarım geri alındı: ${dispatch.dispatchNo} — mal kaynak fasona geri döndü.`,
    };
  }
