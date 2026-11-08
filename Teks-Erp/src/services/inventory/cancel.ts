// =============================================================================
// Inventory Service / cancel
// =============================================================================
// Top iptali: iptal önizlemesi, softDelete (iptal/fire) ve paylaşılan iptal kaydı tx'i (cancelRollRecordTx).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (inventory/list.ts sayılır) */

import { auditCutReadings, revokeCutReadingsTx, ROLL_CANCEL_CUT_REASON } from "../helpers/meter-reading.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { cancelConsumedForRollTx } from "../warp-beam-auto-consume.service";
import { AuditService } from "../audit.service";
import {
  postStockMove,
  qtyYazilabilir,
} from "../helpers/warehouse-ledger.helper";
import { assertRollsHaveWarehouse, WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  resolveCancelReasonRequired,
} from "../system-setting.service";
import {
  Prisma,
  Roll,
  RollStatus,
  RollVarianceKind,
  GoodsReceiptStatus,
  StationKind,
  StepStatus,
  ShipmentStatus,
  ReasonPresetKind,
  WarehouseEventType,
} from "@prisma/client";
import { resolveReasonCode } from "../reason-preset.service";
import { assertCancelReasonTx } from "../helpers/cancel-reason.helper";
// Fire sebebi metin SAKLAMAYAN bir kind'tır → sapma kataloğunun senkron kapısı.
import { validateVarianceReason } from "../../constants/variance-reasons";
// G2 (2026-08-14): tekil top iptali alış siparişi rollup'ını tetikler.
// Yön TEK TARAFLI (inventory → purchase-order); purchase-order.service
// inventory'yi import ETMEZ — döngü yok (goods-receipt.service ikisini
// birden import eden üst katmandır).
import { syncPurchaseOrderSafely } from "../purchase-order.service";
import {
  recomputeStepStatus,
} from "../helpers/roll-step.helper";
import { collectRollStepScopeTx } from "../helpers/roll-step-scope.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { uyari } from "../../lib/logger";
import { TERIM } from "../../constants/terim";

/**
 * Top iptal (soft-delete) önizlemesi — operatöre silmeden ÖNCE gösterilir.
 * Yıkıcı işlem kuralı: somut etki (top hangi istasyonda/iş emrinde aktif)
 * net listelenir, soyut "X kayıt etkilenecek" yetmez. softDelete'in guard
 * sırasıyla birebir aynı mantık döner.
 */
export interface RollCancelPreview {
  rollId: string;
  barcode: string | null;
  status: RollStatus;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  /** Hard-block yoksa true — operatör (gerekirse onaylayarak) iptal edebilir. */
  canCancel: boolean;
  /** canCancel=false ise neden (Türkçe, softDelete mesajıyla aynı). */
  blockReason: string | null;
  /** `production.cancelReasonRequired` etkin mi — form sebep alanını zorunlu işaretler; kapı sunucuda (400 CANCEL_REASON_REQUIRED). */
  reasonRequired: boolean;
  /**
   * İstasyonda / iş emrinde aktif top mu? true ise iptal için bilinçli onay
   * (confirmActive) ŞART — uyarısız sessiz iptali engeller.
   */
  requiresConfirm: boolean;
  /** Aktifse şu an nerede (istasyon + iş emri). */
  activeAt: {
    stepId: string;
    stationName: string | null;
    stationKind: StationKind | null;
    workOrderId: string;
    batchNumber: string | null;
  } | null;
  /** Kapanmamış (açık) hareket sayısı. */
  openMovementCount: number;
  /**
   * Topun ÜSTÜNDE fiziksel etiket var mı (`labelPrintedAt != null`).
   *
   * ⚠️ 2026-08-25'ten beri BİLGİDİR, KAPI DEĞİL: ölü etiket onayı kaldırıldı
   * (gerekçe `softDelete` içinde). Alan duruyor çünkü "hangi topların kâğıdı
   * sahada kaldı" sorusu bir gün sorulabilir ve cevabı ücretsiz. İstemci bunu
   * gösterebilir ama üzerine bir onay kutusu KURMAMALI.
   */
  labelPrinted: boolean;
  /** Etiketin basıldığı an (varsa) — operatöre "10:48'de bastınız" diyebilmek için. */
  labelPrintedAt: Date | null;
}

/**
 * F112: Operatör iptalinin (softDelete) izin verdiği statü beyaz listesi.
 * Yalnız operasyonel (henüz sevk/tüketim muhasebesi işlenmemiş) toplar iptal
 * edilebilir. SHIPPED / *_CONSUMED / AT_KARTELA / AT_SUBCONTRACTOR bu listede
 * DEĞİL — bunların geri alınması ilgili modülün işidir (iade, fason/kartela
 * kabul), yoksa sevk edilmiş mal canlı veride "hiç olmamış" olur.
 * softDelete ve getCancelPreview bu tek kaynağı paylaşır (guard paritesi).
 */
const CANCELABLE_ROLL_STATUSES: RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.IN_PRODUCTION,
  RollStatus.A1_STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** İptal edilemeyen statü için operatöre net Türkçe gerekçe. */
