// =============================================================================
// Shipping Service / undo-dispatch
// =============================================================================
// Sevk geri alma: engel nedeni, önizleme, ters defter yazımı, undoDispatch.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import { listShipmentServiceBilledDocNos } from "../helpers/service-billing-gate.helper";
import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  PrintedDocType,
  WarehouseEventType,
  ShipmentEventType,
  SwatchEventType,
  SwatchStatus,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { postStockMove, MOVEMENT_ASC } from "../helpers/warehouse-ledger.helper";
import { reverseLegacyStockMove, reverseStockMove } from "../helpers/warehouse-ledger-reverse.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { writeShipmentEvent } from "../helpers/shipment-event.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  printedDocumentService,
} from "../printed-document.service";
import {
  readShipmentConfirmationEnabled,
  readShipmentUndoSameDayOnly,
} from "../system-setting.service";
import { factoryDayStart } from "../../constants/time";
import {
  lockShipmentScopeTx,
} from "../helpers/shipment-locks.helper";
import {
  eIrsaliyePreviewRow,
  eIrsaliyeUndoBlock,
  logVoidedEIrsaliye,
  readLiveEIrsaliyeForShipmentTx,
  readSentEIrsaliyeForShipmentTx,
  type ShipmentEIrsaliye,
  type VoidedEIrsaliye,
} from "../e-irsaliye/e-irsaliye-shipment.helper";
import {
  restoreSackTagsOnUndoDispatchTx,
} from "../sack-tag.service";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "../helpers/order-status.helper";
import { ApiResponse } from "../../types/api.types";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { assertRollsRevivable, assertSwatchesRevivable } from "../helpers/item-usage.helper";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import type { ShippingServiceThis } from "./shared";
import { emitShipmentUndoneTx } from "../notification-sources/depo";

export function resolveUndoBlockReason(input: {
    status: ShipmentStatus;
    invoiceNo: string | null;
    dispatchedAt: Date | null;
    activeReturnCount: number;
    sameDayOnly: boolean;
    eIrsaliye: ShipmentEIrsaliye | null;
    /** H7: bu sevkin faturasına bağlı aktif hizmet bağlarının fatura numaraları. */
    serviceBilledDocNos: string[];
  }): string | null {
    if (input.status === ShipmentStatus.CANCELLED) return "İptal edilmiş sevkiyat geri alınamaz.";
    if (input.status !== ShipmentStatus.DISPATCHED) {
      return "Yalnız sevk edilmiş sevkiyat geri alınabilir — bu sevkiyat henüz çıkmamış.";
    }
    // Fatura: dış muhasebe programında belge kesilmiş demektir; çıkışı geri sarmak
    // faturayı dayanaksız bırakır. Doğru yol iade + iade faturasıdır.
    if (input.invoiceNo) {
      return `Bu sevkiyat faturalanmış (${input.invoiceNo}) — geri alınamaz. Fatura işaretini kaldırın ya da iade akışını kullanın.`;
    }
    // H7: toplara yapılan iş bir faturaya (taslak dahil) bağlı — önce o fatura silinir/iptal edilir.
    if (input.serviceBilledDocNos.length > 0) {
      return `Bu sevkiyatın hizmet işleri ${input.serviceBilledDocNos.join(", ")} faturasına bağlı — geri alınamaz. Önce faturayı silin ya da iptal edin.`;
    }
    // e-İrsaliye: faturanın ikizi (GİB'deki resmî çıkış belgesi); iadeden ÖNCE, çünkü iade
    // ancak çıkmış maldan doğar — kök engel GİB belgesidir ve çıkış yolu ona göre söylenir.
    const eIrsBlock = eIrsaliyeUndoBlock(input.eIrsaliye);
    if (eIrsBlock) return eIrsBlock;
    // İade: iki motor aynı topa dokunur. İade "mal çıktı ve döndü" der, storno
    // "hiç çıkmadı" — ikisi aynı sevkiyatta birleşince hangi rakamın doğru olduğu
    // hiçbir yüzeyde söylenemez hale gelir.
    if (input.activeReturnCount > 0) {
      return `Bu sevkiyattan ${input.activeReturnCount} iade alınmış — geri alınamaz. Mal çıkıp döndüyse kalanı da iade olarak alın.`;
    }
    if (input.sameDayOnly) {
      const dayStart = factoryDayStart();
      if (!input.dispatchedAt || input.dispatchedAt < dayStart) {
        return `Sevk geri alma aynı günle sınırlı (${settingRowPath("shipmentUndoSameDayOnly")}). Bu sevkiyat bugün sevk edilmemiş.`;
      }
    }
    return null;
  }

