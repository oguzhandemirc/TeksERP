// =============================================================================
// 4 puan muayene servisi (K4P-MOTOR, plan §4.1–§4.3)
// =============================================================================
// `createInspectionTx` muayenenin TEK yazarıdır (panel, KK1 doğuşu, ileride diğer konaklar).
// Önizleme aynı `evaluateInspection`ı çağırır — ikinci formül yok. Muayene DEFTERDİR: silinmez;
// düzeltme revizyon (`supersededAt` claim + yeni satır), iptal `voidedAt` damgasıdır.
// =============================================================================
import { Prisma, type FourPointSize, type InspectionPhase, type RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { computeFourPoint, FOUR_POINT_DEFAULTS, resolveBand, type ScoredDefect, pointsFor } from "./helpers/four-point.helper";
import {
  gradeMismatchOf, isUniqueOn, resolveFourPointRule, resolveInspectionPhase, resolveInspectionWidth, ruleSnapshotOf, toDec,
} from "./helpers/four-point-resolve.helper";
import { ACTIVE_INSPECTION_WHERE } from "./helpers/inspection-active.helper";
import { draftInspectionRoll, type DraftRollInput } from "./helpers/inspection-draft-roll.helper";
import { insertInspectionDefectsTx } from "./helpers/roll-defect.helper";
import { QUALITY_STEP_ERROR, STEP_QUALITY_SELECT, stationCanInspect } from "./helpers/quality-station.helper";
import { tokenReplay } from "./helpers/token-replay.helper";

type Tx = Prisma.TransactionClient;

export const INSPECTION_AUDIT_TABLE = "ROLL_INSPECTION";

export interface InspectionDefectInput {
  defectTypeId: string;
  sizeClass?: FourPointSize | null;
  startMeter?: Prisma.Decimal.Value | null;
}

/** Muayene edilecek topun hesaba giren alanları — KK1 doğuşu bunu kendi tx'inden verir. */
export const INSPECTION_ROLL_SELECT = {
  id: true, itemId: true, width: true, qualityGradeId: true, qualityGrade: true, currentQty: true, status: true, finalizedAt: true,
} satisfies Prisma.RollSelect;
export type InspectionRoll = Prisma.RollGetPayload<{ select: typeof INSPECTION_ROLL_SELECT }>;

export interface EvaluateInput {
  roll: InspectionRoll;
  defects: readonly InspectionDefectInput[];
  inspectedLengthM?: Prisma.Decimal.Value | null;
  manualWidthCm?: Prisma.Decimal.Value | null;
  stationId?: string | null;
  /** Yalnız önizleme: müşteri bilinen yüzeyde (sevk) müşteri seti; muayene yazımı fabrika setini kullanır. */
  customerId?: string | null;
}

export interface CreateInspectionInput extends Omit<EvaluateInput, "customerId"> {
  phase?: InspectionPhase | null;
  note?: string | null;
  deviceId?: string | null;
  userId: string;
  clientToken?: string | null;
  /** Revizyon: önceki satır (claim'i çağıran yapmış olmalı). */
  supersedes?: { id: string; revision: number; inspectedById: string; inspectedAt: Date } | null;
  reviseReason?: string | null;
}

const DEAD_FOR_INSPECTION: readonly RollStatus[] = ["CANCELLED"];

function bad(message: string, code: string, extra: Record<string, unknown> = {}): AppError {
  return AppError.badRequest(message, { code, ...extra });
}

/** Hesabın tek yolu: doğrula → puanla → tavan → skor → bant. YAZMAZ (önizleme de bunu çağırır). */
export async function evaluateInspection(db: Tx, input: EvaluateInput) {
  const { roll } = input;
  if (DEAD_FOR_INSPECTION.includes(roll.status)) {
    throw AppError.conflict("İptal edilmiş top muayene edilemez.", { code: "ROLL_NOT_INSPECTABLE" });
  }
  if (input.stationId) {
    const station = await db.station.findUnique({ where: { id: input.stationId }, select: STEP_QUALITY_SELECT });
    if (!station) throw bad("İstasyon bulunamadı.", "STATION_NOT_FOUND");
    if (!stationCanInspect(station)) throw bad(QUALITY_STEP_ERROR, "INSPECTION_STATION_NOT_CAPABLE");
  }

  const typeIds = [...new Set(input.defects.map((d) => d.defectTypeId))];
  // Pasif tür KABUL: dokunulduğu an aktifti ("gizlenmiş kod geçerli"); bilinmeyen kimlik 400.
  const types = typeIds.length > 0
    ? await db.defectType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, fixedPoints: true } })
    : [];
  const byId = new Map(types.map((t) => [t.id, t]));
  const unknown = typeIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw bad("Tanınmayan hata türü.", "UNKNOWN_DEFECT_TYPE", { defectTypeIds: unknown });

  const seen = new Set<string>();
  const scored: Array<ScoredDefect & { defectTypeId: string; errorType: string; sizeClass: FourPointSize | null }> = [];
  for (const d of input.defects) {
    const type = byId.get(d.defectTypeId)!;
    const meter = d.startMeter == null || d.startMeter === "" ? null : toDec(d.startMeter);
    if (d.startMeter != null && d.startMeter !== "" && (meter == null || meter.lt(0))) throw bad("Hata metresi geçersiz.", "INVALID_DEFECT_METER");
    if (meter != null) {
      const key = `${meter.toFixed(3)}|${d.defectTypeId}`;
      if (seen.has(key)) throw bad("Aynı metrede aynı hata türü iki kez girilmiş.", "DUPLICATE_DEFECT_IN_PAYLOAD", { startMeter: meter.toFixed(3) });
      seen.add(key);
    }
    const sizeClass = type.fixedPoints != null ? null : (d.sizeClass ?? null);
    const points = pointsFor(sizeClass, type.fixedPoints);
    if (points == null) throw bad(`"${type.name}" için hata boyutu seçilmeli.`, "DEFECT_SIZE_REQUIRED");
    scored.push({ defectTypeId: type.id, errorType: type.name, sizeClass, points, startMeter: meter });
  }

  const length = toDec(input.inspectedLengthM) ?? (roll.currentQty.gt(0) ? roll.currentQty : null);
  if (!length || length.lte(0)) throw bad("Muayene uzunluğu (metre) sıfırdan büyük olmalı.", "INSPECTION_LENGTH_REQUIRED");
  const manual = input.manualWidthCm == null ? null : toDec(input.manualWidthCm);
  if (input.manualWidthCm != null && (manual == null || manual.lte(0))) throw bad("Elle girilen en sıfırdan büyük olmalı.", "INVALID_WIDTH");

  const width = await resolveInspectionWidth(db, { itemId: roll.itemId, rollWidth: roll.width, manualWidthCm: manual });
  const rule = await resolveFourPointRule(db, { customerId: input.customerId ?? null, itemId: roll.itemId });
  const ruleParams = rule ?? FOUR_POINT_DEFAULTS;
  const result = computeFourPoint(scored, width.widthCm, length, ruleParams);
  const band = rule && result.gradeScore ? resolveBand(rule.bands, result.gradeScore) : null;
  const grade = band?.qualityGradeId
    ? await db.qualityGrade.findUnique({ where: { id: band.qualityGradeId }, select: { id: true, code: true, name: true } })
    : null;
  return { scored, length, width, rule, result, band, grade };
}

