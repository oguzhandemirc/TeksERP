// =============================================================================
// Shipping Service / load
// =============================================================================
// Planlı sevkiyat yükü: sipariş seti, çuval ekle/çıkar, okutarak yükleme, dökme top birimleri, yük önizlemesi.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (shipping/list.ts sayılır) */

import {
  Prisma,
  RollStatus,
  ShipmentStatus,
  ShipmentDestination,
  PrintedDocType,
  SwatchEventType,
  LoadUnitKind,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { tokenReplay } from "../helpers/token-replay.helper";
import { AuditService } from "../audit.service";
import {
  printedDocumentService,
} from "../printed-document.service";
import {
  readShipmentLooseLoadEnabled,
  readShippingWeighRequiredEnabled,
} from "../system-setting.service";
import {
  assertOrderLinkAllowed,
  resolveOrderRequirement,
} from "../helpers/shipment-order-requirement.helper";
import { ambiguousCustomerCodeError, matchExtras, resolveRollByScanCode } from "../helpers/roll-scan-resolve.helper";
import { normalizeScanCode } from "../../utils/code-format";
import { matchesSeries, resolveSeriesFormat } from "../number-series.service";
import {
  touchShipmentPlannedTx,
} from "../helpers/shipment-locks.helper";
import {
  NON_SACKABLE_STATUSES,
} from "../helpers/sack-invariants.helper";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "../helpers/order-status.helper";
import {
  readPackingLotSettings,
} from "../helpers/packing-group.helper";
import {
  assertWholeLotDispatchTx,
  autoCloseLotsForSacksTx,
  reopenLotsForSacksTx,
} from "../packing-lot.service";
import { readSackSeqStart } from "../helpers/sack-seq.helper";
import { ApiResponse } from "../../types/api.types";
import { clearShipmentAllocationsTx } from "../helpers/sack-allocation.helper";
import { buildShipmentLoadPreview, type LoadPreview, type LoadPreviewInput } from "../helpers/shipment-load-preview.helper";
import { assertLoadKindCompatible, LIVE_LOAD_UNIT_WHERE, planLoadUnits, type LoadUnitInput, type LoadUnitPlan } from "../helpers/load-unit.helper";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { SHIPPABLE_ROLL_WHERE, nextSackNo, openLoadUnitTx, type AllocationAuditTrail, type ShippingServiceThis } from "./shared";

/** PLANNED'a eklenecek toplar (9.2): rafta, serbest, uygun durumda ve sevkiyatın deposundan. Gerçek guard tx'teki claim'dir. */
function assertLooseRollsAddable(
  rolls: { id: string; barcode: string | null; status: RollStatus; sackId: string | null; shipmentId: string | null; warehouseId: string | null }[],
  shipmentWarehouseId: string | null,
): void {
  const ref = (r: { id: string; barcode: string | null }) => r.barcode ?? r.id.slice(0, 8);
  for (const r of rolls) {
    if (r.shipmentId) throw AppError.conflict(`${ref(r)}: zaten bir sevkiyatta`, { code: "ROLL_TAKEN" });
    if (r.sackId) throw AppError.conflict(`${ref(r)}: bir çuvalın içinde — Paketleme ekranından çıkarın`, { code: "ROLL_TAKEN" });
    if (NON_SACKABLE_STATUSES.includes(r.status)) throw AppError.badRequest(`${ref(r)}: durumu uygun değil (${r.status})`);
    if (shipmentWarehouseId && r.warehouseId && r.warehouseId !== shipmentWarehouseId) {
      throw AppError.badRequest(`${ref(r)}: başka depoda — tek sevkiyat tek depodan çıkar.`);
    }
  }
}

/** PLANNED'a dökme/araba ekleme (9.2) — token yalnız YENİ doğan birimde durur; mevcut birime ekleme durum-idempotenttir. */
function looseUnitReplay(ident: { shipmentId: string; kind: LoadUnitKind; label: string | null }) {
  return tokenReplay<{ id: string; shipmentId: string | null; unitKind: LoadUnitKind; unitLabel: string | null; dissolvedAt: Date | null }, ApiResponse<unknown>>({
    find: (db, clientToken) =>
      db.sack.findUnique({ where: { clientToken }, select: { id: true, shipmentId: true, unitKind: true, unitLabel: true, dissolvedAt: true } }),
    alive: (u) => {
      if (u.dissolvedAt === null) return;
      throw AppError.conflict("Bu okutmayla açılan yük birimi sonradan boşaltıldı — topu yeniden okutun.", { code: "LOAD_UNIT_DISSOLVED" });
    },
    identity: (u) => [
      { ad: "shipmentId", mevcut: u.shipmentId, gelen: ident.shipmentId },
      { ad: "unitKind", mevcut: u.unitKind, gelen: ident.kind },
      { ad: "unitLabel", mevcut: u.unitLabel, gelen: ident.label },
    ],
    collision: "Bu istemci anahtarı başka bir sevkiyatın ya da başka bir arabanın yüküne ait. Ekranı yenileyip yeniden okutun.",
    respond: (u) => ({
      success: true,
      data: { shipmentId: u.shipmentId, unitId: u.id, unitKind: u.unitKind, unitLabel: u.unitLabel, added: 0 },
      message: "Yük eklendi",
    }),
  });
}

export async function setShipmentOrders(this: ShippingServiceThis, shipmentId: string, orderIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const orderIds = [...new Set(orderIdsIn)];
    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, shipmentNo: true, status: true, customerId: true, branchId: true },
    });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status === ShipmentStatus.CANCELLED) {
      throw AppError.conflict("İptal edilmiş sevkiyat siparişe bağlanamaz");
    }
    // ⚠️ KAÇIŞ KAPISI — boş dizi "sipariş bağını KALDIR" demektir ve `block`
    // rejiminde kurulum kapısını atlatmanın en kısa yoludur (kur → bağı kaldır).
    // Beyan yolu burada YOKTUR (uç yalnız `orderIds` alır): niyetini beyan etmek
    // isteyen kullanıcı sevkiyatı zaten `orderless: true` ile kurar.
    assertOrderLinkAllowed(await resolveOrderRequirement(), { orderIds });
    const branchId = shipment.branchId ?? null;
    await this.assertOrdersBelong(orderIds, shipment.customerId, branchId);

    const dispatched = shipment.status === ShipmentStatus.DISPATCHED;
    let izSet: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      const eski = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      const etkilenen = [...new Set([...eski.map((o) => o.orderId), ...orderIds])];

      // ① Bu sevkiyatın tahsislerini DAMGALA (silme yok, K2) ve defteri onsuz yeniden hesapla.
      await clearShipmentAllocationsTx(tx, shipmentId, userId);
      if (etkilenen.length > 0) {
        const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: etkilenen } }, select: { id: true } });
        await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
        await recomputeOrderStatusForOrdersTx(tx, etkilenen);
      }

      // ② Yeni kümeyi yaz + tahsisleri hesapla (iptal kontrolü orada, kilit altında).
      await this.setShipmentOrdersTx(tx, shipmentId, orderIds);
      izSet = await this.writeShipmentAllocationsTx(tx, shipmentId, orderIds, branchId);

      // ③ Sevk EDİLMİŞ sevkiyatta bağ satırları pasif doğar — `performDispatchTx`
      //    sevk anında hepsini pasifleştiriyor; buradan aktif satır bırakmak
      //    sevkiyatı "hâlâ planlanıyor" gibi gösterirdi.
      if (dispatched) {
        await tx.shipmentOrder.updateMany({ where: { shipmentId }, data: { isActive: false } });
      }

      // ④ Defteri yeni tahsislerle tekrar hesapla.
      if (etkilenen.length > 0) {
        await recomputeOrderStatusForOrdersTx(tx, etkilenen);
      }

      // ⑤ İrsaliye yeni sipariş kümesiyle yeniden donar (v+1). Yalnız sevk
      //    edilmişte anlamlı — PLANNED sevkiyatın belgesi henüz donmamıştır.
      if (dispatched) {
        await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
      }
    });

    await this.flushAllocationAudit(izSet, userId);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SHIPMENT",
      recordId: shipmentId,
      newData: { kind: "SET_ORDERS", orderIds, dispatched },
    });
    return {
      success: true,
      data: { shipmentId, orderIds },
      message:
        orderIds.length === 0
          ? "Sevkiyatın sipariş bağı kaldırıldı"
          : `Sevkiyat ${orderIds.length} siparişe bağlandı — sipariş defteri güncellendi`,
    };
  }

