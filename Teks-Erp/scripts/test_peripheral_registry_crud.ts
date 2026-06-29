// =============================================================================
// Test: PeripheralDeviceService — CRUD + sahiplik guard + şablon route + BT kayıt
// Çalıştır: npx tsx scripts/test_peripheral_registry_crud.ts
// Test verisi üretir, sonunda temizler.
// =============================================================================
import { LabelKind, PrinterLanguage } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { PeripheralDeviceService } from "../src/services/peripheral.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu, atılmadı"); }
  catch { check(label, true); }
}

const svc = new PeripheralDeviceService({
  modelName: "peripheralDevice", tableName: "PERIPHERAL_DEVICE", searchFields: ["code"], uniqueField: "code",
});
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const createdPeripheralIds: string[] = [];
let stationId = "", machineId = "", deviceId = "", pmId = "", pmInactiveId = "", tplId = "";

async function main() {
  const station = await prisma.station.create({ data: { code: `TEST-ST-${stamp}`, name: "ST", type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  stationId = station.id;
  const machine = await prisma.machine.create({ data: { code: `TEST-MC-${stamp}`, name: "MC", stationId: station.id }, select: { id: true } });
  machineId = machine.id;
  const device = await prisma.device.create({ data: { deviceId: `TEST-DV-${stamp}`, name: "Tablet" }, select: { id: true } });
  deviceId = device.id;
  const pm = await prisma.printerModel.create({ data: { code: `TEST-PM-${stamp}`, name: "PM", language: PrinterLanguage.PPLA }, select: { id: true } });
  pmId = pm.id;
  const pmInactive = await prisma.printerModel.create({ data: { code: `TEST-PMX-${stamp}`, name: "PMX", isActive: false }, select: { id: true } });
  pmInactiveId = pmInactive.id;
  const tpl = await prisma.labelTemplate.create({ data: { name: `TEST-TPL-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  tplId = tpl.id;

  // 1. Geçerli oluşturma
  const created = await svc.create({
    code: `TEST-PRN-${stamp}`, name: "Ağ Yazıcı", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP",
    address: "192.168.1.50", port: 9100, machineId, printerModelId: pmId,
  });
  const rec = created.data as { id: string; isActive: boolean };
  createdPeripheralIds.push(rec.id);
  check("create: geçerli cihaz oluştu (aktif)", !!rec.id && rec.isActive === true);

  // 2. Sahiplik guard — makine + tablet ikisi birden
  await expectThrow("create: machineId+deviceId birlikte reddedilir", () =>
    svc.create({ code: `TEST-PRNX-${stamp}`, name: "X", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", machineId, deviceId }),
  );

  // 3. Pasif printerModel reddedilir
  await expectThrow("create: pasif printerModel reddedilir", () =>
    svc.create({ code: `TEST-PRNY-${stamp}`, name: "Y", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", printerModelId: pmInactiveId }),
  );

  // 4. Geçersiz port reddedilir
  await expectThrow("create: geçersiz port reddedilir", () =>
    svc.create({ code: `TEST-PRNZ-${stamp}`, name: "Z", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", port: 99999 }),
  );

  // 5. setTemplateRoute create + upsert + remove
  await svc.setTemplateRoute(rec.id, LabelKind.ROLL_FINISHED, tplId);
  let routeCount = await prisma.peripheralTemplateRoute.count({ where: { peripheralId: rec.id, kind: LabelKind.ROLL_FINISHED } });
  check("setTemplateRoute: route oluştu", routeCount === 1);
  await svc.setTemplateRoute(rec.id, LabelKind.ROLL_FINISHED, tplId); // upsert (aynı kind)
  routeCount = await prisma.peripheralTemplateRoute.count({ where: { peripheralId: rec.id, kind: LabelKind.ROLL_FINISHED } });
  check("setTemplateRoute: upsert tekil (kind başına 1)", routeCount === 1);
  await svc.setTemplateRoute(rec.id, LabelKind.ROLL_FINISHED, null); // remove
  routeCount = await prisma.peripheralTemplateRoute.count({ where: { peripheralId: rec.id, kind: LabelKind.ROLL_FINISHED } });
  check("setTemplateRoute: null → kaldırıldı", routeCount === 0);

  // 6. registerBt idempotent (deviceId+address)
  const bt1 = await svc.registerBt({ deviceId, address: "11:22:33:44", name: "Argox BT" });
  const bt1rec = bt1.data as { id: string };
  const bt2 = await svc.registerBt({ deviceId, address: "11:22:33:44", name: "Argox BT (yeniden)" });
  const bt2rec = bt2.data as { id: string };
  createdPeripheralIds.push(bt1rec.id);
  const btCount = await prisma.peripheralDevice.count({ where: { deviceId, address: "11:22:33:44" } });
  check("registerBt: idempotent (aynı id)", bt1rec.id === bt2rec.id);
  check("registerBt: tek kayıt (count=1)", btCount === 1);

  // 7. Soft delete
  await svc.softDelete(rec.id);
  const afterDelete = await prisma.peripheralDevice.findUnique({ where: { id: rec.id }, select: { isActive: true } });
  check("remove: soft delete (isActive=false)", afterDelete?.isActive === false);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.peripheralDevice.deleteMany({ where: { OR: [{ id: { in: createdPeripheralIds } }, { code: { startsWith: `TEST-PRN-${stamp}` } }, { deviceId }] } });
  if (tplId) await prisma.labelTemplate.deleteMany({ where: { id: tplId } });
  if (pmId || pmInactiveId) await prisma.printerModel.deleteMany({ where: { id: { in: [pmId, pmInactiveId].filter(Boolean) } } });
  if (deviceId) await prisma.device.deleteMany({ where: { id: deviceId } });
  if (machineId) await prisma.machine.deleteMany({ where: { id: machineId } });
  if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
