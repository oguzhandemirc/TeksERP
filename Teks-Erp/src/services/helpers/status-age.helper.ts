// =============================================================================
// TeksERP — BEKLEME YAŞI (devere-levent S4): "kaç gündür bu durumda?" — levent ve gövde ortak
// =============================================================================
// Yaş = şimdiki duruma giren son ETKİN olayın `createdAt`i (defterden türetilir, kolon yok); olay yoksa kartın
// doğuşu. Levent kümesi `ACTIVE_FORWARD_STATUS_EVENT_WHERE` (LIFO yüklemi), gövde kümesi `BEAM_BODY_EFFECTIVE_EVENT_WHERE`
// — geri alınmış çiftler yaşı önceki olaya döndürür. Okuma sayfa başına TEK groupBy (sorgu sayısı sayfa boyundan bağımsız);
// `minAgeDays` süzgeci Prisma parçasıdır → liste + cursor + özet aynı where'i okur.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { ACTIVE_FORWARD_STATUS_EVENT_WHERE } from "./warp-beam-mount.helper";
import { BEAM_BODY_EFFECTIVE_EVENT_WHERE } from "./beam-body.helper";
import { factoryDaysSince, fasonDayThreshold } from "./order-where.helper";

/** Özet şeridi eşikleri (bilgi; engel değil — plan §4 "eskime kuralı yok"). */
export const BEAM_STALE_FULL_DAYS = 14;
export const BODY_STALE_OUT_DAYS = 30;

export interface StatusAge {
  statusSince: Date;
  /** Fabrika takvim günü farkı (`constants/time.ts`). */
  statusAgeDays: number;
}

export const toStatusAge = (since: Date, now: Date): StatusAge => ({ statusSince: since, statusAgeDays: factoryDaysSince(since, now) });

/** `statusSince < eşik` ⇔ yaş ≥ `days` fabrika günü. */
export const statusAgeCutoff = (days: number, now: Date): Date => fasonDayThreshold(days - 1, now);

/** Leventin şimdiki durumu `days`+ gündür sürüyor: doğuş eşikten önce ve eşikten sonra etkin durum olayı yok. */
export function warpBeamMinAgeWhere(days: number, now: Date): Prisma.WarpBeamWhereInput {
  const cutoff = statusAgeCutoff(days, now);
  return { createdAt: { lt: cutoff }, events: { none: { ...ACTIVE_FORWARD_STATUS_EVENT_WHERE, createdAt: { gte: cutoff } } } };
}

export function beamBodyMinAgeWhere(days: number, now: Date): Prisma.BeamBodyWhereInput {
  const cutoff = statusAgeCutoff(days, now);
  return { createdAt: { lt: cutoff }, events: { none: { ...BEAM_BODY_EFFECTIVE_EVENT_WHERE, createdAt: { gte: cutoff } } } };
}

type BeamEventDb = Pick<Prisma.TransactionClient, "warpBeamEvent">;
type BodyEventDb = Pick<Prisma.TransactionClient, "beamBodyEvent">;

/** Sayfadaki leventlerin durum yaşı — TEK sorgu. */
export async function warpBeamStatusAges(db: BeamEventDb, rows: ReadonlyArray<{ id: string; createdAt: Date }>, now: Date): Promise<Map<string, StatusAge>> {
  if (rows.length === 0) return new Map();
  const g = await db.warpBeamEvent.groupBy({
    by: ["beamId"],
    where: { beamId: { in: rows.map((r) => r.id) }, ...ACTIVE_FORWARD_STATUS_EVENT_WHERE },
    _max: { createdAt: true },
  });
  const last = new Map(g.map((x) => [x.beamId, x._max.createdAt]));
  return new Map(rows.map((r) => [r.id, toStatusAge(last.get(r.id) ?? r.createdAt, now)]));
}

/** Sayfadaki gövdelerin durum yaşı — TEK sorgu. */
export async function beamBodyStatusAges(db: BodyEventDb, rows: ReadonlyArray<{ id: string; createdAt: Date }>, now: Date): Promise<Map<string, StatusAge>> {
  if (rows.length === 0) return new Map();
  const g = await db.beamBodyEvent.groupBy({
    by: ["bodyId"],
    where: { bodyId: { in: rows.map((r) => r.id) }, ...BEAM_BODY_EFFECTIVE_EVENT_WHERE },
    _max: { createdAt: true },
  });
  const last = new Map(g.map((x) => [x.bodyId, x._max.createdAt]));
  return new Map(rows.map((r) => [r.id, toStatusAge(last.get(r.id) ?? r.createdAt, now)]));
}
