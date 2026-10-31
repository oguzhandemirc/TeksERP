// =============================================================================
// MAKİNE İŞİ METRESİ — kârlılık makine-saat paydası (D4-G2b; DALGA4 §8.3 "Makine"), YALNIZ OKUR
// =============================================================================
// İş = makine × top × adım: düzeltme zinciri (B2 eski okumayı damgalayıp yenisini açar) ve brode IN/OUT fazları TEK iştir;
// işin günü İLK okumasının fabrika günüdür, metresi o günün SONUNDA damgasız okumalardan CUT > OUT > IN önceliğiyle
// (as-of: sonradan düzeltme geçmiş günü değiştirmez). Yazım `meter-reading.helper` boğazındadır, burada yazım yok.
// =============================================================================
import { MeterPhase, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayEnd, factoryYmd } from "../../constants/time";

export interface MachineWork { firstAt: Date; day: string; meters: Prisma.Decimal }
export interface WorkRef { machineId: string; rollId: string; workOrderStepId: string }

export const workKey = (w: WorkRef) => `${w.machineId}|${w.rollId}|${w.workOrderStepId}`;
const RANK: Record<MeterPhase, number> = { CUT: 3, OUT: 2, IN: 1 };

/** Verilen işlerin İLK okuma anı (damgalı okumalar dahil — düzeltme işin gününü kaydırmaz). */
export async function workFirstReadingAt(works: WorkRef[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (works.length === 0) return out;
  const wanted = new Set(works.map(workKey));
  const rows = await prisma.rollMeterReading.findMany({
    where: { rollId: { in: [...new Set(works.map((w) => w.rollId))] }, machineId: { in: [...new Set(works.map((w) => w.machineId))] } },
    select: { machineId: true, rollId: true, workOrderStepId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const r of rows) {
    const k = workKey({ machineId: r.machineId!, rollId: r.rollId, workOrderStepId: r.workOrderStepId });
    if (wanted.has(k) && !out.has(k)) out.set(k, r.createdAt);
  }
  return out;
}

/**
 * Pencerede İLK okuması olan işler + makine × gün metresi (anahtar `${machineId}|${YYYY-MM-DD}`). Penceredeki okuması
 * olup ilk okuması pencereden önce olan iş, önceki bir günündür — bu pencerenin günlerine girmez.
 */
export async function machineWorkMeters(machineIds: string[], start: Date, end: Date): Promise<{ dayMeters: Map<string, Prisma.Decimal>; works: Map<string, MachineWork> }> {
  const dayMeters = new Map<string, Prisma.Decimal>();
  const works = new Map<string, MachineWork>();
  if (machineIds.length === 0) return { dayMeters, works };
  const rows = await prisma.rollMeterReading.findMany({
    where: { machineId: { in: machineIds }, createdAt: { gte: start, lt: end } },
    select: { machineId: true, rollId: true, workOrderStepId: true, phase: true, meters: true, createdAt: true, revokedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const earlier = await prisma.rollMeterReading.findMany({
    where: { machineId: { in: machineIds }, rollId: { in: [...new Set(rows.map((r) => r.rollId))] }, createdAt: { lt: start } },
    select: { machineId: true, rollId: true, workOrderStepId: true },
  });
  const skip = new Set(earlier.map((r) => workKey({ machineId: r.machineId!, rollId: r.rollId, workOrderStepId: r.workOrderStepId })));
  const best = new Map<string, { firstAt: Date; dayEnd: number; phase: MeterPhase | null; meters: Prisma.Decimal; machineId: string }>();
  for (const r of rows) {
    if (r.machineId === null) continue;
    const k = workKey({ machineId: r.machineId, rollId: r.rollId, workOrderStepId: r.workOrderStepId });
    if (skip.has(k)) continue;
    let b = best.get(k);
    if (!b) { b = { firstAt: r.createdAt, dayEnd: factoryDayEnd(r.createdAt).getTime(), phase: null, meters: new Prisma.Decimal(0), machineId: r.machineId }; best.set(k, b); }
    if (r.createdAt.getTime() > b.dayEnd) continue;
    if (r.revokedAt !== null && r.revokedAt.getTime() <= b.dayEnd) continue;
    if (b.phase === null || RANK[r.phase] > RANK[b.phase]) { b.phase = r.phase; b.meters = r.meters; }
  }
  for (const [k, b] of best) {
    if (b.phase === null) continue;
    const day = factoryYmd(b.firstAt);
    works.set(k, { firstAt: b.firstAt, day, meters: b.meters });
    const dk = `${b.machineId}|${day}`;
    dayMeters.set(dk, (dayMeters.get(dk) ?? new Prisma.Decimal(0)).plus(b.meters));
  }
  return { dayMeters, works };
}
