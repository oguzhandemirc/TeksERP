// =============================================================================
// BEKÇİ — DOKUMA ALARMI SORUMLU ATAMASI (A4: `loom-alarm-recipient.helper` · `loom-alarm-duty.service` · motor)
// =============================================================================
//   §1 sorumlusuz hol → RAISED `BY_PERMISSION`, alıcı satırı 0 (bugünkü davranış) · saf çözücü boş girdide BY_PERMISSION ·
//      nöbet penceresi seçimi (kapsayan; yoksa en son başlamış)
//   §2 hol × vardiya K1 sorumlusu → K1 RAISED LISTED [Ahmet/HALL_SHIFT]; K2 sorumlusu yok → K2 BY_PERMISSION
//   §3 DONMA: sorumlu kaldırılıp yenisi eklenince eski alarmın alıcısı değişmez, yeni alarm yeni kişiye ·
//      RAISED satırına UPDATE / alıcı satırına UPDATE-DELETE → mühür reddeder
//   §4 nöbet değişikliği: pencerede (hol, K1) değişiklik → yalnız o kişi (DUTY_OVERRIDE); kaldırılınca daimi sorumlu ·
//      bitmiş vardiyaya yazmak 400 · bitmiş vardiyanın değişikliğini kaldırmak 409 · çözüm turun anındaki vardiyadan
//   §5 uygunluk: alarmı göremeyen sorumlu düşer; hepsi düşerse BY_PERMISSION · atamada uyarı döner ·
//      yalnız mobil Uyarılar izinli sorumlu (`mobile:tezgah-uyari`) alıcı olur ve `mine`da görür · görme kapısı (uç) ile
//      alıcı uygunluğu TEK listeden (`ALARM_VIEW_PERMISSIONS`, statik)
//   §6 kural: K2 PERMISSION `loom:alarm-escalation` → efektif sahiplerin tamamı (bağımsız sorguyla) · USER kuralı eklenir ·
//      geçersiz kural 400 · kural kaldırılınca örtük kural döner
//   §7 mine: yüklem bağımsız JS hesabıyla birebir · başkası benimkini görmez · üst kademe yetkilisi K2'yi görür ·
//      özet şeridi listeyle aynı sayı · `mine=x` 400
//   §8 eşzamanlılık: iki tur aynı anda → tek RAISED, alıcı bir kez · aynı clientToken iki POST → tek satır ·
//      kaldırma yarışı → bir başarı bir 409
//   §9 UÇTAN UCA (HTTP, `bekci-http`): sorumlu tanımla → duruş hedefi aşar → K1 alıcısı RAISED'a donar → nöbet
//      değişikliği → yeni alarm yeni kişiye, eskisi DEĞİŞMEZ → mine doğru kişiye doğru liste → sorumlusuz holde
//      bugünkü davranış · gövdeden `createdById` 400 · tanım uçları spec-manage'siz 403
//
// NEGATİF SONDALAR (2026-10-11, yedek + sha256 ile geri alındı): ① çözücü boşta LISTED → §1a/§1d/§1e/§2c/§5b/§6f ❌ ·
// ② nöbet değişikliği daimi sorumlunun yerine geçmedi → §4a/§4b ❌ · ③ uygunluk süzgeci yok → §5b/§5c/§6a ❌ ·
// ④ mine'da izne göre dalı yok → §7a–§7d ❌ · ⑤ mine süzgeci düştü → §7a–§7d ❌ · ⑥ bitmiş vardiya kaldırma claim'inde
// yüklem yok → §4d ❌ · ⑦ çözüm gerçek saatle (tur anı değil) → §4e ❌ · ⑧ sorumlu gövdesi `.strict()`siz → §9b ❌.
// (2026-10-12) ⑨ `hasAlarmView` yalnız `loom:alarm-view` → §5e/§5f/§5g ❌ · ⑩ route VIEW'a elle literal kopya → §5h ❌.
//
// Global ayar yazar (`production.enabled` · `tezgah.enabled` · `tezgah.alarmEnabled` · `tezgah.escalationGraceMinutes`);
// bulduğu değere `finally`de döner. Alarm bayrağı §1–§8'de KAPALI (motor `enabled` ile koşar; yabancı sunucu
// zamanlayıcısı fikstüre dokunamaz), yalnız §9'da açılır — o bölümün fikstürü gerçek saatle kurulur ki hangi
// motor çaldırırsa çaldırsın sonuç aynı olsun. Kademe kuralı GLOBALDİR: §6 kurallarını hemen kaldırır, temizlik siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { LoomAlarmEventKind, LoomAlarmRecipientMode, LoomAlarmRecipientSource, LoomAlarmRuleRecipientKind, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { runLoomAlarmOnce } from "../src/services/loom-alarm.service";
import { getLoomAlarmDetail, listLoomAlarms } from "../src/services/loom-alarm-read.service";
import { listSchema } from "../src/routes/loom-alarm.routes";
import { pickDutyShifts, resolveAlarmRecipients, type RecipientConfig } from "../src/services/helpers/loom-alarm-recipient.helper";
import { matchesPermission } from "../src/middlewares/rbac.middleware";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readDbNow } from "../src/services/helpers/machine-run-open.helper";
import {
  createHallShiftDutyOverride, createHallShiftResponsible, createLoomAlarmTierRule, getLoomAlarmDutyOverview,
  revokeHallShiftDutyOverride, revokeHallShiftResponsible, revokeLoomAlarmTierRule,
} from "../src/services/loom-alarm-duty.service";
import { testActorId } from "./fixture-test-user";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";

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
const ATLAMA = atlamaDefteri(() => { fail++; });
const MIN = 60_000;
const ek = Date.now().toString(36);
const ids = {
  stations: [] as string[], looms: [] as string[], presets: [] as string[], users: [] as string[],
  shiftDef: "", extraDefs: [] as string[], shifts: [] as string[], rules: [] as string[],
};

