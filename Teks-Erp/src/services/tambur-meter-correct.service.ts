// =============================================================================
// TAMBUR KESİM METRESİ DÜZELTMESİ — süpervizör (D4-B2, DALGA4 §3.5 madde 5)
// =============================================================================
// Simüle (ya da yanlış) ölçülen kesim metresi faturaya girmez (K4); süpervizör okumayı düzeltir:
// eski CUT okuması DAMGALANIR (silinmez), yerine SUPERVISOR kaynaklı yeni CUT okuması yazılır.
// `Roll.initialQty` DEĞİŞMEZ — stok ayrı defterdir; düzeltme yalnız faturalanan metrenin kaynağıdır.
// Yazım `meter-reading.helper` boğazından (ikinci yazar yok); replay `token-replay.helper` K kipi.
// =============================================================================
import { MachineDataSource, MeterPhase, Prisma, type RollMeterReading } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { auditCutReadings, insertMeterReadingTx, stampMeterReadingsTx } from "./helpers/meter-reading.helper";
import { alreadyBilled, findActiveBillingTx } from "./helpers/service-billing-gate.helper";
import { tokenReplay } from "./helpers/token-replay.helper";

/** Damgalanan okumanın sebep öneki — ters yolu (`revokeReason`) okuyanlar düzeltmeyi ayırt eder. */
export const TAMBUR_METER_CORRECTION_REASON = "TAMBUR_METER_CORRECTION";

export interface CutCorrectionInput {
  meters: number;
  clientToken: string;
  reason: string;
}

export interface CutCorrectionResult {
  reading: RollMeterReading;
  correctedReadingId: string;
}

const canonical = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v).toFixed(3);

/** Yeni SUPERVISOR okumasının token'ı üzerinden replay politikası (kimlik = top · adım · faz · metre · kaynak). */
export function cutCorrectionReplay(expect: { rollId: string; stepId: string; meters: number; correctedReadingId: string }) {
  return tokenReplay<RollMeterReading, CutCorrectionResult>({
    find: (db, clientToken) => db.rollMeterReading.findUnique({ where: { clientToken } }),
    alive: (prior) => {
      if (prior.revokedAt) {
        throw AppError.conflict("Bu düzeltme sonradan yeniden düzeltildi ya da geri alındı — listeyi yenileyin", {
          code: "METER_READING_REVOKED",
          readingId: prior.id,
        });
      }
    },
    identity: (prior) => [
      { ad: "rollId", mevcut: prior.rollId, gelen: expect.rollId },
      { ad: "workOrderStepId", mevcut: prior.workOrderStepId, gelen: expect.stepId },
      { ad: "phase", mevcut: prior.phase, gelen: MeterPhase.CUT },
      { ad: "meters", mevcut: canonical(prior.meters), gelen: canonical(expect.meters) },
      { ad: "source", mevcut: prior.source, gelen: MachineDataSource.SUPERVISOR },
    ],
    collision: "Bu düzeltme kimliği başka bir top/metre için kullanılmış — formu yeniden açın",
    respond: (prior) => ({ reading: prior, correctedReadingId: expect.correctedReadingId }),
  });
}

/**
 * POST /api/tambur/meter-readings/:id/correct — yalnız CUT okuması. Sıra: 8036 (token) → okuma satırı FOR UPDATE
 * (fatura tarafı `lockServiceReadingsTx` ile aynı satırı kilitler) → fatura kapısı → atomik damga → yeni okuma.
 */
export async function correctCutReading(
  readingId: string,
  input: CutCorrectionInput,
  userId: string | undefined,
): Promise<ApiResponse<CutCorrectionResult>> {
  const target = await prisma.rollMeterReading.findUnique({
    where: { id: readingId },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, machineId: true },
  });
  if (!target) throw AppError.notFound("Metre okuması bulunamadı");
  if (target.phase !== MeterPhase.CUT) {
    throw AppError.badRequest("Yalnız Tambur kesim okuması bu uçtan düzeltilir", { code: "METER_READING_NOT_CUT" });
  }
  const replay = cutCorrectionReplay({ rollId: target.rollId, stepId: target.workOrderStepId, meters: input.meters, correctedReadingId: target.id });
  const reason = `${TAMBUR_METER_CORRECTION_REASON}: ${input.reason}`.slice(0, 300);

  const out = await prisma.$transaction(async (tx) => {
    const prior = await replay.inTx(tx, input.clientToken);
    if (prior) return { result: prior, written: false };
    await tx.$queryRaw`SELECT id FROM roll_meter_readings WHERE id = ${target.id}::uuid FOR UPDATE`;
    // Faturalı kesim metresi değişmez: okumaya bağlı ya da (okuma bağı öncesi) topun CUT bağı aktifse 409.
    const billed = await findActiveBillingTx(tx, { OR: [{ readingId: target.id }, { rollId: target.rollId, meterBasis: "CUT" }] });
    if (billed) throw alreadyBilled(billed.docNo);
    const stamp = { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: reason };
    const claimed = await stampMeterReadingsTx(tx, { id: target.id, revokedAt: null }, stamp);
    if (claimed === 0) {
      throw AppError.conflict("Bu okuma az önce düzeltildi ya da geri alındı — listeyi yenileyip tekrar deneyin", {
        code: "METER_READING_ALREADY_CORRECTED",
        readingId: target.id,
      });
    }
    const reading = await insertMeterReadingTx(tx, { data: {
      rollId: target.rollId,
      workOrderStepId: target.workOrderStepId,
      phase: MeterPhase.CUT,
      meters: new Prisma.Decimal(canonical(input.meters)),
      source: MachineDataSource.SUPERVISOR,
      machineId: target.machineId,
      clientToken: input.clientToken,
      createdById: userId ?? null,
    } });
    return { result: { reading, correctedReadingId: target.id }, written: true };
  });

  if (out.written) await auditCutReadings(userId, [out.result.reading], { ids: [target.id], reason });
  return { success: true, data: out.result, message: "Kesim metresi düzeltildi" };
}