function nonCancelableRollReason(status: RollStatus): string {
  switch (status) {
    case RollStatus.SHIPPED:
      return "Bu top müşteriye sevk edilmiş — iptal edilemez. Geri almak için İade akışını kullanın.";
    case RollStatus.TAMBUR_CONSUMED:
      return "Bu top Tambur'da bölünüp çocuk toplara dönüştürülmüş — iptal edilemez.";
    case RollStatus.KARTELA_CONSUMED:
      return "Bu top kartelalara bölünüp kapatılmış — iptal edilemez.";
    case RollStatus.SUBCONTRACTOR_CONSUMED:
      return "Bu top fason kabulde kapatılmış — iptal edilemez.";
    case RollStatus.AT_KARTELA:
      return "Bu top kartela fasonunda işlemde — iptal edilemez, önce kartela kabulü yapın.";
    default:
      return `Bu top '${status}' durumunda — iptal edilemez.`;
  }
}

/** Top iptalinde açık hareketleri kapatır — `cancelRollRecordTx`in parçası (aynı tx, aynı sıra). */
async function closeOpenMovementsOnCancelTx(tx: Prisma.TransactionClient, existing: Roll, isScrap: boolean): Promise<void> {
  const id = existing.id;
  // Açık RollMovement'ları topla — kapatmak için (kapsam yukarıda çözüldü).
  const openMovements = await tx.rollMovement.findMany({
    where: { ...ACTIVE_MOVEMENT, rollId: id, exitedAt: null },
    select: {
      id: true,
      workOrderStepId: true,
      notes: true,
      qtyIn: true,
      weightIn: true,
    },
  });

  // Açık movement'ları kapat.
  //
  // qtyOut = 0 LOAD-BEARING: "mal bu istasyondan HİÇ geçmedi" (storno).
  // Kurtarma/dispozisyonun qtyOut = qtyIn semantiğinden bilinçli farklıdır —
  // orada mal gerçekten vardı ve çıktı, burada kayıt baştan hatalıydı.
  //
  // ⚠️ NOT EZİLMİYOR (2026-08-04): eskiden notes körlemesine "CANCELLED"
  // yazılıyordu ve elle eklenen topun hareketindeki "TAMBUR_MANUAL_ROLL:
  // <sebep>" izi SİLİNİYORDU. Topun entryReason kolonu ve audit'i kalsa da
  // hareket geçmişi "neden vardı" sorusunu cevaplayamaz hâle geliyordu —
  // tam da iptal edilen bir kaydı sonradan incelerken en çok gereken bilgi.
  // Artık eski not parantez içinde korunur.
  //
  // ⚠️ FİRE'DE STORNO YOK: `qtyOut = qtyIn` — mal o istasyondan GERÇEKTEN
  // geçti, sonra fire oldu. 0 yazmak istasyonun iş hacminden metrajı geriye
  // dönük siler ve üretim raporunda hayalet kayıp yaratır. Dispozisyon
  // motorunun SCRAP dalıyla birebir aynı sözleşme (`applyRollDispositionsTx`).
  const closeNote = isScrap ? "SCRAPPED" : "CANCELLED";
  for (const m of openMovements) {
    await tx.rollMovement.update({
      // Geri alınmış satır kapatılmaz; araya giren geri alma P2025 verir (silinmiş satırla aynı).
      where: { id: m.id, ...ACTIVE_MOVEMENT },
      data: {
        exitedAt: new Date(),
        qtyOut: isScrap ? m.qtyIn ?? existing.currentQty : 0,
        weightOut: isScrap ? m.weightIn ?? existing.weightKg : 0,
        notes: m.notes?.trim()
          ? `${closeNote} (${m.notes.trim()})`.slice(0, 500)
          : closeNote,
      },
    });
  }
}

/**
 * Top iptalinin (CANCEL "hiç yoktu" / SCRAP "vardı, gitti") TX GÖVDESİ — tek yazar: `softDelete` ve gelen belge
 * iptali (K15) aynı fonksiyondan geçer. Guard'lar, sebep çözümü ve audit ÇAĞIRANINDIR; claim gözlenen statüyle atomiktir.
 */
export interface RollCancelTxInput {
  existing: Roll;
  isScrap: boolean;
  userId?: string;
  cancelReasonText: string | null;
  cancelReasonCode: string | null;
}

