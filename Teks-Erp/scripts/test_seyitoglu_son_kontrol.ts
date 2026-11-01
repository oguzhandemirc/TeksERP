// =============================================================================
// SEYİTOĞLU İÇ "SON KONTROL" ADIMI — BEKÇİ (2026-11-01, SY-P4; TASARIM §8.5 md. 4 yol (a), #343)
// =============================================================================
//   ① KULLANIM — eksik/bilinmeyen argüman, kullanıcısız --apply → çıkış 2, yazım 0.
//   ② KURU KOŞU — son adımı fason rotada eklenecek adım + yaratılacak istasyon + açık iş emri
//      listelenir; rota, istasyon ve audit parmak izi DEĞİŞMEZ.
//   ③ FAIL-CLOSED — bilinmeyen/pasif rota, kalite veremeyen istasyon (KK2 / fason) → çıkış 1.
//   ④ UYGULAMA — rotanın SONUNA adım + iç Tambur istasyonu (muayene açık); kalite ikizi
//      (`stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE`) istasyonu görür; audit; ikinci koşum no-op.
//   ⑤ UÇTAN UCA — fason → Son kontrol iş emri: kabulde top Son kontrol'de bekler; Tambur'da tek
//      tam kesimle KALİTELİ (qualityGradeId dolu) + barkodlu + WAREHOUSE iner, iş emri kapanır.
//   ⑥ BAYT-AYNI — adımı eklenmemiş rota (son adım fason) dokunulmaz; son adımı iç rota "gerek yok".
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_seyitoglu_son_kontrol.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TamburService } from "../src/services/tambur.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { QUALITY_STATION_WHERE, stepCanApplyQuality } from "../src/services/helpers/quality-station.helper";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const SCRIPT = path.join(__dirname, "seyitoglu-son-kontrol.ts");
function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { env: process.env, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const tambur = new TamburService();
const TAG = `TST-SYP4-${Date.now()}`;
const STATION_CODE = `TSYP4${Date.now() % 1e9}`;
const woIds: string[] = [];
const rollIds: string[] = [];
const routeIds: string[] = [];
const stationIds: string[] = [];
let ITEM = "";
let ADMIN = "";
let ADMIN_NAME = "";
let ST_FASON = "";
let ST_KK2 = "";

async function fixtures(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const fason = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kk2 = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  if (!item || !fason || !kk2) throw new Error("Seed fixture eksik (PATOS / BOYA_FASON / KURSUN_KK2) — önce 'npm run seed:fixtures'");
  ITEM = item.id;
  ST_FASON = fason.id;
  ST_KK2 = kk2.id;
  const admin = await ensureTestAdmin();
  ADMIN = admin.id;
  ADMIN_NAME = admin.username;
  await ensureTestDyeHouse();
}

async function makeRoute(label: string, stations: string[], isActive = true): Promise<string> {
  const r = await prisma.route.create({
    data: {
      code: `${TAG}-${label}`.slice(0, 32),
      name: `${TAG} ${label}`,
      isActive,
      steps: { create: stations.map((stationId, i) => ({ stationId, sequence: i + 1 })) },
    },
    select: { id: true },
  });
  routeIds.push(r.id);
  return r.id;
}
const codeOf = (label: string): string => `${TAG}-${label}`.slice(0, 32);

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

async function main(): Promise<void> {
  const block = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (block) {
    check("hedef DB test DB'si", false, block);
    return;
  }
  await fixtures();
  const target = await makeRoute("HEDEF", [ST_FASON]);
  const untouched = await makeRoute("DOKUNMA", [ST_FASON]);
  const internalLast = await makeRoute("IC", [ST_FASON, ST_KK2]);
  await makeRoute("PASIF", [ST_FASON], false);
  const openWo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-ACIK`,
      type: "STOCK_PRODUCTION",
      status: "PLANNED",
      targetItemId: ITEM,
      routeTemplateId: target,
      steps: { create: [{ stationId: ST_FASON, stepSequence: 1, status: StepStatus.PENDING }] },
    },
    select: { id: true, workOrderNumber: true },
  });
  woIds.push(openWo.id);

  const fingerprint = async (): Promise<string> => {
    const steps = await prisma.routeStep.findMany({
      where: { routeId: { in: routeIds } },
      orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
      select: { routeId: true, stationId: true, sequence: true },
    });
    const stations = await prisma.station.count({ where: { code: STATION_CODE } });
    const woSteps = await prisma.workOrderStep.count({ where: { workOrderId: openWo.id } });
    const logs = await prisma.systemLog.count({ where: { tableName: { in: ["ROUTE", "STATION"] }, recordId: { in: routeIds } } });
    return JSON.stringify({ steps, stations, woSteps, logs });
  };
  const before = await fingerprint();
  const ist = `--istasyon=${STATION_CODE}`;

  // ── ① KULLANIM ──
  const u1 = run([ist]);
  const u2 = run([`--rota=${codeOf("HEDEF")}`, ist, "--apply"]);
  const u3 = run([`--rota=${codeOf("HEDEF")}`, "--bilinmeyen"]);
  check("§1 eksik rota / kullanıcısız --apply / bilinmeyen argüman → çıkış 2", u1.code === 2 && u2.code === 2 && u3.code === 2, `${u1.code}/${u2.code}/${u3.code}`);
  check("§1b kullanım hatası yazmaz", (await fingerprint()) === before);

  // ── ② KURU KOŞU ──
  const dry = run([`--rota=${codeOf("HEDEF")}`, ist]);
  check("§2 kuru koşu çıkış 0", dry.code === 0, dry.out.slice(-300));
  check("§2b eklenecek adım sıra 2 + yaratılacak istasyon listelenir", dry.out.includes(`sıra 2 — ${STATION_CODE}`) && dry.out.includes("YARATILACAK istasyon"));
  check("§2c açık iş emri listelenir", dry.out.includes("Açık iş emirleri (1)") && dry.out.includes(openWo.workOrderNumber));
  check("§2d kuru koşu hiçbir şey yazmaz (rota · istasyon · audit)", (await fingerprint()) === before && dry.out.includes("yazılan 0"));

  // ── ③ FAIL-CLOSED ──
  const f1 = run(["--rota=YOK-BOYLE-ROTA-SYP4", ist]);
  const f2 = run([`--rota=${codeOf("PASIF")}`, ist]);
  const f3 = run([`--rota=${codeOf("HEDEF")}`, "--istasyon=KURSUN_KK2"]);
  const f4 = run([`--rota=${codeOf("HEDEF")}`, "--istasyon=BOYA_FASON"]);
  check("§3 bilinmeyen / pasif rota → çıkış 1", f1.code === 1 && f2.code === 1, `${f1.code}/${f2.code}`);
  check("§3b kalite veremeyen istasyon (KK2 · fason) → çıkış 1", f3.code === 1 && f4.code === 1 && f3.out.includes("kalite veremez"), `${f3.code}/${f4.code}`);
  check("§3c hata yolu yazmaz", (await fingerprint()) === before);

  // ── ④ UYGULAMA ──
  const ap = run([`--rota=${codeOf("HEDEF")}`, ist, "--apply", `--kullanici=${ADMIN_NAME}`]);
  check("§4 --apply çıkış 0", ap.code === 0, ap.out.slice(-300));
  const st = await prisma.station.findUnique({
    where: { code: STATION_CODE },
    select: { id: true, type: true, kind: true, isActive: true, inspectionEnabled: true, createdById: true },
  });
  if (st) stationIds.push(st.id);
  check(
    "§4b istasyon iç + Tambur türü + muayene açık + künyeli",
    !!st && st.type === StationType.INTERNAL && st.kind === StationKind.TAMBUR && st.isActive && st.inspectionEnabled && st.createdById === ADMIN,
    JSON.stringify(st),
  );
  const twin = st ? await prisma.station.count({ where: { id: st.id, ...QUALITY_STATION_WHERE } }) : 0;
  check("§4c kalite ikizi: stepCanApplyQuality ↔ QUALITY_STATION_WHERE istasyonu görür", !!st && stepCanApplyQuality(st) && twin === 1);
  const steps = await prisma.routeStep.findMany({ where: { routeId: target }, orderBy: { sequence: "asc" }, select: { stationId: true, sequence: true } });
  check("§4d rota: fason (1) → Son kontrol (2)", steps.length === 2 && steps[0]!.stationId === ST_FASON && steps[1]!.stationId === st?.id && steps[1]!.sequence === 2, JSON.stringify(steps));
  const woStepsAfter = await prisma.workOrderStep.count({ where: { workOrderId: openWo.id } });
  check("§4e açık iş emri kendi adımlarını korur", woStepsAfter === 1);
  const audits = await prisma.systemLog.count({ where: { OR: [{ tableName: "ROUTE", recordId: target }, { tableName: "STATION", recordId: st?.id ?? "" }] } });
  check("§4f audit: rota + istasyon", audits === 2, String(audits));
  const again = run([`--rota=${codeOf("HEDEF")}`, ist, "--apply", `--kullanici=${ADMIN_NAME}`]);
  const stepsAgain = await prisma.routeStep.count({ where: { routeId: target } });
  check("§4g ikinci koşum no-op (gerek yok, adım tekrar eklenmez)", again.code === 0 && again.out.includes("Gerek yok") && stepsAgain === 2);

  // ── ⑤ UÇTAN UCA: fason → Son kontrol (Tambur) → kaliteli finalize ──
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-E2E`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetQuantity: 1000,
      targetItemId: ITEM,
      routeTemplateId: target,
      steps: { create: steps.map((s) => ({ stationId: s.stationId, stepSequence: s.sequence, status: StepStatus.PENDING })) },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const SUB = (await ensureTestDyeHouse()).id;
  const src = await stockRoll(300);
  const fasonStep = wo.steps[0]!.id;
  await sub.dispatch({ workOrderId: wo.id, stepId: fasonStep, subcontractorId: SUB, rollIds: [src] }, ADMIN);
  await sub.receive(
    { workOrderId: wo.id, stepId: fasonStep, subcontractorId: SUB, returns: [{ rollId: src }], newRolls: [{ qty: 290 }] },
    ADMIN,
  );
  const born = await prisma.roll.findFirstOrThrow({
    where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null },
    select: { id: true, status: true, currentStepId: true, currentQty: true },
  });
  rollIds.push(born.id);
  check("§5 fason kabulü: top Son kontrol adımında bekler (IN_PRODUCTION)", born.status === RollStatus.IN_PRODUCTION && born.currentStepId === wo.steps[1]!.id, JSON.stringify(born));
  const grade = await roleGrade("FIRST");
  await tambur.finalize(
    {
      rollId: born.id,
      decisions: [],
      cuts: [{ length: Number(born.currentQty), qualityGrade: grade.code, relatedErrorIds: [] }],
      confirmMismatch: true,
    },
    ADMIN,
  );
  const out = await prisma.roll.findMany({
    where: { parentRollId: born.id },
    select: { id: true, status: true, barcode: true, qualityGradeId: true, currentStepId: true },
  });
  rollIds.push(...out.map((r) => r.id));
  check(
    "§5b Son kontrol: çıkan top KALİTELİ + barkodlu + WAREHOUSE, adımsız",
    out.length === 1 && out[0]!.status === RollStatus.WAREHOUSE && out[0]!.qualityGradeId === grade.id && !!out[0]!.barcode && out[0]!.currentStepId === null,
    JSON.stringify(out),
  );
  const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
  check("§5c iş emri kapanır", woAfter.status === "COMPLETED", woAfter.status);

  // ── ⑥ BAYT-AYNI ──
  const untouchedSteps = await prisma.routeStep.count({ where: { routeId: untouched } });
  check("§6 adımı eklenmemiş rota dokunulmaz (son adım fason kalır)", untouchedSteps === 1);
  const ic = run([`--rota=${codeOf("IC")}`, ist, "--apply", `--kullanici=${ADMIN_NAME}`]);
  const icSteps = await prisma.routeStep.count({ where: { routeId: internalLast } });
  check("§6b son adımı iç rota: gerek yok, yazılan 0", ic.code === 0 && ic.out.includes("Gerek yok") && icSteps === 2, ic.out.slice(-200));
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
    where: { OR: [{ id: { in: rollIds } }, { parentReceipt: { workOrderId: { in: woIds } } }, { parentRollId: { in: rollIds } }] },
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
    await step("hata", () => prisma.rollError.deleteMany({ where: { rollId: { in: ids } } }));
  }
  if (woIds.length) {
    await step("kabul", () => prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("sevk", () => prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }));
  }
  if (ids.length) {
    await step("çocuk top", () => prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } }));
    await step("top", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  }
  if (woIds.length) {
    await step("parti", () => prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("refakat kartı", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("adım", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }));
    await step("iş emri", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }));
  }
  if (routeIds.length) await step("rota", () => prisma.route.deleteMany({ where: { id: { in: routeIds } } }));
  const created = await prisma.station.findMany({ where: { code: STATION_CODE }, select: { id: true } });
  const sIds = [...new Set([...stationIds, ...created.map((s) => s.id)])];
  if (sIds.length) await step("istasyon", () => prisma.station.deleteMany({ where: { id: { in: sIds } } }));
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
