// =============================================================================
// Shipping Service / dispatch
// =============================================================================
// Sevk (DISPATCHED geçişi): performDispatchTx, dispatchShipment (sevk sonrası otomatik taslak fatura cephede kalır — göreli dinamik import yolu).
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  PrintedDocType,
  WarehouseEventType,
  ShipmentEventType,
  SwatchEventType,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { postStockMoves } from "../helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { assertRollsHaveWarehouse } from "../helpers/warehouse-stock.helper";
import { writeShipmentEvent } from "../helpers/shipment-event.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  printedDocumentService,
} from "../printed-document.service";
import {
  SACK_ABSENT_STATUSES,
} from "../helpers/sack-invariants.helper";
import {
  clearSackTagsOnDispatchTx,
} from "../sack-tag.service";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "../helpers/order-status.helper";
import { ApiResponse } from "../../types/api.types";
import { LIVE_LOAD_UNIT_WHERE } from "../helpers/load-unit.helper";
import { assertOwnerMatchesTx } from "../helpers/emanet-owner.helper";
import { emanetShipmentReleaseTx } from "../helpers/emanet-shipment.helper";
import { assertShipmentNotHeldTx } from "../helpers/cari-hold.helper";
import { assertCustomerRiskLimitTx } from "../helpers/risk-exposure.helper";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import type { AllocationAuditTrail, ShippingServiceThis } from "./shared";
import { emitShipmentDispatchedTx } from "../notification-sources/depo";

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function performDispatchTx(this: ShippingServiceThis, 
    tx: Prisma.TransactionClient,
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
    // ⚠️ Dönüş artık {flipped, iz}: tahsis yeniden hesabının audit izi tx DIŞINDA
    // yazılmalı (proje kuralı) → çağırana taşınır. Örnek alan desen:
    // `createShipment`/`setShipmentOrders` (aynı iz `flushAllocationAudit`e gider).
  ): Promise<{ flipped: number; iz: AllocationAuditTrail | null }> {
    // Cari kilidi (D4-I1, SHIPMENT) claim'den ÖNCE: PLANNED kalıp sonra kilitlenen sevkiyat da kesilir. Sevkiyat
    // yoksa kapı geçer, aşağıdaki claim 409 verir (bugünkü davranış).
    const holdHeader = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { customerId: true } });
    if (holdHeader) {
      let emanetMemo: ReturnType<typeof emanetShipmentReleaseTx> | undefined;
      const emanetRelease = () => (emanetMemo ??= emanetShipmentReleaseTx(tx, { shipmentId }, holdHeader.customerId));
      await assertShipmentNotHeldTx(tx, holdHeader.customerId, emanetRelease);
      await assertCustomerRiskLimitTx(tx, holdHeader.customerId, "SHIPMENT", emanetRelease);
    }
    const claim = await tx.shipment.updateMany({
      where: { id: shipmentId, status: ShipmentStatus.PLANNED },
      data: {
        status: ShipmentStatus.DISPATCHED,
        dispatchedAt: new Date(),
        dispatchedById: userId ?? null,
        ...(data.plateNumber !== undefined ? { plateNumber: data.plateNumber } : {}),
        ...(data.driverName !== undefined ? { driverName: data.driverName } : {}),
        ...(data.carrier !== undefined ? { carrier: data.carrier } : {}),
      },
    });
    if (claim.count === 0) throw AppError.conflict("Sevkiyat durumu değişti — yenileyip tekrar deneyin");
    await writeShipmentEvent(tx, {
      shipmentId,
      type: ShipmentEventType.DISPATCHED,
      fromStatus: ShipmentStatus.PLANNED,
      toStatus: ShipmentStatus.DISPATCHED,
      userId,
    });
    // Kartela bedelsiz çıkıştır (S5): "sevk edildi" artık kartelanın kendi durumu.
    await transitionSwatchesTx(tx, SwatchEventType.SHIPPED, { scope: { shipmentId }, shipment: { id: shipmentId }, ctx: { trigger: "SHIPMENT_DISPATCH", userId } });

    // HAYALET GUARD'I — tx İÇİ, sevkiyat satır kilidi ALINDIKTAN sonra, flip'ten ÖNCE.
    // Aşağıdaki flip `status: { not: SHIPPED }` ile ÇUVALDAKİ HER TOPU SHIPPED'e çeker;
    // `AT_KARTELA`/`TAMBUR_CONSUMED` de ezilir ve hatanın tek kanıtı (statü) yok olur,
    // ardından `freezeForSource` şişmiş metrajı DONDURUR.
    // ⚠️ NEDEN filtre DEĞİL de assertion: flip'in WHERE'ine `notIn` koymak hayaleti
    // DISPATCHED çuvalda `AT_KARTELA` olarak bırakır; `removeRollFromSack` sevkiyattaki
    // çuvalı reddettiği için o top bir daha ÇIKARILAMAZ → onarılamaz çıkmaz. Assertion
    // ise tx'i geri sarar: ne statü ezilir, ne belge donar, ne veri kirlenir.
    // Ön guard `loadSacksForShipment`'te; bu, kilit altındaki taze son savunmadır.
    const ghosts = await tx.roll.findMany({
      where: { shipmentId, status: { in: SACK_ABSENT_STATUSES } },
      select: { barcode: true, status: true, sack: { select: { sackNo: true } } },
      take: 10,
    });
    if (ghosts.length > 0) {
      throw AppError.badRequest(
        "Sevk edilemez — çuvalda kayıtlı ama fiziksel olarak binada olmayan top var: " +
          ghosts
            .map((g) => `${g.sack?.sackNo ?? "?"} / ${g.barcode ?? "(barkodsuz)"} → ${g.status}`)
            .join(", ") +
          '. "Paketleme / Çuvallar" ekranından bu topları çuvaldan çıkarıp tekrar deneyin.'
      );
    }

    // K6 — DEPOSUZ TOP STOK KÜMESİNDEN ÇIKAMAZ. Defter çıkış satırının bir depo
    // ucu olmak zorunda; yoksa mal çıkar ama defter çıkışı görmez (ölçüldü: iki
    // top sevk edildi, TEK `SHIPMENT` satırı yazıldı — eski kapı uçsuz satırı
    // sessizce atlıyordu). Kapı BURADA, kilidin altında ve taze veriyle:
    // defterdeki `assertEndShape` son ağdır, oraya ulaşmak "kapı atlandı" demek.
    const warehouseless = await tx.roll.findMany({
      where: { shipmentId, warehouseId: null },
      select: { id: true, barcode: true, warehouseId: true },
    });
    assertRollsHaveWarehouse(warehouseless, "Sevk edilemez");

    await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });

    // EMANET SAHİPLİK KAPISI (G3) — üç sevk yolunun ORTAK boğazı: başka müşterinin emanet topu bu
    // sevkle çıkamaz (409 OWNER_MISMATCH, etkilenen toplar barkoduyla). Bayraktan bağımsız: veri varsa çalışır.
    const shipmentHeader = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { customerId: true, shipmentNo: true } });
    const shipmentRollIds = (await tx.roll.findMany({ where: { shipmentId }, select: { id: true } })).map((r) => r.id);
    await assertOwnerMatchesTx(tx, { rollIds: shipmentRollIds, customerId: shipmentHeader.customerId, belge: `sevkiyat ${shipmentHeader.shipmentNo}` });

    // ÇUVAL İZLERİ (ETİKET) TEMİZLENİR — sevk ANINDA, SOFT damgayla (2026-09-04).
    // İz depodaki işi anlatır ("kontrol et", "eksik"); mal çıktıktan sonra artık
    // hiçbir şey söylemiyor. BURASI üç sevk yolunun (onaylı · onaysız doğrudan
    // sevk · createShipmentFromRolls) ORTAK boğazı — tek satır üçünü de kapatır.
    // Damga `undoDispatch` storno dalında `clearedShipmentId` adresiyle geri alınır.
    await clearSackTagsOnDispatchTx(tx, shipmentId);

    // SEVK ÖNCESİ STATÜ SNAPSHOT'I (2026-08-05) — tek `updateMany` ile hepsini
    // SHIPPED yapmak, geri alma (storno) için gereken "bu top hangi raftan geldi"
    // bilgisini yok ediyordu. Çuvalda `WAREHOUSE` ve `A1_STOCK` (2. kalite) toplar
    // BİRLİKTE bulunabilir; geri almada hepsini WAREHOUSE'a döndürmek 2. kaliteyi
    // sessizce 1. kalite rafına yazardı. Statüye göre gruplayıp her grubu kendi
    // snapshot'ıyla yazıyoruz (pratikte 1-2 grup; `tx` içinde Promise.all YASAK).
    const preStatusGroups = await tx.roll.groupBy({
      by: ["status"],
      where: { shipmentId, status: { not: RollStatus.SHIPPED } },
    });
    let flipped = 0;
    for (const g of preStatusGroups) {
      const res = await tx.roll.updateMany({
        where: { shipmentId, status: g.status },
        data: { status: RollStatus.SHIPPED, preShipStatus: g.status },
      });
      flipped += res.count;
    }
    // DEPO DEFTERİ — mal depodan ÇIKTI. `Roll.warehouseId` BİLEREK temizlenmez
    // ("en son hangi depodaydı" izi + sevk stornosunun geri dönüş adresi), o yüzden
    // çıkışı yalnız bu defter kaydeder. Tek `createMany` (perf kuralı 9).
    if (flipped > 0) {
      // ⚠️ YÜKLEMDE `preShipStatus: { not: null }` VAR ve bu bir SÜZGEÇ DEĞİL,
      // KANIT koşuludur (K: stok defterine taşıma, 2026-09-13). Çıkış ucunun
      // statüsü UYDURULAMAZ; onu yalnız bu tx'in yukarıdaki flip'i yazar
      // (`preShipStatus: g.status`). `preShipStatus` NULL olan top bu karardan
      // ÖNCE sevk edilmiştir — onun satırı (varsa) eski kapıdan yazıldı ve
      // `preEpoch`e düşer; burada ikinci kez yazılmaz.
      // Ölçüldü (fabrika kopyası 2026-09-13): 2.173 SHIPPED topun tamamı
      // `preShipStatus = WAREHOUSE`, 1'i NULL (karar öncesi), deposuz 0.
      const shippedRows = await tx.roll.findMany({
        where: { shipmentId, status: RollStatus.SHIPPED, preShipStatus: { not: null } },
        select: { id: true, currentQty: true, warehouseId: true, preShipStatus: true },
      });
      await postStockMoves(
        tx,
        shippedRows.map((r) => ({
          rollId: r.id,
          eventType: WarehouseEventType.SHIPMENT,
          qty: r.currentQty,
          // ÇIKIŞ: topun durduğu raf + sevk ÖNCESİ statüsü (kanıt).
          from: { warehouseId: r.warehouseId, status: r.preShipStatus as RollStatus },
          // GİRİŞ: stok kümesi DIŞI ⇒ depo YOK (K1 uç şekli). `Roll.warehouseId`
          // temizlenmez; defterin ucu ile topun alanı ayrı iki şeydir.
          to: { warehouseId: null, status: RollStatus.SHIPPED },
          reasonCode: STOCK_MOVE_REASON.SHIPMENT_DISPATCH,
          shipmentId,
          userId: userId ?? null,
        })),
      );
      // ⚠️ POLİTİKA ARGÜMANI YOK ve olmaması KASITLI: eski kapı `onUnwritable`
      // ile "atla mı fırlat mı" sorusunu çağırana bırakıyordu; yeni kapı her
      // zaman FIRLATIR. Sevk brüt ve defterden türer — uçsuz/0 metrajlı satırı
      // sessizce atlamak, malı defterden kaçırmaktı (K6).
    }
    // Tahsisler artık DISPATCHED sevkiyatta → shippedQty defterden yeniden hesaplanır.
    const sevkiyat = await tx.shipment.findUnique({
      where: { id: shipmentId },
      select: { branchId: true },
    });
    const dispatchBranchId = sevkiyat?.branchId ?? null;
    const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
    // Lost-update kilidi: recompute defteri KİLİTSİZ okuyup shippedQty yazar — READ
    // COMMITTED altında aynı siparişe eşzamanlı iki terminal olay (iki dispatch, ya da
    // dispatch ∥ fason directShip) birbirinin commit'ini görmeden eksik toplam yazardı
    // (order-status.helper doc'u). Protokol: etkilenen siparişlerin TAM satır kümesi
    // recompute'tan ÖNCE tek sıralı touchOrderLinesTx partisiyle kilitlenir
    // (subcontractor directShip ile aynı; alt-küme kilidi deadlock riski taşır).
    const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
    const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await touchOrderLinesTx(tx, lineRows.map((l) => l.id));

    // ⚠️ TAHSİS SEVK ANINDA YENİDEN HESAPLANIR (BULGU-T3-009). Eskiden sevkiyat
    // kurulurken hesaplanan rakam sevk anına kadar DONUYORDU ve arada gerçek
    // değişebiliyordu:
    //   T0 sevkiyat DISPATCHED (500 m, siparişin 500 m'lik kalemine tahsisli)
    //   T1 storno → sevkiyat PLANNED'a döner, tahsis satırları BİLİNÇLİ korunur
    //   T2 satış aynı kalemi 200 m'ye düşürür
    //   T3 "Sevk Et" → bayat 500 m `shippedQty`ye terfi eder
    // Sonuç: 200 m'lik kaleme 500 m sevk yazılır; "Açık" −300 m çıkar, arayüz
    // onu 0'a kelepçelediği için fazla sevk HİÇBİR EKRANDA görünmez.
    //
    // ⚠️ ÇIKIŞI ENGELLEMEZ — ölçüldü: `allocation.helper` içinde TEK BİR `throw`
    // yok; talebi aşan mal basitçe TAHSİSSİZ kalır (`continue`/`break`). Yani
    // mal her hâlükârda çıkar, değişen tek şey deftere yazılan rakamdır ve o
    // rakam artık sevk anının gerçeğidir. Sahada yapılabilen hiçbir şey
    // yapılamaz hâle gelmiyor.
    const tazeTahsisIzi = await this.writeShipmentAllocationsTx(tx, shipmentId, orderIds, dispatchBranchId);
    if (tazeTahsisIzi) {
      // Çıkan mal ↔ siparişe yazılan: fark TAHSİSSİZ metrajdır. Sessiz kalmasın.
      const mal = await tx.roll.aggregate({ where: { shipmentId }, _sum: { currentQty: true } });
      const cikan = Number(mal._sum.currentQty ?? 0);
      const yazilanToplam = tazeTahsisIzi.yazilan.reduce((a, y) => a + y.qty, 0);
      const fark = Math.round((cikan - yazilanToplam) * 1000) / 1000;
      tazeTahsisIzi.tahsissizMetraj = fark > 0 ? fark : 0;
    }
    await recomputeOrderStatusForOrdersTx(tx, orderIds);
    // Resmi belge — sevk irsaliyesi v1 burada donar.
    await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
    await emitShipmentDispatchedTx(tx, shipmentId, userId);
    return { flipped, iz: tazeTahsisIzi };
  }