export async function cancelRollRecordTx(tx: Prisma.TransactionClient, p: RollCancelTxInput) {
  const { existing, isScrap, userId, cancelReasonText, cancelReasonCode } = p;
  const id = existing.id;
  const targetStatus = isScrap ? RollStatus.SCRAP : RollStatus.CANCELLED;
  // D4-B1b TERS YOL: iptal ("hiç yoktu") Tambur CUT okumasını aynı tx'te damgalar (elle eklenen topun geri
  // alması bu yoldan geçer); SCRAP'ta ölçüm gerçekti, dokunulmaz.
  let cutReadingsRevoked: string[] = [];
  // ── ETKİ ALANI (2026-08-15 düzeltmesi) ───────────────────────────────
  // Eskiden burada küme ELLE kuruluyordu: "AÇIK hareketlerin adımları +
  // currentStepId". İkisi de topun ŞU ANKİ konumuna bakıyordu, oysa
  // `recomputeStepStatus` topun statüsünü ÜÇ yerden okur — açık hareket,
  // KAPALI hareket ve "aynı iş emrinde bu adıma henüz gelmemiş canlı top"
  // sayacı. Yani bir topu iptal etmek, onun GEÇMİŞTE geçtiği (hareketi
  // kapanmış) adımların ve hiç uğramadığı kardeş adımların türetilen
  // değerini de değiştirir.
  //
  // SAHA VAKASI (IE0608260004, canlı veride doğrulandı): T080826F0001
  // 6 Ağu'da "Kurşun + KK2" adımından ÇIKTI (hareket kapandı, adım
  // COMPLETED oldu); 8 Ağu'da iş emri kapanış dispozisyonu topu WAREHOUSE'a
  // çekti (`currentStepId = null`, açık hareket kalmadı); 22 saniye sonra
  // top iptal edildi. Eski küme BOŞ kaldı → recompute HİÇ koşmadı → adım
  // bayat COMPLETED kaldı (türetilen doğru değer PENDING). Hata yok, log
  // yok; drift'i yalnız `test_consistency` §20 gösteriyordu.
  //
  // Kapsam artık TEK KAYNAKTAN (`collectRollStepScopeTx`) gelir — dört
  // çağıran dört farklı elle liste kurduğu için hata dört kez tekrarlanmıştı.
  const scope = await collectRollStepScopeTx(tx, [id], [existing.currentStepId]);

  // Kilit sırası DETERMİNİSTİK (yardımcı id ASC döner): bir top İKİ ayrı iş
  // emrinde hareket etmiş olabilir (fason tüketimi) ve aynı tx iki WO'nun
  // adımlarına yazar. Sabit sıra deadlock'ı yapısal olarak keser;
  // `completeWorkOrderIfStepsDone` docstring'i de bu kilidi şart koşuyor.
  for (const woId of scope.workOrderIds) await touchWorkOrderTx(tx, woId);

  await closeOpenMovementsOnCancelTx(tx, existing, isScrap);

  // Top: CANCELLED + currentStepId temizle — ATOMİK CLAIM (M-30): tüm
  // guard'lar (fason/açık sevk/aktif sevkiyat) tx DIŞINDA okundu; pencerede
  // fason dispatch claim'i veya çuvala okutma (shipmentId claim'i) commit
  // ettiyse top fasondayken/çuvaldayken iptal edilirdi. Gözlenen statü +
  // shipmentId koşuluyla kaybeden 409 alır (atomik claim deseni); shipmentId
  // de temizlenir (CANCELLED top sevkiyat rezervi taşıyamaz).
  const cancelClaim = await tx.roll.updateMany({
    where: { id, status: existing.status, shipmentId: existing.shipmentId },
    data: {
      // Hedef statü MODA göre: CANCELLED ("hiç yoktu") · SCRAP ("vardı, gitti").
      status: targetStatus,
      currentStepId: null,
      shipmentId: null,
      sackId: null,
      // ÇIKIŞ İZİ topun KENDİ satırında (audit'te DEĞİL — audit 6 ayda
      // arşivlenir ve "neden düştü" sorusu cevapsız kalırdı).
      //
      // ⚠️ Bu beş kolon HER İKİ MODU da taşır (2026-08-25). Adları "cancel"
      // olsa da anlamları "defterden düşme izi"dir; hangi mod olduğu `status`
      // (CANCELLED vs SCRAP) ile okunur — ayrım tek ve kesin. Ayrı
      // `scrapReason*` kolonları AÇILMADI: canlı DB'ye migration eklemenin
      // karşılığı yalnız kolon adının hoşluğu olurdu.
      // `preCancelStatus` = geri almanın döneceği raf; `preShipStatus` emsali,
      // körlemesine STOCK'a dönmek A1_STOCK/WAREHOUSE topunu yanlış rafa yazardı.
      // Geri alma YALNIZ CANCELLED'ta çalışır (`resolveRollRestoreBlockReason`
      // ilk ifadesi statüyü kontrol eder) → fire geri alınamaz, doğrusu da bu.
      cancelledAt: new Date(),
      cancelledById: userId ?? null,
      cancelReason: cancelReasonText,
      cancelReasonCode,
      preCancelStatus: existing.status,
    },
  });
  if (cancelClaim.count === 0) {
    throw AppError.conflict("Top bu sırada başka bir işleme girdi (sevk/çuval/fason olabilir) — tekrar deneyin.");
  }
  const r = await tx.roll.findUniqueOrThrow({ where: { id } });
  // LEVENT TÜKETİMİ TERS YOLU (Faz 4): yalnız İPTAL ("hiç yoktu") — SCRAP'ta çözgü gerçekten tüketildi, dokunulmaz.
  if (!isScrap && r.doffEventId) await cancelConsumedForRollTx(tx, id, cancelReasonText ?? "top iptali", userId ?? null);
  if (!isScrap) cutReadingsRevoked = await revokeCutReadingsTx(tx, { rollIds: [id], userId: userId ?? null, reason: ROLL_CANCEL_CUT_REASON });

  // DEPO DEFTERİ — mal depodan DÜŞTÜ (kayıt hatalıydı ya da fire).
  // `warehouseId` BİLEREK temizlenmez: "en son hangi depodaydı" izi kalsın ve
  // iptal geri alınırsa (restoreCancelled) top rafına dönebilsin.
  // ⚠️ STOK DEFTERİ KAPISI (eski kapı değil): satır artık İKİ UCUNDAKİ
  // STATÜYÜ taşır. Eski kapı statüsüz satır yazıyordu ve bunun bedeli
  // ölçüldü — ucu kurulamayan satır TERSLENEMİYOR, dolayısıyla iptali geri
  // alma defteri kalıcı olarak eksik bırakıyordu (75 m ölçümü, 2026-09-12).
  //
  // ⚠️ Satır YALNIZ stok kümesinden düşen mal için yazılır: `IN_PRODUCTION`
  // ya da `AT_SUBCONTRACTOR` bir top iptal edilirken stoktan bir şey
  // düşmez (o mal zaten stok dışındaydı) — eski kapı burada da koşulsuz
  // yazıyordu ve depoya girmemiş malı düşmüş gösteriyordu.
  //
  // ⚠️ 0 metrajlı topun iptali MÜMKÜN olmalı (fabrikada 52 böyle top) ve o
  // durumda yazılacak hareket YOKTUR. Atlandığı SESSİZ KALMAZ: dönen değer
  // audit yüküne yazılır.
  const ledgerRowWritten =
    r.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(existing.status) && qtyYazilabilir(r.currentQty);
  if (ledgerRowWritten) {
    await postStockMove(tx, {
      rollId: id,
      eventType: WarehouseEventType.CANCEL,
      qty: r.currentQty,
      // Çıkış ucu: topun İPTAL ÖNCESİ statüsü (`preCancelStatus` ile aynı
      // kaynak) — "CANCELLED'dan çıktı" demek yanlış olurdu.
      from: { warehouseId: r.warehouseId!, status: existing.status },
      reasonCode: STOCK_MOVE_REASON.ROLL_CANCEL,
      userId: userId ?? null,
      notes: cancelReasonText ? cancelReasonText.slice(0, 300) : null,
    });
  }

  // Etkilenen step'lerin status'unu recompute et.
  //
  // ⚠️ SIRA LOAD-BEARING: recompute ATOMİK CLAIM'den SONRA koşmak ZORUNDA —
  // sayaçları topun statüsünden okuyor, top henüz CANCELLED değilse eski
  // (yanlış) değeri hesaplar.
  //
  // ⚠️ `completedAt` VERİ KAYBI, BİLİNÇLİ KABUL: `recomputeStepStatus`
  // COMPLETED'tan düşen adımda `completedAt: null` yazar (roll-step.helper).
  // Adımın gerçekten bittiği tarih geri dönülemez silinir. Alternatif
  // ("damgayı koru") COMPLETED olmayan ama completedAt dolu adımlar üretir
  // ve bugün böyle satır YOK — yani yeni bir tutarsızlık SINIFI açardı.
  // Bunun yerine eski değer aşağıda AUDIT'e yazılır (audit zaten tx dışında,
  // alan eklemek bedava). Karar `recomputeStepStatus`'un TÜM çağıranlarını
  // ilgilendirir; burada tek taraflı değiştirilmedi.
  const stepChanges: Array<{
    stepId: string;
    from: StepStatus;
    to: StepStatus;
    /** ISO metin — audit JSON'ına Date koymak sessiz serileştirme sürprizi doğurur. */
    previousCompletedAt: string | null;
  }> = [];
  for (const st of scope.steps) {
    const next = await recomputeStepStatus(tx, st.id);
    if (next !== st.status) {
      stepChanges.push({
        stepId: st.id,
        from: st.status,
        to: next,
        previousCompletedAt: st.completedAt ? st.completedAt.toISOString() : null,
      });
    }
  }

  // ⚠️ `completeWorkOrderIfStepsDone` BİLEREK ÇAĞRILMIYOR. Genişleyen kapsam
  // bir adımı ACTIVE→COMPLETED'a çevirebilir (iptal edilen top o adımın tek
  // "bekleyen"iydi) ve o durumda iş emri "tüm adımları bitmiş ama kendisi
  // IN_PROGRESS" kalır. Bunu otomatik kapatmak *"bir topu iptal etmek iş
  // emrini kapatabilir"* demektir — refakat kartlarını da COMPLETED'a çeker
  // (`setWorkOrderCardStatusesTx`) ve bu bir ÜRÜN KARARIDIR, refactor yan
  // etkisi değil. Planlamacı isterse eklenecek tek satır:
  //   for (const woId of scope.workOrderIds) await completeWorkOrderIfStepsDone(tx, woId);
  // (fonksiyon zaten terminal-guard'lı; emsal `rescueStuckRoll`.)
  return { roll: r, stepChanges, ledgerRowWritten, cutReadingsRevoked };
}

