// =============================================================================
// RAPOR DEMO VERİSİ — "çözgü hatası gece vardiyasında mı fazla?" (R3-ANALIZ; plan §3.8)
// =============================================================================
// Referans fabrikada bu soruyu cevaplayacak veri yok; bu modül YALNIZ test DB'ye belirlenimli bir
// dokuma ayı yazar: üç vardiya (gece yarısını aşan gece), dört tezgah, her vardiya × tezgah × gün bir
// top (metresi sabit tohumlu), hatalar birikimli yuvarlamayla (çözgü: sabah 2,0 · akşam 2,4 · gece 4,1 / 1000 m).
// `kucuk` senaryo 9 çözgü kaydıdır (örneklem eşiği altı). İdempotent: önce `DEMO-RPR` önekli her şey silinir.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { factoryDayStartOfKey, factoryDayEndOfKey, factoryMinuteOfDay, factoryYmd } from "../../src/constants/time";
import { fixtureHedefEngeli } from "./hedef-db-kapisi";
import { firstGrade } from "../fixture-quality-grade";

export const DEMO_TAG = "DEMO-RPR";
export const DEMO_DAYS = 28;
const T = DEMO_TAG;
const starts = { startsWith: T };

/** Vardiya kodu (en çok 8), ad, başlangıç dakikası; süre 8 saat. Gece 22:00 → 06:00 (gece yarısını aşar). */
export const DEMO_SHIFTS = [
  { code: "DMSABAH", name: "Sabah", start: 6 * 60, warpRate: 2.0 },
  { code: "DMAKSAM", name: "Akşam", start: 14 * 60, warpRate: 2.4 },
  { code: "DMGECE", name: "Gece", start: 22 * 60, warpRate: 4.1 },
] as const;
const SHIFT_MINUTES = 480;
const LOOMS = ["T1", "T2", "T3", "T4"] as const;
/** T3 her vardiyada %30 fazla hata verir: "tezgaha göre ayrı bak" farkı görünür ama vardiya farkını açıklamaz. */
const LOOM_FACTOR: Record<(typeof LOOMS)[number], number> = { T1: 1, T2: 1, T3: 1.3, T4: 1 };
const OTHER_RATES = { ATKI: 1.5, BOYA: 0.8 } as const;
/** Küçük senaryo: sabah 2 + akşam 3 + gece 4 = 9 çözgü, her vardiya 1.000 m. */
export const SMALL_WARP = [2, 3, 4] as const;

export interface DemoOptions {
  /** `YYYY-MM` verilirse o ayın 1–28'i; yoksa dünden geriye 28 fabrika günü. */
  month?: string;
  small?: boolean;
}

export interface DemoSummary {
  senaryo: "demo" | "kucuk";
  aralik: { dateFrom: string; dateTo: string };
  top: number;
  hata: number;
  vardiya: Array<{ kod: string; ad: string; metre: number; cozgu: number }>;
}

/** Belirlenimli sözde rastgele (mulberry32) — aynı tohum aynı veri. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Beklenen sayıyı birikimli yuvarlayarak dağıtır: toplam oran tam tutar (Poisson gürültüsü kanıtı
 * tohuma bağlı kılardı); rastgelelik top metresinde ve hatanın anında kalır.
 */
function allocator(): (key: string, mean: number) => number {
  const acc = new Map<string, number>();
  return (key, mean) => {
    const before = acc.get(key) ?? 0;
    acc.set(key, before + mean);
    return Math.floor(before + mean) - Math.floor(before);
  };
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Pencerenin ilk fabrika günü. */
function firstDay(opts: DemoOptions): string {
  if (opts.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month)) throw new Error(`Ay YYYY-AA biçiminde olmalı: ${opts.month}`);
    return `${opts.month}-01`;
  }
  return addDays(factoryYmd(new Date()), -DEMO_DAYS);
}

/** Vardiyanın `minute`. dakikası (gece yarısını aşarsa ertesi gün). */
function shiftInstant(day: string, shiftStart: number, minute: number): Date {
  const m = shiftStart + minute;
  return m >= 1440 ? factoryMinuteOfDay(factoryDayStartOfKey(addDays(day, 1)), m - 1440) : factoryMinuteOfDay(factoryDayStartOfKey(day), m);
}

// Kütüphane kapısı fixture hedefi ister (CI `teks_ci` dahil); kullanıcı betiği ayrıca dar `tekserp_<ad>_test` kapısını sorar.
function assertTarget(): void {
  const block = fixtureHedefEngeli();
  if (block) throw new Error(block);
}

