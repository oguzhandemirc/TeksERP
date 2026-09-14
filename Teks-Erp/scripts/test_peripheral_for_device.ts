// =============================================================================
// Test: PeripheralDevice giriş-cihazı protokol alanları + getForDevice çözümleme.
// Çalıştır: npx tsx scripts/test_peripheral_for_device.ts
//
// FİXTURE DİSİPLİNİ: bekçi KENDİ istasyon/makine/cihaz/donanım kümesini
// `TEST-PERIF-*` kodlarıyla yaratır ve `finally`de KİMLİKLE siler. Gerçek kodlu
// satırlara (`TAMBUR-METRE-*`, `KK1-KANTAR`, `SEVK-KANTAR`) upsert YOK — eski
// sürüm fabrikanın gerçek cihaz satırını `simulate:true`ya çeviriyordu ve
// SEVK-M1 olmayan DB'de iki kontrolü atlıyordu. Ön koşul seed değil, fixture.
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

const TAG = `TEST-PERIF-${process.pid}`;
/** Yaratılan her satırın kimliği — teardown yalnız bunlara bakar (ada/öneke değil). */
const ids = {
  station: null as string | null,
  machines: [] as string[],
  peripherals: [] as string[],
  devices: [] as string[],
};

async function makine(code: string, name: string): Promise<string> {
  const m = await prisma.machine.create({
    data: { code, name, stationId: ids.station! },
    select: { id: true },
  });
  ids.machines.push(m.id);
  return m.id;
}

async function donanim(data: Parameters<typeof prisma.peripheralDevice.create>[0]["data"]): Promise<string> {
  const p = await prisma.peripheralDevice.create({ data, select: { id: true } });
  ids.peripherals.push(p.id);
  return p.id;
}

async function cihaz(deviceId: string, name: string): Promise<string> {
  const d = await prisma.device.create({
    data: { deviceId, name, status: "APPROVED", isActive: true },
    select: { id: true },
  });
  ids.devices.push(d.id);
  return d.id;
}

/** Seed'in giriş-cihazı bloğunun bekçiye özel eşdeğeri: 2 METER + KK1 SCALE + sevkiyat SCALE. */
async function fixtureKur(): Promise<{ tambur: string; kk1: string; sevk: string }> {
  const st = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: `Perif. istasyonu ${TAG}`, type: "INTERNAL" },
    select: { id: true },
  });
  ids.station = st.id;
  const tambur = await makine(`${TAG}-TAMBUR`, "Perif. Tambur");
  const kk1 = await makine(`${TAG}-KK1`, "Perif. KK1");
  const sevk = await makine(`${TAG}-SEVK`, "Perif. Sevkiyat");
  for (const [role, address] of [["2-KAT", "00:23:09:01:05:5E"], ["4-KAT", "00:23:09:01:1E:1B"]] as const) {
    await donanim({
      code: `${TAG}-METRE-${role}`, name: `Perif. Metre ${role}`, kind: "METER", connectionType: "BLUETOOTH_SPP",
      address, role, terminator: "\r\n", decimals: 1, timeoutMs: 2500, simulate: true, machineId: tambur,
    });
  }
  await donanim({
    code: `${TAG}-KK1-KANTAR`, name: "Perif. KK1 Kantar", kind: "SCALE", connectionType: "BLUETOOTH_SPP",
    address: "00:23:09:01:1D:17", decimals: 2, timeoutMs: 2500, simulate: true, machineId: kk1,
  });
  await donanim({
    code: `${TAG}-SEVK-KANTAR`, name: "Perif. Sevkiyat Kantarı", kind: "SCALE", connectionType: "BLUETOOTH_SPP",
    address: "00:23:09:01:2A:3C", role: "PRIMARY", pollCommand: "P",
    terminator: "\r\n", decimals: 2, timeoutMs: 2500, simulate: true, machineId: sevk,
  });
  return { tambur, kk1, sevk };
}

/** Teardown — FK sırasıyla, yalnız kendi kimlikleri. Pivot (`devicePeripheral`) donanım kimliğiyle. */
async function temizle(): Promise<void> {
  if (ids.peripherals.length) await prisma.devicePeripheral.deleteMany({ where: { peripheralId: { in: ids.peripherals } } });
  if (ids.peripherals.length) await prisma.peripheralDevice.deleteMany({ where: { id: { in: ids.peripherals } } });
  if (ids.devices.length) await prisma.device.deleteMany({ where: { id: { in: ids.devices } } });
  if (ids.machines.length) await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
}

/**
 * `unit` ESKİ İSTEMCİ TOLERANSI — kaynak sondası, DB'ye DOKUNMAZ.
 *
 * `PeripheralDevice.unit` süs alandı (çarpan yalnız `scale`; hiçbir yer okumuyor,
 * hiçbir yer doğrulamıyordu) ve kolon düştü. Gövde `super.create/update`e OLDUĞU
 * GİBİ gittiği için tolerans sahada olmalı: yoksa `unit` gönderen eski panel
 * bilinmeyen argümana çarpar ve cihaz kaydı DÜZENLENEMEZ olur.
 *
 * ⚠️ NEDEN KAYNAK SONDASI, NEDEN SERVİS ÇAĞRISI DEĞİL: servis route'ta kendi
 * config'iyle örnekleniyor (`peripheral.routes.ts:37`); bekçide ikinci bir config
 * yazmak aynı gerçeği iki yerde tutmak olurdu ve ikisi sessizce ayrışır.
 */