export type Evaluation = Awaited<ReturnType<typeof evaluateInspection>>;

/**
 * Muayenenin TEK yazarı. Çağıran tx'i ve (KK1'de) kilidi tutar; burada ek kilit yok.
 * Sıra: hesap → `RollInspection` → `RollError(origin=INSPECTION)` (`tx.*` sıralı; Promise.all yok).
 */
export async function createInspectionTx(tx: Tx, input: CreateInspectionInput) {
  const ev = await evaluateInspection(tx, input);
  const phase = input.phase ?? resolveInspectionPhase(input.roll);
  const prior = input.supersedes ?? null;
  const inspectedAt = prior?.inspectedAt ?? new Date();
  const inspectedById = prior?.inspectedById ?? input.userId;
  let created;
  try {
    created = await tx.rollInspection.create({
      data: {
        rollId: input.roll.id,
        phase,
        revision: prior ? prior.revision + 1 : 1,
        supersedesId: prior?.id ?? null,
        reviseReason: prior ? (input.reviseReason ?? null) : null,
        stationId: input.stationId ?? null,
        deviceId: input.deviceId ?? null,
        inspectedLengthM: ev.length,
        widthCm: ev.width.widthCm,
        widthSource: ev.width.widthSource,
        // Kayıtlı toplam = koşu tavanı SONRASI puan (skorun girdisi); ham toplam hatalardan türer.
        totalPoints: ev.result.cappedPoints,
        defectCount: ev.scored.length,
        unplacedDefectCount: ev.result.unplaced,
        pointsPer100M2: ev.result.pointsPer100M2,
        ruleSetId: ev.rule?.id ?? null,
        ruleSnapshot: ruleSnapshotOf(ev.rule),
        gradeScore: ev.result.gradeScore,
        suggestedQualityGradeId: ev.grade?.id ?? null,
        suggestedGradeCode: ev.grade?.code ?? null,
        gradeMismatch: gradeMismatchOf(input.roll, ev.grade),
        note: input.note?.trim() || null,
        inspectedById,
        inspectedAt,
        clientToken: input.clientToken ?? null,
      },
    });
  } catch (err) {
    // Token çakışması replay boğazına aittir (yeniden okur); aktif-tekil sed ise iş kuralıdır.
    if (isUniqueOn(err, "roll_inspections_one_active_uq") || (isUniqueOn(err, "rollId") && !isUniqueOn(err, "clientToken"))) {
      throw AppError.conflict("Bu topun bu aşamada aktif bir muayenesi zaten var; düzeltme için revize edin.", { code: "INSPECTION_ALREADY_ACTIVE" });
    }
    throw err;
  }
  // Satır basımı tek yazma boğazında (KQ-D7); köken orada INSPECTION'a sabitlenir, boş liste no-op.
  await insertInspectionDefectsTx(tx, ev.scored.map((d) => ({
    rollId: input.roll.id,
    startMeter: d.startMeter,
    defectTypeId: d.defectTypeId,
    errorType: d.errorType,
    sizeClass: d.sizeClass,
    points: d.points,
    inspectionId: created.id,
    detectedByUserId: inspectedById,
    detectedAt: inspectedAt,
  })));
  return created;
}

