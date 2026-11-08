// =============================================================================
// Shipping Service / create
// =============================================================================
// Çuvaldan sevkiyat oluşturma: replay, çekirdek tx, yön kararı (ilk yön claim'i + log).
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  ShipmentStatus,
  ShipmentDestination,
  ShipmentEventType,
  SwatchEventType,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { writeShipmentEvent } from "../helpers/shipment-event.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { p2002Mentions } from "../../utils/p2002";
import {
  readShipmentConfirmationEnabled,
  readShippingWeighRequiredEnabled,
} from "../system-setting.service";
import {
  assertOrderLinkAllowed,
  orderlessWarning,
  resolveOrderRequirement,
} from "../helpers/shipment-order-requirement.helper";
import {
  assertSacksWeighed,
} from "../helpers/shipping-weigh-gate.helper";
import {
  resolveOrderCoverage,
  assertCoverageAllowed,
} from "../helpers/shipment-coverage.helper";
import {
  readShippingSackSeqPrefix,
} from "../system-setting.service";
import { nextSeriesNo } from "../number-series.service";
import {
  readPackingLotSettings,
} from "../helpers/packing-group.helper";
import {
  assertWholeLotDispatchTx,
  autoCloseLotsForSacksTx,
} from "../packing-lot.service";
import { readSackSeqStart } from "../helpers/sack-seq.helper";
import { ApiResponse } from "../../types/api.types";
import {
  resolveShipmentDestination,
  type ShipmentDestinationSource,
} from "../helpers/shipment-destination.helper";
import { resolveDeliveryToTx, type DeliveryToInput } from "../helpers/shipment-delivery.helper";
import { emanetShipmentReleaseTx } from "../helpers/emanet-shipment.helper";
import { assertShipmentNotHeldTx } from "../helpers/cari-hold.helper";
import { assertCustomerRiskLimitTx } from "../helpers/risk-exposure.helper";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import type { ShippingService } from "../shipping.service";
import { destinationLockMessage, shipmentReplay, type AllocationAuditTrail, type ShipmentDestinationDecision, type ShippingServiceThis } from "./shared";

async function nextShipmentNo(tx: Prisma.TransactionClient): Promise<string> {
  // `createdAt` DE getirilir: sayacın kapsamı "bu biçim yürürlüğe girdikten sonra
  // doğanlar"dır (`number-series.service` C0). Sorgu kümesi DEĞİŞMEDİ — filtreyi
  // servis uygular, çünkü çakışma atlaması TÜM kümeye bakmak zorunda.
  return nextSeriesNo("shipment", async (prefix) => {
    const todays = await tx.shipment.findMany({
      where: { shipmentNo: { gte: prefix, startsWith: prefix } },
      select: { shipmentNo: true, createdAt: true },
    });
    return todays.map((s) => ({ code: s.shipmentNo, createdAt: s.createdAt }));
  });
}

export async function createShipment(this: ShippingServiceThis, 
    ...args: Parameters<ShippingService["createShipmentInner"]>
  ): ReturnType<ShippingService["createShipmentInner"]> {
    const [data] = args;
    return shipmentReplay({ customerId: data.customerId, branchId: data.branchId ?? null, sackIds: data.sackIds }).run(data.clientToken, () =>
      this.createShipmentInner(...args),
    );
  }

