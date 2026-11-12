// =============================================================================
// Test: Çalışma Oturumu (WorkSessionService) — open/close/takeover/idle/force-close
// Çalıştır: npx tsx scripts/test_work_session.ts
// Doğrulananlar:
//   1.  makineli open → aktif oturum; stationId makineden türetilir
//   2.  aynı cihaz yeni open → eski NEW_LOGIN ile kapanır
//   3.  başka cihaz dolu makineye teyitsiz open → 409 MACHINE_OCCUPIED
//   4.  confirmTakeover → eski oturum TAKEOVER ile kapanır, yeni açılır
//   5.  eşzamanlı çift open (boş makine) → tam biri kazanır (P2002 → 409)
//   6.  makinesiz istasyon (SHIPPING) oturumu → machineId null; ikinci cihaz da açabilir
//   7.  makinesi olan istasyona istasyon-oturumu → 400
//   8.  oturum açılamayan istasyon türü (SUBCONTRACTOR) → 400
//   9.  tembel idle: lastActivityAt eski → resolveActiveSession null + IDLE kapanış
//   10. closeForDevice LOGOUT idempotent
//   11. forceClose → ADMIN; ikinci forceClose → 409
//   12. current() → lastPlace son oturumun yerini hatırlar
//   13. resolveMachineByCode → tam eşleşme; bilinmeyen kod → 404
//   14. ⭐ places/current/resolve yer nesnesinde `isKursunStation` (KURSUN_DISPATCH_STATION_WHERE) + places `canInspect`:
//       kurşunsuz muayeneli PROCESS_QC → false/true (tablet "Kalite Kontrol" listesi), kurşun istasyonu → true
// =============================================================================
import prisma from "../src/lib/prisma";
import { WorkSessionService } from "../src/services/work-session.service";
import { resolveActiveSession } from "../src/services/helpers/work-session.helper";
import { KURSUN_DISPATCH_STATION_WHERE } from "../src/services/helpers/quality-station.helper";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

type SessionRow = { id: string; machineId: string | null; stationId: string; endReason: string | null };
async function sessionById(id: string): Promise<SessionRow | null> {
  return prisma.workSession.findUnique({
    where: { id },
    select: { id: true, machineId: true, stationId: true, endReason: true },
  }) as Promise<SessionRow | null>;
}

