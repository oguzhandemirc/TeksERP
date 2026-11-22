// =============================================================================
// LEVENT GÖVDESİ — okuma (detay DTO · liste/cursor/özet TEK where'den · geçmiş · QR çözümü) — devere ek B1
// =============================================================================
// Sahip süzgeci rol üzerinden (`OURS` = sahipsiz); "sahibine iade edilecek" yüklemi `BEAM_BODY_OWNER_RETURN_DUE_WHERE`
// (özet şeridi ve B2 aday listesi aynı parçayı okur). İstemci sayı türetmez: özet sunucuda.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import {
  BEAM_BODY_EVENT_LABELS, BEAM_BODY_OWNER_LABELS, BEAM_BODY_OWNER_RETURN_DUE_WHERE, BEAM_BODY_STATUS_LABELS,
  type BeamBodyForwardKind, type BeamBodyOwnerKind,
} from "../../constants/beam-body";
import { BEAM_BODY_EVENT_SELECT, beamBodyEventUndoBlock } from "../helpers/beam-body.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { matchBeamBodyNo } from "../helpers/beam-body-no.helper";
import { readDevereBodyNoLooseMatch } from "../system-setting/devere-body";

type Db = Pick<Prisma.TransactionClient, "beamBody">;
type IdCond = string | { in: string[] } | null;
const dec = (v: Prisma.Decimal | null, digits: number) => (v === null ? null : v.toFixed(digits));

export const BEAM_BODY_SELECT = {
  id: true, bodyNo: true, ownerRole: true, widthCm: true, flangeDiameterCm: true, tareKg: true, status: true, notes: true, isActive: true,
  createdAt: true, updatedAt: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  subcontractor: { select: { id: true, name: true } },
  machine: { select: { id: true, code: true, name: true } },
  machineFits: { select: { machine: { select: { id: true, code: true, name: true } } }, orderBy: { machine: { code: "asc" } } },
  currentWarpBeam: { select: { id: true, beamNo: true, status: true } },
} satisfies Prisma.BeamBodySelect;
type BeamBodyRow = Prisma.BeamBodyGetPayload<{ select: typeof BEAM_BODY_SELECT }>;