export async function addSacksToShipment(this: ShippingServiceThis, shipmentId: string, sackIdsIn: string[], userId?: string): Promise<ApiResponse<unknown>> {
    const sackIds = [...new Set(sackIdsIn)];
    if (sackIds.length === 0) throw AppError.badRequest("Çuval seçilmeli");
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyata çuval eklenebilir");
    const branchId = shipment.branchId ?? null;
    const { sacks } = await this.loadSacksForShipment(sackIds, { customerId: shipment.customerId, branchId });
    await this.assertWeighed(sacks, shipment.destination);

    let izAdd: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      const liveUnits = await tx.sack.findMany({ where: { shipmentId, ...LIVE_LOAD_UNIT_WHERE }, select: { unitKind: true } });
      assertLoadKindCompatible(liveUnits.map((u) => u.unitKind), LoadUnitKind.SACK);
      const lot = await readPackingLotSettings(tx);
      await assertWholeLotDispatchTx(tx, sackIds, lot.partialDispatch);
      const maxSeqRow = await tx.sack.findFirst({ where: { shipmentId }, orderBy: { seq: "desc" }, select: { seq: true } });
      let seq = maxSeqRow?.seq != null ? maxSeqRow.seq + 1 : await readSackSeqStart(tx);
      for (const sackId of sackIds) {
        const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId: null }, data: { shipmentId, seq, customerId: shipment.customerId, branchId } });
        if (claimed.count !== 1) throw AppError.conflict("Çuvallardan biri az önce başka bir sevkiyata girdi — yenileyin.");
        seq += 1;
      }
      await autoCloseLotsForSacksTx(tx, sackIds, lot.mode === "sevk-partisi", userId);
      await tx.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { shipmentId } });
      await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_ADDED, { scope: { sackIds }, shipment: { id: shipmentId }, ctx: { trigger: "SHIPMENT_ADD_SACKS", userId } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      izAdd = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await this.flushAllocationAudit(izAdd, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "ADD_SACKS", sackIds } });
    return { success: true, data: {}, message: "Çuval(lar) sevkiyata eklendi" };
  }

