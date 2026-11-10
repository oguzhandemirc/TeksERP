// =============================================================================
// BEKÇİ — İE LİSTESİ METRE ÖZETİ + "BEYANDAN UZUN" SÜZGECİ (GK metre, 2026-11-10)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_ie_liste_metre.ts
//
// NEDEN: İE listesi satır başına beyan ↔ ölçülen özetini taşır (opt-in `withMeterSummary=true`) ve
// `filter[meterCheck]=LONGER` ile yalnız beyandan uzun İE'leri süzer. Hesap tek çözücüde (`meter-compare.helper`),
// toplam tek fonksiyonda (`meterTotalsOf`); liste özeti İE başına sorgu atmaz.
//
// ÖLÇÜLENLER:
//   §1 toplu özet = tekil uç (`workOrderMeterComparison.totals`) her İE için; uzun/tolerans/kısa/ölçümsüz/topsuz;
//      partiyi başka İE'den paylaşan (kendi topunda ölçüm yok) İE de uzun
//   §2 opt-in: parametresiz liste satırında `meterSummary` anahtarı YOK; parametreyle var ve özetle aynı
//   §3 süzgeç: liste (cursor) + withTotal sayımı + offset yalnız uzun İE'ler
//   §4 tanınmayan değer 400 INVALID_FILTER_VALUE
//   §5 50 satırlık sayfada ek süre (bilgi satırı, eşik yok)
// Negatif sondalar (2026-11-10): özetin parti kümesi yalnız ilk kenarla kurulunca (`keysOf` İE başına tek parti)
// §1 kırmızı; süzgeç `longerThanDeclared` yerine `diffM > 0` okuyunca §3 kırmızı — ikisi de geri alındı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { workOrderMeterComparison, workOrderMeterSummaries } from "../src/services/meter-comparison.service";
import { WorkOrderService } from "../src/services/workorder.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-ILM-${STAMP}`;
const fx = { woIds: [] as string[], rollIds: [] as string[], stationId: null as string | null, itemId: null as string | null };
interface Ctx { actor: string; grade: string; item: string; station: string }
interface Wo { id: string; step: string }