export async function getUndoDispatchPreview(this: ShippingServiceThis, shipmentId: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true, shipmentNo: true, status: true, dispatchedAt: true, invoiceNo: true,
        plateNumber: true, driverName: true,
        customer: { select: { name: true } },
        branch: { select: { name: true } },
        _count: { select: { sacks: { where: LIVE_LOAD_UNIT_WHERE }, rolls: true, swatches: true } },
        sacks: { where: LIVE_LOAD_UNIT_WHERE, orderBy: { seq: "asc" }, select: { id: true, sackNo: true, unitKind: true, unitLabel: true, _count: { select: { rolls: true } } } },
        // Yıkıcı önizleme: etkilenen HER top somut (barkod · sahibi · döneceği raf) — soyut sayı yetmez.
        // `SHIPPED` filtresi mutasyonun kümesiyle aynı (`undoDispatch` yalnız sevkteki topları döndürür).
        rolls: { where: { status: RollStatus.SHIPPED }, orderBy: ROLL_DISPLAY_ORDER, select: { id: true, sackId: true, barcode: true, currentQty: true, preShipStatus: true, ownerCustomer: { select: { name: true } } } },
        orders: { select: { order: { select: { orderNumber: true } } } },
      },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    const rollRow = (r: (typeof shipment.rolls)[number]) => ({
      id: r.id,
      barcode: r.barcode,
      meters: Number(r.currentQty),
      /** Emanet sahibi (G3); null = bizim mal — sevk müşterisi başlıkta. */
      ownerName: r.ownerCustomer?.name ?? null,
      /** Döneceği raf (`preShipStatus`; eski/legacy sevkte null → WAREHOUSE). */
      returnTo: r.preShipStatus ?? RollStatus.WAREHOUSE,
    });
    const rollsBySack = new Map<string, ReturnType<typeof rollRow>[]>();
    const looseRolls: ReturnType<typeof rollRow>[] = [];
    for (const r of shipment.rolls) {
      const row = rollRow(r);
      if (r.sackId) (rollsBySack.get(r.sackId) ?? rollsBySack.set(r.sackId, []).get(r.sackId)!).push(row);
      else looseRolls.push(row);
    }

    const serviceBilledDocNos = await listShipmentServiceBilledDocNos(prisma, shipmentId);
    const [activeReturnCount, sameDayOnly, confirmationEnabled, sentEIrs, liveEIrs] = await Promise.all([
      prisma.rollReturn.count({ where: { fromShipmentId: shipmentId, cancelledAt: null } }),
      readShipmentUndoSameDayOnly(),
      // İstemci "sevkiyatı da kapat" seçeneğinin VARSAYILANINI bundan kurar:
      // sevk onayı KAPALI rejimde geri alınan sevkiyatın PLANNED beklemesinin
      // karşılığı yok (çıkış onayı ekranı bayrak kapalıyken görünmez) → varsayılan
      // kapat; AÇIK rejimde PLANNED doğal durum → varsayılan beklet.
      readShipmentConfirmationEnabled(),
      readSentEIrsaliyeForShipmentTx(prisma, shipmentId),
      readLiveEIrsaliyeForShipmentTx(prisma, shipmentId),
    ]);
    const blockReason = this.resolveUndoBlockReason({
      status: shipment.status,
      invoiceNo: shipment.invoiceNo,
      dispatchedAt: shipment.dispatchedAt,
      activeReturnCount,
      sameDayOnly,
      eIrsaliye: sentEIrs,
      serviceBilledDocNos,
    });

    // Topların döneceği raflar — 2. kalite topu WAREHOUSE'a yazmadığımız burada da görünür.
    const shelves = await prisma.roll.groupBy({
      by: ["preShipStatus"],
      where: { shipmentId, status: RollStatus.SHIPPED },
      _count: { _all: true },
    });

    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        status: shipment.status,
        dispatchedAt: shipment.dispatchedAt,
        customerName: shipment.customer.name,
        branchName: shipment.branch?.name ?? null,
        plateNumber: shipment.plateNumber,
        driverName: shipment.driverName,
        canUndo: blockReason === null,
        blockReason, serviceBilledInvoices: serviceBilledDocNos, // H7: taslak dahil bağlı faturalar
        sackCount: shipment._count.sacks,
        rollCount: shipment._count.rolls,
        swatchCount: shipment._count.swatches,
        sacks: shipment.sacks.map((s) => ({ id: s.id, sackNo: s.sackNo, unitKind: s.unitKind, unitLabel: s.unitLabel, rollCount: s._count.rolls, rolls: rollsBySack.get(s.id) ?? [] })),
        /** Çuvalsız (doğrudan sevkiyata bağlı) toplar — bugün boş küme; varsa listelenir, gizlenmez. */
        looseRolls,
        affectedOrders: [...new Set(shipment.orders.map((o) => o.order.orderNumber))],
        // Sevk irsaliyesi İPTAL (VOIDED) olacak — kullanıcı bunu onaydan ÖNCE bilmeli.
        voidsDispatchNote: true,
        // Yalnız storno: kayıt yerinde kalır (yeniden sevkte yeniden üretilir); storno+kapat: IPTAL olur.
        eIrsaliye: eIrsaliyePreviewRow(liveEIrs),
        confirmationEnabled,
        returnTargets: shelves.map((g) => ({
          status: g.preShipStatus ?? RollStatus.WAREHOUSE,
          rollCount: g._count._all,
        })),
      },
    };
  }

