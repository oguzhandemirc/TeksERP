// =============================================================================
// LEVENT GÖVDESİ — kayıt · düzenleme · kayıt iptali (devere ek B1)
// =============================================================================
// Kayıt: replay R kipi (TEK boğaz `tokenReplay`) → tx: no kilidi İLK ifade (8029) → no doğuşta (seri `beamBody`
// ya da elle; büyük/küçük harf duyarsız tekil) → kart + REGISTER (`registerBeamBodyTx`). Sahip tek FK (`ownerCustomerId`);
// devereci sahipliği fason profilinin bağlı carisinden çözülür. Durum değişimi bu dosyada YOK (helper'ın işi);
// düzenleme yalnız nitelik + uyum pivotu (REPLACE) + sahip (yalnız boş ve bizde iken) + pasife alma.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { tokenReplay } from "../helpers/token-replay.helper";
import { lockCodeScopeTx } from "../helpers/code-unique.helper";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "../number-series.service";
import {
  BEAM_BODY_TABLE, assertBeamBodyEnabled, logBeamBodyEventAudit, registerBeamBodyTx, reverseBeamBodyEventTx, type BeamBodyPlace,
} from "../helpers/beam-body.helper";
import { BEAM_BODY_DEACTIVATABLE_STATUSES, BEAM_BODY_REGISTER_STATUSES, BEAM_BODY_STATUS_LABELS, type BeamBodyOwnerKind } from "../../constants/beam-body";
import { loadBeamBodyDto, type BeamBodyDto } from "./read";

type Tx = Prisma.TransactionClient;
const CODE_SCOPE = "beamBody";
export const BEAM_BODY_MAX_MACHINES = 200;
const D = (v: number | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

export interface BeamBodyOwnerInput {
  kind: BeamBodyOwnerKind;
  customerId?: string | null;
  /** Yalnız `WARPER`: fason profilinin bağlı carisi sahip olur. */
  subcontractorId?: string | null;
}

export interface BeamBodyCreateInput {
  clientToken: string;
  bodyNo?: string | null;
  owner: BeamBodyOwnerInput;
  widthCm?: number | null;
  flangeDiameterCm?: number | null;
  tareKg?: number | null;
  initialStatus?: BeamBodyStatus;
  warehouseId?: string | null;
  subcontractorId?: string | null;
  machineIds?: string[];
  notes?: string | null;
}

export interface BeamBodyPatchInput {
  owner?: BeamBodyOwnerInput;
  widthCm?: number | null;
  flangeDiameterCm?: number | null;
  tareKg?: number | null;
  machineIds?: string[];
  notes?: string | null;
  isActive?: boolean;
}

/** Sahip girdisi → tek FK + gösterim rolü. Fail-closed: tanınmayan/bağsız sahip 400. */
async function resolveOwner(db: Tx | typeof prisma, o: BeamBodyOwnerInput): Promise<{ ownerCustomerId: string | null; ownerRole: BeamBodyOwnerRole | null }> {
  if (o.kind === "OURS") {
    if (o.customerId || o.subcontractorId) throw AppError.badRequest("Bizim gövdemiz için sahip cari seçilmez", { code: "BEAM_BODY_OWNER_INVALID" });
    return { ownerCustomerId: null, ownerRole: null };
  }
  let customerId = o.customerId ?? null;
  if (o.kind === BeamBodyOwnerRole.WARPER && !customerId && o.subcontractorId) {
    const sub = await db.subcontractor.findUnique({ where: { id: o.subcontractorId }, select: { name: true, customerId: true } });
    if (!sub) throw AppError.badRequest("Devereci bulunamadı", { code: "BEAM_BODY_OWNER_INVALID" });
    if (!sub.customerId) throw AppError.badRequest(`${sub.name} için bağlı cari kartı yok — gövde sahibi olarak önce fason profilini bir cariye bağlayın ya da cariyi doğrudan seçin`, { code: "BEAM_BODY_OWNER_UNLINKED" });
    customerId = sub.customerId;
  }
  if (!customerId) throw AppError.badRequest("Gövdenin sahibi olan cari seçilmeli", { code: "BEAM_BODY_OWNER_REQUIRED" });
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { isActive: true, mergedIntoId: true } });
  if (!c || !c.isActive || c.mergedIntoId) throw AppError.badRequest("Sahip cari bulunamadı ya da pasif", { code: "BEAM_BODY_OWNER_INVALID" });
  return { ownerCustomerId: customerId, ownerRole: o.kind };
}