const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ALARM_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES];
const ilk = new Map<string, unknown>();
async function ayarYaz(key: string, value: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function hataOf(p: Promise<unknown>): Promise<{ status: number | null; code: string | null }> {
  try {
    await p;
    return { status: null, code: "OK" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return { status: err.statusCode ?? null, code: err.details?.code ?? null };
  }
}

async function main(): Promise<void> {
  console.log("\n=== Dokuma alarmı — sorumlu ataması · nöbet değişikliği · kademe kuralı · donmuş alıcı ===\n");
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

interface Kisi { id: string; name: string; username: string; password: string }

async function govde(): Promise<void> {
  // ── §1a saf çözücü ─────────────────────────────────────────────────────────
  const bos: RecipientConfig = { rules: [], shifts: [], responsibles: [], overrides: [], grants: new Map() };
  const r0 = resolveAlarmRecipients(bos, "h", 1);
  check("§1a saf: tanımsız yapılandırma → BY_PERMISSION, alıcı yok", r0.mode === LoomAlarmRecipientMode.BY_PERMISSION && r0.recipients.length === 0, JSON.stringify(r0));
  const w = (id: string, bas: number, bit: number, iptal = false) => ({ id, shiftDefinitionId: id, startsAt: new Date(bas * MIN), endsAt: new Date(bit * MIN), isCancelled: iptal });
  const secim = (ws: ReturnType<typeof w>[], an: number) => pickDutyShifts(ws, new Date(an * MIN)).map((x) => x.id).join(",");
  check("§1b nöbet penceresi: anı kapsayan canlı vardiya(lar)", secim([w("a", 0, 100), w("b", 50, 150), w("c", 200, 300)], 60) === "a,b", secim([w("a", 0, 100), w("b", 50, 150)], 60));
  check("§1c nöbet penceresi: kapsayan yoksa en son başlamış canlı vardiya; iptal sayılmaz", secim([w("a", 0, 100), w("b", 110, 120, true), w("c", 200, 300)], 150) === "a", secim([w("a", 0, 100), w("b", 110, 120, true)], 150));

  // ── fikstür ────────────────────────────────────────────────────────────────
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);
  const liveRules = await prisma.loomAlarmTierRule.count({ where: { revokedAt: null } });
  check("§0 ortam: etkin kademe kuralı YOK (kurallar global; varsa ölçüm anlamsız)", liveRules === 0, String(liveRules));

  const admin = await testActorId();
  const simdi = new Date(Math.floor((Date.now() - 2 * 60 * MIN) / MIN) * MIN);
  const at = (dk: number) => new Date(simdi.getTime() + dk * MIN);
  const def = await prisma.shiftDefinition.create({
    data: { code: `S${ek.slice(-7)}`.toUpperCase(), name: `TEST-LAS vardiya ${ek}`, startMinute: 0, durationMinutes: 480, isActive: true },
  });
  ids.shiftDef = def.id;
  // I1 hem geçmiş çıpayı (simdi) hem gerçek şu anı kapsar (servis "bitmiş mi"yi DB saatiyle ölçer); I0 bitmiş.
  const I1 = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-02-01T00:00:00Z"), startsAt: at(-180), endsAt: at(300) } });
  const I0 = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-01-31T00:00:00Z"), startsAt: at(-600), endsAt: at(-300) } });
  ids.shifts.push(I1.id, I0.id);

  const hol = async (n: string): Promise<string> => {
    const s = await prisma.station.create({ data: { name: `TEST-LAS-HOL${n}-${ek}`, code: `TEST-LAS-H${n}-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
    ids.stations.push(s.id);
    return s.id;
  };
  const H1 = await hol("1");
  const H2 = await hol("2");
  const H3 = await hol("3");
  const P = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LAS ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  ids.presets.push(P.id);

  const perm = new Map((await prisma.permission.findMany({ where: { code: { in: ["loom:alarm-view", "loom:alarm-ack", "loom:alarm-escalation", "mobile:tezgah-uyari"] } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
  check("§0 ortam: alarm izinleri katalogda", perm.size === 4, String(perm.size));
  const kisi = async (n: string, codes: string[]): Promise<Kisi> => {
    const password = `Las-${randomUUID()}`;
    const username = `test-las-${n}-${ek}`;
    const u = await prisma.user.create({ data: { username, fullName: `TEST-LAS ${n} ${ek}`, passwordHash: await bcrypt.hash(password, 4), isActive: true }, select: { id: true, fullName: true } });
    ids.users.push(u.id);
    for (const c of codes) await prisma.userPermission.create({ data: { userId: u.id, permissionId: perm.get(c)! } });
    return { id: u.id, name: u.fullName, username, password };
  };
  const ahmet = await kisi("ahmet", ["loom:alarm-view", "loom:alarm-ack"]);
  const veli = await kisi("veli", ["loom:alarm-view"]);
  const mehmet = await kisi("mehmet", ["loom:alarm-view"]);
  const amir = await kisi("amir", ["loom:alarm-view", "loom:alarm-escalation"]);
  const yetkisiz = await kisi("yetkisiz", ["loom:alarm-ack"]);
  const yetkisizEsk = await kisi("eskyetkisiz", ["loom:alarm-escalation"]);
  const mobil = await kisi("mobil", ["mobile:tezgah-uyari"]);

  let n = 0;
  /** Holde açık duruş (dk önce, hedef 10 / pay 5 → K1 dk-10, K2 dk-5 sonra) — tezgah yalnız bu duruşa ait. */
  const durus = async (hall: string, dk = 12, an: Date = simdi): Promise<{ machineId: string; stopId: string }> => {
    n += 1;
    const m = await prisma.machine.create({ data: { stationId: hall, name: `TEST-LAS-T${n}-${ek}`, code: `TEST-LAS-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
    ids.looms.push(m.id);
    const stop = (await openManualStop({ machineId: m.id, startedAt: new Date(an.getTime() - dk * MIN), reasonCode: P.code })).data;
    return { machineId: m.id, stopId: stop.id };
  };
  const tur = (machineIds: string[], now: Date) => runLoomAlarmOnce({ now, onlyMachineIds: machineIds, enabled: true });
  /** Bir tezgahın alarmının RAISED satırları: kademe → { kip, alıcılar "ad/kaynak" }. */
  const raised = async (machineId: string) => {
    const a = await prisma.loomAlarm.findUnique({
      where: { stopEventId: (await prisma.machineStopEvent.findFirstOrThrow({ where: { machineId }, select: { id: true } })).id },
      select: { id: true, events: { where: { kind: LoomAlarmEventKind.RAISED }, select: { id: true, tier: true, recipientMode: true, recipients: { select: { userId: true, source: true } } }, orderBy: { tier: "asc" } } },
    });
    const by = new Map<number, { mode: string | null; list: string; eventId: string; count: number }>();
    for (const e of a?.events ?? []) {
      const list = e.recipients.map((r) => `${r.userId}/${r.source}`).sort().join(",");
      by.set(e.tier ?? 0, { mode: e.recipientMode, list, eventId: e.id, count: e.recipients.length });
    }
    return { alarmId: a?.id ?? null, by };
  };
  const tag = (k: Kisi, s: LoomAlarmRecipientSource) => `${k.id}/${s}`;

  // ── §1 sorumlusuz hol: bugünkü davranış ───────────────────────────────────
  const d1 = await durus(H2);
  await tur([d1.machineId], at(0));
  await tur([d1.machineId], at(4));
  const r1 = await raised(d1.machineId);
  check("§1d sorumlusuz hol: K1 RAISED BY_PERMISSION, alıcı satırı 0", r1.by.get(1)?.mode === "BY_PERMISSION" && r1.by.get(1)?.count === 0, JSON.stringify(r1.by.get(1)));
  check("§1e sorumlusuz hol: K2 RAISED BY_PERMISSION, alıcı satırı 0", r1.by.get(2)?.mode === "BY_PERMISSION" && r1.by.get(2)?.count === 0, JSON.stringify(r1.by.get(2)));

  // ── §2 hol × vardiya K1 sorumlusu ─────────────────────────────────────────
  const resA = await createHallShiftResponsible({ stationId: H1, shiftDefinitionId: def.id, tier: 1, userId: ahmet.id, clientToken: randomUUID() }, admin);
  check("§2a sorumlu atandı (uyarısız: alarmı görebiliyor)", resA.success && resA.data.user.canViewAlarms && !resA.warnings, JSON.stringify(resA.warnings));
  const d2 = await durus(H1);
  await tur([d2.machineId], at(0));
  await tur([d2.machineId], at(4));
  const r2 = await raised(d2.machineId);
  check("§2b K1 RAISED LISTED [Ahmet/HALL_SHIFT]", r2.by.get(1)?.mode === "LISTED" && r2.by.get(1)?.list === tag(ahmet, "HALL_SHIFT"), JSON.stringify(r2.by.get(1)));
  check("§2c K2 sorumlusu yok → K2 BY_PERMISSION", r2.by.get(2)?.mode === "BY_PERMISSION" && r2.by.get(2)?.count === 0, JSON.stringify(r2.by.get(2)));
  const det2 = await getLoomAlarmDetail(r2.alarmId!);
  check("§2d detay notifications: K1 LISTED [Ahmet], K2 BY_PERMISSION [] (RAISED sırasıyla)",
    det2.notifications.length === 2 && det2.notifications[0]!.tier === 1 && det2.notifications[0]!.mode === "LISTED" &&
    det2.notifications[0]!.recipients.map((x) => `${x.id}/${x.source}/${x.name}`).join() === `${ahmet.id}/HALL_SHIFT/${ahmet.name}` &&
    det2.notifications[1]!.tier === 2 && det2.notifications[1]!.mode === "BY_PERMISSION" && det2.notifications[1]!.recipients.length === 0,
    JSON.stringify(det2.notifications));
  const tlRaised = det2.timeline.filter((t) => t.kind === "RAISED");
  check("§2e zaman çizgisi RAISED girdileri aynı kip/alıcıyı taşır; diğerleri null",
    tlRaised.length === 2 && tlRaised[0]!.recipientMode === "LISTED" && tlRaised[0]!.recipients?.length === 1 &&
    det2.timeline.filter((t) => t.kind !== "RAISED").every((t) => t.recipientMode === null && t.recipients === null));

  // ── §3 donma ───────────────────────────────────────────────────────────────
  await revokeHallShiftResponsible(resA.data.id, admin);
  await createHallShiftResponsible({ stationId: H1, shiftDefinitionId: def.id, tier: 1, userId: veli.id, clientToken: randomUUID() }, admin);
  await tur([d2.machineId], at(6));
  const r2b = await raised(d2.machineId);
  check("§3a ⭐ eski alarmın alıcısı tanım değişince DEĞİŞMEZ (hâlâ Ahmet)", r2b.by.get(1)?.list === tag(ahmet, "HALL_SHIFT"), JSON.stringify(r2b.by.get(1)));
  const d3 = await durus(H1);
  await tur([d3.machineId], at(0));
  const r3 = await raised(d3.machineId);
  check("§3b yeni duruşun alarmı yeni sorumluya [Veli]", r3.by.get(1)?.list === tag(veli, "HALL_SHIFT"), JSON.stringify(r3.by.get(1)));
  const muhur = async (sql: string): Promise<boolean> => {
    try {
      await prisma.$executeRawUnsafe(sql);
      return false;
    } catch {
      return true;
    }
  };
  check("§3c mühür: RAISED satırının kipine UPDATE reddedilir", await muhur(`UPDATE loom_alarm_events SET "recipientMode" = 'BY_PERMISSION' WHERE id = '${r2.by.get(1)!.eventId}'`));
  check("§3d mühür: donmuş alıcıya UPDATE reddedilir", await muhur(`UPDATE loom_alarm_recipients SET "userId" = '${veli.id}' WHERE "eventId" = '${r2.by.get(1)!.eventId}'`));
  check("§3e mühür: donmuş alıcı DELETE reddedilir", await muhur(`DELETE FROM loom_alarm_recipients WHERE "eventId" = '${r2.by.get(1)!.eventId}'`));
  const rv2 = await hataOf(revokeHallShiftResponsible(resA.data.id, admin));
  check("§3f kaldırılmış sorumluyu yeniden kaldırmak 409 DUTY_ALREADY_REVOKED", rv2.status === 409 && rv2.code === "DUTY_ALREADY_REVOKED", JSON.stringify(rv2));
  check("§3g CHECK: revokedAt⇔revokedById çifti (yalnız damga yazılamaz)",
    await muhur(`UPDATE hall_shift_responsibles SET "revokedById" = NULL WHERE id = '${resA.data.id}'`));

  // ── §4 nöbet değişikliği ──────────────────────────────────────────────────
  const ov = await createHallShiftDutyOverride({ shiftInstanceId: I1.id, stationId: H1, tier: 1, userId: mehmet.id, note: "izinli", clientToken: randomUUID() }, admin);
  const d4 = await durus(H1);
  await tur([d4.machineId], at(0));
  const r4 = await raised(d4.machineId);
  check("§4a nöbet değişikliği: yalnız [Mehmet/DUTY_OVERRIDE], daimi sorumlu (Veli) YOK", r4.by.get(1)?.list === tag(mehmet, "DUTY_OVERRIDE"), JSON.stringify(r4.by.get(1)));
  await revokeHallShiftDutyOverride(ov.data.id, admin);
  const d5 = await durus(H1);
  await tur([d5.machineId], at(0));
  const r5 = await raised(d5.machineId);
  check("§4b değişiklik kaldırılınca sonraki alarm daimi sorumluya [Veli]; önceki alarm Mehmet'te kalır",
    r5.by.get(1)?.list === tag(veli, "HALL_SHIFT") && (await raised(d4.machineId)).by.get(1)?.list === tag(mehmet, "DUTY_OVERRIDE"), JSON.stringify(r5.by.get(1)));
  const ovBitmis = await hataOf(createHallShiftDutyOverride({ shiftInstanceId: I0.id, stationId: H1, tier: 1, userId: mehmet.id, clientToken: randomUUID() }, admin));
  check("§4c bitmiş vardiyaya nöbet değişikliği 400 SHIFT_INSTANCE_ENDED", ovBitmis.status === 400 && ovBitmis.code === "SHIFT_INSTANCE_ENDED", JSON.stringify(ovBitmis));
  const eskiOv = await prisma.hallShiftDutyOverride.create({ data: { shiftInstanceId: I0.id, stationId: H1, tier: 1, userId: mehmet.id, createdById: admin } });
  const rvBitmis = await hataOf(revokeHallShiftDutyOverride(eskiOv.id, admin));
  const eskiOvSonra = await prisma.hallShiftDutyOverride.findUnique({ where: { id: eskiOv.id }, select: { revokedAt: true } });
  check("§4d bitmiş vardiyanın değişikliğini kaldırmak 409 SHIFT_INSTANCE_ENDED, satır değişmez",
    rvBitmis.status === 409 && rvBitmis.code === "SHIFT_INSTANCE_ENDED" && eskiOvSonra?.revokedAt === null, JSON.stringify(rvBitmis));

  // Çözüm KADEMENİN ÇALDIĞI ANA göre: I2 yalnız çıpayı kapsar (gerçek şu anda bitmiş) — sorumlusu çıpadaki alarmı alır.
  const def2 = await prisma.shiftDefinition.create({
    data: { code: `R${ek.slice(-7)}`.toUpperCase(), name: `TEST-LAS vardiya2 ${ek}`, startMinute: 0, durationMinutes: 60, isActive: true },
  });
  ids.extraDefs.push(def2.id);
  const I2 = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def2.id, factoryDayKey: new Date("1999-02-02T00:00:00Z"), startsAt: at(-30), endsAt: at(30) } });
  ids.shifts.push(I2.id);
  const H4 = await hol("4");
  await createHallShiftResponsible({ stationId: H4, shiftDefinitionId: def2.id, tier: 1, userId: mehmet.id, clientToken: randomUUID() }, admin);
  const d4e = await durus(H4);
  await tur([d4e.machineId], at(0));
  check("§4e çözüm çalma anının vardiyasından (gerçek saatten değil): [Mehmet/HALL_SHIFT]", (await raised(d4e.machineId)).by.get(1)?.list === tag(mehmet, "HALL_SHIFT"));

  // ── §5 uygunluk ────────────────────────────────────────────────────────────
  const resY = await createHallShiftResponsible({ stationId: H3, shiftDefinitionId: def.id, tier: 1, userId: yetkisiz.id, clientToken: randomUUID() }, admin);
  check("§5a alarmı göremeyen kişiye atama yapılır ama uyarı döner", resY.success && (resY.warnings?.length ?? 0) === 1 && resY.data.user.canViewAlarms === false, JSON.stringify(resY.warnings));
  const d6 = await durus(H3);
  await tur([d6.machineId], at(0));
  const r6 = await raised(d6.machineId);
  check("§5b ⭐ tek sorumlu alarmı göremiyor → düşer → BY_PERMISSION", r6.by.get(1)?.mode === "BY_PERMISSION" && r6.by.get(1)?.count === 0, JSON.stringify(r6.by.get(1)));
  await createHallShiftResponsible({ stationId: H3, shiftDefinitionId: def.id, tier: 1, userId: ahmet.id, clientToken: randomUUID() }, admin);
  const d7 = await durus(H3);
  await tur([d7.machineId], at(0));
  const r7 = await raised(d7.machineId);
  check("§5c göremeyen düşer, gören kalır → [Ahmet]", r7.by.get(1)?.list === tag(ahmet, "HALL_SHIFT"), JSON.stringify(r7.by.get(1)));
  const ozet = await getLoomAlarmDutyOverview();
  check("§5d genel bakış uyarısı göremeyen atanmışı adıyla anar", ozet.warnings.some((x) => x.includes(yetkisiz.name)), JSON.stringify(ozet.warnings));
  const HM = await hol("M");
  const resM = await createHallShiftResponsible({ stationId: HM, shiftDefinitionId: def.id, tier: 1, userId: mobil.id, clientToken: randomUUID() }, admin);
  check("§5e ⭐ yalnız mobil Uyarılar izinli sorumlu alarmı görür: atama uyarısız", resM.success && resM.data.user.canViewAlarms && !resM.warnings, JSON.stringify(resM.warnings));
  const dM = await durus(HM);
  await tur([dM.machineId], at(0));
  const rM = await raised(dM.machineId);
  check("§5f ⭐ yalnız mobil izinli sorumlu K1 RAISED alıcısı → [Mobil/HALL_SHIFT]", rM.by.get(1)?.mode === "LISTED" && rM.by.get(1)?.list === tag(mobil, "HALL_SHIFT"), JSON.stringify(rM.by.get(1)));
  const mMob = await listLoomAlarms({ scope: "all", stationId: [HM], mine: { userId: mobil.id, canEscalate: false }, limit: 50 });
  const mVeliM = await listLoomAlarms({ scope: "all", stationId: [HM], mine: { userId: veli.id, canEscalate: false }, limit: 50 });
  check("§5g ⭐ yalnız mobil izinli sorumlu `mine`da kendi alarmını görür; alarm ona adreslidir (başkasının `mine`ında yok)",
    mMob.items.some((i) => i.id === rM.alarmId) && !mVeliM.items.some((i) => i.id === rM.alarmId), `${mMob.items.length} / ${mVeliM.items.length}`);
  const kodu = (f: string) => readFileSync(join(__dirname, "..", f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
  const rota = kodu("src/routes/loom-alarm.routes.ts");
  const ikiz = /requireAnyPermission\([^)]*"loom:alarm-view"/.test(rota); // ACT'in mobil ikizi eylem kapısıdır, görme değil
  check("§5h görme kapısı (VIEW · LIST) alıcı uygunluğuyla aynı listeden; uçta elle literal kopya yok",
    /const VIEW = requireAnyPermission\(\.\.\.ALARM_VIEW_PERMISSIONS\)/.test(rota) && /const LIST = requireAnyPermission\(\.\.\.ALARM_VIEW_PERMISSIONS,/.test(rota) && !ikiz);

  // ── §6 kademe kuralı ───────────────────────────────────────────────────────
  const kPerm = await createLoomAlarmTierRule({ tier: 2, kind: LoomAlarmRuleRecipientKind.PERMISSION, permissionCode: "loom:alarm-escalation", clientToken: randomUUID() }, admin);
  ids.rules.push(kPerm.data.id);
  const d8 = await durus(H1);
  await tur([d8.machineId], at(0));
  await tur([d8.machineId], at(4));
  const r8 = await raised(d8.machineId);
  // Bağımsız hesap: aktif, sistem dışı, (escalation ∧ view) efektif sahipleri.
  const anAt = at(4);
  const grants = await prisma.userPermission.findMany({
    where: { user: { isActive: true, isSystemAccount: false }, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: anAt } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: anAt } }] }] },
    select: { userId: true, permission: { select: { code: true } } },
  });
  const kod = new Map<string, string[]>();
  for (const g of grants) kod.set(g.userId, [...(kod.get(g.userId) ?? []), g.permission.code]);
  const beklenen = [...kod].filter(([, c]) => matchesPermission(c, "loom:alarm-escalation") && (matchesPermission(c, "loom:alarm-view") || matchesPermission(c, "mobile:tezgah-uyari"))).map(([u]) => `${u}/PERMISSION`).sort().join(",");
  check("§6a ⭐ K2 PERMISSION kuralı → efektif yetki sahiplerinin TAMAMI (görme yetkisi olmayan düşer)",
    r8.by.get(2)?.mode === "LISTED" && r8.by.get(2)?.list === beklenen && r8.by.get(2)!.list.includes(amir.id) && !r8.by.get(2)!.list.includes(yetkisizEsk.id),
    `${r8.by.get(2)?.count} alıcı`);
  check("§6b K2 kuralı K1'e dokunmaz: K1 hâlâ holün sorumlusu [Veli]", r8.by.get(1)?.list === tag(veli, "HALL_SHIFT"), JSON.stringify(r8.by.get(1)));
  const kUser = await createLoomAlarmTierRule({ tier: 2, kind: LoomAlarmRuleRecipientKind.USER, userId: veli.id, clientToken: randomUUID() }, admin);
  ids.rules.push(kUser.data.id);
  const d9 = await durus(H1);
  await tur([d9.machineId], at(0));
  await tur([d9.machineId], at(4));
  const r9 = await raised(d9.machineId);
  check("§6c USER kuralı eklenir: K2 listesinde Veli/USER + yetki sahipleri", r9.by.get(2)?.list.split(",").includes(tag(veli, "USER")) === true &&
    r9.by.get(2)?.list.split(",").includes(tag(amir, "PERMISSION")) === true, `${r9.by.get(2)?.count} alıcı`);
  const kotu1 = await hataOf(createLoomAlarmTierRule({ tier: 2, kind: LoomAlarmRuleRecipientKind.PERMISSION, permissionCode: "loom:uydurma", clientToken: randomUUID() }, admin));
  const kotu2 = await hataOf(createLoomAlarmTierRule({ tier: 1, kind: LoomAlarmRuleRecipientKind.USER, clientToken: randomUUID() }, admin));
  const kotu3 = await hataOf(createLoomAlarmTierRule({ tier: 1, kind: LoomAlarmRuleRecipientKind.HALL_SHIFT, userId: veli.id, clientToken: randomUUID() }, admin));
  check("§6d geçersiz kural 400 DUTY_RULE_INVALID (katalog dışı kod · kişisiz kişi kuralı · fazladan kişi)",
    [kotu1, kotu2, kotu3].every((k) => k.status === 400 && k.code === "DUTY_RULE_INVALID"), JSON.stringify([kotu1, kotu2, kotu3]));
  const cift = await hataOf(createLoomAlarmTierRule({ tier: 2, kind: LoomAlarmRuleRecipientKind.USER, userId: veli.id, clientToken: randomUUID() }, admin));
  check("§6e aynı kural ikinci kez 409 DUTY_ALREADY_ASSIGNED", cift.status === 409 && cift.code === "DUTY_ALREADY_ASSIGNED", JSON.stringify(cift));
  await revokeLoomAlarmTierRule(kPerm.data.id, admin);
  await revokeLoomAlarmTierRule(kUser.data.id, admin);
  const d10 = await durus(H1);
  await tur([d10.machineId], at(0));
  await tur([d10.machineId], at(4));
  const r10 = await raised(d10.machineId);
  check("§6f kurallar kalkınca örtük kural döner: K2 sorumlusuz → BY_PERMISSION; eski alarmın K2 listesi değişmez",
    r10.by.get(2)?.mode === "BY_PERMISSION" && (await raised(d9.machineId)).by.get(2)?.list === r9.by.get(2)?.list, JSON.stringify(r10.by.get(2)));

  // ── §7 mine ────────────────────────────────────────────────────────────────
  const halls = [H1, H2, H3];
  const tumu = await prisma.loomAlarm.findMany({
    where: { machine: { stationId: { in: halls } } },
    select: { id: true, events: { where: { kind: LoomAlarmEventKind.RAISED }, select: { tier: true, recipientMode: true, recipients: { select: { userId: true } } } } },
  });
  const bekle = (userId: string, esk: boolean) => tumu.filter((a) => a.events.some((e) =>
    (e.recipientMode === "LISTED" && e.recipients.some((r) => r.userId === userId)) ||
    (e.recipientMode !== "LISTED" && (e.tier === 1 || (e.tier === 2 && esk))))).map((a) => a.id).sort().join(",");
  const mineOf = async (userId: string, esk: boolean) => {
    const l = await listLoomAlarms({ scope: "all", stationId: halls, mine: { userId, canEscalate: esk }, limit: 200 });
    return { ids: l.items.map((i) => i.id).sort().join(","), total: l.summary.total, n: l.items.length };
  };
  const mA = await mineOf(ahmet.id, false);
  check("§7a ⭐ Ahmet mine = donmuş listesinde olduğu + izne göre K1 alarmları (bağımsız hesapla birebir)", mA.ids === bekle(ahmet.id, false) && mA.n > 0, `${mA.n} alarm`);
  check("§7b Ahmet'in kendi alarmı (§2) listede; Veli'nin (§3b) değil", mA.ids.includes(r2.alarmId!) && !mA.ids.includes(r3.alarmId!));
  const mV = await mineOf(veli.id, false);
  check("§7c Veli Ahmet'inkini görmez (§2), kendi alarmını görür (§3b)", !mV.ids.includes(r2.alarmId!) && mV.ids.includes(r3.alarmId!) && mV.ids === bekle(veli.id, false));
  const mM = await mineOf(amir.id, true);
  check("§7d üst kademe yetkilisi izne göre K2'yi görür (§1 sorumlusuz hol, K1 de BY_PERMISSION)", mM.ids === bekle(amir.id, true) && mM.ids.includes(r1.alarmId!));
  check("§7e özet şeridi listeyle aynı where (toplam = satır sayısı)", mA.total === mA.n && mV.total === mV.n && mM.total === mM.n, `${mA.total}/${mA.n} ${mV.total}/${mV.n}`);
  const sx = listSchema.safeParse({ mine: "x" });
  const s1 = listSchema.safeParse({ mine: "1" });
  check("§7f `mine` yalnız 1|true; başka değer 400 (şema reddi)", !sx.success && s1.success);

  // ── §8 eşzamanlılık ───────────────────────────────────────────────────────
  const d11 = await durus(H1);
  const ikiTur = await Promise.all([tur([d11.machineId], at(0)), tur([d11.machineId], at(0))]);
  const r11 = await raised(d11.machineId);
  const raisedSay = await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: d11.machineId }, kind: LoomAlarmEventKind.RAISED, tier: 1 } });
  check("§8a iki tur aynı anda → tek RAISED(1), alıcı bir kez", raisedSay === 1 && r11.by.get(1)?.count === 1 && r11.by.get(1)?.list === tag(veli, "HALL_SHIFT"), `${raisedSay} ${JSON.stringify(ikiTur)}`);
  const tok = randomUUID();
  const girdi = { stationId: H2, shiftDefinitionId: def.id, tier: 2 as const, userId: amir.id, clientToken: tok };
  const [p1, p2] = await Promise.all([createHallShiftResponsible(girdi, admin), createHallShiftResponsible(girdi, admin)]);
  const tokSay = await prisma.hallShiftResponsible.count({ where: { clientToken: tok } });
  check("§8b aynı clientToken iki eşzamanlı POST → tek satır, iki başarı aynı kimlik", tokSay === 1 && p1.data.id === p2.data.id, `${tokSay}`);
  const carp = await hataOf(createHallShiftResponsible({ ...girdi, userId: veli.id }, admin));
  check("§8c aynı token başka yük → 409 CLIENT_TOKEN_COLLISION", carp.status === 409 && carp.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(carp));
  const yaris = await Promise.all([hataOf(revokeHallShiftResponsible(p1.data.id, admin)), hataOf(revokeHallShiftResponsible(p1.data.id, admin))]);
  check("§8d kaldırma yarışı → bir başarı, bir 409", yaris.filter((y) => y.code === "OK").length === 1 && yaris.filter((y) => y.status === 409).length === 1, JSON.stringify(yaris));
  const geriOyna = await hataOf(createHallShiftResponsible(girdi, admin));
  check("§8e kaldırılmış atamanın token'ı yeniden oynatılınca 409 CLIENT_TOKEN_REVOKED", geriOyna.status === 409 && geriOyna.code === "CLIENT_TOKEN_REVOKED", JSON.stringify(geriOyna));

  // §9 öncesi: fikstür duruşları kapanır, alarmlar çözülür — açık bayrakta yabancı motorun işleyeceği bir şey kalmaz.
  for (const s of await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.looms }, endedAt: null }, select: { id: true } })) {
    await closeManualStop(s.id, at(10));
  }
  await tur(ids.looms, at(11));
  const acik = await prisma.loomAlarm.count({ where: { machineId: { in: ids.looms }, state: { in: ["OPEN", "ACKED"] } } });
  check("§8f fikstür alarmları kapandı (açık bayrakta yabancı tur işi yok)", acik === 0, String(acik));

  await httpBolumu({ def: def.id, I1: I1.id, ahmet, veli });
}

