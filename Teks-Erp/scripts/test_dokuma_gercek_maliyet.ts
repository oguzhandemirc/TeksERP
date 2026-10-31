// =============================================================================
// BEKÇİ — Dokuma gerçek maliyeti + verimlilik farkı raporu (SY-D3; TASARIM-2026-10-31 §5.5, §16.1, K7)
// =============================================================================
//   §1 ⭐ A + B yolu fikstüründe gerçek TL/m el hesabına eşit (10 sa × 120 TL ÷ (60+40 B + 20 A) = 10); iptal topu
//      ve geri alınmış indirmenin topu paydaya GİRMEZ
//   §2 koşumsuz iş → gerçek null + KOSUM_YOK, metresi "koşumsuz metre" kovasında; ücretsiz tezgâh → null (0 değil)
//   §3 NORM kipi (kârlılık makine süresi ayarı) → süre = koşum metresi ÷ norm (100 ÷ 50 = 2 sa → 240 ÷ 120 = 2)
//   §4 standart dokuma = dokuma satırları (tezgah + işçilik + enerji), iplik girmez; teorik/gerçek m/saat, duruş payı
//   §5 ⭐ sunum: kur yok → "eksik" (0 değil); kur var → TL/m ÷ kur; TRY'de çevirme yok
//   §6 ⭐ K7 tek kaynak: "saat × ücret" yalnız `machineHourCostTry`de; dokuma helper'ı ücreti kendisi çarpmaz
//   §7 rapor ucu kapıları (maliyet ∧ dokuma, rapor kapısı, `cost:read`) + katalog satırı
// NEGATİF SONDALAR (2026-10-31, hepsi kırmızı verdi, geri alındı):
//   ① `liveRollMetersByWeavingOrder`dan `status: { notIn: K18_DEAD_STATUSES }` kaldırıldı → §1a/§1c ❌
//   ② dokuma helper'ında `machineHourCostTry(h, rate)` yerine `h.mul(rate.hourRateTry)` → §6a ❌
//   ③ `money()` kur yokken 0 döndü → §5a ❌
// ⚠️ DB'ye yazar → `hedefDbEngeli()` ilk adım; fikstür `finally`de silinir.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, Prisma, RollEntrySource, RollStatus, StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { weavingActualCostTx, weavingOrdersActiveIn } from "../src/services/helpers/weaving-actual-cost.helper";
import { buildWeavingEfficiencySunumu, EKSIK, weavingEfficiencyTable, type WeavingEfficiencyReport } from "../src/services/reports/weaving-efficiency.report";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { REPORT_BY_KEY } from "../src/constants/report-catalog";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SYD3-${Date.now().toString(36).toUpperCase()}`;
const H = 3_600_000;
const D = (v: string | number) => new Prisma.Decimal(v);
const code = (s: string) => `${TAG}-${s}`.slice(0, 32);
const ids = { station: "", machines: [] as string[], orders: [] as string[], rolls: [] as string[], version: "" };
let mf: MaliyetFikstur | null = null;

async function fixture(now: Date) {
  mf = await fiksturKur("SYD3");
  const fabric = mf.fabricId;
  ids.station = (await prisma.station.create({ data: { name: `${TAG}-ST`, code: code("ST"), type: "INTERNAL", kind: StationKind.WEAVING, isActive: true }, select: { id: true } })).id;
  const mk = async (n: string) => {
    const m = await prisma.machine.create({ data: { stationId: ids.station, name: `${TAG} ${n}`, code: code(n), isActive: true }, select: { id: true } });
    ids.machines.push(m.id);
    return m.id;
  };
  const [t1, t2] = [await mk("T1"), await mk("T2")];
  await prisma.machineCostRate.create({ data: { machineId: t1, hourRateTry: "120.0000", normMPerHour: "50.00", clientToken: randomUUID(), createdAt: new Date(now.getTime() - 100 * H) } });
  const v = await prisma.standardCostVersion.create({
    data: {
      itemId: fabric, versionNo: 1, parameterSetId: mf.paramId, rawCostPerMTry: D("16"), totalCostPerMTry: D("16"),
      warpKgPerM: D("0.1"), weftKgPerM: D("0.1"), loomMPerHour: D("10"), fxRates: {}, inputSnapshot: {}, inputHash: "d".repeat(64), warnings: [],
      lines: { create: [["WARP_YARN", "10"], ["LOOM_MACHINE", "3"], ["LOOM_LABOR", "2"], ["ENERGY", "1"]].map(([component, amount], i) => ({ lineNo: i + 1, component: component as "WARP_YARN", label: component, amountPerMTry: D(amount) })) },
    },
    select: { id: true },
  });
  ids.version = v.id;
  const wo = async (n: string) => {
    const r = await prisma.weavingOrder.create({ data: { weavingOrderNumber: code(n), itemId: fabric, executionKind: "IN_HOUSE", status: "IN_PROGRESS" }, select: { id: true } });
    ids.orders.push(r.id);
    return r.id;
  };
  const [A, B, C] = [await wo("A"), await wo("B"), await wo("C")];
  const run = (machineId: string, weavingOrderId: string, p: Record<string, unknown>) =>
    prisma.machineRun.create({ data: { machineId, weavingOrderId, ...p } as never, select: { id: true } });
  const doff = (machineId: string, machineRunId: string, extra: Record<string, unknown> = {}) =>
    prisma.doffEvent.create({ data: { machineId, machineRunId, doffedAt: new Date(now.getTime() - 11 * H), pieceCount: 1, counterSource: MachineDataSource.OPERATOR, code: code(`D${randomUUID().slice(0, 6)}`).toUpperCase(), ...extra }, select: { id: true } });
  const roll = async (n: string, qty: number, link: { doffEventId?: string; weavingOrderId?: string }, status: RollStatus = RollStatus.STOCK) => {
    const r = await prisma.roll.create({ data: { barcode: code(`R${n}`), itemId: fabric, initialQty: qty, currentQty: qty, status, entrySource: RollEntrySource.WEAVING, ...link }, select: { id: true } });
    ids.rolls.push(r.id);
  };
  // A: 10 saatlik kapalı koşum (T1, 120 TL/sa), 1 sa duruş, 100 m koşum metresi.
  const rA = await run(t1, A, { startedAt: new Date(now.getTime() - 20 * H), endedAt: new Date(now.getTime() - 10 * H), producedM: 100, stopSecAtClose: 3600 });
  // Geri alınmış koşum maliyete girmez.
  await run(t1, A, { startedAt: new Date(now.getTime() - 30 * H), endedAt: new Date(now.getTime() - 25 * H), producedM: 50, revokedAt: now, revokeReason: "bekçi" });
  const dA = await doff(t1, rA.id);
  await roll("A1", 60, { doffEventId: dA.id });
  await roll("A2", 40, { doffEventId: dA.id });
  await roll("A3", 30, { doffEventId: dA.id }, RollStatus.CANCELLED); // iptal → paydaya girmez
  const dRev = await doff(t1, rA.id, { revokedAt: now, revokeReason: "bekçi" });
  await roll("A4", 70, { doffEventId: dRev.id }); // geri alınmış indirme → işe bağlı değil
  await roll("A5", 20, { weavingOrderId: A }); // A yolu (KK1 iş seçimi, tezgah bilinmiyor)
  // B: koşumsuz iş — yalnız A yolu topu.
  await roll("B1", 25, { weavingOrderId: B });
  // C: ücreti olmayan tezgâh.
  const rC = await run(t2, C, { startedAt: new Date(now.getTime() - 5 * H), endedAt: new Date(now.getTime() - 3 * H), producedM: 10, stopSecAtClose: 0 });
  const dC = await doff(t2, rC.id);
  await roll("C1", 10, { doffEventId: dC.id });
  return { A, B, C };
}

const eq = (d: Prisma.Decimal | null, v: string) => d !== null && d.toDecimalPlaces(6).eq(D(v));
const s = (d: Prisma.Decimal | null) => (d === null ? "null" : d.toString());

async function serviceSections(f: Awaited<ReturnType<typeof fixture>>, now: Date): Promise<WeavingEfficiencyReport> {
  console.log("\n§1 — A + B yolu, iptal süzgeci");
  const [a, b, c] = await weavingActualCostTx(prisma, [f.A, f.B, f.C], "OTURUM", now);
  check("§1a ⭐ payda = canlı top metresi: B yolu 60+40, A yolu 20 (iptal 30 · geri alınmış indirme 70 girmez)",
    eq(a!.metersViaRun, "100") && eq(a!.metersViaOrder, "20") && eq(a!.totalMeters, "120"), `${s(a!.metersViaRun)} + ${s(a!.metersViaOrder)}`);
  check("§1b koşum süresi 10 sa, maliyet 10 × 120 = 1200 TL (geri alınmış koşum girmez)", eq(a!.machineHours, "10") && eq(a!.actualCostTry, "1200"), `${s(a!.machineHours)} sa · ${s(a!.actualCostTry)}`);
  check("§1c ⭐ gerçek dokuma TL/m = 1200 ÷ 120 = 10 (el hesabı)", eq(a!.actualPerMTry, "10"), s(a!.actualPerMTry));
  check("§1d süre kaynağı OTURUM varsayılanında KOSUM; tezgâh kodu satırda", a!.timeSource === "KOSUM" && a!.machines.length === 1 && a!.missing.length === 0, JSON.stringify(a!.missing));

  console.log("\n§2 — koşumsuz iş, ücretsiz tezgâh");
  check("§2a koşumsuz iş: gerçek null + KOSUM_YOK, metresi 25 (koşumsuz kova)", b!.actualPerMTry === null && b!.actualCostTry === null && b!.missing.includes("KOSUM_YOK") && eq(b!.metersViaOrder, "25"));
  check("§2b ⭐ ücreti olmayan tezgâh: maliyet null + MAKINE_TARIFESI (0 DEĞİL)", c!.actualCostTry === null && c!.actualPerMTry === null && c!.missing.includes("MAKINE_TARIFESI"), s(c!.actualCostTry));

  console.log("\n§3 — NORM kipi");
  const [an] = await weavingActualCostTx(prisma, [f.A], "NORM", now);
  check("§3a NORM: 100 m ÷ 50 m/sa = 2 sa → 240 TL ÷ 120 m = 2", an!.timeSource === "NORM" && eq(an!.machineHours, "2") && eq(an!.actualPerMTry, "2"), `${s(an!.machineHours)} · ${s(an!.actualPerMTry)}`);

  console.log("\n§4 — standart ve verimlilik kolonları");
  check("§4a standart dokuma = 3 + 2 + 1 = 6 (çözgü ipliği girmez)", eq(a!.standardPerMTry, "6") && !a!.standardPick, s(a!.standardPerMTry));
  check("§4b teorik m/sa sürümden (10), gerçek 120 ÷ 10 = 12; duruş payı 3600 ÷ 36000 = 0,1",
    eq(a!.theoreticalMPerHour, "10") && eq(a!.realizedMPerHour, "12") && eq(a!.stopShare, "0.1"), `${s(a!.realizedMPerHour)} · ${s(a!.stopShare)}`);
  const range = { from: new Date(now.getTime() - 48 * H), to: new Date(now.getTime() + H) };
  const active = await weavingOrdersActiveIn(prisma, range);
  check("§4c rapor iş kümesi aralıkta koşumu ya da topu olan işleri alır (A, B, C)", [f.A, f.B, f.C].every((id) => active.includes(id)), `${active.length}`);
  return { currency: "TRY", fxRate: null, rows: [a!, b!, c!], runlessMeters: "25.000" };
}

function presentationSection(r: WeavingEfficiencyReport): void {
  console.log("\n§5 — sunum dövizi ve kur");
  const window = resolveCoreDayRange({}, 30);
  const noFx = weavingEfficiencyTable({ ...r, currency: "USD", fxRate: null }).satirlar[0]!;
  check("§5a ⭐ USD kuru yok → standart/gerçek/fark hücresi \"eksik\" (0 değil), durum eksik",
    noFx.standartM === EKSIK && noFx.gercekM === EKSIK && noFx.fark === EKSIK && String(noFx.durum).startsWith(EKSIK), JSON.stringify(noFx));
  const fx = weavingEfficiencyTable({ ...r, currency: "USD", fxRate: "40" }).satirlar[0]!;
  check("§5b kur 40 → gerçek 10 TL/m = 0,25 USD/m; fark %66,7", fx.gercekM === 0.25 && fx.standartM === 0.15 && fx.farkYuzde === 66.7, JSON.stringify(fx));
  const tl = weavingEfficiencyTable(r).satirlar;
  check("§5c TRY: çevirme yok; koşumsuz iş satırı \"eksik: koşum açılmamış\"", tl[0]!.gercekM === 10 && String(tl[1]!.durum).includes("koşum açılmamış") && tl[2]!.gercekM === null);
  const sun = buildWeavingEfficiencySunumu(r, window);
  check("§5d ana sayı yalnız ölçülebilen işlerden: (1200 − 6×120) ÷ 720 = %66,7; koşumsuz metre yan sayıda 25",
    sun.anaSayi.deger === 66.7 && sun.yanSayilar[1]!.deger === 25 && sun.uyarilar.some((u) => u.includes("koşumsuz")), `${sun.anaSayi.deger}`);
}

function structuralSection(): void {
  console.log("\n§6 — K7 tek kaynak");
  const src = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const weaving = src("src/services/helpers/weaving-actual-cost.helper.ts");
  const prof = src("src/services/helpers/profitability-machine.helper.ts");
  check("§6a ⭐ dokuma helper'ı ücreti kendisi çarpmaz (`hourRateTry` yok) ve `machineHourCostTry`i çağırır",
    !weaving.includes("hourRateTry") && /machineHourCostTry\(/.test(weaving));
  check("§6b kârlılık helper'ında `hourRateTry` çarpımı TEK yerde (paylaşılan fonksiyon)",
    (prof.match(/\.mul\([^)]*hourRateTry\)/g) ?? []).length === 1 && /export function machineHourCostTry/.test(prof));
  check("§6c payda zinciri tek dosyada (`liveRollMetersByWeavingOrder`), ölü top süzgeci orada",
    /liveRollMetersByWeavingOrder/.test(weaving) && /status: \{ notIn: K18_DEAD_STATUSES \}[\s\S]*doffEvent: \{ revokedAt: null, machineRun/.test(src("src/services/helpers/weaving-order-of-roll.helper.ts")));

  console.log("\n§7 — uç ve katalog");
  const route = src("src/routes/reports/maliyet.report.routes.ts");
  check("§7a uç: dokuma kapısı → rapor kapısı → `cost:read` (maliyet kapısı router'da)",
    /"\/dokuma-verimlilik", requireDokumaEnabled, requireReportOpen\("maliyet\/dokuma-verimlilik"\), requirePermission\("cost:read"\)/.test(route) && /router\.use\(verifyToken, requireMaliyetEnabled\)/.test(route));
  const e = REPORT_BY_KEY.get("maliyet/dokuma-verimlilik");
  check("§7b katalog satırı v2, hazır, izin `cost:read`, modül maliyet", !!e && e.nesil === "v2" && e.izin === "cost:read" && e.modul === "maliyetEnabled");
}

async function cleanup(): Promise<void> {
  try {
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineCostRate.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    if (ids.version) {
      await prisma.standardCostLine.deleteMany({ where: { versionId: ids.version } });
      await prisma.standardCostVersion.delete({ where: { id: ids.version } });
    }
    if (mf) await fiksturSil(mf);
  } catch (err) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (err as Error).message);
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 1; return; }
  console.log("\n=== Dokuma gerçek maliyeti + verimlilik farkı (SY-D3) ===");
  const now = new Date();
  const f = await fixture(now);
  const r = await serviceSections(f, now);
  presentationSection(r);
  structuralSection();
}

main()
  .catch((e) => { fail++; console.error("❌ Bekçi hata ile durdu:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
