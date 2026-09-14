// =============================================================================
// TeksERP — VARDİYA KARNESİ yazma: materyalizasyon (M2) · elle düzeltme (M3) · mühür (M4) ·
// mühür açma (M5) — DOKUMA-RAPOR-BACKEND-TASARIM-OZETI §4, §6
// =============================================================================
// • KARNE (`MachineShiftStat`) DURUM'dur: güncel gerçek bu satır; her mühür adımı
//   `MachineShiftStatSeal` DEFTERİNE satır, kırılım `MachineShiftStopBreakdown`a YENİ KUŞAK.
// • Mühür/açma ATOMİK CLAIM: `updateMany WHERE { id, sealState: <beklenen> }`, count 0 →
//   taze okuma → 409 (`SHIFT_SEAL_RACE` / `SHIFT_NOT_SEALED`). `sealedAt` HİÇBİR yolda
//   null'lanmaz ("en son ne zaman"); `sealGeneration` her mühürde +1.
// • M2 yalnız OPEN ∧ `source ≠ SUPERVISOR` satırı yeniden hesaplar — amirin elle düzelttiği
//   terimler (M3) job tarafından ezilmez; mühürlü satıra dokunmaz. Job MÜHÜRLEMEZ (Faz 2 kararı).
// • Mühür STORED terimleri mühürler (M3 düzeltmesi dahil); kırılım duruş defterinden
//   yeniden türetilir (kırılım elle düzenlenmez), etiket KOPYA (katalog değişse rapor değişmez).
// • HAT KIRILIMI (`MachineShiftLineStat`, çocuk DURUM): M2 ebeveynle aynı tx'te upsert eder
//   (yalnız `productionLineCount > 1` makinede satır doğar — helper `lines: []` verirse yazım yok);
//   M3 dokunmaz; mühür ebeveynle atomiktir, fotoğrafı Seal `terms.lines`e girer; silme YOK.
// • Audit best-effort, tx DIŞINDA (`MACHINE_SHIFT_STAT` / `MACHINE_SHIFT_SEAL`).
// =============================================================================
import { MachineSealAction, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";
import { computeShiftTerms } from "./machine-shift-stat.service";
import { computeMachineKpis, type LoomKpis } from "./helpers/loom-efficiency.helper";
import type { ShiftBreakdownRow, ShiftLineTerms, ShiftTerms } from "./helpers/loom-shift-terms.helper";

type Tx = Prisma.TransactionClient;
const TABLE = "MACHINE_SHIFT_STAT";
const SEAL_TABLE = "MACHINE_SHIFT_SEAL";

/** Terimlerin DB'ye yazılan kısmı (kırılım/uyarı/bayrak/hat hariç — hat çocuk tabloya). */
type TermColumns = Omit<ShiftTerms, "breakdown" | "warnings" | "emptyLoom" | "runCount" | "lines">;
function termColumns(t: ShiftTerms): TermColumns {
  const { breakdown: _b, warnings: _w, emptyLoom: _e, runCount: _r, lines: _l, ...cols } = t;
  return cols;
}

/** Hat satırları upsert — (statId, productionLineNo) anahtarıyla; kümede olmayan eski satır SİLİNMEZ (sıfır kalır). */
async function upsertLineStatsTx(tx: Tx, statId: string, lines: ShiftLineTerms[]): Promise<void> {
  for (const { productionLineNo, ...cols } of lines) {
    await tx.machineShiftLineStat.upsert({
      where: { statId_productionLineNo: { statId, productionLineNo } },
      create: { statId, productionLineNo, ...cols },
      update: cols,
    });
  }
}
type StoredStat = Prisma.MachineShiftStatGetPayload<Record<string, never>>;
const kpiInput = (s: StoredStat) => ({
  potSec: s.potSec, aptSec: s.aptSec, unitsActual: s.unitsActual, gapUnits: s.gapUnits,
  targetUnitCapacityApt: s.targetUnitCapacityApt, targetUnitCapacityPot: s.targetUnitCapacityPot,
});

export type MaterializeOutcome = "created" | "recomputed" | "skipped-sealed" | "skipped-supervisor";

/**
 * M2 — bir (makine × vardiya) karnesini yazar: satır yoksa OPEN doğar, OPEN ∧ makine/operatör
 * kaynaklıysa yeniden hesaplanır, SUPERVISOR (elle düzeltilmiş) ya da SEALED ise dokunulmaz.
 * `factoryDay` = `ShiftInstance.factoryDayKey` KOPYASI (tek yazar burası).
 */
export async function materializeShiftStatTx(tx: Tx, machineId: string, shiftInstanceId: string, now = new Date()): Promise<MaterializeOutcome> {
  const existing = await tx.machineShiftStat.findUnique({
    where: { machineId_shiftInstanceId: { machineId, shiftInstanceId } },
    select: { id: true, sealState: true, source: true },
  });
  if (existing?.sealState === "SEALED") return "skipped-sealed";
  if (existing?.source === "SUPERVISOR") return "skipped-supervisor";
  const terms = await computeShiftTerms(tx, machineId, shiftInstanceId, { now });
  if (existing) {
    // Claim: satır bu arada mühürlendiyse (yarış) yazma — hat satırları da claim'in ARKASINDA.
    const r = await tx.machineShiftStat.updateMany({ where: { id: existing.id, sealState: "OPEN" }, data: termColumns(terms) });
    if (r.count === 0) return "skipped-sealed";
    await upsertLineStatsTx(tx, existing.id, terms.lines);
    return "recomputed";
  }
  const shift = await tx.shiftInstance.findUniqueOrThrow({ where: { id: shiftInstanceId }, select: { factoryDayKey: true } });
  const created = await tx.machineShiftStat.create({ data: { machineId, shiftInstanceId, factoryDay: shift.factoryDayKey, ...termColumns(terms) }, select: { id: true } });
  await upsertLineStatsTx(tx, created.id, terms.lines);
  return "created";
}

// ─────────────────────────────────────────────────────────────────────────────
// M3 — ELLE DÜZELTME (loom:manual-entry): yalnız OPEN satır; kaynak SUPERVISOR olur
// ─────────────────────────────────────────────────────────────────────────────
export interface ShiftTermsCorrection {
  nonScheduledSec?: number; plannedBreakSec?: number; setupSec?: number; plannedDownSec?: number;
  unplannedDownSec?: number; minorStopSec?: number; unitsActual?: number; producedM?: number | null;
  targetUnitsPerMin?: number | null; unclassifiedSec?: number;
}
const CORRECTABLE = ["nonScheduledSec", "plannedBreakSec", "setupSec", "plannedDownSec", "unplannedDownSec", "minorStopSec", "unitsActual", "producedM", "targetUnitsPerMin", "unclassifiedSec"] as const;

export async function correctShiftTerms(statId: string, patch: ShiftTermsCorrection, userId?: string): Promise<ApiResponse<{ id: string }>> {
  const changes: Array<{ field: string; old: unknown; new: unknown }> = [];
  await prisma.$transaction(async (tx) => {
    const cur = await tx.machineShiftStat.findUnique({ where: { id: statId } });
    if (!cur) throw AppError.notFound("Karne bulunamadı", { statId });
    const pick = <K extends (typeof CORRECTABLE)[number]>(k: K): number | null =>
      (patch[k] !== undefined ? patch[k] : cur[k]) as number | null;
    const potSec = Math.max(0, cur.calendarSec - cur.unobservedSec - (pick("nonScheduledSec") ?? 0) - (pick("plannedBreakSec") ?? 0));
    const aptSec = Math.max(0, potSec - (pick("setupSec") ?? 0) - (pick("plannedDownSec") ?? 0) - (pick("unplannedDownSec") ?? 0));
    const target = pick("targetUnitsPerMin");
    const data: Prisma.MachineShiftStatUncheckedUpdateInput = {
      ...Object.fromEntries(CORRECTABLE.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])),
      potSec, aptSec,
      // Elle düzeltmede kapasite tek hedeften: koşum kesişimi yeniden kurulmaz (uydurulmaz), hedef yoksa 0 → P ölçülemez.
      targetUnitCapacityApt: target === null ? 0 : Math.round((target * aptSec) / 60),
      targetUnitCapacityPot: target === null ? 0 : Math.round((target * potSec) / 60),
      source: "SUPERVISOR",
    };
    for (const k of CORRECTABLE) if (patch[k] !== undefined) changes.push({ field: k, old: cur[k], new: patch[k] });
    const r = await tx.machineShiftStat.updateMany({ where: { id: statId, sealState: "OPEN" }, data });
    if (r.count === 0) {
      throw AppError.conflict("Karne mühürlü — terimler değiştirilemez; önce mührü açın.", { code: "SHIFT_SEALED", statId, sealGeneration: cur.sealGeneration });
    }
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: statId, changes }).catch(() => undefined);
  return { success: true, data: { id: statId }, message: "Karne terimleri düzeltildi (kaynak: vardiya amiri)" };
}

