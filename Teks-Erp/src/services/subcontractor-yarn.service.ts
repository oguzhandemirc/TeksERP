// =============================================================================
// FASON SEVKİNDE İPLİK KALEMİ (G1) — git · storno · dön · storno — fasondaki bakiye TÜRETİLİR
// =============================================================================
// Hüküm 1e 2026-09-15 (H1–H5). Fiziksel çıkış belgesi `SubcontractorDispatch` (kalem `kind=YARN`:
// `yarnItemId` + `warehouseId` + `lotId?`, `dispatchedQty` = KG, DTO `unit:"KG"`); defteri İPLİK
// defteridir — dört tür, HER satır kaleme bağlı (`YarnMovement.dispatchItemId`, CHECK iki yönlü):
//   SUBCONTRACT_OUT            depo −kg   kalem doğarken, AYNI tx (kalem başına TEK, partial unique)
//   SUBCONTRACT_OUT_CANCEL     depo +kg   sevk iptali (açık dönüş varsa 409 — LIFO)
//   SUBCONTRACT_RETURN         depo +kg   fasondan dönüş; KISMİ, çok satır; sebep kodu ZORUNLU
//   SUBCONTRACT_RETURN_CANCEL  depo −kg   dönüş stornosu (aynı depo/lot/sebep grubunda net ≥ kg)
// Yazıcı TEK: `yarn.service` `applyYarnMovementTx` — iplik modül kapısı ve eksi bakiye kapısı ORADA,
// aksiyon anında (iplik KAPALI + iplik kalemi → 403 MODULE_DISABLED; top/levent yolları dokunmaz).
// K1 (b): fasondaki iplik SANAL DEPO DEĞİLDİR — bakiye Σ(OUT − OUT_CANCEL − RETURN + RETURN_CANCEL)
// ile kalem × lot başına türetilir (`yarnAtSubcontractor`); G1c: fasona sardırılan leventin WOUND olayı
// iplik kalemine bağlanır (`WarpBeamEvent.dispatchItemId`), leventin nominal kg'sı `sarilanKg` olarak AYRI
// düşer — kaynağı beyanlı (`kgSource`: THEORETICAL/WEIGHED), storno edilmiş sarım (WOUND_CANCEL) sayılmaz.
// Ters yol KARŞI OLAYDIR (`reverses*` bağı yok; wind servisinin `cancelWound` kalıbı): storno satırı
// aynı depo/lot/sebep grubuna yazılır, "açık" = grubun net'i > 0. Dönüş ucu panel-yalnız (H6), token'sız
// (`yarn.routes` create emsali); tablet yüzeyi doğarsa `clientToken` kolonu o dilimde.
// =============================================================================
import { ItemType, Prisma, ReasonPresetKind, SubcontractorDispatchItemKind, YarnMovementKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { applyYarnMovementTx } from "./yarn.service";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const KG_SCALE = 3;

function kg(v: number | string, ad: string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(KG_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest(`${ad} sıfırdan büyük olmalı`);
  return d;
}

export interface YarnDispatchLineInput {
  /** Stok kartı (`ItemType.YARN`). */
  itemId: string;
  warehouseId: string;
  lotId?: string | null;
  qtyKg: number | string;
}
export interface YarnDispatchLine {
  dispatchItemId: string;
  itemId: string;
  itemCode: string;
  warehouseId: string;
  lotId: string | null;
  qtyKg: Prisma.Decimal;
}

/** Kalem + defteri — iptal/dönüş "bu kalemin çıkışı / açık dönüşü" sorusunu buradan cevaplar. */
const YARN_ITEM_SELECT = {
  id: true, kind: true, yarnItemId: true, warehouseId: true, lotId: true, dispatchedQty: true,
  dispatch: { select: { id: true, dispatchNo: true, cancelledAt: true } },
  yarnItem: { select: { code: true, name: true } },
  yarnMovements: { select: { id: true, kind: true, qtyKg: true, warehouseId: true, lotId: true, reasonCode: true }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SubcontractorDispatchItemSelect;
type YarnItemRow = Prisma.SubcontractorDispatchItemGetPayload<{ select: typeof YARN_ITEM_SELECT }>;

/** Σ dönüş − Σ dönüş stornosu (kalem geneli). */
function returnedNet(item: YarnItemRow): Prisma.Decimal {
  return item.yarnMovements.reduce((acc, m) => {
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN) return acc.plus(m.qtyKg);
    if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN_CANCEL) return acc.minus(m.qtyKg);
    return acc;
  }, D(0));
}
function shipOutOf(item: YarnItemRow) {
  const m = item.yarnMovements.find((x) => x.kind === YarnMovementKind.SUBCONTRACT_OUT);
  // Kalem OUT'suz doğmaz (aynı tx); yoksa defter/kalem ayrışmış — sessizce devam edilmez.
  if (!m) throw AppError.conflict(`${item.yarnItem?.code ?? item.id} kaleminin iplik çıkış satırı yok — defter tutarsız, elle inceleme gerekir`, { code: "YARN_ITEM_LEDGER_GAP" });
  return m;
}

/**
 * İplik kalemlerini yeni sevke yazar + SUBCONTRACT_OUT aynı tx'te. Satırlar (depo, lot) sırasında işlenir —
 * eksi bakiye kapısı `FOR UPDATE` alır, sıra deterministik olmazsa iki sevk birbirini kilitler (K4).
 */
export async function dispatchYarnItemsTx(
  tx: Tx,
  input: { dispatchId: string; lines: YarnDispatchLineInput[]; userId?: string },
): Promise<{ lines: YarnDispatchLine[]; totalKg: Prisma.Decimal }> {
  const sorted = [...input.lines].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId) || (a.lotId ?? "").localeCompare(b.lotId ?? ""));
  const lines: YarnDispatchLine[] = [];
  let totalKg = D(0);
  for (const line of sorted) {
    const qty = kg(line.qtyKg, "İplik kg");
    const item = await tx.item.findUnique({ where: { id: line.itemId }, select: { id: true, code: true, itemType: true, isActive: true } });
    if (!item || item.itemType !== ItemType.YARN) throw AppError.badRequest("Fasona yalnız İPLİK stok kartı gönderilir", { code: "YARN_ITEM_TYPE", itemId: line.itemId });
    if (!item.isActive) throw AppError.badRequest(`${item.code} pasif — fasona gönderilemez`, { code: "YARN_ITEM_INACTIVE" });
    const wh = await tx.warehouse.findUnique({ where: { id: line.warehouseId }, select: { id: true, isActive: true } });
    if (!wh || !wh.isActive) throw AppError.badRequest("Çıkış deposu yok ya da pasif", { code: "WAREHOUSE_INVALID", warehouseId: line.warehouseId });
    const created = await tx.subcontractorDispatchItem.create({
      data: { dispatchId: input.dispatchId, kind: SubcontractorDispatchItemKind.YARN, yarnItemId: item.id, warehouseId: wh.id, lotId: line.lotId ?? null, dispatchedQty: qty, dispatchedWeight: null },
      select: { id: true },
    });
    // Lot kimliği ve eksi bakiye kapısı tek yazıcıda; iplik modülü kapalıysa burada 403.
    await applyYarnMovementTx(tx, {
      itemId: item.id, warehouseId: wh.id, kind: YarnMovementKind.SUBCONTRACT_OUT, qtyKg: qty,
      lotId: line.lotId ?? null, dispatchItemId: created.id, userId: input.userId ?? null, reason: "Fason sevki",
    });
    lines.push({ dispatchItemId: created.id, itemId: item.id, itemCode: item.code, warehouseId: wh.id, lotId: line.lotId ?? null, qtyKg: qty });
    totalKg = totalKg.plus(qty);
  }
  return { lines, totalKg };
}