export async function cleanupDemo(): Promise<void> {
  assertTarget();
  const rolls = (await prisma.roll.findMany({ where: { barcode: starts }, select: { id: true } })).map((r) => r.id);
  await prisma.rollError.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rolls } } });
  await prisma.roll.deleteMany({ where: { id: { in: rolls } } });
  await prisma.doffEvent.deleteMany({ where: { code: starts } });
  await prisma.machine.deleteMany({ where: { code: starts } });
  await prisma.station.deleteMany({ where: { code: starts } });
  await prisma.defectType.deleteMany({ where: { code: starts } });
  await prisma.item.deleteMany({ where: { code: starts } });
  await prisma.shiftDefinition.deleteMany({ where: { code: { in: DEMO_SHIFTS.map((s) => s.code) } } });
}

export async function writeDemo(opts: DemoOptions = {}): Promise<DemoSummary> {
  assertTarget();
  await cleanupDemo();
  const day0 = firstDay(opts);
  const days = opts.small ? 1 : DEMO_DAYS;
  const rnd = seeded(20261025);
  const take = allocator();

  for (const [i, s] of DEMO_SHIFTS.entries()) {
    await prisma.shiftDefinition.create({ data: { code: s.code, name: s.name, startMinute: s.start, durationMinutes: SHIFT_MINUTES, sortOrder: -300 + i } });
  }
  const item = (await prisma.item.create({ data: { code: `${T}-KUMAS`, name: "Demo poplin", itemType: "FABRIC" }, select: { id: true } })).id;
  const station = (await prisma.station.create({ data: { code: `${T}-DOKUMA`, name: "Demo dokuma salonu", type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } })).id;
  const looms = new Map<string, string>();
  for (const l of LOOMS) {
    looms.set(l, (await prisma.machine.create({ data: { code: `${T}-${l}`, name: `Demo tezgah ${l}`, stationId: station }, select: { id: true } })).id);
  }
  const defect = async (k: string, group: string, name: string) =>
    (await prisma.defectType.create({ data: { code: `${T}-${k}`, name, defectGroup: group }, select: { id: true } })).id;
  const types = { COZGU: await defect("COZ", "COZGU", "Demo çözgü kopuğu"), ATKI: await defect("ATK", "ATKI", "Demo atkı kaçığı"), BOYA: await defect("BOY", "BOYA", "Demo boya lekesi") };
  const grade = (await firstGrade()).id;

  const summary: DemoSummary = {
    senaryo: opts.small ? "kucuk" : "demo",
    aralik: { dateFrom: factoryDayStartOfKey(day0).toISOString(), dateTo: factoryDayEndOfKey(addDays(day0, DEMO_DAYS - 1)).toISOString() },
    top: 0,
    hata: 0,
    vardiya: DEMO_SHIFTS.map((s) => ({ kod: s.code, ad: s.name, metre: 0, cozgu: 0 })),
  };
  let seq = 0;
  for (let d = 0; d < days; d++) {
    const day = addDays(day0, d);
    for (const [si, s] of DEMO_SHIFTS.entries()) {
      for (const loom of opts.small ? LOOMS.slice(0, 1) : LOOMS) {
        const qty = opts.small ? 1000 : 180 + Math.round(rnd() * 80);
        const doneAt = shiftInstant(day, s.start, SHIFT_MINUTES - 30);
        const doff = await prisma.doffEvent.create({
          data: { machineId: looms.get(loom)!, doffedAt: doneAt, pieceCount: 1, counterSource: "SIMULATED", code: `${T}-D${seq}` },
          select: { id: true },
        });
        const roll = await prisma.roll.create({
          data: { itemId: item, initialQty: qty, currentQty: qty, status: "WAREHOUSE", entrySource: "SUPPLIER_RECEIPT", qualityGradeId: grade, finalizedAt: doneAt, doffEventId: doff.id, barcode: `${T}-R${seq++}` },
          select: { id: true },
        });
        const counts = opts.small
          ? { COZGU: SMALL_WARP[si]!, ATKI: 0, BOYA: 0 }
          : {
              COZGU: take(`${s.code}-${loom}-COZGU`, (qty * s.warpRate * LOOM_FACTOR[loom]) / 1000),
              ATKI: take(`${s.code}-${loom}-ATKI`, (qty * OTHER_RATES.ATKI) / 1000),
              BOYA: take(`${s.code}-${loom}-BOYA`, (qty * OTHER_RATES.BOYA) / 1000),
            };
        // (top, metre, tür) tekildir: her tespit ayrı metrede; an vardiyanın içine yayılır.
        let meter = 0;
        const rows = (Object.keys(counts) as Array<keyof typeof counts>).flatMap((g) =>
          Array.from({ length: counts[g] }, () => ({
            rollId: roll.id,
            defectTypeId: types[g],
            origin: "PROCESS" as const,
            startMeter: (meter += 1 + Math.floor(rnd() * 10)),
            detectedAt: shiftInstant(day, s.start, Math.floor(rnd() * (SHIFT_MINUTES - 40))),
          })),
        );
        if (rows.length) await prisma.rollError.createMany({ data: rows });
        summary.top++;
        summary.hata += rows.length;
        summary.vardiya[si]!.metre += qty;
        summary.vardiya[si]!.cozgu += counts.COZGU;
      }
    }
  }
  return summary;
}
