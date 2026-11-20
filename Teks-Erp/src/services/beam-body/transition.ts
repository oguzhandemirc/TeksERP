// =============================================================================
// LEVENT GÖVDESİ — elle geçişler (boş gönder/dön · bakım · hurda) + son hareketi geri alma (devere ek B2)
// =============================================================================
// Geçiş tablosu `BEAM_BODY_MANUAL_TRANSITIONS`; yazım yalnız helper (`transitionBeamBodyTx` claim + aynı tx olay).
// Önizleme yazmaz ve aynı doğrulamayı (`planTransition`) okur. Geri alma yalnız gövdenin son, belgesiz elle geçişi
// (`beamBodyEventUndoBlock`); ters `*_CANCEL` durum + yeri bir önceki olaya döndürür (`reverseLatestBeamBodyEventTx`).
// =============================================================================
import { BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import {
  assertBeamBodyEnabled, beamBodyEventNeighborsTx, beamBodyEventUndoBlock, logBeamBodyEventAudit, reverseLatestBeamBodyEventTx,
  transitionBeamBodyTx, type BeamBodyPlace,
} from "../helpers/beam-body.helper";
import { BEAM_BODY_EVENT_LABELS, BEAM_BODY_MANUAL_TRANSITIONS, BEAM_BODY_STATUS_LABELS, type BeamBodyManualKind } from "../../constants/beam-body";
import { loadBeamBodyDto, type BeamBodyDto } from "./read";

type Db = Prisma.TransactionClient | typeof prisma;

export interface BeamBodyTransitionInput {
  kind: BeamBodyManualKind;
  /** SHIP_EMPTY: zorunlu (gövdenin gittiği devereci). */
  subcontractorId?: string | null;
  /** RETURN_EMPTY / MAINTENANCE_*: isteğe bağlı depo (boşsa bakımda mevcut depo korunur). */
  warehouseId?: string | null;
  /** SCRAP'ta zorunlu (3–300); diğerlerinde isteğe bağlı not. */
  reason?: string | null;
}

export interface BeamBodyTransitionPlan {
  body: BeamBodyDto;
  kind: BeamBodyManualKind;
  kindLabel: string;
  from: BeamBodyStatus;
  to: BeamBodyStatus;
  toLabel: string;
  place: BeamBodyPlace;
  warnings: string[];
}

async function activeSubcontractor(db: Db, id: string): Promise<void> {
  const s = await db.subcontractor.findUnique({ where: { id }, select: { isActive: true } });
  if (!s?.isActive) throw AppError.badRequest("Devereci bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
}

async function activeWarehouse(db: Db, id: string): Promise<void> {
  const w = await db.warehouse.findUnique({ where: { id }, select: { isActive: true } });
  if (!w?.isActive) throw AppError.badRequest("Depo bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
}

/** Doğrulama + hedef durum/yer — önizleme ve yazım TEK yerden. Durum uyumsuzsa 409 `BEAM_BODY_STATE` (yazmadan). */
async function planTransition(db: Db, id: string, input: BeamBodyTransitionInput): Promise<BeamBodyTransitionPlan> {
  const rule = BEAM_BODY_MANUAL_TRANSITIONS[input.kind];
  if (!rule) throw AppError.badRequest("Tanınmayan gövde hareketi", { code: "BEAM_BODY_TRANSITION_UNKNOWN" });
  const body = await loadBeamBodyDto(db, id);
  if (!body.isActive) throw AppError.conflict(`${body.bodyNo} pasif — hareket yazılamaz`, { code: "BEAM_BODY_INACTIVE" });
  if (!(rule.from as readonly BeamBodyStatus[]).includes(body.status)) {
    throw AppError.conflict(
      `${body.bodyNo} şu an "${body.statusLabel}" — "${BEAM_BODY_EVENT_LABELS[input.kind]}" yalnız ${rule.from.map((s) => `"${BEAM_BODY_STATUS_LABELS[s]}"`).join(" ya da ")} durumunda yapılır`,
      { code: "BEAM_BODY_STATE", status: body.status, expected: rule.from },
    );
  }
  const reason = input.reason?.trim() || null;
  const warnings: string[] = [];
  let place: BeamBodyPlace = { warehouseId: null, subcontractorId: null, machineId: null };
  switch (input.kind) {
    case "SHIP_EMPTY":
      if (!input.subcontractorId) throw AppError.badRequest("Boş gövdenin gönderildiği devereci seçilmeli", { code: "BEAM_BODY_PLACE_REQUIRED" });
      if (input.warehouseId) throw AppError.badRequest("Deverecideki gövdeye depo seçilmez", { code: "BEAM_BODY_PLACE_INVALID" });
      await activeSubcontractor(db, input.subcontractorId);
      place = { ...place, subcontractorId: input.subcontractorId };
      break;
    case "RETURN_EMPTY":
    case "MAINTENANCE_IN":
    case "MAINTENANCE_OUT":
      if (input.subcontractorId) throw AppError.badRequest("Bu harekette devereci seçilmez", { code: "BEAM_BODY_PLACE_INVALID" });
      if (input.warehouseId) await activeWarehouse(db, input.warehouseId);
      // Bakıma giriş/çıkışta depo verilmezse gövde bulunduğu depoda kalır; boş dönüşte depo bilinmiyor olabilir.
      place = { ...place, warehouseId: input.warehouseId ?? (input.kind === "RETURN_EMPTY" ? null : body.place.warehouse?.id ?? null) };
      break;
    case "SCRAP":
      if (input.subcontractorId || input.warehouseId) throw AppError.badRequest("Hurdaya ayrılan gövdeye yer seçilmez", { code: "BEAM_BODY_PLACE_INVALID" });
      if (!reason || reason.length < 3) throw AppError.badRequest("Hurda sebebi zorunlu (en az 3 karakter)", { code: "BEAM_BODY_SCRAP_REASON_REQUIRED" });
      if (body.owner.kind !== "OURS") warnings.push(`${body.bodyNo} ${body.owner.customer?.name ?? "başka firma"} gövdesi — hurdaya ayırmadan önce sahibine haber verin.`);
      break;
  }
  return { body, kind: input.kind, kindLabel: BEAM_BODY_EVENT_LABELS[input.kind], from: body.status, to: rule.to, toLabel: BEAM_BODY_STATUS_LABELS[rule.to], place, warnings };
}

export async function previewBeamBodyTransition(id: string, input: BeamBodyTransitionInput): Promise<BeamBodyTransitionPlan> {
  await assertBeamBodyEnabled();
  return planTransition(prisma, id, input);
}

export async function applyBeamBodyTransition(id: string, input: BeamBodyTransitionInput, userId: string): Promise<{ body: BeamBodyDto; warnings: string[] }> {
  await assertBeamBodyEnabled();
  const out = await prisma.$transaction(async (tx) => {
    // Claim (helper) tx'in ilk YAZISI; plan okuması claim'in beklenen durumunu verir — araya giren geçiş 409 alır.
    const plan = await planTransition(tx, id, input);
    const ev = await transitionBeamBodyTx(tx, { bodyId: id, kind: input.kind, from: plan.from, to: plan.to, place: plan.place, reason: input.reason?.trim() || null, userId });
    return { plan, ev };
  });
  await logBeamBodyEventAudit({ userId, eventId: out.ev.id, kind: input.kind, data: { bodyId: id, bodyNo: out.plan.body.bodyNo, fromStatus: out.plan.from, toStatus: out.plan.to, ...out.plan.place, reason: input.reason ?? null } });
  return { body: await loadBeamBodyDto(prisma, id), warnings: out.plan.warnings };
}

export interface BeamBodyEventUndoPreview {
  body: BeamBodyDto;
  event: { id: string; kind: string; label: string; createdAt: string };
  undoable: boolean;
  blocker: string | null;
  /** Geri alınınca dönülecek durum. */
  restoresTo: { status: BeamBodyStatus; label: string } | null;
}

async function loadOwnEvent(db: Db, bodyId: string, eventId: string) {
  const ev = await db.beamBodyEvent.findUnique({
    where: { id: eventId },
    select: { id: true, bodyId: true, kind: true, fromStatus: true, createdAt: true, subcontractorDispatchId: true, returnItem: { select: { id: true } }, reversal: { select: { id: true } } },
  });
  if (!ev || ev.bodyId !== bodyId) throw AppError.notFound("Bu gövdede böyle bir hareket yok", { code: "BEAM_BODY_EVENT_NOT_FOUND" });
  return ev;
}

async function undoBlockOf(db: Db, ev: Awaited<ReturnType<typeof loadOwnEvent>>) {
  const { later } = await beamBodyEventNeighborsTx(db, ev);
  return beamBodyEventUndoBlock({ kind: ev.kind, hasDocument: ev.subcontractorDispatchId !== null || ev.returnItem !== null, reversed: ev.reversal !== null, isLatest: later === 0 });
}

export async function previewUndoBeamBodyEvent(bodyId: string, eventId: string): Promise<BeamBodyEventUndoPreview> {
  await assertBeamBodyEnabled();
  const ev = await loadOwnEvent(prisma, bodyId, eventId);
  const block = await undoBlockOf(prisma, ev);
  const base = ev.kind.replace(/_CANCEL$/, "") as BeamBodyManualKind;
  return {
    body: await loadBeamBodyDto(prisma, bodyId),
    event: { id: ev.id, kind: ev.kind, label: BEAM_BODY_EVENT_LABELS[base] ?? ev.kind, createdAt: ev.createdAt.toISOString() },
    undoable: block === null,
    blocker: block?.message ?? null,
    restoresTo: ev.fromStatus ? { status: ev.fromStatus, label: BEAM_BODY_STATUS_LABELS[ev.fromStatus] } : null,
  };
}

export async function undoBeamBodyEvent(bodyId: string, eventId: string, reason: string, userId: string): Promise<BeamBodyDto> {
  await assertBeamBodyEnabled();
  const out = await prisma.$transaction(async (tx) => {
    const ev = await loadOwnEvent(tx, bodyId, eventId);
    const block = await undoBlockOf(tx, ev);
    if (block) throw AppError.conflict(block.message, { code: block.code });
    // "Son hareket" helper'da claim altında yeniden ölçülür (yarışta 409 BEAM_BODY_EVENT_NOT_LATEST).
    return { kind: ev.kind as BeamBodyManualKind, rev: await reverseLatestBeamBodyEventTx(tx, { eventId, reason, userId }) };
  });
  await logBeamBodyEventAudit({ userId, eventId: out.rev.id, kind: `${out.kind}_CANCEL`, data: { bodyId, reversesId: eventId, toStatus: out.rev.toStatus, reason } });
  return loadBeamBodyDto(prisma, bodyId);
}