export async function createShipmentInner(this: ShippingServiceThis, 
    data: { sackIds: string[]; customerId: string; branchId?: string | null; orderIds?: string[]; orderless?: boolean; destination?: ShipmentDestination; destinationChosen?: boolean; procedureCode?: string | null; plateNumber?: string | null; driverName?: string | null; carrier?: string | null; clientToken?: string | null } & DeliveryToInput,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(data.sackIds)];
    if (sackIds.length === 0) throw AppError.badRequest("En az bir çuval seçilmeli");
    if (!data.customerId) throw AppError.badRequest("Müşteri seçilmeli");
    const orderIds = [...new Set(data.orderIds ?? [])];
    const branchId = data.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: data.customerId, branchId });
    // Yön tx içinde çözülür (kilit + ilk sevk yazımı); tartı kapısı çözülen yönle orada koşar.
    const weighRequired = await readShippingWeighRequiredEnabled();
    // SİPARİŞ BAĞI KAPISI — tx'ten ÖNCE (girdi guard'ı). `block` rejiminde
    // sipariş yoksa ve niyet beyan edilmediyse 400; diğer rejimlerde no-op.
    const orderRequirement = await resolveOrderRequirement();
    assertOrderLinkAllowed(orderRequirement, { orderIds, orderless: data.orderless });
    await this.assertOrdersBelong(orderIds, data.customerId, branchId);
    // Sevk onayı KAPALI (varsayılan) → aynı adımda dispatch; AÇIK → PLANNED kalır (Sevk Kapısı).
    const confirmationEnabled = await readShipmentConfirmationEnabled();

    let result: { id: string; shipmentNo: string; yon: ShipmentDestinationDecision };
    let tahsisIzi: AllocationAuditTrail | null = null;
    /** Kapsama kapısının `warn` metni — tx içinde üretilir, yanıtta taşınır. */
    let kapsamaNotu: string | null = null;
    result = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const core = await this.createShipmentCoreTx(tx, {
        sackIds,
        customerId: data.customerId,
        branchId,
        orderIds,
        requestedDestination: data.destination, destinationChosen: data.destinationChosen === true,
        assertDestination: (d) => assertSacksWeighed(sacks, d, weighRequired),
        procedureCode: data.procedureCode,
        deliveryCustomerId: data.deliveryCustomerId,
        deliveryAddress: data.deliveryAddress,
        plateNumber: data.plateNumber,
        driverName: data.driverName,
        carrier: data.carrier,
        clientToken: data.clientToken,
        confirmationEnabled,
        orderless: data.orderless,
        userId,
      });

      // Tahsis izi çekirdekten TAŞINIR (tx dışında `flushAllocationAudit`e
      // gider). Çekirdek onu döndürmeseydi audit sessizce boş kalırdı.
      tahsisIzi = core.iz;
      kapsamaNotu = core.kapsamaUyarisi;
      return { id: core.id, shipmentNo: core.shipmentNo, yon: core.yon };
    }),
    undefined,
    (err) => {
      // clientToken P2002'si retry EDİLMEZ (retry hep aynı token'ı yazar) —
      // propagate edilir, boğaz (`shipmentReplay.run`) replay'e çevirir; shipmentNo yarışı retry edilir.
      if (p2002Mentions(err, /clientToken/i)) return false;
      return true;
    },
  );
    await this.flushAllocationAudit(tahsisIzi, userId);
    await this.logFirstShipmentDestination(result.yon, result.id, userId);
    const dispatched = !confirmationEnabled;
    // ── TAHSİSSİZ SEVK GÖRÜNÜR OLSUN (BULGU-T3-002) ─────────────────────────
    // Sipariş seçilmeden kurulan sevkiyat hiçbir sipariş satırına yazılmaz:
    // karşılanma tablosu, "açık talep" süzgeci, Ürün Dengesi, Sevk & Termin
    // karnesi ve muhasebe fatura satırları o malı HİÇ görmez. Fabrika
    // karşılanmış talebi yeniden üretir. Tablet ekranı `orderIds` GÖNDERMİYOR
    // (sabit undefined) — yani oradan çıkan her sevkiyat sessizce böyleydi.
    // ⚠️ 400 DEĞİL, UYARI: deploy sırası backend ÖNCE; sert red sahadaki tüm
    // tabletleri aynı anda sevk yapamaz hâle getirirdi. Siparişsiz sevk zaten
    // MEŞRU bir iştir (numune, fazla mal) — eksik olan şey niyetin BEYAN
    // edilmesiydi. `orderless: true` gönderen istemci uyarı almaz.
    // ⚠️ METİN ARTIK ORTAK YARDIMCIDA (`orderlessWarning`): Hızlı Sevk de aynı
    // uyarıyı üretir. Buraya elle bir metin YAZMA — 2026-09-03'e kadar iki yol
    // ayrışıktı ve Hızlı Sevk hiç uyarı basmıyordu.
    const warnings: string[] = [];
    const orderlessNote = orderlessWarning(orderRequirement, {
      orderIds,
      orderless: data.orderless,
    });
    if (orderlessNote) warnings.push(orderlessNote);
    // Kapsama uyarısı (`shipping.orderCoverage=warn`). Bugün bu bilgi YALNIZ
    // önizlemede vardı; tablet Paketleme `orderIds: undefined` gönderdiği için
    // sahadaki asıl yol onu hiç görmüyordu.
    if (kapsamaNotu) warnings.push(kapsamaNotu);
    if (result.yon.warning) warnings.push(result.yon.warning);
    await AuditService.log({ userId, action: "CREATE", tableName: "SHIPMENT", recordId: result.id, newData: { shipmentNo: result.shipmentNo, customerId: data.customerId, branchId, sackIds, orderIds, orderless: data.orderless === true, destination: result.yon.destination, dispatched } });
    // Otomatik fatura taslağı — YALNIZ gerçekten sevk edildiyse. PLANNED bir
    // sevkiyat "mal çıktı" demez; onay açıkken taslak `dispatchShipment`'te doğar.
    const draftNote = dispatched ? await this.maybeAutoDraftInvoiceAfterDispatch(result.id, userId) : null;
    return {
      success: true,
      data: { id: result.id, shipmentNo: result.shipmentNo, status: dispatched ? ShipmentStatus.DISPATCHED : ShipmentStatus.PLANNED, dispatched },
      message:
        (dispatched ? `Sevk edildi: ${result.shipmentNo}` : `Sevkiyat kuruldu (onay bekliyor): ${result.shipmentNo}`) +
        (draftNote ? ` · ${draftNote}` : ""),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

export async function createShipmentCoreTx(this: ShippingServiceThis, 
    tx: Prisma.TransactionClient,
    p: {
      sackIds: string[];
      customerId: string;
      branchId: string | null;
      orderIds: string[];
      /** İstemcinin gönderdiği yön; kilitliyse kullanılmaz, boşsa sevkiyata yazılır. */
      requestedDestination?: ShipmentDestination;
      /** Operatörün açık seçimi mi — yalnız o zaman karta da yazılır (eski istemci göndermez). */
      destinationChosen?: boolean;
      /** Çözülen yönle koşan kapı (tartı) — tx içinde, yazımdan önce. */
      assertDestination: (destination: ShipmentDestination, lockSource: ShipmentDestinationSource | null) => void;
      procedureCode?: string | null;
      /** Teslim yeri (K18) — yoksa null; belge snapshot'ı aynı tx'te doğarsa donar. */
      deliveryCustomerId?: string | null;
      deliveryAddress?: string | null;
      plateNumber?: string | null;
      driverName?: string | null;
      carrier?: string | null;
      clientToken?: string | null;
      confirmationEnabled: boolean;
      /** Kullanıcının "siparişsiz / fazla mal" beyanı — kapsama kapısının kaçışı. */
      orderless?: boolean;
      userId?: string;
    },
  ): Promise<{
    id: string;
    shipmentNo: string;
    iz: AllocationAuditTrail | null;
    /** `shipping.orderCoverage` `warn` iken üretilen metin; yoksa null. */
    kapsamaUyarisi: string | null;
    yon: ShipmentDestinationDecision;
  }> {
    // Cari kilidi (D4-I1, SHIPMENT) + risk limiti (D4-I2, finance.riskLimitBlock.shipment) — yazımdan önce, tx içinde;
    // emanet sevki kararı ikisinde de aynı helper'dan (D4-I1c). Risk: bakiye FOR UPDATE, sıra fatura onayıyla aynı.
    // Kilit + risk kapısı birlikte ısırırsa karar bir kez hesaplanır (aynı tx, aynı sonuç).
    let emanetMemo: ReturnType<typeof emanetShipmentReleaseTx> | undefined;
    const emanetRelease = () => (emanetMemo ??= emanetShipmentReleaseTx(tx, { sackId: { in: p.sackIds } }, p.customerId));
    await assertShipmentNotHeldTx(tx, p.customerId, emanetRelease);
    await assertCustomerRiskLimitTx(tx, p.customerId, "SHIPMENT", emanetRelease);
    const yon = await this.decideShipmentDestinationTx(tx, {
      customerId: p.customerId,
      branchId: p.branchId,
      requested: p.requestedDestination,
      chosen: p.destinationChosen === true,
      userId: p.userId,
    });
    p.assertDestination(yon.destination, yon.lockSource);
    const teslim = await resolveDeliveryToTx(tx, p.customerId, { deliveryCustomerId: p.deliveryCustomerId, deliveryAddress: p.deliveryAddress });
    const shipmentNo = await nextShipmentNo(tx);
    const created = await tx.shipment.create({
      // ⚠️ Künye (Faz A2) `dispatchedById`den FARKLI bilgidir: sevkiyat
      // PLANNED doğar, sevk SONRA yapılır → planlayan ≠ sevk eden. Bu yüzden
      // burada createdById eklemek çoğaltma DEĞİL, ikinci bir gerçektir.
      data: {
        shipmentNo,
        clientToken: p.clientToken ?? null,
        customerId: p.customerId,
        branchId: p.branchId,
        status: ShipmentStatus.PLANNED,
        destination: yon.destination,
        procedureCode: p.procedureCode?.trim() || null,
        deliveryCustomerId: teslim.deliveryCustomerId,
        deliveryAddress: teslim.deliveryAddress,
        // Araç bilgisi PLANLI doğuşta da saklanır (onay açıkken sessizce düşüyordu); sevk anı yalnız GELENİ yazar.
        plateNumber: p.plateNumber?.trim() || null,
        driverName: p.driverName?.trim() || null,
        carrier: p.carrier?.trim() || null,
        // Sıra ön eki burada DONAR — ekran ve belge bu kolonu okur.
        sackSeqPrefix: await readShippingSackSeqPrefix(tx),
        createdById: p.userId ?? null,
        updatedById: p.userId ?? null,
      },
      select: { id: true, shipmentNo: true },
    });
    // DOĞUŞ OLAYI — defter sevkiyatın TÜM hayatını taşısın; ilk satır yoksa
    // "bu sevkiyat ne zaman kuruldu" yalnız `createdAt`ten okunur ve defter
    // yarım başlar.
    await writeShipmentEvent(tx, {
      shipmentId: created.id,
      type: ShipmentEventType.PLANNED,
      fromStatus: null,
      toStatus: ShipmentStatus.PLANNED,
      userId: p.userId ?? null,
    });
    // Sevk partisi: "parti bütün gider" kapısı CLAIM'DEN ÖNCE (açık küme henüz
    // değişmemişken); "sevk edildi" durumu claim'den SONRA (açık çuval kalmadıysa).
    const lot = await readPackingLotSettings(tx);
    await assertWholeLotDispatchTx(tx, p.sackIds, lot.partialDispatch);
    // Atomik claim + seq ata (+ müşterisiz çuvala müşteri/şube backfill). Sıra
    // `shipping.sackSeqStart`tan başlar (varsayılan 1).
    const seqStart = await readSackSeqStart(tx);
    for (let i = 0; i < p.sackIds.length; i++) {
      const claimed = await tx.sack.updateMany({
        where: { id: p.sackIds[i], shipmentId: null },
        data: { shipmentId: created.id, seq: seqStart + i, customerId: p.customerId, branchId: p.branchId },
      });
      if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
    }
    await autoCloseLotsForSacksTx(tx, p.sackIds, lot.mode === "sevk-partisi", p.userId);
    // İçerik shipmentId açıkça (composite FK deferred → commit'te doğrulanır).
    await tx.roll.updateMany({ where: { sackId: { in: p.sackIds } }, data: { shipmentId: created.id } });
    await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_ADDED, { scope: { sackIds: p.sackIds }, shipment: { id: created.id }, ctx: { trigger: "SHIPMENT_CREATE", userId: p.userId } });
    // Sipariş kümesi (kullanıcı seçimi) + spec-FIFO tahsis.
    await this.setShipmentOrdersTx(tx, created.id, p.orderIds);
    let iz: AllocationAuditTrail | null = await this.writeShipmentAllocationsTx(
      tx,
      created.id,
      p.orderIds,
      p.branchId,
    );
    // Onay kapalı → aynı tx'te sevk et (DISPATCHED).
    if (!p.confirmationEnabled) {
      const dp = await this.performDispatchTx(
        tx,
        created.id,
        { plateNumber: p.plateNumber, driverName: p.driverName, carrier: p.carrier },
        p.userId,
      );
      // Anında sevkte tahsis İKİ KEZ yazılır (kuruluşta + sevk anında);
      // ikincisi birincisini siler ve GEÇERLİ olan odur → iz de o olmalı.
      if (dp.iz) iz = dp.iz;
    }

    // KAPSAMA KAPISI (`shipping.orderCoverage`, 2026-09-06) — İKİNCİ EKSEN.
    // Burada, tahsis YAZILDIKTAN sonra çalışır: "sipariş seçildi mi" değil
    // "mal deftere yazıldı mı" sorusunu ölçer. Varsayılan `off` → hiçbir şey olmaz.
    // ⚠️ tx İÇİNDE: `block` rejiminde atılan hata sevkiyatı geri alır; yarım
    // kurulmuş bir sevkiyat bırakmak, kapının kendisinden daha kötü olurdu.
    const kapsamaRejimi = await resolveOrderCoverage();
    let kapsamaUyarisi: string | null = null;
    if (kapsamaRejimi !== "off" && p.orderIds.length > 0) {
      const mal = await tx.roll.aggregate({ where: { shipmentId: created.id }, _sum: { currentQty: true } });
      const cikan = Number(mal._sum.currentQty ?? 0);
      const yazilan = (iz?.yazilan ?? []).reduce((a2, y) => a2 + y.qty, 0);
      kapsamaUyarisi = assertCoverageAllowed(kapsamaRejimi, cikan - yazilan, {
        orderIds: p.orderIds,
        orderless: p.orderless,
      });
    }
    return { ...created, iz, kapsamaUyarisi, yon };
  }