// ── §9 UÇTAN UCA (HTTP) ─────────────────────────────────────────────────────
const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 14;

async function call(token: string | null, method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const codeOf = (j: Record<string, unknown>): unknown => (j.details as { code?: unknown } | undefined)?.code;
const dataOf = <T>(j: Record<string, unknown>): T => j.data as T;

async function giris(k: Kisi): Promise<string | null> {
  const r = await call(null, "POST", "/api/auth/login", { username: k.username, password: k.password, clientType: "electron" });
  return r.status === 200 ? (dataOf<{ token?: string }>(r.json).token ?? null) : null;
}

async function httpBolumu(f: { def: string; I1: string; ahmet: Kisi; veli: Kisi }): Promise<void> {
  console.log("\n§9 — UÇTAN UCA (gerçek sunucu)");
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("§9 HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("§9 HTTP", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const t = kapi.token;
  // Gerçek saatli fikstür: hedef 10 dk, pay 600 dk → K1 geçmişte, K2 uzak — hangi motor çaldırırsa aynı sonuç.
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 600);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  try {
    const H9 = (await prisma.station.create({ data: { name: `TEST-LAS-HOL9-${ek}`, code: `TEST-LAS-H9-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } })).id;
    const H10 = (await prisma.station.create({ data: { name: `TEST-LAS-HOL10-${ek}`, code: `TEST-LAS-H10-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } })).id;
    ids.stations.push(H9, H10);
    const preset = await prisma.reasonPreset.findUniqueOrThrow({ where: { id: ids.presets[0]! }, select: { code: true } });
    let m = 100;
    const durusSimdi = async (hall: string): Promise<string> => {
      m += 1;
      const mac = await prisma.machine.create({ data: { stationId: hall, name: `TEST-LAS-T${m}-${ek}`, code: `TEST-LAS-T${m}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
      ids.looms.push(mac.id);
      const now = await readDbNow();
      await openManualStop({ machineId: mac.id, startedAt: new Date(now.getTime() - 12 * MIN), reasonCode: preset.code });
      await runLoomAlarmOnce({ now: await readDbNow(), onlyMachineIds: [mac.id], enabled: true });
      const a = await prisma.loomAlarm.findFirstOrThrow({ where: { machineId: mac.id }, select: { id: true } });
      return a.id;
    };
    type Notif = { tier: number; mode: string; recipients: Array<{ id: string; source: string }> };
    const notifs = async (token: string, id: string): Promise<string> => {
      const r = await call(token, "GET", `/api/loom-alarms/${id}`);
      return dataOf<{ notifications: Notif[] }>(r.json).notifications.map((x) => `${x.tier}:${x.mode}:${x.recipients.map((y) => `${y.id}/${y.source}`).join("+")}`).join("|");
    };

    const tok = randomUUID();
    const body = { stationId: H9, shiftDefinitionId: f.def, tier: 1, userId: f.ahmet.id, clientToken: tok };
    const c1 = await call(t, "POST", "/api/loom-alarm-duty/responsibles", body);
    const c2 = await call(t, "POST", "/api/loom-alarm-duty/responsibles", body);
    check("§9a sorumlu tanımlandı (201); aynı token yeniden → aynı satır", c1.status === 201 && c2.status === 201 &&
      dataOf<{ id: string }>(c1.json).id === dataOf<{ id: string }>(c2.json).id, `${c1.status} ${c2.status}`);
    const sizinti = await call(t, "POST", "/api/loom-alarm-duty/responsibles", { ...body, clientToken: randomUUID(), createdById: f.veli.id });
    check("§9b gövdeden createdById 400 (strict allowlist)", sizinti.status === 400, `${sizinti.status}`);

    const opt = await call(t, "GET", "/api/loom-alarm-duty/options");
    const o = dataOf<{ halls: Array<{ id: string }>; shifts: Array<{ id: string }>; permissions: Array<{ code: string }> }>(opt.json);
    const nonWeaving = await prisma.station.create({ data: { name: `TEST-LAS-KK-${ek}`, code: `TEST-LAS-KK-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "RAW_QC", isActive: true }, select: { id: true } });
    ids.stations.push(nonWeaving.id);
    check("§9b2 /options: dokuma holleri (dokuma dışı istasyon yok), aktif vardiya, yetki kataloğu", opt.status === 200 &&
      o.halls.some((h) => h.id === H9) && !o.halls.some((h) => h.id === nonWeaving.id) && o.shifts.some((x) => x.id === f.def) &&
      o.permissions.some((p) => p.code === "loom:alarm-view"), `${opt.status}`);

    const alarm1 = await durusSimdi(H9);
    const tA = await giris(f.ahmet);
    const tV = await giris(f.veli);
    check("§9c fikstür kullanıcıları HTTP'den giriş yaptı", tA !== null && tV !== null);
    if (!tA || !tV) return;
    check("§9d K1 alıcısı usta RAISED'a dondu [Ahmet/HALL_SHIFT]", (await notifs(t, alarm1)) === `1:LISTED:${f.ahmet.id}/HALL_SHIFT`, await notifs(t, alarm1));

    const ov = await call(t, "POST", "/api/loom-alarm-duty/overrides", { shiftInstanceId: f.I1, stationId: H9, tier: 1, userId: f.veli.id, note: "nöbet", clientToken: randomUUID() });
    check("§9e nöbet değişikliği kaydedildi (201)", ov.status === 201, `${ov.status} ${JSON.stringify(ov.json).slice(0, 200)}`);
    const alarm2 = await durusSimdi(H9);
    check("§9f ⭐ yeni alarm yeni kişiye [Veli/DUTY_OVERRIDE], eskisi DEĞİŞMEZ [Ahmet]",
      (await notifs(t, alarm2)) === `1:LISTED:${f.veli.id}/DUTY_OVERRIDE` && (await notifs(t, alarm1)) === `1:LISTED:${f.ahmet.id}/HALL_SHIFT`, await notifs(t, alarm2));

    const mine = async (token: string, hall: string) => {
      const r = await call(token, "GET", `/api/loom-alarms?mine=1&scope=all&stationId=${hall}`);
      const d = dataOf<{ items: Array<{ id: string }>; summary: { total: number } }>(r.json);
      return { status: r.status, ids: d?.items.map((i) => i.id).sort().join(",") ?? "", total: d?.summary.total ?? -1, n: d?.items.length ?? -1 };
    };
    const mA = await mine(tA, H9);
    const mV = await mine(tV, H9);
    check("§9g mine: Ahmet yalnız kendi alarmını, Veli yalnız kendisininkini görür; şerit = liste",
      mA.ids === alarm1 && mV.ids === alarm2 && mA.total === mA.n && mV.total === mV.n, `${mA.ids} | ${mV.ids}`);
    const hepsi = await call(tA, "GET", `/api/loom-alarms?scope=all&stationId=${H9}`);
    check("§9h mine'sız liste ikisini de gösterir (süzgeç yalnız mine)", dataOf<{ items: unknown[] }>(hepsi.json).items.length === 2);
    const kotu = await call(tA, "GET", "/api/loom-alarms?mine=x");
    check("§9i mine=x → 400", kotu.status === 400, `${kotu.status}`);

    const alarm3 = await durusSimdi(H10);
    check("§9j sorumlusuz holde bugünkü davranış: BY_PERMISSION, alıcı yok", (await notifs(t, alarm3)) === "1:BY_PERMISSION:", await notifs(t, alarm3));
    const mA10 = await mine(tA, H10);
    check("§9k izne göre K1 herkesin mine listesinde (Ahmet görür)", mA10.ids === alarm3, mA10.ids);

    const ozet = await call(t, "GET", "/api/loom-alarm-duty");
    const od = dataOf<{ responsibles: Array<{ station: { id: string } }>; overrides: Array<{ station: { id: string } }> }>(ozet.json);
    check("§9l genel bakış sorumluyu ve nöbet değişikliğini taşır", ozet.status === 200 && od.responsibles.some((r) => r.station.id === H9) && od.overrides.some((o) => o.station.id === H9));
    const yasak = await call(tA, "GET", "/api/loom-alarm-duty");
    check("§9m tanım uçları loom:spec-manage'siz 403", yasak.status === 403 && codeOf(yasak.json) === "PERMISSION_DENIED", `${yasak.status}`);
  } finally {
    for (const s of await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.looms }, endedAt: null }, select: { id: true } })) {
      await closeManualStop(s.id, await readDbNow());
    }
    await runLoomAlarmOnce({ now: await readDbNow(), onlyMachineIds: ids.looms, enabled: true });
    await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  }
}

async function cleanup(): Promise<void> {
  try {
    const users = ids.users;
    await prisma.hallShiftDutyOverride.deleteMany({ where: { OR: [{ userId: { in: users } }, { stationId: { in: ids.stations } }] } });
    await prisma.hallShiftResponsible.deleteMany({ where: { OR: [{ userId: { in: users } }, { stationId: { in: ids.stations } }] } });
    await prisma.loomAlarmTierRule.deleteMany({ where: { OR: [{ id: { in: ids.rules } }, { userId: { in: users } }] } });
    if (ids.looms.length) {
      // Fikstür temizliği: alarm silinir, olaylar ve donmuş alıcılar kaskatla gider (mühür kaskada izin verir).
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
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: { in: [ids.shiftDef, ...ids.extraDefs] } } });
    if (users.length) {
      await prisma.session.deleteMany({ where: { userId: { in: users } } });
      await prisma.systemLog.deleteMany({ where: { userId: { in: users } } });
      await prisma.userPermission.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
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
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
