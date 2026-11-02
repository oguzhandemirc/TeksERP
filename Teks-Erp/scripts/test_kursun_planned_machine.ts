// =============================================================================
// Plan makinesi (Gülkesim 2026-11-02) — rota/İE adımının ÖNERİLEN makinesi
// =============================================================================
// Yalnız öneri: fiilî makine tablet oturumundan; engel/uyarı yok. Kilitlenen:
//   §1 Rota şablonu: kurşun adımına kendi istasyonunun makinesi yazılır; başka
//      istasyonun makinesi 400 PLANNED_MACHINE_STATION_MISMATCH, pasif 400 INACTIVE
//   §2 create(): şablon önerisi İE adımına KLONLANIR
//   §3 create(): stepPlanning önerisi ezer, null temizler; başka istasyon makinesi 400
//   §4 Şablon önerisi sonradan pasife düştüyse açılış DURMAZ: öneri düşer + uyarı
//   §5 PATCH ucu (servis): değiştirir/temizler; kapanmış adım 409 STEP_NOT_OPEN;
//      başka istasyon makinesi 400; başka İE'nin adımı 404
//   §6 replace(): overlay verilmezse planlamacının sonradan seçimi KORUNUR
//   §7 Dağıtım ekranı ve tablet kuyruğu plan makinesi adını taşır
//
// Koşum: npx tsx scripts/test_kursun_planned_machine.ts
// =============================================================================
import { StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { updateStepPlannedMachine } from "../src/services/step-planned-machine.service";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { AppError } from "../src/utils/app-error";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Beklenen AppError'ın HTTP durumu + details.code'u. */
async function expectError(label: string, fn: () => Promise<unknown>, status: number, code?: string): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu, geçti");
  } catch (e) {
    const ok = e instanceof AppError && e.statusCode === status && (!code || e.details?.code === code);
    check(label, ok, e instanceof AppError ? `${e.statusCode} ${String(e.details?.code ?? "")}` : String(e));
  }
}

const svc = new WorkOrderService();
const routeSvc = new RouteService(ROUTE_SERVICE_CONFIG);
const stamp = `${Date.now()}`.slice(-8);

let ITEM = "";
let ADMIN = "";
let ST_KURSUN = "";
let ST_TAMBUR = "";
let M_TAMBUR = "";
const createdWo: string[] = [];
const createdRoutes: string[] = [];
const createdMachines: string[] = [];

async function need(v: { id: string } | null, label: string): Promise<string> {
  if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return v.id;
}

async function makeMachine(stationId: string, tag: string): Promise<string> {
  const m = await prisma.machine.create({
    data: { stationId, code: `TST-PM-${tag}-${stamp}`, name: `TEST PM ${tag} ${stamp}`, isActive: true },
    select: { id: true },
  });
  createdMachines.push(m.id);
  return m.id;
}

async function stepMachines(woId: string): Promise<(string | null)[]> {
  const steps = await prisma.workOrderStep.findMany({
    where: { workOrderId: woId },
    orderBy: { stepSequence: "asc" },
    select: { plannedMachineId: true },
  });
  return steps.map((s) => s.plannedMachineId);
}

async function createWo(extra: Record<string, unknown>): Promise<{ id: string; warnings: string[] }> {
  const r = await svc.create(
    { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 250, ...extra } as Parameters<WorkOrderService["create"]>[0],
    ADMIN,
  );
  const id = (r.data as { id: string }).id;
  createdWo.push(id);
  return { id, warnings: (r as { warnings?: string[] }).warnings ?? [] };
}

