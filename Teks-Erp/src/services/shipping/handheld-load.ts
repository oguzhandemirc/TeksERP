// =============================================================================
// Shipping Service / handheld-load — el terminali sevkiyat kurma (SPEC v2): A1 aç · A3 okut · A4 çuval aç
// =============================================================================
// Yükleme YALNIZ bu boğazdan; sınıflandırma sunucuda (`classifyHandheldScan`), istemci yalnız onay sorar.
// Kilit sırası her uçta: sevkiyat satırı claim'i (`touchShipmentPlannedTx`, tx'in İLK ifadesi) → canlı yük
// birimleri `FOR UPDATE ORDER BY id` → top satırı. Advisory almaz (iptal/storno 8023 → sevkiyat sırasıyla gider).
// =============================================================================
import { LoadUnitKind, Prisma, RollStatus, ShipmentDestination, ShipmentStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { normalizeScanCode } from "../../utils/code-format";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { isClientTokenP2002 } from "../../utils/p2002";
import { AuditService } from "../audit.service";
import { classifyHandheldScan, effectiveRollCustomerSql, notPhysicalText, type HandheldDecision, type HandheldPlace, type HandheldRejectReason } from "../helpers/handheld-scan.helper";
import { assertLoadKindCompatible } from "../helpers/load-unit.helper";
import { resolveRollByScanCode } from "../helpers/roll-scan-resolve.helper";
import { touchShipmentPlannedTx } from "../helpers/shipment-locks.helper";
import { readShipmentLooseLoadEnabled, readShippingWeighRequiredEnabled } from "../system-setting.service";
import { SHIPPABLE_ROLL_WHERE, type AllocationAuditTrail, type ShippingServiceThis } from "./shared";
import { assertHandheldEnabled, getHandheldLoadState, lockLiveUnitsTx, LOOSE_LABEL, type HandheldLoadState, type LiveUnit } from "./handheld-state";

type Tx = Prisma.TransactionClient;
type PlaceRef = { sackId: string | null; label: string };

export type HandheldOutcome =
  | { kind: "added"; rollId: string; barcode: string | null; to: PlaceRef; replayed?: true }
  | { kind: "transferred"; rollId: string; barcode: string | null; from: PlaceRef; to: PlaceRef }
  | { kind: "needsRemoveConfirm"; rollId: string; barcode: string | null; from: PlaceRef }
  | { kind: "removed"; rollId: string; barcode: string | null; from: PlaceRef; unitDissolved: boolean; replayed?: true }
  | { kind: "needsNotReadyConfirm"; rollId: string; barcode: string | null; reason: "ROLL_NOT_READY"; stageLabel: string }
  | { kind: "sackSelected"; sackId: string; sackNo: string }
  | { kind: "rejected"; reason: HandheldRejectReason; message: string; barcode: string; meta?: { shipmentNo?: string; sackNo?: string; ownerName?: string; status?: RollStatus } };

export interface HandheldScanBody {
  barcode: string;
  targetSackId: string | null;
  confirmRemove?: boolean;
  confirmNotReady?: boolean;
  isRetry?: boolean;
  clientToken: string;
}

type LockedRoll = {
  id: string; barcode: string | null; status: RollStatus; sackId: string | null; shipmentId: string | null; warehouseId: string | null;
  ownerCustomerId: string | null; workOrderCustomerId: string | null; effectiveOwner: string | null;
};
type ScanShipment = { id: string; customerId: string; branchId: string | null };

async function lockRollTx(tx: Tx, rollId: string): Promise<LockedRoll> {
  const rows = await tx.$queryRaw<LockedRoll[]>`
    SELECT r.id, r.barcode, r.status, r."sackId", r."shipmentId", r."warehouseId", r."ownerCustomerId",
      (SELECT wo."customerId" FROM batches b JOIN work_orders wo ON wo.id = b."workOrderId" WHERE b.id = r."batchId") AS "workOrderCustomerId",
      ${effectiveRollCustomerSql("r")} AS "effectiveOwner"
    FROM rolls r WHERE r.id = ${rollId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw AppError.notFound("Top bulunamadı");
  return rows[0]!;
}

/** Tx dışı ön kapılar (UX + akış hataları); otorite tx içindeki claim'dedir. */
async function preflightScan(shipmentId: string, targetSackId: string | null): Promise<ScanShipment> {
  const sh = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, status: true, customerId: true, branchId: true, destination: true } });
  if (!sh) throw AppError.notFound("Sevkiyat bulunamadı");
  if (sh.status !== ShipmentStatus.PLANNED) throw AppError.conflict("Sevkiyat sevk edilmiş ya da iptal edilmiş — okutma yapılamaz.", { code: "SHIPMENT_NOT_PLANNED" });
  if (sh.destination === ShipmentDestination.EXPORT) {
    throw AppError.badRequest("Yurtdışı sevkiyat el terminalinden kurulamaz — çuvallayıp tartın.", { code: "QUICK_SHIP_EXPORT_UNSUPPORTED" });
  }
  if (await readShippingWeighRequiredEnabled()) {
    throw AppError.badRequest("Bu kurulumda sevk öncesi tartı zorunlu — el terminali sevki kullanılamaz.", { code: "WEIGH_REQUIRED" });
  }
  if (targetSackId === null && !(await readShipmentLooseLoadEnabled())) {
    throw AppError.badRequest("Çuvalsız sevk bu kurulumda kapalı — önce bir çuval seçin.", { code: "LOOSE_LOAD_DISABLED" });
  }
  return { id: sh.id, customerId: sh.customerId, branchId: sh.branchId };
}

/** Top bulunamadı: bu sevkiyatın çuval kodu mu (K7 → seç), başka çuval mı, hiçbiri mi. */
async function sackCodeOutcome(shipmentId: string, code: string): Promise<HandheldOutcome> {
  const sack = code ? await prisma.sack.findUnique({ where: { sackNo: code }, select: { id: true, sackNo: true, shipmentId: true, unitKind: true, dissolvedAt: true } }) : null;
  if (sack && sack.shipmentId === shipmentId && sack.unitKind === LoadUnitKind.SACK && sack.dissolvedAt === null) {
    return { kind: "sackSelected", sackId: sack.id, sackNo: sack.sackNo };
  }
  if (sack) return { kind: "rejected", reason: "SACK_CODE", message: `${sack.sackNo} bu sevkiyatın çuvalı değil — top barkodu okutun.`, barcode: code, meta: { sackNo: sack.sackNo } };
  return { kind: "rejected", reason: "NOT_FOUND", message: `Bu barkodla top bulunamadı: ${code}`, barcode: code };
}

/** Ret metni + meta (sevkiyat no, çuval no, sahip adı) — tx içinde, kilitli satırdan. */
async function rejectionOf(tx: Tx, reason: HandheldRejectReason, roll: LockedRoll, code: string): Promise<HandheldOutcome> {
  const base = { kind: "rejected" as const, reason, barcode: roll.barcode ?? code };
  switch (reason) {
    case "ROLL_SHIPPED": {
      const sh = roll.shipmentId ? await tx.shipment.findUnique({ where: { id: roll.shipmentId }, select: { shipmentNo: true } }) : null;
      return { ...base, message: `Bu top zaten sevk edildi${sh ? ` (${sh.shipmentNo})` : ""}.`, meta: { status: roll.status, ...(sh ? { shipmentNo: sh.shipmentNo } : {}) } };
    }
    case "ROLL_IN_OTHER_SHIPMENT": {
      const sh = await tx.shipment.findUnique({ where: { id: roll.shipmentId! }, select: { shipmentNo: true } });
      return { ...base, message: `Bu top başka bir sevkiyatta: ${sh?.shipmentNo ?? "?"}`, meta: { shipmentNo: sh?.shipmentNo } };
    }
    case "ROLL_IN_POOL_SACK": {
      const sk = await tx.sack.findUnique({ where: { id: roll.sackId! }, select: { sackNo: true } });
      return { ...base, message: `Bu top ${sk?.sackNo ?? "?"} çuvalında (Paketleme) — önce oradan çıkarın.`, meta: { sackNo: sk?.sackNo } };
    }
    case "OWNER_MISMATCH": {
      const c = roll.effectiveOwner ? await tx.customer.findUnique({ where: { id: roll.effectiveOwner }, select: { name: true } }) : null;
      return { ...base, message: `Başka carinin malı: ${c?.name ?? "?"}`, meta: { ownerName: c?.name } };
    }
    case "WAREHOUSE_MISMATCH":
      return { ...base, message: "Bu top başka depoda — tek sevkiyat tek depodan çıkar.", meta: { status: roll.status } };
    case "ROLL_NOT_PHYSICAL":
      return { ...base, message: notPhysicalText(roll.status), meta: { status: roll.status } };
    default:
      return { ...base, message: "Top eklenemedi." };
  }
}

/** Dökme birimi bul ya da (yoksa) sevkiyatın içinde aç — mevcut TEK yaratıcı üstünden. */
async function ensureBulkTx(this: ShippingServiceThis, tx: Tx, p: { shipment: ScanShipment; live: LiveUnit[]; token: string; warehouseId: string | null }): Promise<string> {
  const bulk = p.live.find((u) => u.unitKind === LoadUnitKind.BULK);
  if (bulk) return bulk.id;
  assertLoadKindCompatible(p.live.map((u) => u.unitKind), LoadUnitKind.BULK, { allowSackWithBulk: true });
  const opened = await this.openUnitInShipmentTx(tx, {
    shipment: p.shipment, plan: { kind: LoadUnitKind.BULK, label: null, rollIds: [] }, clientToken: p.token, warehouseId: p.warehouseId,
  });
  return opened.id;
}

/** Boşalan dökmeyi çözer (çuval boş kalır; sevkte düşer, K8). Döner: çözüldü mü. */
async function dissolveIfEmptyBulkTx(tx: Tx, unitId: string, live: LiveUnit[], userId?: string): Promise<boolean> {
  if (live.find((u) => u.id === unitId)?.unitKind !== LoadUnitKind.BULK) return false;
  if ((await tx.roll.count({ where: { sackId: unitId } })) > 0) return false;
  await tx.sack.updateMany({ where: { id: unitId, dissolvedAt: null }, data: { dissolvedAt: new Date(), dissolvedById: userId ?? null, seq: null } });
  return true;
}

type ApplyCtx = { shipment: ScanShipment; live: LiveUnit[]; roll: LockedRoll; token: string; userId?: string };
type Applied = { written: boolean; unitDissolved: boolean; toUnit: string | null; fromUnit: string | null };

/** Kararı atomik claim'lerle uygular; yazım yalnız added/transferred/removed (replay hariç). */
async function applyDecisionTx(this: ShippingServiceThis, tx: Tx, d: HandheldDecision, c: ApplyCtx): Promise<Applied> {
  const none: Applied = { written: false, unitDissolved: false, toUnit: null, fromUnit: c.roll.sackId };
  const shipmentId = c.shipment.id;
  const unitFor = async (place: HandheldPlace) => place ?? (await ensureBulkTx.call(this, tx, { shipment: c.shipment, live: c.live, token: c.token, warehouseId: c.roll.warehouseId }));
  if (d.kind === "added" && !d.replayed) {
    const to = await unitFor(d.to);
    const claimed = await tx.roll.updateMany({ where: { id: c.roll.id, ...SHIPPABLE_ROLL_WHERE }, data: { sackId: to, shipmentId } });
    if (claimed.count !== 1) throw AppError.conflict("Top bu sırada başka bir yüke girdi — ekranı yenileyin.", { code: "ROLL_TAKEN" });
    // Çuval depoyu ilk topundan alır (A4 depo boş açar; sevkiyatın deposu ilk depolu birimdir).
    if (c.roll.warehouseId) await tx.sack.updateMany({ where: { id: to, warehouseId: null }, data: { warehouseId: c.roll.warehouseId } });
    await this.markSackContentChangedTx(tx, [to]);
    return { written: true, unitDissolved: false, toUnit: to, fromUnit: null };
  }
  if (d.kind === "transferred") {
    const from = c.roll.sackId!;
    const to = await unitFor(d.to);
    const moved = await tx.roll.updateMany({ where: { id: c.roll.id, sackId: from, shipmentId }, data: { sackId: to } });
    if (moved.count !== 1) throw AppError.conflict("Top bu sırada taşındı — ekranı yenileyin.", { code: "ROLL_MOVED" });
    const dissolved = await dissolveIfEmptyBulkTx(tx, from, c.live, c.userId);
    await this.markSackContentChangedTx(tx, dissolved ? [to] : [from, to]);
    return { written: true, unitDissolved: dissolved, toUnit: to, fromUnit: from };
  }
  if (d.kind === "removed" && !d.replayed) {
    const from = c.roll.sackId!;
    const removed = await tx.roll.updateMany({ where: { id: c.roll.id, sackId: from, shipmentId }, data: { sackId: null, shipmentId: null } });
    if (removed.count !== 1) throw AppError.conflict("Top bu sırada taşındı — ekranı yenileyin.", { code: "ROLL_MOVED" });
    const dissolved = await dissolveIfEmptyBulkTx(tx, from, c.live, c.userId);
    if (!dissolved) await this.markSackContentChangedTx(tx, [from]);
    return { written: true, unitDissolved: dissolved, toUnit: null, fromUnit: from };
  }
  return none;
}

function placeRef(unitId: string | null, live: LiveUnit[]): PlaceRef {
  const u = unitId ? live.find((x) => x.id === unitId) : undefined;
  if (!u || u.unitKind === LoadUnitKind.BULK) return { sackId: null, label: LOOSE_LABEL };
  return { sackId: u.id, label: u.sackNo };
}

function outcomeOf(d: HandheldDecision, roll: LockedRoll, a: Applied, live: LiveUnit[]): HandheldOutcome {
  const head = { rollId: roll.id, barcode: roll.barcode };
  const ref = (place: HandheldPlace, unit: string | null) => (place === null ? { sackId: null, label: LOOSE_LABEL } : placeRef(unit ?? place, live));
  switch (d.kind) {
    case "added":
      return { kind: "added", ...head, to: ref(d.to, a.toUnit), ...(d.replayed ? { replayed: true as const } : {}) };
    case "transferred":
      return { kind: "transferred", ...head, from: ref(d.from, a.fromUnit), to: ref(d.to, a.toUnit) };
    case "needsRemoveConfirm":
      return { kind: "needsRemoveConfirm", ...head, from: ref(d.from, roll.sackId) };
    case "removed":
      return { kind: "removed", ...head, from: ref(d.from, a.fromUnit), unitDissolved: a.unitDissolved, ...(d.replayed ? { replayed: true as const } : {}) };
    case "needsNotReadyConfirm":
      return { kind: "needsNotReadyConfirm", ...head, reason: "ROLL_NOT_READY", stageLabel: d.stageLabel };
    default:
      throw new Error("rejected kararı outcomeOf'a gelmez");
  }
}

const AUDIT_KIND = { added: "HANDHELD_SCAN_ADD", transferred: "HANDHELD_SCAN_MOVE", removed: "HANDHELD_SCAN_REMOVE" } as const;

/** A3 — tek okutma ucu. İş kararları 200 + `outcome`; akış hataları HTTP (sözleşme §A3). */
export async function scanIntoShipment(this: ShippingServiceThis, shipmentId: string, body: HandheldScanBody, userId?: string): Promise<{ outcome: HandheldOutcome; state: HandheldLoadState }> {
  await assertHandheldEnabled();
  const shipment = await preflightScan(shipmentId, body.targetSackId);
  const code = normalizeScanCode(body.barcode);
  const resolved = await resolveRollByScanCode(code, { load: (where) => prisma.roll.findUnique({ where, select: { id: true } }) });
  if (resolved.kind !== "FOUND") {
    const outcome: HandheldOutcome = resolved.kind === "AMBIGUOUS"
      ? { kind: "rejected", reason: "AMBIGUOUS_CODE", message: `Bu müşteri kodu birden çok topta var (${code}) — topun kendi barkodunu okutun.`, barcode: code }
      : await sackCodeOutcome(shipmentId, code);
    return { outcome, state: await getHandheldLoadState(shipmentId) };
  }
  const flags = { confirmRemove: body.confirmRemove === true, confirmNotReady: body.confirmNotReady === true, isRetry: body.isRetry === true };
  const trail: { iz: AllocationAuditTrail | null } = { iz: null };
  const res = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
    await touchShipmentPlannedTx(tx, shipmentId);
    const live = await lockLiveUnitsTx(tx, shipmentId);
    if (body.targetSackId !== null && !live.some((u) => u.id === body.targetSackId && u.unitKind === LoadUnitKind.SACK)) {
      throw AppError.conflict("Seçili çuval artık bu sevkiyatta değil — ekranı yenileyin.", { code: "TARGET_SACK_GONE" });
    }
    const roll = await lockRollTx(tx, resolved.roll.id);
    const rollUnitKind = roll.sackId ? (live.find((u) => u.id === roll.sackId)?.unitKind ?? LoadUnitKind.SACK) : null;
    const warehouseId = live.find((u) => u.warehouseId)?.warehouseId ?? null;
    const d = classifyHandheldScan({ roll, rollUnitKind, shipment: { id: shipmentId, customerId: shipment.customerId, warehouseId }, target: body.targetSackId, flags });
    if (d.kind === "rejected") return { outcome: await rejectionOf(tx, d.reason, roll, code), written: false, kind: d.kind };
    const a = await applyDecisionTx.call(this, tx, d, { shipment, live, roll, token: body.clientToken, userId });
    if (a.written) {
      const orders = await tx.shipmentOrder.findMany({ where: { shipmentId }, select: { orderId: true } });
      trail.iz = await this.writeShipmentAllocationsTx(tx, shipmentId, orders.map((o) => o.orderId), shipment.branchId);
    }
    return { outcome: outcomeOf(d, roll, a, live), written: a.written, kind: d.kind };
  }), undefined, (err) => !isClientTokenP2002(err)).catch((err: unknown) => {
    if (isClientTokenP2002(err)) throw AppError.conflict("Bu okutma anahtarı daha önce başka bir yük için kullanılmış — yeniden okutun.", { code: "CLIENT_TOKEN_COLLISION" });
    throw err;
  });
  await this.flushAllocationAudit(trail.iz, userId);
  if (res.written && res.outcome.kind !== "rejected" && res.outcome.kind !== "sackSelected") {
    await AuditService.log({ userId, action: "UPDATE", tableName: "SHIPMENT", recordId: shipmentId, newData: { kind: AUDIT_KIND[res.kind as keyof typeof AUDIT_KIND], outcome: res.outcome } });
  }
  return { outcome: res.outcome, state: await getHandheldLoadState(shipmentId) };
}