// ── Panel/tablet uçları ─────────────────────────────────────────────────────

async function loadRoll(db: Tx, rollId: string): Promise<InspectionRoll> {
  const roll = await db.roll.findUnique({ where: { id: rollId }, select: INSPECTION_ROLL_SELECT });
  if (!roll) throw AppError.notFound("Top bulunamadı.", { code: "ROLL_NOT_FOUND" });
  return roll;
}

/** `draft`: KK1 doğuşu — top henüz yok; kumaş + form eni, uzunluk `inspectedLengthM`ten (aynı motor, yazmaz). */
export interface PreviewInput extends Omit<EvaluateInput, "roll"> { rollId?: string; draft?: DraftRollInput }

export async function preview(input: PreviewInput) {
  const { draft, rollId, ...rest } = input;
  const roll = draft ? await draftInspectionRoll(prisma, draft) : await loadRoll(prisma, rollId ?? "");
  const ev = await evaluateInspection(prisma, { ...rest, roll });
  const unit = ev.rule?.unit ?? FOUR_POINT_DEFAULTS.unit;
  return {
    totalPoints: ev.result.totalPoints,
    cappedPoints: ev.result.cappedPoints,
    unplaced: ev.result.unplaced,
    widthCm: ev.width.widthCm,
    widthSource: ev.width.widthSource,
    pointsPer100M2: ev.result.pointsPer100M2,
    ruleSet: ev.rule ? { id: ev.rule.id, name: ev.rule.name, unit } : null,
    gradeScore: ev.result.gradeScore,
    suggested: ev.band
      ? { qualityGradeId: ev.grade?.id ?? null, code: ev.grade?.code ?? null, label: ev.band.label, accepted: ev.band.accepted }
      : null,
  };
}

