// =============================================================================
// KÂRLILIK — MAKİNE-SAAT MALİYETİ (D4-G2b; DALGA4 §8.3 "Makine", §8.9 OTURUM IDLE düzeltmesi, §12.1 makineSuresi)
// =============================================================================
// Makine × fabrika günü süresi × as-of saat ücreti, o günün ölçülen metresine bölünür (iş = metre payı); süresi olup
// metresi olmayan gün "boşta makine" satırıdır. Kip (`maliyet.karlilik.makineSuresi`):
//   OTURUM — iş oturumları birleşimi. IDLE kapanan (ve açık kalan) oturumun etkin sonu `lastActivityAt`: tembel
//            kapanış `endedAt = now()` yazar ve süreyi şişirir. Düzeltme YALNIZ BU OKUMADA; `work-session.helper`
//            yazımı değişmez (tüketicileri §8.9; `test_karlilik_makine_genel_gider` §1 önce/sonra bayt-aynı ölçer).
//   VARDIYA — makinenin oturumla değdiği iptalsiz vardiyaların tamamı (mola düşülür), vardiyanın başladığı güne.
//   NORM   — iş metresi ÷ ücretteki saatlik metre normu (günlük bölüşüm yok, boşta satırı yok).
// Bilinmeyen değer 0 DEĞİLDİR: `null` + eksik kodu. Makinesi atfedilmemiş iş (ölçüm okuması yok — bugün kurşun) makine
// maliyeti 0 taşır (`machineAttributed: false`); o makinenin süresi gün metresi yoksa boşta satırına düşer.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDayEnd, factoryDayEndOfKey, factoryDayStart, factoryYmd } from "../../constants/time";
import type { ProfitMachineTimeMode } from "../system-setting.service";
import { isCostRateValidAt, machineCostRateHistory } from "./cost-rate-validity.helper";
import { machineWorkMeters, workFirstReadingAt, workKey, type WorkRef } from "./meter-reading-work.helper";
import type { RevenueLinkRow } from "./profitability-finance.helper";

export type MachineMissingCode = "MAKINE_TARIFESI" | "MAKINE_NORMU" | "MAKINE_SURESI" | "MAKINE_METRESI" | "VARDIYA_TAKVIMI";

export interface LinkMachineCost {
  machineAttributed: boolean;
  machineHours: Prisma.Decimal | null;
  machineTry: Prisma.Decimal | null;
  missing: MachineMissingCode[];
}

export interface IdleMachineDay {
  month: string;
  day: string;
  machineId: string;
  hours: Prisma.Decimal;
  costTry: Prisma.Decimal | null;
  missing: MachineMissingCode[];
}

const D0 = () => new Prisma.Decimal(0);
const HOUR_MS = 3_600_000;
const nextDayStart = (at: Date) => new Date(factoryDayEnd(at).getTime() + 1);
const dayKey = (machineId: string, day: string) => `${machineId}|${day}`;

type SessionRead = { machineId: string | null; startedAt: Date; endedAt: Date | null; endReason: string | null; lastActivityAt: Date };

/** OTURUM etkin sonu (§8.9): IDLE kapanan ya da hâlâ açık oturum son harekette kesilir; başlangıçtan geri gitmez. */
export function sessionEffectiveEnd(s: Pick<SessionRead, "startedAt" | "endedAt" | "endReason" | "lastActivityAt">): Date {
  const end = s.endedAt === null || s.endReason === "IDLE" ? s.lastActivityAt : s.endedAt;
  return end.getTime() < s.startedAt.getTime() ? s.startedAt : end;
}

/** Makine başına birleşik oturum aralıkları (çakışan oturum iki kez sayılmaz), pencereye kırpılmış. */
async function machineIntervals(start: Date, end: Date): Promise<Map<string, Array<[number, number]>>> {
  const rows = await prisma.workSession.findMany({
    where: { machineId: { not: null }, startedAt: { lt: end }, OR: [{ endedAt: null }, { endedAt: { gt: start } }] },
    select: { machineId: true, startedAt: true, endedAt: true, endReason: true, lastActivityAt: true },
    orderBy: [{ machineId: "asc" }, { startedAt: "asc" }, { id: "asc" }],
  });
  const raw = new Map<string, Array<[number, number]>>();
  for (const s of rows) {
    const a = Math.max(s.startedAt.getTime(), start.getTime());
    const b = Math.min(sessionEffectiveEnd(s).getTime(), end.getTime());
    if (b <= a) continue;
    const list = raw.get(s.machineId!);
    if (list) list.push([a, b]);
    else raw.set(s.machineId!, [[a, b]]);
  }
  const merged = new Map<string, Array<[number, number]>>();
  for (const [m, list] of raw) {
    list.sort((x, y) => x[0] - y[0]);
    const out: Array<[number, number]> = [];
    for (const iv of list) {
      const last = out.at(-1);
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else out.push([iv[0], iv[1]]);
    }
    merged.set(m, out);
  }
  return merged;
}

