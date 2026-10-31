// =============================================================================
// SEYİTOĞLU ROTA GEÇİŞİ — BEKÇİ (2026-10-31, SY-G2; TASARIM §8.5 md. 3–4, §8.9 R6)
// =============================================================================
//   ① ÖLÇÜM — rotanın SON adımı fason: TAM kabulde doğan top WAREHOUSE + barkodlu + ACIK,
//      kalite NULL, currentStep yok, iş emri COMPLETED (top KAPANIR; R6 "top kapanmaz" çürür).
//   ② ÖLÇÜM — fasondan sonra iç "Son kontrol" adımı: top IN_PRODUCTION + barkodsuz, sonraki
//      adımda bekler, iş emri açık (finalize iç adıma kalır — tasarımın (a) yolu).
//   ③ KULLANIM — eksik/bilinmeyen argüman, kullanıcısız --apply → çıkış 2, yazım 0.
//   ④ KURU KOŞU — etkilenen varyant + açık iş emri listelenir, son adım fason notu basılır;
//      reçete rotaları, iş emri ve audit parmak izi DEĞİŞMEZ.
//   ⑤ FAIL-CLOSED — aynı rota / pasif yeni rota / bilinmeyen rota → çıkış 1.
//   ⑥ UYGULAMA — yalnız eski rotadaki varyantlar taşınır, açık iş emrinin rotası korunur,
//      varyant başına audit; ⑦ bayat plan atomik claim'e takılır (atlanır, audit yok).
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_seyitoglu_rota_gecis.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { RollForm, RollStatus, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { applyRouteSwitch, planRouteSwitch } from "./lib/rota-gecis";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SCRIPT = path.join(__dirname, "seyitoglu-rota-gecis.ts");
function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { env: process.env, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const TAG = `TST-SYG2-${Date.now()}`;
const woIds: string[] = [];
const rollIds: string[] = [];
const routeIds: string[] = [];
const recipeIds: string[] = [];
let ITEM = "";
let ADMIN = "";
let ADMIN_NAME = "";
let ST_FASON = "";
let ST_INTERNAL = "";
let SUB = "";

async function fixtures(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const fason = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const internal = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  if (!item || !fason || !internal) throw new Error("Seed fixture eksik (PATOS / BOYA_FASON / KURSUN_KK2) — önce 'npm run seed:fixtures'");
  ITEM = item.id;
  ST_FASON = fason.id;
  ST_INTERNAL = internal.id;
  const admin = await ensureTestAdmin();
  ADMIN = admin.id;
  ADMIN_NAME = admin.username;
  SUB = (await ensureTestDyeHouse()).id;
}

async function stockRoll(qty: number): Promise<string> {
  const g = await roleGrade("FIRST");
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      warehouseId: await fixtureWarehouseId(),
      qualityGrade: g.code,
      qualityGradeId: g.id,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

/** Fason 1. adım; `withInternalAfter` ⇒ ardından iç "Son kontrol" adımı. Sevk + TAM kabul. */
async function receiveAtFason(label: string, withInternalAfter: boolean) {
  const steps = [{ stationId: ST_FASON, stepSequence: 1, status: StepStatus.PENDING }];
  if (withInternalAfter) steps.push({ stationId: ST_INTERNAL, stepSequence: 2, status: StepStatus.PENDING });
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-${label}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: { create: steps },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const rollId = await stockRoll(300);
  const fasonStep = wo.steps[0]!.id;
  await sub.dispatch({ workOrderId: wo.id, stepId: fasonStep, subcontractorId: SUB, rollIds: [rollId] }, ADMIN);
  await sub.receive(
    { workOrderId: wo.id, stepId: fasonStep, subcontractorId: SUB, returns: [{ rollId }], newRolls: [{ qty: 290 }] },
    ADMIN,
  );
  const born = await prisma.roll.findFirstOrThrow({
    where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null },
    select: { id: true, status: true, barcode: true, form: true, qualityGradeId: true, currentStepId: true },
  });
  rollIds.push(born.id);
  const after = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
  return { born, woStatus: after.status, nextStepId: wo.steps[1]?.id ?? null };
}

async function makeRoute(label: string, stationIds: string[], isActive = true): Promise<string> {
  const r = await prisma.route.create({
    data: {
      code: `${TAG}-${label}`.slice(0, 32),
      name: `${TAG} ${label}`,
      isActive,
      steps: { create: stationIds.map((stationId, i) => ({ stationId, sequence: i + 1 })) },
    },
    select: { id: true },
  });
  routeIds.push(r.id);
  return r.id;
}

async function makeRecipe(label: string, routeId: string): Promise<{ id: string; code: string }> {
  const code = `${TAG}-${label}`.slice(0, 32);
  const r = await prisma.productRecipe.create({
    data: { code, name: `${TAG} ${label}`, itemId: ITEM, routeId },
    select: { id: true, code: true },
  });
  recipeIds.push(r.id);
  return r;
}

async function main(): Promise<void> {
  const block = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (block) {
    check("hedef DB test DB'si", false, block);
    return;
  }
  await fixtures();

  // ── ① / ② ÖLÇÜM ──
  const last = await receiveAtFason("SON", false);
  check(
    "§1 son adım fason: doğan top WAREHOUSE + barkodlu + ACIK, kalite NULL, adımsız",
    last.born.status === RollStatus.WAREHOUSE &&
      last.born.barcode !== null &&
      last.born.form === RollForm.ACIK &&
      last.born.qualityGradeId === null &&
      last.born.currentStepId === null,
    JSON.stringify(last.born),
  );
  check("§1b son adım fason: TAM kabul iş emrini kapatır", last.woStatus === "COMPLETED", last.woStatus);
  const mid = await receiveAtFason("ARA", true);
  check(
    "§2 fason + iç Son kontrol: doğan top IN_PRODUCTION, barkodsuz, sonraki iç adımda",
    mid.born.status === RollStatus.IN_PRODUCTION && mid.born.barcode === null && mid.born.currentStepId === mid.nextStepId,
    JSON.stringify(mid.born),
  );
  check("§2b fason + iç Son kontrol: iş emri açık kalır", mid.woStatus === "IN_PROGRESS", mid.woStatus);

  // ── ④ kurulum verisi ──
  const oldRoute = await makeRoute("ESKI", [ST_FASON, ST_INTERNAL]);
  const newRoute = await makeRoute("YENI", [ST_INTERNAL, ST_FASON]);
  const passive = await makeRoute("PASIF", [ST_INTERNAL], false);
  const r1 = await makeRecipe("V1", oldRoute);
  const r2 = await makeRecipe("V2", oldRoute);
  const r3 = await makeRecipe("V3", newRoute);
  const openWo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-ACIK`,
      type: "STOCK_PRODUCTION",
      status: "PLANNED",
      targetItemId: ITEM,
      routeTemplateId: oldRoute,
      steps: { create: [{ stationId: ST_FASON, stepSequence: 1, status: StepStatus.PENDING }] },
    },
    select: { id: true, workOrderNumber: true },
  });
  woIds.push(openWo.id);
  const oldCode = `${TAG}-ESKI`.slice(0, 32);
  const newCode = `${TAG}-YENI`.slice(0, 32);

  const fingerprint = async (): Promise<string> => {
    const recipes = await prisma.productRecipe.findMany({ where: { id: { in: recipeIds } }, orderBy: { code: "asc" }, select: { code: true, routeId: true } });
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: openWo.id }, select: { routeTemplateId: true } });
    const logs = await prisma.systemLog.count({ where: { tableName: "PRODUCT_RECIPE" } });
    return JSON.stringify({ recipes, wo, logs });
  };
  const before = await fingerprint();

  // ── ③ KULLANIM ──
  const u1 = run([`--eski-rota=${oldCode}`]);
  const u2 = run([`--eski-rota=${oldCode}`, `--yeni-rota=${newCode}`, "--apply"]);
  const u3 = run([`--eski-rota=${oldCode}`, `--yeni-rota=${newCode}`, "--bilinmeyen"]);
  check("§3 eksik / kullanıcısız --apply / bilinmeyen argüman → çıkış 2", u1.code === 2 && u2.code === 2 && u3.code === 2, `${u1.code}/${u2.code}/${u3.code}`);
  check("§3b kullanım hatası yazmaz", (await fingerprint()) === before);

  // ── ④ KURU KOŞU ──
  const dry = run([`--eski-rota=${oldCode}`, `--yeni-rota=${newCode}`]);
  check("§4 kuru koşu çıkış 0", dry.code === 0, dry.out.slice(-300));
  check("§4b etkilenen varyantlar listelenir (yalnız eski rotadakiler)", dry.out.includes(r1.code) && dry.out.includes(r2.code) && !dry.out.includes(r3.code) && dry.out.includes("Etkilenen varyantlar (2)"));
  check("§4c açık iş emri listelenir ve varyanta bağlanır", dry.out.includes(`açık iş emri: ${openWo.workOrderNumber}`) && dry.out.includes("açık iş emirleri (1)"));
  check("§4d yeni rotanın son adımı fason → finalize notu basılır", dry.out.includes("Son adım fason"));
  check("§4e kuru koşu hiçbir şey yazmaz (rota · iş emri · audit)", (await fingerprint()) === before && dry.out.includes("yazılan 0"));

  // ── ⑤ FAIL-CLOSED ──
  const f1 = run([`--eski-rota=${oldCode}`, `--yeni-rota=${oldCode}`]);
  const f2 = run([`--eski-rota=${oldCode}`, `--yeni-rota=${TAG}-PASIF`]);
  const f3 = run([`--eski-rota=${oldCode}`, `--yeni-rota=${TAG}-YOK`]);
  check("§5 aynı rota / pasif yeni rota / bilinmeyen rota → çıkış 1", f1.code === 1 && f2.code === 1 && f3.code === 1, `${f1.code}/${f2.code}/${f3.code}`);
  check("§5b hata yolu yazmaz", (await fingerprint()) === before && passive.length > 0);

  // ── ⑥ UYGULAMA ──
  const stalePlan = await planRouteSwitch(oldCode, newCode);
  const ap = run([`--eski-rota=${oldCode}`, `--yeni-rota=${newCode}`, "--apply", `--kullanici=${ADMIN_NAME}`]);
  check("§6 --apply çıkış 0", ap.code === 0, ap.out.slice(-300));
  const moved = await prisma.productRecipe.findMany({ where: { id: { in: recipeIds } }, select: { id: true, routeId: true } });
  const routeOf = (id: string) => moved.find((m) => m.id === id)?.routeId;
  check("§6b eski rotadaki iki varyant yeni rotada, diğeri dokunulmadı", routeOf(r1.id) === newRoute && routeOf(r2.id) === newRoute && routeOf(r3.id) === newRoute);
  const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: openWo.id }, select: { routeTemplateId: true } });
  check("§6c açık iş emri eski rotasını korur", woAfter.routeTemplateId === oldRoute);
  const stamped = await prisma.productRecipe.findMany({ where: { id: { in: [r1.id, r2.id] } }, select: { updatedById: true } });
  check("§6f taşınan reçetede künye (updatedById) uygulayan kullanıcı", stamped.length === 2 && stamped.every((s) => s.updatedById === ADMIN), JSON.stringify(stamped));
  const audits = await prisma.systemLog.count({ where: { tableName: "PRODUCT_RECIPE", recordId: { in: [r1.id, r2.id] } } });
  check("§6d varyant başına audit", audits === 2, String(audits));
  const again = run([`--eski-rota=${oldCode}`, `--yeni-rota=${newCode}`]);
  check("§6e ikinci kuru koşu boş (idempotent)", again.code === 0 && again.out.includes("Etkilenen varyantlar (0)"));

  // ── ⑦ ATOMİK CLAIM ──
  const res = await applyRouteSwitch(stalePlan, ADMIN);
  const audits2 = await prisma.systemLog.count({ where: { tableName: "PRODUCT_RECIPE", recordId: { in: [r1.id, r2.id] } } });
  check("§7 bayat plan claim'e takılır: yazılan 0, atlanan 2, yeni audit yok", res.written.length === 0 && res.skipped.length === 2 && audits2 === 2, JSON.stringify(res));
}

async function cleanup(): Promise<void> {
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${String((e as Error).message ?? e).split("\n").filter(Boolean).pop()}`);
    }
  };
  const all = await prisma.roll.findMany({
    where: { OR: [{ id: { in: rollIds } }, { parentReceipt: { workOrderId: { in: woIds } } }] },
    select: { id: true },
  });
  const ids = [...new Set([...rollIds, ...all.map((r) => r.id)])];
  if (ids.length) {
    await step("depo ters satırı", () => prisma.warehouseMovement.deleteMany({ where: { reversesMovement: { rollId: { in: ids } } } }));
    await step("depo satırı", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }));
    await step("sapma", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
    await step("hareket", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
    await step("operasyon", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
    await step("özellik", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  }
  if (woIds.length) {
    await step("kabul", () => prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("sevk", () => prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }));
  }
  if (ids.length) await step("top", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  if (woIds.length) {
    await step("parti", () => prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("refakat kartı", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("adım", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("iş emri", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }));
  }
  if (recipeIds.length) await step("reçete", () => prisma.productRecipe.deleteMany({ where: { id: { in: recipeIds } } }));
  if (routeIds.length) await step("rota", () => prisma.route.deleteMany({ where: { id: { in: routeIds } } }));
  if (errors.length > 0) {
    fail++;
    console.error(`❌ TEMİZLİK HATASI — kalıntı kaldı: ${errors.join(" · ")}`);
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