export async function getCancelPreview(id: string): Promise<ApiResponse<RollCancelPreview>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        width: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        labelPrintedAt: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        currentStep: {
          select: {
            id: true,
            station: { select: { name: true, kind: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
          },
        },
      },
    });
    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    // Açık (kapanmamış) hareket sayısı — currentStepId null olsa bile aktiflik
    // sinyali olabilir. [rollId, enteredAt desc] indeksli.
    const openMovementCount = await prisma.rollMovement.count({
      where: { ...ACTIVE_MOVEMENT, rollId: id, exitedAt: null },
    });

    // activeAt: öncelik currentStep; yoksa en güncel açık movement'ın step'i.
    let activeAt: RollCancelPreview["activeAt"] = null;
    if (roll.currentStep) {
      activeAt = {
        stepId: roll.currentStep.id,
        stationName: roll.currentStep.station?.name ?? null,
        stationKind: roll.currentStep.station?.kind ?? null,
        workOrderId: roll.currentStep.workOrder.id,
        batchNumber: roll.currentStep.workOrder.workOrderNumber,
      };
    } else if (openMovementCount > 0) {
      const mv = await prisma.rollMovement.findFirst({
        where: { ...ACTIVE_MOVEMENT, rollId: id, exitedAt: null },
        orderBy: { enteredAt: "desc" },
        select: {
          step: {
            select: {
              id: true,
              station: { select: { name: true, kind: true } },
              workOrder: { select: { id: true, workOrderNumber: true } },
            },
          },
        },
      });
      if (mv?.step) {
        activeAt = {
          stepId: mv.step.id,
          stationName: mv.step.station?.name ?? null,
          stationKind: mv.step.station?.kind ?? null,
          workOrderId: mv.step.workOrder.id,
          batchNumber: mv.step.workOrder.workOrderNumber,
        };
      }
    }

    // ── Hard-block durumları: softDelete guard sırasıyla BİREBİR aynı ──
    let blockReason: string | null = null;
    if (
      roll.status === RollStatus.CANCELLED ||
      roll.status === RollStatus.SCRAP
    ) {
      blockReason = `Top zaten iptal/hurda: ${roll.barcode}`;
    } else if (roll.status === RollStatus.AT_SUBCONTRACTOR) {
      blockReason = "Fasondaki top iptal edilemez — önce fason mal kabul yapın";
    } else if (!CANCELABLE_ROLL_STATUSES.includes(roll.status)) {
      // F112: softDelete ile aynı beyaz liste — SHIPPED/*_CONSUMED/AT_KARTELA.
      blockReason = nonCancelableRollReason(roll.status);
    } else {
      const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
        where: { rollId: id, dispatch: { cancelledAt: null } },
        select: { id: true },
      });
      if (openDispatch) {
        blockReason =
          "Bu top açık bir fason sevkiyatına bağlı — önce sevki iptal et veya kabul yap";
      } else if (roll.shipmentId) {
        const ship = await prisma.shipment.findUnique({
          where: { id: roll.shipmentId },
          select: { status: true, shipmentNo: true },
        });
        if (ship && ship.status === ShipmentStatus.PLANNED) {
          blockReason = `Bu top planlı bir sevkiyatta (${ship.shipmentNo}) — önce sevkten çıkarın.`;
        }
      } else if (roll.sackId) {
        const sk = await prisma.sack.findUnique({ where: { id: roll.sackId }, select: { shipmentId: true, sackNo: true } });
        if (sk && sk.shipmentId) {
          blockReason = `Bu top sevkiyattaki bir çuvalda (${sk.sackNo}) — önce çuvaldan çıkarın.`;
        }
      }
    }

    const canCancel = blockReason === null;
    // İstasyonda/iş emrinde aktif top: iptal edilebilir ama bilinçli onay şart.
    const requiresConfirm =
      canCancel && (roll.currentStepId != null || openMovementCount > 0);

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        itemName: roll.item?.name ?? null,
        colorName: roll.color?.name ?? null,
        initialQty: Number(roll.initialQty),
        width: roll.width != null ? Number(roll.width) : null,
        canCancel,
        blockReason,
        requiresConfirm,
        reasonRequired: await resolveCancelReasonRequired(),
        activeAt,
        openMovementCount,
        labelPrinted: roll.labelPrintedAt != null,
        labelPrintedAt: roll.labelPrintedAt,
      },
    };
  }

