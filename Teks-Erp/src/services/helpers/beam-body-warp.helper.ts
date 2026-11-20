// =============================================================================
// SARIM OLAYI → GÖVDE DURUMU kancası (devere ek B3)
// =============================================================================
// `applyWarpBeamEventTx` sarım satırını yazdıktan SONRA çağırır (kilit sırası sarım → gövde). Gövdesiz sarımda tek
// okuma, yazım yok (eski davranış bayt-aynı). İleri sarım olayı gövdeyi `transitionBeamBodyTx` ile yürütür; sarım
// tersi gövdenin aynı sarıma ait son ileri olayını tipli tersle geri alır (`reverseLatestBeamBodyEventTx`).
// Gövde sarımla kilit adımlı yürür: dolu gövdeye elle geçiş yoktur (B2 tablosu), uyumsuzluk 409'dur.
// =============================================================================
import { BeamBodyStatus, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import type { WarpBeamEventKind } from "../../constants/warp-beam";
import { BEAM_BODY_EVENT_LABELS, BEAM_BODY_STATUS_LABELS, type BeamBodyWarpKind } from "../../constants/beam-body";
import { reverseLatestBeamBodyEventTx, transitionBeamBodyTx, type BeamBodyEventRow, type BeamBodyPlace } from "./beam-body.helper";

type Tx = Prisma.TransactionClient;
const S = BeamBodyStatus;

interface ForwardRule { kind: BeamBodyWarpKind; from: readonly BeamBodyStatus[]; to: BeamBodyStatus; place: "none" | "machine" | "dispatchSubcontractor" | "warpSubcontractor" }
type Rule = { forward: ForwardRule } | { reverse: BeamBodyWarpKind };

/** Sarım olay türü → gövde hareketi. Listede olmayan tür (tüketim, düzeltme…) gövdeye dokunmaz. */
export const WARP_EVENT_BODY_RULES: Partial<Record<WarpBeamEventKind, Rule>> = {
  WOUND: { forward: { kind: "FILLED", from: [S.EMPTY_STOCK, S.AT_SUBCONTRACTOR], to: S.FULL_STOCK, place: "none" } },
  WOUND_CANCEL: { reverse: "FILLED" },
  MOUNTED: { forward: { kind: "MOUNTED", from: [S.FULL_STOCK], to: S.MOUNTED, place: "machine" } },
  MOUNT_CANCEL: { reverse: "MOUNTED" },
  DISMOUNTED: { forward: { kind: "DISMOUNTED", from: [S.MOUNTED], to: S.FULL_STOCK, place: "none" } },
  DISMOUNT_CANCEL: { reverse: "DISMOUNTED" },
  EXHAUSTED: { forward: { kind: "EMPTIED", from: [S.MOUNTED, S.FULL_STOCK, S.FULL_OUT], to: S.EMPTY_STOCK, place: "none" } },
  EXHAUST_CANCEL: { reverse: "EMPTIED" },
  SCRAPPED: { forward: { kind: "EMPTIED", from: [S.MOUNTED, S.FULL_STOCK, S.FULL_OUT], to: S.EMPTY_STOCK, place: "none" } },
  SCRAP_CANCEL: { reverse: "EMPTIED" },
  SHIP_OUT: { forward: { kind: "SHIPPED_FULL", from: [S.FULL_STOCK], to: S.FULL_OUT, place: "dispatchSubcontractor" } },
  SHIP_OUT_CANCEL: { reverse: "SHIPPED_FULL" },
  RETURNED_IN: { forward: { kind: "RETURNED_FULL", from: [S.FULL_OUT], to: S.FULL_STOCK, place: "none" } },
  RETURNED_IN_CANCEL: { reverse: "RETURNED_FULL" },
  SHIP_TO_OWNER: { forward: { kind: "SHIPPED_FULL", from: [S.FULL_STOCK], to: S.FULL_OUT, place: "none" } },
  SHIP_TO_OWNER_CANCEL: { reverse: "SHIPPED_FULL" },
  // Devere ek C1: ret — gövde sarımla devereciye gider ve orada "Deverecide" sayılır (üstündeki sarım boşalır:
  // reddedilen sarımın ipliği deverecinin tutmasına döner); yeniden sarım aynı gövdeye FILLED ile dolabilir.
  REJECT_OUT: { forward: { kind: "SHIPPED_FULL", from: [S.FULL_STOCK], to: S.AT_SUBCONTRACTOR, place: "warpSubcontractor" } },
  REJECT_OUT_CANCEL: { reverse: "SHIPPED_FULL" },
};

const NOWHERE: BeamBodyPlace = { warehouseId: null, subcontractorId: null, machineId: null };

async function placeFor(tx: Tx, rule: ForwardRule, data: { machineId?: string | null; dispatchItemId?: string | null }, beamId: string): Promise<BeamBodyPlace> {
  if (rule.place === "warpSubcontractor") {
    const w = await tx.warpBeam.findUnique({ where: { id: beamId }, select: { subcontractorId: true } });
    if (!w?.subcontractorId) throw AppError.badRequest("Sarımın deverecisi yok — gövde yeri yazılamaz", { code: "BEAM_BODY_PLACE_REQUIRED" });
    return { ...NOWHERE, subcontractorId: w.subcontractorId };
  }
  if (rule.place === "machine") {
    if (!data.machineId) throw AppError.badRequest("Takma olayında tezgâh yok — gövde yeri yazılamaz", { code: "BEAM_BODY_PLACE_REQUIRED" });
    return { ...NOWHERE, machineId: data.machineId };
  }
  if (rule.place === "dispatchSubcontractor" && data.dispatchItemId) {
    const item = await tx.subcontractorDispatchItem.findUnique({ where: { id: data.dispatchItemId }, select: { dispatch: { select: { subcontractorId: true } } } });
    return { ...NOWHERE, subcontractorId: item?.dispatch.subcontractorId ?? null };
  }
  return NOWHERE;
}

/**
 * Sarım olayının gövde karşılığını yazar; yazdığı gövde olayını döner (gövdesiz sarımda ya da kuralsız türde null).
 * İleri kuralda gövde beklenen durumda değilse ya da üstündeki sarım bu değilse 409 — sarım işlemi de geri döner.
 */
export async function advanceBeamBodyForWarpEventTx(
  tx: Tx,
  input: { beamId: string; kind: WarpBeamEventKind; data: { machineId?: string | null; dispatchItemId?: string | null; reason?: string | null; createdById?: string | null } },
): Promise<BeamBodyEventRow | null> {
  const rule = WARP_EVENT_BODY_RULES[input.kind];
  if (!rule) return null;
  const beam = await tx.warpBeam.findUnique({ where: { id: input.beamId }, select: { beamNo: true, beamBodyId: true } });
  if (!beam?.beamBodyId) return null;
  if ("reverse" in rule) {
    const fwd = await tx.beamBodyEvent.findFirst({
      where: { bodyId: beam.beamBodyId, warpBeamId: input.beamId, kind: rule.reverse, reversal: { is: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    // İleri olay gövdeye hiç yazılmadıysa (bağ sonradan kurulmuş) geri alınacak gövde hareketi yoktur.
    if (!fwd) return null;
    const reason = (input.data.reason?.trim() || `${beam.beamNo}: sarım hareketi geri alındı`).slice(0, 300);
    return reverseLatestBeamBodyEventTx(tx, { eventId: fwd.id, reason, userId: input.data.createdById ?? null });
  }
  const f = rule.forward;
  const body = await tx.beamBody.findUnique({ where: { id: beam.beamBodyId }, select: { bodyNo: true, status: true, currentWarpBeamId: true } });
  if (!body) throw AppError.notFound("Levent gövdesi bulunamadı", { code: "BEAM_BODY_NOT_FOUND" });
  const ownsWarp = f.kind === "FILLED" ? body.currentWarpBeamId === null : body.currentWarpBeamId === input.beamId;
  if (!f.from.includes(body.status) || !ownsWarp) {
    throw AppError.conflict(
      `${body.bodyNo} gövdesi şu an "${BEAM_BODY_STATUS_LABELS[body.status]}" — "${BEAM_BODY_EVENT_LABELS[f.kind]}" (${beam.beamNo}) yazılamaz`,
      { code: f.kind === "FILLED" ? "BEAM_BODY_BUSY" : "BEAM_BODY_STATE", status: body.status, bodyNo: body.bodyNo },
    );
  }
  return transitionBeamBodyTx(tx, {
    bodyId: beam.beamBodyId, kind: f.kind, from: body.status, to: f.to, place: await placeFor(tx, f, input.data, input.beamId),
    warpBeamId: input.beamId, userId: input.data.createdById ?? null,
  });
}
