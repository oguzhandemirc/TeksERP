// Mevcut MachineHardware (printerIp'li) satırlarını birleşik cihaz kaydına
// (PeripheralDevice, NETWORK_TCP) idempotent taşır. Non-destructive (code'a göre
// atlar). Çalıştır: npx tsx scripts/backfill-peripheral-from-hardware.ts
import prisma from "../src/lib/prisma";

async function main() {
  const hws = await prisma.machineHardware.findMany({
    where: { isActive: true, printerIp: { not: null } },
    select: {
      machineId: true,
      printerIp: true,
      printerModelId: true,
      formatProfileId: true,
      machine: { select: { code: true, name: true } },
    },
  });

  let created = 0;
  let skipped = 0;
  for (const hw of hws) {
    const code = `MH-${hw.machine?.code ?? hw.machineId.slice(0, 8)}`;
    const exists = await prisma.peripheralDevice.findUnique({ where: { code }, select: { id: true } });
    if (exists) {
      skipped++;
      continue;
    }
    await prisma.peripheralDevice.create({
      data: {
        code,
        name: `${hw.machine?.name ?? "Makine"} Yazıcı`,
        kind: "LABEL_PRINTER",
        connectionType: "NETWORK_TCP",
        address: hw.printerIp,
        port: 9100,
        machineId: hw.machineId,
        printerModelId: hw.printerModelId,
        formatProfileId: hw.formatProfileId,
      },
    });
    created++;
  }

  console.log(`✅ Backfill: ${created} cihaz oluşturuldu, ${skipped} zaten vardı (toplam ${hws.length} printerIp'li donanım).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