async function mkWo(c: Ctx, name: string): Promise<Wo> {
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-${name}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: c.item,
      steps: { create: [{ stationId: c.station, stepSequence: 1, status: StepStatus.ACTIVE }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  return { id: wo.id, step: wo.steps[0]!.id };
}

async function mkRoll(c: Ctx, o: { qty: number; stepId: string; parent?: string; produced?: boolean }): Promise<string> {
  const r = await prisma.roll.create({
    data: { itemId: c.item, width: 150, initialQty: o.qty, currentQty: o.qty, qualityGrade: c.grade,
      status: o.parent ? RollStatus.WAREHOUSE : RollStatus.IN_PRODUCTION,
      entrySource: o.parent ? RollEntrySource.TAMBUR_SPLIT : RollEntrySource.SUBCONTRACTOR_RETURN,
      parentRollId: o.parent ?? null, ...(o.produced ? { producedInStepId: o.stepId } : { currentStepId: o.stepId }) },
    select: { id: true },
  });
  fx.rollIds.push(r.id);
  return r.id;
}

/** Kök (İE'ye giriş = beyan) + kesim çocukları (CUT okuması). */
async function mkParty(c: Ctx, wo: Wo, declared: number, cuts: number[]): Promise<{ root: string; kids: string[] }> {
  const root = await mkRoll(c, { qty: declared, stepId: wo.step });
  await prisma.rollMovement.create({ data: { rollId: root, workOrderStepId: wo.step, qtyIn: declared } });
  const kids: string[] = [];
  for (const m of cuts) {
    const k = await mkRoll(c, { qty: m, stepId: wo.step, parent: root, produced: true });
    kids.push(k);
    await prisma.rollMeterReading.create({
      data: { rollId: k, workOrderStepId: wo.step, phase: MeterPhase.CUT, meters: m, source: MachineDataSource.MACHINE,
        basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: c.actor },
    });
  }
  return { root, kids };
}

const svc = new WorkOrderService();
// Kapsam fikstür kumaşıyla (liste `filter[targetItemId]`) — ortam verisine bağımlı değil.
const listReq = (q: Record<string, string>) => ({ query: { "filter[targetItemId]": fx.itemId!, ...q } }) as unknown as Request;
type Row = { id: string; meterSummary?: unknown };
async function list(q: Record<string, string>): Promise<{ rows: Row[]; total?: number; err?: { status: number; code: string | null } }> {
  try {
    const r = (await svc.findAll(listReq(q))) as unknown as { data: Row[]; pagination: { totalEstimate?: number; total?: number } };
    return { rows: r.data, total: r.pagination.totalEstimate ?? r.pagination.total };
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { rows: [], err: { status: x.statusCode ?? 500, code: x.details?.code ?? null } };
  }
}

async function main(): Promise<void> {
  console.log("=== İE listesi metre özeti + Beyandan uzun süzgeci ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const actor = await testActorId();
  const g = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!g) throw new Error("FIRST rollü kalite yok — seed'siz DB");
  const item = await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST ILM kumaş ${STAMP}`, unit: "MT", itemType: ItemType.FABRIC }, select: { id: true } });
  fx.itemId = item.id;
  const st = await prisma.station.create({ data: { code: `${P}-T`.slice(0, 32), name: `TEST ILM tambur ${STAMP}`, type: StationType.INTERNAL, kind: StationKind.TAMBUR }, select: { id: true } });
  fx.stationId = st.id;
  const c: Ctx = { actor, grade: g.code, item: item.id, station: st.id };

  const A = await mkWo(c, "A");
  const pa = await mkParty(c, A, 1000, [400, 620]); // 1020 → uzun (%2)
  const B = await mkWo(c, "B");
  await mkParty(c, B, 1000, [500, 498]); // 998 → tolerans içi
  const C = await mkWo(c, "C");
  await mkParty(c, C, 1000, [900]); // kısa
  const D = await mkWo(c, "D");
  await mkParty(c, D, 500, []); // ölçüm yok
  const E = await mkWo(c, "E");
  await mkRoll(c, { qty: 400, stepId: E.step, parent: pa.kids[0] }); // A'nın partisi, kendi topunda ölçüm yok
  const F = await mkWo(c, "F"); // topsuz
  const H = await mkWo(c, "H");
  await mkParty(c, H, 1000, [1010]); // ikinci parti ile H'de karışık
  await mkParty(c, H, 1000, [950]);
  const all = [A, B, C, D, E, F, H];

  // ── §1 toplu = tekil ───────────────────────────────────────────────────────
  section("§1 toplu özet = tekil uç totals");
  const sums = await workOrderMeterSummaries(all.map((w) => w.id));
  for (const [n, w] of Object.entries({ A, B, C, D, E, F, H })) {
    const one = await workOrderMeterComparison(w.id);
    const s = sums.get(w.id);
    const same = one.parties.length === 0 ? s === null
      : s != null && s.declaredM === one.totals.declaredM && s.measuredMaxM === one.totals.measuredMaxM && s.billedM === one.totals.billedM && s.diffM === one.totals.diffM
        && s.longerThanDeclared === one.parties.some((p) => p.longerThanDeclared);
    check(`§1 ${n}: toplu özet tekil uçla aynı`, same, JSON.stringify({ s, t: one.totals }));
  }
  const sa = sums.get(A.id);
  check("§1a A uzun: 1000 → 1020, +20 (%2), faturalanan 1020", sa?.longerThanDeclared === true && sa.declaredM === 1000 && sa.measuredMaxM === 1020 && sa.billedM === 1020 && sa.diffM === 20 && sa.diffPct === 2 && !sa.withinTolerance, JSON.stringify(sa));
  const sb = sums.get(B.id);
  check("§1b B tolerans içi (998/1000)", sb?.withinTolerance === true && !sb.longerThanDeclared && sb.billedM === 1000, JSON.stringify(sb));
  const sc = sums.get(C.id);
  check("§1c C kısa (900/1000): uzun değil, tolerans dışı, fark −100", sc?.longerThanDeclared === false && !sc.withinTolerance && sc.diffM === -100, JSON.stringify(sc));
  const sd = sums.get(D.id);
  check("§1d D ölçümsüz: beyan 500, ölçüm/fark null", sd?.declaredM === 500 && sd.measuredMaxM === null && sd.diffM === null && sd.diffPct === null && !sd.longerThanDeclared, JSON.stringify(sd));
  check("§1e E (A'nın partisini paylaşır, kendi topunda ölçüm yok) uzun", sums.get(E.id)?.longerThanDeclared === true, JSON.stringify(sums.get(E.id)));
  check("§1f F topsuz ⇒ null", sums.get(F.id) === null);
  const sh = sums.get(H.id);
  check("§1g H iki parti (1010 uzun · 950 kısa): uzun, faturalanan 1010+1000", sh?.longerThanDeclared === true && sh.billedM === 2010 && sh.declaredM === 2000, JSON.stringify(sh));

  // ── §2 opt-in ──────────────────────────────────────────────────────────────
  section("§2 opt-in: parametresiz yanıt aynı");
  const plain = await list({ mode: "cursor", limit: "50" });
  check("§2a parametresiz: 7 satır, hiçbirinde meterSummary anahtarı yok", plain.rows.length === 7 && plain.rows.every((r) => !("meterSummary" in r)), String(plain.rows.length));
  const withM = await list({ mode: "cursor", limit: "50", withMeterSummary: "true" });
  check("§2b withMeterSummary=true: her satırda özet = toplu çözücü",
    withM.rows.length === 7 && withM.rows.every((r) => "meterSummary" in r && JSON.stringify(r.meterSummary) === JSON.stringify(sums.get(r.id))), String(withM.rows.length));

  // ── §3 süzgeç ──────────────────────────────────────────────────────────────
  section("§3 filter[meterCheck]=LONGER");
  const want = [A.id, E.id, H.id].sort().join(",");
  const lc = await list({ mode: "cursor", limit: "50", withTotal: "true", "filter[meterCheck]": "LONGER" });
  check("§3a cursor liste yalnız A, E, H; withTotal sayımı 3", lc.rows.map((r) => r.id).sort().join(",") === want && lc.total === 3, JSON.stringify({ n: lc.rows.length, total: lc.total, err: lc.err }));
  const lo = await list({ "filter[meterCheck]": "LONGER" });
  check("§3b offset liste + total aynı küme", lo.rows.map((r) => r.id).sort().join(",") === want && lo.total === 3, JSON.stringify({ n: lo.rows.length, total: lo.total }));
  const page = await list({ mode: "cursor", limit: "2", "filter[meterCheck]": "LONGER" });
  check("§3c sayfa 2 satır (cursor süzgeçten sonra sayfalar)", page.rows.length === 2 && page.rows.every((r) => want.includes(r.id)), String(page.rows.length));

  // ── §4 fail-closed ─────────────────────────────────────────────────────────
  section("§4 tanınmayan değer");
  const bad = await list({ mode: "cursor", limit: "50", "filter[meterCheck]": "SHORT" });
  check("§4 filter[meterCheck]=SHORT ⇒ 400 INVALID_FILTER_VALUE", bad.err?.status === 400 && bad.err.code === "INVALID_FILTER_VALUE", JSON.stringify(bad.err));

  // ── §5 ek süre ─────────────────────────────────────────────────────────────
  section("§5 50 satırlık sayfada ek süre (bilgi)");
  for (let i = 0; i < 43; i++) { const w = await mkWo(c, `X${i}`); await mkParty(c, w, 1000, [500, 505]); }
  const time = async (q: Record<string, string>) => { const t = performance.now(); const r = await list(q); return { ms: performance.now() - t, n: r.rows.length }; };
  await time({ mode: "cursor", limit: "50" });
  const runs: Array<{ off: number; on: number }> = [];
  for (let i = 0; i < 5; i++) runs.push({ off: (await time({ mode: "cursor", limit: "50" })).ms, on: (await time({ mode: "cursor", limit: "50", withMeterSummary: "true" })).ms });
  const med = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
  const off = med(runs.map((r) => r.off)), on = med(runs.map((r) => r.on));
  console.log(`   ℹ️ 50 satır (medyan/5): özetsiz ${off.toFixed(0)} ms · özetli ${on.toFixed(0)} ms · ek ${(on - off).toFixed(0)} ms`);
  const tf = performance.now();
  const lf = await list({ mode: "cursor", limit: "50", "filter[meterCheck]": "LONGER" });
  console.log(`   ℹ️ süzgeç (50 aday): ${(performance.now() - tf).toFixed(0)} ms, ${lf.rows.length} satır`);
  check("§5 ölçüm koştu (50 satır döndü)", (await time({ mode: "cursor", limit: "50", withMeterSummary: "true" })).n === 50);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("meterAck", () => prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: ids } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  for (let i = 0; i < 3; i++) await del(`roll yaprak ${i}`, () => prisma.roll.deleteMany({ where: { id: { in: ids }, children: { none: {} } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  if (fx.stationId) { const s = fx.stationId; await del("station", () => prisma.station.deleteMany({ where: { id: s } })); }
  if (fx.itemId) { const it = fx.itemId; await del("item", () => prisma.item.deleteMany({ where: { id: it } })); }
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-ILM top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
