// =============================================================================
// LEVENT GÖVDESİ — sahibine iade belgesi (`LGI-YYMM-NNNN`) · aday listesi · iptal (devere ek B2)
// =============================================================================
// Belge: replay R kipi (TEK boğaz `tokenReplay`) → tx: no kilidi İLK ifade (8029) → başlık → gövdeler id sırasıyla
// RETURN_TO_OWNER (EMPTY_STOCK → RETURNED_TO_OWNER; claim helper'da) + kalem. Sahip claim'den SONRA (satır kilidi
// altında) yeniden doğrulanır. İptal: başlık claim'i (`cancelledAt IS NULL`) → her kalemin olayı tipli tersle geri.
// =============================================================================
import { BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import {
  assertBeamBodyEnabled, beamBodyEventNeighborsTx, logBeamBodyEventAudit, reverseLatestBeamBodyEventTx, transitionBeamBodyTx,
} from "../helpers/beam-body.helper";
import { BEAM_BODY_OWNER_LABELS, BEAM_BODY_OWNER_RETURN_DUE_WHERE, BEAM_BODY_RETURN_MAX_ITEMS, BEAM_BODY_STATUS_LABELS, type BeamBodyOwnerKind } from "../../constants/beam-body";
import { BEAM_BODY_SELECT, toBeamBodyDto, type BeamBodyDto } from "./read";

type Db = Prisma.TransactionClient | typeof prisma;
const CODE_SCOPE = "beamBodyReturn";
export const BEAM_BODY_RETURN_TABLE = "BEAM_BODY_RETURN";

export interface BeamBodyReturnCreateInput {
  clientToken: string;
  ownerCustomerId: string;
  bodyIds: string[];
  /** İş tarihi (ISO); yoksa şimdi. Gelecek olamaz. */
  returnedAt?: string | null;
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

const RETURN_SELECT = {
  id: true, docNo: true, returnedAt: true, plateNumber: true, driverName: true, notes: true, cancelledAt: true, cancelReason: true, createdAt: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  items: { select: { body: { select: { id: true, bodyNo: true, ownerRole: true, widthCm: true, tareKg: true } }, event: { select: { id: true, reversal: { select: { id: true } } } } }, orderBy: { body: { bodyNo: "asc" } } },
} satisfies Prisma.BeamBodyReturnSelect;
type ReturnRow = Prisma.BeamBodyReturnGetPayload<{ select: typeof RETURN_SELECT }>;

export interface BeamBodyReturnDto {
  id: string;
  docNo: string;
  status: "ACTIVE" | "CANCELLED";
  owner: { id: string; code: string; name: string };
  returnedAt: string;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: Array<{ bodyId: string; bodyNo: string; ownerRoleLabel: string; widthCm: string | null; tareKg: string | null; eventId: string; reversed: boolean }>;
}

function toDto(r: ReturnRow): BeamBodyReturnDto {
  return {
    id: r.id, docNo: r.docNo, status: r.cancelledAt ? "CANCELLED" : "ACTIVE", owner: r.ownerCustomer,
    returnedAt: r.returnedAt.toISOString(), plateNumber: r.plateNumber, driverName: r.driverName, notes: r.notes,
    cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason, createdAt: r.createdAt.toISOString(),
    items: r.items.map((i) => ({
      bodyId: i.body.id, bodyNo: i.body.bodyNo, ownerRoleLabel: BEAM_BODY_OWNER_LABELS[(i.body.ownerRole ?? "OURS") as BeamBodyOwnerKind],
      widthCm: i.body.widthCm?.toFixed(2) ?? null, tareKg: i.body.tareKg?.toFixed(3) ?? null, eventId: i.event.id, reversed: i.event.reversal !== null,
    })),
  };
}

async function loadReturnDto(db: Db, id: string): Promise<BeamBodyReturnDto> {
  const r = await db.beamBodyReturn.findUnique({ where: { id }, select: RETURN_SELECT });
  if (!r) throw AppError.notFound("Gövde iade belgesi bulunamadı", { code: "BEAM_BODY_RETURN_NOT_FOUND" });
  return toDto(r);
}

export async function getBeamBodyReturn(id: string): Promise<BeamBodyReturnDto> {
  await assertBeamBodyEnabled();
  return loadReturnDto(prisma, id);
}

// ── Aday listesi ─────────────────────────────────────────────────────────────

export interface OwnerReturnCandidateGroup {
  owner: { id: string; code: string; name: string };
  bodies: BeamBodyDto[];
}

/** "Sahibine iade edilecek" gövdeler sahip bazında — yüklem `BEAM_BODY_OWNER_RETURN_DUE_WHERE` (liste özetiyle aynı). */
export async function listOwnerReturnCandidates(ownerCustomerId: string | null): Promise<OwnerReturnCandidateGroup[]> {
  await assertBeamBodyEnabled();
  const rows = await prisma.beamBody.findMany({
    where: { AND: [BEAM_BODY_OWNER_RETURN_DUE_WHERE, ...(ownerCustomerId ? [{ ownerCustomerId }] : [])] },
    orderBy: [{ bodyNo: "asc" }],
    take: 2000,
    select: BEAM_BODY_SELECT,
  });
  const groups = new Map<string, OwnerReturnCandidateGroup>();
  for (const r of rows) {
    const o = r.ownerCustomer!;
    const g = groups.get(o.id) ?? { owner: o, bodies: [] };
    g.bodies.push(toBeamBodyDto(r));
    groups.set(o.id, g);
  }
  return [...groups.values()].sort((a, b) => a.owner.name.localeCompare(b.owner.name, "tr"));
}

// ── Belge ────────────────────────────────────────────────────────────────────

interface PriorReturn { id: string; docNo: string; ownerCustomerId: string; cancelledAt: Date | null; items: Array<{ bodyId: string }> }
export interface CreateBeamBodyReturnResult { data: BeamBodyReturnDto; replayed: boolean }

function replayFor(input: BeamBodyReturnCreateInput, bodyIds: string[]) {
  return tokenReplay<PriorReturn, CreateBeamBodyReturnResult>({
    find: (db, clientToken) => db.beamBodyReturn.findUnique({ where: { clientToken }, select: { id: true, docNo: true, ownerCustomerId: true, cancelledAt: true, items: { select: { bodyId: true } } } }),
    alive: (p) => {
      if (!p.cancelledAt) return;
      throw AppError.conflict(`Bu iade denemesi daha önce kaydedilmiş ve İPTAL edilmiş (${p.docNo}) — yeni iade belgesi açın.`, { code: "BEAM_BODY_RETURN_CANCELLED", returnId: p.id });
    },
    identity: (p) => [
      { ad: "ownerCustomerId", mevcut: p.ownerCustomerId, gelen: input.ownerCustomerId },
      { ad: "bodyIds", mevcut: p.items.map((i) => i.bodyId).sort().join(","), gelen: bodyIds.join(",") },
    ],
    collision: (p) => `Bu işlem kimliği başka içerikli bir iade belgesine (${p.docNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (p) => ({ data: await loadReturnDto(prisma, p.id), replayed: true }),
  });
}

function parseReturnedAt(raw: string | null | undefined, now: Date): Date {
  if (!raw) return now;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest("İade tarihi geçersiz", { code: "BEAM_BODY_RETURN_DATE_INVALID" });
  if (d.getTime() > now.getTime() + 5 * 60_000) throw AppError.badRequest("İade tarihi ileri bir an olamaz", { code: "BEAM_BODY_RETURN_DATE_INVALID" });
  return d;
}

export async function createBeamBodyReturn(input: BeamBodyReturnCreateInput, userId: string): Promise<CreateBeamBodyReturnResult> {
  await assertBeamBodyEnabled();
  const bodyIds = [...new Set(input.bodyIds)].sort();
  if (bodyIds.length === 0) throw AppError.badRequest("İade belgesinde en az bir gövde olmalı", { code: "BEAM_BODY_RETURN_EMPTY" });
  if (bodyIds.length > BEAM_BODY_RETURN_MAX_ITEMS) throw AppError.badRequest(`Bir iade belgesinde en çok ${BEAM_BODY_RETURN_MAX_ITEMS} gövde olur`, { code: "BEAM_BODY_RETURN_TOO_MANY" });
  return replayFor(input, bodyIds).run(input.clientToken, async () => {
    const owner = await prisma.customer.findUnique({ where: { id: input.ownerCustomerId }, select: { id: true, name: true } });
    if (!owner) throw AppError.badRequest("Sahip cari bulunamadı", { code: "BEAM_BODY_OWNER_INVALID" });
    const out = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const fmt = resolveSeriesFormat(CODE_SCOPE);
      await lockCodeScopeTx(tx, CODE_SCOPE, seriesPrefix(fmt, now));
      const docNo = await nextSeriesNo(CODE_SCOPE, async (prefix) =>
        tx.beamBodyReturn
          .findMany({ where: { docNo: { gte: prefix, startsWith: prefix } }, select: { docNo: true, createdAt: true } })
          .then((rows) => rows.map((x) => ({ code: x.docNo, createdAt: x.createdAt }))), now, fmt);
      const head = await tx.beamBodyReturn.create({
        data: {
          docNo, clientToken: input.clientToken, ownerCustomerId: owner.id, returnedAt: parseReturnedAt(input.returnedAt, now),
          plateNumber: input.plateNumber ?? null, driverName: input.driverName ?? null, notes: input.notes ?? null, createdById: userId,
        },
        select: { id: true },
      });
      const events: Array<{ bodyId: string; eventId: string; bodyNo: string }> = [];
      for (const bodyId of bodyIds) {
        const ev = await transitionBeamBodyTx(tx, {
          bodyId, kind: "RETURN_TO_OWNER", from: BeamBodyStatus.EMPTY_STOCK, to: BeamBodyStatus.RETURNED_TO_OWNER,
          place: { warehouseId: null, subcontractorId: null, machineId: null }, userId,
        });
        // Sahip claim'den SONRA (satır kilitli) doğrulanır: eşzamanlı sahip değişimi araya giremez.
        const b = await tx.beamBody.findUniqueOrThrow({ where: { id: bodyId }, select: { bodyNo: true, ownerCustomerId: true } });
        if (b.ownerCustomerId !== owner.id) {
          throw AppError.badRequest(
            b.ownerCustomerId === null ? `${b.bodyNo} bizim gövdemiz — sahibine iade belgesine girmez` : `${b.bodyNo} başka bir sahibin gövdesi — belgedeki bütün gövdeler ${owner.name} gövdesi olmalı`,
            { code: "BEAM_BODY_OWNER_MISMATCH", bodyId },
          );
        }
        await tx.beamBodyReturnItem.create({ data: { returnId: head.id, bodyId, eventId: ev.id } });
        events.push({ bodyId, eventId: ev.id, bodyNo: b.bodyNo });
      }
      return { id: head.id, docNo, events };
    });
    await AuditService.log({ userId, action: "CREATE", tableName: BEAM_BODY_RETURN_TABLE, recordId: out.id, newData: { docNo: out.docNo, ownerCustomerId: owner.id, bodyNos: out.events.map((e) => e.bodyNo) } });
    for (const e of out.events) await logBeamBodyEventAudit({ userId, eventId: e.eventId, kind: "RETURN_TO_OWNER", data: { bodyId: e.bodyId, bodyNo: e.bodyNo, beamBodyReturnId: out.id, docNo: out.docNo } });
    return { data: await loadReturnDto(prisma, out.id), replayed: false };
  });
}

// ── Liste ────────────────────────────────────────────────────────────────────

export interface BeamBodyReturnListParams { ownerCustomerId: string | { in: string[] } | null; status: "active" | "cancelled" | "all"; search?: string; cursor?: string; limit: number }

export async function listBeamBodyReturns(p: BeamBodyReturnListParams): Promise<{ data: BeamBodyReturnDto[]; nextCursor: string | null; summary: { count: number; bodyCount: number } }> {
  await assertBeamBodyEnabled();
  const and: Prisma.BeamBodyReturnWhereInput[] = [];
  if (p.ownerCustomerId) and.push({ ownerCustomerId: p.ownerCustomerId });
  if (p.status !== "all") and.push({ cancelledAt: p.status === "active" ? null : { not: null } });
  const q = p.search?.trim();
  if (q) and.push({ OR: [{ docNo: { contains: q, mode: "insensitive" } }, { items: { some: { body: { bodyNo: { contains: q, mode: "insensitive" } } } } }] });
  const where: Prisma.BeamBodyReturnWhereInput = and.length > 0 ? { AND: and } : {};
  const cursor = p.cursor ? decodeCursor(p.cursor) : null;
  if (p.cursor && !cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  const rows = await prisma.beamBodyReturn.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: p.limit + 1, select: RETURN_SELECT,
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const count = await prisma.beamBodyReturn.count({ where });
  const bodyCount = await prisma.beamBodyReturnItem.count({ where: { beamReturn: where } });
  return { data: page.map(toDto), nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null, summary: { count, bodyCount } };
}

// ── İptal ────────────────────────────────────────────────────────────────────

export interface BeamBodyReturnCancelPreview {
  doc: BeamBodyReturnDto;
  cancellable: boolean;
  blocker: string | null;
  /** Etkilenen HER gövde: iptalde "Depoda boş"a döner; engelli olan nedeniyle. */
  items: Array<{ bodyId: string; bodyNo: string; currentStatusLabel: string; blocker: string | null }>;
}

async function itemBlockers(db: Db, returnId: string) {
  const items = await db.beamBodyReturnItem.findMany({
    where: { returnId }, orderBy: { bodyId: "asc" },
    select: { bodyId: true, event: { select: { id: true, bodyId: true, createdAt: true } }, body: { select: { bodyNo: true, status: true, isActive: true } } },
  });
  const out: BeamBodyReturnCancelPreview["items"] = [];
  for (const i of items) {
    const { later } = await beamBodyEventNeighborsTx(db, i.event);
    const blocker = !i.body.isActive ? "Gövde pasife alınmış — önce yeniden etkinleştirin" : later > 0 ? "Gövdenin iadeden sonra başka hareketi var" : null;
    out.push({ bodyId: i.bodyId, bodyNo: i.body.bodyNo, currentStatusLabel: BEAM_BODY_STATUS_LABELS[i.body.status], blocker });
  }
  return { items, rows: out };
}

export async function previewCancelBeamBodyReturn(id: string): Promise<BeamBodyReturnCancelPreview> {
  await assertBeamBodyEnabled();
  const doc = await loadReturnDto(prisma, id);
  const { rows } = await itemBlockers(prisma, id);
  const blocked = rows.filter((r) => r.blocker);
  const blocker = doc.cancelledAt ? "Belge zaten iptal edilmiş"
    : blocked.length > 0 ? `${blocked.map((r) => r.bodyNo).join(", ")}: ${blocked[0]!.blocker} — belge iptal edilemez` : null;
  return { doc, cancellable: blocker === null, blocker, items: rows };
}

export async function cancelBeamBodyReturn(id: string, reason: string, userId: string): Promise<BeamBodyReturnDto> {
  await assertBeamBodyEnabled();
  const reversed = await prisma.$transaction(async (tx) => {
    const claim = await tx.beamBodyReturn.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: reason } });
    if (claim.count === 0) {
      const fresh = await tx.beamBodyReturn.findUnique({ where: { id }, select: { docNo: true } });
      if (!fresh) throw AppError.notFound("Gövde iade belgesi bulunamadı", { code: "BEAM_BODY_RETURN_NOT_FOUND" });
      throw AppError.conflict(`${fresh.docNo} zaten iptal edilmiş`, { code: "BEAM_BODY_RETURN_CANCELLED" });
    }
    const { items, rows } = await itemBlockers(tx, id);
    const blocked = rows.find((r) => r.blocker);
    if (blocked) throw AppError.conflict(`${blocked.bodyNo}: ${blocked.blocker} — belge iptal edilemez`, { code: "BEAM_BODY_EVENT_NOT_LATEST", bodyId: blocked.bodyId });
    const out: Array<{ bodyId: string; eventId: string; reversesId: string }> = [];
    for (const i of items) {
      const rev = await reverseLatestBeamBodyEventTx(tx, { eventId: i.event.id, reason, userId });
      out.push({ bodyId: i.bodyId, eventId: rev.id, reversesId: i.event.id });
    }
    return out;
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: BEAM_BODY_RETURN_TABLE, recordId: id, newData: { cancelled: true, reason, bodiesReverted: reversed.length } });
  for (const r of reversed) await logBeamBodyEventAudit({ userId, eventId: r.eventId, kind: "RETURN_TO_OWNER_CANCEL", data: { bodyId: r.bodyId, reversesId: r.reversesId, beamBodyReturnId: id, reason } });
  return loadReturnDto(prisma, id);
}
