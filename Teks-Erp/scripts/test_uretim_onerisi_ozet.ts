// =============================================================================
// test_uretim_onerisi_ozet — Seyitoğlu 2. bölüm K1: önizlemede dokuma grubu başına karar özetleri
// =============================================================================
//   §1 tezgâh özeti: en iyi aday T1 (kendi tezgâhımız), sınıf sayıları, T2 "dokur" / T3 hazır levent no'su
//      yalnız kendi sınıfında; levent takibi kapalı → null
//   §2 süre: saat = ham ÷ (planRpm ÷ atkı × 0,6 × randıman); gün = saat ÷ 24; termin karşılaştırması ham;
//      randıman boş → null (varsayılan uydurulmaz)
//   §3 iplik özeti: gereken/eksik kg iplik ihtiyaç raporunun AYNI çekirdeğiyle birebir (tek sipariş, netlemesiz);
//      izin yok → null; maliyet kapalı → null; iplik modülü kapalı → shortKg null (0 değil)
//   §4 performans: tezgâh/levent/koşum/makine sorguları grup sayısından bağımsız (1 grup = 3 grup)
//   §5 uygula yolu özet hesaplamaz (yanıt yalnız id/numara)
// Negatif sonda (elle, geri alındı): (A) `suggestLoomsForDrafts` taslak başına `suggestLoomsForWeaving` çağırınca §4 ❌;
// (B) süre randımanı `?? 85` ile doldurunca §2c ❌; (C) iplik özeti `yarnShortKg` yerine stok düşmeden ihtiyacı
// eksik sayınca §3b ❌; (D) T2 alanını her sınıfta doldurunca §1c ❌.
// Çalıştır: npx tsx scripts/test_uretim_onerisi_ozet.ts (yalnız test DB; global ayar yazar → hedefDbEngeli)
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { previewProductionProposal, type ProposalAccess } from "../src/services/production-proposal.service";
import { yarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const KEYS = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME,
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DOKUMA_WEAVING_WASTE_PCT,
];
const saved = new Map<string, unknown>();
const made = { station: "", looms: [] as string[], beams: [] as string[], customer: "", recipes: [] as string[], warehouse: "" };
let fx: MaliyetFikstur | null = null;
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
const ACCESS: ProposalAccess = { readWeaving: true, writeWeaving: true, writeWorkOrder: true, readYarnNeed: true };