/** Sevk iptali ÖNCESİ engel sinyali: bu sevkten DÖNMÜŞ (net dönüşü > 0) iplik kalemi sayısı. */
export async function countReturnedYarnItems(client: Pick<typeof prisma, "subcontractorDispatchItem">, dispatchId: string): Promise<number> {
  const items = await client.subcontractorDispatchItem.findMany({ where: { dispatchId, kind: SubcontractorDispatchItemKind.YARN }, select: YARN_ITEM_SELECT });
  return items.filter((i) => returnedNet(i).gt(0)).length;
}

/**
 * Sevk iptalinde iplik kalemleri: SUBCONTRACT_OUT_CANCEL (aynı depo/lot, çıkış kg'sı). Dönmüş kalem varsa 409
 * `YARN_ITEM_RETURNED` (LIFO: önce dönüş stornosu). Sevk claim'inden SONRA çağrılır.
 */
export async function cancelYarnItemsTx(tx: Tx, input: { dispatchId: string; reason: string; userId?: string }): Promise<number> {
  const items = await tx.subcontractorDispatchItem.findMany({ where: { dispatchId: input.dispatchId, kind: SubcontractorDispatchItemKind.YARN }, select: YARN_ITEM_SELECT });
  for (const it of items) {
    const out = shipOutOf(it);
    if (returnedNet(it).gt(0)) {
      throw AppError.conflict(`${it.yarnItem?.code} ipliği bu sevkten dönmüş — sevk iptal edilemez, önce dönüşü iptal edin`, { code: "YARN_ITEM_RETURNED", itemCode: it.yarnItem?.code });
    }
    await applyYarnMovementTx(tx, {
      itemId: it.yarnItemId!, warehouseId: out.warehouseId, kind: YarnMovementKind.SUBCONTRACT_OUT_CANCEL, qtyKg: out.qtyKg,
      lotId: out.lotId, dispatchItemId: it.id, userId: input.userId ?? null, reason: input.reason,
    });
  }
  return items.length;
}

