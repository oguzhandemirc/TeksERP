// =============================================================================
// test_tezgah_onerisi — SY-M2: tezgâh önerisi (T1/T2/T3) + levent ihtiyacı (üç beamMode kipinde)
// =============================================================================
//   §0 statik: tezgâh/levent ihtiyacı helper'ları kalanı YALNIZ `mountedBeamViewsTx` / `readBeamStockBySpec`
//      (→ `remainingByBeam`) üstünden okur — olay tablosu, `warpBeamRemainingM`, plan uzunluğu okunmaz
//   §1 SEPARATE_BEAM (zemin %8 + döner %14, 1000 m): T1 HAZIR (aynı ürün koşuyor > boş > kalan en yakın),
//      T2 LEVENT YETMEZ (tüketilmiş levent → "N m dokur"), T3 ÇÖZGÜ DEĞİŞİMİ (hazır levent no'su)
//   §2 tarak eni < ürün eni → UYARI + rozet; hiçbir tezgâh elenmez
//   §3 SHARED_BEAM: döner grup zemin leventinde — ayrı levent aranmaz; zemin ihtiyacı EN HIZLI grubun (%14) take-up'ıyla
//   §4 CREEL: katman leventsiz — ihtiyaç "levent yok", tezgâh yalnız zeminle T1
//   §5 dokuma işi kimliğiyle öneri (işin kendi plan metresi) · bilinmeyen iş 404
//   §5c/§5d kapalı iş ve levent takibi kapalı: aday yok + uyarı.
//   §6 üretim önerisi levent ihtiyacı: gerekli = ham ÷ (1 − take-up), eksik PLANNED levent boyuna yukarı yuvarlı,
//      aynı kartı isteyen iki grup stoğu ÇİFT saymaz; CREEL "levent yok"; devere kapalıyken anahtar YOK (bayt-aynı)
// Negatif sonda: (A) `classifyLoom` kalanı `plannedLengthM`den okuyunca §1c (T2) kırmızı; (B) helper olay
// tablosunu doğrudan okuyunca §0 kırmızı; (C) kip okunmadan SEPARATE sayılınca §3 kırmızı.
// Çalıştır: npx tsx scripts/test_tezgah_onerisi.ts (yalnız test DB; global ayar yazar → hedefDbEngeli)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StationType, WarpBeamOrigin, WarpKgSource, WarpLengthSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { consumeBeam } from "../src/services/warp-beam-consume.service";
import { replaceItemWarpLayers } from "../src/services/item-construction.service";
import { suggestLoomsForWeaving, type LoomCandidate } from "../src/services/helpers/loom-suggestion.helper";
import { previewProductionProposal } from "../src/services/production-proposal.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-SYM2-${Date.now().toString(36).toUpperCase()}`;
const KEYS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL];
const saved = new Map<string, unknown>();
const made = { station: "", looms: [] as string[], items: [] as string[], specs: [] as string[], beams: [] as string[], runs: [] as string[], weaving: [] as string[], customer: "", recipe: "" };
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

