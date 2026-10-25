// =============================================================================
// RollError TEK YAZMA BOĞAZI (KQ-D7, plan §3.7)
// =============================================================================
// NEDEN: hata satırını üç yer ayrı kopyayla yazıyordu (KK2/Kurşun `reportError`,
// Tambur `reportError`, `kursunFinish` toplu yolu) ve kurallar (kalite kapısı,
// varsayılan tip, pasif tip, mükerrer 409) birbirinden kayıyordu. `src/` altında
// `rollError.create`/`createMany` YALNIZ bu dosyada durur; muayene satırlarını da
// (`origin=INSPECTION`) muayenenin tek yazarı `createInspectionTx` buradan basar.
// Audit tx DIŞINDA ve çağıranın işidir — helper `auditPayload` döner.
// Bekçi: `scripts/test_roll_defect_single_gateway.ts`.
// =============================================================================
import { Prisma, StationKind, type RollError } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { resolveDefaultDefectTypeTx } from "./default-defect-type.helper";
import { QUALITY_STEP_ERROR, STEP_QUALITY_SELECT, stepCanApplyQuality } from "./quality-station.helper";
import { ACTIONABLE_ROLL_ERROR_WHERE } from "./roll-error-scope.helper";

type Tx = Prisma.TransactionClient;

/** FLOW = ara istasyon kart akışı (KK2/Kurşun); TAMBUR = Tambur ekran ailesi. */
export type DefectStationGate = "FLOW" | "TAMBUR";

export const DUPLICATE_ROLL_ERROR = "DUPLICATE_ROLL_ERROR";

export function duplicateDefectError(startMeter: number, typeName: string, existingErrorId?: string): AppError {
  return AppError.conflict(`Bu metrede (${startMeter}) "${typeName}" hatası zaten kayıtlı`, {
    code: DUPLICATE_ROLL_ERROR,
    ...(existingErrorId ? { existingErrorId } : {}),
  });
}

/** Adım kapısı: istasyonda muayene açık olmalı; Tambur ucu ayrıca Tambur adımı ister. */
export async function assertDefectStepGate(tx: Tx, stepId: string, gate: DefectStationGate): Promise<void> {
  const step = await tx.workOrderStep.findUnique({
    where: { id: stepId },
    select: { station: { select: { kind: true, ...STEP_QUALITY_SELECT } } },
  });
  if (!step) throw AppError.notFound("Adım bulunamadı");
  // Tür kontrolü EKRAN AİLESİDİR (Tambur ucu yalnız Tambur adımına yazar); muayene sorusu ayrı.
  if (gate === "TAMBUR" && step.station.kind !== StationKind.TAMBUR) {
    throw AppError.badRequest("Bu adım Tambur tipinde değil");
  }
  if (!stepCanApplyQuality(step.station)) {
    throw AppError.badRequest(QUALITY_STEP_ERROR, { code: "QUALITY_STEP_ERROR" });
  }
}

interface DefectRowInput {
  startMeter: number;
  defectTypeId?: string | null;
}

export interface RecordRollDefectsInput {
  rollId: string;
  stepId: string;
  userId?: string | null;
  stationGate: DefectStationGate;
  defects: readonly DefectRowInput[];
  /** Metre üst sınırı; verilmezse topun güncel metrajı. */
  maxMeter?: number;
  /** Tekil yolda istemci kimliği (offline idempotency); PK çakışması çağırana bırakılır. */
  id?: string;
}

export interface DefectAuditPayload {
  rollId: string;
  stepId: string;
  defects: Array<{ startMeter: number; defectTypeId: string; errorType: string }>;
}

