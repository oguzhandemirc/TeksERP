// =============================================================================
// Test: birleşik etiket yönlendirme çözücü (resolveLabelRouting)
// Çalıştır: npx tsx scripts/test_label_routing_resolver.ts
// Öncelik matrisi: dil (override; yoksa RASTER_HTML), şablon (explicit>route>default),
// format (cihaz MEDYASI > sistem-default), cihaz seçimi (explicit>device>machine).
// Etiket Stüdyosu v2: medya CİHAZDA (labelWidthMm/heightMm); "Boyutlar"
// (LabelFormatProfile) kataloğu EMEKLİ, profileId artık yok.
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
const ids: { peripherals: string[]; templates: string[]; devices: string[]; machines: string[]; stations: string[] } =
  { peripherals: [], templates: [], devices: [], machines: [], stations: [] };

async function main() {
  // --- Fixtures ---
  const tplRoute = await prisma.labelTemplate.create({ data: { name: `TEST-ROUTE-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  const tplExplicit = await prisma.labelTemplate.create({ data: { name: `TEST-EXPL-${stamp}`, kind: LabelKind.ROLL_FINISHED, isDefault: false, fields: [] }, select: { id: true } });
  ids.templates.push(tplRoute.id, tplExplicit.id);

  const station = await prisma.station.create({ data: { code: `TEST-ST-${stamp}`, name: "ST", type: "INTERNAL", kind: "TAMBUR" }, select: { id: true } });
  ids.stations.push(station.id);
  const machine = await prisma.machine.create({ data: { code: `TEST-MC-${stamp}`, name: "MC", stationId: station.id }, select: { id: true } });
  ids.machines.push(machine.id);
  const device = await prisma.device.create({ data: { deviceId: `TEST-DV-${stamp}`, name: "Tablet" }, select: { id: true } });
  ids.devices.push(device.id);

  // Tablete-bağlı BT yazıcı + kendi MEDYASI (100×148) + ROLL_FINISHED route + dil override ZPL
  const peripheral = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-PRN-${stamp}`, name: "BT Yazıcı", kind: "LABEL_PRINTER", connectionType: ConnectionType.BLUETOOTH_SPP,
      address: "AA:BB:CC", deviceId: device.id, languageOverride: PrinterLanguage.ZPL,
      labelWidthMm: 100, labelHeightMm: 148, labelDpi: 203, labelGapMm: 2,
    },
    select: { id: true },
  });
  ids.peripherals.push(peripheral.id);
  await prisma.peripheralTemplateRoute.create({ data: { peripheralId: peripheral.id, kind: LabelKind.ROLL_FINISHED, templateId: tplRoute.id } });

  // --- 1. device → cihaz seçilir; dil override; route şablonu; cihaz medyası ---
  const r1 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id });
  check("device → cihaz seçildi", r1.peripheralId === peripheral.id);
  check("dil = languageOverride (ZPL)", r1.language === "ZPL", r1.language);
  check("şablon = route şablonu", r1.template?.id === tplRoute.id);
  check("format = cihaz medyası (100×148)", r1.format.widthMm === 100 && r1.format.heightMm === 148);

  // --- 2. languageOverride kaldır → dil RASTER_HTML (global ayar kaldırıldı; fail-closed) ---
  await prisma.peripheralDevice.update({ where: { id: peripheral.id }, data: { languageOverride: null } });
  const r2 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id });
  check("override yok → dil = RASTER_HTML (fail-closed)", r2.language === "RASTER_HTML", r2.language);

  // --- 3. explicit templateId route'u ezer ---
  const r3 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, deviceId: device.id, templateId: tplExplicit.id });
  check("explicit templateId > route", r3.template?.id === tplExplicit.id);

  // --- 4. explicit peripheralId → o cihazın medyası kullanılır ---
  const r4 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, peripheralId: peripheral.id });
  check("explicit peripheralId → cihaz seçildi + medyası", r4.peripheralId === peripheral.id && r4.format.widthMm === 100);

  // --- 5. cihaz yok → route uygulanmaz (geri uyum: sistem-default/null) ---
  const r5 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED });
  check("cihaz yok → peripheralId null", r5.peripheralId === null);
  check("cihaz yok → route şablonu UYGULANMAZ", r5.template?.id !== tplRoute.id);
  check("cihaz yok → format sistem-default (geçerli geometri)", r5.format.widthMm > 0);

  // --- 6. makineye-bağlı cihaz (machineId yolu) + kendi medyası (100×60 LANDSCAPE) ---
  const p2 = await prisma.peripheralDevice.create({
    data: { code: `TEST-PRN2-${stamp}`, name: "Ağ Yazıcı", kind: "LABEL_PRINTER", connectionType: ConnectionType.NETWORK_TCP, address: "192.168.1.50", machineId: machine.id, languageOverride: PrinterLanguage.PPLA, labelWidthMm: 100, labelHeightMm: 60, labelDpi: 203 },
    select: { id: true },
  });
  ids.peripherals.push(p2.id);
  const r6 = await resolveLabelRouting({ kind: LabelKind.ROLL_FINISHED, machineId: machine.id });
  check("machineId → makineye-bağlı cihaz seçildi", r6.peripheralId === p2.id);
  check("machineId → cihaz medyası (100×60 LANDSCAPE)", r6.format.widthMm === 100 && r6.format.heightMm === 60 && r6.format.orientation === "LANDSCAPE");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: ids.peripherals } } }); // route'lar cascade
  await prisma.labelTemplate.deleteMany({ where: { id: { in: ids.templates } } });
  await prisma.device.deleteMany({ where: { id: { in: ids.devices } } });
  await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
