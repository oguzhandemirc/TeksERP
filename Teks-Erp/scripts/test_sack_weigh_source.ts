// =============================================================================
// TEST: Simüle kantar koruması — `weighSack` kaynak beyanı + backend ENFORCE
// Çalıştır: npx tsx scripts/test_sack_weigh_source.ts
// =============================================================================
// SORUN: `PeripheralDevice.simulate` açık bir kantar 10–100 kg arası RASTGELE değer
// üretiyor ve tek-dokunuş tartı onu DOĞRUDAN DB'ye yazıyordu; tek koruma bir toast'tı
// (Electron'da hiç uyarı bile yoktu — uyarı mutasyon BAŞARILI olduktan sonra geliyordu).
// Bu kg sevk irsaliyesine VE çeki listesine basılıyor (müşteri/gümrük belgesi).
//
// ÇÖZÜM: `source` beyanı (SCALE|MANUAL|SIMULATED) + `shipping.simulatedWeightEnabled`
// bayrağı (default KAPALI = ENFORCE). İki sinyal: istemci beyanı VE (mobil oturumda)
// sunucunun cihazı kendi çözüp `simulate`'i çapraz kontrol etmesi.
// `MANUAL` MUAF — kantarsız/arızalı durumun kaçış yolu.
// =============================================================================
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `markSackContentChangedTx` gövdesi koşulsuz `return`e çevrildi (içerik
//    değişince kg sıfırlama + `labelDirty` damgası öldü) -> 2 kontrol KIRMIZI.
//    Geri alındığında yeşil.
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";
import { Prisma, RollStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
const msgOf = (e: unknown) => (e instanceof AppError ? e.message : String(e));

const TS = Date.now().toString().slice(-6);
const FLAG = "shipping.simulatedWeightEnabled";
// `SystemSetting.value` şemada `Json` — `string` DEĞİL. Yanlış tip yüzünden bu
// "ayarı yedekle/geri yükle" bloğu hiç derlenmiyordu; geri yüklemede ham `null`
// yazmak da Prisma'da çalışmaz (Json kolonda `Prisma.JsonNull` gerekir).
let prevFlag: Prisma.JsonValue | undefined;

let ADMIN = "";
let CUSTOMER = "";
let ITEM = "";
let STATION = "";
const rollIds: string[] = [];
const sackIds: string[] = [];
const deviceIds: string[] = [];

async function setFlag(on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: FLAG },
    create: { key: FLAG, value: String(on) },
    update: { value: String(on) },
  });
}

async function makeSack(): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-WSRC-R${TS}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: 40,
      currentQty: 40,
      qualityGrade: "1.KALITE",
      width: 150,
      status: RollStatus.WAREHOUSE,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });
  rollIds.push(roll.id);
  const sack = (await shippingService.openSack({ customerId: CUSTOMER }, ADMIN)).data as { id: string };
  sackIds.push(sack.id);
  await shippingService.scanIntoSack({ sackId: sack.id, barcode: roll.barcode! }, ADMIN);
  return sack.id;
}

async function kgOf(sackId: string): Promise<number | null> {
  const s = await prisma.sack.findUnique({ where: { id: sackId }, select: { weightKg: true } });
  return s?.weightKg == null ? null : Number(s.weightKg);
}

/** Kalıcı kaynak kolonu (`Sack.weightSource`) — audit'ten BAĞIMSIZ doğrulama. */
async function srcOfSack(sackId: string): Promise<string | null> {
  const s = await prisma.sack.findUnique({ where: { id: sackId }, select: { weightSource: true } });
  return s?.weightSource ?? null;
}