export interface CreateBody extends Omit<CreateInspectionInput, "roll" | "userId" | "supersedes" | "reviseReason"> {
  rollId: string;
}

const RESPONSE_SELECT = {
  id: true, rollId: true, phase: true, revision: true, supersedesId: true, totalPoints: true, defectCount: true,
  unplacedDefectCount: true, pointsPer100M2: true, gradeScore: true, suggestedGradeCode: true, suggestedQualityGradeId: true,
  gradeMismatch: true, widthCm: true, widthSource: true, inspectedLengthM: true, inspectedAt: true, voidedAt: true,
  supersededAt: true, clientToken: true,
} satisfies Prisma.RollInspectionSelect;
type InspectionRow = Prisma.RollInspectionGetPayload<{ select: typeof RESPONSE_SELECT }>;

/** 4. durum: sonradan iptal edilmiş muayenenin token'ı başarı dönmez (revize edilmiş olan tarihtir, döner). */
const aliveInspection = (p: InspectionRow) => {
  if (p.voidedAt) throw AppError.conflict("Bu muayene sonradan iptal edilmiş; yeniden girin.", { code: "INSPECTION_VOIDED" });
};
const COLLISION = "Bu işlem kimliği başka bir muayeneye ait; formu yeniden açın.";

function createReplay(rollId: string, phase: InspectionPhase | null) {
  return tokenReplay<InspectionRow, InspectionRow>({
    find: (db, clientToken) => db.rollInspection.findUnique({ where: { clientToken }, select: RESPONSE_SELECT }),
    alive: aliveInspection,
    // Aşama gönderilmediyse topun durumundan türer — deneme kimliği top + (verildiyse) aşamadır.
    identity: (p) => [{ ad: "rollId", mevcut: p.rollId, gelen: rollId }, { ad: "phase", mevcut: phase ? p.phase : null, gelen: phase }],
    collision: COLLISION,
    respond: (p) => p,
  });
}

function reviseReplay(supersedesId: string) {
  return tokenReplay<InspectionRow, InspectionRow>({
    find: (db, clientToken) => db.rollInspection.findUnique({ where: { clientToken }, select: RESPONSE_SELECT }),
    alive: aliveInspection,
    identity: (p) => [{ ad: "supersedesId", mevcut: p.supersedesId, gelen: supersedesId }],
    collision: COLLISION,
    respond: (p) => p,
  });
}

function auditCounts(row: InspectionRow): Record<string, unknown> {
  return {
    rollId: row.rollId, phase: row.phase, revision: row.revision, defectCount: row.defectCount, totalPoints: row.totalPoints,
    pointsPer100M2: row.pointsPer100M2?.toFixed(2) ?? null, suggestedGradeCode: row.suggestedGradeCode, gradeMismatch: row.gradeMismatch,
  };
}

/** Panel/tablet yeni muayene (kâğıttan giriş dahil). İlk muayene (top, aşama) başına tek aktif. */
export async function create(body: CreateBody, userId: string) {
  const phaseIn = body.phase ?? null;
  return createReplay(body.rollId, phaseIn).run(body.clientToken, async () => {
    const row = await prisma.$transaction(async (tx) => {
      const roll = await loadRoll(tx, body.rollId);
      const phase = phaseIn ?? resolveInspectionPhase(roll);
      const active = await tx.rollInspection.findFirst({ where: { rollId: roll.id, phase, ...ACTIVE_INSPECTION_WHERE }, select: { id: true } });
      if (active) {
        throw AppError.conflict("Bu topun bu aşamada aktif bir muayenesi zaten var; düzeltme için revize edin.", { code: "INSPECTION_ALREADY_ACTIVE", inspectionId: active.id });
      }
      const c = await createInspectionTx(tx, { ...body, roll, phase, userId });
      return tx.rollInspection.findUniqueOrThrow({ where: { id: c.id }, select: RESPONSE_SELECT });
    });
    await AuditService.log({ userId, action: "CREATE", tableName: INSPECTION_AUDIT_TABLE, recordId: row.id, newData: auditCounts(row) });
    return row;
  });
}

