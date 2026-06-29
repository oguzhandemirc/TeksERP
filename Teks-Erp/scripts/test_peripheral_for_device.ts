// =============================================================================
// Test: PeripheralDevice giriş-cihazı protokol alanları + getForDevice çözümleme.
// Çalıştır: npx tsx scripts/test_peripheral_for_device.ts
// 2 METER (2-kat/4-kat) + 1 SCALE satırını UPSERT eder (kalıcı config — silmez) ve
// tablet auto-discovery'i (getForDevice) doğrular. Seed'in giriş-cihazı bloğunun
// canlı eşdeğeri; reset gerekmeden DB'ye config'i koyar.
// =============================================================================
import prisma from "../src/lib/prisma";
import { PeripheralDeviceService } from "../src/services/peripheral.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new PeripheralDeviceService({
  modelName: "peripheralDevice", tableName: "PERIPHERAL_DEVICE",
  searchFields: ["code"], uniqueField: "code",
});

async function upsertMeter(code: string, name: string, machineId: string, role: string, address: string) {
  await prisma.peripheralDevice.upsert({
    where: { code },
    update: { role, machineId, isActive: true },
    create: {
      code, name, kind: "METER", connectionType: "BLUETOOTH_SPP",
      address, role, terminator: "\r\n", decimals: 1, unit: "m", timeoutMs: 2500, simulate: true, machineId,
    },
  });
}

async function main() {
  const tambur = await prisma.machine.findFirst({ where: { code: "TAMBUR-M1" }, select: { id: true } });
  const kk1 = await prisma.machine.findFirst({ where: { code: "KK1-M1" }, select: { id: true } });
  if (!tambur || !kk1) { console.log("⚠️ TAMBUR-M1/KK1-M1 makineleri yok — önce seed gerekli"); process.exit(0); }

  await upsertMeter("TAMBUR-METRE-2KAT", "Tambur 2 Kat Metre", tambur.id, "2-KAT", "00:23:09:01:05:5E");
  await upsertMeter("TAMBUR-METRE-4KAT", "Tambur 4 Kat Metre", tambur.id, "4-KAT", "00:23:09:01:1E:1B");
  await prisma.peripheralDevice.upsert({
    where: { code: "KK1-KANTAR" },
    update: { machineId: kk1.id, isActive: true },
    create: {
      code: "KK1-KANTAR", name: "KK1 Kantar", kind: "SCALE", connectionType: "BLUETOOTH_SPP",
      address: "00:23:09:01:1D:17", decimals: 2, unit: "kg", timeoutMs: 2500, simulate: true, machineId: kk1.id,
    },
  });

  // getForDevice: makine + tür → aktif cihazlar (protokol dahil)
  const meters = (await svc.getForDevice(tambur.id, "METER")).data as Array<{ role: string | null; terminator: string | null }>;
  check("getForDevice(TAMBUR,METER) → 2 satır", meters.length === 2, `${meters.length}`);
  check("2-KAT + 4-KAT rolleri var", meters.some((m) => m.role === "2-KAT") && meters.some((m) => m.role === "4-KAT"));
  check("protokol alanı taşınıyor (terminator)", meters.every((m) => m.terminator === "\r\n"));

  const scales = (await svc.getForDevice(kk1.id, "SCALE")).data as unknown[];
  check("getForDevice(KK1,SCALE) → 1 satır", scales.length === 1, `${scales.length}`);

  const none = (await svc.getForDevice(null, "METER")).data as unknown[];
  check("getForDevice(null) → boş liste (eşleşme yok)", none.length === 0);

  let threw = false;
  try { await svc.getForDevice(tambur.id, "BADKIND"); } catch { threw = true; }
  check("getForDevice(geçersiz kind) → hata", threw);

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