function unitToleransSondasi(): void {
  const peripheralSrc = fs.readFileSync(
    path.resolve(__dirname, "../src/services/peripheral.service.ts"),
    "utf8",
  );
  // ⚠️ YORUMLAR SÖKÜLÜR ve bu SATIR BİR SONDANIN ÜRÜNÜ: ilk negatif sondamda
  // satırı `// delete data.unit;` diye yorumladım ve kapı YEŞİL kaldı — yorumlanmış
  // tolerans ÇALIŞMAYAN toleranstır. Dizge arayan sonda yorumu koddan ayırmazsa
  // "kaldırıldı"yı "duruyor" okur.
  const kod = peripheralSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const unitToleransSayisi = (kod.match(/delete\s+data\.unit\s*;/g) ?? []).length;
  check(
    "create ve update, `unit`i eski istemci toleransı olarak DÜŞÜRÜYOR (2 yer)",
    unitToleransSayisi === 2,
    `${unitToleransSayisi} yerde bulundu`,
  );
  check(
    "körlük zemini: tolerans emsali (`printerModelId`) hâlâ duruyor",
    /delete\s+data\.printerModelId\s*;/.test(kod),
  );
}

async function main() {
  unitToleransSondasi();

  const { tambur, kk1, sevk } = await fixtureKur();
  check("fixture kuruldu (istasyon + 3 makine + 4 donanım)", ids.machines.length === 3 && ids.peripherals.length === 4,
    `${ids.machines.length} makine · ${ids.peripherals.length} donanım`);

  // getForDevice: makine + tür → aktif cihazlar (protokol dahil) [geriye-uyum: machineId fallback]
  const meters = (await svc.getForDevice({ machineId: tambur }, "METER")).data as Array<{ role: string | null; terminator: string | null }>;
  check("getForDevice(TAMBUR,METER) → 2 satır", meters.length === 2, `${meters.length}`);
  check("2-KAT + 4-KAT rolleri var", meters.some((m) => m.role === "2-KAT") && meters.some((m) => m.role === "4-KAT"));
  check("protokol alanı taşınıyor (terminator)", meters.every((m) => m.terminator === "\r\n"));

  const scales = (await svc.getForDevice({ machineId: kk1 }, "SCALE")).data as unknown[];
  check("getForDevice(KK1,SCALE) → 1 satır", scales.length === 1, `${scales.length}`);

  // Sevkiyat kantarı: BT-SPP + poll komutu + simülasyon bayrağı taşınıyor.
  const sevkScales = (await svc.getForDevice({ machineId: sevk }, "SCALE")).data as Array<{ connectionType: string; pollCommand: string | null; simulate: boolean }>;
  check("getForDevice(SEVK,SCALE) → 1 satır", sevkScales.length === 1, `${sevkScales.length}`);
  check("SEVK kantarı BT-SPP + komut + simulate", sevkScales.some((s) => s.connectionType === "BLUETOOTH_SPP" && s.pollCommand === "P" && s.simulate === true));

  const none = (await svc.getForDevice({}, "METER")).data as unknown[];
  check("getForDevice({}) → boş liste (eşleşme yok)", none.length === 0);

  let threw = false;
  try { await svc.getForDevice({ machineId: tambur }, "BADKIND"); } catch { threw = true; }
  check("getForDevice(geçersiz kind) → hata", threw);

  // --- YENİ MODEL: donanım DOĞRUDAN cihaza (deviceId) atanır (assignHardware) ---
  const testDev = await cihaz(`${TAG}-DEV-1`, "Perif. Cihaz 1");
  const testPeri = await donanim({
    code: `${TAG}-DEV-METRE`, name: "Perif. Cihaz Metre", kind: "METER", connectionType: "BLUETOOTH_SPP",
    address: "00:00:00:00:00:99", role: "PRIMARY", terminator: "\r\n", decimals: 1, simulate: true,
  });
  await DeviceService.assignHardware(testDev, [testPeri]);
  const direct = (await svc.getForDevice({ deviceId: testDev }, "METER")).data as Array<{ id: string }>;
  check("getForDevice({deviceId}) → cihaza atanan donanım (join)", direct.length === 1 && direct[0]?.id === testPeri, `${direct.length}`);
  const pri = (await svc.getForDevice({ deviceId: testDev, machineId: tambur }, "METER")).data as Array<{ id: string }>;
  check("deviceId-öncelik (machineId fallback değil)", pri.length === 1 && pri[0]?.id === testPeri);

  // PAYLAŞIM (M:N): aynı donanım 2. cihaza da atanır → ikisinde de çözülür.
  const testDev2 = await cihaz(`${TAG}-DEV-2`, "Perif. Cihaz 2");
  await DeviceService.assignHardware(testDev2, [testPeri]);
  const d1 = (await svc.getForDevice({ deviceId: testDev }, "METER")).data as unknown[];
  const d2 = (await svc.getForDevice({ deviceId: testDev2 }, "METER")).data as unknown[];
  check("PAYLAŞIM: aynı donanım iki cihazda da çözülür", d1.length === 1 && d2.length === 1, `dev1=${d1.length} dev2=${d2.length}`);
  // testDev'den kaldır → testDev2'de HÂLÂ var (paylaşım, diğerine dokunulmaz)
  await DeviceService.assignHardware(testDev, []);
  const d1c = (await svc.getForDevice({ deviceId: testDev }, "METER")).data as unknown[];
  const d2c = (await svc.getForDevice({ deviceId: testDev2 }, "METER")).data as unknown[];
  check("kaldırınca diğer cihazda kalır (paylaşım korunur)", d1c.length === 0 && d2c.length === 1, `dev1=${d1c.length} dev2=${d2c.length}`);
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.message : e); fail++; })
  .finally(async () => {
    try {
      await temizle();
    } catch (e) {
      console.error("temizlik hatası:", e instanceof Error ? e.message : e);
      fail++;
    }
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