export async function dispatchShipment(this: ShippingServiceThis, 
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, destination: true, sacks: { where: LIVE_LOAD_UNIT_WHERE, select: { sackNo: true, weightKg: true } } },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.DISPATCHED) throw AppError.conflict("Sevkiyat zaten sevk edilmiş");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyat sevk edilebilir");
    if (shipment.sacks.length === 0) throw AppError.badRequest("Boş sevkiyat sevk edilemez");
    await this.assertWeighed(shipment.sacks, shipment.destination);

    const dispatchSonuc = await prisma.$transaction((tx) => this.performDispatchTx(tx, shipmentId, data, userId));
    const shippedRolls = dispatchSonuc.flipped;
    // Tahsis yeniden hesabının izi — tx DIŞINDA (proje kuralı).
    await this.flushAllocationAudit(dispatchSonuc.iz, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "DISPATCH", rollCount: shippedRolls, plateNumber: data.plateNumber ?? null, driverName: data.driverName ?? null } });
    const draftNote = await this.maybeAutoDraftInvoiceAfterDispatch(shipmentId, userId);
    return {
      success: true,
      data: { shipmentId, rollCount: shippedRolls },
      message: "Sevk edildi — stok bina dışı, karşılanma kesinleşti" + (draftNote ? ` · ${draftNote}` : ""),
    };
  }