async function assertMachines(db: Tx | typeof prisma, ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const found = await db.machine.findMany({ where: { id: { in: uniq }, isActive: true }, select: { id: true } });
  if (found.length !== uniq.length) throw AppError.badRequest("Uyumlu tezgâhlardan biri bulunamadı ya da pasif", { code: "BEAM_BODY_MACHINE_INVALID" });
  return uniq.sort();
}

/** Kayıt yeri: EMPTY_STOCK → (isteğe bağlı) depo; AT_SUBCONTRACTOR → fasoncu zorunlu. CHECK `beam_bodies_location_ck` ile aynı. */
async function resolveRegisterPlace(db: Tx | typeof prisma, input: BeamBodyCreateInput): Promise<{ status: BeamBodyStatus; place: BeamBodyPlace }> {
  const status = input.initialStatus ?? BeamBodyStatus.EMPTY_STOCK;
  if (!BEAM_BODY_REGISTER_STATUSES.includes(status)) throw AppError.badRequest("Gövde yalnız 'Depoda boş' ya da 'Deverecide' durumunda kaydedilir", { code: "BEAM_BODY_REGISTER_STATUS" });
  if (status === BeamBodyStatus.AT_SUBCONTRACTOR) {
    if (!input.subcontractorId) throw AppError.badRequest("Deverecide kaydedilen gövde için devereci seçilmeli", { code: "BEAM_BODY_PLACE_REQUIRED" });
    if (input.warehouseId) throw AppError.badRequest("Deverecideki gövdeye depo seçilmez", { code: "BEAM_BODY_PLACE_INVALID" });
    const sub = await db.subcontractor.findUnique({ where: { id: input.subcontractorId }, select: { isActive: true } });
    if (!sub?.isActive) throw AppError.badRequest("Devereci bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
    return { status, place: { warehouseId: null, subcontractorId: input.subcontractorId, machineId: null } };
  }
  if (input.subcontractorId) throw AppError.badRequest("Depodaki gövdeye devereci seçilmez", { code: "BEAM_BODY_PLACE_INVALID" });
  if (input.warehouseId) {
    const w = await db.warehouse.findUnique({ where: { id: input.warehouseId }, select: { isActive: true } });
    if (!w?.isActive) throw AppError.badRequest("Depo bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
  }
  return { status, place: { warehouseId: input.warehouseId ?? null, subcontractorId: null, machineId: null } };
}

const MANUAL_NO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
function normalizeManualNo(raw: string): string {
  const v = raw.trim();
  if (!MANUAL_NO.test(v)) throw AppError.badRequest("Gövde no 1–32 karakter; harf, rakam ve . _ / - içerebilir (QR'a basılır)", { code: "BEAM_BODY_NO_INVALID" });
  return v;
}

async function assertNoFreeTx(tx: Tx, bodyNo: string): Promise<void> {
  const taken = await tx.beamBody.findFirst({ where: { bodyNo: { equals: bodyNo, mode: "insensitive" } }, select: { bodyNo: true } });
  if (taken) throw AppError.conflict(`${taken.bodyNo} numaralı gövde zaten kayıtlı`, { code: "BEAM_BODY_NO_TAKEN", bodyNo: taken.bodyNo });
}

interface PriorBody { id: string; bodyNo: string; ownerCustomerId: string | null; ownerRole: BeamBodyOwnerRole | null }
export interface CreateBeamBodyResult { data: BeamBodyDto; replayed: boolean }

function replayFor(input: BeamBodyCreateInput, manualNo: string | null) {
  return tokenReplay<PriorBody, CreateBeamBodyResult>({
    find: (db, clientToken) => db.beamBody.findUnique({ where: { clientToken }, select: { id: true, bodyNo: true, ownerCustomerId: true, ownerRole: true } }),
    alive: { neverDies: "gövde kartı silinmez; kayıt iptali kartı pasife alır ama replay aynı kartı döndürmek doğrudur (kart vardır)" },
    identity: (p) => [
      { ad: "bodyNo", mevcut: manualNo === null ? "" : p.bodyNo.toLowerCase(), gelen: manualNo?.toLowerCase() ?? "" },
      { ad: "owner", mevcut: p.ownerRole ?? "OURS", gelen: input.owner.kind },
    ],
    collision: (p) => `Bu işlem kimliği başka içerikli bir gövde kaydına (${p.bodyNo}) ait — formu yeniden açıp gönderin.`,
    respond: async (p) => ({ data: await loadBeamBodyDto(prisma, p.id), replayed: true }),
  });
}

export async function createBeamBody(input: BeamBodyCreateInput, userId: string): Promise<CreateBeamBodyResult> {
  await assertBeamBodyEnabled();
  const manualNo = input.bodyNo ? normalizeManualNo(input.bodyNo) : null;
  return replayFor(input, manualNo).run(input.clientToken, async () => {
    const owner = await resolveOwner(prisma, input.owner);
    const { status, place } = await resolveRegisterPlace(prisma, input);
    const machineIds = await assertMachines(prisma, input.machineIds ?? []);
    const dims = { widthCm: D(input.widthCm), flangeDiameterCm: D(input.flangeDiameterCm), tareKg: D(input.tareKg) };
    const out = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const fmt = resolveSeriesFormat(CODE_SCOPE);
      await lockCodeScopeTx(tx, CODE_SCOPE, manualNo ?? seriesPrefix(fmt, now));
      const bodyNo = manualNo ?? (await nextSeriesNo(CODE_SCOPE, async (prefix) =>
        tx.beamBody
          .findMany({ where: { bodyNo: { gte: prefix, startsWith: prefix } }, select: { bodyNo: true, createdAt: true } })
          .then((rows) => rows.map((x) => ({ code: x.bodyNo, createdAt: x.createdAt }))), now, fmt));
      await assertNoFreeTx(tx, bodyNo);
      const r = await registerBeamBodyTx(tx, { bodyNo, clientToken: input.clientToken, owner, dims, status, place, notes: input.notes ?? null, machineIds, userId });
      return { ...r, bodyNo };
    });
    await AuditService.log({
      userId, action: "CREATE", tableName: BEAM_BODY_TABLE, recordId: out.bodyId,
      newData: { bodyNo: out.bodyNo, ...owner, status, ...place, widthCm: dims.widthCm?.toString() ?? null, flangeDiameterCm: dims.flangeDiameterCm?.toString() ?? null, tareKg: dims.tareKg?.toString() ?? null, machineIds },
    });
    await logBeamBodyEventAudit({ userId, eventId: out.eventId, kind: "REGISTER", data: { bodyId: out.bodyId, bodyNo: out.bodyNo, toStatus: status } });
    return { data: await loadBeamBodyDto(prisma, out.bodyId), replayed: false };
  });
}