export async function removeSackFromShipment(this: ShippingServiceThis, shipmentId: string, sackId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true, shipmentId: true, unitKind: true, shipment: { select: { status: true, branchId: true } } } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId !== shipmentId) throw AppError.badRequest("Çuval bu sevkiyatta değil");
    // Dökme/araba havuza dönemez (DB trigger) — yükü boşaltmanın yolu sevkiyat iptalidir.
    if (sack.unitKind !== LoadUnitKind.SACK) {
      throw AppError.conflict("Dökme / araba yükü sevkiyattan tek başına çıkarılamaz — sevkiyatı iptal edin; toplar rafa döner.", { code: "LOAD_UNIT_NOT_REMOVABLE" });
    }
    if (sack.shipment && sack.shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız planlanan sevkiyattan çuval çıkarılabilir");
    const branchId = sack.shipment?.branchId ?? null;
    let izRemove: AllocationAuditTrail | null = null;
    await prisma.$transaction(async (tx) => {
      await touchShipmentPlannedTx(tx, shipmentId);
      // Kilit sırası sevkiyat → çuval → kartela (öteki çuval yollarıyla aynı); claim aşağıda.
      await tx.$queryRaw`SELECT id FROM sacks WHERE id = ${sackId}::uuid FOR UPDATE`;
      // Kartela ÇUVALDAN ÖNCE: bileşik FK (sackId, shipmentId) → sacks ON UPDATE CASCADE
      // anında işler; çuvalın shipmentId'si önce boşalırsa kartelanınki durum değişmeden
      // boşalır ve durum seddi (swatches_status_shape) reddeder.
      await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_REMOVED, { scope: { sackIds: [sackId] }, shipment: { id: shipmentId }, ctx: { trigger: "SHIPMENT_REMOVE_SACK", userId } });
      const claimed = await tx.sack.updateMany({ where: { id: sackId, shipmentId }, data: { shipmentId: null, seq: null } });
      if (claimed.count !== 1) throw AppError.conflict("Çuval bu sırada çıkarıldı — yenileyin");
      const lot = await readPackingLotSettings(tx);
      await reopenLotsForSacksTx(tx, [sackId], lot.mode === "sevk-partisi");
      await tx.roll.updateMany({ where: { sackId }, data: { shipmentId: null } });
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      izRemove = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), branchId);
    });
    await this.flushAllocationAudit(izRemove, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "REMOVE_SACK", sackId } });
    return { success: true, data: {}, message: "Çuval sevkiyattan çıkarıldı (depoya döndü)" };
  }

