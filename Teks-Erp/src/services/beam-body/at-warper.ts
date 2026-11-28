// =============================================================================
// LEVENT GÖVDESİ — "deverecide duran gövdeler" okuması (devere D3, 2026-11-28)
// =============================================================================
// Kolon yok, durum tablosundan türer: deverecide = aktif ∧ AT_SUBCONTRACTOR ∧ `subcontractorId`. "Bu sevkle gitti" =
// gövdenin SON ETKİN olayı (`BEAM_BODY_EFFECTIVE_EVENT_WHERE`) SHIP_EMPTY ise o olayın sevki; başka yolla oraya
// gelen (elle gönderim, yerinde tanım) "önceden deverecide" sayılır. Kabul seçicisi ve devereci kırılımı TEK okuyucu.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { BEAM_BODY_OWNER_LABELS, BEAM_BODY_STATUS_LABELS, type BeamBodyOwnerKind } from "../../constants/beam-body";
import { assertBeamBodyEnabled, BEAM_BODY_EFFECTIVE_EVENT_WHERE } from "../helpers/beam-body.helper";
import { beamBodyStatusAges } from "../helpers/status-age.helper";

type IdCond = string | { in: string[] } | null;

/** Deverecide duran (boş) gövdenin yüklemi — kabul seçicisi ve devereci kırılımı aynı parçayı okur. */
export const beamBodyAtWarperWhere = (subcontractorId: IdCond): Prisma.BeamBodyWhereInput => ({
  isActive: true, status: BeamBodyStatus.AT_SUBCONTRACTOR, ...(subcontractorId ? { subcontractorId } : { subcontractorId: { not: null } }),
});

const AT_WARPER_SELECT = {
  id: true, bodyNo: true, ownerRole: true, createdAt: true, subcontractorId: true,
  ownerCustomer: { select: { id: true, code: true, name: true } },
  subcontractor: { select: { id: true, name: true } },
} satisfies Prisma.BeamBodySelect;
type AtWarperRow = Prisma.BeamBodyGetPayload<{ select: typeof AT_WARPER_SELECT }>;

export interface WarperBodyDto {
  id: string;
  bodyNo: string;
  owner: { kind: BeamBodyOwnerKind; label: string; customer: { id: string; code: string; name: string } | null };
  /** Gövdeyi buraya getiren canlı boş gidiş (SHIP_EMPTY); başka yolla geldiyse null. */
  sentWith: { dispatchId: string; dispatchNo: string; warpingOrderId: string | null; orderNo: string | null; at: string } | null;
  statusSince: string;
  statusAgeDays: number;
}