/**
 * Düzenleme. Sahip değişimi yalnız gövde BOŞ ve BİZDE (EMPTY_STOCK) iken; pasife alma yalnız boş/terminal durumda.
 * Koşullar tek `updateMany WHERE` claim'inde (eşzamanlı geçişle yarışta biri 409 alır); uyum pivotu aynı tx'te REPLACE.
 */
export async function patchBeamBody(id: string, input: BeamBodyPatchInput, userId: string): Promise<BeamBodyDto> {
  await assertBeamBodyEnabled();
  const before = await loadBeamBodyDto(prisma, id);
  const owner = input.owner ? await resolveOwner(prisma, input.owner) : undefined;
  const machineIds = input.machineIds ? await assertMachines(prisma, input.machineIds) : undefined;
  const ownerChanges = owner !== undefined && (owner.ownerCustomerId !== (before.owner.customer?.id ?? null) || (owner.ownerRole ?? "OURS") !== before.owner.kind);
  const where: Prisma.BeamBodyWhereInput = { id };
  if (ownerChanges) Object.assign(where, { status: BeamBodyStatus.EMPTY_STOCK, isActive: true });
  if (input.isActive === false && before.isActive) Object.assign(where, ownerChanges ? {} : { status: { in: [...BEAM_BODY_DEACTIVATABLE_STATUSES] } });
  const data: Prisma.BeamBodyUncheckedUpdateManyInput = { updatedById: userId };
  if (ownerChanges) Object.assign(data, owner);
  if (input.widthCm !== undefined) data.widthCm = D(input.widthCm);
  if (input.flangeDiameterCm !== undefined) data.flangeDiameterCm = D(input.flangeDiameterCm);
  if (input.tareKg !== undefined) data.tareKg = D(input.tareKg);
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.beamBody.updateMany({ where, data });
    if (claim.count === 0) await explainPatchConflict(tx, id, ownerChanges);
    if (machineIds) {
      await tx.beamBodyMachine.deleteMany({ where: { bodyId: id } });
      if (machineIds.length > 0) await tx.beamBodyMachine.createMany({ data: machineIds.map((machineId) => ({ bodyId: id, machineId })) });
    }
  });
  const after = await loadBeamBodyDto(prisma, id);
  await AuditService.log({ userId, action: "UPDATE", tableName: BEAM_BODY_TABLE, recordId: id, oldData: auditShape(before), newData: auditShape(after) });
  return after;
}

