// =============================================================================
// İÇERİDE SARIM ↔ LEVENT GÖVDESİ (devere ek-2 r)
// =============================================================================
// `POST /warp-beams/:id/wind` gövdesi `beamBodyIds?` (adet kadar, sırayla takımın 1..N leventine). Kapı
// `devere.beamBodyMode`: OFF'ta gövde girdisi 403 (gövdesiz sarım bayt-aynı); REQUIRED'da içeride gövdesiz sarım 400.
// Bu dosya YALNIZ doğrular ve sarıma bağı (doğum niteliği `beamBodyId`) hazırlar; gövde durumunu (EMPTY_STOCK →
// FULL_STOCK) `applyWarpBeamEventTx` kancası WOUND olayında yürütür, sarım iptali aynı kancayla geri alır.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma, WarpBeamOrigin } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readDevereBeamBodyMode } from "../system-setting.service";
import { assertBeamBodyEnabled } from "./beam-body.helper";
import { BEAM_BODY_FULL_STATUSES, BEAM_BODY_STATUS_LABELS } from "../../constants/beam-body";

type Db = Prisma.TransactionClient | typeof prisma;

/** Takımın k. leventinin gövdesi (index = k−1). */
export interface WindBodyPlan {
  beamBodyId: string;
  bodyNo: string;
  /** Müşteri gövdesinde sarıma kalıtılan sahip; diğer sahiplerde null (lot/levent sahibi geçerli). */
  customerOwnerId: string | null;
}

/**
 * Doğrulama + plan (yazmaz). Gövde aktif ve BOŞ + BİZDE olmalı; dolu 409 BEAM_BODY_BUSY, deverecide 409
 * BEAM_BODY_ELSEWHERE, bakım/hurda/iade 409 BEAM_BODY_STATE. Son karar kancanın atomik geçişindedir (yarış).
 */
export async function planWindBodies(
  db: Db,
  input: { beamNo: string; originKind: WarpBeamOrigin; count: number; beamBodyIds: string[] | null | undefined },
): Promise<WindBodyPlan[] | null> {
  const ids = input.beamBodyIds ?? [];
  if (ids.length === 0) {
    if (input.originKind === WarpBeamOrigin.IN_HOUSE && (await readDevereBeamBodyMode(db)) === "REQUIRED") {
      throw AppError.badRequest(`${input.beamNo}: levent gövdesi okutulmalı (ayar: gövde takibi zorunlu).`, { code: "BEAM_BODY_REQUIRED" });
    }
    return null;
  }
  await assertBeamBodyEnabled(db);
  if (input.originKind !== WarpBeamOrigin.IN_HOUSE) {
    throw AppError.badRequest(`${input.beamNo} içeride sarılmıyor — fason/hazır leventin gövdesi dönüş kabulünde okutulur.`, { code: "BEAM_BODY_WIND_ORIGIN" });
  }
  if (ids.length !== input.count) {
    throw AppError.badRequest(`${input.count} levent sarılıyor ama ${ids.length} gövde okutuldu — her levente bir gövde.`, { code: "BEAM_BODY_WIND_COUNT" });
  }
  if (new Set(ids).size !== ids.length) throw AppError.badRequest("Aynı gövde iki kez okutulmuş.", { code: "BEAM_BODY_WIND_DUPLICATE" });
  const out: WindBodyPlan[] = [];
  for (const id of ids) {
    const b = await db.beamBody.findUnique({ where: { id }, select: { bodyNo: true, status: true, isActive: true, ownerRole: true, ownerCustomerId: true, subcontractor: { select: { name: true } } } });
    if (!b) throw AppError.notFound("Levent gövdesi bulunamadı.", { code: "BEAM_BODY_NOT_FOUND" });
    if (!b.isActive) throw AppError.conflict(`${b.bodyNo} pasif — sarımda kullanılamaz.`, { code: "BEAM_BODY_INACTIVE" });
    if (BEAM_BODY_FULL_STATUSES.includes(b.status)) {
      throw AppError.conflict(`${b.bodyNo} şu an "${BEAM_BODY_STATUS_LABELS[b.status]}" — dolu gövdeye ikinci sarım yazılamaz.`, { code: "BEAM_BODY_BUSY", status: b.status });
    }
    if (b.status === BeamBodyStatus.AT_SUBCONTRACTOR) {
      throw AppError.conflict(`${b.bodyNo} deverecide görünüyor (${b.subcontractor?.name ?? "?"}) — içeride sarım için önce gövdenin yerini düzeltin.`, { code: "BEAM_BODY_ELSEWHERE" });
    }
    if (b.status !== BeamBodyStatus.EMPTY_STOCK) {
      throw AppError.conflict(`${b.bodyNo} şu an "${BEAM_BODY_STATUS_LABELS[b.status]}" — sarılamaz.`, { code: "BEAM_BODY_STATE", status: b.status });
    }
    out.push({ beamBodyId: id, bodyNo: b.bodyNo, customerOwnerId: b.ownerRole === BeamBodyOwnerRole.CUSTOMER ? b.ownerCustomerId : null });
  }
  return out;
}

/** Emanet kalıtımı: müşteri gövdesi sarıma sahip verir; levent/lot sahibi başka müşteriyse 409 OWNER_MISMATCH. */
export function windOwnerFor(plan: WindBodyPlan | null | undefined, ownerCustomerId: string | null, beamNo: string): string | null {
  if (!plan?.customerOwnerId) return ownerCustomerId;
  if (ownerCustomerId && ownerCustomerId !== plan.customerOwnerId) {
    throw AppError.conflict(`${plan.bodyNo} bir müşterinin emanet gövdesi, ${beamNo} başka bir müşterinin — sarım iki sahipli olamaz.`, { code: "OWNER_MISMATCH" });
  }
  return plan.customerOwnerId;
}
