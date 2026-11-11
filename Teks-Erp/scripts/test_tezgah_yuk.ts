// =============================================================================
// test_tezgah_yuk — Seyitoğlu 3. bölüm L2: tezgâh yük çizelgesi (`getLoomLoad`, GET /api/weaving-orders/loom-load)
// =============================================================================
//   §0 boş fabrika → looms [] · unassigned [] (DB'de başka tezgâh/açık iş varsa beyanla atlanır)
//   §1 açık koşumlu iş: kalan = plan − üretilen; saat = `weavingHoursDecimal` (öneri önizlemesiyle AYNI fonksiyon);
//      boşalma = generatedAt + Σ saat; levent-takılı iş MOUNTED_BEAM olarak koşumdan sonra sıralanır
//   §2 bilinmeyen terim: devir boş → saat null, toplam null, boşalma null (0 sayılmaz); iki tezgâhta açık iş → null
//   §3 işsiz tezgâh total 0 · boşalma = generatedAt; tezgâhsız açık iş `unassigned`te; fason/kapalı iş hiç yok
//   §4 performans: model erişimi sabit (5) — tezgâh/iş sayısı arttıkça değişmez
// Negatif sonda (2026-11-12): toplam null terimi 0 sayınca (`c.hours ?? 0`) §2b §2c §2d ❌ (12/3); geri alındı.
// Çalıştır: npx tsx scripts/test_tezgah_yuk.ts (yalnız test DB; devere/dokuma ayarını yazar, birebir geri yükler → hedefDbEngeli)
// =============================================================================
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { LOOM_MACHINE_WHERE } from "../src/constants/loom-shift";
import { getLoomLoad, type LoomLoadResponse } from "../src/services/loom-load.service";
import { weavingHoursDecimal } from "../src/services/helpers/production-proposal-insight.helper";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const atlama = atlamaDefteri((m) => { fail++; console.log(`❌ ${m}`); });

const made = { station: "", looms: [] as string[], beams: [] as string[], orders: [] as string[], runs: [] as string[] };
let fx: MaliyetFikstur | null = null;
// Levent fikstürü servis yolundan geçer (sar/tak) → devere + takılı levent takibi açık; birebir geri yüklenir.
const KEYS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DOKUMA_ENABLED];
const saved = new Map<string, unknown>();
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