export async function writeUndoDispatchLedgerTx(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    userId?: string,
  ): Promise<void> {
    const backRows = await tx.roll.findMany({
      where: { shipmentId, status: { not: RollStatus.SHIPPED } },
      select: { id: true, currentQty: true, warehouseId: true, status: true },
    });
    // ⚠️ TERS SATIR BAĞLI DOĞAR (tasarım D2a): her storno satırı KENDİ ileri
    // `SHIPMENT` satırını `reversesMovementId` ile işaret eder. Bağsız yazılsaydı
    // (eski hâl) çift storno DB unique'ine çarpmazdı ve "bu satır ters kayıt mı"
    // sorusu cevapsız kalırdı. Σ yönden gelir, bağdan değil — bağ TESPİT içindir.
    for (const r of backRows) {
      const ileri = await tx.warehouseMovement.findFirst({
        where: {
          rollId: r.id,
          shipmentId,
          eventType: WarehouseEventType.SHIPMENT,
          reversesMovementId: null,
          reversedBy: { none: {} },
        },
        orderBy: MOVEMENT_ASC,
        select: { id: true, fromStatus: true, toStatus: true },
      });
      const ters = {
        eventType: WarehouseEventType.SHIPMENT_REVERSAL,
        reasonCode: STOCK_MOVE_REASON.SHIPMENT_CANCEL,
        userId: userId ?? null,
      };
      if (ileri && (ileri.fromStatus !== null || ileri.toStatus !== null)) {
        await reverseStockMove(tx, ileri.id, ters); // yön AYNALANIR, metraj ileri satırdan
        continue;
      }
      // Geri dönüş ucu topun ŞU ANKİ rafı/statüsü — storno yukarıdaki flip'te onu
      // zaten geri koydu, yani uç CANLI VERİDEN değil BU TX'İN yazdığından okunuyor.
      const geri = { warehouseId: r.warehouseId, status: r.status };
      if (ileri) {
        // ESKİ KAYIT DALI (K4): statüsüz ileri satır aynalanamaz, uç elle kurulur
        // ama BAĞ kurulur (epoch sondası `reverseLegacyStockMove` içinde).
        await reverseLegacyStockMove(tx, ileri.id, { ...ters, to: geri });
        continue;
      }
      // İleri satır HİÇ yok (karar öncesi sevk): bağ kurulamaz, satır bağsız doğar.
      await postStockMove(tx, { rollId: r.id, qty: r.currentQty, shipmentId, ...ters, to: geri });
    }
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function undoDispatch(this: ShippingServiceThis, 
    shipmentId: string,
    reason: string,
    userId?: string,
    opts: { releaseSacks?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    const trimmed = reason?.trim() ?? "";
    if (trimmed.length < 3) throw AppError.badRequest("Geri alma gerekçesi zorunlu (en az 3 karakter)");
    const sameDayOnly = await readShipmentUndoSameDayOnly();
    const releaseSacks = opts.releaseSacks === true;

    const result = await prisma.$transaction(async (tx) => {
      // ⚠️ TX'İN İLK İFADESİ — sevkiyat kapsamlı advisory lock (F-SEV-ESZ-001).
      // Aşağıdaki `rollReturn.count` HENÜZ OLMAYAN satırları sorar (phantom) ve
      // satır kilidi phantom'u kapatmaz: iade tx'i bu sayım ile commit arasında
      // araya girip yasak duruma yol açıyordu (üretildi — helper'daki nota bak).
      // `createReturn` AYNI kilidi alır, böylece iki akış aynı sevkiyat için serileşir.
      // Kilit BURADA, sayımdan ÖNCE olmak zorunda; sonrasına alınırsa hiçbir şey kazanılmaz.
      await lockShipmentScopeTx(tx, shipmentId);
      // Engel kontrolü TX İÇİNDE ve TAZE — önizleme ile onay arasında fatura
      // işaretlenmiş ya da iade alınmış olabilir.
      const sh = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, invoiceNo: true, dispatchedAt: true },
      });
      if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
      const activeReturnCount = await tx.rollReturn.count({
        where: { fromShipmentId: shipmentId, cancelledAt: null },
      });
      // e-İrsaliye kilitten SONRA okunur: gönderim işareti aynı kilitle serileşir.
      const eIrsaliye = await readSentEIrsaliyeForShipmentTx(tx, shipmentId);
      // H7: hizmet bağı kilitten SONRA, taze (önizleme ile onay arasında taslak doğmuş olabilir).
      const serviceBilledDocNos = await listShipmentServiceBilledDocNos(tx, shipmentId);
      const block = this.resolveUndoBlockReason({
        status: sh.status,
        invoiceNo: sh.invoiceNo,
        dispatchedAt: sh.dispatchedAt,
        activeReturnCount,
        sameDayOnly,
        eIrsaliye,
        serviceBilledDocNos,
      });
      // Kod yalnız engeli hizmet dalı doğurduysa: bağsız yeniden ölçüm aynı mesajı veriyorsa neden daha önceki daldır.
      const serviceCaused = block !== null && serviceBilledDocNos.length > 0
        && block !== this.resolveUndoBlockReason({ status: sh.status, invoiceNo: sh.invoiceNo, dispatchedAt: sh.dispatchedAt, activeReturnCount, sameDayOnly, eIrsaliye, serviceBilledDocNos: [] });
      if (block) throw AppError.conflict(block, serviceCaused ? { code: "SERVICE_ALREADY_BILLED", docNos: serviceBilledDocNos } : undefined);

      // ⚠️ `dispatchedAt`/`dispatchedById` NULL'LANMAZ (2026-09-11, defter
      // doktrini): "sevk edildi" olmuş bir gerçektir, geri alma onu silmez.
      // Anlamları "EN SON ne zaman sevk edildi"dir; güncel gerçeği `status`
      // taşır ve muhasebe listesi `status=DISPATCHED` ile süzdüğü için
      // etkilenmez. Tam geçmiş `ShipmentEvent`te.
      const claim = await tx.shipment.updateMany({
        where: { id: shipmentId, status: ShipmentStatus.DISPATCHED },
        data: { status: ShipmentStatus.PLANNED },
      });
      if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
      await writeShipmentEvent(tx, {
        shipmentId,
        type: ShipmentEventType.UNDISPATCHED,
        fromStatus: ShipmentStatus.DISPATCHED,
        toStatus: ShipmentStatus.PLANNED,
        // Gerekçe zaten ZORUNLU (en az 3 karakter) — deftere de yazılır ki
        // "kim, ne zaman, NEDEN geri aldı" tek satırda cevaplansın.
        reason: trimmed,
        userId,
      });
      await emitShipmentUndoneTx(tx, shipmentId, trimmed, userId);
      // SHIPPED → IN_SHIPMENT kartelayı canlı kümeye döndürür: dirilmedir, kart Pasif olamaz (MV-06, top ikizi aşağıda).
      const shippedSwatches = await tx.swatch.findMany({ where: { shipmentId, status: SwatchStatus.SHIPPED }, select: { id: true } });
      await assertSwatchesRevivable(tx, shippedSwatches.map((s) => s.id));
      await transitionSwatchesTx(tx, SwatchEventType.SHIP_UNDONE, { scope: { shipmentId }, shipment: { id: shipmentId }, ctx: { trigger: "SHIPMENT_UNDO_DISPATCH", userId, reason: trimmed } });

      // `isActive` şemada "sevkiyat PLANNED mı" denormudur (dispatch/cancel false yapar).
      await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: true } });

      // ÇUVAL İZLERİ GERİ GELİR — sevkte SOFT temizlenmişti (2026-09-04). Storno
      // "mal HİÇ ÇIKMADI" der; çuval havuza dönerken "kontrol et" izi de dönmeli.
      // Adres `clearedShipmentId` (RollVariance `sourceRefId` dersi) — sevkten
      // SONRA bırakılmış meşru izler zaten etkin, bu sorgu onlara dokunmaz.
      // ⚠️ `releaseSacks` (kapanış) dalından ÖNCE: o dal çuvalın `shipmentId`sini
      // boşaltır, sonraya kalsaydı kapsam kümesi değil, adres yine doğru olurdu —
      // ama sıra okunurluk için burada sabitlendi.
      await restoreSackTagsOnUndoDispatchTx(tx, shipmentId);

      // Toplar sevk ÖNCESİ rafına — `preShipStatus` yoksa (bu karardan önce sevk
      // edilmiş sevkiyat) WAREHOUSE. Statü bazında gruplu yazım; `tx` içinde
      // Promise.all YASAK olduğu için seri döngü.
      // Dirilme: kart Pasif olamaz (S5) — DB seddinin uygulama ikizi, çıkış yolunu söyler.
      await assertRollsRevivable(tx, { shipmentId, status: RollStatus.SHIPPED });
      const groups = await tx.roll.groupBy({
        by: ["preShipStatus"],
        where: { shipmentId, status: RollStatus.SHIPPED },
      });
      let restored = 0;
      for (const g of groups) {
        const res = await tx.roll.updateMany({
          where: { shipmentId, status: RollStatus.SHIPPED, preShipStatus: g.preShipStatus },
          data: { status: g.preShipStatus ?? RollStatus.WAREHOUSE, preShipStatus: null },
        });
        restored += res.count;
      }

      // DEPO DEFTERİ — mal depoya GERİ DÖNDÜ (storno). Geri dönüş adresi topun
      // kendi `warehouseId`'sinde duruyor (sevkte temizlenmiyor) → ayrı snapshot
      // gerekmez. SHIPMENT satırı SİLİNMEZ: defter append-only, çıkış gerçekten
      // olmuştu; iki satır birlikte "çıktı ve geri geldi" der.
      if (restored > 0) await this.writeUndoDispatchLedgerTx(tx, shipmentId, userId);

      // Tahsisler SİLİNMEZ — `shippedQty` defterden türetilir ve yalnız DISPATCHED
      // sevkiyattaki tahsisleri sayar; sevkiyat PLANNED olunca karşılanma kendiliğinden
      // düşer. Kilit protokolü performDispatchTx ile simetrik (lost-update).
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
      const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
      await recomputeOrderStatusForOrdersTx(tx, orderIds);

      // Resmi belge İPTAL — silinmez. Yeniden sevkte `freezeForSource` v2 üretir.
      const voidedDocs = await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SHIPMENT_DISPATCH,
        shipmentId,
        `Sevk geri alındı: ${trimmed}`,
      );
      // KAPANIŞ (opsiyonel) — storno ile AYNI tx: yukarıdaki PLANNED claim'i
      // başarılıysa sevkiyat şimdi PLANNED'dır, `cancelPlannedShipmentTx` onu
      // CANCELLED'a çeker ve çuval/top/kartela shipmentId'sini boşaltır. Toplar
      // ÇUVALDA KALIR (sackId'ye dokunulmaz) — depoya dönen şey çuvaldır.
      let freedSacks = 0;
      let voidedEIrs: VoidedEIrsaliye | null = null;
      if (releaseSacks) {
        freedSacks = await tx.sack.count({ where: { shipmentId, unitKind: LoadUnitKind.SACK } });
        voidedEIrs = await this.cancelPlannedShipmentTx(tx, shipmentId, ShipmentStatus.PLANNED, { userId });
      }
      return { restored, voidedDocs, orderIds, freedSacks, voidedEIrs };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: {
        kind: "UNDO_DISPATCH",
        reason: trimmed,
        restoredRolls: result.restored,
        voidedDocs: result.voidedDocs,
        affectedOrders: result.orderIds.length,
        released: releaseSacks,
        freedSacks: result.freedSacks,
      },
    });
    await logVoidedEIrsaliye(userId, result.voidedEIrs);
    return {
      success: true,
      data: {
        shipmentId,
        restoredRolls: result.restored,
        voidedDocs: result.voidedDocs,
        released: releaseSacks,
        freedSacks: result.freedSacks,
      },
      message: releaseSacks
        ? `Sevk geri alındı ve sevkiyat kapatıldı — ${result.restored} top, ${result.freedSacks} çuval depoya döndü; irsaliye iptal edildi`
        : `Sevk geri alındı — ${result.restored} top depoya döndü, irsaliye iptal edildi`,
    };
  }
