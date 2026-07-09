// =============================================================================
// Test: saha donanım-eşleme (setFieldAddress) — oturum-yer kapsam guard'ı,
// tür/bağlantı daraltması, varlık/uzunluk kontrolleri + route 409 (oturum yok) +
// getForSession kind-opsiyonel çözümleme.
// Çalıştır: npx tsx scripts/test_field_address.ts
//
// GÜVENLİK: tablet yalnız aktif oturumunun makine/istasyonundaki BT kantar/metre
// cihazına MAC yazabilir — başka makinenin cihazına (403), yazıcı/ağ cihazına (400),
// oturumsuz (409) yazamaz.
// =============================================================================
import prisma from "../src/lib/prisma";
import { PeripheralDeviceService } from "../src/services/peripheral.service";
import { getStampContext } from "../src/services/helpers/work-session.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectStatus(status: number, fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return e instanceof AppError && e.statusCode === status; }
}

const svc = new PeripheralDeviceService({
  modelName: "peripheralDevice", tableName: "PERIPHERAL_DEVICE",
  searchFields: ["code"], uniqueField: "code",
});

async function main() {
  const ts = Date.now();
  const machineA = await prisma.machine.findFirst({ where: { code: "TAMBUR-M1" }, select: { id: true, stationId: true } });
  const machineB = await prisma.machine.findFirst({ where: { code: "KK1-M1" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!machineA || !machineB) { console.log("⚠️ TAMBUR-M1/KK1-M1 makineleri yok — önce seed gerekli"); process.exit(0); }

  // Makinesiz istasyon (SHIPPING) — istasyon-kapsam senaryosu için (varsa).
  const shipStation = await prisma.station.findFirst({
    where: { kind: "SHIPPING", isActive: true, machines: { none: { isActive: true } } },
    select: { id: true },
  });

  const createdIds: string[] = [];
  const codes = {
    aMeter: `TEST-FA-A-METER-${ts}`,
    aScale: `TEST-FA-A-SCALE-${ts}`,
    bMeter: `TEST-FA-B-METER-${ts}`,
    stScale: `TEST-FA-ST-SCALE-${ts}`,
    aPrinter: `TEST-FA-A-PRN-${ts}`,
    aTcp: `TEST-FA-A-TCP-${ts}`,
    aDel: `TEST-FA-A-DEL-${ts}`,
  };
  const noSessDeviceId = `test-fa-nosess-${ts}`;

  try {
    const mk = async (code: string, opts: {
      kind: "METER" | "SCALE" | "LABEL_PRINTER";
      connectionType?: "BLUETOOTH_SPP" | "NETWORK_TCP";
      machineId?: string; stationId?: string;
    }): Promise<string> => {
      const row = await prisma.peripheralDevice.create({
        data: {
          code, name: code, kind: opts.kind,
          connectionType: opts.connectionType ?? "BLUETOOTH_SPP",
          simulate: true, isActive: true,
          machineId: opts.machineId ?? null, stationId: opts.stationId ?? null,
        },
        select: { id: true },
      });
      createdIds.push(row.id);
      return row.id;
    };

    const aMeterId = await mk(codes.aMeter, { kind: "METER", machineId: machineA.id });
    const aScaleId = await mk(codes.aScale, { kind: "SCALE", machineId: machineA.id });
    const bMeterId = await mk(codes.bMeter, { kind: "METER", machineId: machineB.id });
    const stScaleId = shipStation ? await mk(codes.stScale, { kind: "SCALE", stationId: shipStation.id }) : null;

    const sessA = { machineId: machineA.id, stationId: machineA.stationId };
    const MAC = "AA:BB:CC:DD:EE:01";

    // --- Happy: makine A oturumu → makine A cihazına MAC yazar + simulate kapanır ---
    const r = await svc.setFieldAddress(aMeterId, MAC, sessA);
    const after = r.data as { address: string | null; simulate: boolean };
    check("makine A oturumu → A cihazına MAC yazıldı", after.address === MAC);
    check("gerçek MAC atanınca simulate=false", after.simulate === false);

    // --- 403: makine A oturumu, makine B cihazına yazamaz ---
    check("makine A oturumu → makine B cihazına yazamaz (403)",
      await expectStatus(403, () => svc.setFieldAddress(bMeterId, MAC, sessA)));

    // --- 403: oturum yok (servis seviyesi null) ---
    check("oturum yok → yazamaz (403)",
      await expectStatus(403, () => svc.setFieldAddress(aMeterId, MAC, null)));

    // --- 400: boş adres ---
    check("boş adres → 400",
      await expectStatus(400, () => svc.setFieldAddress(aMeterId, "  ", sessA)));

    // --- 403: makine cihazı, yalnız istasyon-oturumu ile yazılamaz ---
    check("makine cihazına istasyon-oturumuyla yazılamaz (403)",
      await expectStatus(403, () => svc.setFieldAddress(aMeterId, MAC, { machineId: null, stationId: machineA.stationId })));

    // --- Tür daraltması: yalnız BT kantar/metre (yetki-modeli boşluğu fix) ---
    const aPrinterId = await mk(codes.aPrinter, { kind: "LABEL_PRINTER", machineId: machineA.id });
    check("LABEL_PRINTER'a saha eşleme yazılamaz (400)",
      await expectStatus(400, () => svc.setFieldAddress(aPrinterId, MAC, sessA)));
    const aTcpId = await mk(codes.aTcp, { kind: "METER", connectionType: "NETWORK_TCP", machineId: machineA.id });
    check("NETWORK_TCP cihaza saha eşleme yazılamaz (400)",
      await expectStatus(400, () => svc.setFieldAddress(aTcpId, MAC, sessA)));

    // --- 404: var olmayan + soft-deleted (tombstone) cihaz (varlık kapsamdan önce) ---
    check("var olmayan cihaz → 404",
      await expectStatus(404, () => svc.setFieldAddress("00000000-0000-0000-0000-000000000000", MAC, sessA)));
    const aDelId = await mk(codes.aDel, { kind: "METER", machineId: machineA.id });
    await svc.hardDelete(aDelId);
    check("silinmiş cihaz → 404 (403 değil — varlık önce)",
      await expectStatus(404, () => svc.setFieldAddress(aDelId, MAC, sessA)));

    // --- Adres uzunluğu sınırı (128) ---
    check("129 karakter adres → 400",
      await expectStatus(400, () => svc.setFieldAddress(aMeterId, "A".repeat(129), sessA)));
    const r128 = await svc.setFieldAddress(aMeterId, "A".repeat(128), sessA);
    check("128 karakter adres → kabul", (r128.data as { address: string | null }).address === "A".repeat(128));

    // --- İstasyon-kapsam (makinesiz SHIPPING) senaryosu ---
    if (stScaleId && shipStation) {
      const sessSt = { machineId: null as string | null, stationId: shipStation.id };
      const rSt = await svc.setFieldAddress(stScaleId, "AA:BB:CC:DD:EE:02", sessSt);
      check("istasyon oturumu → istasyon cihazına yazar", (rSt.data as { address: string | null }).address === "AA:BB:CC:DD:EE:02");
      check("istasyon oturumu → başka makinenin cihazına yazamaz (403)",
        await expectStatus(403, () => svc.setFieldAddress(aMeterId, MAC, sessSt)));
    } else {
      console.log("ℹ️ Makinesiz SHIPPING istasyonu yok — istasyon-kapsam senaryosu atlandı");
    }

    // --- Route guard'ı: oturumsuz tablet 409, DESKTOP muaf ---
    const noSessDev = await prisma.device.create({
      data: { deviceId: noSessDeviceId, name: "TEST FA NoSess", status: "APPROVED", kind: "TABLET" },
      select: { id: true },
    });
    check("oturumsuz TABLET → getStampContext 409 WORK_SESSION_REQUIRED",
      await expectStatus(409, () => getStampContext(
        { device: { id: noSessDev.id, kind: "TABLET" }, user: { userId: admin?.id } },
        { enforceForMobile: true },
      )));
    const desktopStamp = await getStampContext(
      { device: { id: noSessDev.id, kind: "DESKTOP" }, user: { userId: admin?.id } },
      { enforceForMobile: true },
    );
    check("oturumsuz DESKTOP → 409 DEĞİL (muaf, null)", desktopStamp === null);

    // --- getForSession kind-opsiyonel: makine A'nın TÜM cihazları vs sadece METER ---
    const allA = (await svc.getForSession({ machineId: machineA.id, stationId: null })).data as Array<{ code: string; kind: string }>;
    const allCodes = allA.map((x) => x.code);
    check("getForSession(kind yok) → METER de SCALE de gelir", allCodes.includes(codes.aMeter) && allCodes.includes(codes.aScale));

    const meterOnly = (await svc.getForSession({ machineId: machineA.id, stationId: null }, "METER")).data as Array<{ code: string }>;
    const meterCodes = meterOnly.map((x) => x.code);
    check("getForSession('METER') → SCALE hariç", meterCodes.includes(codes.aMeter) && !meterCodes.includes(codes.aScale));

    check("getForSession(geçersiz kind) → 400",
      await expectStatus(400, () => svc.getForSession({ machineId: machineA.id, stationId: null }, "BADKIND")));

    void aScaleId; // (yaratıldı, allA içinde doğrulandı)
  } finally {
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    await prisma.workSession.deleteMany({ where: { device: { deviceId: noSessDeviceId } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { deviceId: noSessDeviceId } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