function spy(models: string[]): { count: () => number; restore: () => void } {
  let n = 0;
  const client = prisma as unknown as Record<string, unknown>;
  const originals = models.map((m) => [m, client[m]] as const);
  for (const [m, orig] of originals) Object.defineProperty(client, m, { get: () => (n++, orig), configurable: true });
  return { count: () => n, restore: () => originals.forEach(([m, orig]) => Object.defineProperty(client, m, { value: orig, configurable: true, writable: true })) };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  console.log("=== TEZGÂH YÜK ÇİZELGESİ BEKÇİSİ ===\n── §0 Boş fabrika ──");
  const otherLooms = await prisma.machine.count({ where: LOOM_MACHINE_WHERE });
  const otherOrders = await prisma.weavingOrder.count({ where: { status: { in: [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS] }, executionKind: WeavingExecutionKind.IN_HOUSE } });
  if (otherLooms === 0 && otherOrders === 0) {
    const e = await getLoomLoad();
    check("§0 ⭐ tezgâh ve açık iş yok → looms [] · unassigned [] · varsayım beyanlı", e.looms.length === 0 && e.unassigned.length === 0 && e.assumption === "CONTINUOUS_24H_FROM_NOW", JSON.stringify(e));
  } else {
    atlama.atla("§0 boş fabrika", `DB'de ${otherLooms} tezgâh / ${otherOrders} açık iş var (boş fabrika kurulamaz)`);
  }

  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of KEYS) await setSetting(k, true);
  fx = await fiksturKur("TEST-SYL2-");
  const f = fx;
  made.station = (await prisma.station.create({ data: { name: `${f.tag}-DOKUMA`, code: `${f.tag}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;
  const loom = async (s: string, plan: { planRpm?: number; planEfficiencyPct?: number }) => {
    const id = (await prisma.machine.create({ data: { stationId: made.station, name: `${f.tag}-${s}`, code: `${f.tag}-${s}`.slice(0, 32), warpBeamSlots: 2, ...plan }, select: { id: true } })).id;
    made.looms.push(id);
    return id;
  };
  let seq = 0;
  const order = async (plannedM: number | null, opts: { status?: WeavingOrderStatus; kind?: WeavingExecutionKind; start?: Date } = {}) => {
    const kind = opts.kind ?? WeavingExecutionKind.IN_HOUSE;
    const sub = kind === WeavingExecutionKind.SUBCONTRACTED ? (await ensureTestDyeHouse()).id : null;
    const id = (await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `${f.tag}-W${++seq}`, itemId: f.fabricId, executionKind: kind, subcontractorId: sub,
        status: opts.status ?? WeavingOrderStatus.PLANNED, plannedM: plannedM == null ? null : new Prisma.Decimal(plannedM), plannedStartDate: opts.start ?? null,
      },
      select: { id: true },
    })).id;
    made.orders.push(id);
    return id;
  };
  const run = async (machineId: string, weavingOrderId: string, startedAt: Date) => {
    made.runs.push((await prisma.machineRun.create({ data: { machineId, weavingOrderId, startedAt, itemId: f.fabricId }, select: { id: true } })).id);
  };
  const sub = await ensureTestDyeHouse();
  const beam = async (mountOn: string, weavingOrderId: string) => {
    const p = await createWarpBeam({ warpSpecId: f.warpSpecId, plannedLengthM: 2000, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    made.beams.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 2000, kgSource: WarpKgSource.THEORETICAL });
    await mountBeam(p.data.id, { machineId: mountOn, position: 1 });
    await prisma.warpBeam.update({ where: { id: p.data.id }, data: { weavingOrderId } });
  };

  const A = await loom("A", { planRpm: 500, planEfficiencyPct: 80 });
  const B = await loom("B", { planEfficiencyPct: 80 }); // devir boş
  const C = await loom("C", { planRpm: 400, planEfficiencyPct: 90 }); // işsiz
  const D1 = await loom("D1", { planRpm: 500, planEfficiencyPct: 80 });
  const D2 = await loom("D2", { planRpm: 500, planEfficiencyPct: 80 });
  const t0 = new Date(Date.now() - 3_600_000);
  const wRun = await order(1200, { status: WeavingOrderStatus.IN_PROGRESS });
  const wBeam = await order(600, { start: new Date(Date.now() + 86_400_000) });
  const wB = await order(800, { status: WeavingOrderStatus.IN_PROGRESS });
  const wShared = await order(1000, { status: WeavingOrderStatus.IN_PROGRESS });
  const wFree = await order(500, { start: new Date(Date.now() + 2 * 86_400_000) });
  const wSub = await order(700, { kind: WeavingExecutionKind.SUBCONTRACTED });
  const wDone = await order(900, { status: WeavingOrderStatus.COMPLETED });
  await run(A, wRun, t0);
  await beam(A, wBeam);
  await run(B, wB, t0);
  await run(D1, wShared, t0);
  await run(D2, wShared, t0);

  const now = new Date();
  const r: LoomLoadResponse = await getLoomLoad(now);
  const row = (id: string) => r.looms.find((l) => l.machineId === id);

  console.log("\n── §1 Saat ve boşalma ──");
  const a = row(A);
  const jRun = a?.jobs[0], jBeam = a?.jobs[1];
  const hRun = weavingHoursDecimal(1200, 500, 80, 28)!, hBeam = weavingHoursDecimal(600, 500, 80, 28)!;
  check("§1a tezgâh satırı plan alanlarını taşır", a?.planRpm === 500 && a?.planEfficiencyPct === 80 && a?.code === `${f.tag}-A`.slice(0, 32), JSON.stringify({ planRpm: a?.planRpm, eff: a?.planEfficiencyPct }));
  check("§1b açık koşum OPEN_RUN, başlangıçla; kalan = plan (top yok) · üretilen null · atkı sıklığı ürün kartından (28)",
    jRun?.weavingOrderId === wRun && jRun.assignment === "OPEN_RUN" && jRun.runStartedAt === t0.toISOString() && jRun.remainingM === 1200 && jRun.producedM === null && jRun.picksPerCm === 28, JSON.stringify(jRun));
  check("§1c ⭐ saat = weavingHoursDecimal(kalan, devir, randıman, atkı) — K1 ile aynı fonksiyon", jRun?.estimatedHours === hRun.toDecimalPlaces(2).toNumber(), `${jRun?.estimatedHours} vs ${hRun.toString()}`);
  check("§1d levent-takılı iş koşumdan SONRA, MOUNTED_BEAM · runStartedAt null", jBeam?.weavingOrderId === wBeam && jBeam.assignment === "MOUNTED_BEAM" && jBeam.runStartedAt === null && a?.jobs.length === 2, JSON.stringify(a?.jobs.map((j) => j.assignment)));
  const total = hRun.plus(hBeam);
  check("§1e toplam = Σ saat; boşalma = generatedAt + Σ (kesintisiz 24 saat)",
    a?.totalEstimatedHours === total.toDecimalPlaces(2).toNumber() && a?.estimatedFreeAtIfContinuous === new Date(now.getTime() + total.mul(3_600_000).round().toNumber()).toISOString() && r.generatedAt === now.toISOString(),
    `${a?.totalEstimatedHours} · ${a?.estimatedFreeAtIfContinuous}`);

  console.log("\n── §2 Bilinmeyen terim ──");
  const b = row(B);
  check("§2a devir boş → iş saati null (varsayılan uydurulmaz)", b?.jobs[0]?.weavingOrderId === wB && b.jobs[0].estimatedHours === null && b.planRpm === null);
  check("§2b ⭐ tek null terim toplamı kapatır → totalEstimatedHours null", b?.totalEstimatedHours === null, String(b?.totalEstimatedHours));
  check("§2c ⭐ toplam null → boşalma null", b?.estimatedFreeAtIfContinuous === null, String(b?.estimatedFreeAtIfContinuous));
  const d1 = row(D1), d2 = row(D2);
  check("§2d iki tezgâhta açık iş → her iki satırda sharedAcrossLooms true, saat null, toplam null",
    [d1, d2].every((d) => d?.jobs[0]?.weavingOrderId === wShared && d.jobs[0].sharedAcrossLooms && d.jobs[0].estimatedHours === null && d.totalEstimatedHours === null));

  console.log("\n── §3 İşsiz tezgâh, atanmamış, kapsam ──");
  const c = row(C);
  check("§3a işsiz tezgâh: jobs [] · total 0 · boşalma = generatedAt", c?.jobs.length === 0 && c.totalEstimatedHours === 0 && c.estimatedFreeAtIfContinuous === now.toISOString());
  const un = r.unassigned.filter((u) => made.orders.includes(u.weavingOrderId)).map((u) => u.weavingOrderId);
  check("§3b ⭐ tezgâhsız açık iş yalnız unassigned'da (tek kez)", JSON.stringify(un) === JSON.stringify([wFree]), JSON.stringify(un));
  const everywhere = [...r.looms.flatMap((l) => l.jobs.map((j) => j.weavingOrderId)), ...r.unassigned.map((u) => u.weavingOrderId)];
  check("§3c fason ve tamamlanmış iş hiçbir yerde yok", !everywhere.includes(wSub) && !everywhere.includes(wDone));
  check("§3d tezgâh sırası koda göre (A, B, C, D1, D2)", JSON.stringify(r.looms.filter((l) => made.looms.includes(l.machineId)).map((l) => l.machineId)) === JSON.stringify([A, B, C, D1, D2]));

  console.log("\n── §4 Performans ──");
  const models = ["machine", "weavingOrder", "machineRun", "warpBeam", "roll"];
  const s1 = spy(models); await getLoomLoad(); const n1 = s1.count(); s1.restore();
  const extraLooms = await Promise.all(["E1", "E2", "E3"].map((s) => loom(s, { planRpm: 450, planEfficiencyPct: 85 })));
  for (const l of extraLooms) await run(l, await order(400, { status: WeavingOrderStatus.IN_PROGRESS }), t0);
  for (let i = 0; i < 3; i++) await order(300);
  const s2 = spy(models); const t = Date.now(); const big = await getLoomLoad(); const ms = Date.now() - t; const n2 = s2.count(); s2.restore();
  check("§4a ⭐ model erişimi sabit: 5 tezgâh/7 iş = 8 tezgâh/13 iş = 5 (N+1 yok)", n1 === 5 && n2 === 5, `${n1} → ${n2} · ${big.looms.length} tezgâh, ${ms} ms`);
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    const t = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.error("temizlik:", (e as Error).message); } };
    await t(() => prisma.machineRun.deleteMany({ where: { id: { in: made.runs } } }));
    await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } }));
    await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } }));
    await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.beams, ...made.orders] } } }));
    await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: made.orders } } }));
    await t(() => prisma.machine.deleteMany({ where: { id: { in: made.looms } } }));
    if (made.station) await t(() => prisma.station.deleteMany({ where: { id: made.station } }));
    if (fx) await t(() => fiksturSil(fx!));
    for (const [key, value] of saved) {
      if (value === undefined) await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
      else await t(() => setSetting(key, value));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
