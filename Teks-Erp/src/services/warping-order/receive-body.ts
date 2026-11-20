// =============================================================================
// FASON DEVERE DÖNÜŞ KABULÜ — levent GÖVDESİ satırları (devere ek B3)
// =============================================================================
// Satır başına `beamBodyId` (okutulan gövde) ya da `newBody` (tanımsız gövde yerinde, sahibiyle). Kapı
// `devere.beamBodyMode`: OFF'ta gövde girdisi 403 (gövdesiz kabul bayt-aynı), REQUIRED'da gövdesiz satır 400.
// Doğrulama önizleme ve kabulde TEK fonksiyondan; gövde durumunu kabul değil sarım kancası (FILLED) yürütür.
// Müşteri gövdesindeki sarım emanet sahipliğini kalıtır; iplik başka müşterininse 409 OWNER_MISMATCH.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { readDevereBeamBodyMode } from "../system-setting.service";
import { BEAM_BODY_TABLE, assertBeamBodyEnabled, logBeamBodyEventAudit } from "../helpers/beam-body.helper";
import { assertBeamBodyMachines, normalizeBeamBodyNo, registerNewBeamBodyTx, resolveBeamBodyOwner, type BeamBodyOwnerInput } from "../beam-body/write";
import { BEAM_BODY_FULL_STATUSES, BEAM_BODY_STATUS_LABELS, type BeamBodyOwnerKind } from "../../constants/beam-body";
import { qtyText } from "../helpers/qty-text.helper";

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = (v: number | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

export interface WarpingReceiveNewBodyInput {
  /** Boşsa satırın `physicalBeamNo`su, o da boşsa seri (`LG-…`). */
  bodyNo?: string | null;
  owner: BeamBodyOwnerInput;
  widthCm?: number | null;
  flangeDiameterCm?: number | null;
  tareKg?: number | null;
  machineIds?: string[];
}
export interface WarpingReceiveBodyLine {
  physicalBeamNo?: string | null;
  beamBodyId?: string | null;
  newBody?: WarpingReceiveNewBodyInput | null;
}

/** Satırın çözülmüş gövdesi; gövdesiz satırda null. */
export interface ReceiveBodyPlan {
  idx: number;
  beamBodyId: string | null;
  bodyNo: string | null;
  ownerKind: BeamBodyOwnerKind;
  /** Sarıma yazılacak sahip (emanet kalıtımı sonrası). */
  warpOwnerCustomerId: string | null;
  tareKg: Prisma.Decimal | null;
  register: null | { manualNo: string | null; owner: { ownerCustomerId: string | null; ownerRole: BeamBodyOwnerRole | null }; dims: { widthCm: Prisma.Decimal | null; flangeDiameterCm: Prisma.Decimal | null; tareKg: Prisma.Decimal | null }; machineIds: string[] };
}

const hasBody = (l: WarpingReceiveBodyLine) => Boolean(l.beamBodyId || l.newBody);

/** Replay imzası: gövdeli satırda gövde no `physicalBeamNo`ya kopyalanır, imza bunu "#gövde" olarak sayar. */
export const receiveLinePhysicalSig = (l: WarpingReceiveBodyLine) => (hasBody(l) ? "#body" : l.physicalBeamNo?.trim() ?? "");

/**
 * Doğrulama + plan (yazmaz). Kabul tx'i içinde ve önizlemede aynı. Var olan gövde: aktif, boş (depoda ya da BU
 * deverecide); dolu 409 BEAM_BODY_BUSY, başka deverecide 409 BEAM_BODY_ELSEWHERE, bakım/hurda/iade 409 BEAM_BODY_STATE.
 */
export async function planReceiveBodies(
  db: Db,
  input: { lines: WarpingReceiveBodyLine[]; subcontractorId: string; lotOwnerCustomerId: string | null },
): Promise<Array<ReceiveBodyPlan | null>> {
  const any = input.lines.some(hasBody);
  if (any) await assertBeamBodyEnabled(db);
  const mode = await readDevereBeamBodyMode(db);
  if (mode === "REQUIRED") {
    const missing = input.lines.findIndex((l) => !hasBody(l));
    if (missing >= 0) throw AppError.badRequest(`${missing + 1}. satır: levent gövdesi okutulmalı ya da tanımlanmalı (ayar: gövde takibi zorunlu).`, { code: "BEAM_BODY_REQUIRED" });
  }
  if (!any) return input.lines.map(() => null);
  const seenIds = new Set<string>();
  const seenNos = new Set<string>();
  const out: Array<ReceiveBodyPlan | null> = [];
  for (const [idx, l] of input.lines.entries()) {
    const row = `${idx + 1}. satır`;
    if (l.beamBodyId && l.newBody) throw AppError.badRequest(`${row}: hem kayıtlı gövde hem yeni gövde verilmiş — birini seçin.`, { code: "BEAM_BODY_INPUT_AMBIGUOUS" });
    const physical = l.physicalBeamNo?.trim() || null;
    if (l.beamBodyId) {
      if (seenIds.has(l.beamBodyId)) throw AppError.badRequest(`${row}: aynı gövde bu kabulde iki kez okutulmuş.`, { code: "WARPING_RECEIVE_DUPLICATE_BODY" });
      seenIds.add(l.beamBodyId);
      const b = await db.beamBody.findUnique({
        where: { id: l.beamBodyId },
        select: { bodyNo: true, status: true, isActive: true, subcontractorId: true, ownerCustomerId: true, ownerRole: true, tareKg: true, subcontractor: { select: { name: true } } },
      });
      if (!b) throw AppError.notFound(`${row}: levent gövdesi bulunamadı.`, { code: "BEAM_BODY_NOT_FOUND" });
      if (!b.isActive) throw AppError.conflict(`${row}: ${b.bodyNo} pasif — kabulde kullanılamaz.`, { code: "BEAM_BODY_INACTIVE" });
      if (BEAM_BODY_FULL_STATUSES.includes(b.status)) throw AppError.conflict(`${row}: ${b.bodyNo} şu an "${BEAM_BODY_STATUS_LABELS[b.status]}" — dolu gövdeye ikinci sarım yazılamaz.`, { code: "BEAM_BODY_BUSY", status: b.status });
      if (b.status === BeamBodyStatus.AT_SUBCONTRACTOR && b.subcontractorId !== input.subcontractorId) {
        throw AppError.conflict(`${row}: ${b.bodyNo} başka bir deverecide görünüyor (${b.subcontractor?.name ?? "?"}) — önce gövdenin yerini düzeltin.`, { code: "BEAM_BODY_ELSEWHERE" });
      }
      if (b.status !== BeamBodyStatus.EMPTY_STOCK && b.status !== BeamBodyStatus.AT_SUBCONTRACTOR) {
        throw AppError.conflict(`${row}: ${b.bodyNo} şu an "${BEAM_BODY_STATUS_LABELS[b.status]}" — sarım kabul edilemez.`, { code: "BEAM_BODY_STATE", status: b.status });
      }
      if (physical && physical.toLowerCase() !== b.bodyNo.toLowerCase()) throw AppError.badRequest(`${row}: gövde no (${physical}) okutulan gövdeyle (${b.bodyNo}) aynı değil.`, { code: "BEAM_BODY_PHYSICAL_MISMATCH" });
      seenNos.add(b.bodyNo.toLowerCase());
      out.push({ idx, beamBodyId: l.beamBodyId, bodyNo: b.bodyNo, ownerKind: b.ownerRole ?? "OURS", warpOwnerCustomerId: inheritOwner(row, { bodyNo: b.bodyNo, role: b.ownerRole, owner: b.ownerCustomerId }, input.lotOwnerCustomerId), tareKg: b.tareKg, register: null });
      continue;
    }
    if (l.newBody) {
      const raw = l.newBody.bodyNo?.trim() || physical;
      const manualNo = raw ? normalizeBeamBodyNo(raw) : null;
      if (manualNo && physical && physical.toLowerCase() !== manualNo.toLowerCase()) throw AppError.badRequest(`${row}: gövde no (${physical}) yeni gövde no ile (${manualNo}) aynı değil.`, { code: "BEAM_BODY_PHYSICAL_MISMATCH" });
      if (manualNo) {
        if (seenNos.has(manualNo.toLowerCase())) throw AppError.badRequest(`${row}: ${manualNo} bu kabulde iki kez yazılmış.`, { code: "WARPING_RECEIVE_DUPLICATE_BODY" });
        seenNos.add(manualNo.toLowerCase());
        const taken = await db.beamBody.findFirst({ where: { bodyNo: { equals: manualNo, mode: "insensitive" } }, select: { bodyNo: true } });
        if (taken) throw AppError.conflict(`${row}: ${taken.bodyNo} numaralı gövde zaten kayıtlı — yeni tanım yerine okutun.`, { code: "BEAM_BODY_NO_TAKEN", bodyNo: taken.bodyNo });
      }
      const owner = await resolveBeamBodyOwner(db, l.newBody.owner);
      const machineIds = await assertBeamBodyMachines(db, l.newBody.machineIds ?? []);
      const dims = { widthCm: D(l.newBody.widthCm), flangeDiameterCm: D(l.newBody.flangeDiameterCm), tareKg: D(l.newBody.tareKg) };
      out.push({
        idx, beamBodyId: null, bodyNo: manualNo, ownerKind: owner.ownerRole ?? "OURS",
        warpOwnerCustomerId: inheritOwner(row, { bodyNo: manualNo ?? "Yeni gövde", role: owner.ownerRole, owner: owner.ownerCustomerId }, input.lotOwnerCustomerId),
        tareKg: dims.tareKg, register: { manualNo, owner, dims, machineIds },
      });
      continue;
    }
    out.push(null);
  }
  return out;
}

/** Emanet kalıtımı (K6): yalnız MÜŞTERİ gövdesi sarıma sahip verir; devereci/başka firma gövdesi vermez. */
function inheritOwner(row: string, body: { bodyNo: string; role: BeamBodyOwnerRole | null; owner: string | null }, lotOwner: string | null): string | null {
  const { bodyNo, role, owner: bodyOwner } = body;
  if (role !== BeamBodyOwnerRole.CUSTOMER) return lotOwner;
  if (lotOwner && lotOwner !== bodyOwner) {
    throw AppError.conflict(`${row}: ${bodyNo} bir müşterinin emanet gövdesi, iplik başka bir müşterinin — sarım iki sahipli olamaz.`, { code: "OWNER_MISMATCH" });
  }
  return bodyOwner;
}

/**
 * Yeni gövdeleri doğurur (sipariş claim'inden sonra; elle numaralar önce, sonra seri — kilit sırası belirlenimli).
 * Gövde devereciden geldiği için "Deverecide" doğar; dolu dönüşü sarım kancası (FILLED) yazar.
 */
export async function registerReceiveBodiesTx(tx: Tx, plans: Array<ReceiveBodyPlan | null>, subcontractorId: string, userId: string) {
  const fresh = plans.filter((p): p is ReceiveBodyPlan & { register: NonNullable<ReceiveBodyPlan["register"]> } => p?.register != null)
    .sort((a, b) => (a.register.manualNo ?? "￿").localeCompare(b.register.manualNo ?? "￿") || a.idx - b.idx);
  const registered: Array<{ bodyId: string; eventId: string; bodyNo: string; ownerRole: BeamBodyOwnerRole | null }> = [];
  for (const p of fresh) {
    const r = await registerNewBeamBodyTx(tx, {
      manualNo: p.register.manualNo, clientToken: null, owner: p.register.owner, dims: p.register.dims, status: BeamBodyStatus.AT_SUBCONTRACTOR,
      place: { warehouseId: null, subcontractorId, machineId: null }, notes: null, machineIds: p.register.machineIds, userId,
    });
    p.beamBodyId = r.bodyId;
    p.bodyNo = r.bodyNo;
    registered.push({ ...r, ownerRole: p.register.owner.ownerRole });
  }
  return registered;
}

/** Yerinde tanımlanan gövdelerin audit'i — tx DIŞINDA. */
export async function auditReceiveBodies(userId: string, subcontractorId: string, registered: Awaited<ReturnType<typeof registerReceiveBodiesTx>>) {
  for (const r of registered) {
    await AuditService.log({ userId, action: "CREATE", tableName: BEAM_BODY_TABLE, recordId: r.bodyId, newData: { bodyNo: r.bodyNo, ownerRole: r.ownerRole, status: BeamBodyStatus.AT_SUBCONTRACTOR, subcontractorId, source: "WARPING_RECEIVE" } });
    await logBeamBodyEventAudit({ userId, eventId: r.eventId, kind: "REGISTER", data: { bodyId: r.bodyId, bodyNo: r.bodyNo, toStatus: BeamBodyStatus.AT_SUBCONTRACTOR } });
  }
}

/** Darasız tartıda gövde darası bilgisi (F6 öncüsü): tüketimi değiştirmez, yalnız uyarı metni. */
export function bodyTareWarnings(beams: Array<{ idx: number; grossKg: Prisma.Decimal | null; tareKg: Prisma.Decimal | null; nominalKg: Prisma.Decimal }>, plans: Array<ReceiveBodyPlan | null>): string[] {
  const out: string[] = [];
  for (const b of beams) {
    const p = plans[b.idx];
    if (!b.grossKg || b.tareKg || !p?.tareKg) continue;
    const net = b.grossKg.minus(p.tareKg);
    out.push(`${b.idx + 1}. levent: dara yazılmadı — gövde darası ${qtyText(p.tareKg)} kg ile net ${qtyText(net)} kg, hesap ${qtyText(b.nominalKg)} kg (bilgi; tüketim hesaptan).`);
  }
  return out;
}
