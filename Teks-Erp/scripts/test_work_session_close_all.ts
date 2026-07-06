// =============================================================================
// Test: kalıntı çalışma oturumu öz-onarımı + logout kapatma davranışı
// Çalıştır: npx tsx scripts/test_work_session_close_all.ts
// Saha bug'ı (2026-07-06): Ahmet çıkış yaptı ama oturumu açık kaldı (close kaçtı);
// Oğuzhan girince ayak izinde "Ahmet hâlâ aktif" göründü — üstelik Oğuzhan'ın
// damgaları Ahmet'in oturumuna yazılabilirdi (atıf bozulması).
// NOT: Cihaz başına TEK açık oturum DB'de partial unique ile zorunlu (P2002) —
// "birden çok açık oturum" senaryosu imkânsız; sorun kalıntının BENİMSENMESİYDİ.
// Doğrulananlar:
//   a. resolveActiveSession açık oturumu çözer.
//   b. getStampContext BAŞKA kullanıcının oturumunu benimsemez → NEW_LOGIN kapatır, null.
//   c. current(device, yeniKullanıcı) kalıntıyı NEW_LOGIN kapatır, active=null döner
//      (lastPlace korunur → yer önerisi yeni kullanıcı adına açılır).
//   d. current(device, aynıKullanıcı) oturumu aynen döndürür (öz-onarım tetiklenmez).
//   e. closeForDevice cihazın açık oturumunu LOGOUT ile kapatır; ikinci çağrı
//      closed:false (idempotent) — updateMany deviceId-kapsamlı (kalıntı-güvenli).
// İzolasyon: TEST- prefix'li kendi fixture'ları; finally'de silinir.
// =============================================================================
import prisma from "../src/lib/prisma";
import { WorkSessionService } from "../src/services/work-session.service";
import { resolveActiveSession, getStampContext } from "../src/services/helpers/work-session.helper";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const userA = await prisma.user.create({
    data: { username: `TEST-wsa-${ts}`, passwordHash: "x", fullName: "TEST Ahmet" },
    select: { id: true },
  });
  const userB = await prisma.user.create({
    data: { username: `TEST-wsb-${ts}`, passwordHash: "x", fullName: "TEST Oğuzhan" },
    select: { id: true },
  });
  const device = await prisma.device.create({
    data: { deviceId: `TEST-wsc-dev-${ts}`, name: "TEST WS Tablet", status: "APPROVED" },
    select: { id: true },
  });
  const station = await prisma.station.create({
    data: { code: `TEST-WSC-${ts}`, name: "TEST KK1", type: "INTERNAL", kind: "RAW_QC" },
    select: { id: true },
  });

  const openForA = () =>
    prisma.workSession.create({
      data: { userId: userA.id, deviceId: device.id, stationId: station.id },
      select: { id: true },
    });
  const sessionIds: string[] = [];

  try {
    // --- a) Açık oturum çözülür ---
    const s1 = await openForA();
    sessionIds.push(s1.id);
    const resolved = await resolveActiveSession(device.id);
    check("a resolveActiveSession açık oturumu döner", resolved?.id === s1.id);

    // --- b) getStampContext başka kullanıcının oturumunu BENİMSEMEZ ---
    const stamp = await getStampContext({
      device: { id: device.id, kind: "TABLET" },
      user: { userId: userB.id },
    });
    const s1Row = await prisma.workSession.findUnique({
      where: { id: s1.id },
      select: { endedAt: true, endReason: true },
    });
    check("b1 farklı kullanıcı → stamp context null", stamp === null);
    check(
      "b2 kalıntı NEW_LOGIN ile kapandı",
      s1Row?.endedAt != null && s1Row.endReason === "NEW_LOGIN",
      `endReason=${s1Row?.endReason}`,
    );

    // --- c) current(device, YENİ kullanıcı) → kalıntı kapanır, active=null ---
    const s2 = await openForA();
    sessionIds.push(s2.id);
    const curB = (await WorkSessionService.current(device.id, userB.id)).data as {
      active: unknown;
      lastPlace: { station: { id: string } } | null;
    };
    const s2Row = await prisma.workSession.findUnique({
      where: { id: s2.id },
      select: { endedAt: true, endReason: true },
    });
    check("c1 yeni kullanıcıya active=null", curB.active === null);
    check(
      "c2 kalıntı NEW_LOGIN ile kapandı",
      s2Row?.endedAt != null && s2Row.endReason === "NEW_LOGIN",
    );
    check(
      "c3 lastPlace korunur (öneri yeni kullanıcı adına açılır)",
      curB.lastPlace?.station.id === station.id,
    );

    // --- d) current(device, AYNI kullanıcı) → oturum aynen döner ---
    const s3 = await openForA();
    sessionIds.push(s3.id);
    const curA = (await WorkSessionService.current(device.id, userA.id)).data as {
      active: { id: string } | null;
    };
    check("d aynı kullanıcı oturumunu geri alır", curA.active?.id === s3.id);

    // --- e) closeForDevice: LOGOUT kapatma + idempotent ---
    const close1 = await WorkSessionService.closeForDevice(device.id, "LOGOUT", userA.id);
    const s3Row = await prisma.workSession.findUnique({
      where: { id: s3.id },
      select: { endedAt: true, endReason: true },
    });
    const openLeft = await prisma.workSession.count({
      where: { deviceId: device.id, endedAt: null },
    });
    check("e1 closeForDevice closed:true", close1.data.closed === true);
    check("e2 oturum LOGOUT ile kapandı", s3Row?.endReason === "LOGOUT");
    check("e3 cihazda açık oturum kalmadı", openLeft === 0, `açık=${openLeft}`);
    const close2 = await WorkSessionService.closeForDevice(device.id, "LOGOUT", userA.id);
    check("e4 ikinci close closed:false (idempotent)", close2.data.closed === false);
  } finally {
    await prisma.workSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: station.id } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: device.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
