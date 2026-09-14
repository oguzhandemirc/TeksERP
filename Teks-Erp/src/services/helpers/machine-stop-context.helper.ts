// =============================================================================
// Tezgah duruşu — BAĞLAM çözümü ve MÜHÜR KAPISI (machine-stop.service'in yardımcıları)
// =============================================================================
// Servis dosyası beş yazma yolunu taşır (boyut tavanı); "duruş hangi vardiyaya/koşuma
// düşer, sebep katalogda var mı, vardiya yazılabilir mi" soruları burada tek yerde.
// =============================================================================
import { Prisma, ReasonPresetKind, type MachineStopLossClass } from "@prisma/client";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

/** Duruş DTO seçimi — servis, liste ve bekçi aynı şekli okur. */
export const MACHINE_STOP_SELECT = {
  id: true,
  machineId: true,
  runId: true,
  stopKey: true,
  startedAt: true,
  endedAt: true,
  durationSec: true,
  endSource: true,
  beamSlot: true,
  reasonCode: true,
  lossClass: true,
  reasonNote: true,
  reasonSource: true,
  classifiedById: true,
  classifiedAt: true,
  requiresReason: true,
  shiftInstanceId: true,
  factoryDay: true,
  source: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
  // Panel listesi makine · vardiya · sınıflandıranı ADIYLA ister (kim/ne zaman); tablet aynı DTO'yu okur (ek alan, kırmaz).
  machine: { select: { code: true, name: true } },
  shiftInstance: { select: { id: true, startsAt: true, endsAt: true, isCancelled: true, shiftDefinition: { select: { code: true, name: true } } } },
  classifiedBy: { select: { fullName: true } },
} satisfies Prisma.MachineStopEventSelect;

export type MachineStopDto = Prisma.MachineStopEventGetPayload<{ select: typeof MACHINE_STOP_SELECT }>;

/**
 * YUVA DOĞRULAMASI (F4): `beamSlot` yalnız `warpBeamSlots > 1` olan makinede ve 1..warpBeamSlots
 * aralığında yazılır; `<= 1` makinede alan çizilmez (verilirse 400). NULL her zaman serbest —
 * "atanmamış" kovası tahminle doldurulmaz.
 */
export function assertBeamSlotValid(machine: { warpBeamSlots: number }, beamSlot: number | null | undefined): void {
  if (beamSlot == null) return;
  if (machine.warpBeamSlots <= 1) {
    throw AppError.badRequest("Bu makinede levent yuvası seçilmez (tek yuva).", { code: "BEAM_SLOT_NOT_APPLICABLE", warpBeamSlots: machine.warpBeamSlots });
  }
  if (beamSlot < 1 || beamSlot > machine.warpBeamSlots) {
    throw AppError.badRequest(`Levent yuvası 1..${machine.warpBeamSlots} aralığında olmalı.`, {
      code: "BEAM_SLOT_OUT_OF_RANGE", beamSlot, warpBeamSlots: machine.warpBeamSlots,
    });
  }
}

/** Katalogdaki AKTİF MACHINE_STOP satırı; kayıp sınıfı zorunlu (CHECK). Yoksa 400. */
export async function resolveStopPreset(tx: Tx, code: string): Promise<{ code: string; lossClass: MachineStopLossClass }> {
  const trimmed = code.trim();
  const row = await tx.reasonPreset.findFirst({
    where: { kind: ReasonPresetKind.MACHINE_STOP, code: trimmed, isActive: true },
    select: { code: true, stopLossClass: true },
  });
  if (!row) throw AppError.badRequest(`Geçersiz duruş sebebi: ${trimmed}`, { code: "REASON_CODE_INVALID" });
  if (!row.stopLossClass) {
    throw AppError.badRequest(`Duruş sebebinin kayıp sınıfı yok: ${trimmed}`, { code: "STOP_LOSS_CLASS_MISSING" });
  }
  return { code: row.code, lossClass: row.stopLossClass };
}

/**
 * MÜHÜR KAPISI — tek yer; kapa · sınıfla · yeniden sınıfla · geri al hepsi buradan geçer.
 * Bugün: iptal edilmiş vardiya → 409 `SHIFT_CANCELLED`. Karne (`MachineShiftStat`, makine×vardiya,
 * 01'in Faz 1a dilimi) inince AYNI yer: `tx.machineShiftStat.findUnique({ machineId_shiftInstanceId })`
 * → satır yoksa OPEN sayılır, `sealState === "SEALED"` → 409 `SHIFT_SEALED`
 * (yol: `loom:shift-unseal` → satır → RESEAL). İmza şimdiden çifti alır; çağıranlar değişmez.
 * Vardiya iptali ≠ mühür — ikisi ayrı sorudur, ikisi de burada sorulur.
 */
export async function assertStopShiftWritableTx(
  tx: Tx,
  ref: { shiftInstanceId: string | null; machineId: string },
): Promise<void> {
  if (!ref.shiftInstanceId) return;
  const shift = await tx.shiftInstance.findUnique({ where: { id: ref.shiftInstanceId }, select: { isCancelled: true } });
  if (shift?.isCancelled) {
    throw AppError.conflict("Bu duruşun vardiyası iptal edilmiş — kayıt değiştirilemez.", {
      code: "SHIFT_CANCELLED", shiftInstanceId: ref.shiftInstanceId, machineId: ref.machineId,
    });
  }
}

/** `at` anını kapsayan vardiya — iptal edilmiş olsa da (yoksa NULL — tahminle yazılmaz). */
export async function resolveShiftInstanceId(tx: Tx, at: Date): Promise<string | null> {
  // İptal edilmiş vardiya da DÖNER (F1 hükmü, 2026-09-14): iptal ≠ "vardiya yok"; kararı
  // `assertStopShiftWritableTx` verir (409 SHIFT_CANCELLED). NULL yalnız kapsayan vardiya HİÇ yoksa.
  const s = await tx.shiftInstance.findFirst({
    where: { startsAt: { lte: at }, endsAt: { gt: at } },
    select: { id: true },
    orderBy: { startsAt: "desc" },
  });
  return s?.id ?? null;
}

/** `at` anında makinede TEK canlı koşum varsa onun id'si; belirsizse (0 ya da 2+) NULL. */
export async function resolveRunId(tx: Tx, machineId: string, at: Date): Promise<string | null> {
  const runs = await tx.machineRun.findMany({
    where: { machineId, revokedAt: null, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gte: at } }] },
    select: { id: true },
    take: 2,
  });
  return runs.length === 1 ? runs[0]!.id : null;
}

export function normalizeNote(note: string | null | undefined): string | null {
  const t = note?.trim() ?? "";
  return t ? t.slice(0, 300) : null;
}

export async function loadStop(tx: Tx, stopId: string): Promise<MachineStopDto> {
  return tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: MACHINE_STOP_SELECT });
}

