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
import { atlamaDefteri } from "./lib/atlama";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/**
 * ⚠️ ATLAMA DEFTERİ ORTAK ALTYAPIDIR — yerel kopya AÇILMAZ (kopya `"?"` sınıfını
 * temsil edemez ve sayıyı elle düzeltmeye zorlar).
 */
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

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
      address, role, terminator: "\r\n", decimals: 1, timeoutMs: 2500, simulate: true, machineId,
    },
  });
}

/**
 * `unit` ESKİ İSTEMCİ TOLERANSI — kaynak sondası, DB'ye DOKUNMAZ.
 *
 * `PeripheralDevice.unit` süs alandı (çarpan yalnız `scale`; hiçbir yer okumuyor,
 * hiçbir yer doğrulamıyordu) ve kolon bir SONRAKİ sürümde düşecek. Gövde
 * `super.create/update`e OLDUĞU GİBİ gittiği için tolerans ÖNCE sahada olmalı:
 * yoksa kolon düştüğü gün `unit` gönderen eski panel bilinmeyen argümana çarpar ve
 * cihaz kaydı DÜZENLENEMEZ olur.
 *
 * ⚠️ NEDEN KAYNAK SONDASI, NEDEN SERVİS ÇAĞRISI DEĞİL: servis route'ta kendi
 * config'iyle örnekleniyor (`peripheral.routes.ts:37`); bekçide ikinci bir config
 * yazmak aynı gerçeği iki yerde tutmak olurdu ve ikisi sessizce ayrışır.
 *
 * ⚠️ DB ÖN KOŞULUNDAN ÖNCE ÇAĞRILIR ve bu SIRA ÖLÇÜLDÜ: `main()` seed'siz DB'de
 * "makine yok" diyip `exit(0)` veriyor, yani arkada kalan her kontrol SESSİZCE
 * atlanıyor ve bekçi YEŞİL görünüyordu (ölçüldü: fabrikanın canlı yedeğinde, sonuç
 * satırı hiç basılmadı). DB'ye ihtiyacı olmayan sonda, DB ön koşuluna bağlanmaz.
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

/** Kapıdan sonraki kontrol adedi — erken dönüşte "kaç kontrol atlandı" bununla beyan edilir. */
const DB_KONTROL_SAYISI = 12;

async function main() {
  unitToleransSondasi();
  const tambur = await prisma.machine.findFirst({ where: { code: "TAMBUR-M1" }, select: { id: true } });
  const kk1 = await prisma.machine.findFirst({ where: { code: "KK1-M1" }, select: { id: true } });
  // ⚠️ ERKEN ÇIKIŞ `fail`E BAĞLI: düz `exit(0)` idi ve kaynak sondası kırmızı
  // verse bile bekçi YEŞİL dönüyordu (çıkış kodu ölçümden kopmuştu). DB senaryoları
  // burada atlanıyor, ama atlandığı ÇIKTIDA yazılı ve karar sayaca bağlı.
  if (!tambur || !kk1) {
    // Erken dönüş: kapıdan sonraki kontrol sayısı döngüsüz ve sabittir; beyan
    // aşağıda kendi kendini ölçer (sayı değişince o kontrol kırmızı verir).
    ATLAMA.atla("DB senaryoları", "TAMBUR-M1/KK1-M1 makineleri yok (seed gerekli)", DB_KONTROL_SAYISI);
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
  const dbOncesi = pass + fail;
  const atlamaOncesi = ATLAMA.sayi;

  await upsertMeter("TAMBUR-METRE-2KAT", "Tambur 2 Kat Metre", tambur.id, "2-KAT", "00:23:09:01:05:5E");
  await upsertMeter("TAMBUR-METRE-4KAT", "Tambur 4 Kat Metre", tambur.id, "4-KAT", "00:23:09:01:1E:1B");
  await prisma.peripheralDevice.upsert({
    where: { code: "KK1-KANTAR" },
    update: { machineId: kk1.id, isActive: true },
    create: {
      code: "KK1-KANTAR", name: "KK1 Kantar", kind: "SCALE", connectionType: "BLUETOOTH_SPP",
      address: "00:23:09:01:1D:17", decimals: 2, timeoutMs: 2500, simulate: true, machineId: kk1.id,
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
      terminator: "\r\n", decimals: 2, timeoutMs: 2500, simulate: true, machineId: sevk.id,
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
    // Sessiz `console.log` koşucuya ulaşmıyordu; atlama SAYIYLA beyan edilir.
    ATLAMA.atla("sevkiyat kantarı senaryosu", "SEVK-M1 makinesi yok (seed'de yok, fabrika verisi)", 2);
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
      address: "00:00:00:00:00:99", role: "PRIMARY", terminator: "\r\n", decimals: 1, simulate: true,
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

  // cleanup (TEST- kayıtları) — ADI kapının okuduğu şeydir (§10b2).
  const cleanupTestKayitlari = async (): Promise<void> => {
    await prisma.devicePeripheral.deleteMany({ where: { peripheralId: testPeri.id } }); // pivot KİMLİKLE silinir (§10b)
    await prisma.peripheralDevice.deleteMany({ where: { code: "TEST-DEV-METRE" } });
    await prisma.device.deleteMany({ where: { deviceId: { in: ["TEST-DEV-FORDEVICE", "TEST-DEV-FORDEVICE-2"] } } });
  };
  await cleanupTestKayitlari();

  // Beyan kendi kendini ölçer: koşan + beyanla atlanan = sabit; DB bölümüne kontrol
  // eklenip sabit güncellenmezse (ya da bir dal sessizce düşerse) burası kırmızı.
  const dbKosan = pass + fail - dbOncesi;
  const dbAtlanan = ATLAMA.sayi - atlamaOncesi;
  check("DB kontrol sayısı beyanı (koşan + atlanan = erken çıkışın beyan ettiği adet)",
    dbKosan + dbAtlanan === DB_KONTROL_SAYISI, `${dbKosan} koşan + ${dbAtlanan} atlanan ↔ ${DB_KONTROL_SAYISI}`);

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
