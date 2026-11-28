// =============================================================================
// test_tahar_plani — T1 tahar planı ana verisi (Seyitoğlu 2026-11-28), GERÇEK DB.
// §1 kısaltmalı yazım ayrıştırıcı/sıkıştırıcı örnek tablosu (panel ikizi aynı tablo: drawing-in-plan.test.ts)
// §2 servis: seri kodu THR-, çerçeve sayısını aşan numara 400, ayar üst sınırı (vars. 12, 16'ya kadar) 400,
//    yazım ↔ dizi çelişkisi 400, özet tekrar birimine göre, ad seddi 409
// §3 ürün bağı: yalnız KUMAŞ + aktif plan; MV-06 pasife alma 409; §4 desen kartı basımı tahar planından çizer.
// Negatif sonda: `drawingInSequenceError` içinde `v > frameCount` kontrolü kaldırılırsa §2c KIRMIZI.
// Fikstür `TEST-THR-<ts>`; SystemSetting birebir geri yüklenir; temizlik `finally`de FK sırasıyla.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { compressDrawingIn, drawingInRepeatUnit, parseDrawingInNotation } from "../src/constants/drawing-in-plan";
import { activateDrawingInPlan, createDrawingInPlan, deactivateDrawingInPlan, findSimilarDrawingInPlanNames, updateDrawingInPlan } from "../src/services/drawing-in-plan.service";
import { createWeaveDesign } from "../src/services/weave-design.service";
import { buildWeaveCardView } from "../src/services/weave-card.service";
import { itemService } from "../src/routes/item.routes";
import { createItemRecord } from "../src/services/color-item-create.service";
import { systemSettingService } from "../src/services/system-setting.service";
import { SETTING_KEYS } from "../src/services/system-setting/keys";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e.details?.code ?? `HTTP${e.statusCode}` : (e as Error).message.slice(0, 120); }
}

const TAG = `TEST-THR-${Date.now()}`;
const ids = { plans: [] as string[], designs: [] as string[], items: [] as string[] };
const KEY = SETTING_KEYS.DOKUMA_DRAWING_IN_MAX_FRAMES;
let saved: { key: string; value: unknown; description: string | null } | null = null;

/** Panel `components/weave/drawing-in-plan.test.ts` aynı tabloyu koşar (parite). */
export const NOTATION_CASES: Array<[string, number[] | null]> = [
  ["3x(1-2-3-4) 5-6", [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6]],
  ["(1-2-3-4)x2", [1, 2, 3, 4, 1, 2, 3, 4]],
  ["1,2,3,4", [1, 2, 3, 4]],
  ["2x5 6", [5, 5, 6]],
  ["2x(1-2x(3-4))", [1, 3, 4, 3, 4, 1, 3, 4, 3, 4]],
  ["1 × 2", [2]],
  ["", null],
  ["(1-2", null],
  ["1-2)", null],
  ["a-b", null],
  ["3x", null],
  ["600x1", null],
];

function pureChecks(): void {
  console.log("§1 ayrıştırıcı / sıkıştırıcı");
  for (const [src, want] of NOTATION_CASES) {
    const r = parseDrawingInNotation(src);
    const ok = want === null ? !r.ok : r.ok && r.sequence.join() === want.join();
    check(`§1 "${src}" → ${want === null ? "hata" : want.join("-")}`, ok, r.ok ? r.sequence.join("-") : r.message);
  }
  const seq = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6];
  check("§1s sıkıştırma 3x(1-2-3-4) 5-6", compressDrawingIn(seq) === "3x(1-2-3-4) 5-6", compressDrawingIn(seq));
  const round = parseDrawingInNotation(compressDrawingIn([1, 1, 2, 3, 2, 3, 2, 3, 7]));
  check("§1t sıkıştır → aç gidiş-dönüş aynı dizi", round.ok && round.sequence.join() === "1,1,2,3,2,3,2,3,7");
  check("§1u tekrar birimi [1,2,1,2,1,2] → [1,2]", drawingInRepeatUnit([1, 2, 1, 2, 1, 2]).join() === "1,2");
}