export async function softDelete(
    id: string,
    userId?: string,
    opts?: {
      confirmActive?: boolean;
      /**
       * Etiketi basılmış topu iptal etmek için BİLİNÇLİ onay. Olmadan 409
       * `LABEL_PRINTED` — bkz. aşağıdaki guard'ın gerekçesi.
       */
      confirmLabelPrinted?: boolean;
      /**
       * İptal gerekçesi — OPSİYONEL (2026-08-06 kullanıcı kararı; öncesinde
       * etiketli topta zorunluydu). Verilmezse `cancelReason` NULL kalır ve
       * yüzeyler bunu "Seçilmedi" diye gösterir. 3 karakterden kısa değer
       * saklanmaz: "a"/"." gibi doldurma, boş bırakmaktan kötüdür (denetimde
       * cevap varmış gibi görünür, hiçbir şey söylemez).
       */
      reason?: string;
      /**
       * Sebebin KATALOG KODU (`ReasonPreset.code`, kind ROLL_CANCEL) — OPSİYONEL.
       * Verilirse katalogda doğrulanır (bilinmeyen → 400 `REASON_CODE_INVALID`);
       * verilmezse sunucu `reason` metnini kataloğun label/fullText'iyle eşleyip
       * kodu kendisi türetir (mobil bugün yalnız metin gönderiyor). Serbest metin → NULL.
       */
      reasonCode?: string;
      /**
       * STOKTAN ÇIKARMANIN İKİ ANLAMI (2026-08-25 kullanıcı kararı):
       *   • `CANCEL` (varsayılan) — "bu kayıt hiç olmamalıydı": yanlış/mükerrer
       *     giriş, yanlış metraj. Mal FİZİKSEL OLARAK YOKTU → stok düşmez
       *     (hiç girmemişti), hareket kapanışı storno (`qtyOut = 0`), fire
       *     raporuna GİRMEZ.
       *   • `SCRAP` — "mal vardı, artık yok": yandı, kirlendi, numune gitti.
       *     Stok gerçekten düşer, hareket kapanışı `qtyOut = qtyIn` (istasyon iş
       *     hacmi korunur — mal oradan geçti), fire raporuna GİRER.
       *
       * ⚠️ İKİSİNİ BİRLEŞTİRME. Sahada ölçüldü (2026-08-25): 230 iptale karşı
       * 1 fire, ve sebep yazılmış 24 iptalin HEPSİ kayıt hatası. Veri düzeltmesini
       * fireye yazmak fabrikanın fire oranını doğrudan yalanlar.
       */
      mode?: "CANCEL" | "SCRAP";
    },
  ): Promise<ApiResponse<Roll>> {
    const isScrap = opts?.mode === "SCRAP";
    const targetStatus = isScrap ? RollStatus.SCRAP : RollStatus.CANCELLED;
    const actionLabel = isScrap ? "fire edildi" : "iptal edildi";
    // İptalde sebep zorunluluğu (bayrak): yalnız İPTAL — fire ayrı karar, kapsam dışı. Yazımdan ÖNCE, tek kapı.
    if (!isScrap) await assertCancelReasonTx(prisma, { reason: opts?.reason, reasonCode: opts?.reasonCode }, "Top iptali");
    const existing = await prisma.roll.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status === RollStatus.CANCELLED ||
      existing.status === RollStatus.SCRAP
    ) {
      return {
        success: true,
        data: existing,
        message: `Top zaten iptal/hurda: ${existing.barcode}`,
      };
    }
    if (existing.status === RollStatus.AT_SUBCONTRACTOR) {
      throw AppError.conflict(
        `Fasondaki top ${isScrap ? "fire edilemez" : "iptal edilemez"} — önce fason mal kabul yapın`,
      );
    }

    // F112: Pozitif statü beyaz listesi (docstring'i UYGULA). SHIPPED /
    // TAMBUR_CONSUMED / SUBCONTRACTOR_CONSUMED / KARTELA_CONSUMED / AT_KARTELA
    // gibi sevk/tüketim statüleri buraya kadar geliyordu ve iptal edilip
    // shipmentId null'lanabiliyordu — sevk edilmiş mal canlı veriden siliniyordu.
    if (!CANCELABLE_ROLL_STATUSES.includes(existing.status)) {
      throw AppError.conflict(nonCancelableRollReason(existing.status));
    }

    // K6 — STOK KÜMESİNDEN DÜŞEN topun deposu olmak zorunda: defter çıkış satırının
    // bir `from` ucu gerekir, yoksa mal kayıttan düşer ama defter çıkışı görmez
    // (aşağıdaki `ledgerRowWritten` onu sessizce atlıyordu — audit'e yazılıyordu ama
    // audit iş kaynağı değil).
    //
    // ⚠️ BEDELİ BİLEREK ÖDENİYOR: iptal, bozuk kaydın ÇARESİDİR ve burada 409
    // vermek o çareyi geçici olarak kapatır. Alternatif (deposuz topu damgalayıp
    // düşürmek) daha kötü: topun hangi depoda olduğunu BİLMİYORUZ ve varsayılanı
    // yazmak kanıtsız bir olgu uydurmaktır ("kanıtsız satıra dokunulmaz").
    // ⚠️ Maruziyet ölçüldü (2026-09-13, fabrikanın canlı yedeği): stok kümesinde
    // deposuz top 0 ⇒ bu dal bugün ulaşılamaz. Ulaşılırsa çözüm backfill'dir,
    // kapıyı gevşetmek değil — mesaj betiği adıyla söyler.
    // ⚠️ Stok DIŞI statüden iptal (IN_PRODUCTION) depo İSTEMEZ: o mal zaten stokta
    // değil, çıkış satırı da doğmaz.
    if (WAREHOUSE_STOCK_STATUSES.includes(existing.status)) {
      assertRollsHaveWarehouse(
        [{ id: existing.id, barcode: existing.barcode, warehouseId: existing.warehouseId }],
        isScrap ? "Fire edilemez" : "İptal edilemez",
      );
    }

    // Açık fason sevkiyatına bağlı mı?
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: {
        rollId: id,
        dispatch: { cancelledAt: null },
      },
      select: { id: true, dispatchId: true },
    });
    if (openDispatch) {
      throw AppError.conflict(
        "Bu top açık bir fason sevkiyatına bağlı — önce sevki iptal et veya kabul yap",
      );
    }

    // Planlı bir sevkiyata veya sevkiyattaki çuvala bağlı mı? Bağlıysa iptal
    // edilemez — önce sevkten/çuvaldan çıkarılmalı (donmuş tahsis/rezerv bayat kalmasın).
    if (existing.shipmentId) {
      const ship = await prisma.shipment.findUnique({
        where: { id: existing.shipmentId },
        select: { status: true, shipmentNo: true },
      });
      if (ship && ship.status === ShipmentStatus.PLANNED) {
        throw AppError.conflict(
          `Bu top planlı bir sevkiyatta (${ship.shipmentNo}) — önce sevkten çıkarın.`,
        );
      }
    } else if (existing.sackId) {
      const sk = await prisma.sack.findUnique({ where: { id: existing.sackId }, select: { shipmentId: true, sackNo: true } });
      if (sk && sk.shipmentId) {
        throw AppError.conflict(
          `Bu top sevkiyattaki bir çuvalda (${sk.sackNo}) — önce çuvaldan çıkarın.`,
        );
      }
    }

    // İstasyonda / iş emrinde AKTİF top (currentStepId set VEYA açık movement):
    // bilinçli onay (confirmActive) olmadan iptal edilmez. Hard-block değil —
    // operatör önizlemeyi onaylarsa geçer. Amaç: yanlış girilip sonradan bir
    // istasyona okutulmuş bir topun KK1'den UYARISIZ düşürülmesini engellemek
    // (silme o adımdan çeker + step status'unu geri sarar). Önizleme endpoint'i
    // (getCancelPreview) operatöre nerede aktif olduğunu gösterir.
    if (!opts?.confirmActive) {
      let activeAtStation = existing.currentStepId != null;
      if (!activeAtStation) {
        const openMv = await prisma.rollMovement.count({
          where: { ...ACTIVE_MOVEMENT, rollId: id, exitedAt: null },
        });
        activeAtStation = openMv > 0;
      }
      if (activeAtStation) {
        throw AppError.conflict(
          `Bu top bir istasyonda/${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} aktif — iptal için önizlemeyi onaylamanız gerekiyor.`,
        );
      }
    }

    // ── ÖLÜ ETİKET GUARD'I (2026-08-05) ──────────────────────────────────────
    // Etiket basmak FİZİKSEL dünyada geri alınamaz bir olaydır; kayıt ise geri
    // alınabilir. İkisi arasında bağ yoktu ve saha bunu şöyle ödedi: T050826H0033
    // 10:48:30'da basıldı → 10:56:02'de iptal edildi → kâğıt topun üstünde kaldı →
    // aynı fiziksel top saatler sonra İKİNCİ bir barkodla (T050826H0072) yeniden
    // kaydedilip boyahaneye gitti. Bir top, iki kimlik, biri ölü.
    //
    // Guard `requiresConfirm`'den AYRI bir eksendir ve ondan SONRA gelir:
    // o "mal bir istasyonda mı" (sistem içi etki), bu "sahaya ölü kâğıt bırakıyor
    // muyum" (sistem DIŞI etki). Bir top ikisini birden tetikleyebilir; ikisi de
    // kendi onayını ister. Hard-block DEĞİL — onay + sebeple geçilir, çünkü meşru
    // durum var: etiket henüz topa yapıştırılmamış olabilir.
    //
    // ⚠️ SEBEP 2026-08-06'da ZORUNLU OLMAKTAN ÇIKTI (kullanıcı kararı: "personelin
    // işini hızlı ve hatasız yapması önemli"). Gerekçe hâlâ geçerli — ölü etiketi
    // sahada bulan kişinin ilk sorusu "bu neden iptal edilmiş" olur — ama zorunluluk
    // eldivenli operatörü vardiya ortasında rastgele bir kategori seçmeye itiyordu ve
    // o cevap, cevapsızlıktan KÖTÜDÜR: denetimde dolu görünür, hiçbir şey söylemez
    // (`manualReasons.ts` ile aynı ders). Artık sebep verilmezse `cancelReason` NULL
    // kalır ve yüzeyler bunu açıkça "Seçilmedi" diye gösterir.
    //
    // ONAY (`confirmLabelPrinted`) KALDIRILMADI: o "kâğıdı söktüm" beyanıdır, veri
    // değil — ve eski istemcileri fail-closed tutan şey odur (sebep gibi sessizce
    // atlanabilseydi, uyarıyı hiç görmeyen APK etiketli topu iptal edebilirdi).
    //
    // 3 karakter alt sınırı DURUYOR ama artık RED değil ELEME: kısa doldurma
    // saklanmaz, sebepsiz iptal olarak kaydedilir.
    const trimmedReason = opts?.reason?.trim() || "";
    const reason = trimmedReason.length >= 3 ? trimmedReason : null;
    // Sebep KODU (2026-08-21, `Roll.cancelReasonCode`): açık kod katalogda doğrulanır,
    // yoksa metinden türetilir — tx DIŞINDA (katalog okuması tx'e girmez). Kısa
    // doldurma metni sildiği gibi kodu da düşürür; açık kod + boş metin → metin
    // preset'ten dolar (kod dolu, görünen kayıt NULL olmasın). Metin 500'e kırpılır
    // (`roll-disposition.helper` ile aynı sınır — buradaki query-param yolu kırpmıyordu).
    // Fire ve iptal AYRI kataloglardan beslenir — "Mükerrer giriş" bir fire sebebi
    // değildir, "Kirlendi" bir kayıt hatası değildir. İki kind İKİ FARKLI kapıdan
    // geçer ve bu ayrım `KIND_STORES_TEXT`ten gelir:
    //   • ROLL_CANCEL METİN SAKLAR → `resolveReasonCode` (async, katalogdan türetir)
    //   • ROLL_SCRAP saklamaz → sapma kataloğunun SENKRON kapısı
    //     (`validateVarianceReason`). `resolveReasonCode` bunu tip düzeyinde
    //     reddeder (`TextReasonKind`) — zorlamaya çalışma.
    let cancelReasonCode: string | null;
    let cancelReasonText: string | null;
    if (isScrap) {
      if (opts?.reasonCode) {
        try {
          const v = validateVarianceReason(RollVarianceKind.SCRAP, {
            reasonCode: opts.reasonCode,
            reasonText: reason,
          });
          cancelReasonCode = v.reasonCode;
          cancelReasonText = v.reasonText ? v.reasonText.slice(0, 500) : null;
        } catch (e) {
          throw AppError.badRequest(e instanceof Error ? e.message : "Geçersiz fire sebebi", {
            code: "REASON_CODE_INVALID",
          });
        }
      } else {
        // Kod UYDURULMAZ. `validateVarianceReason` kodsuz çağrıda `LEGACY_*`
        // kovasına yazar — o kova SAPMA DEFTERİNE aittir, topun satırına değil:
        // burada "sebep girilmedi" ile "eski istemci" aynı şey değil.
        cancelReasonCode = null;
        cancelReasonText = reason ? reason.slice(0, 500) : null;
      }
    } else {
      const resolvedReason = await resolveReasonCode(ReasonPresetKind.ROLL_CANCEL, {
        reasonCode: opts?.reasonCode,
        reasonText: reason,
      });
      cancelReasonCode = resolvedReason.code;
      cancelReasonText = resolvedReason.text ? resolvedReason.text.slice(0, 500) : null;
    }
    // ── ÖLÜ ETİKET GUARD'I KALDIRILDI (2026-08-25, kullanıcı kararı) ─────────
    // Buradaki 409 `LABEL_PRINTED` bir sektör standardı DEĞİLDİ: 2026-08-05'teki
    // tek bir olaydan sonra eklenmiş yerel bir korumaydı ve karşılığında bir "ölü
    // etiket toplama" süreci hiçbir zaman kurulmadı. Kimsenin kullanmadığı bir
    // liste uğruna operatörü durduran onay, sıfır kazanç karşılığında yol kesiyordu
    // (masaüstünde ise hiç bağlanmamıştı → etiketli top oradan HİÇ iptal edilemiyordu).
    //
    // ⚠️ KOLON DURUYOR: `labelPrintedAt` baskı anında OTOMATİK yazılır
    // (`label.service.recordPrintEvent`) — kimseye iş çıkarmaz ve "sahada hangi ölü
    // etiketler dolaşıyor" sorusu bir gün sorulursa cevabı hâlâ orada. Kaldırılan
    // şey veri değil, SORU.
    //
    // ⚠️ `opts.confirmLabelPrinted` sözleşme uyumu için KABUL EDİLMEYE DEVAM EDER
    // (sahadaki APK'lar gönderiyor) ama artık hiçbir kapı açmaz. Guard'ı geri
    // koyarsan bunu da hatırla: yalnız 409'u geri koymak, bayrağı göndermeyen
    // istemcileri sessizce kilitler.
    void opts?.confirmLabelPrinted;

    const updated = await prisma.$transaction((tx) =>
      cancelRollRecordTx(tx, { existing, isScrap, userId, cancelReasonText, cancelReasonCode }),
    );
    await auditCutReadings(userId, [], { ids: updated.cutReadingsRevoked, reason: ROLL_CANCEL_CUT_REASON });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        status: existing.status,
        currentStepId: existing.currentStepId,
      },
      newData: {
        status: targetStatus,
        mode: isScrap ? "SCRAP" : "CANCEL",
        cancelled: true,
        reason: cancelReasonText,
        reasonCode: cancelReasonCode,
        labelPrinted: existing.labelPrintedAt != null,
        // Adım durumu türetilen bir değerdir; iptalin onu nasıl kaydırdığı
        // başka hiçbir yerde yazmıyor. `previousCompletedAt` özellikle önemli:
        // COMPLETED'tan düşen adım o damgayı satırında kaybediyor (yukarıdaki
        // gerekçeye bak) — tek izi bu kayıt.
        stepStatusChanges: updated.stepChanges.length ? updated.stepChanges : undefined,
        // Defter satırı MEŞRU olarak atlanmış olabilir (0 metrajlı ya da deposuz
        // top): atlama sessiz kalmasın diye sonucu burada beyan ediyoruz.
        // `false` → "bu iptalin defter karşılığı yok, çünkü düşecek mal yoktu".
        ledgerRowWritten: updated.ledgerRowWritten,
      },
    });

    // ── G2 (2026-08-14): ALIŞ SİPARİŞİ ROLLUP SENKRONU ─────────────────────
    // Bu top bir mal kabul fişinden doğduysa (`goodsReceiptId`) ve fiş bir alış
    // siparişine bağlıysa, iptal karşılanma kaynağını değiştirdi → rollup
    // tazelenir. Eskiden bu yol senkronu HİÇ çağırmıyordu ve `receivedQty`
    // bayat kalıyordu (detaydaki `drift` bandının en olası sebebi buydu).
    //
    // ⚠️ NEDEN AYRI TX (fiş-iptal deseninin aynısı — goods-receipt.service:782):
    //   ① İptal fiziksel bir gerçeği kaydeder; rapor rakamı güncellenemedi diye
    //     geri alınmaz (`syncPurchaseOrderSafely` hatayı warn'layıp yutar,
    //     rollup bir sonraki senkronda/`resync`te kendini onarır — drift bandı
    //     + "Tazele" görünür kılar, sessiz değil).
    //   ② `syncPurchaseOrder` kendi tx'ini açar ve 8027 advisory kilidini tx'in
    //     İLK ifadesi olarak alır; yukarıdaki iptal tx'inin İÇİNE gömmek kilidi
    //     top satır kilitlerinden SONRAYA düşürürdü (kilit sırası kuralı).
    //
    // ⚠️ FİŞ CANCELLED İSE SENKRON KOŞMAZ: `computeReceivedByItemTx` yalnız
    // ACTIVE fişleri sayar → iptal fişin topu zaten kaynak dışında, senkron
    // tanım gereği no-op olurdu. Bu dal ayrıca fiş-iptal döngüsünün (fişi ÖNCE
    // CANCELLED'a çeken `goodsReceiptService.cancel`, sonra topları tek tek
    // buradan geçiren yol) N gereksiz senkron tx'i ödemesini önler — o yolun
    // kendi tek senkronu zaten sonda koşuyor.
    if (existing.goodsReceiptId) {
      try {
        const receipt = await prisma.goodsReceipt.findUnique({
          where: { id: existing.goodsReceiptId },
          select: { purchaseOrderId: true, status: true },
        });
        if (receipt?.purchaseOrderId && receipt.status === GoodsReceiptStatus.ACTIVE) {
          await syncPurchaseOrderSafely(receipt.purchaseOrderId);
        }
      } catch (e) {
        // Fiş okuması da best-effort: iptal tamamlandı, rakam drift bandında görünür.
        uyari("inventory", `top iptali PO senkronu başarısız (${id}):`, (e as Error).message);
      }
    }

    return {
      success: true,
      data: updated.roll,
      message: `Top ${actionLabel}: ${existing.barcode}`,
    };
  }
