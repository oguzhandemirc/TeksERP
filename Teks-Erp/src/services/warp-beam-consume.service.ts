// =============================================================================
// TeksERP — Levent TÜKETİM · DÜZELTME · BİTİŞ · HURDA (devere Faz 3) + tüketim geri alma
// =============================================================================
// Kalan metre türetilir (§3.6); CONSUMED/ADJUST_OUT/EXHAUSTED kalanı eksiye DÜŞÜREMEZ (tek kapı
// `assertCoversRemaining`, 1e ③). EXHAUSTED/SCRAPPED terminal; ölçülen artık ≠ türetilen kalan ise
// fark önce CONSUMED/ADJUST_IN ile kapanır (§4.7). Sebep kodları katalogdan (WARP_BEAM_ADJUST /
// WARP_BEAM_SCRAP — SCRAPPED'da zorunlu, EXHAUSTED'da opsiyonel; 1e H2).
// =============================================================================
import { Prisma, ReasonPresetKind, WarpBeamStatus, type WarpLengthSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "./helpers/warp-beam-event.helper";
import { assertDismountAllowedTx, assertMountTrackingOnTx, warpLengthFromWeight } from "./helpers/warp-beam-mount.helper";
import { assertCoversRemaining, BEAM_TERMINAL, closeToMeasuredTx, loadBeamTx, positiveM, remainingMTx } from "./helpers/warp-beam-ledger.helper";
import { freshBeamDto } from "./warp-beam-mount.service";
import type { WarpBeamDto } from "./warp-beam.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

async function assertReasonTx(tx: Prisma.TransactionClient, kind: ReasonPresetKind, code: string | null | undefined, required: boolean): Promise<string | null> {
  const trimmed = code?.trim() || null;
  if (!trimmed) {
    if (required) throw AppError.badRequest("Sebep kodu zorunlu", { code: "REASON_CODE_REQUIRED", kind });
    return null;
  }
  const row = await tx.reasonPreset.findFirst({ where: { kind, code: trimmed, isActive: true }, select: { code: true } });
  if (!row) throw AppError.badRequest(`Geçersiz sebep kodu: ${trimmed} (${kind})`, { code: "REASON_CODE_INVALID", kind });
  return row.code;
}

function liveOrThrow(beam: { beamNo: string; status: WarpBeamStatus }): void {
  if (beam.status !== WarpBeamStatus.READY && beam.status !== WarpBeamStatus.MOUNTED) {
    throw AppError.conflict(`${beam.beamNo} durumu ${beam.status} — bu işlem yalnız hazır ya da tezgahtaki levente yapılır${BEAM_TERMINAL.has(beam.status) ? " (terminal)" : ""}`, { code: "WARP_BEAM_STATE", status: beam.status });
  }
}

export interface ConsumeInput {
  lengthM: number | string;
  lengthSource: WarpLengthSource;
  machineCounter?: number | string | null;
  fabricLengthM?: number | string | null;
  grossKg?: number | string | null;
  tareKg?: number | string | null;
  reason?: string | null;
  clientToken?: string | null;
}

/** Elle tüketim (CONSUMED) — READY ya da MOUNTED; kalanı aşamaz. Faz 4'te top çıkışından otomatik. */
export async function consumeBeam(id: string, input: ConsumeInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  if (input.clientToken) {
    const seen = await prisma.warpBeamEvent.findUnique({ where: { clientToken: input.clientToken }, select: { beamId: true, kind: true } });
    if (seen && seen.beamId === id && seen.kind === "CONSUMED") return { success: true, data: await freshBeamDto(id), message: "Tüketim zaten kayıtlı (yeniden gönderim)" };
    if (seen) throw AppError.conflict("Bu istemci anahtarı başka bir olaya ait", { code: "CLIENT_TOKEN_COLLISION" });
  }
  const lengthM = positiveM(input.lengthM, "Tüketilen metre");
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    liveOrThrow(beam);
    const remaining = await remainingMTx(tx, beam.id);
    assertCoversRemaining(beam.beamNo, remaining, lengthM, "tüketim");
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind: "CONSUMED",
      from: beam.status,
      to: beam.status,
      data: {
        clientToken: input.clientToken ?? null,
        lengthM,
        lengthSource: input.lengthSource,
        machineId: beam.currentMachineId,
        machineCounter: input.machineCounter == null ? null : D(input.machineCounter),
        fabricLengthM: input.fabricLengthM == null ? null : D(input.fabricLengthM),
        grossKg: input.grossKg == null ? null : D(input.grossKg),
        tareKg: input.tareKg == null ? null : D(input.tareKg),
        reason: input.reason?.trim() || null,
        createdById: userId ?? null,
      },
    });
    return { ev, beamNo: beam.beamNo, left: remaining.minus(lengthM) };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "CONSUMED", data: { beamId: id, lengthM: Number(lengthM), lengthSource: input.lengthSource } });
  return { success: true, data: await freshBeamDto(id), message: `${result.beamNo}: ${lengthM} m tüketildi — kalan ${result.left} m` };
}