async function serviceChecks(adminId: string): Promise<{ planId: string }> {
  console.log("§2 servis kapısı");
  const a = await createDrawingInPlan({ name: `${TAG} A`, frameCount: 6, notation: "3x(1-2-3-4) 5-6" }, adminId);
  ids.plans.push(a.id);
  check("§2a kod seriden THR-", /^THR-\d{4,}$/.test(a.code), a.code);
  check("§2b dizi açıldı (14 tel), yazım saklandı", a.threading.length === 14 && a.notation === "3x(1-2-3-4) 5-6");
  check("§2c çerçeve sayısını aşan numara → 400 DRAWING_IN_FRAME_OUT_OF_RANGE",
    (await codeOf(() => createDrawingInPlan({ name: `${TAG} B`, frameCount: 4, notation: "1-2-3-4-5" }, adminId))) === "DRAWING_IN_FRAME_OUT_OF_RANGE");
  check("§2d çerçeve sayısı düşürülünce eski dizi aşar → 400",
    (await codeOf(() => updateDrawingInPlan(a.id, { frameCount: 4 }, adminId))) === "DRAWING_IN_FRAME_OUT_OF_RANGE");
  check("§2e varsayılan üst sınır 12: 13 çerçeve → 400 DRAWING_IN_FRAME_COUNT_OVER_MAX",
    (await codeOf(() => createDrawingInPlan({ name: `${TAG} C`, frameCount: 13, threading: [1, 13] }, adminId))) === "DRAWING_IN_FRAME_COUNT_OVER_MAX");
  await systemSettingService.setFeatureFlags({ dokumaDrawingInMaxFrames: 16 }, adminId);
  const c = await createDrawingInPlan({ name: `${TAG} C`, frameCount: 16, threading: [1, 16, 1, 16] }, adminId);
  ids.plans.push(c.id);
  check("§2f ayar 16 → 16 çerçeve kabul; yazım diziden üretildi", c.frameCount === 16 && c.notation === "2x(1-16)", c.notation);
  check("§2g ayar 17 → 400", (await codeOf(() => systemSettingService.setFeatureFlags({ dokumaDrawingInMaxFrames: 17 }, adminId))) !== null);
  check("§2h yazım ↔ dizi çelişkisi → 400 DRAWING_IN_NOTATION_MISMATCH",
    (await codeOf(() => createDrawingInPlan({ name: `${TAG} D`, frameCount: 4, notation: "1-2", threading: [2, 1] }, adminId))) === "DRAWING_IN_NOTATION_MISMATCH");
  check("§2i bozuk yazım → 400 DRAWING_IN_NOTATION_INVALID",
    (await codeOf(() => createDrawingInPlan({ name: `${TAG} D`, frameCount: 4, notation: "(1-2" }, adminId))) === "DRAWING_IN_NOTATION_INVALID");
  const same = await createDrawingInPlan({ name: `${TAG} F`, frameCount: 6, threading: [...a.threading, ...a.threading] }, adminId);
  ids.plans.push(same.id);
  check("§2j iki kez yazılmış rapor = aynı özet", same.threadingKey === a.threadingKey);
  check("§2k farklı dizi farklı özet", c.threadingKey !== a.threadingKey);
  check("§2l aynı ad → 409 DRAWING_IN_PLAN_DUPLICATE",
    (await codeOf(() => createDrawingInPlan({ name: `${TAG} a`, frameCount: 4, threading: [1, 2] }, adminId))) === "DRAWING_IN_PLAN_DUPLICATE");
  check("§2m kenar taharı aşımı → 400",
    (await codeOf(() => updateDrawingInPlan(a.id, { selvedgeThreading: "1-7" }, adminId))) === "DRAWING_IN_FRAME_OUT_OF_RANGE");
  const sim = await findSimilarDrawingInPlanNames(`${TAG} A`);
  const simEx = await findSimilarDrawingInPlanNames(`${TAG} A`, a.id);
  check("§2p benzer-ad ucu planı bulur; excludeId kendini düşürür",
    sim.some((r) => r.id === a.id && r.code === a.code) && !simEx.some((r) => r.id === a.id), `${sim.length}/${simEx.length}`);
  check("§2n tanınmayan alan → 400", (await codeOf(() => updateDrawingInPlan(a.id, { threadingKey: "x" }, adminId))) === "HTTP400");
  const audit = await prisma.systemLog.count({ where: { tableName: "DRAWING_IN_PLAN", recordId: a.id, action: "CREATE" } });
  check("§2o audit CREATE yazıldı", audit === 1);
  return { planId: a.id };
}

