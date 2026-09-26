// =============================================================================
// TeksERP — Levent DEFTER yardımcıları (Faz 3): kalan metre tx içinde, ölçülen kalana KAPATMA
// =============================================================================
// Kalan metre KOLON DEĞİL (§3.6): olaylardan türetilir. Söküm/bitişte "ölçülen kalan" verildiyse
// fark ÖNCE tipli olayla kapanır (fazla tüketim → CONSUMED, eksik → ADJUST_IN sebepli), sonra
// durum olayı yazılır (§4.7). Eksiye düşürme yasağı (1e ek şart ③) burada tek kapıdır.
// =============================================================================
import { Prisma, WarpBeamStatus, type WarpLengthSource } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { applyWarpBeamEventTx } from "./warp-beam-event.helper";
import { warpBeamRemainingM } from "./warp-beam.helper";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Ölçüm farkı kapatmalarının SABİT sebep kodu — `WARP_BEAM_ADJUST` kataloğunda sistem satırı (uydurulmaz, tohumdan). */
export const MEASUREMENT_ADJUST_REASON = "OLCUM_FARKI";

export const BEAM_LEDGER_SELECT = {
  id: true,
  beamNo: true,
  status: true,
  currentMachineId: true,
  currentPosition: true,
  physicalBeamNo: true,
  warpSpecId: true,
  warpSpec: { select: { id: true, code: true, endsCount: true, yarnItem: { select: { linearDensityDen: true } } } },
} satisfies Prisma.WarpBeamSelect;
export type BeamLedgerRow = Prisma.WarpBeamGetPayload<{ select: typeof BEAM_LEDGER_SELECT }>;

export async function loadBeamTx(tx: Pick<Tx, "warpBeam">, id: string): Promise<BeamLedgerRow> {
  const b = await tx.warpBeam.findUnique({ where: { id }, select: BEAM_LEDGER_SELECT });
  if (!b) throw AppError.notFound("Levent bulunamadı");
  return b;
}

/** Türetilen kalan, YALNIZ GÖSTERİM — TÜM olaylar, tek işaret tablosu. Defter yazan yol bunu değil `remainingMTx`'i çağırır. */
export async function readRemainingM(db: Pick<Tx, "warpBeamEvent">, beamId: string): Promise<Prisma.Decimal> {
  const events = await db.warpBeamEvent.findMany({ where: { beamId }, select: { kind: true, lengthM: true } });
  return D(warpBeamRemainingM(events));
}

/**
 * Defter yazımına giren kalan: önce levent satırı `FOR UPDATE`, sonra olaylar — kilitsiz okumada eşzamanlı iki yazım
 * aynı eski kalanı görür ve kalan eksiye düşer. Kilit sırası: (varsa) 8036 token kilidi → levent satırı → defter yazımı.
 */
export async function remainingMTx(tx: Tx, beamId: string): Promise<Prisma.Decimal> {
  await tx.$queryRaw`SELECT id FROM warp_beams WHERE id = ${beamId}::uuid FOR UPDATE`;
  return readRemainingM(tx, beamId);
}

/** Pozitif metre girdisi (0 ve negatif 400). */
export function positiveM(v: Prisma.Decimal.Value, label: string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest(`${label} 0'dan büyük olmalı`);
  return d;
}

/** Kalanı eksiye düşürme yasağı — CONSUMED · ADJUST_OUT · EXHAUSTED tek kapı (1e ③). */
export function assertCoversRemaining(beamNo: string, remaining: Prisma.Decimal, lengthM: Prisma.Decimal, label: string): void {
  if (remaining.minus(lengthM).lt(0)) {
    throw AppError.conflict(`${beamNo}: ${label} ${lengthM} m, leventte kalan ${remaining} m — kalan eksiye düşemez. Önce kalanı düzeltin (ölçüm farkı) ya da metreyi düşürün.`, { code: "WARP_BEAM_REMAINING_EXCEEDED", remainingM: Number(remaining), requestedM: Number(lengthM) });
  }
}

/**
 * ÖLÇÜLEN KALANA KAPATMA: türetilen kalan R, ölçülen kalan M. R > M → CONSUMED (R−M, kaynak);
 * R < M → ADJUST_IN (M−R, sebep OLCUM_FARKI); eşitse satır yok. Durum DEĞİŞMEZ (from = to).
 * Döner: yazılan olay türü ve fark (raporda "beyan/ölçüldü" izi).
 */
export async function closeToMeasuredTx(
  tx: Tx,
  beam: Pick<BeamLedgerRow, "id" | "beamNo" | "status">,
  measuredRemainingM: Prisma.Decimal,
  extra: { lengthSource: WarpLengthSource; machineCounter?: Prisma.Decimal.Value | null; grossKg?: Prisma.Decimal.Value | null; tareKg?: Prisma.Decimal.Value | null; userId?: string | null; reason?: string | null },
): Promise<{ kind: "CONSUMED" | "ADJUST_IN" | null; deltaM: Prisma.Decimal }> {
  const remaining = await remainingMTx(tx, beam.id);
  const delta = remaining.minus(measuredRemainingM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (delta.isZero()) return { kind: null, deltaM: delta };
  const base = { lengthSource: extra.lengthSource, machineCounter: extra.machineCounter ?? null, grossKg: extra.grossKg ?? null, tareKg: extra.tareKg ?? null, createdById: extra.userId ?? null };
  if (delta.gt(0)) {
    await applyWarpBeamEventTx(tx, { beamId: beam.id, kind: "CONSUMED", from: beam.status, to: beam.status, data: { ...base, lengthM: delta, reason: extra.reason ?? "Ölçülen kalana kapatma" } });
    return { kind: "CONSUMED", deltaM: delta };
  }
  await applyWarpBeamEventTx(tx, { beamId: beam.id, kind: "ADJUST_IN", from: beam.status, to: beam.status, data: { ...base, lengthM: delta.abs(), reasonCode: MEASUREMENT_ADJUST_REASON, reason: extra.reason ?? "Ölçülen kalan türetilenden fazla — ölçüm farkı" } });
  return { kind: "ADJUST_IN", deltaM: delta };
}

/** Terminal durumlar — defter yazımı 409 (claim zaten keser; mesaj adıyla). */
export const BEAM_TERMINAL = new Set<WarpBeamStatus>([WarpBeamStatus.CANCELLED, WarpBeamStatus.EXHAUSTED, WarpBeamStatus.SCRAPPED]);
