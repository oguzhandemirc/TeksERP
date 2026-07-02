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
// =============================================================================
import prisma from "../src/lib/prisma";
import { WorkSessionService } from "../src/services/work-session.service";
import { resolveActiveSession } from "../src/services/helpers/work-session.helper";

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
    // Yarış zamanlamasına göre kaybeden P2002 (tekrar deneyin) YA DA precheck'e
    // takılıp MACHINE_OCCUPIED görebilir — ikisi de doğru davranış (409).
    const occupied = race.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message.includes("başka bir oturum açık"),
    ).length;
    check("eşzamanlı open → tam biri kazanır", wins === 1 && losses + occupied === 1,
      `wins=${wins} p2002=${losses} occupied=${occupied}`);

    // 6) makinesiz istasyon (SHIPPING) oturumu — çoklu cihaz serbest
    const st1 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, stationId: sevkStation.id });
    check("istasyon-oturumu → machineId null", (st1.data as { machineId: string | null }).machineId === null);
    const st2 = await WorkSessionService.open({ userId: user.id, deviceRowId: dev2.id, stationId: sevkStation.id });
    check("aynı istasyonda ikinci cihaz da açabilir", !!(st2.data as { id: string }).id);

    // 7) makinesi olan istasyona istasyon-oturumu → 400
    await expectErr("makineli istasyona istasyon-oturumu reddi", "makine seçilerek", () =>
      WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, stationId: tamburMachine.stationId }));

    // 8) oturum açılamayan tür (SUBCONTRACTOR makinesi) → 400
    await expectErr("SUBCONTRACTOR istasyonunda oturum reddi", "istasyon türünde", () =>
      WorkSessionService.open({ userId: user.id, deviceRowId: dev1.id, machineId: fasonMachine.id }));

    // 9) tembel idle: lastActivityAt'i 11 saat geriye çek (default 600 dk)
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

    // 10) closeForDevice idempotent
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
  } finally {
    await prisma.workSession.deleteMany({ where: { deviceId: { in: deviceIds } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: fasonMachine.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
