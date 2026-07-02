// =============================================================================
// Test: PeripheralDeviceService — CRUD + sahiplik guard + şablon route + dil zorunluluğu
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
let stationId = "", machineId = "", deviceId = "", fpInactiveId = "", tplId = "";

async function main() {
  const station = await prisma.station.create({ data: { code: `TEST-ST-${stamp}`, name: "ST", type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  stationId = station.id;
  const machine = await prisma.machine.create({ data: { code: `TEST-MC-${stamp}`, name: "MC", stationId: station.id }, select: { id: true } });
  machineId = machine.id;
  const device = await prisma.device.create({ data: { deviceId: `TEST-DV-${stamp}`, name: "Tablet" }, select: { id: true } });
  deviceId = device.id;
  const fpInactive = await prisma.labelFormatProfile.create({ data: { code: `TEST-FPX-${stamp}`, name: "FPX", widthMm: 100, heightMm: 58, isActive: false }, select: { id: true } });
  fpInactiveId = fpInactive.id;
  const tpl = await prisma.labelTemplate.create({ data: { name: `TEST-TPL-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  tplId = tpl.id;

  // 1. Geçerli oluşturma (yazıcıda dil ZORUNLU — cihazın kendi üstünde)
  const created = await svc.create({
    code: `TEST-PRN-${stamp}`, name: "Ağ Yazıcı", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP",
    address: "192.168.1.50", port: 9100, machineId, languageOverride: PrinterLanguage.PPLA,
  });
  const rec = created.data as { id: string; isActive: boolean };
  createdPeripheralIds.push(rec.id);
  check("create: geçerli cihaz oluştu (aktif)", !!rec.id && rec.isActive === true);

  // 2. Sahiplik guard — makine + tablet ikisi birden
  await expectThrow("create: machineId+deviceId birlikte reddedilir", () =>
    svc.create({ code: `TEST-PRNX-${stamp}`, name: "X", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", machineId, deviceId, languageOverride: PrinterLanguage.PPLA }),
  );

  // 3. Pasif formatProfile reddedilir
  await expectThrow("create: pasif formatProfile reddedilir", () =>
    svc.create({ code: `TEST-PRNY-${stamp}`, name: "Y", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", formatProfileId: fpInactiveId, languageOverride: PrinterLanguage.PPLA }),
  );

  // 4. Geçersiz port reddedilir
  await expectThrow("create: geçersiz port reddedilir", () =>
    svc.create({ code: `TEST-PRNZ-${stamp}`, name: "Z", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", port: 99999, languageOverride: PrinterLanguage.PPLA }),
  );

  // 4b. YENİ kural: yazıcı dilsiz oluşturulamaz; dil sonradan da boşaltılamaz
  await expectThrow("create: LABEL_PRINTER dilsiz reddedilir", () =>
    svc.create({ code: `TEST-PRNQ-${stamp}`, name: "Q", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP" }),
  );
  await expectThrow("update: yazıcıda dil boşaltılamaz", async () => {
    const r = created.data as { id: string };
    await svc.update(r.id, { languageOverride: null });
  });

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

  // 6. Soft delete
  await svc.softDelete(rec.id);
  const afterDelete = await prisma.peripheralDevice.findUnique({ where: { id: rec.id }, select: { isActive: true } });
  check("remove: soft delete (isActive=false)", afterDelete?.isActive === false);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.peripheralDevice.deleteMany({ where: { OR: [{ id: { in: createdPeripheralIds } }, { code: { startsWith: `TEST-PRN-${stamp}` } }, { deviceId }] } });
  if (tplId) await prisma.labelTemplate.deleteMany({ where: { id: tplId } });
  if (fpInactiveId) await prisma.labelFormatProfile.deleteMany({ where: { id: fpInactiveId } });
  if (deviceId) await prisma.device.deleteMany({ where: { id: deviceId } });
  if (machineId) await prisma.machine.deleteMany({ where: { id: machineId } });
  if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
