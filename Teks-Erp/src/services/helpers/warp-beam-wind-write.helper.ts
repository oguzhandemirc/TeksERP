// =============================================================================
// TeksERP — Levent SARIM yazımı (WOUND satırı + iplik payı) ve sarım yanıtı — `warp-beam-wind.service`in yazım kolu
// =============================================================================
// Raşel takımında (#23) aynı tx'te N kez çağrılır; tek leventte 1 kez. Kural/kapılar serviste, burada yalnız yazım.
// =============================================================================
import { Prisma, ReasonPresetKind, WarpBeamStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { readDevereLotRequired } from "../system-setting.service";
import { applyYarnMovementTx } from "../yarn.service";
import { WARP_BEAM_SELECT } from "./warp-beam.helper";
import { applyWarpBeamEventTx } from "./warp-beam-event.helper";
import { toWarpBeamDto, type WarpBeamDto } from "./warp-beam-dto.helper";
import type { WindWarpBeamInput, YarnIssueLine, YarnReturnLine } from "../warp-beam-wind.service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export function kg(v: number | string, ad: string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest(`${ad} sıfırdan büyük olmalı`);
  return d;
}

export async function assertReturnReasonTx(tx: Prisma.TransactionClient, code: string): Promise<string> {
  const trimmed = code.trim();
  const row = await tx.reasonPreset.findFirst({ where: { kind: ReasonPresetKind.WARP_RETURN, code: trimmed, isActive: true }, select: { code: true } });
  if (!row) throw AppError.badRequest(`Geçersiz dip iade sebebi: ${trimmed}`, { code: "REASON_CODE_INVALID" });
  return row.code;
}

/** Sarım yanıtı: ilk levent + (N adet) kardeşleri — her kardeş bağımsız levent (kendi WOUND/tüketim/iptal). */
export type WindResultDto = WarpBeamDto & { siblings: Array<{ id: string; beamNo: string }> };

export async function siblingsOf(setKey: string | null, firstId: string): Promise<Array<{ id: string; beamNo: string }>> {
  if (!setKey) return [];
  return prisma.warpBeam.findMany({ where: { setKey, id: { not: firstId } }, orderBy: { beamNo: "asc" }, select: { id: true, beamNo: true } });
}

export async function windResult(firstId: string, setKey: string | null, message: string, warnings: string[]): Promise<ApiResponse<WindResultDto>> {
  const fresh = await prisma.warpBeam.findUniqueOrThrow({ where: { id: firstId }, select: WARP_BEAM_SELECT });
  return { success: true, data: { ...toWarpBeamDto(fresh), siblings: await siblingsOf(setKey, firstId) }, message, ...(warnings.length ? { warnings } : {}) };
}

/** Bir leventin WOUND satırı + iplik payı (tek tx içinde; takımda N kez). */
export async function writeWoundTx(tx: Prisma.TransactionClient, target: { id: string; endsCount: number }, ctx: { input: WindWarpBeamInput; lengthM: Prisma.Decimal; denier: Prisma.Decimal.Value; theoreticalKg: Prisma.Decimal; yarnItemId: string; userId?: string; clientToken: string | null }, lines: { issues: YarnIssueLine[]; returns: YarnReturnLine[] }) {
  const { issues, returns } = lines;
  const ev = await applyWarpBeamEventTx(tx, {
    beamId: target.id,
    kind: "WOUND",
    from: WarpBeamStatus.PLANNED,
    to: WarpBeamStatus.READY,
    data: {
      clientToken: ctx.clientToken,
      dispatchItemId: ctx.input.dispatchItemId ?? null,
      lengthM: ctx.lengthM,
      machineId: ctx.input.machineId ?? null,
      endsCount: target.endsCount,
      denier: ctx.denier,
      theoreticalKg: ctx.theoreticalKg,
      kgSource: ctx.input.kgSource,
      sectionCount: ctx.input.sectionCount ?? null,
      endsPerSection: ctx.input.endsPerSection ?? null,
      breakCount: ctx.input.breakCount ?? null,
      startedAt: ctx.input.startedAt ?? null,
      createdById: ctx.userId ?? null,
    },
  });
  for (const line of issues) {
    await applyYarnMovementTx(tx, { itemId: ctx.yarnItemId, warehouseId: line.warehouseId, kind: YarnMovementKind.WARP_ISSUE, qtyKg: kg(line.qtyKg, "İplik çıkış kg"), warpBeamId: target.id, lotId: line.lotId ?? null, userId: ctx.userId ?? null });
  }

  for (const line of returns) {
    const reasonCode = await assertReturnReasonTx(tx, line.reasonCode);
    await applyYarnMovementTx(tx, { itemId: ctx.yarnItemId, warehouseId: line.warehouseId, kind: YarnMovementKind.WARP_RETURN, qtyKg: kg(line.qtyKg, "Dip iade kg"), warpBeamId: target.id, reasonCode, lotId: line.lotId ?? null, userId: ctx.userId ?? null });
  }
  return ev;
}

/** LOT (Faz 2, §3.5) — lot ZORUNLU DEĞİL; lotsuz/karışık lot uyarı; `devere.lotRequired` açıksa lotsuz 400. */
export async function lotWarnings(issuesSorted: YarnIssueLine[], returnsSorted: YarnReturnLine[]): Promise<string[]> {
  const warnings: string[] = [];
  const lotsuz = issuesSorted.filter((l) => !l.lotId).length;
  if (lotsuz > 0 && (await readDevereLotRequired())) {
    throw AppError.badRequest(`İplik çıkış satırında lot zorunlu (ayar: "Devere — lot zorunlu"): ${lotsuz} satır lotsuz.`, { code: "YARN_LOT_REQUIRED" });
  }
  const lotlar = new Set(issuesSorted.map((l) => l.lotId).filter((x): x is string => !!x));
  if (lotsuz > 0 && lotlar.size > 0) warnings.push(`${lotsuz} iplik çıkış satırı lotsuz — levent lot izi eksik kalır.`);
  else if (lotsuz > 0) warnings.push("İplik çıkışı lotsuz — bu levent lot izlemesine girmez (lotsuz sarılan levent lotsuz kalır).");
  if (lotlar.size > 1) warnings.push(`Levente ${lotlar.size} farklı iplik lotu yüklendi — levent içi lot farkı boyuna çözgü yolu üretebilir.`);
  const iadeDisi = returnsSorted.filter((l) => l.lotId && !lotlar.has(l.lotId)).length;
  if (iadeDisi > 0) warnings.push(`${iadeDisi} dip iadesi satırı bu leventin çıkış lotlarından olmayan bir lotu taşıyor.`);
  return warnings;
}