async function loadYarnItem(tx: Tx, dispatchId: string, dispatchItemId: string): Promise<YarnItemRow> {
  const item = await tx.subcontractorDispatchItem.findUnique({ where: { id: dispatchItemId }, select: YARN_ITEM_SELECT });
  if (!item || item.dispatch.id !== dispatchId || item.kind !== SubcontractorDispatchItemKind.YARN) throw AppError.notFound("Bu sevkte böyle bir iplik kalemi yok");
  if (item.dispatch.cancelledAt) throw AppError.conflict(`${item.dispatch.dispatchNo} iptal edilmiş — iplik işlemi yapılamaz`, { code: "DISPATCH_CANCELLED" });
  return item;
}

async function assertReturnReasonTx(tx: Tx, code: string): Promise<string> {
  const trimmed = code.trim();
  const row = await tx.reasonPreset.findFirst({ where: { kind: ReasonPresetKind.YARN_SUBCONTRACT_RETURN, code: trimmed, isActive: true }, select: { code: true } });
  if (!row) throw AppError.badRequest(`Geçersiz iplik dönüş sebebi: ${trimmed}`, { code: "REASON_CODE_INVALID" });
  return row.code;
}

export interface ReturnYarnInput {
  dispatchItemId: string;
  qtyKg: number | string;
  /** `ReasonPresetKind.YARN_SUBCONTRACT_RETURN` kodu — ZORUNLU (CHECK). */
  reasonCode: string;
  /** Varsayılan çıkışın deposu/lotu; fason başka depoya teslim edebilir (H2). */
  warehouseId?: string | null;
  lotId?: string | null;
}
export interface YarnReturnDto {
  movementId: string;
  dispatchItemId: string;
  dispatchNo: string;
  itemCode: string;
  qtyKg: number;
  /** Bu kalemden fasonda KALAN kg (çıkış − net dönüş). */
  remainingKg: number;
}