async function explainPatchConflict(tx: Tx, id: string, ownerChanges: boolean): Promise<never> {
  const fresh = await tx.beamBody.findUnique({ where: { id }, select: { bodyNo: true, status: true, isActive: true } });
  if (!fresh) throw AppError.notFound("Levent gövdesi bulunamadı", { code: "BEAM_BODY_NOT_FOUND" });
  const statusLabel = BEAM_BODY_STATUS_LABELS[fresh.status];
  if (ownerChanges) throw AppError.conflict(`${fresh.bodyNo} şu an "${statusLabel}"${fresh.isActive ? "" : " ve pasif"} — sahip yalnız gövde depoda boşken değişir`, { code: "BEAM_BODY_BUSY", status: fresh.status });
  throw AppError.conflict(`${fresh.bodyNo} şu an "${statusLabel}" — gövde yalnız depoda boşken, hurdada ya da sahibine iade edilmişken pasife alınır`, { code: "BEAM_BODY_BUSY", status: fresh.status });
}

const auditShape = (b: BeamBodyDto) => ({
  ownerKind: b.owner.kind, ownerCustomerId: b.owner.customer?.id ?? null, widthCm: b.widthCm, flangeDiameterCm: b.flangeDiameterCm, tareKg: b.tareKg,
  notes: b.notes, isActive: b.isActive, machineIds: b.machineFits.map((m) => m.id),
});

export interface CancelRegistrationPreview {
  body: BeamBodyDto;
  cancellable: boolean;
  /** Engel varsa Türkçe neden; yoksa null. */
  blocker: string | null;
  laterEventCount: number;
}

async function laterEventCount(db: Tx | typeof prisma, bodyId: string): Promise<number> {
  return db.beamBodyEvent.count({ where: { bodyId, kind: { not: "REGISTER" }, NOT: { kind: "REGISTER_CANCEL" } } });
}

/** Önizleme (yazmaz): kayıt iptali yalnız gövdenin kayıttan sonra hiç hareketi yokken. */
export async function previewCancelBeamBodyRegistration(id: string): Promise<CancelRegistrationPreview> {
  await assertBeamBodyEnabled();
  const body = await loadBeamBodyDto(prisma, id);
  const later = await laterEventCount(prisma, id);
  const reg = await prisma.beamBodyEvent.findFirst({ where: { bodyId: id, kind: "REGISTER" }, select: { reversal: { select: { id: true } } } });
  const blocker = !body.isActive || reg?.reversal ? "Gövde kaydı zaten iptal edilmiş ya da gövde pasif"
    : later > 0 ? `Gövdenin kayıttan sonra ${later} hareketi var — kayıt iptal edilemez, gövdeyi pasife alın ya da hurdaya ayırın` : null;
  return { body, cancellable: blocker === null, blocker, laterEventCount: later };
}

/**
 * Yanlış açılmış kaydın ters yolu: REGISTER → REGISTER_CANCEL (kart pasif, durum/yer aynı). Claim önce (satır kilidi),
 * sonra "başka hareket yok" sayımı — eşzamanlı geçiş claim'de bekler ya da 409 alır.
 */
export async function cancelBeamBodyRegistration(id: string, reason: string, userId: string): Promise<BeamBodyDto> {
  await assertBeamBodyEnabled();
  const ev = await prisma.$transaction(async (tx) => {
    const reg = await tx.beamBodyEvent.findFirst({ where: { bodyId: id, kind: "REGISTER" }, select: { id: true } });
    const body = await tx.beamBody.findUnique({ where: { id }, select: { status: true, warehouseId: true, subcontractorId: true, machineId: true } });
    if (!reg || !body) throw AppError.notFound("Levent gövdesi bulunamadı", { code: "BEAM_BODY_NOT_FOUND" });
    // Ön sayım doğru hata kodu içindir (hareketli gövdede claim BEAM_BODY_STATE derdi); claim sonrası sayım yarışı kapatır.
    const earlier = await laterEventCount(tx, id);
    if (earlier > 0) throw AppError.conflict(`Gövdenin kayıttan sonra ${earlier} hareketi var — kayıt iptal edilemez`, { code: "BEAM_BODY_HAS_HISTORY", laterEventCount: earlier });
    const out = await reverseBeamBodyEventTx(tx, {
      eventId: reg.id, restore: { status: body.status, place: { warehouseId: body.warehouseId, subcontractorId: body.subcontractorId, machineId: body.machineId } },
      deactivate: true, reason, userId,
    });
    const later = await laterEventCount(tx, id);
    if (later > 0) throw AppError.conflict(`Gövdenin kayıttan sonra ${later} hareketi var — kayıt iptal edilemez`, { code: "BEAM_BODY_HAS_HISTORY", laterEventCount: later });
    return out;
  });
  await logBeamBodyEventAudit({ userId, eventId: ev.id, kind: "REGISTER_CANCEL", data: { bodyId: id, reason } });
  return loadBeamBodyDto(prisma, id);
}
