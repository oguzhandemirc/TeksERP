// =============================================================================
// BEKÇİ — TEZGAH ALARMI → BİLDİRİM KANALI (N2-ALARM; plan §3.11, `test_bildirim_motoru`nun "alarm" bölümü)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_alarm
// =============================================================================
//   §a ⭐ LISTED: donmuş alıcılar = gelen kutusu alıcıları (ne eksik ne fazla; izinli ama listede olmayan ALMAZ)
//   §b BY_PERMISSION: izin sahipleri (görme süzgeci) alır, izinsiz almaz
//   §c RESOLVED → kutu satırı resolvedAt + okundu · §d alarm tx'i geri alınınca outbox YOK
//   §e zil `alarm` çalar (alarmRev artar, kutu rev'i değil) · §f reason: nöbet → NOBET, izin → ALARM_ALICISI
//   §g liste ∩ görme süzgeci (listedeki ama izni düşmüş kullanıcı ALMAZ) · §h üstlenme = GUNCELLENDI (sayaç
//   artmaz, okunma sıfırlanmaz, payload durumu taşır) · §i yeni kademe = OLAY (sayaç artar) · §j rozet ALARM'ı
//   saymaz, alarmAcik sayar · §k bayrak kapalı → alarm yazıcıları outbox'a hiç yazmaz
//
// NEGATİF SONDALAR (2026-10-25, md5 ile birebir geri alındı): ① çözücü LISTED kipte de izin sahiplerini
// döndürdü (yeniden çözme) → §a/§f/§g/§h ❌ (11/4) · ② `emitLoomAlarmNotificationTx` outbox'a `tx` yerine kök istemciyle
// yazdı (tx dışı) → §d ❌ (14/1) · ③ hub kancası alarm kullanıcılarını `kutu` olarak çaldı → §e ❌ (14/1).
// Global ayar yazar (bildirim + üretim/tezgah bayrakları); bulduğu değerlere `finally`de döner. Tezgah alarm
// kapısı yalnız dağıtım anında açılır (aynı DB'deki sunucu zamanlayıcısı fikstüre dokunmasın).
// =============================================================================
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { LoomAlarmRecipientSource, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { ackLoomAlarm, runLoomAlarmOnce } from "../src/services/loom-alarm.service";
import { createHallShiftResponsible } from "../src/services/loom-alarm-duty.service";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { bellVersion } from "../src/services/notification-bell-hub";
import { inboxSummary } from "../src/services/notification-inbox.service";
import {
  emitLoomAlarmNotificationTx, LOOM_ALARM_NOTIFICATION_KIND, RECIPIENT_SOURCE_REASON, registerLoomAlarmRecipientResolver,
} from "../src/services/notification-sources/alarm";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const MIN = 60_000;
const ek = Date.now().toString(36);
const ids = { stations: [] as string[], looms: [] as string[], presets: [] as string[], users: [] as string[], shiftDef: "", shifts: [] as string[] };
const YONETILEN = [
  SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED,
  SETTING_KEYS.TEZGAH_ALARM_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES,
];
const ilk = new Map<string, unknown>();

async function ayar(key: string, value: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Kuyruğu boşalt; tezgah alarm kapısı yalnız bu sırada açık (görme süzgeci kapıyı okur). */
async function dagit(): Promise<void> {
  await ayar(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  try {
    for (let i = 0; i < 50; i++) if ((await runNotificationDispatchOnce()).processed === 0) break;
  } finally {
    await ayar(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  }
}

async function kutu(alarmId: string) {
  return prisma.notificationInbox.findMany({ where: { groupKey: `alarm:${alarmId}` }, orderBy: { userId: "asc" } });
}
const benim = <T extends { userId: string }>(rows: T[]): T[] => rows.filter((r) => ids.users.includes(r.userId));
const kume = (xs: string[]) => [...xs].sort().join(",");

async function main(): Promise<void> {
  console.log("\n=== Bildirim — tezgah alarmı kanalı (donmuş alıcı · kapanış · alarmRev · reason) ===\n");
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  try {
    await govde();
  } finally {
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
  }
}

async function govde(): Promise<void> {
  registerLoomAlarmRecipientResolver();
  check("§f0 saf: kaynak → reason (HALL_SHIFT/DUTY_OVERRIDE/USER → NOBET, PERMISSION → ALARM_ALICISI)",
    RECIPIENT_SOURCE_REASON[LoomAlarmRecipientSource.HALL_SHIFT] === "NOBET" && RECIPIENT_SOURCE_REASON[LoomAlarmRecipientSource.DUTY_OVERRIDE] === "NOBET" &&
    RECIPIENT_SOURCE_REASON[LoomAlarmRecipientSource.USER] === "NOBET" && RECIPIENT_SOURCE_REASON[LoomAlarmRecipientSource.PERMISSION] === "ALARM_ALICISI");

  await ayar(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayar(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayar(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayar(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);
  await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  const liveRules = await prisma.loomAlarmTierRule.count({ where: { revokedAt: null } });
  check("§0 ortam: etkin kademe kuralı YOK (kurallar global; varsa ölçüm anlamsız)", liveRules === 0, String(liveRules));

  const admin = await testActorId();
  // Çapa GERÇEK şimdi: aynı DB'deki sunucu turu araya girse de aynı kademeyi çaldırır (sed tek satır bırakır).
  const simdi = new Date(Math.floor(Date.now() / MIN) * MIN);
  const at = (dk: number) => new Date(simdi.getTime() + dk * MIN);
  const def = await prisma.shiftDefinition.create({
    data: { code: `B${ek.slice(-7)}`.toUpperCase(), name: `TEST-BAL vardiya ${ek}`, startMinute: 0, durationMinutes: 480, isActive: true },
  });
  ids.shiftDef = def.id;
  const I1 = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-03-01T00:00:00Z"), startsAt: at(-180), endsAt: at(300) } });
  ids.shifts.push(I1.id);
  const hol = async (n: string): Promise<string> => {
    const s = await prisma.station.create({ data: { name: `TEST-BAL-HOL${n}-${ek}`, code: `TEST-BAL-H${n}-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
    ids.stations.push(s.id);
    return s.id;
  };
  const H1 = await hol("1");
  const H2 = await hol("2");
  const H3 = await hol("3");
  const P = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-BAL ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  ids.presets.push(P.id);
  const perm = new Map((await prisma.permission.findMany({ where: { code: { in: ["loom:alarm-view", "loom:alarm-ack", "mobile:tezgah-uyari"] } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
  const kisi = async (n: string, codes: string[]): Promise<string> => {
    const u = await prisma.user.create({ data: { username: `test-bal-${n}-${ek}`, fullName: `TEST-BAL ${n} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    for (const c of codes) await prisma.userPermission.create({ data: { userId: u.id, permissionId: perm.get(c)! } });
    return u.id;
  };
  const ahmet = await kisi("ahmet", ["loom:alarm-view", "loom:alarm-ack"]);
  const veli = await kisi("veli", ["loom:alarm-view"]);
  const mehmet = await kisi("mehmet", ["loom:alarm-view"]);
  const mobil = await kisi("mobil", ["mobile:tezgah-uyari"]);
  const yetkisiz = await kisi("yetkisiz", ["loom:alarm-ack"]);

  let n = 0;
  const durus = async (hall: string): Promise<{ machineId: string; stopId: string }> => {
    n += 1;
    const m = await prisma.machine.create({ data: { stationId: hall, name: `TEST-BAL-T${n}-${ek}`, code: `TEST-BAL-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
    ids.looms.push(m.id);
    const stop = (await openManualStop({ machineId: m.id, startedAt: at(-12), reasonCode: P.code })).data;
    return { machineId: m.id, stopId: stop.id };
  };
  const tur = (machineId: string, now: Date) => runLoomAlarmOnce({ now, onlyMachineIds: [machineId], enabled: true });
  const alarmOf = async (machineId: string) => (await prisma.loomAlarm.findFirstOrThrow({ where: { machineId }, select: { id: true } })).id;

  // ── §a/§f LISTED: hol × vardiya K1 sorumlusu Ahmet ──────────────────────────
  await createHallShiftResponsible({ stationId: H1, shiftDefinitionId: def.id, tier: 1, userId: ahmet, clientToken: randomUUID() }, admin);
  const d1 = await durus(H1);
  const rev0 = bellVersion(ahmet);
  await tur(d1.machineId, at(0));
  const a1 = await alarmOf(d1.machineId);
  const outbox1 = await prisma.notificationOutbox.findMany({ where: { kind: LOOM_ALARM_NOTIFICATION_KIND, subjectId: a1 } });
  check("§a0 alarm doğuşu aynı tx'te TEK outbox satırı (OLAY, olayId taşır)",
    outbox1.length === 1 && outbox1[0]!.phase === "OLAY" && typeof (outbox1[0]!.payload as { olayId?: unknown }).olayId === "string", JSON.stringify(outbox1.map((o) => o.phase)));
  await dagit();
  const k1 = benim(await kutu(a1));
  check("§a ⭐ LISTED: gelen kutusu alıcıları = donmuş liste [Ahmet] (izinli Veli/Mehmet/mobil ALMAZ)", kume(k1.map((r) => r.userId)) === ahmet, kume(k1.map((r) => r.userId)));
  check("§f ⭐ nöbet kaynağı (HALL_SHIFT) → reason NOBET · klass ALARM", k1[0]?.reason === "NOBET" && k1[0]?.klass === "ALARM", `${k1[0]?.reason}/${k1[0]?.klass}`);
  const rev1 = bellVersion(ahmet);
  check("§e ⭐ zil `alarm` çaldı: alarmRev +1, kutu rev'i değişmedi", rev1.alarmRev === rev0.alarmRev + 1 && rev1.rev === rev0.rev, `${JSON.stringify(rev0)} → ${JSON.stringify(rev1)}`);

  // ── §j rozet ───────────────────────────────────────────────────────────────
  await ayar(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  const oz = await inboxSummary({ userId: ahmet, permissions: ["loom:alarm-view", "loom:alarm-ack"] });
  await ayar(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  check("§j rozet (okunmamış) ALARM'ı saymaz; alarmAcik sayar",
    oz.enabled && oz.okunmamis === 0 && oz.alarmAcik === 1, JSON.stringify({ ...oz, epoch: undefined }));

  // ── §h üstlenme = GUNCELLENDI ──────────────────────────────────────────────
  await prisma.notificationInbox.updateMany({ where: { userId: ahmet, groupKey: `alarm:${a1}` }, data: { readAt: new Date() } });
  await ackLoomAlarm(a1, ahmet, randomUUID());
  await dagit();
  const k1h = benim(await kutu(a1));
  check("§h üstlenme → GUNCELLENDI: sayaç 1 kalır, okunma korunur, payload durum=ACKED",
    k1h.length === 1 && k1h[0]!.count === 1 && k1h[0]!.readAt !== null && (k1h[0]!.payload as { durum?: string }).durum === "ACKED",
    JSON.stringify(k1h.map((r) => [r.count, r.readAt !== null, (r.payload as { durum?: string }).durum])));

  // ── §i yeni kademe = OLAY (K2: sorumlusu yok → BY_PERMISSION) ──────────────
  await tur(d1.machineId, at(4));
  await dagit();
  const k1i = benim(await kutu(a1));
  const ah = k1i.find((r) => r.userId === ahmet);
  check("§i yeni kademe OLAY: K1 alıcısında sayaç 2 + okunmamış; K2 (BY_PERMISSION) izin sahiplerine yayıldı",
    ah?.count === 2 && ah.readAt === null && kume(k1i.map((r) => r.userId)) === kume([ahmet, veli, mehmet, mobil]),
    JSON.stringify(k1i.map((r) => [r.userId === ahmet ? "ahmet" : r.userId.slice(0, 4), r.count, r.reason])));

  // ── §b/§f BY_PERMISSION: sorumlusuz hol ────────────────────────────────────
  const d2 = await durus(H2);
  await tur(d2.machineId, at(0));
  const a2 = await alarmOf(d2.machineId);
  await dagit();
  const k2 = benim(await kutu(a2));
  check("§b ⭐ BY_PERMISSION: izin sahipleri (view ∨ mobil) alır, izinsiz ALMAZ",
    kume(k2.map((r) => r.userId)) === kume([ahmet, veli, mehmet, mobil]) && !k2.some((r) => r.userId === yetkisiz), String(k2.length));
  check("§f BY_PERMISSION → reason ALARM_ALICISI (nöbet dışı)", k2.length > 0 && k2.every((r) => r.reason === "ALARM_ALICISI"), kume(k2.map((r) => r.reason)));

  // ── §g liste ∩ görme süzgeci ───────────────────────────────────────────────
  await createHallShiftResponsible({ stationId: H3, shiftDefinitionId: def.id, tier: 1, userId: mehmet, clientToken: randomUUID() }, admin);
  const d3 = await durus(H3);
  await tur(d3.machineId, at(0));
  const a3 = await alarmOf(d3.machineId);
  await prisma.userPermission.deleteMany({ where: { userId: mehmet } });
  await dagit();
  const k3 = benim(await kutu(a3));
  check("§g ⭐ listede olup izni düşen kullanıcı ALMAZ (liste yetki genişletmez; kimse yeniden çözülmez)", k3.length === 0, kume(k3.map((r) => r.userId)));

  // ── §c RESOLVED ────────────────────────────────────────────────────────────
  await closeManualStop(d2.stopId, at(0));
  await tur(d2.machineId, at(2));
  const st = await prisma.loomAlarm.findUniqueOrThrow({ where: { id: a2 }, select: { state: true } });
  await dagit();
  const k2c = benim(await kutu(a2));
  check("§c ⭐ RESOLVED → bütün kutu satırları resolvedAt + okundu",
    st.state === "RESOLVED" && k2c.length === 4 && k2c.every((r) => r.resolvedAt !== null && r.readAt !== null), `${st.state} · ${k2c.length}`);

  // ── §d rollback ────────────────────────────────────────────────────────────
  const once = await prisma.notificationOutbox.count({ where: { subjectId: a1 } });
  await prisma.$transaction(async (tx) => {
    await emitLoomAlarmNotificationTx(tx, a1, { phase: "GUNCELLENDI" });
    throw new Error("geri-al");
  }).catch(() => undefined);
  check("§d ⭐ alarm tx'i geri alınınca outbox satırı YOK", (await prisma.notificationOutbox.count({ where: { subjectId: a1 } })) === once);

  // ── §k bayrak kapalı ───────────────────────────────────────────────────────
  await ayar(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, false);
  const d4 = await durus(H2);
  await tur(d4.machineId, at(0));
  const a4 = await alarmOf(d4.machineId);
  const ev4 = await prisma.loomAlarmEvent.count({ where: { alarmId: a4, kind: "RAISED" } });
  check("§k bayrak kapalı → alarm doğar (RAISED yazılır) ama outbox satırı YOK",
    ev4 === 1 && (await prisma.notificationOutbox.count({ where: { subjectId: a4 } })) === 0, String(ev4));
}

async function cleanup(): Promise<void> {
  try {
    const alarms = ids.looms.length ? (await prisma.loomAlarm.findMany({ where: { machineId: { in: ids.looms } }, select: { id: true } })).map((a) => a.id) : [];
    await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { subjectId: { in: alarms } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: alarms } } });
    await prisma.hallShiftResponsible.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { stationId: { in: ids.stations } }] } });
    if (ids.looms.length) {
      await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.looms } } });
      const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.looms } }, select: { id: true } });
      const sid = stops.map((s) => s.id);
      await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
      await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
      await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
      await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.looms } } });
      await prisma.machine.deleteMany({ where: { id: { in: ids.looms } } });
    }
    if (ids.presets.length) await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    if (ids.shifts.length) await prisma.shiftInstance.deleteMany({ where: { id: { in: ids.shifts } } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    if (ids.users.length) {
      await prisma.systemLog.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.userPermission.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
  } catch (err) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (err as Error).message);
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", err);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