function statik(): void {
  const src = (f: string) => readFileSync(path.join(__dirname, "..", "src", "services", "helpers", f), "utf8").replace(/\/\/.*$/gm, "");
  const files = ["loom-suggestion.helper.ts", "beam-need.helper.ts", "production-proposal.helper.ts", "warp-beam-stock.helper.ts"];
  for (const f of files) {
    const s = src(f);
    const bad = [".warpBeamEvent", "warpBeamRemainingM", "plannedLengthM", "readRemainingM(", "remainingMTx("].filter((k) => s.includes(k));
    check(`§0 ${f}: kalan olay tablosundan/plan uzunluğundan doğrudan okunmaz`, bad.length === 0, bad.join(","));
  }
  check("§0b tezgâh önerisi takılı leventi `mountedBeamViewsTx`, stoğu `readBeamStockBySpec`ten okur", /mountedBeamViewsTx\(/.test(src("loom-suggestion.helper.ts")) && /readBeamStockBySpec\(/.test(src("loom-suggestion.helper.ts")));
  check("§0c stok kalanı `remainingByBeam` tek kaynağından", /remainingByBeam\(/.test(src("warp-beam-stock.helper.ts")));
}

async function fixtures() {
  made.station = (await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;
  const loom = async (s: string) => {
    const id = (await prisma.machine.create({ data: { stationId: made.station, name: `${TAG}-${s}`, code: `${TAG}-${s}`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } })).id;
    made.looms.push(id);
    return id;
  };
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } });
  made.items.push(yarn.id);
  const spec = async (s: string, takeUpPct: number, reedWidthCm?: number) => {
    const r = await prisma.warpSpec.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, yarnItemId: yarn.id, endsCount: 5250, takeUpPct, reedWidthCm }, select: { id: true, code: true } });
    made.specs.push(r.id);
    return r;
  };
  const G = await spec("G", 8, 280), L = await spec("L", 14), S = await spec("S", 14), K = await spec("K", 5), G2 = await spec("G2", 10), L2 = await spec("L2", 20);
  const fabric = async (s: string, warpSpecId: string, layers: Array<{ warpSpecId: string; role: "LENO" | "SECONDARY"; beamMode: "SEPARATE_BEAM" | "SHARED_BEAM" | "CREEL" }>) => {
    const id = (await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC", warpSpecId, widthCm: 300 }, select: { id: true } })).id;
    made.items.push(id);
    if (layers.length) await replaceItemWarpLayers(id, layers);
    return id;
  };
  const X = await fabric("X", G.id, [{ warpSpecId: L.id, role: "LENO", beamMode: "SEPARATE_BEAM" }]);
  const Y = await fabric("Y", G.id, [{ warpSpecId: S.id, role: "LENO", beamMode: "SHARED_BEAM" }]);
  const Z = await fabric("Z", G.id, [{ warpSpecId: K.id, role: "SECONDARY", beamMode: "CREEL" }]);
  const P = await fabric("P", G2.id, [{ warpSpecId: L2.id, role: "LENO", beamMode: "SEPARATE_BEAM" }, { warpSpecId: K.id, role: "SECONDARY", beamMode: "CREEL" }]);
  const other = await fabric("O", G2.id, []);
  const sub = await ensureTestDyeHouse();
  const beam = async (specId: string, lengthM: number, mountOn?: { machineId: string; position: number }) => {
    const p = await createWarpBeam({ warpSpecId: specId, plannedLengthM: lengthM, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    made.beams.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM, kgSource: WarpKgSource.THEORETICAL });
    if (mountOn) await mountBeam(p.data.id, mountOn);
    return p.data;
  };
  const pair = async (code: string, gM: number, lM: number) => {
    const id = await loom(code);
    await beam(G.id, gM, { machineId: id, position: 1 });
    const l = await beam(L.id, lM, { machineId: id, position: 2 });
    return { id, l };
  };
  const A = await pair("A", 1500, 1500);
  const B = await pair("B", 1500, 1200);
  const C = await pair("C", 1500, 1500);
  await consumeBeam(C.l.id, { lengthM: 600, lengthSource: WarpLengthSource.ESTIMATED });
  const D = await loom("D");
  await beam(G.id, 1500, { machineId: D, position: 1 });
  const ready = await beam(L.id, 1500);
  const E = await pair("E", 1500, 1500);
  const F = await pair("F", 1500, 1500);
  const run = async (machineId: string, itemId: string) => made.runs.push((await prisma.machineRun.create({ data: { machineId, itemId, startedAt: new Date() }, select: { id: true } })).id);
  await run(E.id, X);
  await run(F.id, other);
  await beam(L2.id, 300);
  await prisma.costStructure.create({ data: { itemId: P, beamLengthM: 500 } });
  return { G, L, K, X, Y, Z, P, looms: { A: A.id, B: B.id, C: C.id, D, E: E.id, F: F.id }, readyBeamNo: ready.beamNo };
}

