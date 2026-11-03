// =============================================================================
// Atanan kurşun makinesi (K16) + müşteriye özel varsayılan gramaj (S3, fabrika cevabı 14/21-ek, 2026-11-03)
// =============================================================================
// Kilitlenen:
//   §1 Ayar `kursun.machineAssignMode`: varsayılan SUGGEST; bilinmeyen değer 400; okuyucu tanınmayanı SUGGEST'e düşürür
//   §2 SUGGEST (bugünkü): tablet açık kart listesi süzülmez, başka makine uyarısı yok, "yine de al" iz yazmaz
//   §3 ASSIGNED_ONLY_WARN: liste yalnız oturum makinesine planlı + atanmamış işler; oturum makinesi yoksa süzgeç yok
//   §4 ASSIGNED_ONLY_WARN: başka makineye atanmış kart okutunca `foreignMachine` dolu; kendi/atanmamış işte null;
//      "yine de al" → SystemLog izi (event KURSUN_FOREIGN_MACHINE_TAKE), plan DEĞİŞMEZ
//   §5 Cari "Varsayılan kurşun gramajı": müşteri carisine kurşun değeri yazılır + okuma ucunda görünür; kurşun dışı
//      değer 400 KURSUN_GRAMAJ_INVALID; fason carisi 400 KURSUN_DEFAULT_NOT_CUSTOMER; pasif değer listeye girmez; null temizler
//   §6 STATİK: liste parçası ve okutma yüklemi aynı helper'dan (boğaz-ikiz), controller oturum makinesini geçirir
//
// Koşum: npx tsx scripts/test_kursun_machine_assign.ts
// =============================================================================
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { Prisma, RollForm, RollStatus, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { cariService } from "../src/services/cari.service";
import { listKursunCustomerDefaults } from "../src/services/kursun-customer-default.service";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { DEFAULT_KURSUN_MACHINE_ASSIGN_MODE, SETTING_KEYS, readKursunMachineAssignMode, systemSettingService } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try { await fn(); return { status: 200, code: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}

const qc = new KursunQcService();
const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-KMA-${STAMP}`;
const KEY = SETTING_KEYS.KURSUN_MACHINE_ASSIGN_MODE;
const fx = {
  woIds: [] as string[], rollIds: [] as string[], stationIds: [] as string[], machineIds: [] as string[],
  itemIds: [] as string[], customerIds: [] as string[], cariIds: [] as string[], valueIds: [] as string[], propIds: [] as string[],
  kursunCreated: null as string | null, setting: undefined as undefined | null | { value: unknown },
};

async function setMode(key: typeof KEY, v: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v, description: "TEST — atanan kurşun makinesi" }, update: { value: v } });
}

interface Job { woId: string; stepId: string; card: string }

async function makeJob(ctx: { itemId: string; stationId: string; tamburId: string }, tag: string, plannedMachineId: string | null): Promise<Job> {
  const number = `${P}-${tag}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: ctx.itemId,
      steps: { create: [
        { stationId: ctx.stationId, stepSequence: 1, status: StepStatus.ACTIVE, plannedMachineId },
        { stationId: ctx.tamburId, stepSequence: 2, status: StepStatus.PENDING },
      ] },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  fx.woIds.push(wo.id);
  const stepId = wo.steps.find((s) => s.stepSequence === 1)!.id;
  await prisma.travelerCard.create({ data: { cardNumber: number, barcode: number, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
  const roll = await prisma.roll.create({
    data: { barcode: null, itemId: ctx.itemId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100 } });
  return { woId: wo.id, stepId, card: number };
}

async function main(): Promise<void> {
  console.log("=== Atanan kurşun makinesi (K16) + müşteri varsayılan gramajı (S3) ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }
  const actor = await testActorId();
  fx.setting = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });

  const itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST KMA kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(itemId);
  const mkStation = async (n: string, kind: "PROCESS_QC" | "TAMBUR") => {
    const st = await prisma.station.create({ data: { code: `${P}-${n}`.slice(0, 32), name: `TEST KMA ${n} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE" }, select: { id: true } });
    fx.stationIds.push(st.id);
    return st.id;
  };
  const stationId = await mkStation("K", "PROCESS_QC");
  const tamburId = await mkStation("T", "TAMBUR");
  const mkMachine = async (n: string) => {
    const m = await prisma.machine.create({ data: { stationId, code: `${P}-M${n}`.slice(0, 32), name: `TEST KMA Makine ${n}`, isActive: true }, select: { id: true } });
    fx.machineIds.push(m.id);
    return m.id;
  };
  const m1 = await mkMachine("1");
  const m2 = await mkMachine("2");
  const ctx = { itemId, stationId, tamburId };
  const j1 = await makeJob(ctx, "M1", m1);
  const j2 = await makeJob(ctx, "M2", m2);
  const j0 = await makeJob(ctx, "BOS", null);
  const ours = new Set([j1.stepId, j2.stepId, j0.stepId]);
  const listed = async (machineId: string | null) =>
    new Set((await qc.listOpenCards(stationId, machineId)).data.map((c) => c.stepId).filter((id) => ours.has(id)));

  // ── §1 ──
  section("§1 ayar");
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  check("varsayılan SUGGEST (bugünkü davranış)", DEFAULT_KURSUN_MACHINE_ASSIGN_MODE === "SUGGEST" && (await readKursunMachineAssignMode()) === "SUGGEST");
  check("bayrak yükünde alan var, varsayılan SUGGEST", (await systemSettingService.getFeatureFlags()).data.kursunMachineAssignMode === "SUGGEST");
  const bad = await errOf(() => systemSettingService.setFeatureFlags({ kursunMachineAssignMode: "HER_YER" } as never, actor));
  check("bilinmeyen değer 400 (fail-closed)", bad.status === 400, JSON.stringify(bad));
  await setMode(KEY, "COP");
  check("DB'de tanınmayan değer → SUGGEST", (await readKursunMachineAssignMode()) === "SUGGEST");

  // ── §2 ──
  section("§2 SUGGEST — bugünkü davranış");
  await setMode(KEY, "SUGGEST");
  const s2 = await listed(m1);
  check("M1 tableti üç işi de görür (süzgeç yok)", s2.size === 3, String(s2.size));
  const sum2 = await qc.getByCardBarcode(j2.card, stationId, m1);
  check("M2'ye atanmış kart M1'de: uyarı yok", sum2.data.foreignMachine === null);
  check("özet planlı makine adını taşır", sum2.data.plannedMachineName === "TEST KMA Makine 2", String(sum2.data.plannedMachineName));
  const t2 = await qc.takeForeignMachine(j2.stepId, m1, actor);
  check("'yine de al' SUGGEST'te iz yazmaz", t2.data.logged === false);

  // ── §3 ──
  section("§3 ASSIGNED_ONLY_WARN — liste süzgeci");
  await setMode(KEY, "ASSIGNED_ONLY_WARN");
  const s3 = await listed(m1);
  check("M1 tableti: kendi işi + atanmamış iş", s3.has(j1.stepId) && s3.has(j0.stepId), [...s3].join(","));
  check("M1 tableti: M2'ye atanmış iş GÖRÜNMEZ", !s3.has(j2.stepId));
  const s3b = await listed(m2);
  check("M2 tableti: M2 işi + atanmamış, M1 işi yok", s3b.has(j2.stepId) && s3b.has(j0.stepId) && !s3b.has(j1.stepId), [...s3b].join(","));
  const s3c = await listed(null);
  check("oturum makinesi yok (web / eski cihaz): süzgeç yok", s3c.size === 3, String(s3c.size));

  // ── §4 ──
  section("§4 ASSIGNED_ONLY_WARN — başka makine okutması");
  const sum4 = await qc.getByCardBarcode(j2.card, stationId, m1);
  check("M2 işi M1'de okutuldu → foreignMachine M2", sum4.data.foreignMachine?.plannedMachineId === m2 && sum4.data.foreignMachine?.plannedMachineName === "TEST KMA Makine 2", JSON.stringify(sum4.data.foreignMachine));
  check("kendi işi → uyarı yok", (await qc.getByCardBarcode(j1.card, stationId, m1)).data.foreignMachine === null);
  check("atanmamış iş → uyarı yok", (await qc.getByCardBarcode(j0.card, stationId, m1)).data.foreignMachine === null);
  check("oturum makinesi yok → uyarı yok", (await qc.getByCardBarcode(j2.card, stationId, null)).data.foreignMachine === null);
  check("getStep yolu da uyarır", (await qc.getStep(j2.stepId, { sessionMachineId: m1 })).data.foreignMachine?.plannedMachineId === m2);
  const t4 = await qc.takeForeignMachine(j2.stepId, m1, actor);
  check("'yine de al' → iz yazıldı", t4.data.logged === true);
  const log = await prisma.systemLog.findFirst({ where: { tableName: "WORK_ORDER_STEP", recordId: j2.stepId }, orderBy: { createdAt: "desc" }, select: { newData: true, userId: true } });
  const nd = (log?.newData ?? {}) as Record<string, unknown>;
  check("iz: event + planlı + alan makine", nd.event === "KURSUN_FOREIGN_MACHINE_TAKE" && nd.plannedMachineId === m2 && nd.takenOnMachineId === m1 && log?.userId === actor, JSON.stringify(nd));
  check("plan DEĞİŞMEDİ (atamayı planlamacı değiştirir)", (await prisma.workOrderStep.findUnique({ where: { id: j2.stepId }, select: { plannedMachineId: true } }))?.plannedMachineId === m2);
  check("kendi işinde 'yine de al' iz yazmaz", (await qc.takeForeignMachine(j1.stepId, m1, actor)).data.logged === false);
  await prisma.workOrderStep.update({ where: { id: j2.stepId }, data: { status: StepStatus.COMPLETED } });
  check("kapanmış adımda uyarı yok (yeniden açma kendi akışında)", (await qc.getStep(j2.stepId, { sessionMachineId: m1 })).data.foreignMachine === null);
  await prisma.workOrderStep.update({ where: { id: j2.stepId }, data: { status: StepStatus.ACTIVE } });

  // ── §5 ──
  section("§5 cari varsayılan kurşun gramajı");
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variantId = (await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true } }))?.id;
  if (!variantId) {
    variantId = (await prisma.fabricProperty.create({ data: { code: `${P}-GR`.slice(0, 32), name: `TEST KMA gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id }, select: { id: true } })).id;
    fx.propIds.push(variantId);
  }
  const v75 = (await prisma.fabricPropertyValue.create({ data: { propertyId: variantId, code: `KMA75-${STAMP}`.toUpperCase(), name: "75 gr", sortOrder: 90, amount: "75" }, select: { id: true } })).id;
  fx.valueIds.push(v75);
  const other = (await prisma.fabricProperty.create({ data: { code: `${P}-OT`.slice(0, 32), name: `TEST KMA başka ${STAMP}`, valueType: "CHOICE" }, select: { id: true } })).id;
  fx.propIds.push(other);
  const vOther = (await prisma.fabricPropertyValue.create({ data: { propertyId: other, code: `KMAX-${STAMP}`.toUpperCase(), name: "Başka", sortOrder: 1 }, select: { id: true } })).id;
  fx.valueIds.push(vOther);
  const cust = (await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST KMA müşteri ${STAMP}` }, select: { id: true } })).id;
  fx.customerIds.push(cust);
  const cari = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust }, select: { id: true } })).id;
  fx.cariIds.push(cari);
  const mine = async () => (await listKursunCustomerDefaults()).find((d) => d.customerId === cust)?.valueId ?? null;

  check("başlangıçta müşteri varsayılanı yok", (await mine()) === null);
  await cariService.update(cari, { kursunDefaultValueId: v75 }, actor);
  check("müşteri carisine kurşun değeri yazıldı", (await prisma.cariAccount.findUnique({ where: { id: cari }, select: { kursunDefaultValueId: true } }))?.kursunDefaultValueId === v75);
  check("okuma ucunda müşteri → 75 gr", (await mine()) === v75);
  check("cari satırı alanı taşır (panel formu)", (await cariService.findById(cari)).data.kursunDefaultValueId === v75);
  const e1 = await errOf(() => cariService.update(cari, { kursunDefaultValueId: vOther }, actor));
  check("kurşun dışı değer 400 KURSUN_GRAMAJ_INVALID", e1.status === 400 && e1.code === "KURSUN_GRAMAJ_INVALID", JSON.stringify(e1));
  const dye = await ensureTestDyeHouse();
  let fason = await prisma.cariAccount.findFirst({ where: { subcontractorId: dye.id }, select: { id: true } });
  if (!fason) { fason = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: dye.id }, select: { id: true } }); fx.cariIds.push(fason.id); }
  const e2 = await errOf(() => cariService.update(fason!.id, { kursunDefaultValueId: v75 }, actor));
  check("fason carisi 400 KURSUN_DEFAULT_NOT_CUSTOMER", e2.status === 400 && e2.code === "KURSUN_DEFAULT_NOT_CUSTOMER", JSON.stringify(e2));
  await prisma.fabricPropertyValue.update({ where: { id: v75 }, data: { isActive: false } });
  check("pasif değer listeye girmez (form istasyon varsayılanına düşer)", (await mine()) === null);
  await prisma.fabricPropertyValue.update({ where: { id: v75 }, data: { isActive: true } });
  await cariService.update(cari, { kursunDefaultValueId: null }, actor);
  check("null temizler", (await mine()) === null && (await prisma.cariAccount.findUnique({ where: { id: cari }, select: { kursunDefaultValueId: true } }))?.kursunDefaultValueId === null);

  // ── §6 ──
  section("§6 STATİK — tek kaynak");
  const src = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");
  const qcSrc = src("services/kursun-qc.service.ts");
  check("listOpenCards süzgeci helper parçasından", /assignedMachineListWhere\(await readKursunMachineAssignMode\(\), sessionMachineId\)/.test(qcSrc));
  check("okutma uyarısı helper yükleminden", /foreignMachineOf\(await readKursunMachineAssignMode\(\), opts\.sessionMachineId, step\)/.test(qcSrc));
  const ctrl = src("controllers/kursun-qc.controller.ts");
  check("controller açık kart + okutma uçlarına oturum makinesini geçirir",
    /listOpenCards\(stamp\?\.stationId \?\? null, stamp\?\.machineId \?\? null\)/.test(ctrl) && /stamp\?\.stationId \?\? null,\s*stamp\?\.machineId \?\? null\)/.test(ctrl) &&
    /takeForeignMachine\(stepId, stamp\?\.machineId \?\? null/.test(src("controllers/kursun-foreign-machine.controller.ts")));
  const others = ["services/kursun-bypass.service.ts", "services/tambur.service.ts"].filter((f) => /plannedMachineId:\s*sessionMachineId/.test(src(f)));
  check("başka serviste el yazımı makine süzgeci yok", others.length === 0, others.join(","));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  if (fx.setting === null) await del("ayar", () => prisma.systemSetting.deleteMany({ where: { key: KEY } }));
  else if (fx.setting) { const v = fx.setting.value as Prisma.InputJsonValue; await del("ayar", () => prisma.systemSetting.update({ where: { key: KEY }, data: { value: v } })); }
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((s) => s.id);
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...stepIds, ...fx.cariIds] } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: fx.rollIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: fx.cariIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  check("temizlik: TEST-KMA iş emri kalıntısı yok", (await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
