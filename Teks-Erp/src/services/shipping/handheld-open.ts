// =============================================================================
// Shipping Service / handheld-open — el terminali: A1 boş PLANNED sevkiyat aç · A4 sevkiyat içinde çuval aç
// =============================================================================
// A1 yeni yaratıcı DEĞİL: sevkiyat çekirdeğinin (`createShipmentCoreTx`) boş küme çağrısıdır; cari kilidi,
// risk, numara, `ShipmentEvent PLANNED` çekirdekten gelir. Onay bayrağından bağımsız PLANNED doğar (yük sonra).
// Replay kimliği cari + şube: yük okutuldukça değişir, `shipmentReplay`in çuval kümesi kimliği burada yanlış olurdu.
// =============================================================================
import { LoadUnitKind, ShipmentDestination, ShipmentStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { isClientTokenP2002 } from "../../utils/p2002";
import { AuditService } from "../audit.service";
import { assertLoadKindCompatible } from "../helpers/load-unit.helper";
import { quickShipExportMessage, type ShipmentDestinationSource } from "../helpers/shipment-destination.helper";
import { touchShipmentPlannedTx } from "../helpers/shipment-locks.helper";
import { assertOrderLinkAllowed, resolveOrderRequirement } from "../helpers/shipment-order-requirement.helper";
import { tokenReplay } from "../helpers/token-replay.helper";
import { readShipmentLooseLoadEnabled } from "../system-setting.service";
import { settingRowPath } from "../../constants/panel-ayar-yolu";
import { type ShippingServiceThis } from "./shared";
import { assertHandheldEnabled, getHandheldLoadState, lockLiveUnitsTx, type HandheldLoadState } from "./handheld-state";

export type HandheldOpenResult = { created: boolean; state: HandheldLoadState };

function handheldShipmentReplay(ident: { customerId: string; branchId: string | null }) {
  return tokenReplay<{ id: string; shipmentNo: string; status: ShipmentStatus; customerId: string; branchId: string | null }, HandheldOpenResult>({
    find: (db, clientToken) => db.shipment.findUnique({ where: { clientToken }, select: { id: true, shipmentNo: true, status: true, customerId: true, branchId: true } }),
    alive: (p) => {
      if (p.status !== ShipmentStatus.CANCELLED) return;
      throw AppError.conflict(`Bu sevkiyat (${p.shipmentNo}) açılmış ama İPTAL EDİLMİŞ — yeni sevkiyat açın.`, { code: "SHIPMENT_CANCELLED", shipmentNo: p.shipmentNo });
    },
    identity: (p) => [
      { ad: "customerId", mevcut: p.customerId, gelen: ident.customerId },
      { ad: "branchId", mevcut: p.branchId, gelen: ident.branchId },
    ],
    collision: (p) => `Bu istek daha önce ${p.shipmentNo} sevkiyatı olarak kaydedilmiş — ekranı kapatıp yeniden açın.`,
    collisionEk: (p) => ({ shipmentNo: p.shipmentNo }),
    respond: async (p) => ({ created: false, state: await getHandheldLoadState(p.id) }),
  });
}

async function assertOpenAllowed(customerId: string, branchId: string | null): Promise<void> {
  if (!(await readShipmentLooseLoadEnabled())) {
    throw AppError.badRequest(`Çuvalsız sevk (dökme / araba) bu kurulumda kapalı (${settingRowPath("shipmentLooseLoadEnabled")}) — el terminali sevki bunu gerektirir.`, { code: "LOOSE_LOAD_DISABLED" });
  }
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { isActive: true } });
  if (!customer?.isActive) throw AppError.notFound("Cari bulunamadı ya da pasif");
  if (branchId) {
    const branch = await prisma.customerBranch.findFirst({ where: { id: branchId, customerId, isActive: true }, select: { id: true } });
    if (!branch) throw AppError.badRequest("Şube bu cariye ait değil ya da pasif");
  }
  assertOrderLinkAllowed(await resolveOrderRequirement(), { orderIds: [], orderless: true });
}