/** Prisma model delegesine erişim sayacı (emsal `test_iplik_ihtiyaci` §11). */
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
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.IPLIK_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, false);
  await setSetting(SETTING_KEYS.TICARET_ENABLED, false);
  await setSetting(SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, "ONIZLEME");
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DOKUMA_WEAVING_WASTE_PCT } });

  fx = await fiksturKur("TEST-SYK1-");
  const f = fx;
  await altinYapiYaz(f);
  // Ham = mamul (çekme 0) — süre/iplik beklentisi 1000 m üzerinden okunur.
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { lengthShrinkPct: new Prisma.Decimal(0) } });
  await prisma.item.updateMany({ where: { id: { in: [f.warpYarnId, f.weftAId, f.weftBId] } }, data: { unit: "KG" } });

  made.station = (await prisma.station.create({ data: { name: `${f.tag}-DOKUMA`, code: `${f.tag}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;
  const loom = async (s: string, plan: { planRpm?: number; planEfficiencyPct?: number }) => {
    const id = (await prisma.machine.create({ data: { stationId: made.station, name: `${f.tag}-${s}`, code: `${f.tag}-${s}`.slice(0, 32), warpBeamSlots: 2, ...plan }, select: { id: true } })).id;
    made.looms.push(id);
    return id;
  };
  const sub = await ensureTestDyeHouse();
  const beam = async (lengthM: number, mountOn?: string) => {
    const p = await createWarpBeam({ warpSpecId: f.warpSpecId, plannedLengthM: lengthM, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    made.beams.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM, kgSource: WarpKgSource.THEORETICAL });
    if (mountOn) await mountBeam(p.data.id, { machineId: mountOn, position: 1 });
    return p.data;
  };
  const A = await loom("A", { planRpm: 500, planEfficiencyPct: 80 });
  const B = await loom("B", {});
  const C = await loom("C", {});
  await beam(3000, A);
  await beam(500, B);
  const ready = await beam(2000);

  const admin = await ensureTestAdmin();
  made.customer = (await prisma.customer.create({ data: { code: `${f.tag}-M`, name: `${f.tag} müşteri` }, select: { id: true } })).id;
  for (const v of ["V1", "V2"]) made.recipes.push((await prisma.productRecipe.create({ data: { code: `${f.tag}-${v}`.slice(0, 32), name: `${f.tag} ${v}`, itemId: f.fabricId, variantCode: v }, select: { id: true } })).id);
  const orders = (await import("../src/routes/order.routes")).orderService;
  const order = async (lines: Array<{ recipeId?: string }>, deadlineDays: number): Promise<string> => {
    const deadline = new Date(Date.now() + deadlineDays * 86_400_000).toISOString();
    const r = (await orders.create({ customerId: made.customer, currency: "TRY", clientToken: randomUUID(), deadline, lines: lines.map((l) => ({ itemId: f.fabricId, quantity: 1000, unitPrice: 1, ...l })) }, admin.id)) as { data: { id: string } };
    await prisma.order.update({ where: { id: r.data.id }, data: { status: "APPROVED" } });
    return r.data.id;
  };
  const o1 = await order([{}], 10);

  console.log("\n── §1 Tezgâh özeti ──");
  const p1 = (await previewProductionProposal(o1, ACCESS)).data!;
  const g = p1.weavingOrders[0]!;
  const ls = g.loomSummary;
  check("§1a en iyi aday T1 HAZIR: A (3000 m takılı ≥ 1000 ÷ 0,94)", ls?.best.tier === "READY" && ls.best.machineId === A && ls.requiredM === 1000, JSON.stringify(ls?.best));
  check("§1b sınıf sayıları: T1 ≥ 1, T2 ≥ 1 (B: 500 m), T3 ≥ 1 (C)", (ls?.counts.READY ?? 0) >= 1 && (ls?.counts.BEAM_SHORT ?? 0) >= 1 && (ls?.counts.WARP_CHANGE ?? 0) >= 1, JSON.stringify(ls?.counts));
  check("§1c T1'de weavableM ve readyBeamNo null (yalnız kendi sınıflarında)", ls?.best.weavableM === null && ls.best.readyBeamNo === null);
  // Sınıf alanlarını ölçmek için A'nın leventi T2'ye düşecek kadar uzun bir ihtiyaç: 4000 m.
  const o4 = await order([{}, {}, {}, {}], 10);
  const ls4 = (await previewProductionProposal(o4, ACCESS)).data!.weavingOrders[0]!.loomSummary;
  check("§1d 4000 m: en iyi T2 A, dokur 3000 × 0,94 = 2820", ls4?.best.tier === "BEAM_SHORT" && ls4.best.machineId === A && ls4.best.weavableM === 2820 && ls4.best.readyBeamNo === null, JSON.stringify(ls4?.best));
  await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, false);
  const pOff = (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!;
  check("§1e levent takibi kapalı → loomSummary null ve süre null (tahmin yok)", pOff.loomSummary === null && pOff.durationEstimate === null);
  await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
  // T3'ü ölçmek için A ve B pasif (tezgâh listesinden düşer): en iyi aday C, hazır (takılı olmayan) levent no'su dolu.
  await prisma.machine.updateMany({ where: { id: { in: [A, B] } }, data: { isActive: false } });
  const ls3 = (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!.loomSummary;
  await prisma.machine.updateMany({ where: { id: { in: [A, B] } }, data: { isActive: true } });
  const onlyMine = ls3 && [C].includes(ls3.best.machineId);
  check("§1f T3 en iyi aday: C, readyBeamNo = hazır levent, weavableM null", !!onlyMine && ls3!.best.tier === "WARP_CHANGE" && ls3!.best.readyBeamNo === ready.beamNo && ls3!.best.weavableM === null, JSON.stringify(ls3?.best));

  console.log("\n── §2 Süre ──");
  const d = g.durationEstimate;
  // 500 ÷ 28 × 0,6 = 10,714 m/sa teorik; × 0,80 = 8,571 m/sa; 1000 m → 116,67 sa; 4,86 gün.
  check("§2a ⭐ saat = 1000 ÷ (500 ÷ 28 × 0,6 × 0,80) = 116,67; gün 4,86; tezgâh A", d?.weavingHours === 116.67 && d.weavingDays === 4.86 && d.machineId === A && d.picksPerCm === 28 && d.planRpm === 500 && d.planEfficiencyPct === 80, JSON.stringify(d));
  check("§2b termin 10 gün: kalan ≈ 240 sa, weavingOnlyFitsDeadline=true; üstte deadline ISO", d?.weavingOnlyFitsDeadline === true && (d.hoursUntilDeadline ?? 0) > 230 && (d.hoursUntilDeadline ?? 0) <= 240 && typeof p1.deadline === "string", JSON.stringify({ h: d?.hoursUntilDeadline, dl: p1.deadline }));
  const o2 = await order([{}], 2);
  const d2 = (await previewProductionProposal(o2, ACCESS)).data!.weavingOrders[0]!.durationEstimate;
  check("§2b2 termin 2 gün (48 sa) < 116,67 sa → false (hüküm değil, ham karşılaştırma)", d2?.weavingOnlyFitsDeadline === false, JSON.stringify(d2));
  await prisma.machine.update({ where: { id: A }, data: { planEfficiencyPct: null } });
  const d3 = (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!;
  check("§2c ⭐ randıman boş → durationEstimate null (varsayılan uydurulmaz), tezgâh özeti durur", d3.durationEstimate === null && d3.loomSummary?.best.machineId === A);
  await prisma.machine.update({ where: { id: A }, data: { planEfficiencyPct: 80, planRpm: null } });
  check("§2d plan devri boş → null", (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!.durationEstimate === null);
  await prisma.machine.update({ where: { id: A }, data: { planRpm: 500 } });

  console.log("\n── §3 İplik özeti ──");
  made.warehouse = (await prisma.warehouse.create({ data: { code: `${f.tag}-D`, name: `${f.tag} depo` }, select: { id: true } })).id;
  await prisma.yarnStock.create({ data: { itemId: f.weftAId, warehouseId: made.warehouse, balanceKg: new Prisma.Decimal(10) } });
  const y = (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!.yarnSummary;
  // Referans: aynı ürünün raporu yalnız o1 talebiyle — o2/o4 iptal edilir, netlemesiz (brüt kalan = 1000 m).
  await prisma.order.updateMany({ where: { id: { in: [o2, o4] } }, data: { status: "CANCELLED" } });
  const rep = await yarnNeedReport({ urunId: f.fabricId, netle: false });
  const same = rep.satirlar.length === y?.yarns.length && rep.satirlar.every((r) => {
    const row = y!.yarns.find((x) => x.yarnItemId === r.iplikId);
    return row && row.needKg === Number(r.ihtiyacKg) && row.shortKg === Number(r.eksikKg);
  });
  check("§3a ⭐ gereken ve eksik kg iplik ihtiyaç raporuyla birebir (aynı çekirdek; hazır levent düşümü dahil)", same && y!.rawM === 1000 && Number(rep.ozet.kumasMetre) === 1000, JSON.stringify({ y: y?.yarns, r: rep.satirlar.map((r) => [r.iplikKodu, r.ihtiyacKg, r.eksikKg]) }));
  const wa = y?.yarns.find((x) => x.yarnItemId === f.weftAId);
  check("§3b atkı A eksik = gereken − 10 kg serbest stok", wa != null && wa.shortKg === Math.round((wa.needKg - 10) * 1000) / 1000 && wa.code.endsWith("A150"), JSON.stringify(wa));
  check("§3c kaynak beyanı: stok açık, alış kapalı (ticaret), levent düşümü açık; toplam eksik dolu", y?.sources.stock === true && y.sources.openPurchase === false && y.sources.readyBeams === true && typeof y.totalShortKg === "number");
  check("§3d iplik ihtiyacı izni yok → yarnSummary null", (await previewProductionProposal(o1, { ...ACCESS, readYarnNeed: false })).data!.weavingOrders[0]!.yarnSummary === null);
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, false);
  const yOff = (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!.yarnSummary;
  check("§3e iplik modülü kapalı → shortKg null (bilinmiyor, 0 değil), totalShortKg null, gereken dolu", !!yOff && yOff.yarns.every((r) => r.shortKg === null) && yOff.yarns.some((r) => r.needKg > 0) && yOff.totalShortKg === null && yOff.sources.stock === false);
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, true);
  await setSetting(SETTING_KEYS.MALIYET_ENABLED, false);
  check("§3f maliyet modülü kapalı → yarnSummary null", (await previewProductionProposal(o1, ACCESS)).data!.weavingOrders[0]!.yarnSummary === null);
  await setSetting(SETTING_KEYS.MALIYET_ENABLED, true);

  console.log("\n── §4 Performans ──");
  const o3 = await order([{}, { recipeId: made.recipes[0] }, { recipeId: made.recipes[1] }], 10);
  const models = ["machine", "machineRun", "warpBeam", "warpSpec", "yarnStock", "item"];
  const measure = async (id: string) => {
    const s = spy(models);
    const t0 = performance.now();
    const r = await previewProductionProposal(id, ACCESS);
    const ms = performance.now() - t0;
    const n = s.count();
    s.restore();
    return { n, ms, groups: r.data!.weavingOrders.length };
  };
  await measure(o1); // ısınma
  const m1 = await measure(o1), m3 = await measure(o3);
  console.log(`   ölçüm: 1 grup ${m1.n} delege erişimi / ${m1.ms.toFixed(0)} ms · ${m3.groups} grup ${m3.n} erişim / ${m3.ms.toFixed(0)} ms`);
  const tracked = ["machine", "machineRun", "warpBeam", "yarnStock"];
  const sT = spy(tracked); await previewProductionProposal(o1, ACCESS); const t1 = sT.count(); sT.restore();
  const sT3 = spy(tracked); const p3 = await previewProductionProposal(o3, ACCESS); const t3 = sT3.count(); sT3.restore();
  check("§4a ⭐ tezgâh/koşum/levent/stok sorguları grup sayısından bağımsız (1 grup = 3 grup)", t1 === t3 && p3.data!.weavingOrders.length === 3, `${t1} vs ${t3}`);
  check("§4b üç grubun her birinde üç özet anahtarı var", p3.data!.weavingOrders.every((w) => "loomSummary" in w && "yarnSummary" in w && "durationEstimate" in w));
}

async function cleanup(): Promise<void> {
  const t = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  if (made.customer) {
    const orderIds = (await prisma.order.findMany({ where: { customerId: made.customer }, select: { id: true } })).map((o) => o.id);
    await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: orderIds } } }));
    await t(() => prisma.recordFollow.deleteMany({ where: { order: { customerId: made.customer } } }));
    await t(() => prisma.orderLine.deleteMany({ where: { order: { customerId: made.customer } } }));
    await t(() => prisma.order.deleteMany({ where: { customerId: made.customer } }));
    await t(() => prisma.customer.deleteMany({ where: { id: made.customer } }));
  }
  await t(() => prisma.productRecipe.deleteMany({ where: { id: { in: made.recipes } } }));
  if (made.warehouse) {
    await t(() => prisma.yarnStock.deleteMany({ where: { warehouseId: made.warehouse } }));
    await t(() => prisma.warehouse.deleteMany({ where: { id: made.warehouse } }));
  }
  await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } }));
  await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } }));
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: made.beams } } }));
  await t(() => prisma.machine.deleteMany({ where: { id: { in: made.looms } } }));
  if (made.station) await t(() => prisma.station.deleteMany({ where: { id: made.station } }));
  if (fx) await t(() => fiksturSil(fx!));
  for (const [key, value] of saved) {
    if (value === undefined) await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
    else await t(() => setSetting(key, value));
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
