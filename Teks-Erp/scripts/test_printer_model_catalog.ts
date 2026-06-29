// =============================================================================
// Test: yazıcı modeli kataloğu + format profili ilişkileri + FK Restrict guard
// Çalıştır: npx tsx scripts/test_printer_model_catalog.ts
// Doğrulananlar: model↔defaultProfile, PeripheralDevice↔model/profile include;
// kullanılan profil/model fiziksel silinemez (onDelete Restrict); soft-delete.
// =============================================================================
import prisma from "../src/lib/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const station = await prisma.station.create({
    data: { code: `TST-CAT-ST-${ts}`, name: "CAT İST", type: "INTERNAL" }, select: { id: true },
  });
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-CAT-M-${ts}`, name: "CAT MAK" }, select: { id: true },
  });
  const profile = await prisma.labelFormatProfile.create({
    data: { code: `CAT-PRF-${ts}`, name: "CAT Profil", widthMm: 100, heightMm: 148, marginMm: 3, dpi: 203, orientation: "PORTRAIT" },
  });
  const model = await prisma.printerModel.create({
    data: { code: `CAT-MOD-${ts}`, name: "CAT Argox", manufacturer: "Argox", language: "PPLA", dpi: 203, maxWidthMm: 104, defaultProfileId: profile.id },
  });
  const printer = await prisma.peripheralDevice.create({
    data: {
      code: `CAT-PRN-${ts}`, name: "CAT Yazıcı", kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP",
      machineId: machine.id, printerModelId: model.id, formatProfileId: profile.id,
    }, select: { id: true },
  });

  try {
    // 1) model → defaultProfile ilişkisi
    const m = await prisma.printerModel.findUnique({ where: { id: model.id }, include: { defaultProfile: true } });
    check("model.defaultProfile çözülür", m?.defaultProfile?.id === profile.id);
    check("model.language=PPLA, dpi=203, maxWidth=104", m?.language === "PPLA" && m?.dpi === 203 && m?.maxWidthMm === 104);
    check("profil Decimal alanları (width=100, margin=3)", Number(m?.defaultProfile?.widthMm) === 100 && Number(m?.defaultProfile?.marginMm) === 3);

    // 2) PeripheralDevice → model + profile include
    const hwRow = await prisma.peripheralDevice.findUnique({ where: { id: printer.id }, include: { printerModel: true, formatProfile: true } });
    check("cihaz.printerModel çözülür", hwRow?.printerModel?.id === model.id);
    check("cihaz.formatProfile çözülür", hwRow?.formatProfile?.id === profile.id);

    // 3) FK Restrict — kullanılan profil fiziksel silinemez
    let profileBlocked = false;
    try { await prisma.labelFormatProfile.delete({ where: { id: profile.id } }); }
    catch { profileBlocked = true; }
    check("kullanılan profil silinemez (Restrict)", profileBlocked);

    // 4) FK Restrict — kullanılan model fiziksel silinemez
    let modelBlocked = false;
    try { await prisma.printerModel.delete({ where: { id: model.id } }); }
    catch { modelBlocked = true; }
    check("kullanılan model silinemez (Restrict)", modelBlocked);

    // 5) soft-delete (isActive=false) — kayıt durur, sorgulanır
    await prisma.printerModel.update({ where: { id: model.id }, data: { isActive: false } });
    const soft = await prisma.printerModel.findUnique({ where: { id: model.id } });
    check("soft-delete: isActive=false, kayıt durur", soft?.isActive === false);
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: printer.id } });
    await prisma.printerModel.deleteMany({ where: { id: model.id } });
    await prisma.labelFormatProfile.deleteMany({ where: { id: profile.id } });
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