export async function addLoadByScan(this: ShippingServiceThis, 
    shipmentId: string,
    data: { barcode: string; unitKind?: "BULK" | "CART" | null; unitLabel?: string | null; clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const code = normalizeScanCode(data.barcode);
    if (!code) throw AppError.badRequest("Barkod gerekli");
    if (matchesSeries(resolveSeriesFormat("sack"), code)) {
      const sack = await prisma.sack.findUnique({ where: { sackNo: code }, select: { id: true, sackNo: true, unitKind: true, shipmentId: true } });
      if (!sack || sack.unitKind !== LoadUnitKind.SACK) throw AppError.notFound(`Çuval bulunamadı: ${code}`);
      if (sack.shipmentId === shipmentId) {
        return { success: true, data: { kind: "SACK", sackId: sack.id, sackNo: sack.sackNo, added: 0 }, message: `${sack.sackNo} zaten bu sevkiyatta` };
      }
      const res = await this.addSacksToShipment(shipmentId, [sack.id], userId);
      return { ...res, data: { kind: "SACK", sackId: sack.id, sackNo: sack.sackNo, added: 1 }, message: `${sack.sackNo} eklendi` };
    }
    const resolved = await resolveRollByScanCode(code, { load: (where) => prisma.roll.findUnique({ where, select: { id: true, barcode: true, currentQty: true } }) });
    if (resolved.kind === "AMBIGUOUS") throw ambiguousCustomerCodeError(resolved);
    if (resolved.kind === "NONE") throw AppError.notFound(`Bu barkodla top ya da çuval bulunamadı: ${code}`);
    if (!data.unitKind) {
      throw AppError.badRequest("Top okutuldu — önce yük türünü seçin (Dökme ya da Araba).", { code: "LOAD_UNIT_KIND_REQUIRED" });
    }
    const res = await this.addLooseRollsToShipment(
      shipmentId,
      { kind: data.unitKind, label: data.unitLabel ?? null, rollIds: [resolved.roll.id], clientToken: data.clientToken ?? null },
      userId,
    );
    return { ...res, data: { ...(res.data as object), kind: "ROLL", rollId: resolved.roll.id, barcode: resolved.roll.barcode, rollMeters: Number(resolved.roll.currentQty), ...matchExtras(resolved) } };
  }

export async function addLooseRollsToShipment(this: ShippingServiceThis, 
    shipmentId: string,
    input: LoadUnitInput & { clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    if (!(await readShipmentLooseLoadEnabled())) {
      throw AppError.badRequest(`Çuvalsız sevk (dökme / araba) bu kurulumda kapalı (${settingRowPath("shipmentLooseLoadEnabled")}).`, { code: "LOOSE_LOAD_DISABLED" });
    }
    const rollIds = [...new Set(input.rollIds)];
    const [plan] = planLoadUnits([{ kind: input.kind, label: input.label, rollIds }], rollIds);
    return looseUnitReplay({ shipmentId, kind: plan!.kind, label: plan!.label }).run(input.clientToken, () =>
      this.addLooseRollsFresh(shipmentId, plan!, input.clientToken ?? null, userId),
    );
  }

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function addLooseRollsFresh(this: ShippingServiceThis, shipmentId: string, plan: LoadUnitPlan, clientToken: string | null, userId?: string): Promise<ApiResponse<unknown>> {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
    if (!shipment) throw AppError.notFound("Sevkiyat bulunamadı");
    if (shipment.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Yalnız sevk edilmemiş (planlanan) sevkiyata yük eklenebilir", { code: "SHIPMENT_NOT_PLANNED" });
    // Hızlı Sevk ile AYNI kapılar: dökme/araba tartılamaz → ihracat ve tartı zorunluluğu kapalı.
    if (shipment.destination === ShipmentDestination.EXPORT) {
      throw AppError.badRequest("Yurtdışı sevkiyata dökme / araba yükü eklenemez — çuvallayıp tartın.", { code: "QUICK_SHIP_EXPORT_UNSUPPORTED" });
    }
    if (await readShippingWeighRequiredEnabled()) {
      throw AppError.badRequest("Bu kurulumda sevk öncesi tartı zorunlu — dökme / araba yükü tartılamaz.", { code: "WEIGH_REQUIRED" });
    }
    const rolls = await prisma.roll.findMany({ where: { id: { in: plan.rollIds } }, select: { id: true, barcode: true, status: true, sackId: true, shipmentId: true, warehouseId: true } });
    if (rolls.length !== plan.rollIds.length) throw AppError.notFound("Top bulunamadı");
    let iz: AllocationAuditTrail | null = null;
    const out = await prisma.$transaction(async (tx) => {
      // Kilit sırası sevkiyat → birim → içerik (öteki çuval yollarıyla aynı).
      await touchShipmentPlannedTx(tx, shipmentId);
      const live = await tx.$queryRaw<{ id: string; unitKind: LoadUnitKind; unitLabel: string | null; warehouseId: string | null; seq: number | null }[]>`
        SELECT id, "unitKind", "unitLabel", "warehouseId", seq FROM sacks
        WHERE "shipmentId" = ${shipmentId}::uuid AND "dissolvedAt" IS NULL ORDER BY id FOR UPDATE`;
      assertLoadKindCompatible(live.map((u) => u.unitKind), plan.kind);
      const target = live.find((u) => u.unitKind === plan.kind && (plan.kind === LoadUnitKind.BULK || u.unitLabel === plan.label)) ?? null;
      const fresh = rolls.filter((r) => !(target && r.sackId === target.id && r.shipmentId === shipmentId));
      assertLooseRollsAddable(fresh, live.find((u) => u.warehouseId)?.warehouseId ?? null);
      const unitId = target?.id ?? (await this.openUnitInShipmentTx(tx, { shipment, plan, clientToken, warehouseId: fresh[0]?.warehouseId ?? null })).id;
      if (fresh.length > 0) {
        const claimed = await tx.roll.updateMany({ where: { id: { in: fresh.map((r) => r.id) }, ...SHIPPABLE_ROLL_WHERE }, data: { sackId: unitId, shipmentId } });
        if (claimed.count !== fresh.length) throw AppError.conflict("Top bu sırada başka bir çuvala / sevkiyata girdi — yenileyip tekrar okutun.", { code: "ROLL_TAKEN" });
        await this.markSackContentChangedTx(tx, [unitId]);
        const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
        iz = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), shipment.branchId ?? null);
      }
      return { unitId, opened: target === null, added: fresh.length };
    });
    await this.flushAllocationAudit(iz, userId);
    if (out.added > 0) {
      await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "ADD_LOOSE", unitId: out.unitId, unitKind: plan.kind, unitLabel: plan.label, rollIds: plan.rollIds, opened: out.opened } });
    }
    const unitWord = plan.kind === LoadUnitKind.BULK ? "Dökme" : `Araba ${plan.label}`;
    return {
      success: true,
      data: { shipmentId, unitId: out.unitId, unitKind: plan.kind, unitLabel: plan.label, added: out.added },
      message: out.added > 0 ? `${unitWord} yüküne eklendi (${out.added} top)` : `Top zaten ${unitWord} yükünde`,
    };
  }

