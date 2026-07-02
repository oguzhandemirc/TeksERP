// =============================================================================
// Test: PeripheralDevice istasyon sahipliği (stationId) — validateRefs kuralları
// Çalıştır: npx tsx scripts/test_peripheral_station_owner.ts
// Doğrulananlar:
//   1. makinesiz istasyona (SHIPPING) donanım bağlanır
//   2. makinesi olan istasyona doğrudan bağlama reddedilir
//   3. machineId + stationId birlikte reddedilir (tam-biri)
//   4. deviceId + stationId birlikte reddedilir (tam-biri)
//   5. update ile mevcut makine-sahipli kayda stationId eklemek (makineyi
//      temizlemeden) reddedilir — birleşik sahiplik kontrolü
//   6. update'te sahiplik değişimi (machineId null + stationId) kabul edilir
// =============================================================================
import prisma from "../src/lib/prisma";
import { PeripheralDeviceService } from "../src/services/peripheral.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

const service = new PeripheralDeviceService({
  modelName: "peripheralDevice",
  tableName: "PERIPHERAL_DEVICE",
  searchFields: ["code", "name", "address"],
  uniqueField: "code",
});

async function main() {
  const ts = Date.now();
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!user) throw new Error("admin kullanıcısı yok (npm run seed)");
  const sevk = await prisma.station.findFirst({ where: { code: "SEVK_1", isActive: true }, select: { id: true } });
  const tamburMachine = await prisma.machine.findFirst({
    where: { code: "TAMBUR-M1", isActive: true },
    select: { id: true, stationId: true },
  });
  const device = await prisma.device.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!sevk || !tamburMachine) throw new Error("Seed master-data eksik (SEVK_1 / TAMBUR-M1)");

  const madeIds: string[] = [];
  const mk = (over: Record<string, unknown>) => ({
    code: `TST-PSO-${ts}-${madeIds.length}`,
    name: "TEST İstasyon Sahiplik",
    kind: "SCALE",
    connectionType: "BLUETOOTH_SPP",
    address: "00:11:22:33:44:55",
    ...over,
  });

  try {
    // 1) makinesiz istasyona bağlanır
    const ok1 = await service.create(mk({ stationId: sevk.id }), user.id);
    const ok1id = (ok1.data as { id: string }).id;
    madeIds.push(ok1id);
    check("makinesiz istasyona donanım bağlanır", !!ok1id);

    // 2) makinesi olan istasyona bağlama reddedilir
    await expectErr("makineli istasyona bağlama reddi", "makineye bağlayın", () =>
      service.create(mk({ stationId: tamburMachine.stationId }), user.id));

    // 3) machineId + stationId birlikte reddedilir
    await expectErr("machineId+stationId reddi", "yalnız biri", () =>
      service.create(mk({ stationId: sevk.id, machineId: tamburMachine.id }), user.id));

    // 4) deviceId + stationId birlikte reddedilir
    if (device) {
      await expectErr("deviceId+stationId reddi", "yalnız biri", () =>
        service.create(mk({ stationId: sevk.id, deviceId: device.id }), user.id));
    }

    // 5) makine-sahipli kayda update ile stationId eklemek (makineyi temizlemeden) reddedilir
    const machineOwned = await service.create(mk({ machineId: tamburMachine.id }), user.id);
    const machineOwnedId = (machineOwned.data as { id: string }).id;
    madeIds.push(machineOwnedId);
    await expectErr("update birleşik sahiplik reddi", "yalnız biri", () =>
      service.update(machineOwnedId, { stationId: sevk.id }, user.id));

    // 6) sahiplik değişimi (makine → istasyon) kabul edilir
    const moved = await service.update(machineOwnedId, { machineId: null, stationId: sevk.id }, user.id);
    const movedRow = moved.data as { machineId: string | null; stationId: string | null };
    check("sahiplik değişimi makine→istasyon", movedRow.machineId === null && movedRow.stationId === sevk.id);
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: madeIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