/** Aralıkları fabrika günlerine böler → saat (gün sınırı `constants/time.ts`). */
function sessionHoursByDay(intervals: Map<string, Array<[number, number]>>): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  for (const [m, list] of intervals) {
    for (const [a, b] of list) {
      let cur = a;
      while (cur < b) {
        const segEnd = Math.min(b, nextDayStart(new Date(cur)).getTime());
        const k = dayKey(m, factoryYmd(new Date(cur)));
        out.set(k, (out.get(k) ?? D0()).plus(new Prisma.Decimal(segEnd - cur).div(HOUR_MS)));
        cur = segEnd;
      }
    }
  }
  return out;
}

/** VARDIYA: oturumla değilen iptalsiz vardiyaların net saati (süre − planlı mola), vardiyanın başladığı güne. */
async function shiftHoursByDay(intervals: Map<string, Array<[number, number]>>, start: Date, end: Date): Promise<Map<string, Prisma.Decimal>> {
  const shifts = await prisma.shiftInstance.findMany({
    where: { isCancelled: false, startsAt: { lt: end }, endsAt: { gt: start } },
    select: { startsAt: true, endsAt: true, shiftDefinition: { select: { plannedBreakMinutes: true } } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  const out = new Map<string, Prisma.Decimal>();
  for (const [m, list] of intervals) {
    for (const sh of shifts) {
      const a = sh.startsAt.getTime();
      const b = sh.endsAt.getTime();
      if (!list.some(([x, y]) => x < b && y > a)) continue;
      const netMs = Math.max(0, b - a - sh.shiftDefinition.plannedBreakMinutes * 60_000);
      const k = dayKey(m, factoryYmd(sh.startsAt));
      out.set(k, (out.get(k) ?? D0()).plus(new Prisma.Decimal(netMs).div(HOUR_MS)));
    }
  }
  return out;
}

type RateRow = { machineId: string; hourRateTry: Prisma.Decimal; normMPerHour: Prisma.Decimal | null; createdAt: Date; revokedAt: Date | null };

/** K7 tek kaynak: makinenin `at` anında geçerli saat ücreti (`machineCostRateHistory` satırlarından; yoksa null). */
export function machineRateAt<R extends RateRow>(rates: R[], machineId: string, at: Date): R | null {
  return rates.filter((r) => r.machineId === machineId && isCostRateValidAt(r, at)).at(-1) ?? null;
}

/** K7 tek kaynak: NORM süresi = metre ÷ ücretteki saatlik norm; norm yoksa null (0 değil). */
export function normHours(meters: Prisma.Decimal, rate: RateRow | null): Prisma.Decimal | null {
  return rate?.normMPerHour && rate.normMPerHour.gt(0) ? meters.div(rate.normMPerHour) : null;
}

/** K7 tek kaynak: saat × ücret (TL). Süre ya da ücret bilinmiyorsa null — kârlılık ve dokuma gerçek maliyeti bunu okur. */
export function machineHourCostTry(hours: Prisma.Decimal | null, rate: RateRow | null): Prisma.Decimal | null {
  return hours && rate ? hours.mul(rate.hourRateTry) : null;
}

/** İşin süresini aynı okumaya bağlı kalemler arasında böler; son pay kalanı alır (Σ pay = iş süresi, tek sayım). */
function shareOf(h: Prisma.Decimal, index: number, count: number): Prisma.Decimal {
  if (count <= 1) return h;
  const part = h.div(count).toDecimalPlaces(6);
  return index < count - 1 ? part : h.minus(part.mul(count - 1));
}

/**
 * Bağ başına makine maliyeti + aralıktaki boşta makine günleri. `rangeStart/rangeEnd` rapor aralığı (boşta satırı
 * yalnız bunun içinde); iş günleri aralık dışında olabilir (geçen ay yapılan iş bu ay faturalanır). İş = makine × top ×
 * adım (`meter-reading-work.helper`): günü ilk okumasının günü, süresi `gün süresi × iş metresi / gün metresi`
 * (NORM: iş metresi ÷ norm); aynı okumaya bağlı kalemler (TAMBUR + ETEK) bu süreyi BÖLÜŞÜR.
 */
export async function computeMachineCosts(
  mode: ProfitMachineTimeMode, links: RevenueLinkRow[], rangeStart: Date, rangeEnd: Date,
): Promise<{ byLink: Map<string, LinkMachineCost>; idle: IdleMachineDay[] }> {
  const byLink = new Map<string, LinkMachineCost>();
  const refOf = (l: RevenueLinkRow): WorkRef | null =>
    l.machineId !== null && l.readingStepId !== null ? { machineId: l.machineId, rollId: l.rollId, workOrderStepId: l.readingStepId } : null;
  const attributed = links.flatMap((l) => { const w = refOf(l); return w ? [w] : []; });
  const firstAt = await workFirstReadingAt(attributed);
  let winStart = rangeStart;
  let winEnd = rangeEnd;
  for (const at of firstAt.values()) {
    const d0 = factoryDayStart(at);
    if (d0 < winStart) winStart = d0;
    const d1 = nextDayStart(at);
    if (d1 > winEnd) winEnd = d1;
  }
  const intervals = mode === "NORM" ? new Map<string, Array<[number, number]>>() : await machineIntervals(winStart, winEnd);
  const machineIds = [...new Set([...attributed.map((w) => w.machineId), ...intervals.keys()])].sort();
  const rates = await machineCostRateHistory(prisma, machineIds);
  const rateAt = (m: string, at: Date) => machineRateAt(rates, m, at);
  const hours = mode === "OTURUM" ? sessionHoursByDay(intervals) : mode === "VARDIYA" ? await shiftHoursByDay(intervals, winStart, winEnd) : new Map<string, Prisma.Decimal>();
  const sessionDays = mode === "VARDIYA" ? sessionHoursByDay(intervals) : hours;
  const { dayMeters: meters, works } = await machineWorkMeters(machineIds, winStart, winEnd);

  for (const l of links) {
    const ref = refOf(l);
    if (ref === null) { byLink.set(l.id, { machineAttributed: false, machineHours: D0(), machineTry: D0(), missing: [] }); continue; }
    const missing: MachineMissingCode[] = [];
    const work = works.get(workKey(ref));
    const rate = rateAt(ref.machineId, work?.firstAt ?? l.readingAt ?? l.serviceAt);
    let h: Prisma.Decimal | null = null;
    if (!work) missing.push("MAKINE_METRESI");
    else if (mode === "NORM") {
      h = normHours(work.meters, rate);
      if (!h) missing.push("MAKINE_NORMU");
    } else {
      const k = dayKey(ref.machineId, work.day);
      const dh = hours.get(k);
      const dm = meters.get(k);
      if (!dh || dh.lte(0)) missing.push(mode === "VARDIYA" && sessionDays.get(k)?.gt(0) ? "VARDIYA_TAKVIMI" : "MAKINE_SURESI");
      else if (!dm || dm.lte(0)) missing.push("MAKINE_METRESI");
      else h = dh.mul(work.meters).div(dm);
    }
    if (h) h = shareOf(h, l.readingShareIndex, l.readingShareCount);
    if (!rate) missing.push("MAKINE_TARIFESI");
    byLink.set(l.id, { machineAttributed: true, machineHours: h, machineTry: machineHourCostTry(h, rate), missing });
  }

  const idle: IdleMachineDay[] = [];
  for (const [k, h] of hours) {
    if (h.lte(0) || (meters.get(k)?.gt(0) ?? false)) continue;
    const [machineId, day] = k.split("|") as [string, string];
    const at = factoryDayEndOfKey(day);
    if (at.getTime() < rangeStart.getTime() || at.getTime() >= rangeEnd.getTime()) continue;
    const rate = rateAt(machineId, at);
    idle.push({ month: day.slice(0, 7), day, machineId, hours: h, costTry: machineHourCostTry(h, rate), missing: rate ? [] : ["MAKINE_TARIFESI"] });
  }
  idle.sort((a, b) => a.day.localeCompare(b.day) || a.machineId.localeCompare(b.machineId));
  return { byLink, idle };
}