export async function openUnitInShipmentTx(
    tx: Prisma.TransactionClient,
    p: { shipment: { id: string; customerId: string; branchId: string | null }; plan: LoadUnitPlan; clientToken: string | null; warehouseId: string | null },
  ): Promise<{ id: string }> {
    const maxSeqRow = await tx.sack.findFirst({ where: { shipmentId: p.shipment.id, seq: { not: null } }, orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = maxSeqRow?.seq != null ? maxSeqRow.seq + 1 : await readSackSeqStart(tx);
    return openLoadUnitTx(tx, {
      sackNo: await nextSackNo(tx),
      kind: p.plan.kind,
      label: p.plan.label,
      customerId: p.shipment.customerId,
      branchId: p.shipment.branchId ?? null,
      warehouseId: p.warehouseId,
      clientToken: p.clientToken,
      shipmentId: p.shipment.id,
      seq,
    });
  }

export async function removeRollFromLoadUnit(this: ShippingServiceThis, shipmentId: string, rollId: string, userId?: string): Promise<ApiResponse<unknown>> {
    const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { id: true, barcode: true, sackId: true, shipmentId: true, sack: { select: { unitKind: true, unitLabel: true } } } });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.shipmentId !== shipmentId || !roll.sackId) throw AppError.conflict("Top bu sevkiyatta değil — yenileyin.", { code: "ROLL_NOT_IN_SHIPMENT" });
    if (roll.sack?.unitKind === LoadUnitKind.SACK) {
      throw AppError.conflict("Çuvaldaki top buradan çıkarılmaz — çuvalı sevkiyattan çıkarıp Paketleme'de düzenleyin.", { code: "ROLL_IN_SACK" });
    }
    const unitId = roll.sackId;
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { branchId: true, status: true } });
    if (shipment?.status !== ShipmentStatus.PLANNED) {
      throw AppError.conflict("Sevk çıkmış ya da iptal edilmiş sevkiyattan top çıkarılamaz.", { code: "SHIPMENT_NOT_PLANNED" });
    }
    let iz: AllocationAuditTrail | null = null;
    const dissolved = await prisma.$transaction(async (tx) => {
      // Sevk çıktıysa / iptal edildiyse 409 (claim); kilit sırası sevkiyat → birim → içerik.
      await touchShipmentPlannedTx(tx, shipmentId);
      await tx.$queryRaw`SELECT id FROM sacks WHERE id = ${unitId}::uuid FOR UPDATE`;
      const removed = await tx.roll.updateMany({ where: { id: rollId, sackId: unitId, shipmentId }, data: { sackId: null, shipmentId: null } });
      if (removed.count !== 1) throw AppError.conflict("Top bu sırada çıkarıldı ya da taşındı — yenileyin.", { code: "ROLL_NOT_IN_SHIPMENT" });
      const left = await tx.roll.count({ where: { sackId: unitId } });
      if (left === 0) {
        await tx.sack.updateMany({ where: { id: unitId, dissolvedAt: null }, data: { dissolvedAt: new Date(), dissolvedById: userId ?? null, seq: null } });
      } else {
        await this.markSackContentChangedTx(tx, [unitId]);
      }
      const orderRows = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      iz = await this.writeShipmentAllocationsTx(tx, shipmentId, orderRows.map((o) => o.orderId), shipment?.branchId ?? null);
      return left === 0;
    });
    await this.flushAllocationAudit(iz, userId);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: "REMOVE_LOOSE_ROLL", unitId, rollId, unitDissolved: dissolved } });
    const unitWord = roll.sack?.unitKind === LoadUnitKind.BULK ? "Dökme" : `Araba ${roll.sack?.unitLabel ?? ""}`.trim();
    return {
      success: true,
      data: { shipmentId, unitId, rollId, unitDissolved: dissolved },
      message: dissolved ? `${roll.barcode ?? "Top"} çıkarıldı — ${unitWord} boşaldı, sevkiyattan düştü` : `${roll.barcode ?? "Top"} ${unitWord} yükünden çıkarıldı (rafa döndü)`,
    };
  }

export async function previewShipmentLoad(input: LoadPreviewInput): Promise<ApiResponse<LoadPreview>> {
    const data = await buildShipmentLoadPreview(input);
    return { success: true, data, ...(data.warnings.length > 0 ? { warnings: data.warnings } : {}) };
  }
