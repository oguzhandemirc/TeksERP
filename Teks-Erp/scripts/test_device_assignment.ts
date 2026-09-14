// =============================================================================
// Test: Cihaz allowlist + atama (DeviceService) — announce/approve/revoke/resolve
// Çalıştır: npx tsx scripts/test_device_assignment.ts
// ⚠️ Bu dosya ONAY AKIŞINI ölçer, yani `devicePairingRequired = true` rejimini —
// bayrağı AÇIKÇA kurar (2026-09-04). Eskiden bayrağı hiç yazmıyordu ve doğru
// sonucu ortamın varsayılanından alıyordu; bayrak kapalıyken yeni cihaz artık
// APPROVED doğduğu için o örtük varsayım kırıldı. Kapalı rejimin bekçisi ayrı
// dosyada: `test_device_pairing_flag.ts`.
//
// Doğrulananlar:
//   1. announce → PENDING (bilinmeyen cihaz kaydı açılır — bayrak AÇIK)
//   2. PENDING iken resolveDevice null (atıf yok)
//   3. pasif makineye atama reddedilir
//   4. approveAndAssign → APPROVED + machineId; getStatus yansıtır
//   5. APPROVED → resolveDevice machineId döner (atıf damgalanır)
//   6. revoke → PENDING + machineId null → resolveDevice null
//   7. pasif cihaz → resolveDevice null
//   8. announce idempotent (ikinci kez yeni satır yaratmaz)
// =============================================================================
import prisma from "../src/lib/prisma";
import { DeviceService } from "../src/services/device.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0, fail = 0;
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
    data: { stationId: station.id, code: `TST-DEV-${ts}`, name: "TEST DEV MAKİNE" }, select: { id: true },
  });
  const passiveMachine = await prisma.machine.create({
    data: { stationId: station.id, code: `TST-DEVP-${ts}`, name: "TEST DEV PASİF", isActive: false }, select: { id: true },
  });
  const deviceLocalId = `test-device-${ts}`;
  let deviceRowId = "";

  // Onay akışı = eşleştirme ZORUNLU rejimi. Bayrağı açıkça kur, sonunda geri koy.
  const originalFlag = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
    select: { value: true, description: true },
  });

  try {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
      create: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED, value: true, description: "TEST" },
      update: { value: true },
    });
    // 1) announce → PENDING
    const a = await DeviceService.announce({ deviceId: deviceLocalId, name: "TEST Tablet" });
    check("announce → PENDING", a.status === "PENDING");
    const row = await prisma.device.findUnique({ where: { deviceId: deviceLocalId }, select: { id: true } });
    deviceRowId = row?.id ?? "";

    // 2) PENDING iken resolveDevice null
    check("PENDING → resolveDevice null (atıf yok)", (await DeviceService.resolveDevice(deviceLocalId)) === null);

    // 3) pasif makineye atama reddedilir
    await expectErr("pasif makineye atama reddedilir", "pasif", () =>
      DeviceService.approveAndAssign(deviceRowId, { machineId: passiveMachine.id }));

    // 4) approveAndAssign → APPROVED + machineId
    await DeviceService.approveAndAssign(deviceRowId, { machineId: machine.id });
    const st = await DeviceService.getStatus(deviceLocalId);
    check("approve → APPROVED + makine", st.status === "APPROVED" && st.machineId === machine.id);

    // 5) APPROVED → resolveDevice machineId
    const r1 = await DeviceService.resolveDevice(deviceLocalId);
    check("APPROVED → resolveDevice machineId", r1?.machineId === machine.id);

    // 6) revoke → PENDING + machineId null
    await DeviceService.revoke(deviceRowId);
    check("revoke → resolveDevice null", (await DeviceService.resolveDevice(deviceLocalId)) === null);
    const after = await prisma.device.findUnique({ where: { id: deviceRowId }, select: { machineId: true, status: true } });
    check("revoke → machineId null + PENDING", after?.machineId === null && after?.status === "PENDING");

    // 7) tekrar approve + deactivate → resolveDevice null
    await DeviceService.approveAndAssign(deviceRowId, { machineId: machine.id });
    await DeviceService.deactivate(deviceRowId);
    check("pasif cihaz → resolveDevice null", (await DeviceService.resolveDevice(deviceLocalId)) === null);

    // 8) announce idempotent (tek satır)
    await DeviceService.reactivate(deviceRowId);
    await DeviceService.announce({ deviceId: deviceLocalId });
    const cnt = await prisma.device.count({ where: { deviceId: deviceLocalId } });
    check("announce idempotent (tek satır)", cnt === 1, `device=${cnt}`);
  } finally {
    await prisma.device.deleteMany({ where: { deviceId: { startsWith: `test-device-${ts}` } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: [machine.id, passiveMachine.id] } } }).catch(() => {});
    if (originalFlag) {
      await prisma.systemSetting
        .update({
          where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED },
          data: { value: originalFlag.value ?? false, description: originalFlag.description },
        })
        .catch(() => {});
    } else {
      await prisma.systemSetting
        .delete({ where: { key: SETTING_KEYS.DEVICE_PAIRING_REQUIRED } })
        .catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
