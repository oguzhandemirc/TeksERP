// =============================================================================
// FASON DEVERE — dönüş kabulünde YENİDEN SARIM bağı (devere ek C1)
// =============================================================================
// Kabul satırı `reworkOfBeamId?` taşır: yeni sarım normal kabulle doğar ve reddedilene bağlanır. Kapı: aynı sipariş,
// sarım REJECTED ve aktif ret belgesinin kipi "yeniden sarılsın" (değilse 400), başka canlı yeniden sarımı yok (409;
// DB seddi partial unique `warp_beams_rework_of_live_uq`). Kabul tx'inde sipariş claim'i ve kalem kilitlerinden SONRA
// reddedilen sarım satırları `id` sırasıyla FOR UPDATE (ret iptali aynı sırayla kilitler). `receive.ts` yalnız çağırır.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LIVE_REWORK_WHERE } from "../helpers/warping-beam-rejection.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface WarpingReceiveReworkLine {
  /** C1: bu sarım hangi reddedilen sarımın yeniden sarımı (aynı sipariş, kip "yeniden sarılsın"). */
  reworkOfBeamId?: string | null;
}

export interface ReceiveReworkRef { beamId: string; beamNo: string; rejectionDocNo: string }

/** Satır başına bağ (index → ref | null). Önizleme kilitsiz, kabul `lock: true` ile çağırır. */
export async function planReceiveReworks(db: Db, input: { warpingOrderId: string; lines: WarpingReceiveReworkLine[]; lock: boolean }): Promise<Array<ReceiveReworkRef | null>> {
  const ids = input.lines.map((l) => l.reworkOfBeamId ?? null);
  const wanted = [...new Set(ids.filter((x): x is string => !!x))].sort();
  if (wanted.length === 0) return ids.map(() => null);
  if (wanted.length !== ids.filter(Boolean).length) {
    throw AppError.badRequest("Aynı reddedilen sarım bu kabulde iki satıra bağlanmış.", { code: "WARPING_REWORK_DUPLICATE" });
  }
  if (input.lock) await (db as Prisma.TransactionClient).$queryRaw`SELECT id FROM warp_beams WHERE id = ANY(${wanted}::uuid[]) ORDER BY id FOR UPDATE`;
  const rows = await db.warpBeam.findMany({
    where: { id: { in: wanted } },
    select: {
      id: true, beamNo: true, status: true, warpingOrderId: true,
      rejectionItems: { where: { rejection: { cancelledAt: null } }, select: { rejection: { select: { docNo: true, expectRework: true } } }, take: 1 },
      reworks: { where: LIVE_REWORK_WHERE, select: { beamNo: true }, take: 1 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const refs = new Map<string, ReceiveReworkRef>();
  for (const id of wanted) {
    const r = byId.get(id);
    if (!r || r.warpingOrderId !== input.warpingOrderId) {
      throw AppError.badRequest("Yeniden sarım bağı yalnız bu siparişin reddedilen sarımına kurulur.", { code: "WARPING_REWORK_TARGET_INVALID", beamId: id });
    }
    const rej = r.rejectionItems[0]?.rejection;
    if (r.status !== WarpBeamStatus.REJECTED || !rej) {
      throw AppError.badRequest(`${r.beamNo} reddedilmiş bir sarım değil — yeniden sarım bağı kurulamaz.`, { code: "WARPING_REWORK_TARGET_INVALID", beamId: id });
    }
    if (!rej.expectRework) {
      throw AppError.badRequest(`${r.beamNo} "iptal, iplik deverecide kalsın" kipiyle reddedildi (${rej.docNo}) — yeniden sarım bağlanamaz.`, { code: "WARPING_REWORK_NOT_EXPECTED", beamId: id });
    }
    if (r.reworks[0]) {
      throw AppError.conflict(`${r.beamNo} için yeniden sarım zaten kabul edildi (${r.reworks[0].beamNo}).`, { code: "WARPING_REWORK_TAKEN", beamId: id });
    }
    refs.set(id, { beamId: id, beamNo: r.beamNo, rejectionDocNo: rej.docNo });
  }
  return ids.map((x) => (x ? refs.get(x)! : null));
}

/** Replay kimliği (çekirdek idempotency): satır sırasıyla yeniden sarım bağları — kabul sarımları `beamNo` sırasıyla doğar. */
export const reworkReplaySig = (ids: Array<string | null | undefined>): string => ids.map((x) => x ?? "").join(",");