async function prepareDefectsTx(tx: Tx, input: RecordRollDefectsInput) {
  await assertDefectStepGate(tx, input.stepId, input.stationGate);
  const roll = await tx.roll.findUnique({ where: { id: input.rollId }, select: { currentStepId: true, currentQty: true, barcode: true } });
  if (!roll) throw AppError.notFound("Top bulunamadı");
  if (roll.currentStepId !== input.stepId) {
    throw AppError.badRequest(`Top (${roll.barcode ?? "barkodsuz"}) şu anda bu adımda değil`, { code: "ROLL_NOT_AT_STEP" });
  }
  const max = input.maxMeter ?? Number(roll.currentQty);
  for (const d of input.defects) {
    if (!(d.startMeter >= 0) || d.startMeter > max) {
      throw AppError.badRequest(`Hata metresi (${d.startMeter}) 0 ile ${max} arasında olmalı`, { code: "INVALID_DEFECT_METER" });
    }
  }
  // Tipsiz giriş kataloğun varsayılanına düşer; varsayılan yoksa 400 (kalite.md değişmezi).
  const rows = await resolveDefaultDefectTypeTx(tx, input.defects);
  const typeIds = [...new Set(rows.map((r) => r.defectTypeId))];
  const types = await tx.defectType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true, isActive: true } });
  const byId = new Map(types.map((t) => [t.id, t]));
  for (const id of typeIds) {
    const t = byId.get(id);
    if (!t) throw AppError.notFound("Hata tipi bulunamadı");
    if (!t.isActive) throw AppError.badRequest(`Hata tipi pasif durumda (${t.name}) — aktif bir tip seçin`, { code: "DEFECT_TYPE_INACTIVE" });
  }
  const seen = new Set<string>();
  const data = rows.map((r) => {
    const name = byId.get(r.defectTypeId)!.name;
    const key = `${r.startMeter}|${r.defectTypeId}`;
    if (seen.has(key)) throw duplicateDefectError(r.startMeter, name);
    seen.add(key);
    return { startMeter: r.startMeter, defectTypeId: r.defectTypeId, errorType: name };
  });
  // Sıralı çift-tık: açık ya da kapanmış aynı (top, metre, tip) — partial unique'in ön kontrolü.
  const existing = await tx.rollError.findFirst({
    where: { ...ACTIONABLE_ROLL_ERROR_WHERE, rollId: input.rollId, OR: data.map((d) => ({ startMeter: d.startMeter, defectTypeId: d.defectTypeId })) },
    select: { id: true, startMeter: true, errorType: true },
  });
  if (existing) throw duplicateDefectError(Number(existing.startMeter), existing.errorType ?? "", existing.id);
  return data;
}

function mapUniqueViolation(err: unknown, data: Array<{ startMeter: number; errorType: string }>, hasClientId: boolean): unknown {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return err;
  const target = JSON.stringify(err.meta ?? {}) + err.message;
  // PK çakışması = aynı istemci kimliğiyle yarışan replay; çağıran mevcut kaydı döner.
  if (hasClientId && !target.includes("roll_errors_roll_meter_defect_uq") && !target.includes("startMeter")) return err;
  return duplicateDefectError(data[0]?.startMeter ?? 0, data[0]?.errorType ?? "");
}

/** Tek hata satırı (KK2/Kurşun ve Tambur uçları). Çağıran tx'i ve gerekiyorsa claim'i tutar. */
export async function recordRollDefectTx(
  tx: Tx,
  input: Omit<RecordRollDefectsInput, "defects"> & { startMeter: number; defectTypeId?: string | null },
): Promise<{ error: RollError; auditPayload: DefectAuditPayload }> {
  const data = await prepareDefectsTx(tx, { ...input, defects: [{ startMeter: input.startMeter, defectTypeId: input.defectTypeId }] });
  const d = data[0];
  try {
    const error = await tx.rollError.create({
      data: {
        id: input.id,
        rollId: input.rollId,
        startMeter: d.startMeter,
        defectTypeId: d.defectTypeId,
        errorType: d.errorType, // snapshot — katalog adı değişse de sabit
        origin: "PROCESS",
        isProcessed: false,
        detectedAtStepId: input.stepId,
        detectedByUserId: input.userId ?? null,
      },
    });
    return { error, auditPayload: { rollId: input.rollId, stepId: input.stepId, defects: data } };
  } catch (e) {
    throw mapUniqueViolation(e, data, !!input.id);
  }
}

/** Çoğul yol (`kursunFinish`): aynı kurallar, tek `createMany`. */
export async function recordRollDefectsTx(
  tx: Tx,
  input: Omit<RecordRollDefectsInput, "id">,
): Promise<{ count: number; auditPayload: DefectAuditPayload }> {
  if (input.defects.length === 0) return { count: 0, auditPayload: { rollId: input.rollId, stepId: input.stepId, defects: [] } };
  const data = await prepareDefectsTx(tx, input);
  try {
    const res = await tx.rollError.createMany({
      data: data.map((d) => ({
        rollId: input.rollId,
        startMeter: d.startMeter,
        defectTypeId: d.defectTypeId,
        errorType: d.errorType,
        origin: "PROCESS" as const,
        detectedAtStepId: input.stepId,
        detectedByUserId: input.userId ?? null,
      })),
    });
    return { count: res.count, auditPayload: { rollId: input.rollId, stepId: input.stepId, defects: data } };
  } catch (e) {
    throw mapUniqueViolation(e, data, false);
  }
}

/**
 * Muayene satırları — YALNIZ `createInspectionTx` çağırır (muayenenin tek yazarı);
 * köken burada sabitlenir ki muayene satırı karar yoluna (PROCESS) sızmasın.
 */
export async function insertInspectionDefectsTx(
  tx: Tx,
  rows: ReadonlyArray<Omit<Prisma.RollErrorCreateManyInput, "origin" | "isProcessed">>,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.rollError.createMany({ data: rows.map((r) => ({ ...r, origin: "INSPECTION" as const })) });
}