// ─────────────────────────────────────────────────────────────────────────────
// M4 — MÜHÜR (loom:manual-entry): claim OPEN→SEALED, oranlar denormalize, kırılım YENİ kuşak, Seal(SEAL|RESEAL)
// ─────────────────────────────────────────────────────────────────────────────
export interface SealResult { id: string; sealGeneration: number; action: MachineSealAction; kpis: LoomKpis; breakdownRows: number }

export async function sealShiftStat(statId: string, userId?: string, now = new Date()): Promise<ApiResponse<SealResult>> {
  const result = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineShiftStat.findUnique({ where: { id: statId } });
    if (!cur) throw AppError.notFound("Karne bulunamadı", { statId });
    const kpis = computeMachineKpis(kpiInput(cur));
    const gen = cur.sealGeneration + 1;
    const action: MachineSealAction = cur.sealGeneration === 0 ? "SEAL" : "RESEAL";
    const claim = await tx.machineShiftStat.updateMany({
      where: { id: statId, sealState: "OPEN" },
      data: {
        sealState: "SEALED", sealGeneration: gen, sealedAt: now, sealedById: userId ?? null,
        availabilityPct: kpis.availabilityPct, performancePct: kpis.performancePct, effectivenessPct: kpis.effectivenessPct, formulaVersion: kpis.formulaVersion,
      },
    });
    if (claim.count === 0) {
      const fresh = await tx.machineShiftStat.findUniqueOrThrow({ where: { id: statId }, select: { sealState: true, sealGeneration: true, sealedAt: true } });
      throw AppError.conflict("Karne zaten mühürlü (bu arada mühürlendi) — tekrar deneyin ya da mührü açın.", { code: "SHIFT_SEAL_RACE", statId, ...fresh });
    }
    // Kırılım: duruş defterinden YENİ KUŞAK (eski kuşaklar durur).
    const live = await computeShiftTerms(tx, cur.machineId, cur.shiftInstanceId, { now });
    const rows: ShiftBreakdownRow[] = live.breakdown;
    if (rows.length) {
      await tx.machineShiftStopBreakdown.createMany({ data: rows.map((b) => ({ statId, sealGeneration: gen, ...b })) });
    }
    const { id: _i, createdAt: _c, updatedAt: _u, ...termsSnapshot } = cur;
    // Hat satırları fotoğrafa girer ("aynen yeniden bas"): çocuk DURUM'dur, mühür anındaki hâli burada donar.
    const lines = await tx.machineShiftLineStat.findMany({
      where: { statId }, orderBy: { productionLineNo: "asc" },
      select: { productionLineNo: true, runCount: true, unitsActual: true, targetUnitCapacityApt: true, targetUnitCapacityPot: true, targetUnitsPerMin: true, unitsPerCmAtClose: true, producedM: true },
    });
    await tx.machineShiftStatSeal.create({
      data: {
        statId, action, sealGeneration: gen, actedById: userId ?? null,
        terms: JSON.parse(JSON.stringify({ ...termsSnapshot, kpis, lines })) as Prisma.InputJsonValue,
        potSec: cur.potSec, aptSec: cur.aptSec, unitsActual: cur.unitsActual, targetUnitCapacityPot: cur.targetUnitCapacityPot,
        effectivenessPct: kpis.effectivenessPct, formulaVersion: kpis.formulaVersion,
      },
    });
    return { id: statId, sealGeneration: gen, action, kpis, breakdownRows: rows.length };
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: SEAL_TABLE, recordId: statId, newData: { action: result.action, sealGeneration: result.sealGeneration } }).catch(() => undefined);
  return { success: true, data: result, message: result.action === "SEAL" ? "Karne mühürlendi" : "Karne yeniden mühürlendi", ...(result.kpis.warnings.length ? { warnings: result.kpis.warnings } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// M5 — MÜHÜR AÇMA (loom:shift-unseal): claim SEALED→OPEN, Seal(UNSEAL); `sealedAt` KALIR
// ─────────────────────────────────────────────────────────────────────────────
export async function unsealShiftStat(statId: string, reason: string, userId?: string): Promise<ApiResponse<{ id: string; sealGeneration: number }>> {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) throw AppError.badRequest("Mühür açma gerekçesi en az 3 karakter olmalı.", { code: "UNSEAL_REASON_REQUIRED" });
  const out = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineShiftStat.findUnique({ where: { id: statId } });
    if (!cur) throw AppError.notFound("Karne bulunamadı", { statId });
    // `sealedAt`/`sealedById` KALIR — "en son ne zaman mühürlendi"; yalnız durum döner.
    const claim = await tx.machineShiftStat.updateMany({ where: { id: statId, sealState: "SEALED" }, data: { sealState: "OPEN" } });
    if (claim.count === 0) throw AppError.conflict("Karne mühürlü değil — açılacak mühür yok.", { code: "SHIFT_NOT_SEALED", statId });
    const { id: _i, createdAt: _c, updatedAt: _u, ...termsSnapshot } = cur;
    await tx.machineShiftStatSeal.create({
      data: {
        statId, action: "UNSEAL", sealGeneration: cur.sealGeneration, reason: trimmed.slice(0, 300), actedById: userId ?? null,
        terms: JSON.parse(JSON.stringify(termsSnapshot)) as Prisma.InputJsonValue,
        potSec: cur.potSec, aptSec: cur.aptSec, unitsActual: cur.unitsActual, targetUnitCapacityPot: cur.targetUnitCapacityPot,
        effectivenessPct: cur.effectivenessPct, formulaVersion: cur.formulaVersion ?? 0,
      },
    });
    return { id: statId, sealGeneration: cur.sealGeneration };
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: SEAL_TABLE, recordId: statId, newData: { action: "UNSEAL", sealGeneration: out.sealGeneration, reason: trimmed.slice(0, 300) } }).catch(() => undefined);
  return { success: true, data: out, message: "Mühür açıldı — karne yeniden hesaplanabilir, sonra yeniden mühürlenir" };
}

/** Mühür defteri (kuşaklar) — §2.11 mutabakat okuması. */
export async function listShiftSeals(statId: string): Promise<ApiResponse<Array<{ id: string; action: MachineSealAction; sealGeneration: number; reason: string | null; actedById: string | null; createdAt: Date; potSec: number; aptSec: number; unitsActual: number; effectivenessPct: Prisma.Decimal | null }>>> {
  const stat = await prisma.machineShiftStat.findUnique({ where: { id: statId }, select: { id: true } });
  if (!stat) throw AppError.notFound("Karne bulunamadı", { statId });
  const rows = await prisma.machineShiftStatSeal.findMany({
    where: { statId }, orderBy: [{ sealGeneration: "asc" }, { createdAt: "asc" }],
    select: { id: true, action: true, sealGeneration: true, reason: true, actedById: true, createdAt: true, potSec: true, aptSec: true, unitsActual: true, effectivenessPct: true },
  });
  return { success: true, data: rows };
}