async function itemChecks(adminId: string, planId: string): Promise<void> {
  console.log("§3 kumaş bağı");
  const fabric = await createItemRecord(itemService, { code: `${TAG}-K`, name: `${TAG} kumaş`, itemType: "FABRIC", drawingInPlanId: planId }, adminId);
  const fabricId = (fabric.data as { id: string }).id;
  ids.items.push(fabricId);
  const row = await prisma.item.findUnique({ where: { id: fabricId }, select: { drawingInPlanId: true } });
  check("§3a kumaşa tahar planı bağlandı", row?.drawingInPlanId === planId);
  check("§3b iplik kartına tahar planı → 400 ITEM_FABRIC_STRUCTURE_FABRIC_ONLY",
    (await codeOf(() => createItemRecord(itemService, { code: `${TAG}-Y`, name: `${TAG} iplik`, itemType: "YARN", drawingInPlanId: planId }, adminId))) === "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY");
  check("§3c pasif plan reddi: pasife alma kullanımda → 409 DRAWING_IN_PLAN_IN_USE",
    (await codeOf(() => deactivateDrawingInPlan(planId, adminId))) === "DRAWING_IN_PLAN_IN_USE");
  const spare = await createDrawingInPlan({ name: `${TAG} G`, frameCount: 2, threading: [1, 2] }, adminId);
  ids.plans.push(spare.id);
  await deactivateDrawingInPlan(spare.id, adminId);
  check("§3d pasif planı kumaşa bağlamak → 400 DRAWING_IN_PLAN_NOT_FOUND",
    (await codeOf(() => itemService.update(fabricId, { drawingInPlanId: spare.id }, adminId))) === "DRAWING_IN_PLAN_NOT_FOUND");
  await activateDrawingInPlan(spare.id, adminId);
  await itemService.update(fabricId, { drawingInPlanId: null }, adminId);
  check("§3e null bağı temizler", (await prisma.item.findUnique({ where: { id: fabricId }, select: { drawingInPlanId: true } }))?.drawingInPlanId === null);

  console.log("§4 desen kartı basımı");
  const design = await createWeaveDesign({ code: `${TAG}-D`, name: `${TAG} desen`, shedMechanism: "DOBBY", weaveStructure: "PLAIN", frameCount: 4, liftPlan: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] }, adminId);
  ids.designs.push(design.id);
  const p4 = await createDrawingInPlan({ name: `${TAG} H`, frameCount: 4, notation: "1-1-2-3-4" }, adminId);
  ids.plans.push(p4.id);
  await itemService.update(fabricId, { weaveDesignId: design.id }, adminId);
  const before = await buildWeaveCardView(fabricId);
  const thrBefore = before.fabric && before.fabric.kind === "DRAWDOWN" ? before.fabric.threading.slice(0, 5).join() : "";
  check("§4a plan yokken düz tahar (geri uyum)", thrBefore === "1,2,3,4,1", thrBefore);
  await itemService.update(fabricId, { drawingInPlanId: p4.id }, adminId);
  const after = await buildWeaveCardView(fabricId);
  const thrAfter = after.fabric && after.fabric.kind === "DRAWDOWN" ? after.fabric.threading.slice(0, 5).join() : "";
  check("§4b plan varken tahar şeridi plandan (1-1-2-3-4)", thrAfter === "1,1,2,3,4", thrAfter);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { fail++; console.log(`  ✗ ${engel}`); return; }
  saved = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { key: true, value: true, description: true } });
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  const flags0 = (await systemSettingService.getFeatureFlags()).data;
  check("§0 kayıt yokken üst sınır 12", flags0.dokumaDrawingInMaxFrames === 12, String(flags0.dokumaDrawingInMaxFrames));
  pureChecks();
  const admin = await ensureTestAdmin();
  const { planId } = await serviceChecks(admin.id);
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  await itemChecks(admin.id, planId);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { id: { in: ids.designs } } }));
  await t(() => prisma.drawingInPlan.deleteMany({ where: { id: { in: ids.plans } } }));
  await t(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: KEY } });
    if (saved) await prisma.systemSetting.create({ data: { key: saved.key, value: saved.value as never, description: saved.description } });
  });
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