const mine = (cs: LoomCandidate[]) => cs.filter((c) => made.looms.includes(c.machineId));

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== TEZGÂH ÖNERİSİ + LEVENT İHTİYACI (SY-M2) ===\n");
  statik();
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, false);
  await setSetting(SETTING_KEYS.DEVERE_AUTO_CONSUME, false);
  const f = await fixtures();
  const code = (id: string) => `${TAG}-${Object.entries(f.looms).find(([, v]) => v === id)?.[0]}`.slice(0, 32);

  console.log("\n── §1 SEPARATE_BEAM ──");
  const s1 = await suggestLoomsForWeaving(prisma, { itemId: f.X, plannedM: 1000 });
  const c1 = mine(s1.candidates);
  const by = (k: keyof typeof f.looms) => c1.find((c) => c.machineId === f.looms[k]);
  const g = s1.requirements.find((r) => r.role === "GROUND"), l = s1.requirements.find((r) => r.role === "LENO");
  check("§1a gereksinim: zemin 1000 ÷ 0,92 = 1086,957 · döner 1000 ÷ 0,86 = 1162,791 (iki levent)", g?.requiredM === 1086.957 && l?.requiredM === 1162.791 && g.ownBeam && l.ownBeam, `${g?.requiredM}/${l?.requiredM}`);
  check("§1b T1 HAZIR: A, B, E, F (iki levent takılı, kalan ≥ gerekli)", ["A", "B", "E", "F"].every((k) => by(k as keyof typeof f.looms)?.tier === "READY"));
  check("§1c ⭐ T2 LEVENT YETMEZ: C (döner kalanı 900 < 1162,791) — dokur = 900 × 0,86 = 774 m", by("C")?.tier === "BEAM_SHORT" && by("C")?.weavableM === 774, `${by("C")?.tier} ${by("C")?.weavableM}`);
  check("§1d T3 ÇÖZGÜ DEĞİŞİMİ: D (döner takılı değil) + hazır levent no'su", by("D")?.tier === "WARP_CHANGE" && by("D")!.missingWarpSpecCodes.includes(f.L.code) && by("D")!.readyBeamNos.includes(f.readyBeamNo), JSON.stringify(by("D")?.readyBeamNos));
  const order = c1.map((c) => code(c.machineId));
  const expect = ["E", "B", "A", "F", "C", "D"].map((k) => `${TAG}-${k}`.slice(0, 32));
  check("§1e sıra: aynı ürün koşan E > boş B (kalan en yakın 37,209) > boş A > koşumu başka işte F > T2 C > T3 D", JSON.stringify(order) === JSON.stringify(expect), order.map((o) => o.slice(-1)).join(""));
  check("§1f B'nin artığı 1200 − 1162,791 = 37,209", by("B")?.surplusM === 37.209, String(by("B")?.surplusM));

  console.log("\n── §2 Tarak eni ──");
  check("§2a ⭐ tarak 280 cm < ürün 300 cm → REED_NARROWER_THAN_FABRIC uyarısı", s1.warnings.some((w) => w.code === "REED_NARROWER_THAN_FABRIC"));
  check("§2b eleme YOK: altı tezgâh da listede, hepsinde rozet", c1.length === 6 && c1.every((c) => c.widthWarning));

  console.log("\n── §3 SHARED_BEAM ──");
  const s3 = await suggestLoomsForWeaving(prisma, { itemId: f.Y, plannedM: 1340 });
  const sh = s3.requirements.find((r) => r.role === "LENO");
  const g3 = s3.requirements.find((r) => r.role === "GROUND");
  check("§3a ⭐ döner grup zemin leventinde: ayrı levent yok, zemin take-up = en hızlı grup %14", sh?.beamMode === "SHARED_BEAM" && sh.ownBeam === false && g3?.takeUpPct === 14 && g3.requiredM === 1558.14, `${g3?.takeUpPct} ${g3?.requiredM}`);
  const d3 = mine(s3.candidates).find((c) => c.machineId === f.looms.D);
  check("§3b ⭐ yalnız zemin takılı D T3 DEĞİL: zemin 1500 < 1558,14 → T2, dokur 1500 × 0,86 = 1290", d3?.tier === "BEAM_SHORT" && d3.weavableM === 1290, `${d3?.tier} ${d3?.weavableM}`);
  const s3b = await suggestLoomsForWeaving(prisma, { itemId: f.Y, plannedM: 1000 });
  check("§3c 1000 m'de D T1 HAZIR (zemin 1500 ≥ 1162,791)", mine(s3b.candidates).find((c) => c.machineId === f.looms.D)?.tier === "READY");

  console.log("\n── §4 CREEL ──");
  const s4 = await suggestLoomsForWeaving(prisma, { itemId: f.Z, plannedM: 1000 });
  const cr = s4.requirements.find((r) => r.role === "SECONDARY");
  check("§4a ⭐ cağlık katmanı leventsiz (ownBeam=false, requiredM=null); zemin take-up kendi %8'i", cr?.beamMode === "CREEL" && !cr.ownBeam && cr.requiredM === null && s4.requirements[0].takeUpPct === 8);
  check("§4b yalnız zemin takılı D T1 HAZIR", mine(s4.candidates).find((c) => c.machineId === f.looms.D)?.tier === "READY");

  console.log("\n── §5 Dokuma işi kimliğiyle ──");
  const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-DI`, itemId: f.X, executionKind: "IN_HOUSE", plannedM: 1000 }, select: { id: true } });
  made.weaving.push(wo.id);
  const s5 = await suggestLoomsForWeaving(prisma, { weavingOrderId: wo.id });
  check("§5a dokuma işinin plan metresi okunur, sonuç taslakla aynı", s5.weavingOrderId === wo.id && JSON.stringify(mine(s5.candidates)) === JSON.stringify(c1));
  const nf = await suggestLoomsForWeaving(prisma, { weavingOrderId: randomUUID() }).then(() => "OK", (e: { statusCode?: number }) => String(e.statusCode));
  check("§5b bilinmeyen dokuma işi 404", nf === "404", nf);
  await prisma.weavingOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
  const s5c = await suggestLoomsForWeaving(prisma, { weavingOrderId: wo.id });
  check("§5c kapalı (iptal) dokuma işi: aday yok + WEAVING_ORDER_CLOSED uyarısı", s5c.candidates.length === 0 && s5c.warnings.some((w) => w.code === "WEAVING_ORDER_CLOSED"));
  await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, false);
  const s5d = await suggestLoomsForWeaving(prisma, { itemId: f.X, plannedM: 1000 });
  await setSetting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
  check("§5d ⭐ levent takibi kapalı → sınıflama YOK (yanlış T3 yok), MOUNT_TRACKING_OFF uyarısı", s5d.candidates.length === 0 && s5d.warnings.some((w) => w.code === "MOUNT_TRACKING_OFF"), JSON.stringify(s5d.warnings.map((w) => w.code)));

  console.log("\n── §6 Üretim önerisi levent ihtiyacı ──");
  const admin = await ensureTestAdmin();
  made.customer = (await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} müşteri` }, select: { id: true } })).id;
  made.recipe = (await prisma.productRecipe.create({ data: { code: `${TAG}-R`.slice(0, 32), name: `${TAG} V01`, itemId: f.P, variantCode: "V01" }, select: { id: true } })).id;
  const orders = (await import("../src/routes/order.routes")).orderService;
  const lines = [{ itemId: f.P, quantity: 1000, unitPrice: 1 }, { itemId: f.P, recipeId: made.recipe, quantity: 1000, unitPrice: 1 }];
  const ord = (await orders.create({ customerId: made.customer, currency: "TRY", clientToken: randomUUID(), lines }, admin.id)) as { data: { id: string } };
  await prisma.order.update({ where: { id: ord.data.id }, data: { status: "APPROVED" } });
  await setSetting(SETTING_KEYS.ORDER_PRODUCTION_PROPOSAL, "ONIZLEME");
  const access = { readWeaving: true, writeWeaving: true, writeWorkOrder: true };
  const pv = (await previewProductionProposal(ord.data.id, access)).data;
  const groups = pv.weavingOrders.filter((w) => w.itemId === f.P);
  const needs = groups.map((w) => w.beamNeeds ?? []);
  const role = (r: string) => needs.map((n) => n.find((x) => x.role === r));
  const gr1 = role("GROUND")[0], le = role("LENO"), cr1 = role("SECONDARY")[0];
  const first = le.find((x) => x?.availableM === 300), second = le.find((x) => x?.availableM === 0);
  check("§6a iki grup (varyantsız + V01), her birinde üç ihtiyaç satırı", groups.length === 2 && needs.every((n) => n.length === 3));
  check("§6b ⭐ zemin 1000 ÷ 0,9 = 1111,111, stok 0 → 3 × 500 m PLANNED (levent boyuna yukarı)", gr1?.requiredM === 1111.111 && gr1.availableM === 0 && gr1.proposedBeams?.count === 3 && gr1.proposedBeams.lengthM === 500, JSON.stringify(gr1?.proposedBeams));
  check("§6c ⭐ döner 1000 ÷ 0,8 = 1250; ilk grup hazır 300'ü alır → eksik 950 → 2 × 500", first?.requiredM === 1250 && first.shortfallM === 950 && first.proposedBeams?.count === 2, `${first?.availableM}/${first?.shortfallM}`);
  check("§6d ⭐ ikinci grup aynı 300 m'yi ÇİFT saymaz: kullanılabilir 0, eksik 1250 → 3 levent", second?.shortfallM === 1250 && second.proposedBeams?.count === 3 && le.length === 2, le.map((x) => `${x?.availableM}/${x?.shortfallM}`).join(" "));
  check("§6e cağlık katmanı: levent önerisi yok", cr1?.beamMode === "CREEL" && cr1.proposedBeams === null && cr1.requiredM === null);
  await setSetting(SETTING_KEYS.DEVERE_ENABLED, false);
  const off = (await previewProductionProposal(ord.data.id, access)).data;
  check("§6f ⭐ devere kapalı → `beamNeeds` anahtarı HİÇ yok (SY-M1 yanıtıyla bayt-aynı)", off.weavingOrders.length === 2 && off.weavingOrders.every((w) => !("beamNeeds" in w)));
}

async function cleanup(): Promise<void> {
  const t = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  if (made.customer) {
    await t(() => prisma.orderLine.deleteMany({ where: { order: { customerId: made.customer } } }));
    await t(() => prisma.order.deleteMany({ where: { customerId: made.customer } }));
    await t(() => prisma.customer.deleteMany({ where: { id: made.customer } }));
  }
  if (made.recipe) await t(() => prisma.productRecipe.deleteMany({ where: { id: made.recipe } }));
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: made.weaving } } }));
  await t(() => prisma.machineRun.deleteMany({ where: { id: { in: made.runs } } }));
  await t(() => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: made.beams } } }));
  await t(() => prisma.warpBeam.deleteMany({ where: { id: { in: made.beams } } }));
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.beams, ...made.items] } } }));
  await t(() => prisma.costStructure.deleteMany({ where: { itemId: { in: made.items } } }));
  await t(() => prisma.itemWarpLayer.deleteMany({ where: { itemId: { in: made.items } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: made.items } }, data: { warpSpecId: null } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { id: { in: made.specs } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: made.items } } }));
  await t(() => prisma.machine.deleteMany({ where: { id: { in: made.looms } } }));
  if (made.station) await t(() => prisma.station.deleteMany({ where: { id: made.station } }));
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
