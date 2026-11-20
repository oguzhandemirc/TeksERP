// =============================================================================
// LEVENT GÖVDESİ ↔ İPLİK SEVKİ — boş gövde gidişi ve sevk iptalinde ters (devere ek B2)
// =============================================================================
// Sevk `beamBodyIds` taşırsa her gövde SHIP_EMPTY (EMPTY_STOCK → AT_SUBCONTRACTOR, olayda `subcontractorDispatchId`).
// Gövdesiz sevk bu dosyaya girmez (ayar okunmaz, bayt-aynı). Kilit sırası: sipariş claim'i → gövdeler id sırasıyla.
// Sevk iptali bağlı olayları ayar ne olursa olsun ters çevirir (defter tutarlılığı); gövde sonra hareket ettiyse 409.
// =============================================================================
import { BeamBodyStatus, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import {
  assertBeamBodyEnabled, beamBodyEventNeighborsTx, logBeamBodyEventAudit, reverseLatestBeamBodyEventTx, transitionBeamBodyTx,
} from "../helpers/beam-body.helper";
import { BEAM_BODY_DISPATCH_MAX, BEAM_BODY_STATUS_LABELS } from "../../constants/beam-body";

type Tx = Prisma.TransactionClient;
type Db = Pick<Tx, "beamBodyEvent">;

export interface DispatchBeamBodyRef { id: string; bodyNo: string; ownerName: string | null }

/** Sevk kimliği/replay imzası için gövde kümesi (sıralı, tekrarsız). */
export function normalizeBeamBodyIds(ids: string[] | null | undefined): string[] {
  const uniq = [...new Set(ids ?? [])].sort();
  if (uniq.length > BEAM_BODY_DISPATCH_MAX) throw AppError.badRequest(`Bir sevkte en çok ${BEAM_BODY_DISPATCH_MAX} boş gövde gider`, { code: "BEAM_BODY_DISPATCH_TOO_MANY" });
  return uniq;
}

/** Boş gövdeleri sevkle devereciye çıkarır (sipariş claim'inden SONRA). Boş liste → hiçbir şey okunmaz/yazılmaz. */
export async function shipBeamBodiesWithDispatchTx(
  tx: Tx, input: { dispatchId: string; subcontractorId: string; bodyIds: string[]; userId: string },
): Promise<Array<{ bodyId: string; eventId: string; bodyNo: string }>> {
  if (input.bodyIds.length === 0) return [];
  await assertBeamBodyEnabled(tx);
  const out: Array<{ bodyId: string; eventId: string; bodyNo: string }> = [];
  for (const bodyId of input.bodyIds) {
    const ev = await transitionBeamBodyTx(tx, {
      bodyId, kind: "SHIP_EMPTY", from: BeamBodyStatus.EMPTY_STOCK, to: BeamBodyStatus.AT_SUBCONTRACTOR,
      place: { warehouseId: null, subcontractorId: input.subcontractorId, machineId: null },
      subcontractorDispatchId: input.dispatchId, userId: input.userId,
    });
    out.push({ bodyId, eventId: ev.id, bodyNo: "" });
  }
  const nos = await tx.beamBody.findMany({ where: { id: { in: input.bodyIds } }, select: { id: true, bodyNo: true } });
  for (const o of out) o.bodyNo = nos.find((n) => n.id === o.bodyId)?.bodyNo ?? "";
  return out;
}

export async function auditShippedBeamBodies(rows: Array<{ bodyId: string; eventId: string; bodyNo: string }>, dispatchId: string, userId: string): Promise<void> {
  for (const r of rows) await logBeamBodyEventAudit({ userId, eventId: r.eventId, kind: "SHIP_EMPTY", data: { bodyId: r.bodyId, bodyNo: r.bodyNo, subcontractorDispatchId: dispatchId } });
}

/** Sevkin canlı (iptal edilmemiş) boş gövde gidişleri. */
async function liveShipEvents(db: Db, dispatchId: string) {
  return db.beamBodyEvent.findMany({
    where: { subcontractorDispatchId: dispatchId, kind: "SHIP_EMPTY", reversal: { is: null } },
    orderBy: [{ bodyId: "asc" }],
    select: { id: true, bodyId: true, createdAt: true, body: { select: { bodyNo: true, status: true } } },
  });
}

/** Sevk iptali engeli (gövde tarafı) — TEK tanım: önizleme ve iptal tx'i okur. Gövde sevkten sonra hareket ettiyse engel. */
export async function dispatchBeamBodyCancelBlock(db: Db, dispatchId: string): Promise<string | null> {
  const moved: string[] = [];
  for (const ev of await liveShipEvents(db, dispatchId)) {
    if ((await beamBodyEventNeighborsTx(db, ev)).later > 0) moved.push(`${ev.body.bodyNo} (${BEAM_BODY_STATUS_LABELS[ev.body.status]})`);
  }
  return moved.length > 0 ? `Bu sevkle giden gövdelerden ${moved.join(", ")} sevkten sonra hareket etmiş — önce o hareketleri geri alın (LIFO).` : null;
}

/** Sevk iptalinde bağlı SHIP_EMPTY olaylarını ters çevirir (dispatch claim'inden SONRA, gövde id sırasıyla). */
export async function reverseDispatchBeamBodiesTx(tx: Tx, input: { dispatchId: string; reason: string; userId: string }): Promise<Array<{ bodyId: string; eventId: string; reversesId: string }>> {
  const evs = await liveShipEvents(tx, input.dispatchId);
  if (evs.length === 0) return [];
  const block = await dispatchBeamBodyCancelBlock(tx, input.dispatchId);
  if (block) throw AppError.conflict(block, { code: "BEAM_BODY_EVENT_NOT_LATEST" });
  const out: Array<{ bodyId: string; eventId: string; reversesId: string }> = [];
  for (const ev of evs) {
    const rev = await reverseLatestBeamBodyEventTx(tx, { eventId: ev.id, reason: input.reason, userId: input.userId });
    out.push({ bodyId: ev.bodyId, eventId: rev.id, reversesId: ev.id });
  }
  return out;
}

export async function auditReversedBeamBodies(rows: Array<{ bodyId: string; eventId: string; reversesId: string }>, dispatchId: string, reason: string, userId: string): Promise<void> {
  for (const r of rows) await logBeamBodyEventAudit({ userId, eventId: r.eventId, kind: "SHIP_EMPTY_CANCEL", data: { bodyId: r.bodyId, reversesId: r.reversesId, subcontractorDispatchId: dispatchId, reason } });
}

/** İrsaliye/sevk listesi için sevk başına giden gövdeler (ileri olay kalıcıdır; iptal edilen sevkte de tarihçe olarak görünür). */
export async function loadDispatchBeamBodies(db: Db, dispatchIds: string[]): Promise<Map<string, DispatchBeamBodyRef[]>> {
  const map = new Map<string, DispatchBeamBodyRef[]>();
  if (dispatchIds.length === 0) return map;
  const rows = await db.beamBodyEvent.findMany({
    where: { subcontractorDispatchId: { in: dispatchIds }, kind: "SHIP_EMPTY" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { subcontractorDispatchId: true, body: { select: { id: true, bodyNo: true, ownerCustomer: { select: { name: true } } } } },
  });
  for (const r of rows) {
    const k = r.subcontractorDispatchId!;
    const list = map.get(k) ?? [];
    list.push({ id: r.body.id, bodyNo: r.body.bodyNo, ownerName: r.body.ownerCustomer?.name ?? null });
    map.set(k, list);
  }
  return map;
}
