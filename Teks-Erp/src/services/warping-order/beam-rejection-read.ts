// =============================================================================
// FASON DEVERE — kusurlu levent RET BELGESİ okuyucusu (devere ek C1): DTO = basım verisi · liste · sarım yükleyici
// =============================================================================
// Belge DTO'su panelin basım verisidir (HTML panelde, emsal B2 iade belgesi): devereciye giden belge — ücret/maliyet YOK.
// Liste + cursor + özet şeridi TEK where'den. Sarım yükleyici önizleme, ret ve ret iptali için ortak (dağıtım = tutan).
// =============================================================================
import { Prisma, type WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { buildNextCursor, cursorWhere, decodeCursor } from "../../utils/cursor";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { LIVE_REWORK_WHERE } from "../helpers/warping-beam-rejection.helper";

type Db = Prisma.TransactionClient | typeof prisma;
const kg3 = (v: Prisma.Decimal.Value | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v).toFixed(3));

/** Ret/iptal hesabı için sarım satırı: WOUND + kırılım dağıtımı (tutan sipariş) + gövde + diğer olaylar. */
export const REJECT_BEAM_SELECT = {
  id: true, beamNo: true, status: true, warpingOrderId: true, warpingReceiptKey: true,
  beamBody: { select: { id: true, bodyNo: true } },
  reworks: { where: LIVE_REWORK_WHERE, select: { id: true, beamNo: true } },
  events: {
    select: {
      id: true, kind: true, lengthM: true, theoreticalKg: true, deliveryNoteNo: true, createdAt: true, reversal: { select: { id: true } },
      yarns: {
        select: {
          yarnItemId: true, theoreticalKg: true, yarnItem: { select: { code: true, name: true } },
          allocations: { select: { kg: true, dispatchItemId: true, holderWarpingOrderId: true, holderWarpingOrder: { select: { orderNo: true } }, dispatchItem: { select: { dispatch: { select: { dispatchNo: true } }, lot: { select: { lotNo: true } } } } } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.WarpBeamSelect;
export type RejectBeamRow = Prisma.WarpBeamGetPayload<{ select: typeof REJECT_BEAM_SELECT }>;

export async function loadRejectBeams(db: Db, beamIds: string[]): Promise<RejectBeamRow[]> {
  return sequentialTx(db).warpBeam.findMany({ where: { id: { in: beamIds } }, select: REJECT_BEAM_SELECT, orderBy: { id: "asc" } });
}

export const woundOf = (b: RejectBeamRow) => b.events.find((e) => e.kind === "WOUND" && e.reversal === null) ?? null;

export interface RejectYarnLine { yarnItemId: string; code: string; name: string; dispatchItemId: string; dispatchNo: string; lotNo: string | null; holderWarpingOrderId: string; holderOrderNo: string; kg: string }

/** Sarımların dağıtımı (kalem × tutan sipariş) — retle tutmaya DÖNECEK / ret iptaliyle yeniden DÜŞECEK kg. */
export function yarnLinesOf(beams: RejectBeamRow[]): RejectYarnLine[] {
  const m = new Map<string, Omit<RejectYarnLine, "kg"> & { kg: Prisma.Decimal }>();
  for (const b of beams) {
    for (const y of woundOf(b)?.yarns ?? []) {
      for (const a of y.allocations) {
        const k = `${a.dispatchItemId}|${a.holderWarpingOrderId}`;
        const cur = m.get(k) ?? {
          yarnItemId: y.yarnItemId, code: y.yarnItem.code, name: y.yarnItem.name, dispatchItemId: a.dispatchItemId, dispatchNo: a.dispatchItem.dispatch.dispatchNo,
          lotNo: a.dispatchItem.lot?.lotNo ?? null, holderWarpingOrderId: a.holderWarpingOrderId, holderOrderNo: a.holderWarpingOrder.orderNo, kg: new Prisma.Decimal(0),
        };
        cur.kg = cur.kg.plus(a.kg);
        m.set(k, cur);
      }
    }
  }
  return [...m.values()].map((r) => ({ ...r, kg: r.kg.toFixed(3) }));
}

// ── Belge DTO ────────────────────────────────────────────────────────────────

const DOC_SELECT = {
  id: true, docNo: true, reasonCode: true, reasonText: true, notes: true, expectRework: true, rejectedAt: true,
  cancelledAt: true, cancelReason: true, createdAt: true,
  warpingOrder: { select: { id: true, orderNo: true, warpSpec: { select: { code: true, name: true } } } },
  subcontractor: { select: { id: true, code: true, name: true } },
  photos: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" as const } },
  items: {
    select: {
      event: { select: { id: true, lengthM: true, reversal: { select: { id: true } } } },
      warpBeam: {
        select: {
          id: true, beamNo: true, status: true, physicalBeamNo: true, beamBody: { select: { id: true, bodyNo: true } },
          reworks: { where: LIVE_REWORK_WHERE, select: { id: true, beamNo: true } },
          events: { where: { kind: "WOUND" }, select: { lengthM: true, theoreticalKg: true, endsCount: true, deliveryNoteNo: true, createdAt: true } },
        },
      },
    },
    orderBy: { warpBeam: { beamNo: "asc" as const } },
  },
} satisfies Prisma.WarpingBeamRejectionSelect;
type DocRow = Prisma.WarpingBeamRejectionGetPayload<{ select: typeof DOC_SELECT }>;

export interface WarpingBeamRejectionDto {
  id: string;
  docNo: string;
  status: "ACTIVE" | "CANCELLED";
  mode: "REWORK" | "CANCEL";
  order: { id: string; orderNo: string; warpSpec: { code: string; name: string } };
  subcontractor: { id: string; code: string; name: string };
  reason: { code: string; text: string };
  notes: string | null;
  rejectedAt: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  totals: { beamCount: number; lengthM: string; nominalKg: string };
  items: Array<{
    beamId: string; beamNo: string; status: WarpBeamStatus; bodyNo: string | null; lengthM: string | null; nominalKg: string | null; endsCount: number | null;
    deliveryNoteNo: string | null; receivedAt: string | null; reversed: boolean; rework: { id: string; beamNo: string } | null;
  }>;
  photos: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}

function toDto(r: DocRow): WarpingBeamRejectionDto {
  let len = new Prisma.Decimal(0);
  let nom = new Prisma.Decimal(0);
  const items = r.items.map((i) => {
    const w = i.warpBeam.events[0] ?? null;
    len = len.plus(w?.lengthM ?? 0);
    nom = nom.plus(w?.theoreticalKg ?? 0);
    return {
      beamId: i.warpBeam.id, beamNo: i.warpBeam.beamNo, status: i.warpBeam.status, bodyNo: i.warpBeam.beamBody?.bodyNo ?? i.warpBeam.physicalBeamNo,
      lengthM: kg3(w?.lengthM), nominalKg: kg3(w?.theoreticalKg), endsCount: w?.endsCount ?? null, deliveryNoteNo: w?.deliveryNoteNo ?? null,
      receivedAt: w?.createdAt.toISOString() ?? null, reversed: i.event.reversal !== null, rework: i.warpBeam.reworks[0] ?? null,
    };
  });
  return {
    id: r.id, docNo: r.docNo, status: r.cancelledAt ? "CANCELLED" : "ACTIVE", mode: r.expectRework ? "REWORK" : "CANCEL",
    order: r.warpingOrder, subcontractor: r.subcontractor, reason: { code: r.reasonCode, text: r.reasonText }, notes: r.notes,
    rejectedAt: r.rejectedAt.toISOString(), createdAt: r.createdAt.toISOString(), cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason,
    totals: { beamCount: items.length, lengthM: len.toFixed(3), nominalKg: nom.toFixed(3) },
    items,
    photos: r.photos.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
  };
}

export async function loadRejectionDto(db: Db, id: string): Promise<WarpingBeamRejectionDto> {
  const r = await db.warpingBeamRejection.findUnique({ where: { id }, select: DOC_SELECT });
  if (!r) throw AppError.notFound("Ret belgesi bulunamadı.", { code: "WARPING_REJECTION_NOT_FOUND" });
  return toDto(r);
}

export const getWarpingBeamRejection = (id: string) => loadRejectionDto(prisma, id);

export interface WarpingBeamRejectionListParams { warpingOrderId: string | { in: string[] } | null; subcontractorId: string | { in: string[] } | null; status: "active" | "cancelled" | "all"; search?: string; cursor?: string; limit: number }

export async function listWarpingBeamRejections(p: WarpingBeamRejectionListParams) {
  const and: Prisma.WarpingBeamRejectionWhereInput[] = [];
  if (p.warpingOrderId) and.push({ warpingOrderId: p.warpingOrderId });
  if (p.subcontractorId) and.push({ subcontractorId: p.subcontractorId });
  if (p.status !== "all") and.push({ cancelledAt: p.status === "active" ? null : { not: null } });
  const q = p.search?.trim();
  if (q) and.push({ OR: [{ docNo: { contains: q, mode: "insensitive" } }, { items: { some: { warpBeam: { beamNo: { contains: q, mode: "insensitive" } } } } }] });
  const where: Prisma.WarpingBeamRejectionWhereInput = and.length > 0 ? { AND: and } : {};
  const cursor = p.cursor ? decodeCursor(p.cursor) : null;
  if (p.cursor && !cursor) throw AppError.badRequest("Geçersiz sayfa imleci.", { code: "CURSOR_INVALID" });
  const rows = await prisma.warpingBeamRejection.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: p.limit + 1, select: DOC_SELECT,
  });
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const count = await prisma.warpingBeamRejection.count({ where });
  const beamCount = await prisma.warpingBeamRejectionItem.count({ where: { rejection: where } });
  return { data: page.map(toDto), nextCursor: hasMore ? buildNextCursor(page[page.length - 1]) : null, summary: { count, beamCount } };
}