export interface BeamBodyDto {
  id: string;
  bodyNo: string;
  owner: { kind: BeamBodyOwnerKind; label: string; customer: { id: string; code: string; name: string } | null };
  widthCm: string | null;
  flangeDiameterCm: string | null;
  tareKg: string | null;
  status: BeamBodyStatus;
  statusLabel: string;
  place: { warehouse: { id: string; name: string } | null; subcontractor: { id: string; name: string } | null; machine: { id: string; code: string; name: string } | null };
  /** Bizim olmayan, boş ve bizde duran gövde — sahibine iade edilecek (B2). */
  ownerReturnDue: boolean;
  machineFits: Array<{ id: string; code: string; name: string }>;
  /** B3: üstündeki sarım (dolu durumlarda) — takmada gövde QR'ı sarımı bulur. */
  currentWarpBeam: { id: string; beamNo: string; status: string } | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toBeamBodyDto(r: BeamBodyRow): BeamBodyDto {
  const kind: BeamBodyOwnerKind = r.ownerRole ?? "OURS";
  return {
    id: r.id, bodyNo: r.bodyNo,
    owner: { kind, label: BEAM_BODY_OWNER_LABELS[kind], customer: r.ownerCustomer },
    widthCm: dec(r.widthCm, 2), flangeDiameterCm: dec(r.flangeDiameterCm, 2), tareKg: dec(r.tareKg, 3),
    status: r.status, statusLabel: BEAM_BODY_STATUS_LABELS[r.status],
    place: { warehouse: r.warehouse, subcontractor: r.subcontractor, machine: r.machine },
    ownerReturnDue: r.ownerCustomer !== null && r.status === BeamBodyStatus.EMPTY_STOCK && r.isActive,
    machineFits: r.machineFits.map((f) => f.machine),
    currentWarpBeam: r.currentWarpBeam,
    notes: r.notes, isActive: r.isActive, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export async function loadBeamBodyDto(db: Db, id: string): Promise<BeamBodyDto> {
  const row = await sequentialTx(db).beamBody.findUnique({ where: { id }, select: BEAM_BODY_SELECT });
  if (!row) throw AppError.notFound("Levent gövdesi bulunamadı", { code: "BEAM_BODY_NOT_FOUND" });
  return toBeamBodyDto(row);
}

export const getBeamBody = (id: string): Promise<BeamBodyDto> => loadBeamBodyDto(prisma, id);

export interface BeamBodyListParams {
  owner: BeamBodyOwnerKind[];
  ownerCustomerId: IdCond;
  status: BeamBodyStatus[];
  subcontractorId: IdCond;
  machineId: IdCond;
  warehouseId: IdCond;
  ownerReturnDue?: boolean;
  /** Varsayılan yalnız aktif; `all` pasifleri de getirir. */
  active: "active" | "inactive" | "all";
  search?: string;
  cursor?: string;
  limit: number;
}

/** Liste + cursor + özet şeridi TEK where'den. */
export function buildBeamBodyListWhere(p: Omit<BeamBodyListParams, "cursor" | "limit">): Prisma.BeamBodyWhereInput {
  const and: Prisma.BeamBodyWhereInput[] = [];
  if (p.active !== "all") and.push({ isActive: p.active === "active" });
  if (p.owner.length > 0) {
    const roles = p.owner.filter((o): o is BeamBodyOwnerRole => o !== "OURS");
    const ors: Prisma.BeamBodyWhereInput[] = [];
    if (p.owner.includes("OURS")) ors.push({ ownerCustomerId: null });
    if (roles.length > 0) ors.push({ ownerRole: { in: roles } });
    and.push({ OR: ors });
  }
  if (p.ownerCustomerId) and.push({ ownerCustomerId: p.ownerCustomerId });
  if (p.status.length > 0) and.push({ status: { in: p.status } });
  if (p.subcontractorId) and.push({ subcontractorId: p.subcontractorId });
  if (p.machineId) and.push({ machineId: p.machineId });
  if (p.warehouseId) and.push({ warehouseId: p.warehouseId });
  if (p.ownerReturnDue === true) and.push(BEAM_BODY_OWNER_RETURN_DUE_WHERE);
  const q = p.search?.trim();
  if (q) and.push({ bodyNo: { contains: q, mode: "insensitive" } });
  return and.length > 0 ? { AND: and } : {};
}

export interface BeamBodyListSummary {
  count: number;
  byOwner: Record<BeamBodyOwnerKind, number>;
  byStatus: Record<BeamBodyStatus, number>;
  ownerReturnDue: number;
}

export async function listBeamBodies(p: BeamBodyListParams): Promise<{ data: BeamBodyDto[]; nextCursor: string | null; summary: BeamBodyListSummary }> {
  const where = buildBeamBodyListWhere(p);
  const cursor = p.cursor ? decodeCursor(p.cursor) : null;
  if (p.cursor && !cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  const rows = await prisma.beamBody.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
    select: BEAM_BODY_SELECT,
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  return { data: page.map(toBeamBodyDto), nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null, summary: await summarize(where) };
}

async function summarize(where: Prisma.BeamBodyWhereInput): Promise<BeamBodyListSummary> {
  const groups = await prisma.beamBody.groupBy({ by: ["status", "ownerRole"], where, _count: { _all: true } });
  const returnDue = await prisma.beamBody.count({ where: { AND: [where, BEAM_BODY_OWNER_RETURN_DUE_WHERE] } });
  const byOwner = Object.fromEntries((["OURS", ...Object.values(BeamBodyOwnerRole)] as BeamBodyOwnerKind[]).map((k) => [k, 0])) as Record<BeamBodyOwnerKind, number>;
  const byStatus = Object.fromEntries(Object.values(BeamBodyStatus).map((s) => [s, 0])) as Record<BeamBodyStatus, number>;
  let count = 0;
  for (const g of groups) {
    byOwner[g.ownerRole ?? "OURS"] += g._count._all;
    byStatus[g.status] += g._count._all;
    count += g._count._all;
  }
  return { count, byOwner, byStatus, ownerReturnDue: returnDue };
}

export interface BeamBodyEventDto {
  id: string;
  kind: string;
  label: string;
  isReversal: boolean;
  reversesId: string | null;
  reversed: boolean;
  fromStatus: BeamBodyStatus | null;
  toStatus: BeamBodyStatus;
  toStatusLabel: string;
  place: { warehouse: { id: string; name: string } | null; subcontractor: { id: string; name: string } | null; machine: { id: string; code: string; name: string } | null };
  warpBeam: { id: string; beamNo: string } | null;
  /** B2: olayı doğuran belge — iplik sevki (boş gidiş) ya da sahibine iade belgesi; geri alma o belgenin iptalidir. */
  document: { kind: "DISPATCH" | "OWNER_RETURN"; id: string; no: string } | null;
  /** B2: "Geri al" düğmesi — son, belgesiz, iptal edilmemiş elle geçiş (`BEAM_BODY_MANUAL_KINDS`). */
  undoable: boolean;
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
}

/** Gövde geçmişi (B12) — kronolojik (`createdAt`, eşitlik bozucu `id`); iptal edilmiş ileri satır işaretli. */
export async function listBeamBodyEvents(bodyId: string): Promise<BeamBodyEventDto[]> {
  const exists = await prisma.beamBody.findUnique({ where: { id: bodyId }, select: { id: true } });
  if (!exists) throw AppError.notFound("Levent gövdesi bulunamadı", { code: "BEAM_BODY_NOT_FOUND" });
  const rows = await prisma.beamBodyEvent.findMany({ where: { bodyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { ...BEAM_BODY_EVENT_SELECT, reversal: { select: { id: true } } } });
  // "Son hareket" = son etkin ileri olay (geri alınmış çiftler sayılmaz) — helper'daki `BEAM_BODY_EFFECTIVE_EVENT_WHERE` ile aynı anlam.
  let lastEffective = -1;
  rows.forEach((r, i) => { if (!r.kind.endsWith("_CANCEL") && r.reversal === null) lastEffective = i; });
  return rows.map((r, i) => {
    const isReversal = r.kind.endsWith("_CANCEL");
    const document = r.subcontractorDispatch ? { kind: "DISPATCH" as const, id: r.subcontractorDispatch.id, no: r.subcontractorDispatch.dispatchNo }
      : r.returnItem ? { kind: "OWNER_RETURN" as const, id: r.returnItem.beamReturn.id, no: r.returnItem.beamReturn.docNo } : null;
    const undoable = beamBodyEventUndoBlock({ kind: r.kind, hasDocument: document !== null, reversed: r.reversal !== null, isLatest: i === lastEffective }) === null;
    const base = (isReversal ? r.kind.slice(0, -"_CANCEL".length) : r.kind) as BeamBodyForwardKind;
    return {
      id: r.id, kind: r.kind, label: isReversal ? `${BEAM_BODY_EVENT_LABELS[base] ?? base} — iptal` : (BEAM_BODY_EVENT_LABELS[base] ?? r.kind),
      isReversal, reversesId: r.reversesId, reversed: r.reversal !== null,
      fromStatus: r.fromStatus, toStatus: r.toStatus, toStatusLabel: BEAM_BODY_STATUS_LABELS[r.toStatus],
      place: { warehouse: r.warehouse, subcontractor: r.subcontractor, machine: r.machine },
      warpBeam: r.warpBeam, document, undoable, reasonCode: r.reasonCode, reason: r.reason, createdAt: r.createdAt.toISOString(),
    };
  });
}

export interface ResolvedBeamBody {
  data: BeamBodyDto & { matchedBy?: "NORMALIZED" };
  warnings?: string[];
}

/**
 * QR/barkod çözümü: gövde no büyük/küçük harf duyarsız tam eşleşme (QR değeri = `bodyNo`). Birebir yoksa ve
 * `devere.bodyNoLooseMatch` açıksa normalize eşleşme (S3): tek aday → döner + `matchedBy` + uyarı; çok aday → 409.
 */
export async function resolveBeamBody(code: string): Promise<ResolvedBeamBody> {
  const c = code.trim();
  const m = await matchBeamBodyNo(prisma, c, { loose: await readDevereBodyNoLooseMatch() });
  if (m.ids.length > 1 && m.matchedBy === "NORMALIZED") {
    const candidates = await prisma.beamBody.findMany({ where: { id: { in: m.ids } }, select: { id: true, bodyNo: true, status: true }, orderBy: { bodyNo: "asc" } });
    throw AppError.conflict(`"${c}" birden çok gövdeye uyuyor (${candidates.map((x) => x.bodyNo).join(", ")}) — gövde no'yu tam yazın ya da QR'ı okutun`, { code: "BEAM_BODY_NO_AMBIGUOUS", bodyNo: c, candidates });
  }
  const row = m.ids[0] ? await prisma.beamBody.findUnique({ where: { id: m.ids[0] }, select: BEAM_BODY_SELECT }) : null;
  if (!row) throw AppError.notFound(`"${c}" numaralı levent gövdesi tanımlı değil`, { code: "BEAM_BODY_NOT_FOUND", bodyNo: c });
  if (m.matchedBy === "EXACT") return { data: toBeamBodyDto(row) };
  return { data: { ...toBeamBodyDto(row), matchedBy: "NORMALIZED" }, warnings: [`"${c}" birebir yok — ${row.bodyNo} ile eşleştirildi (esnek gövde no). Doğru gövde olduğunu kontrol edin.`] };
}
