// =============================================================================
// Test: Cihaz eşleştirme (DeviceService) — pairing kod + eşle + unpair
// Çalıştır: npx tsx scripts/test_device_pairing.ts
// Doğrulananlar:
//   1. createPairingCode 6 haneli kod üretir
//   2. pair → Device oluşur + kod kullanıldı işaretlenir
//   3. Aynı kod ikinci kez → "zaten kullanılmış"
//   4. Geçersiz kod → reddedilir
//   5. unpair → machineId null
//   6. Pasif makineye kod → reddedilir
// =============================================================================
import prisma from "../src/lib/prisma";
import { DeviceService } from "../src/services/device.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

async function main() {
  const ts = Date.now();
  const station = await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!station) throw new Error("İstasyon yok (npm run seed)");
  const machine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-DEV-${ts}`, name: "TEST DEV MAKİNE" },
    select: { id: true },
  });
  const passiveMachine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-DEVP-${ts}`, name: "TEST DEV PASİF", isActive: false },
    select: { id: true },
  });
  const deviceLocalId = `test-device-${ts}`;
  const codes: string[] = [];
  let deviceId = "";

  try {
    // 1) createPairingCode
    const pc = await DeviceService.createPairingCode({ machineId: machine.id, deviceName: "TEST Tablet" });
    codes.push(pc.code);
    check("createPairingCode 6 haneli kod", /^\d{6}$/.test(pc.code), pc.code);

    // 6) pasif makineye kod
    await expectErr("Pasif makineye kod reddedilir", "pasif", () =>
      DeviceService.createPairingCode({ machineId: passiveMachine.id, deviceName: "x" }),
    );

    // 2) pair
    const paired = await DeviceService.pair({ deviceId: deviceLocalId, code: pc.code });
    const pr = paired as { device: { id: string }; machine: { id: string } };
    deviceId = pr.device.id;
    check("pair → Device oluştu + makineye bağlandı", pr.machine.id === machine.id);
    const usedCode = await prisma.pairingCode.findUnique({ where: { code: pc.code }, select: { usedAt: true } });
    check("pairing kod kullanıldı işaretlendi", usedCode?.usedAt !== null);

    // 3) aynı kod ikinci kez
    await expectErr("Kullanılmış kod ikinci kez reddedilir", "kullanılmış", () =>
      DeviceService.pair({ deviceId: `${deviceLocalId}-2`, code: pc.code }),
    );

    // 4) geçersiz kod
    await expectErr("Geçersiz kod reddedilir", "geçersiz", () =>
      DeviceService.pair({ deviceId: deviceLocalId, code: "000000" }),
    );

    // 5) unpair
    await DeviceService.unpair(deviceId);
    const after = await prisma.device.findUnique({ where: { id: deviceId }, select: { machineId: true } });
    check("unpair → machineId null", after?.machineId === null);
  } finally {
    if (deviceId) await prisma.device.delete({ where: { id: deviceId } }).catch(() => {});
    await prisma.pairingCode.deleteMany({ where: { machineId: { in: [machine.id, passiveMachine.id] } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { deviceId: { startsWith: `test-device-${ts}` } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: [machine.id, passiveMachine.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
