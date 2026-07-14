// =============================================================================
// Test: Üretim atfı damgalama (Faz 2) — oturum makinesi op/movement/roll'a akar
// Çalıştır: npx tsx scripts/test_work_session_stamping.ts
// Doğrulananlar:
//   1. getStampContext: aktif oturum → machineId; oturum yok → null;
//      enforceForMobile → 409 WORK_SESSION_REQUIRED; req.device'sız (web) → null
//   2. createInitialEntry(machineId) → Roll.createdMachineId damgalanır
//   3. createInitialEntry (machineId'siz, web) → createdMachineId null, işlem BAŞARILI
//   4. tambur.finalizeOpenFabric(machineId) → TAMBUR_PROCESSED.machineId +
//      kapanan movement.machineId damgalanır
//   5. tambur kalıtım kopyaları parent op'un machineId'sini KORUR
//   6. getForSession: makine-oturumu → makine donanımı; istasyon-oturumu →
//      istasyon donanımı; oturum yok → BOŞ liste (fail-closed)
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { PeripheralDeviceService } from "../src/services/peripheral.service";
import { WorkSessionService } from "../src/services/work-session.service";
import { getStampContext } from "../src/services/helpers/work-session.helper";
import { WorkOrderStatus, RollStatus, StationKind } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const inventory = new InventoryService();
const tambur = new TamburService();
const peripherals = new PeripheralDeviceService({
  modelName: "peripheralDevice",
  tableName: "PERIPHERAL_DEVICE",
  searchFields: ["code", "name"],
  uniqueField: "code",
});

