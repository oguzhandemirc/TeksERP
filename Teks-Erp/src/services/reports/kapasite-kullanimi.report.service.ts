// =============================================================================
// KAPASİTE KULLANIMI — "Tezgahlar haftada teorik kapasitelerinin ne kadarını kumaşa çevirdi?" (D6)
// =============================================================================
// Tezgah × fabrika haftası (ISO, pazartesi): teorik m/sa = nominal devir/dk ÷ atkı/cm × 0,6;
// atkı/cm = haftadaki koşumların süre ağırlıklı ortalaması (yoksa null); takvim saati = haftanın
// seçilen pencereyle kesişimi; gerçek = Σ Roll.initialQty (doff zinciri, iptal edilmemiş doff,
// statü ∉ K18_DEAD_STATUSES, doffedAt haftada). Eksik terim → null + `hesaplanamadi` GEREKÇESİ
// (tek yüzdeye çökertme yok; özet yalnız hesaplanabilen satırlardan, hesaplanamayan sayısıyla).
// Gün/hafta sınırı yalnız `constants/time.ts`; bölme helper'da. Nominal BUGÜNKÜ makine kartından okunur.
// =============================================================================
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { LOOM_HORIZON_DAY } from "../../constants/dokuma-ufku";
import { factoryDayStartOfKey, factoryYmd, resolveRangeEnd, resolveRangeStart } from "../../constants/time";
import { K18_DEAD_STATUSES } from "../batch.service";
import { addDaysYmd, daysBetweenYmd, isoWeekOf, msToHours, roundM, shareOfPct, theoreticalMPerHour, weightedAverage } from "../helpers/dokuma-levent-rapor.helper";
import { optionList, type Secenek } from "./_secenekler";

/** Pencere tavanı: 366 gün (tezgah × hafta satırı sınırlı kalsın). */
export const CAPACITY_MAX_DAYS = 366;
export type CapacityGap = "nominal yok" | "atkı/cm yok";

export interface CapacityRow {
  machineId: string;
  code: string;
  name: string;
  hafta: string;
  haftaBaslangic: string;
  nominalUnitsPerMin: number | null;
  unitsPerCm: number | null;
  teorikMSaat: number | null;
  takvimSaat: number;
  potansiyelM: number | null;
  gercekM: number;
  kullanimPct: number | null;
  hesaplanamadi: CapacityGap | null;
}
export interface CapacitySummary {
  satirSayisi: number;
  /** Hesaplanabilen satırların toplamları (kullanimPct paydası). */
  potansiyelM: number;
  gercekM: number;
  kullanimPct: number | null;
  /** Hesaplanamayan satır sayısı ve o satırların gerçek metresi (oranın DIŞINDA). */
  hesaplanamadi: number;
  hesaplanamayanGercekM: number;
  /** Bütün satırların gerçek metresi. */
  toplamGercekM: number;
}
export interface CapacityReport {
  satirlar: CapacityRow[];
  ozet: CapacitySummary;
  meta: { ufuk: string; ufukOncesiSatir: number; secenekler: { machineId: Secenek[] } };
}
export interface CapacityInput { from: string; to: string; machineId?: string }

interface Week { key: string; monday: string; start: Date; end: Date }

/** Pencereyle kesişen ISO haftaları; sınırlar fabrika gününün ilk anı (DST güvenli). */
function weeksOf(from: string, to: string, winStart: Date, winEnd: Date): Week[] {
  const out: Week[] = [];
  for (let monday = isoWeekOf(from).monday; monday <= to; monday = addDaysYmd(monday, 7)) {
    const start = new Date(Math.max(factoryDayStartOfKey(monday).getTime(), winStart.getTime()));
    const end = new Date(Math.min(factoryDayStartOfKey(addDaysYmd(monday, 7)).getTime(), winEnd.getTime()));
    out.push({ key: isoWeekOf(monday).key, monday, start, end });
  }
  return out;
}

const overlapMs = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number => Math.max(0, Math.min(aEnd.getTime(), bEnd.getTime()) - Math.max(aStart.getTime(), bStart.getTime()));