export interface AdjustInput {
  direction: "IN" | "OUT";
  lengthM: number | string;
  reasonCode: string;
  reason?: string | null;
  lengthSource?: WarpLengthSource | null;
}

/** Kalan düzeltmesi — sebep ZORUNLU (`WARP_BEAM_ADJUST`); yanlış düzeltme silinmez, karşı düzeltmeyle kapanır. */
export async function adjustBeam(id: string, input: AdjustInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const lengthM = positiveM(input.lengthM, "Düzeltme metresi");
  const kind = input.direction === "IN" ? "ADJUST_IN" : "ADJUST_OUT";
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    liveOrThrow(beam);
    const reasonCode = await assertReasonTx(tx, ReasonPresetKind.WARP_BEAM_ADJUST, input.reasonCode, true);
    if (kind === "ADJUST_OUT") assertCoversRemaining(beam.beamNo, await remainingMTx(tx, beam.id), lengthM, "düzeltme (−)");
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind,
      from: beam.status,
      to: beam.status,
      data: { lengthM, reasonCode, reason: input.reason?.trim() || null, lengthSource: input.lengthSource ?? null, machineId: beam.currentMachineId, createdById: userId ?? null },
    });
    return { ev, beamNo: beam.beamNo };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind, data: { beamId: id, lengthM: Number(lengthM), reasonCode: input.reasonCode } });
  return { success: true, data: await freshBeamDto(id), message: `${result.beamNo}: kalan ${input.direction === "IN" ? "+" : "−"}${lengthM} m düzeltildi` };
}

export interface ExhaustInput {
  /** Ölçülen artık (levent dibi); yoksa tartıdan (gross/tare) türetilir; ikisi de yoksa artık 0 sayılır (ESTIMATED). */
  residualM?: number | string | null;
  grossKg?: number | string | null;
  tareKg?: number | string | null;
  lengthSource?: WarpLengthSource | null;
  /** Dispozisyon (WARP_BEAM_SCRAP kataloğu) — opsiyonel. */
  reasonCode?: string | null;
  reason?: string | null;
  machineCounter?: number | string | null;
}

/** BİTİŞ (EXHAUSTED, terminal): artık ≠ türetilen kalan → fark CONSUMED/ADJUST_IN; sonra EXHAUSTED(lengthM = artık) ⇒ kalan 0. */
export async function exhaustBeam(id: string, input: ExhaustInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    liveOrThrow(beam);
    const reasonCode = await assertReasonTx(tx, ReasonPresetKind.WARP_BEAM_SCRAP, input.reasonCode, false);
    let warnings: string[] = [];
    if (beam.status === WarpBeamStatus.MOUNTED && beam.currentMachineId) {
      const m = await tx.machine.findUniqueOrThrow({ where: { id: beam.currentMachineId }, select: { id: true, code: true, warpBeamSlots: true } });
      warnings = await assertDismountAllowedTx(tx, m, beam.beamNo);
    }
    // Artık: beyan > tartı > 0 (ESTIMATED). Tartıda dara yoksa metre türetilemez → ESTIMATED 0 + uyarı (#13).
    let source: WarpLengthSource = input.lengthSource ?? "ESTIMATED";
    let residual: Prisma.Decimal;
    if (input.residualM != null) {
      residual = D(input.residualM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
      if (residual.lt(0)) throw AppError.badRequest("Artık negatif olamaz");
    } else if (input.grossKg != null) {
      const w = warpLengthFromWeight(input.grossKg, input.tareKg ?? null, beam.warpSpec.endsCount, beam.warpSpec.yarnItem.linearDensityDen);
      if (w) {
        residual = w;
        source = "WEIGHED";
      } else {
        residual = D(0);
        source = "ESTIMATED";
        warnings.push("Dara (ya da denye) bilinmediği için tartıdan metre türetilemedi — artık 0 sayıldı; artığı elle girebilirsiniz.");
      }
    } else {
      residual = D(0);
    }
    const closed = await closeToMeasuredTx(tx, beam, residual, { lengthSource: source, machineCounter: input.machineCounter ?? null, grossKg: input.grossKg ?? null, tareKg: input.tareKg ?? null, userId, reason: "Bitiş öncesi ölçülen artığa kapatma" });
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind: "EXHAUSTED",
      from: beam.status,
      to: WarpBeamStatus.EXHAUSTED,
      whereMachineId: beam.currentMachineId,
      place: { currentMachineId: null, currentPosition: null },
      // Söküm gibi makine + yuvayı KOPYALAR (EXHAUST_CANCEL yuvaya geri koyar); artık 0 ise lengthM null (CHECK > 0).
      data: { lengthM: residual.gt(0) ? residual : null, lengthSource: source, machineId: beam.currentMachineId, mountPosition: beam.currentPosition, grossKg: input.grossKg == null ? null : D(input.grossKg), tareKg: input.tareKg == null ? null : D(input.tareKg), reasonCode, reason: input.reason?.trim() || null, createdById: userId ?? null },
    });
    return { ev, beamNo: beam.beamNo, residual, closed, warnings };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "EXHAUSTED", data: { beamId: id, residualM: Number(result.residual), closed: result.closed.kind, reasonCode: input.reasonCode ?? null } });
  return { success: true, data: await freshBeamDto(id), message: `${result.beamNo} bitti — artık ${result.residual} m${result.closed.kind ? ` (${result.closed.kind} ${result.closed.deltaM.abs()} m ile kapatıldı)` : ""}`, ...(result.warnings.length ? { warnings: result.warnings } : {}) };
}

