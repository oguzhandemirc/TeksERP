// =============================================================================
// Test: etiket format çözümü (resolveLabelFormat) öncelik zinciri
// Çalıştır: npx tsx scripts/test_label_format_resolver.ts
// Doğrulananlar: explicit profileId > machineId (makine-yazıcı PeripheralDevice.formatProfile)
// > sistem-default > kod-fallback; dil bu katmanda HEP global ayardan; inactive atlanır.
// =============================================================================
import prisma from "../src/lib/prisma";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { readPrinterLanguage } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const station = await prisma.station.create({
    data: { code: `TST-RES-ST-${ts}`, name: "TEST RES İST", type: "INTERNAL" },
    select: { id: true },
  });
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-RES-M-${ts}`, name: "TEST RES MAK" },
    select: { id: true },
  });
  const p1 = await prisma.labelFormatProfile.create({
    data: { code: `RES-P1-${ts}`, name: "P1", widthMm: 110, heightMm: 160, marginMm: 5, dpi: 203, orientation: "PORTRAIT" },
  });
  const p2 = await prisma.labelFormatProfile.create({
    data: { code: `RES-P2-${ts}`, name: "P2", widthMm: 90, heightMm: 120, marginMm: 2, dpi: 300, orientation: "PORTRAIT" },
  });
  const pInactive = await prisma.labelFormatProfile.create({
    data: { code: `RES-PX-${ts}`, name: "PX", widthMm: 200, heightMm: 200, marginMm: 9, dpi: 203, orientation: "PORTRAIT", isActive: false },
  });
  // Makineye-bağlı yazıcı (MachineHardware emekli → PeripheralDevice tek kaynak).
  const printer = await prisma.peripheralDevice.create({
    data: {
      code: `RES-PRN-${ts}`, name: "TEST RES YAZICI", kind: "LABEL_PRINTER",
      connectionType: "NETWORK_TCP", machineId: machine.id,
      languageOverride: "PPLA", formatProfileId: p1.id, address: "10.0.0.9",
    },
    select: { id: true },
  });

  try {
    // 1) explicit profileId → P1
    const r1 = await resolveLabelFormat({ profileId: p1.id });
    check("explicit profileId → P1 geometri", r1.widthMm === 110 && r1.marginMm === 5 && r1.source === "explicit");

    // 2) machineId → cihazın formatProfile'ı (P1); dil bu katmanda GLOBAL ayardan
    const globalLang = await readPrinterLanguage();
    const r2 = await resolveLabelFormat({ machineId: machine.id });
    check("machineId → cihaz formatProfile P1", r2.widthMm === 110 && r2.source === "machine");
    check("machineId → dil GLOBAL ayardan", r2.language === globalLang, `${r2.language} == ${globalLang}`);

    // 3) cihaz formatProfile null → (model basamağı YOK) sistem-default'a düşer
    await prisma.peripheralDevice.update({ where: { id: printer.id }, data: { formatProfileId: null } });
    const r3 = await resolveLabelFormat({ machineId: machine.id });
    check("cihaz profili yok → sistem-default'a düşer", r3.source === "system-default" && r3.profileId !== p1.id, r3.source);

    // 4) explicit inactive profil → ATLANIR → sistem-default'a düşer
    const r4 = await resolveLabelFormat({ profileId: pInactive.id });
    check("inactive profil atlandı (explicit değil)", r4.source !== "explicit" && r4.profileId !== pInactive.id);

    // 5) opts yok → sistem default (DEFAULT profili backfill/seed'den) veya kod-fallback
    const r5 = await resolveLabelFormat();
    check("opts yok → system-default/code-fallback", r5.source === "system-default" || r5.source === "code-fallback");
    check("opts yok → geçerli geometri (width>0, pay≥0)", r5.widthMm > 0 && r5.marginMm >= 0);
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: printer.id } });
    await prisma.labelFormatProfile.deleteMany({ where: { id: { in: [p1.id, p2.id, pInactive.id] } } });
    await prisma.machine.deleteMany({ where: { id: machine.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
