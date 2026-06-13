// =============================================================================
// Test: Saha cihaz tablosu — MachineHardware CRUD (yazıcı + RS232 desenleri)
// Çalıştır: npx tsx scripts/test_machine_hardware.ts
// Doğrulananlar:
//   1. BaseService.create → makineye donanım config (printer/MAC/pattern)
//   2. machineId unique (1:1) — ikinci kayıt P2002
//   3. update pattern değiştirir (cihaz/kodlama seçimi)
//   4. include ile makine bilgisi gelir
//   5. Machine silinince hardware cascade düşer
// =============================================================================
import prisma from "../src/lib/prisma";
import { BaseService } from "../src/services/base.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const svc = new BaseService({
    modelName: "machineHardware",
    tableName: "MACHINE_HARDWARE",
    searchFields: ["printerMac"],
    defaultInclude: { machine: { select: { id: true, code: true, name: true } } },
    uniqueField: "machineId",
  });

  const station = await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!station) throw new Error("İstasyon yok (npm run seed)");
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-HW-${ts}`, name: "TEST HW MAKİNE" },
    select: { id: true },
  });

  let hwId = "";
  try {
    // 1) create
    const res = await svc.create(
      {
        machineId: machine.id,
        printerIp: "192.168.1.50",
        printerMac: "00:23:09:01:15:01",
        kqMac: "00:23:09:01:1D:17",
        mtMac: "00:23:09:01:1D:17",
        kqPattern: "(\\d+(?:\\.\\d+)?)",
        mtPattern: "y",
      },
      undefined,
    );
    const hw = res.data as { id: string; printerMac: string; machine?: { code: string } };
    hwId = hw.id;
    check("create: donanım config kaydedildi", hw.printerMac === "00:23:09:01:15:01");
    check("include: makine bilgisi geldi", !!hw.machine?.code);

    // 2) machineId unique
    let dup = false;
    try {
      await svc.create({ machineId: machine.id, printerIp: "x" }, undefined);
    } catch (e) {
      const code = (e as { statusCode?: number; code?: string }).statusCode;
      dup = code === 409 || code === 400 || (e as { code?: string }).code === "P2002";
    }
    check("machineId 1:1 (ikinci kayıt reddedildi)", dup);

    // 3) update pattern (cihaz/kodlama seçimi)
    await svc.update(hwId, { kqPattern: "DEĞİŞTİ-(\\d+)", notes: "2. cihaz takıldı" }, undefined);
    const after = await prisma.machineHardware.findUnique({ where: { id: hwId }, select: { kqPattern: true, notes: true } });
    check("update: desen değişti", after?.kqPattern === "DEĞİŞTİ-(\\d+)" && after?.notes === "2. cihaz takıldı");

    // 5) cascade
    await prisma.machine.delete({ where: { id: machine.id } });
    const gone = await prisma.machineHardware.findUnique({ where: { id: hwId } });
    check("Machine silinince hardware cascade düştü", gone === null);
    hwId = ""; // silindi
  } finally {
    if (hwId) await prisma.machineHardware.delete({ where: { id: hwId } }).catch(() => {});
    await prisma.machine.delete({ where: { id: machine.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
