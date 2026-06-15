// Canlı DB'ye yazıcı modeli + etiket format profillerini idempotent ekler ve
// mevcut (printerModel'siz) MachineHardware satırlarını Argox'a bağlar.
// Non-destructive (upsert). Çalıştır: npx tsx scripts/backfill-printer-catalog.ts
import prisma from "../src/lib/prisma";

async function main() {
  const profileData = {
    name: "Argox 100×148 mm Top (3mm pay)",
    widthMm: 100,
    heightMm: 148,
    marginMm: 3,
    gapMm: 2,
    dpi: 203,
    orientation: "PORTRAIT" as const,
  };
  const argoxProfile = await prisma.labelFormatProfile.upsert({
    where: { code: "ARGOX_TOP_100x148" },
    update: {},
    create: { code: "ARGOX_TOP_100x148", ...profileData },
  });
  await prisma.labelFormatProfile.upsert({
    where: { code: "DEFAULT" },
    update: {},
    create: { code: "DEFAULT", ...profileData, name: "Varsayılan Top Etiketi (100×148, 3mm pay)" },
  });
  const argox = await prisma.printerModel.upsert({
    where: { code: "ARGOX_OS214_PLUS" },
    update: { defaultProfileId: argoxProfile.id },
    create: {
      code: "ARGOX_OS214_PLUS",
      name: "Argox OS 214 plus",
      manufacturer: "Argox",
      dpi: 203,
      maxWidthMm: 104,
      language: "PPLA",
      defaultProfileId: argoxProfile.id,
    },
  });
  const bound = await prisma.machineHardware.updateMany({
    where: { printerModelId: null },
    data: { printerModelId: argox.id, formatProfileId: argoxProfile.id },
  });
  console.log(`✅ model=${argox.code} profile=${argoxProfile.code} bağlanan donanım=${bound.count}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
