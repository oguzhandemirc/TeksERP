// =============================================================================
// ANALİZ FİKSTÜRÜ — `test_rapor_istatistik` için BİLİNEN İLİŞKİLİ dolu veri (R3-ISTAT)
// =============================================================================
// Boş veriyle kanıt yok: Mayıs 2097'de gündüz/gece iki vardiya, 10 gün × iki top (gündüz 800+40g m,
// gece 600+70g m; toplam 10.200 / 9.850 m). Saha tespiti (PROCESS): gündüz 30 çözgü + 20 atkı, gece
// 60 çözgü + 20 atkı ⇒ çözgü 1000 m'de 2,9412 / 6,0914 (gece ≈ 2,07 katı). Temmuz 2097 küçük pencere:
// 3 + 6 = 9 çözgü (örneklem eşiği altı). Vardiya tanımları `sortOrder -100` (fikstür kuralı önce eşleşir).
// İdempotent: önek `TSA-FIX` taşıyan her şey önce silinir; yalnız `tekserp_*_test` DB (`hedefDbEngeli`).
// =============================================================================
import prisma, { pool } from "../../src/lib/prisma";
import { hedefDbEngeli } from "./hedef-db-kapisi";
import { firstGrade, roleGrade } from "../fixture-quality-grade";

export const ANALYSIS_TAG = "TSA-FIX";
/** Fabrika ayı 2097-05 ve 2097-07 (İstanbul UTC+3). */
export const ANALYSIS_RANGE = { dateFrom: "2097-04-30T21:00:00.000Z", dateTo: "2097-05-31T20:59:59.999Z" };
export const SMALL_RANGE = { dateFrom: "2097-06-30T21:00:00.000Z", dateTo: "2097-07-31T20:59:59.999Z" };
export const DAY_SHIFT = "TSAG";
export const NIGHT_SHIFT = "TSAN";
export const DAYS = 10;
export const dayQty = (d: number): number => 800 + 40 * d;
export const nightQty = (d: number): number => 600 + 70 * d;
export const DEFECTS = { day: { COZGU: 30, ATKI: 20 }, night: { COZGU: 60, ATKI: 20 }, small: { day: 3, night: 6 } } as const;

const T = ANALYSIS_TAG;
const starts = { startsWith: T };
/** Gündüz 12:00 = 09:00Z, gece 23:00 = 20:00Z (İstanbul). */
const at = (month: number, d: number, night: boolean, minute = 0): Date =>
  new Date(Date.UTC(2097, month - 1, d, night ? 20 : 9, minute));

export async function teardownAnalysisFixture(): Promise<void> {
  const rolls = (await prisma.roll.findMany({ where: { barcode: starts }, select: { id: true } })).map((r) => r.id);
  await prisma.rollError.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rolls } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rolls } } });
  await prisma.roll.deleteMany({ where: { id: { in: rolls } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrder: { workOrderNumber: starts } } });
  await prisma.workOrder.deleteMany({ where: { workOrderNumber: starts } });
  await prisma.station.deleteMany({ where: { code: starts } });
  await prisma.defectType.deleteMany({ where: { code: starts } });
  await prisma.item.deleteMany({ where: { code: starts } });
  await prisma.shiftDefinition.deleteMany({ where: { code: { in: [DAY_SHIFT, NIGHT_SHIFT] } } });
  await prisma.reportRun.deleteMany({ where: { user: { username: `${T}-op`.toLowerCase() } } });
  await prisma.user.deleteMany({ where: { username: `${T}-op`.toLowerCase() } });
}

