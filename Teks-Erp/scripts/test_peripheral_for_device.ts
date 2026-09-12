// =============================================================================
// Test: PeripheralDevice giriş-cihazı protokol alanları + getForDevice çözümleme.
// Çalıştır: npx tsx scripts/test_peripheral_for_device.ts
// 2 METER (2-kat/4-kat) + KK1 SCALE + sevkiyat SERIAL_COM SCALE satırını UPSERT eder ve
// tablet auto-discovery'i (getForDevice) doğrular. Seed'in giriş-cihazı bloğunun
// canlı eşdeğeri; reset gerekmeden DB'ye config'i koyar.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma from "../src/lib/prisma";
import { PeripheralDeviceService } from "../src/services/peripheral.service";
import { DeviceService } from "../src/services/device.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new PeripheralDeviceService({
  modelName: "peripheralDevice", tableName: "PERIPHERAL_DEVICE",
  searchFields: [],
  codeSearchFields: ["code"], uniqueField: "code",
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

  // getForDevice: makine + tür → aktif cihazlar (protokol dahil) [geriye-uyum: machineId fallback]
  const meters = (await svc.getForDevice({ machineId: tambur.id }, "METER")).data as Array<{ role: string | null; terminator: string | null }>;
  check("getForDevice(TAMBUR,METER) → 2 satır", meters.length === 2, `${meters.length}`);
  check("2-KAT + 4-KAT rolleri var", meters.some((m) => m.role === "2-KAT") && meters.some((m) => m.role === "4-KAT"));
  check("protokol alanı taşınıyor (terminator)", meters.every((m) => m.terminator === "\r\n"));

  const scales = (await svc.getForDevice({ machineId: kk1.id }, "SCALE")).data as unknown[];
  check("getForDevice(KK1,SCALE) → 1 satır", scales.length === 1, `${scales.length}`);

  // Sevkiyat kantarı (SERIAL_COM) — yeni sevkiyat makinesi (reseed sonrası var).
  const sevk = await prisma.machine.findFirst({ where: { code: "SEVK-M1" }, select: { id: true } });
  if (sevk) {
    const sevkData = {
      kind: "SCALE" as const, connectionType: "BLUETOOTH_SPP" as const,
      address: "00:23:09:01:2A:3C", role: "PRIMARY", pollCommand: "P",
      terminator: "\r\n", decimals: 2, unit: "kg", timeoutMs: 2500, simulate: true, machineId: sevk.id,
    };
    await prisma.peripheralDevice.upsert({
      where: { code: "SEVK-KANTAR" },
      update: { ...sevkData, isActive: true }, // varsa BT-SPP'ye yakınsa (eski SERIAL_COM'u çevirir)
      create: { code: "SEVK-KANTAR", name: "Sevkiyat Kantarı", ...sevkData },
    });
    const sevkScales = (await svc.getForDevice({ machineId: sevk.id }, "SCALE")).data as Array<{ connectionType: string; unit: string | null; pollCommand: string | null; simulate: boolean }>;
    check("getForDevice(SEVK,SCALE) → ≥1 satır", sevkScales.length >= 1, `${sevkScales.length}`);
    check("SEVK kantarı BT-SPP + kg + komut + simulate", sevkScales.some((s) => s.connectionType === "BLUETOOTH_SPP" && s.unit === "kg" && s.pollCommand === "P" && s.simulate === true));
  } else {
    console.log("ℹ️ SEVK-M1 yok (reseed gerekli) — sevkiyat kantarı senaryosu atlandı");
  }

  const none = (await svc.getForDevice({}, "METER")).data as unknown[];
  check("getForDevice({}) → boş liste (eşleşme yok)", none.length === 0);

  let threw = false;
  try { await svc.getForDevice({ machineId: tambur.id }, "BADKIND"); } catch { threw = true; }
  check("getForDevice(geçersiz kind) → hata", threw);

  // --- YENİ MODEL: donanım DOĞRUDAN cihaza (deviceId) atanır (assignHardware) ---
  const testDev = await prisma.device.upsert({
    where: { deviceId: "TEST-DEV-FORDEVICE" },
    update: { isActive: true, status: "APPROVED" },
    create: { deviceId: "TEST-DEV-FORDEVICE", name: "TEST Cihaz", status: "APPROVED", isActive: true },
    select: { id: true },
  });
  const testPeri = await prisma.peripheralDevice.upsert({
    where: { code: "TEST-DEV-METRE" },
    update: { isActive: true, deviceId: null, machineId: null },
    create: {
      code: "TEST-DEV-METRE", name: "TEST Cihaz Metre", kind: "METER", connectionType: "BLUETOOTH_SPP",
      address: "00:00:00:00:00:99", role: "PRIMARY", terminator: "\r\n", decimals: 1, unit: "m", simulate: true,
    },
    select: { id: true },
  });
  await DeviceService.assignHardware(testDev.id, [testPeri.id]);
  const direct = (await svc.getForDevice({ deviceId: testDev.id }, "METER")).data as Array<{ code: string }>;
  check("getForDevice({deviceId}) → cihaza atanan donanım (join)", direct.length === 1 && direct[0]?.code === "TEST-DEV-METRE", `${direct.length}`);
  const pri = (await svc.getForDevice({ deviceId: testDev.id, machineId: tambur.id }, "METER")).data as Array<{ code: string }>;
  check("deviceId-öncelik (machineId fallback değil)", pri.length === 1 && pri[0]?.code === "TEST-DEV-METRE");

  // PAYLAŞIM (M:N): aynı donanım 2. cihaza da atanır → ikisinde de çözülür.
  const testDev2 = await prisma.device.upsert({
    where: { deviceId: "TEST-DEV-FORDEVICE-2" },
    update: { isActive: true, status: "APPROVED" },
    create: { deviceId: "TEST-DEV-FORDEVICE-2", name: "TEST Cihaz 2", status: "APPROVED", isActive: true },
    select: { id: true },
  });
  await DeviceService.assignHardware(testDev2.id, [testPeri.id]);
  const d1 = (await svc.getForDevice({ deviceId: testDev.id }, "METER")).data as unknown[];
  const d2 = (await svc.getForDevice({ deviceId: testDev2.id }, "METER")).data as unknown[];
  check("PAYLAŞIM: aynı donanım iki cihazda da çözülür", d1.length === 1 && d2.length === 1, `dev1=${d1.length} dev2=${d2.length}`);
  // testDev'den kaldır → testDev2'de HÂLÂ var (paylaşım, diğerine dokunulmaz)
  await DeviceService.assignHardware(testDev.id, []);
  const d1c = (await svc.getForDevice({ deviceId: testDev.id }, "METER")).data as unknown[];
  const d2c = (await svc.getForDevice({ deviceId: testDev2.id }, "METER")).data as unknown[];
  check("kaldırınca diğer cihazda kalır (paylaşım korunur)", d1c.length === 0 && d2c.length === 1, `dev1=${d1c.length} dev2=${d2c.length}`);

  // ── `unit` ESKİ İSTEMCİ TOLERANSI (kaynak tripwire) ────────────────────────
  // `PeripheralDevice.unit` süs alandı (çarpan yalnız `scale`; hiçbir yer okumuyor,
  // hiçbir yer doğrulamıyordu) ve kolon bir SONRAKİ sürümde düşecek. Gövde
  // `super.create/update`e OLDUĞU GİBİ gittiği için tolerans ÖNCE sahada olmalı:
  // yoksa kolon düştüğü gün `unit` gönderen eski panel bilinmeyen argümana çarpar
  // ve cihaz kaydı DÜZENLENEMEZ olur.
  // ⚠️ NEDEN KAYNAK TRIPWIRE, NEDEN SERVİS ÇAĞRISI DEĞİL: servis route'ta kendi
  // config'iyle örnekleniyor (`peripheral.routes.ts:37`); bekçide ikinci bir config
  // yazmak aynı gerçeği iki yerde tutmak olurdu ve ikisi sessizce ayrışır.
  const peripheralSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/services/peripheral.service.ts"),
    "utf8",
  );
  const unitToleransSayisi = (peripheralSrc.match(/delete\s+data\.unit\s*;/g) ?? []).length;
  check(
    "create ve update, `unit`i eski istemci toleransı olarak DÜŞÜRÜYOR (2 yer)",
    unitToleransSayisi === 2,
    `${unitToleransSayisi} yerde bulundu`,
  );
  check(
    "körlük zemini: tolerans emsali (`printerModelId`) hâlâ duruyor",
    /delete\s+data\.printerModelId\s*;/.test(peripheralSrc),
  );

  // cleanup (TEST- kayıtları)
  await prisma.devicePeripheral.deleteMany({ where: { peripheral: { code: "TEST-DEV-METRE" } } });
  await prisma.peripheralDevice.deleteMany({ where: { code: "TEST-DEV-METRE" } });
  await prisma.device.deleteMany({ where: { deviceId: { in: ["TEST-DEV-FORDEVICE", "TEST-DEV-FORDEVICE-2"] } } });

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