async function run(): Promise<void> {
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(
    await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif istasyon"
  ).id;
  CUSTOMER = (
    await prisma.customer.create({
      data: { code: `TEST-WSRC-C-${TS}`, name: `Tarti Kaynak Musteri ${TS}` },
      select: { id: true },
    })
  ).id;
  ITEM = (
    await prisma.item.create({
      data: { code: `TEST-WSRC-I-${TS}`, name: `Tarti Kaynak Urun ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;
  prevFlag = (await prisma.systemSetting.findUnique({ where: { key: FLAG }, select: { value: true } }))?.value;

  // ───────────────────────────────── 1) Bayrak KAPALI + SIMULATED beyanı → 400
  console.log("\n=== 1) Bayrak KAPALI: SIMULATED beyanı REDDEDİLİR ===");
  await setFlag(false);
  const s1 = await makeSack();
  let err: unknown;
  try {
    await shippingService.weighSack({ sackId: s1, weightKg: 47.3, source: "SIMULATED" }, ADMIN);
  } catch (e) {
    err = e;
  }
  check("weighSack(SIMULATED) 400", is400(err), msgOf(err).slice(0, 90));
  check("mesaj Cihaz Kaydı'na + elle girişe yönlendiriyor", /Cihaz Kaydı/.test(msgOf(err)) && /Elle kg gir/.test(msgOf(err)));
  check("kg YAZILMADI (null kaldı)", (await kgOf(s1)) === null, `${await kgOf(s1)}`);

  // ─────────────────────────────────── 2) MANUAL her zaman geçer (kaçış yolu)
  console.log("\n=== 2) MANUAL beyanı bayrak kapalıyken de GEÇER (kaçış yolu) ===");
  await shippingService.weighSack({ sackId: s1, weightKg: 12.5, source: "MANUAL" }, ADMIN);
  check("elle giriş kaydedildi", (await kgOf(s1)) === 12.5, `${await kgOf(s1)}`);

  // ───────────────────── 3) `source` verilmezse MANUAL varsayılır (geri uyum)
  console.log("\n=== 3) `source` YOKSA MANUAL varsayılır (eski istemci geri uyumu) ===");
  const s3 = await makeSack();
  await shippingService.weighSack({ sackId: s3, weightKg: 9.9 }, ADMIN);
  check("beyansız çağrı kaydedildi (eski APK kırılmaz)", (await kgOf(s3)) === 9.9, `${await kgOf(s3)}`);

  // ────────────── 4) SCALE beyanı + oturum cihazı SİMÜLE → sunucu yakalar (400)
  console.log("\n=== 4) SCALE beyanı ama oturumun kantarı SİMÜLE → sunucu REDDEDER ===");
  const simDevice = await prisma.peripheralDevice.create({
    data: {
      code: `TEST-WSRC-SCALE-${TS}`,
      name: `Test Simüle Kantar ${TS}`,
      kind: "SCALE",
      connectionType: "BLUETOOTH_SPP",
      address: "00:11:22:33:44:55",
      role: "PRIMARY",
      simulate: true,
      stationId: STATION,
    },
    select: { id: true },
  });
  deviceIds.push(simDevice.id);
  const s4 = await makeSack();
  err = undefined;
  try {
    // stamp = oturumun makine/istasyonu; makine yok (sevkiyat makinesiz) → stationId yolu.
    await shippingService.weighSack(
      { sackId: s4, weightKg: 88.8, source: "SCALE" },
      ADMIN,
      { machineId: null, stationId: STATION }
    );
  } catch (e) {
    err = e;
  }
  check("SCALE beyanı sunucu çapraz kontrolünde 400", is400(err), msgOf(err).slice(0, 80));
  check("kg YAZILMADI (istemci yalanı işe yaramaz)", (await kgOf(s4)) === null, `${await kgOf(s4)}`);

  // ── 4b) Aynı çağrı MANUAL beyanıyla GEÇER (kantarın simüle olması engellemez)
  await shippingService.weighSack(
    { sackId: s4, weightKg: 5.5, source: "MANUAL" },
    ADMIN,
    { machineId: null, stationId: STATION }
  );
  check("aynı istasyonda MANUAL geçer (kantar simüle olsa da)", (await kgOf(s4)) === 5.5, `${await kgOf(s4)}`);

  // ─────────────────── 5) Cihaz GERÇEK (simulate=false) → SCALE beyanı geçer
  console.log("\n=== 5) Oturumun kantarı GERÇEK → SCALE beyanı geçer ===");
  await prisma.peripheralDevice.update({ where: { id: simDevice.id }, data: { simulate: false } });
  const s5 = await makeSack();
  await shippingService.weighSack(
    { sackId: s5, weightKg: 33.3, source: "SCALE" },
    ADMIN,
    { machineId: null, stationId: STATION }
  );
  check("gerçek kantar okuması kaydedildi", (await kgOf(s5)) === 33.3, `${await kgOf(s5)}`);

  // ─────────────────── 6) Bayrak AÇIK → SIMULATED kaydedilebilir (demo/eğitim)
  console.log("\n=== 6) Bayrak AÇIK: SIMULATED kaydedilebilir (demo/eğitim kurulumu) ===");
  await setFlag(true);
  const s6 = await makeSack();
  await shippingService.weighSack({ sackId: s6, weightKg: 66.6, source: "SIMULATED" }, ADMIN);
  check("bayrak açıkken simüle kg kaydedildi", (await kgOf(s6)) === 66.6, `${await kgOf(s6)}`);

  // 6b) ⭐ KOLON YALAN SÖYLEMEZ: bayrak AÇIKKEN istemci "SCALE" beyan etse bile,
  // sunucu oturumun kantarını SİMÜLE bulursa kolona SIMULATED yazılmalı. Aksi halde
  // (beyan edilen değer yazılırsa) kolonun tek varlık sebebi — simüle 47.3 ile gerçek
  // 47.3'ü ayırmak — kaybolurdu. `simulated` bayrağı if-bloğunun DIŞINA alındı.
  await prisma.peripheralDevice.update({ where: { id: simDevice.id }, data: { simulate: true } });
  const s6b = await makeSack();
  await shippingService.weighSack(
    { sackId: s6b, weightKg: 77.7, source: "SCALE" },
    ADMIN,
    { machineId: null, stationId: STATION },
  );
  check("bayrak açıkken simüle cihaz + SCALE beyanı kaydedildi", (await kgOf(s6b)) === 77.7);
  check(
    "⭐ kolon ÇÖZÜLMÜŞ kaynağı yazdı (SIMULATED) — beyanı (SCALE) DEĞİL",
    (await srcOfSack(s6b)) === "SIMULATED",
    `${await srcOfSack(s6b)}`,
  );
  await prisma.peripheralDevice.update({ where: { id: simDevice.id }, data: { simulate: false } });
  await setFlag(false);

  // ─────────────────── 6c) KOLON: kaynak kalıcı ve sorgulanabilir; reset temizler
  console.log("\n=== 6c) `Sack.weightSource` kolonu ===");
  check("MANUAL tartıda kolon = MANUAL", (await srcOfSack(s1)) === "MANUAL", `${await srcOfSack(s1)}`);
  check("gerçek kantar tartısında kolon = SCALE", (await srcOfSack(s5)) === "SCALE", `${await srcOfSack(s5)}`);
  check("beyansız (legacy istemci) tartıda kolon = MANUAL", (await srcOfSack(s3)) === "MANUAL");
  // İçerik değişince kg sıfırlanır → kaynak da NULL olmalı ("kg yok ama kaynak dolu"
  // tutarsız çifti kalmasın). markSackContentChangedTx'i removeRollFromSack tetikler.
  const rollInS5 = await prisma.roll.findFirst({ where: { sackId: s5 }, select: { id: true } });
  if (rollInS5) await shippingService.removeRollFromSack({ rollId: rollInS5.id }, ADMIN);
  check("içerik değişti → kg NULL", (await kgOf(s5)) === null);
  check("⭐ içerik değişti → weightSource da NULL (bayat kaynak kalmaz)", (await srcOfSack(s5)) === null, `${await srcOfSack(s5)}`);

  // ─────────────────────────── 7) Audit izi de kaynağı taşıyor (kolonla birlikte)
  console.log("\n=== 7) Audit `source` taşıyor (kolonun yanında, kim/ne zaman bağlamıyla) ===");
  const audits = await prisma.systemLog.findMany({
    where: { tableName: "SACK", recordId: { in: [s1, s5, s6] }, action: "UPDATE" },
    select: { recordId: true, newData: true },
  });
  const srcOf = (id: string): string | undefined => {
    const row = audits.find(
      (a) => a.recordId === id && (a.newData as { kind?: string } | null)?.kind === "WEIGH"
    );
    return (row?.newData as { source?: string } | null)?.source;
  };
  check("MANUAL tartı audit'te source=MANUAL", srcOf(s1) === "MANUAL", `${srcOf(s1)}`);
  check("SCALE tartı audit'te source=SCALE", srcOf(s5) === "SCALE", `${srcOf(s5)}`);
  check("SIMULATED tartı audit'te source=SIMULATED", srcOf(s6) === "SIMULATED", `${srcOf(s6)}`);
}

async function teardown(): Promise<void> {
  try {
    if (prevFlag === undefined) await prisma.systemSetting.deleteMany({ where: { key: FLAG } });
    else
      await prisma.systemSetting.update({
        where: { key: FLAG },
        // Json kolonda JS `null` kabul edilmez → `Prisma.JsonNull`.
        data: { value: prevFlag === null ? Prisma.JsonNull : prevFlag },
      });
  } catch {
    /* ayar geri alınamadıysa geç */
  }
  await prisma.systemLog.deleteMany({ where: { tableName: "SACK", recordId: { in: sackIds } } });
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.peripheralDevice.deleteMany({ where: { id: { in: deviceIds } } });
  await prisma.item.deleteMany({ where: { id: ITEM } });
  await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

run()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