export async function setupAnalysisFixture(): Promise<{ operatorId: string }> {
  await teardownAnalysisFixture();
  await prisma.shiftDefinition.create({ data: { code: DAY_SHIFT, name: "Gündüz", startMinute: 8 * 60, durationMinutes: 720, sortOrder: -100 } });
  await prisma.shiftDefinition.create({ data: { code: NIGHT_SHIFT, name: "Gece", startMinute: 20 * 60, durationMinutes: 720, sortOrder: -99 } });
  const op = await prisma.user.create({ data: { username: `${T}-op`.toLowerCase(), passwordHash: "x", fullName: `${T} Operatör` }, select: { id: true } });
  const item = (await prisma.item.create({ data: { code: `${T}-I1`, name: `${T} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const first = await firstGrade();
  const second = await roleGrade("SECOND");
  const defect = async (k: string, group: string) => (await prisma.defectType.create({ data: { code: `${T}-${k}`, name: `${T} ${k}`, defectGroup: group }, select: { id: true } })).id;
  const cozgu = await defect("COZ", "COZGU");
  const atki = await defect("ATK", "ATKI");

  let n = 0;
  const roll = async (qty: number, gradeId: string, finalizedAt: Date) =>
    (await prisma.roll.create({
      data: { itemId: item, initialQty: qty, currentQty: qty, status: "WAREHOUSE", entrySource: "SUPPLIER_RECEIPT", qualityGradeId: gradeId, finalizedAt, barcode: `${T}-R${n++}` },
      select: { id: true },
    })).id;
  const dayRolls: string[] = [];
  const nightRolls: string[] = [];
  for (let d = 1; d <= DAYS; d++) {
    dayRolls.push(await roll(dayQty(d), first.id, at(5, d, false)));
    nightRolls.push(await roll(nightQty(d), d % 2 === 0 ? second.id : first.id, at(5, d, true)));
  }
  // (top, metre, tür) tekildir: her tespit ayrı metrede.
  let meter = 0;
  const error = (rollId: string, defectTypeId: string, detectedAt: Date) =>
    prisma.rollError.create({ data: { rollId, defectTypeId, origin: "PROCESS", detectedAt, startMeter: ++meter } });
  // Hatalar 10 güne yayılır; dakika farkı aynı anı tekrarlamasın diye.
  const spread = async (rolls: string[], night: boolean, defectTypeId: string, count: number) => {
    for (let i = 0; i < count; i++) await error(rolls[i % DAYS]!, defectTypeId, at(5, (i % DAYS) + 1, night, Math.floor(i / DAYS)));
  };
  await spread(dayRolls, false, cozgu, DEFECTS.day.COZGU);
  await spread(dayRolls, false, atki, DEFECTS.day.ATKI);
  await spread(nightRolls, true, cozgu, DEFECTS.night.COZGU);
  await spread(nightRolls, true, atki, DEFECTS.night.ATKI);

  // Küçük pencere (Temmuz): 1000 + 1000 m, 3 + 6 çözgü.
  const sd = await roll(1000, first.id, at(7, 5, false));
  const sn = await roll(1000, first.id, at(7, 5, true));
  for (let i = 0; i < DEFECTS.small.day; i++) await error(sd, cozgu, at(7, 5, false, i));
  for (let i = 0; i < DEFECTS.small.night; i++) await error(sn, cozgu, at(7, 5, true, i));

  // İstasyon akışı (kişi adı boyutu sondası): bir operatör, iki istasyon.
  const station = async (k: string) => (await prisma.station.create({ data: { code: `${T}-${k}`, name: `${T} ${k}`, type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } })).id;
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${T}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  for (const [seq, k] of [[1, "S1"], [2, "S2"]] as const) {
    const stepId = (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: await station(k), stepSequence: seq }, select: { id: true } })).id;
    await prisma.rollMovement.create({ data: { rollId: dayRolls[seq]!, workOrderStepId: stepId, qtyIn: 500, enteredAt: at(5, 3, false), exitedAt: at(5, 3, false, 30), operatorId: op.id } });
  }
  return { operatorId: op.id };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  if (process.argv[2] === "sil") await teardownAnalysisFixture();
  else console.log(JSON.stringify(await setupAnalysisFixture()));
}

if (process.argv[1]?.endsWith("fixture-analiz.ts")) {
  main()
    .catch((e) => {
      console.error("HATA:", e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