async function main() {
  const ts = Date.now();
  const admin = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const grade = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE");
  const color = need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk");
  const tamburStation = need(
    await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true } }),
    "TAMBUR istasyonu",
  );
  const kk1Machine = need(
    await prisma.machine.findFirst({ where: { code: "KK1-M1", isActive: true }, select: { id: true } }),
    "KK1-M1",
  );
  const tamburMachine = need(
    await prisma.machine.findFirst({ where: { code: "TAMBUR-M1", isActive: true }, select: { id: true } }),
    "TAMBUR-M1",
  );
  const sevkStation = need(
    await prisma.station.findFirst({ where: { code: "SEVK_1", isActive: true }, select: { id: true } }),
    "SEVK_1",
  );

  const device = await prisma.device.create({
    data: { deviceId: `test-wss-${ts}`, name: "TEST STAMP Cihaz", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });
  const reqOf = (d: { id: string } | null) => (d ? { device: { id: d.id } } : {});

  const rollIds: string[] = [];
  const woIds: string[] = [];
  const peripheralIds: string[] = [];

  try {
    // ---- 1) getStampContext ----
    check("getStampContext (web, req.device yok) → null", (await getStampContext({})) === null);
    check("getStampContext (oturumsuz cihaz) → null", (await getStampContext(reqOf(device))) === null);
    await expectErr("enforceForMobile → WORK_SESSION_REQUIRED", "aktif çalışma oturumu yok", () =>
      getStampContext({ device: { id: device.id, kind: "TABLET" } }, { enforceForMobile: true }));
    check(
      "DESKTOP (Electron) enforce'tan MUAF → null",
      (await getStampContext({ device: { id: device.id, kind: "DESKTOP" } }, { enforceForMobile: true })) === null,
    );

    await WorkSessionService.open({ userId: admin.id, deviceRowId: device.id, machineId: kk1Machine.id });
    const stamp1 = await getStampContext(reqOf(device));
    check("aktif oturum → stamp.machineId = KK1-M1", stamp1?.machineId === kk1Machine.id);

    // ---- 2-3) createInitialEntry damgası ----
    const entry = await inventory.createInitialEntry(
      { itemId: item.id, initialQty: 80 },
      admin.id,
      stamp1?.machineId ?? null,
    );
    rollIds.push(entry.data.id);
    check("KK1 girişi → Roll.createdMachineId damgalı", entry.data.createdMachineId === kk1Machine.id);

    const webEntry = await inventory.createInitialEntry({ itemId: item.id, initialQty: 50 }, admin.id);
    rollIds.push(webEntry.data.id);
    check("web girişi (oturumsuz) → createdMachineId null + BAŞARILI", webEntry.data.createdMachineId === null);

    // ---- 4-5) tambur finalizeOpenFabric damgası + kalıtım koruması ----
    // Açık kumaş fixture: TAMBUR adımlı WO + barkodsuz IN_PRODUCTION roll + açık movement
    // + parent'ta machineId'li QC2 op'u (kalıtım koruması kanıtı için).
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-WSS-WO-${ts}`,
        type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item.id,
        steps: { create: [{ stationId: tamburStation.id, stepSequence: 1, status: "ACTIVE" as const }] },
      },
      include: { steps: true },
    });
    woIds.push(wo.id);
    const stepId = wo.steps[0].id;
    const openFabric = await prisma.roll.create({
      data: {
        barcode: null, itemId: item.id, colorId: color.id, status: RollStatus.IN_PRODUCTION,
        currentQty: 100, initialQty: 100, width: 150,
        qualityGrade: "1.KALITE", qualityGradeId: grade.id, createdById: admin.id,
        currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN",
      },
      select: { id: true },
    });
    rollIds.push(openFabric.id);
    await prisma.rollMovement.create({
      data: { rollId: openFabric.id, workOrderStepId: stepId, qtyIn: 100, operatorId: admin.id },
    });
    // Parent'ta KK2 makinesinden gelmiş gibi machineId'li QC2 op'u (kalıtım kaynağı).
    const kk2Machine = need(
      await prisma.machine.findFirst({ where: { code: "KK2-M1" }, select: { id: true } }),
      "KK2-M1",
    );
    await prisma.rollOperation.create({
      data: {
        rollId: openFabric.id, workOrderStepId: stepId, operationType: "QC2_COMPLETED",
        operatorId: admin.id, machineId: kk2Machine.id,
      },
    });

    // Kalıtım koruması kanıtı: cutOpenFabric child'ı parent'ın QC2 op'unu kopyalar —
    // machineId (KK2-M1) kopyada korunmalı. (finalizeOpenFabric'in kalan-çocuğu
    // kalıtım kopyalamaz — mevcut davranış; kalıtım yolları: finalize/cutWarehouse/
    // finalizeWarehouseCut/cutOpenFabric.)
    await tambur.cutOpenFabric(openFabric.id, { lengthMeters: 30, status: "WAREHOUSE" }, admin.id);
    const cutChild = need(
      await prisma.roll.findFirst({
        where: { parentRollId: openFabric.id, barcode: { not: null } },
        select: { id: true },
      }),
      "cutOpenFabric child",
    );
    rollIds.push(cutChild.id);
    const inheritedOp = await prisma.rollOperation.findFirst({
      where: { rollId: cutChild.id, operationType: "QC2_COMPLETED", inheritedFromParentRollId: openFabric.id },
      select: { machineId: true },
    });
    check("kalıtım kopyası parent machineId'sini KORUR (KK2-M1)", inheritedOp?.machineId === kk2Machine.id);

    const fin = await tambur.finalizeOpenFabric(
      openFabric.id,
      { remainingAction: "keep_1kalite" },
      admin.id,
      tamburMachine.id, // oturum makinesi (controller'da stamp context'ten gelir)
    );
    const childId = fin.data.remainingChildId;
    if (childId) rollIds.push(childId);

    const tamburOp = await prisma.rollOperation.findFirst({
      where: { rollId: openFabric.id, operationType: "TAMBUR_PROCESSED" },
      select: { machineId: true },
    });
    check("TAMBUR_PROCESSED.machineId damgalı", tamburOp?.machineId === tamburMachine.id);

    const closedMove = await prisma.rollMovement.findFirst({
      where: { rollId: openFabric.id, workOrderStepId: stepId },
      select: { machineId: true, exitedAt: true },
    });
    check("kapanan movement.machineId damgalı", closedMove?.exitedAt !== null && closedMove?.machineId === tamburMachine.id);

    // ---- 6) getForSession üç dal ----
    const scale = await peripherals.create(
      {
        code: `TST-WSS-SCALE-${ts}`, name: "TEST STAMP Kantar", kind: "SCALE",
        connectionType: "BLUETOOTH_SPP", address: "00:AA:BB:CC:DD:EE", stationId: sevkStation.id,
      },
      admin.id,
    );
    peripheralIds.push((scale.data as { id: string }).id);

    // Makine-oturumu (KK1-M1) → makineye sabit donanım (seed: KK1-METRE)
    const meters = await peripherals.getForSession({ machineId: kk1Machine.id, stationId: null }, "METER");
    check(
      "makine-oturumu → makine donanımı (KK1 metre)",
      meters.data.length > 0 && meters.data.every((p) => (p as { machineId: string }).machineId === kk1Machine.id),
      `adet=${meters.data.length}`,
    );
    // İstasyon-oturumu (SEVK_1) → istasyona sabit donanım
    const scales = await peripherals.getForSession({ machineId: null, stationId: sevkStation.id }, "SCALE");
    check(
      "istasyon-oturumu → istasyon donanımı",
      scales.data.some((p) => (p as { id: string }).id === peripheralIds[0]),
      `adet=${scales.data.length}`,
    );
    // Oturum yok → boş (fail-closed)
    const none = await peripherals.getForSession(null, "SCALE");
    check("oturum yok → BOŞ liste (fail-closed)", none.data.length === 0);
    await expectErr("geçersiz kind → 400", "Geçersiz cihaz türü", () =>
      peripherals.getForSession(null, "BANANA"));
  } finally {
    await prisma.workSession.deleteMany({ where: { deviceId: device.id } }).catch(() => {});
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: peripheralIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { parentRollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: device.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