/** A1 — boş PLANNED sevkiyat. 201 yeni (`created:true`), 200 replay. */
export async function openHandheldShipment(this: ShippingServiceThis, body: { customerId: string; branchId?: string | null; clientToken: string }, userId?: string): Promise<HandheldOpenResult> {
  await assertHandheldEnabled();
  const branchId = body.branchId ?? null;
  await assertOpenAllowed(body.customerId, branchId);
  const exportGate = (destination: ShipmentDestination, lockSource: ShipmentDestinationSource | null): void => {
    if (destination === ShipmentDestination.EXPORT) throw AppError.badRequest(quickShipExportMessage(lockSource), { code: "QUICK_SHIP_EXPORT_UNSUPPORTED", source: lockSource });
  };
  return handheldShipmentReplay({ customerId: body.customerId, branchId }).run(body.clientToken, async () => {
    const core = await withBarcodeRetry(
      () => prisma.$transaction((tx) => this.createShipmentCoreTx(tx, {
        sackIds: [], customerId: body.customerId, branchId, orderIds: [], assertDestination: exportGate,
        clientToken: body.clientToken, confirmationEnabled: true, orderless: true, userId,
      })),
      undefined,
      (err) => !isClientTokenP2002(err),
    );
    await this.flushAllocationAudit(core.iz, userId);
    await this.logFirstShipmentDestination(core.yon, core.id, userId);
    await AuditService.log({ userId, action: "CREATE", tableName: "SHIPMENT", recordId: core.id, newData: { kind: "HANDHELD_OPEN", shipmentNo: core.shipmentNo, customerId: body.customerId, branchId } });
    return { created: true, state: await getHandheldLoadState(core.id) };
  });
}

export type HandheldSackOpenResult = { created: boolean; sack: { id: string; sackNo: string; seq: number | null; seqLabel: string | null }; state: HandheldLoadState };

async function sackResult(sackId: string, shipmentId: string, created: boolean): Promise<HandheldSackOpenResult> {
  const state = await getHandheldLoadState(shipmentId);
  const s = state.sacks.find((x) => x.id === sackId);
  if (s) return { created, sack: { id: s.id, sackNo: s.sackNo, seq: s.seq, seqLabel: s.seqLabel }, state };
  // Çuval bu arada düştü (sevk/iptal) — kimlik yine dönülür, etiket hesaplanmaz.
  const row = await prisma.sack.findUniqueOrThrow({ where: { id: sackId }, select: { id: true, sackNo: true, seq: true } });
  return { created, sack: { ...row, seqLabel: null }, state };
}

function sackReplay(shipmentId: string) {
  return tokenReplay<{ id: string; shipmentId: string | null; unitKind: LoadUnitKind; sackNo: string }, HandheldSackOpenResult>({
    find: (db, clientToken) => db.sack.findUnique({ where: { clientToken }, select: { id: true, shipmentId: true, unitKind: true, sackNo: true } }),
    // Ölü hâl kimlikte yakalanır: havuza dönen çuvalın shipmentId'si değişir → 409 çakışma.
    alive: { neverDies: "Çuvalın ayrı iptal hâli yok; sevkiyattan ayrılırsa shipmentId kimliği tutmaz" },
    identity: (p) => [
      { ad: "shipmentId", mevcut: p.shipmentId, gelen: shipmentId },
      { ad: "unitKind", mevcut: p.unitKind, gelen: LoadUnitKind.SACK },
    ],
    collision: (p) => `Bu istek daha önce başka bir yük (${p.sackNo}) için kullanılmış — yeniden deneyin.`,
    respond: (p) => sackResult(p.id, shipmentId, false),
  });
}

/** A4 — sevkiyatın içinde yeni çuval (dökme varken de; karışık yük yalnız bu yolda). */
export async function openSackInShipment(this: ShippingServiceThis, shipmentId: string, body: { clientToken: string }, userId?: string): Promise<HandheldSackOpenResult> {
  await assertHandheldEnabled();
  return sackReplay(shipmentId).run(body.clientToken, async () => {
    const sh = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, customerId: true, branchId: true } });
    if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
    const opened = await withBarcodeRetry(
      () => prisma.$transaction(async (tx) => {
        await touchShipmentPlannedTx(tx, shipmentId);
        const live = await lockLiveUnitsTx(tx, shipmentId);
        assertLoadKindCompatible(live.map((u) => u.unitKind), LoadUnitKind.SACK, { allowSackWithBulk: true });
        const warehouseId = live.find((u) => u.warehouseId)?.warehouseId ?? null;
        const unit = await this.openUnitInShipmentTx(tx, { shipment: sh, plan: { kind: LoadUnitKind.SACK, label: null, rollIds: [] }, clientToken: body.clientToken, warehouseId });
        return tx.sack.findUniqueOrThrow({ where: { id: unit.id }, select: { id: true, sackNo: true, seq: true } });
      }),
      undefined,
      (err) => !isClientTokenP2002(err),
    );
    await AuditService.log({ userId, action: "CREATE", tableName: "SACK", recordId: opened.id, newData: { kind: "HANDHELD_SACK_OPEN", shipmentId, sackNo: opened.sackNo, seq: opened.seq } });
    return sackResult(opened.id, shipmentId, true);
  });
}