async function main(): Promise<void> {
  ITEM = await need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  ADMIN = await testActorId();
  ST_KURSUN = await need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ST_TAMBUR = await need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  M_TAMBUR = await need(await prisma.machine.findFirst({ where: { stationId: ST_TAMBUR }, select: { id: true } }), "Tambur makinesi");
  const mA = await makeMachine(ST_KURSUN, "A");
  const mB = await makeMachine(ST_KURSUN, "B");
  const mPasif = await makeMachine(ST_KURSUN, "P");
  await prisma.machine.update({ where: { id: mPasif }, data: { isActive: false } });

  // ══ §1 Rota şablonu ═══════════════════════════════════════════════════════
  console.log("\n§1 Rota şablonu: kurşun adımına makine önerisi");
  const r = await routeSvc.create(
    {
      code: `TST-PM-${stamp}`,
      name: `TEST Plan Makinesi ${stamp}`,
      steps: [
        { stationId: ST_KURSUN, sequence: 1, plannedMachineId: mA },
        { stationId: ST_TAMBUR, sequence: 2 },
      ],
    },
    ADMIN,
  );
  const routeId = (r.data as { id: string }).id;
  createdRoutes.push(routeId);
  const rs = await prisma.routeStep.findFirst({ where: { routeId, sequence: 1 }, select: { plannedMachineId: true } });
  check("şablon adımına öneri yazıldı", rs?.plannedMachineId === mA);
  await expectError(
    "şablon: başka istasyonun makinesi → 400",
    () => routeSvc.create({ code: `TST-PMX-${stamp}`, name: `TEST PMX ${stamp}`, steps: [{ stationId: ST_KURSUN, sequence: 1, plannedMachineId: M_TAMBUR }] }, ADMIN),
    400,
    "PLANNED_MACHINE_STATION_MISMATCH",
  );
  await expectError(
    "şablon: pasif makine → 400",
    () => routeSvc.create({ code: `TST-PMY-${stamp}`, name: `TEST PMY ${stamp}`, steps: [{ stationId: ST_KURSUN, sequence: 1, plannedMachineId: mPasif }] }, ADMIN),
    400,
    "PLANNED_MACHINE_INACTIVE",
  );

  // ══ §2 Klon ═══════════════════════════════════════════════════════════════
  console.log("\n§2 create(): şablon önerisi İE adımına klonlanır");
  const w1 = await createWo({ routeTemplateId: routeId });
  const m1 = await stepMachines(w1.id);
  check("kurşun adımı şablon makinesini taşır", m1[0] === mA, `okunan: ${m1[0]}`);
  check("tambur adımı önerisiz", m1[1] === null);

  // ══ §3 Ezme / temizleme ═══════════════════════════════════════════════════
  console.log("\n§3 create(): stepPlanning ezer / temizler");
  const w2 = await createWo({ routeTemplateId: routeId, stepPlanning: [{ sequence: 1, plannedMachineId: mB }] });
  check("overlay şablonu ezer", (await stepMachines(w2.id))[0] === mB);
  const w3 = await createWo({ routeTemplateId: routeId, stepPlanning: [{ sequence: 1, plannedMachineId: null }] });
  check("overlay null öneriyi temizler", (await stepMachines(w3.id))[0] === null);
  await expectError(
    "overlay: başka istasyonun makinesi → 400",
    () => createWo({ routeTemplateId: routeId, stepPlanning: [{ sequence: 1, plannedMachineId: M_TAMBUR }] }),
    400,
    "PLANNED_MACHINE_STATION_MISMATCH",
  );

  // ══ §4 Bayat şablon önerisi ═══════════════════════════════════════════════
  console.log("\n§4 Şablon makinesi pasife düştü → açılış durmaz, uyarı");
  await prisma.machine.update({ where: { id: mA }, data: { isActive: false } });
  const w4 = await createWo({ routeTemplateId: routeId });
  check("bayat öneri düşer", (await stepMachines(w4.id))[0] === null);
  check("uyarı döner", w4.warnings.some((w) => w.includes("önerilen makine")), JSON.stringify(w4.warnings));
  await prisma.machine.update({ where: { id: mA }, data: { isActive: true } });

  // ══ §5 PATCH ucu ══════════════════════════════════════════════════════════
  console.log("\n§5 Sonradan değiştirme (atomik claim)");
  const s1 = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: w1.id, stepSequence: 1 }, select: { id: true } });
  const s2 = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: w2.id, stepSequence: 1 }, select: { id: true } });
  const p1 = await updateStepPlannedMachine(w1.id, s1.id, mB, ADMIN);
  check("değiştir → 200 + ad", p1.data?.plannedMachineId === mB && !!p1.data?.plannedMachineName);
  check("DB'de yeni öneri", (await stepMachines(w1.id))[0] === mB);
  await updateStepPlannedMachine(w1.id, s1.id, null, ADMIN);
  check("null → temizlendi", (await stepMachines(w1.id))[0] === null);
  await expectError("başka istasyonun makinesi → 400", () => updateStepPlannedMachine(w1.id, s1.id, M_TAMBUR, ADMIN), 400, "PLANNED_MACHINE_STATION_MISMATCH");
  await expectError("başka İE'nin adımı → 404", () => updateStepPlannedMachine(w1.id, s2.id, mA, ADMIN), 404);
  await prisma.workOrderStep.update({ where: { id: s1.id }, data: { status: StepStatus.COMPLETED } });
  await expectError("kapanmış adım → 409 STEP_NOT_OPEN", () => updateStepPlannedMachine(w1.id, s1.id, mA, ADMIN), 409, "STEP_NOT_OPEN");
  check("409 sonrası öneri değişmedi", (await stepMachines(w1.id))[0] === null);

  // ══ §6 replace() korur ════════════════════════════════════════════════════
  console.log("\n§6 replace(): overlay yoksa planlamacının seçimi korunur");
  const s2b = s2.id;
  await updateStepPlannedMachine(w2.id, s2b, mA, ADMIN);
  await svc.replace(w2.id, { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 250, routeTemplateId: routeId } as Parameters<WorkOrderService["replace"]>[1], ADMIN);
  check("replace overlay'siz → öneri korunur", (await stepMachines(w2.id))[0] === mA);
  await svc.replace(w2.id, { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 250, routeTemplateId: routeId, stepPlanning: [{ sequence: 1, plannedMachineId: mB }] } as Parameters<WorkOrderService["replace"]>[1], ADMIN);
  check("replace overlay → ezer", (await stepMachines(w2.id))[0] === mB);

  // ══ §7 Okuma yüzeyleri ════════════════════════════════════════════════════
  console.log("\n§7 Dağıtım + tablet kuyruğu alanları");
  // Satır şekli kaynaktan: dağıtım listesi fixture'sız boş dönebilir (boş = körlük, yeşil sayılmaz).
  const fs = await import("fs");
  const bySrc = fs.readFileSync(require.resolve("../src/services/kursun-bypass.service.ts"), "utf8");
  check("dağıtım satırı plannedMachineName yazar", /plannedMachineName:\s*step\.plannedMachine\?\.name/.test(bySrc));
  void KursunBypassService;
  const qcSrc = fs.readFileSync(require.resolve("../src/services/kursun-qc.service.ts"), "utf8");
  check("tablet kuyruğu plannedMachineName yazar", /plannedMachineName:\s*s\.plannedMachine\?\.name/.test(qcSrc));
  void KursunQcService;
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  })
  .finally(async () => {
    for (const id of createdWo) {
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(() => {});
      await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrder.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdRoutes) {
      await prisma.routeStep.deleteMany({ where: { routeId: id } }).catch(() => {});
      await prisma.route.delete({ where: { id } }).catch(() => {});
    }
    await prisma.machine.deleteMany({ where: { id: { in: createdMachines } } }).catch(() => {});
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