async function toWarperBodies(rows: AtWarperRow[], now: Date): Promise<WarperBodyDto[]> {
  if (rows.length === 0) return [];
  const last = await prisma.beamBodyEvent.findMany({
    where: { bodyId: { in: rows.map((r) => r.id) }, ...BEAM_BODY_EFFECTIVE_EVENT_WHERE },
    orderBy: [{ bodyId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    distinct: ["bodyId"],
    select: {
      bodyId: true, kind: true, createdAt: true,
      subcontractorDispatch: { select: { id: true, dispatchNo: true, warpingOrderId: true, warpingOrder: { select: { orderNo: true } } } },
    },
  });
  const byBody = new Map(last.map((e) => [e.bodyId, e]));
  const ages = await beamBodyStatusAges(prisma, rows, now);
  return rows.map((r) => {
    const kind: BeamBodyOwnerKind = r.ownerRole ?? "OURS";
    const ev = byBody.get(r.id);
    const d = ev?.kind === "SHIP_EMPTY" ? ev.subcontractorDispatch : null;
    const age = ages.get(r.id);
    return {
      id: r.id, bodyNo: r.bodyNo,
      owner: { kind, label: BEAM_BODY_OWNER_LABELS[kind], customer: r.ownerCustomer },
      sentWith: d && ev ? { dispatchId: d.id, dispatchNo: d.dispatchNo, warpingOrderId: d.warpingOrderId, orderNo: d.warpingOrder?.orderNo ?? null, at: ev.createdAt.toISOString() } : null,
      statusSince: (age?.statusSince ?? r.createdAt).toISOString(),
      statusAgeDays: age?.statusAgeDays ?? 0,
    };
  });
}

export interface ReceiveBodyOptions {
  subcontractorId: string;
  /** Bu siparişin canlı sevkleriyle giden gövdeler (şu an nerede olursa olsun) — "farklı gövde" işaretinin kümesi. */
  sent: Array<{ id: string; bodyNo: string; status: BeamBodyStatus; statusLabel: string; atThisWarper: boolean; dispatchNo: string }>;
  /** Kabulde seçilebilir: deverecide duran boş gövdeler — bu siparişle gidenler önce, sonra gövde no. */
  options: Array<WarperBodyDto & { sentWithOrder: boolean }>;
}

/** Kabul satırının gövde seçicisi (D3). Gövde takibi kapalıysa 403 (kabulde gövde girdisi de 403). */
export async function listReceiveBodyOptions(orderId: string, now: Date = new Date()): Promise<ReceiveBodyOptions> {
  await assertBeamBodyEnabled();
  const order = await prisma.warpingOrder.findUnique({ where: { id: orderId }, select: { subcontractorId: true } });
  if (!order) throw AppError.notFound("Devere siparişi bulunamadı", { code: "WARPING_ORDER_NOT_FOUND" });
  const shipped = await prisma.beamBodyEvent.findMany({
    where: { kind: "SHIP_EMPTY", reversal: { is: null }, subcontractorDispatch: { warpingOrderId: orderId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { body: { select: { id: true, bodyNo: true, status: true, subcontractorId: true } }, subcontractorDispatch: { select: { dispatchNo: true } } },
  });
  const sent = shipped.map((e) => ({
    id: e.body.id, bodyNo: e.body.bodyNo, status: e.body.status, statusLabel: BEAM_BODY_STATUS_LABELS[e.body.status],
    atThisWarper: e.body.status === BeamBodyStatus.AT_SUBCONTRACTOR && e.body.subcontractorId === order.subcontractorId,
    dispatchNo: e.subcontractorDispatch?.dispatchNo ?? "",
  }));
  const rows = await prisma.beamBody.findMany({ where: beamBodyAtWarperWhere(order.subcontractorId), orderBy: [{ bodyNo: "asc" }, { id: "asc" }], select: AT_WARPER_SELECT });
  const bodies = await toWarperBodies(rows, now);
  const options = bodies.map((b) => ({ ...b, sentWithOrder: b.sentWith?.warpingOrderId === orderId }));
  options.sort((a, b) => Number(b.sentWithOrder) - Number(a.sentWithOrder));
  return { subcontractorId: order.subcontractorId, sent, options };
}

export interface WarperBodyGroup {
  subcontractor: { id: string; name: string };
  count: number;
  bodies: WarperBodyDto[];
}

/** Görünümün tavanı: deverecide boş gövde sayısı demirbaş ölçeğindedir; aşarsa `truncated` ile söylenir. */
export const AT_WARPERS_MAX = 1000;

/**
 * "Devereci elindeki gövdelerimiz" (D3): devereci × gövde. Deverecinin KENDİ gövdesi (sahip rolü WARPER) bizim değildir,
 * kırılıma girmez; müşteri emanet gövdesi bizim sorumluluğumuzda olduğu için girer. Sayılar sunucuda.
 */
export async function listBodiesAtWarpers(p: { subcontractorId: IdCond; search?: string }, now: Date = new Date()): Promise<{ data: WarperBodyGroup[]; summary: { bodyCount: number; warperCount: number }; truncated: boolean }> {
  const and: Prisma.BeamBodyWhereInput[] = [beamBodyAtWarperWhere(p.subcontractorId), { OR: [{ ownerRole: null }, { ownerRole: { not: BeamBodyOwnerRole.WARPER } }] }];
  const q = p.search?.trim();
  if (q) and.push({ bodyNo: { contains: q, mode: "insensitive" } });
  const where = { AND: and };
  const rows = await prisma.beamBody.findMany({ where, orderBy: [{ subcontractor: { name: "asc" } }, { subcontractorId: "asc" }, { bodyNo: "asc" }, { id: "asc" }], take: AT_WARPERS_MAX + 1, select: AT_WARPER_SELECT });
  const truncated = rows.length > AT_WARPERS_MAX;
  const page = truncated ? rows.slice(0, AT_WARPERS_MAX) : rows;
  const bodies = await toWarperBodies(page, now);
  const groups = new Map<string, WarperBodyGroup>();
  for (const [i, r] of page.entries()) {
    const sub = r.subcontractor;
    if (!sub) continue;
    const g = groups.get(sub.id) ?? { subcontractor: sub, count: 0, bodies: [] };
    g.bodies.push(bodies[i]!);
    groups.set(sub.id, g);
  }
  const counts = await prisma.beamBody.groupBy({ by: ["subcontractorId"], where, _count: { _all: true } });
  for (const c of counts) {
    const g = c.subcontractorId ? groups.get(c.subcontractorId) : undefined;
    if (g) g.count = c._count._all;
  }
  const bodyCount = counts.reduce((s, c) => s + c._count._all, 0);
  return { data: [...groups.values()], summary: { bodyCount, warperCount: counts.length }, truncated };
}