/** Fasondan DÖNÜŞ — SUBCONTRACT_RETURN (+kg). Kısmi; Σ net dönüş çıkışı aşamaz (400 `YARN_RETURN_EXCEEDS`). */
export async function returnYarn(dispatchId: string, input: ReturnYarnInput, userId?: string): Promise<ApiResponse<YarnReturnDto>> {
  const qty = kg(input.qtyKg, "Dönen kg");
  const result = await prisma.$transaction(async (tx) => {
    const item = await loadYarnItem(tx, dispatchId, input.dispatchItemId);
    const out = shipOutOf(item);
    const already = returnedNet(item);
    if (already.plus(qty).gt(out.qtyKg)) {
      throw AppError.badRequest(`Dönen kg gideni aşamaz (giden ${Number(out.qtyKg)} kg, dönmüş ${Number(already)} kg)`, { code: "YARN_RETURN_EXCEEDS", shippedKg: Number(out.qtyKg), returnedKg: Number(already) });
    }
    const reasonCode = await assertReturnReasonTx(tx, input.reasonCode);
    const { movementId } = await applyYarnMovementTx(tx, {
      itemId: item.yarnItemId!, warehouseId: input.warehouseId ?? out.warehouseId, kind: YarnMovementKind.SUBCONTRACT_RETURN, qtyKg: qty,
      lotId: input.lotId === undefined ? out.lotId : input.lotId, reasonCode, dispatchItemId: item.id, userId: userId ?? null,
    });
    return { movementId, item, remainingKg: out.qtyKg.minus(already).minus(qty) };
  });
  const itemCode = result.item.yarnItem?.code ?? "";
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { yarnReturned: itemCode, dispatchItemId: input.dispatchItemId, qtyKg: Number(qty), reasonCode: input.reasonCode, movementId: result.movementId } });
  return {
    success: true,
    data: { movementId: result.movementId, dispatchItemId: input.dispatchItemId, dispatchNo: result.item.dispatch.dispatchNo, itemCode, qtyKg: Number(qty), remainingKg: Number(result.remainingKg) },
    message: `${itemCode} fasondan döndü — ${Number(qty)} kg`,
  };
}

/** Dönüş STORNOSU — SUBCONTRACT_RETURN_CANCEL (−kg), dönüş satırının depo/lot/sebep grubunda; grup net'i kg'yi karşılamıyorsa 409. */
export async function cancelYarnReturn(dispatchId: string, input: { dispatchItemId: string; movementId: string; reason: string }, userId?: string): Promise<ApiResponse<YarnReturnDto>> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const result = await prisma.$transaction(async (tx) => {
    const item = await loadYarnItem(tx, dispatchId, input.dispatchItemId);
    const ret = item.yarnMovements.find((m) => m.id === input.movementId && m.kind === YarnMovementKind.SUBCONTRACT_RETURN);
    if (!ret) throw AppError.notFound("Bu kalemde böyle bir dönüş satırı yok", { code: "YARN_RETURN_NOT_FOUND" });
    // Grup net'i (aynı depo · lot · sebep): storno edilmiş dönüş ikinci kez storno edilemez.
    const groupNet = item.yarnMovements
      .filter((m) => m.warehouseId === ret.warehouseId && m.lotId === ret.lotId && m.reasonCode === ret.reasonCode)
      .reduce((acc, m) => (m.kind === YarnMovementKind.SUBCONTRACT_RETURN ? acc.plus(m.qtyKg) : m.kind === YarnMovementKind.SUBCONTRACT_RETURN_CANCEL ? acc.minus(m.qtyKg) : acc), D(0));
    if (groupNet.lt(ret.qtyKg)) throw AppError.conflict("Bu dönüş zaten iptal edilmiş — iptal edilecek dönüş yok", { code: "YARN_RETURN_NOT_OPEN" });
    const { movementId } = await applyYarnMovementTx(tx, {
      itemId: item.yarnItemId!, warehouseId: ret.warehouseId, kind: YarnMovementKind.SUBCONTRACT_RETURN_CANCEL, qtyKg: ret.qtyKg,
      lotId: ret.lotId, reasonCode: ret.reasonCode, dispatchItemId: item.id, userId: userId ?? null, reason,
    });
    const out = shipOutOf(item);
    return { movementId, item, qty: ret.qtyKg, remainingKg: out.qtyKg.minus(returnedNet(item)).plus(ret.qtyKg) };
  });
  const itemCode = result.item.yarnItem?.code ?? "";
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { yarnReturnCancelled: itemCode, dispatchItemId: input.dispatchItemId, reversesMovementId: input.movementId, qtyKg: Number(result.qty), reason, movementId: result.movementId } });
  return {
    success: true,
    data: { movementId: result.movementId, dispatchItemId: input.dispatchItemId, dispatchNo: result.item.dispatch.dispatchNo, itemCode, qtyKg: Number(result.qty), remainingKg: Number(result.remainingKg) },
    message: `${itemCode} dönüşü iptal edildi — iplik yeniden fasonda`,
  };
}