async function main() {
  const ts = Date.now();
  const user = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!user) throw new Error("admin kullanıcısı yok (npm run seed)");
  const tamburMachine = await prisma.machine.findFirst({
    where: { code: "TAMBUR-M1", isActive: true },
    select: { id: true, stationId: true, code: true },
  });
  const kk1Machine = await prisma.machine.findFirst({
    where: { code: "KK1-M1", isActive: true },
    select: { id: true, stationId: true },
  });
  const sevkStation = await prisma.station.findFirst({
    where: { code: "SEVK_1", isActive: true },
    select: { id: true, kind: true },
  });
  const fasonStation = await prisma.station.findFirst({
    where: { kind: "SUBCONTRACTOR", isActive: true },
    select: { id: true },
  });
  if (!tamburMachine || !kk1Machine || !sevkStation || !fasonStation) {
    throw new Error("Seed master-data eksik (TAMBUR-M1 / KK1-M1 / SEVK_1 / fason istasyon)");
  }
  if (sevkStation.kind !== "SHIPPING") {
    throw new Error("SEVK_1 kind SHIPPING değil — migration/seed uygulanmamış");
  }

  // Test cihazları (APPROVED — oturum açma şartı)
  const mkDevice = (n: number) =>
    prisma.device.create({
      data: { deviceId: `test-ws-${ts}-${n}`, name: `TEST WS Cihaz ${n}`, status: "APPROVED", kind: "TABLET" },
      select: { id: true },
    });
  const [dev1, dev2, dev3, dev4] = await Promise.all([mkDevice(1), mkDevice(2), mkDevice(3), mkDevice(4)]);
  // Oturum açılamayan tür testi için SUBCONTRACTOR istasyonuna geçici makine
  const fasonMachine = await prisma.machine.create({
    data: { stationId: fasonStation.id, code: `TST-WS-FASON-${ts}`, name: "TEST WS FASON MAKİNE" },
    select: { id: true },
  });

  const deviceIds = [dev1.id, dev2.id, dev3.id, dev4.id];
  // 14) kurşunsuz, muayeneli PROCESS_QC istasyonu (tablet "Kalite Kontrol" listesi) + makinesi.
  const qcStation = await prisma.station.create({
    data: { code: `TST-WS-QC-${ts}`, name: "TEST WS DETAYLI KK", type: "INTERNAL", kind: "PROCESS_QC", inspectionEnabled: true, appliesQuality: true, appliesProperty: false },
    select: { id: true },
  });
  const qcMachine = await prisma.machine.create({
    data: { stationId: qcStation.id, code: `TST-WS-QC-M-${ts}`, name: "TEST WS QC MAKİNE" },
    select: { id: true, code: true },
  });
  // 14c) kurşun istasyonu: KURSUN özelliği AUTO + PROCESS_QC (yer listesinde görünsün diye aktif makineli).
  const kursunProp = await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } });
  const kursunStation = kursunProp
    ? await prisma.station.create({
        data: { code: `TST-WS-KR-${ts}`, name: "TEST WS KURŞUN", type: "INTERNAL", kind: "PROCESS_QC", inspectionEnabled: true, appliesQuality: true, appliesProperty: true },
        select: { id: true },
      })
    : null;
  if (kursunStation && kursunProp) await prisma.stationProperty.create({ data: { stationId: kursunStation.id, propertyId: kursunProp.id, mode: "AUTO" } });
  const kursunMachine = kursunStation
    ? await prisma.machine.create({ data: { stationId: kursunStation.id, code: `TST-WS-KR-M-${ts}`, name: "TEST WS KURŞUN MAKİNE" }, select: { id: true } })
    : null;

  // 9. adım (tembel idle) DB'deki idle-timeout ayarından bağımsız olmalı: ambient
  // bir systemSetting (0 = kapalı, ya da >11 saat) testi bayatlatırdı. Bilinen küçük
  // bir değere sabitle, finally'de eski değere döndür (emsal: test_roll_relabel_context 5b).
  const IDLE_KEY = "workSession.idleTimeoutMinutes";
  let prevIdle: { value: unknown } | null | undefined;

  try {
    // 1) makineli open — stationId makineden türetilir
    const s1 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, machineId: tamburMachine.id });
    const s1row = s1.data as { id: string; machineId: string; stationId: string };
    check("makineli open → aktif oturum", !!s1row.id);
    check("stationId makineden türetildi", s1row.stationId === tamburMachine.stationId);

    // 2) aynı cihaz yeni open → eski NEW_LOGIN
    const s2 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, machineId: kk1Machine.id });
    const s2row = s2.data as { id: string };
    const s1after = await sessionById(s1row.id);
    check("aynı cihaz yeni open → eski NEW_LOGIN", s1after?.endReason === "NEW_LOGIN");

    // 3) başka cihaz dolu makineye teyitsiz open → 409 MACHINE_OCCUPIED
    await expectErr("dolu makine teyitsiz → MACHINE_OCCUPIED", "başka bir oturum açık", () =>
      WorkSessionService.open({ userId: user.id, deviceRowId: dev2.id, machineId: kk1Machine.id }));

    // 4) confirmTakeover → eski TAKEOVER ile kapanır
    const s3 = await WorkSessionService.open({
      userId: user.id, deviceRowId: dev2.id, machineId: kk1Machine.id, confirmTakeover: true,
    });
    const s2after = await sessionById(s2row.id);
    check("confirmTakeover → eski oturum TAKEOVER", s2after?.endReason === "TAKEOVER");
    check("devralan cihazın oturumu aktif", !!(s3.data as { id: string }).id);

    // 5) eşzamanlı çift open (boş makine) → tam biri kazanır
    await WorkSessionService.closeForDevice(dev2.id); // KK1-M1'i boşalt
    const race = await Promise.allSettled([
      WorkSessionService.open({ userId: user.id, deviceRowId: dev3.id, machineId: kk1Machine.id }),
      WorkSessionService.open({ userId: user.id, deviceRowId: dev4.id, machineId: kk1Machine.id }),
    ]);
    const wins = race.filter((r) => r.status === "fulfilled").length;
    const losses = race.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message.includes("tekrar deneyin"),
    ).length;
    const occupied = race.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message.includes("başka bir oturum açık"),
    ).length;
    // ⚠️ İKİ AYRI YÜKLEM (2026-09-13). Eskiden tek satırdı ve İKİ SONUCU DA kabul
    // ediyordu (`wins===1 && losses+occupied===1`). Davranış olarak doğruydu —
    // ikisi de 409 — ama iddia GEVŞEKTİ: çağrılar hiç ÖRTÜŞMESE bile ikincisi
    // precheck'e takılıp MACHINE_OCCUPIED alır ve satır YEŞİL geçer. Yani
    // pencereyi açmayı bozan bir regresyon GÖRÜNMEZ olurdu.
    check("§5a eşzamanlı open → tam biri kazanır (davranış)", wins === 1 && losses + occupied === 1,
      `wins=${wins} p2002=${losses} occupied=${occupied}`);

    // ⭐ PENCERE KANITI — burada `pg_blocking_pids` GEREKTİRMEZ, ama SEBEBİ
    // "P2002 alındı" DEĞİL: **bu akışta iki durum FARKLI kod üretiyor.**
    //   örtüşmedi → ikinci çağrı precheck'e takılır → MACHINE_OCCUPIED
    //   örtüştü   → ikisi de precheck'ten geçer → INSERT → P2002 → SESSION_RACE
    // İki sonuç AYRIŞTIĞI için kod tanık olabiliyor.
    //
    // ⚠️ GENELLEŞTİRME SINIRI (01'in P2 ölçümü, 2026-09-13 — bende yoktu):
    // ***Kaybedenin hata kodu, ancak ÖRTÜŞMEYEN durumda FARKLI bir sonuç
    // üretiyorsa pencere tanığıdır.*** `machine_runs`ta böyle bir ayırt edici
    // YOK (servis yok, iki INSERT doğrudan sedde çarpıyor) ⇒ orada `p2002 === 1`
    // yalnız SEDİN çalıştığını kanıtlar, ÖRTÜŞMEYİ değil. Ayırt edici yoksa ya
    // gate-tx kurulur (`68a0b06d`) ya pencerenin ölçülmediği BEYAN edilir.
    // ⇒ Bu bölümü başka bir bekçiye kopyalamadan önce sor: *"örtüşmeyen durumda
    //   BAŞKA bir kod geliyor mu?"* Gelmiyorsa kod tanık DEĞİLDİR.
    //
    // Ölçüldü 2026-09-13: üç ardışık koşumda 3/3 `p2002=1`.
    // ⇒ Kurulamazsa bu bir YÜKLEM SONUCU DEĞİL ÖLÇÜM ARIZASIDIR: sed yolu
    //   ölçülmemiştir ve §5a'nın yeşili onu kapsamaz.
    if (losses === 1) {
      check("§5b ⭐ PENCERE KURULDU — kaybeden P2002 aldı (sed yolu BASILDI)", true,
        "ikisi de precheck'ten geçti, partial unique → 409 SESSION_RACE");
    } else {
      fail++;
      console.log(
        `❌ §5b YARIŞ ÖLÇÜLMEDİ — kaybeden precheck'e takıldı (occupied=${occupied}), ` +
          `sed yolu (P2002 → SESSION_RACE) BASILMADI. §5a'nın yeşili bu yolu KAPSAMAZ; ` +
          `sonuç yorumlanamaz.`,
      );
    }

    // 6) makinesiz istasyon (SHIPPING) oturumu — farklı cihaz açabilir; ancak AYNI
    //    operatör "tek yer" kuralıyla ikinci cihazda açınca öncekini (dev1) düşürür.
    const st1 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, stationId: sevkStation.id });
    const st1id = (st1.data as { id: string; machineId: string | null }).id;
    check("istasyon-oturumu → machineId null", (st1.data as { machineId: string | null }).machineId === null);
    const st2 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev2.id, stationId: sevkStation.id });
    check("aynı istasyonda ikinci cihaz da açabilir", !!(st2.data as { id: string }).id);
    // Bir operatör = tek yer: st2 açılınca aynı kullanıcının dev1'deki st1'i NEW_LOGIN ile kapanır.
    check("tek-yer: aynı operatör 2. cihazda açınca öncekini kapatır",
      (await sessionById(st1id))?.endReason === "NEW_LOGIN");

    // 7) makinesi olan istasyona istasyon-oturumu → 400
    await expectErr("makineli istasyona istasyon-oturumu reddi", "makine seçilerek", () =>
      WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, stationId: tamburMachine.stationId }));

    // 8) oturum açılamayan tür (SUBCONTRACTOR makinesi) → 400
    await expectErr("SUBCONTRACTOR istasyonunda oturum reddi", "istasyon türünde", () =>
      WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, machineId: fasonMachine.id }));

    // 9) tembel idle: idle-timeout'u 20 dk'ya sabitle, lastActivityAt'i 11 saat geriye çek
    prevIdle = await prisma.systemSetting.findUnique({ where: { key: IDLE_KEY }, select: { value: true } });
    await prisma.systemSetting.upsert({ where: { key: IDLE_KEY }, create: { key: IDLE_KEY, value: 20 }, update: { value: 20 } });
    const idleSession = await WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, machineId: tamburMachine.id });
    const idleId = (idleSession.data as { id: string }).id;
    await prisma.workSession.update({
      where: { id: idleId },
      data: { lastActivityAt: new Date(Date.now() - 11 * 60 * 60 * 1000) },
    });
    const resolved = await resolveActiveSession(dev1.id);
    const idleAfter = await sessionById(idleId);
    check("idle oturum → resolveActiveSession null", resolved === null);
    check("idle oturum → IDLE ile kapandı", idleAfter?.endReason === "IDLE");

    // 10) closeForDevice idempotent. (dev2'nin önceki oturumu 9. adımda "tek yer"
    //     kuralıyla kapandığı için önce dev2'de taze bir oturum açıyoruz.)
    await WorkSessionService.open({ userId: user.id, deviceRowId: dev2.id, stationId: sevkStation.id });
    const c1 = await WorkSessionService.closeForDevice(dev2.id);
    const c2 = await WorkSessionService.closeForDevice(dev2.id);
    check("closeForDevice → closed:true", c1.data.closed === true);
    check("closeForDevice idempotent → closed:false", c2.data.closed === false);

    // 11) forceClose → ADMIN; ikinci çağrı 409
    const fc = await WorkSessionService.open({ userId: user.id, deviceRowId: dev3.id, machineId: tamburMachine.id, confirmTakeover: true });
    const fcId = (fc.data as { id: string }).id;
    await WorkSessionService.forceClose(fcId, user.id);
    const fcAfter = await sessionById(fcId);
    check("forceClose → ADMIN", fcAfter?.endReason === "ADMIN");
    await expectErr("ikinci forceClose → 409", "zaten kapalı", () => WorkSessionService.forceClose(fcId, user.id));

    // 12) current() → lastPlace son yeri hatırlar (dev3'ün son oturumu TAMBUR-M1)
    const cur = await WorkSessionService.current(dev3.id);
    const curData = cur.data as { active: unknown; lastPlace: { machine: { code: string } | null } | null };
    check("current → aktif oturum yok", curData.active === null);
    check("current → lastPlace = TAMBUR-M1", curData.lastPlace?.machine?.code === tamburMachine.code);

    // 13) resolveMachineByCode
    const rm = await WorkSessionService.resolveMachineByCode(tamburMachine.code);
    check("resolveMachineByCode → makine + istasyon", (rm.data as { id: string }).id === tamburMachine.id);
    await expectErr("bilinmeyen makine kodu → 404", "bulunamadı", () =>
      WorkSessionService.resolveMachineByCode(`YOK-${ts}`));

    // 14) yer nesnelerinde isKursunStation + canInspect (tablet Kurşun ↔ Kalite Kontrol ayrımı)
    type Place = { id: string; isKursunStation?: boolean; canInspect?: boolean; inspectionEnabled?: unknown };
    const places = (await WorkSessionService.places()).data as Place[];
    const qcPlace = places.find((p) => p.id === qcStation.id);
    check("§14a ⭐ kurşunsuz PROCESS_QC → isKursunStation=false, canInspect=true",
      qcPlace?.isKursunStation === false && qcPlace?.canInspect === true, JSON.stringify(qcPlace ?? null));
    check("§14b places ham inspectionEnabled sızdırmaz", places.every((p) => !("inspectionEnabled" in p)));
    // Kendi kurşun istasyonu fikstürü (KURSUN AUTO + akış): ortamdaki istasyonlara bağlı kalmaz.
    check("§14c fikstür: KURSUN AUTO'lu istasyon yüklemi karşılar",
      !!kursunStation && (await prisma.station.count({ where: { id: kursunStation.id, ...KURSUN_DISPATCH_STATION_WHERE } })) === 1);
    check("§14c ⭐ kurşun istasyonu → isKursunStation=true", !!kursunStation && places.find((p) => p.id === kursunStation.id)?.isKursunStation === true);
    check("§14d her yerde isKursunStation boolean", places.every((p) => typeof p.isKursunStation === "boolean"));
    const qcOpen = await WorkSessionService.open({ userId: user.id, deviceRowId: dev4.id, machineId: qcMachine.id, confirmTakeover: true });
    check("§14e open yanıtı istasyonu isKursunStation=false",
      (qcOpen.data as { station: Place }).station.isKursunStation === false);
    const qcCur = (await WorkSessionService.current(dev4.id)).data as { active: { station: Place } | null; lastPlace: { station: Place } | null };
    check("§14f current active + lastPlace istasyonu isKursunStation=false",
      qcCur.active?.station.isKursunStation === false && qcCur.lastPlace?.station.isKursunStation === false);
    const qcRm = (await WorkSessionService.resolveMachineByCode(qcMachine.code)).data as { station: Place };
    check("§14g resolveMachineByCode istasyonu isKursunStation=false", qcRm.station.isKursunStation === false);
  } finally {
    // idle-timeout ayarını eski değerine döndür (9. adım geçici sabitlemişti).
    if (prevIdle !== undefined) {
      if (prevIdle === null) await prisma.systemSetting.delete({ where: { key: IDLE_KEY } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key: IDLE_KEY }, data: { value: prevIdle.value as never } }).catch(() => {});
    }
    await prisma.workSession.deleteMany({ where: { deviceId: { in: deviceIds } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: [fasonMachine.id, qcMachine.id, ...(kursunMachine ? [kursunMachine.id] : [])] } } }).catch(() => {});
    if (kursunStation) await prisma.stationProperty.deleteMany({ where: { stationId: kursunStation.id } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: [qcStation.id, ...(kursunStation ? [kursunStation.id] : [])] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
