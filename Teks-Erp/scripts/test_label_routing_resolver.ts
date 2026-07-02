// =============================================================================
// Test: birleşik etiket yönlendirme çözücü (resolveLabelRouting)
// Çalıştır: npx tsx scripts/test_label_routing_resolver.ts
// Öncelik matrisi: dil (override; yoksa RASTER_HTML), şablon (explicit>route>default),
// format (explicit>cihaz profili>zincir), cihaz seçimi (explicit>device>machine).
// Test verisi üretir, sonunda temizler.
// =============================================================================
import { ConnectionType, LabelKind, PrinterLanguage } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolveLabelRouting } from "../src/services/helpers/label-routing.resolver";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ids: { peripherals: string[]; templates: string[]; profiles: string[]; devices: string[]; machines: string[]; stations: string[] } =
  { peripherals: [], templates: [], profiles: [], devices: [], machines: [], stations: [] };

async function main() {
  // --- Fixtures ---
  const fp = await prisma.labelFormatProfile.create({ data: { code: `TEST-FP-${stamp}`, name: "FP", widthMm: 100, heightMm: 148 }, select: { id: true } });
  const fp2 = await prisma.labelFormatProfile.create({ data: { code: `TEST-FP2-${stamp}`, name: "FP2", widthMm: 100, heightMm: 60, orientation: "LANDSCAPE" }, select: { id: true } });
  ids.profiles.push(fp.id, fp2.id);
  const tplRoute = await prisma.labelTemplate.create({ data: { name: `TEST-ROUTE-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  const tplExplicit = await prisma.labelTemplate.create({ data: { name: `TEST-EXPL-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  ids.templates.push(tplRoute.id, tplExplicit.id);

  const station = await prisma.station.create({ data: { code: `TEST-ST-${stamp}`, name: "ST", type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  ids.stations.push(station.id);
  const machine = await prisma.machine.create({ data: { code: `TEST-MC-${stamp}`, name: "MC", stationId: station.id }, select: { id: true } });
  ids.machines.push(machine.id);
  const device = await prisma.device.create({ data: { deviceId: `TEST-DV-${stamp}`, name: "Tablet" }, select: { id: true } });
  ids.devices.push(device.id);

  // Tablete-bağlı BT yazıcı + ROLL_FINISHED route + dil override ZPL
  const peripheral = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-PRN-${stamp}`, name: "BT Yazıcı", kind: "LABEL_PRINTER", connectionType: ConnectionType.BLUETOOTH_SPP,
      address: "AA:BB:CC", deviceId: device.id, formatProfileId: fp.id, languageOverride: PrinterLanguage.ZPL,
    },
    select: { id: true },
  });
  ids.peripherals.push(peripheral.id);
  await prisma.peripheralTemplateRoute.create({ data: { peripheralId: peripheral.id, kind: LabelKind.ROLL_FINISHED, templateId: tplRoute.id } });

  // --- 1. device → cihaz seçilir; dil override; route şablonu; cihaz profili ---
  const r1 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id });
  check("device → cihaz seçildi", r1.peripheralId === peripheral.id);
  check("dil = languageOverride (ZPL)", r1.language === "ZPL", r1.language);
  check("şablon = route şablonu", r1.template?.id === tplRoute.id);
  check("format = cihaz profili (FP)", r1.format.profileId === fp.id);

  // --- 2. languageOverride kaldır → dil RASTER_HTML (global ayar kaldırıldı; fail-closed) ---
  await prisma.peripheralDevice.update({ where: { id: peripheral.id }, data: { languageOverride: null } });
  const r2 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id });
  check("override yok → dil = RASTER_HTML (fail-closed)", r2.language === "RASTER_HTML", r2.language);

  // --- 3. explicit templateId route'u ezer ---
  const r3 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id, templateId: tplExplicit.id });
  check("explicit templateId > route", r3.template?.id === tplExplicit.id);

  // --- 4. explicit profileId cihaz profilini ezer ---
  const r4 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id, profileId: fp2.id });
  check("explicit profileId > cihaz profili (FP2)", r4.format.profileId === fp2.id);

  // --- 5. cihaz yok → route uygulanmaz (geri uyum: global default/null) ---
  const r5 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED });
  check("cihaz yok → peripheralId null", r5.peripheralId === null);
  check("cihaz yok → route şablonu UYGULANMAZ", r5.template?.id !== tplRoute.id);

  // --- 6. makineye-bağlı cihaz (machineId yolu) ---
  const p2 = await prisma.peripheralDevice.create({
    data: { code: `TEST-PRN2-${stamp}`, name: "Ağ Yazıcı", kind: "LABEL_PRINTER", connectionType: ConnectionType.NETWORK_TCP, address: "192.168.1.50", machineId: machine.id, languageOverride: PrinterLanguage.PPLA },
    select: { id: true },
  });
  ids.peripherals.push(p2.id);
  const r6 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, machineId: machine.id });
  check("machineId → makineye-bağlı cihaz seçildi", r6.peripheralId === p2.id);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: ids.peripherals } } }); // route'lar cascade
  await prisma.labelTemplate.deleteMany({ where: { id: { in: ids.templates } } });
  await prisma.labelFormatProfile.deleteMany({ where: { id: { in: ids.profiles } } });
  await prisma.device.deleteMany({ where: { id: { in: ids.devices } } });
  await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