export interface ScrapPreviewDto {
  beamNo: string;
  status: WarpBeamStatus;
  remainingM: number;
  currentMachine: { id: string; code: string; name: string } | null;
  currentPosition: number | null;
  openRunsOnMachine: number;
}

export async function scrapPreview(id: string): Promise<ApiResponse<ScrapPreviewDto>> {
  const beam = await prisma.warpBeam.findUnique({ where: { id }, select: { beamNo: true, status: true, currentPosition: true, currentMachine: { select: { id: true, code: true, name: true } } } });
  if (!beam) throw AppError.notFound("Levent bulunamadı");
  const openRuns = beam.currentMachine ? await prisma.machineRun.count({ where: { machineId: beam.currentMachine.id, endedAt: null, revokedAt: null } }) : 0;
  return { success: true, data: { beamNo: beam.beamNo, status: beam.status, remainingM: Number(await remainingMTx(prisma, id)), currentMachine: beam.currentMachine, currentPosition: beam.currentPosition, openRunsOnMachine: openRuns } };
}

/** HURDA (SCRAPPED, terminal): lengthM = kalan; sebep ZORUNLU (`WARP_BEAM_SCRAP`); tezgahtaysa yuva boşalır (koşum kapısı). */
export async function scrapBeam(id: string, input: { reasonCode: string; reason?: string | null }, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    liveOrThrow(beam);
    const reasonCode = await assertReasonTx(tx, ReasonPresetKind.WARP_BEAM_SCRAP, input.reasonCode, true);
    let warnings: string[] = [];
    if (beam.status === WarpBeamStatus.MOUNTED && beam.currentMachineId) {
      const m = await tx.machine.findUniqueOrThrow({ where: { id: beam.currentMachineId }, select: { id: true, code: true, warpBeamSlots: true } });
      warnings = await assertDismountAllowedTx(tx, m, beam.beamNo);
    }
    const remaining = await remainingMTx(tx, beam.id);
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind: "SCRAPPED",
      from: beam.status,
      to: WarpBeamStatus.SCRAPPED,
      whereMachineId: beam.currentMachineId,
      place: { currentMachineId: null, currentPosition: null },
      data: { lengthM: remaining.gt(0) ? remaining : null, machineId: beam.currentMachineId, mountPosition: beam.currentPosition, reasonCode, reason: input.reason?.trim() || null, createdById: userId ?? null },
    });
    return { ev, beamNo: beam.beamNo, remaining, warnings };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "SCRAPPED", data: { beamId: id, lengthM: Number(result.remaining), reasonCode: input.reasonCode } });
  return { success: true, data: await freshBeamDto(id), message: `${result.beamNo} hurdaya ayrıldı — ${result.remaining} m fire`, ...(result.warnings.length ? { warnings: result.warnings } : {}) };
}

/** Tüketim geri alma — LIFO'ya girmez (durum değiştirmez); satır silinmez, `CONSUMED_CANCEL` ters bağla. */
export async function cancelConsumed(id: string, eventId: string, reason: string, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("Gerekçe en az 3 karakter");
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    liveOrThrow(beam);
    const ev0 = await tx.warpBeamEvent.findUnique({ where: { id: eventId }, select: { id: true, beamId: true, kind: true, lengthM: true, reversal: { select: { id: true } } } });
    if (!ev0 || ev0.beamId !== beam.id || ev0.kind !== "CONSUMED") throw AppError.badRequest("Geri alınacak tüketim satırı bulunamadı", { code: "WARP_BEAM_EVENT_NOT_FOUND" });
    if (ev0.reversal) throw AppError.conflict("Bu tüketim zaten geri alınmış", { code: "WARP_BEAM_ALREADY_CANCELLED" });
    const ev = await applyWarpBeamEventTx(tx, { beamId: beam.id, kind: "CONSUMED_CANCEL", from: beam.status, to: beam.status, data: { reversesEventId: ev0.id, lengthM: ev0.lengthM, machineId: beam.currentMachineId, reason: why, createdById: userId ?? null } });
    return { ev, beamNo: beam.beamNo, lengthM: ev0.lengthM };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "CONSUMED_CANCEL", data: { beamId: id, reversesEventId: eventId, reason: why } });
  return { success: true, data: await freshBeamDto(id), message: `${result.beamNo}: ${result.lengthM} m tüketim geri alındı` };
}