export async function decideShipmentDestinationTx(this: ShippingServiceThis, 
    tx: Prisma.TransactionClient,
    p: { customerId: string; branchId: string | null; requested?: ShipmentDestination; chosen: boolean; userId?: string },
  ): Promise<ShipmentDestinationDecision> {
    const kilit = await resolveShipmentDestination(tx, { customerId: p.customerId, branchId: p.branchId });
    if (kilit.destination) {
      const warning = p.requested && p.requested !== kilit.destination ? destinationLockMessage(p.requested, kilit) : null;
      return { destination: kilit.destination, lockSource: kilit.source, warning, firstChoice: null };
    }
    if (!p.requested) return { destination: ShipmentDestination.DOMESTIC, lockSource: null, warning: null, firstChoice: null };
    return { ...(await this.claimFirstDestinationTx(tx, { ...p, requested: p.requested })), warning: null };
  }

export async function claimFirstDestinationTx(
    tx: Prisma.TransactionClient,
    p: { customerId: string; branchId: string | null; requested: ShipmentDestination; chosen: boolean; userId?: string },
  ): Promise<Omit<ShipmentDestinationDecision, "warning">> {
    if (!p.chosen) return { destination: p.requested, lockSource: null, firstChoice: null };
    const target = p.branchId
      ? { tableName: "CUSTOMER_BRANCH" as const, recordId: p.branchId }
      : { tableName: "CUSTOMER" as const, recordId: p.customerId };
    const claimed = p.branchId
      ? await tx.customerBranch.updateMany({
          where: { id: p.branchId, customerId: p.customerId, defaultDestination: null },
          data: { defaultDestination: p.requested, updatedById: p.userId ?? null },
        })
      : await tx.customer.updateMany({
          where: { id: p.customerId, defaultDestination: null },
          data: { defaultDestination: p.requested, updatedById: p.userId ?? null },
        });
    if (claimed.count === 1) {
      return { destination: p.requested, lockSource: null, firstChoice: { ...target, destination: p.requested } };
    }
    // Yarışı başka bir ilk sevk kazandı — kazananı tx içinde TAZE oku.
    const fresh = await resolveShipmentDestination(tx, { customerId: p.customerId, branchId: p.branchId });
    if (fresh.destination === p.requested) return { destination: p.requested, lockSource: fresh.source, firstChoice: null };
    throw AppError.conflict(
      fresh.destination
        ? `${destinationLockMessage(p.requested, fresh, false)} Ekranı yenileyip tekrar deneyin.`
        : "Sevk yönü az önce değişti — yenileyip tekrar deneyin.",
      { code: "SHIPMENT_DESTINATION_LOCKED", destination: fresh.destination, source: fresh.source },
    );
  }

export async function logFirstShipmentDestination(
    yon: Pick<ShipmentDestinationDecision, "firstChoice">,
    shipmentId: string,
    userId?: string,
  ): Promise<void> {
    if (!yon.firstChoice) return;
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: yon.firstChoice.tableName,
      recordId: yon.firstChoice.recordId,
      oldData: { defaultDestination: null },
      newData: { defaultDestination: yon.firstChoice.destination, kind: "FIRST_SHIPMENT_DESTINATION", shipmentId },
    });
  }