export interface ReviseBody extends Omit<CreateBody, "rollId" | "phase"> {
  reviseReason: string;
}

/** Düzeltme: eskiyi atomik claim et (`supersededAt`), sonra `revision+1` yaz. Eski satır ve hataları yerinde kalır. */
export async function revise(id: string, body: ReviseBody, userId: string) {
  const reason = body.reviseReason?.trim() ?? "";
  if (reason.length < 3) throw bad("Düzeltme gerekçesi en az 3 karakter olmalı.", "REASON_REQUIRED");
  return reviseReplay(id).run(body.clientToken, async () => {
    const old = await prisma.rollInspection.findUnique({
      where: { id },
      select: { id: true, rollId: true, phase: true, revision: true, stationId: true, deviceId: true, inspectedById: true, inspectedAt: true },
    });
    if (!old) throw AppError.notFound("Muayene bulunamadı.", { code: "INSPECTION_NOT_FOUND" });
    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const claim = await tx.rollInspection.updateMany({
        where: { id, ...ACTIVE_INSPECTION_WHERE },
        data: { supersededAt: now, supersededById: userId },
      });
      if (claim.count === 0) throw AppError.conflict("Muayene artık aktif değil (revize ya da iptal edilmiş).", { code: "INSPECTION_NOT_ACTIVE" });
      const roll = await loadRoll(tx, old.rollId);
      const c = await createInspectionTx(tx, {
        ...body,
        roll,
        phase: old.phase,
        stationId: body.stationId ?? old.stationId,
        deviceId: body.deviceId ?? old.deviceId,
        userId,
        supersedes: old,
        reviseReason: reason,
      });
      return tx.rollInspection.findUniqueOrThrow({ where: { id: c.id }, select: RESPONSE_SELECT });
    });
    await AuditService.log({
      userId, action: "UPDATE", tableName: INSPECTION_AUDIT_TABLE, recordId: id,
      oldData: { revision: old.revision }, newData: { ...auditCounts(row), supersededById: row.id, reviseReason: reason },
    });
    return row;
  });
}

export async function voidPreview(id: string) {
  const row = await prisma.rollInspection.findUnique({
    where: { id },
    select: {
      id: true, phase: true, revision: true, totalPoints: true, defectCount: true, pointsPer100M2: true, suggestedGradeCode: true,
      inspectedAt: true, supersededAt: true, voidedAt: true, roll: { select: { id: true, barcode: true } },
    },
  });
  if (!row) throw AppError.notFound("Muayene bulunamadı.", { code: "INSPECTION_NOT_FOUND" });
  // Muayene raporu belgesi (RAPOR dilimi) inince bu muayeneyi basmış donmuş belge numaraları burada listelenir.
  const printedDocuments: string[] = [];
  return { inspection: row, defectCount: row.defectCount, printedDocuments, active: !row.supersededAt && !row.voidedAt };
}

export async function voidInspection(id: string, reason: string, userId: string) {
  const r = reason?.trim() ?? "";
  if (r.length < 3) throw bad("İptal gerekçesi en az 3 karakter olmalı.", "REASON_REQUIRED");
  const now = new Date();
  const claim = await prisma.rollInspection.updateMany({
    where: { id, ...ACTIVE_INSPECTION_WHERE },
    data: { voidedAt: now, voidedById: userId, voidReason: r },
  });
  if (claim.count === 0) {
    const exists = await prisma.rollInspection.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw AppError.notFound("Muayene bulunamadı.", { code: "INSPECTION_NOT_FOUND" });
    throw AppError.conflict("Muayene artık aktif değil (revize ya da iptal edilmiş).", { code: "INSPECTION_NOT_ACTIVE" });
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: INSPECTION_AUDIT_TABLE, recordId: id, oldData: { voidedAt: null }, newData: { voidedAt: now.toISOString(), voidReason: r } });
  return { id, voidedAt: now };
}

export { getInspection, listInspections } from "./quality-inspection-query.service";