// ── K1 (b): fasondaki bakiye TÜRETİLİR ────────────────────────────────────────
export interface YarnAtSubcontractorRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotNo: string | null;
  outKg: number;
  returnedKg: number;
  /** G1c: bu kaleme bağlı (storno edilmemiş) WOUND olaylarının nominal kg toplamı — tahmin değil, beyanlı kaynak. */
  sarilanKg: number;
  /** `THEORETICAL` · `WEIGHED` · `KARMA` (iki kaynak) · null (sarım yok). */
  sarilanKaynak: "THEORETICAL" | "WEIGHED" | "KARMA" | null;
  /** = çıkış − dönüş − sarılan. */
  remainingKg: number;
}

type KgSourceMark = YarnAtSubcontractorRow["sarilanKaynak"];
function mergeKgSource(cur: KgSourceMark, next: "THEORETICAL" | "WEIGHED" | null): KgSourceMark {
  if (next === null) return cur;
  if (cur === null || cur === next) return next;
  return "KARMA";
}

const FASON_KINDS: YarnMovementKind[] = [YarnMovementKind.SUBCONTRACT_OUT, YarnMovementKind.SUBCONTRACT_OUT_CANCEL, YarnMovementKind.SUBCONTRACT_RETURN, YarnMovementKind.SUBCONTRACT_RETURN_CANCEL];

/** Bir fasoncudaki iplik — iptal edilmemiş sevklerin kalemleri, kalem × lot; sanal depo YOK, satır yazılmaz. */
export async function yarnAtSubcontractor(subcontractorId: string): Promise<ApiResponse<YarnAtSubcontractorRow[]>> {
  const rows = await prisma.yarnMovement.findMany({
    where: { kind: { in: FASON_KINDS }, dispatchItem: { dispatch: { subcontractorId, cancelledAt: null } } },
    select: { kind: true, qtyKg: true, itemId: true, item: { select: { code: true, name: true } }, dispatchItem: { select: { lotId: true, lot: { select: { lotNo: true } } } } },
  });
  // G1c: bu fasoncunun iplik kalemlerine bağlı, storno edilmemiş sarımlar (WOUND) — nominal kg, kaynağı beyanlı.
  const wounds = await prisma.warpBeamEvent.findMany({
    where: { kind: "WOUND", reversal: null, dispatchItem: { kind: SubcontractorDispatchItemKind.YARN, dispatch: { subcontractorId, cancelledAt: null } } },
    select: { theoreticalKg: true, kgSource: true, dispatchItem: { select: { yarnItemId: true, lotId: true } } },
  });
  type Acc = YarnAtSubcontractorRow & { out: Prisma.Decimal; ret: Prisma.Decimal; sar: Prisma.Decimal };
  const acc = new Map<string, Acc>();
  const rowOf = (itemId: string, lotId: string | null, item: { code: string; name: string }, lotNo: string | null): Acc => {
    const key = `${itemId}|${lotId ?? ""}`;
    const row = acc.get(key) ?? { itemId, itemCode: item.code, itemName: item.name, lotId, lotNo, outKg: 0, returnedKg: 0, sarilanKg: 0, sarilanKaynak: null, remainingKg: 0, out: D(0), ret: D(0), sar: D(0) };
    acc.set(key, row);
    return row;
  };
  for (const m of rows) {
    const row = rowOf(m.itemId, m.dispatchItem?.lotId ?? null, m.item, m.dispatchItem?.lot?.lotNo ?? null);
    if (m.kind === YarnMovementKind.SUBCONTRACT_OUT) row.out = row.out.plus(m.qtyKg);
    else if (m.kind === YarnMovementKind.SUBCONTRACT_OUT_CANCEL) row.out = row.out.minus(m.qtyKg);
    else if (m.kind === YarnMovementKind.SUBCONTRACT_RETURN) row.ret = row.ret.plus(m.qtyKg);
    else row.ret = row.ret.minus(m.qtyKg);
  }
  for (const w of wounds) {
    const key = `${w.dispatchItem?.yarnItemId}|${w.dispatchItem?.lotId ?? ""}`;
    const row = acc.get(key);
    if (!row) continue; // kalemin OUT satırı yoksa (iptal edilmiş sevk) sarım da bakiyeye girmez
    row.sar = row.sar.plus(w.theoreticalKg ?? 0);
    row.sarilanKaynak = mergeKgSource(row.sarilanKaynak, w.kgSource);
  }
  const data = [...acc.values()]
    .map(({ out, ret, sar, ...r }) => ({ ...r, outKg: Number(out), returnedKg: Number(ret), sarilanKg: Number(sar), remainingKg: Number(out.minus(ret).minus(sar)) }))
    .filter((r) => r.outKg > 0 || r.returnedKg !== 0)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || (a.lotNo ?? "").localeCompare(b.lotNo ?? ""));
  return { success: true, data };
}