export async function capacityUsageReport(p: CapacityInput): Promise<{ data: CapacityReport; dusenSatir?: number; range: { from: Date; to: Date } }> {
  const span = daysBetweenYmd(p.from, p.to);
  if (span < 0) throw AppError.badRequest("Bitiş günü başlangıçtan önce olamaz", { code: "INVALID_RANGE" });
  if (span + 1 > CAPACITY_MAX_DAYS) throw AppError.badRequest(`Kapasite raporu en çok ${CAPACITY_MAX_DAYS} günlük aralık alır`, { code: "INVALID_RANGE" });
  const range = { from: resolveRangeStart(p.from), to: resolveRangeEnd(p.to) };
  const winEnd = new Date(range.to.getTime() + 1);
  const weeks = weeksOf(p.from, p.to, range.from, winEnd);

  const doffs = await prisma.doffEvent.findMany({
    where: { revokedAt: null, doffedAt: { gte: range.from, lt: winEnd } },
    select: { machineId: true, doffedAt: true, rolls: { where: { status: { notIn: K18_DEAD_STATUSES } }, select: { initialQty: true } } },
  });
  const machines = await prisma.machine.findMany({
    where: { station: { kind: "WEAVING" }, OR: [{ isActive: true }, { id: { in: [...new Set(doffs.map((d) => d.machineId))] } }] },
    select: { id: true, code: true, name: true, machineSpec: { select: { nominalUnitsPerMin: true } } },
    orderBy: { code: "asc" },
  });
  const ids = machines.map((m) => m.id);
  const runs = ids.length
    ? await prisma.machineRun.findMany({
        where: { machineId: { in: ids }, revokedAt: null, startedAt: { lt: winEnd }, OR: [{ endedAt: null }, { endedAt: { gt: range.from } }] },
        select: { machineId: true, startedAt: true, endedAt: true, unitsPerCm: true },
      })
    : [];
  const now = new Date();
  const produced = new Map<string, number>();
  for (const d of doffs) {
    const k = `${d.machineId}|${isoWeekOf(factoryYmd(d.doffedAt)).key}`;
    produced.set(k, (produced.get(k) ?? 0) + d.rolls.reduce((a, r) => a + Number(r.initialQty), 0));
  }

  const rows: CapacityRow[] = [];
  for (const m of machines) {
    const nominal = m.machineSpec?.nominalUnitsPerMin ?? null;
    for (const w of weeks) {
      const parts = runs
        .filter((r) => r.machineId === m.id && r.unitsPerCm !== null)
        .map((r) => ({ value: Number(r.unitsPerCm), weight: overlapMs(r.startedAt, r.endedAt ?? now, w.start, w.end) }))
        .filter((x) => x.weight > 0);
      const unitsPerCm = weightedAverage(parts);
      const teorik = theoreticalMPerHour(nominal, unitsPerCm);
      const takvimSaat = msToHours(overlapMs(w.start, w.end, range.from, winEnd));
      const potansiyelM = teorik === null ? null : roundM(teorik * takvimSaat);
      const gercekM = roundM(produced.get(`${m.id}|${w.key}`) ?? 0);
      rows.push({
        machineId: m.id, code: m.code, name: m.name, hafta: w.key, haftaBaslangic: w.monday,
        nominalUnitsPerMin: nominal, unitsPerCm, teorikMSaat: teorik, takvimSaat, potansiyelM, gercekM,
        kullanimPct: potansiyelM === null ? null : shareOfPct(gercekM, potansiyelM),
        hesaplanamadi: nominal === null ? "nominal yok" : unitsPerCm === null ? "atkı/cm yok" : null,
      });
    }
  }
  const secenekler = { machineId: optionList(machines.map((m) => ({ id: m.id, ad: m.name, kod: m.code }))) };
  const filtered = p.machineId ? rows.filter((r) => r.machineId === p.machineId) : rows;
  const ok = filtered.filter((r) => r.potansiyelM !== null);
  const gaps = filtered.filter((r) => r.potansiyelM === null);
  const potansiyelM = roundM(ok.reduce((a, r) => a + r.potansiyelM!, 0));
  const gercekM = roundM(ok.reduce((a, r) => a + r.gercekM, 0));
  const summary: CapacitySummary = {
    satirSayisi: filtered.length, potansiyelM, gercekM, kullanimPct: shareOfPct(gercekM, potansiyelM),
    hesaplanamadi: gaps.length, hesaplanamayanGercekM: roundM(gaps.reduce((a, r) => a + r.gercekM, 0)),
    toplamGercekM: roundM(filtered.reduce((a, r) => a + r.gercekM, 0)),
  };
  return {
    data: { satirlar: filtered, ozet: summary, meta: { ufuk: LOOM_HORIZON_DAY, ufukOncesiSatir: filtered.filter((r) => r.haftaBaslangic < LOOM_HORIZON_DAY).length, secenekler } },
    ...(p.machineId ? { dusenSatir: rows.length - filtered.length } : {}),
    range,
  };
}