/** Sevk detayı için iplik kalemi DTO'su — birim AÇIK (`unit`), okuyucu tahmin etmez (H1). */
export interface YarnItemDto {
  dispatchItemId: string;
  unit: "KG";
  item: { id: string; code: string; name: string };
  warehouseId: string;
  lotId: string | null;
  dispatchedKg: number;
  returnedKg: number;
  /** G1c: bu kaleme bağlı sarımların (storno edilmemiş WOUND) nominal kg'sı; `sarilan[]` levent başına beyanlı kaynak. */
  sarilanKg: number;
  sarilan: Array<{ beamNo: string; kg: number; kaynak: "THEORETICAL" | "WEIGHED" | null }>;
  /** = giden − dönen − sarılan. */
  remainingKg: number;
  returns: Array<{ movementId: string; kind: YarnMovementKind; qtyKg: number; warehouseId: string; lotId: string | null; reasonCode: string | null }>;
}

export async function listYarnItems(client: Pick<typeof prisma, "subcontractorDispatchItem">, dispatchId: string): Promise<{ items: YarnItemDto[]; yarnTotalKg: number }> {
  const rows = await client.subcontractorDispatchItem.findMany({
    where: { dispatchId, kind: SubcontractorDispatchItemKind.YARN },
    select: { ...YARN_ITEM_SELECT, yarnItem: { select: { id: true, code: true, name: true } }, warpBeamEvents: { where: { kind: "WOUND", reversal: null }, select: { theoreticalKg: true, kgSource: true, beam: { select: { beamNo: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  let total = D(0);
  const items = rows.map((r) => {
    const ret = returnedNet(r);
    total = total.plus(r.dispatchedQty);
    const sarilan = r.warpBeamEvents.map((e) => ({ beamNo: e.beam.beamNo, kg: Number(e.theoreticalKg ?? 0), kaynak: e.kgSource }));
    const sar = r.warpBeamEvents.reduce((a, e) => a.plus(e.theoreticalKg ?? 0), D(0));
    return {
      dispatchItemId: r.id, unit: "KG" as const, item: r.yarnItem!, warehouseId: r.warehouseId!, lotId: r.lotId,
      dispatchedKg: Number(r.dispatchedQty), returnedKg: Number(ret), sarilanKg: Number(sar), sarilan, remainingKg: Number(D(r.dispatchedQty).minus(ret).minus(sar)),
      returns: r.yarnMovements.filter((m) => m.kind !== YarnMovementKind.SUBCONTRACT_OUT).map((m) => ({ movementId: m.id, kind: m.kind, qtyKg: Number(m.qtyKg), warehouseId: m.warehouseId, lotId: m.lotId, reasonCode: m.reasonCode })),
    };
  });
  return { items, yarnTotalKg: Number(total) };
}
