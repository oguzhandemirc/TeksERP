// =============================================================================
// BEKÇİ — DOKUMA ALARM MOTORU (`loom-alarm.service.runLoomAlarmOnce`, Faz A1a)
// =============================================================================
//   §1 saf: `dueAlarmTiers` (geç kayıt → yalnız EN YÜKSEK kademe çalar, alttakiler atlanır) ·
//      `alarmShiftEligible` (vardiya yok / iptal → doğmaz)
//   §2 bayrak KAPALI (`tezgah.alarmEnabled` ya da `tezgah.enabled`) → tur "disabled", SIFIR satır
//      (fikstür + tablonun tamamı) · bekçi sürecinde dürtme no-op (motoru yalnız sunucu koşar)
//   §3 doğuş: K1 vadesinde RAISED(1), plan DONAR · geç kayıt RAISED(2) + TIER_SKIPPED(1), K1 çalmaz ·
//      vardiya dışı doğmaz · plan dışı doğmaz · sebepsiz duruş ortak hedefle doğar
//   §4 kademe: K2 vadesinde RAISED(2) · aynı anla ikinci tur ÇİFT KADEME yazmaz ·
//      `escalateWhenAcked` kapalı → üstlenilmiş alarm K2'de bekler, açılınca çalar
//   §5 yeniden plan: sebep değişince çalmamış K2 yeni hedeften · plan dışına sınıflama → CANCELLED
//   §6 kapanış: duruş kapanınca RESOLVED + süreler DONAR · geri alınınca CANCELLED STOP_REVOKED ·
//      kapanmış alarm bir daha işlenmez
//
// Global ayar yazar (`production.enabled` · `tezgah.enabled` · `tezgah.escalationGraceMinutes` ·
// `tezgah.alarmEnabled` · `tezgah.alarm.unclassifiedTargetMinutes` · `tezgah.alarm.escalateWhenAcked`);
// bulduğu değere `finally`de döner. Fikstür kendi vardiyasını kurar, temizlikte siler.
// Motor her turda `onlyMachineIds` ile fikstüre sınırlanır (başka veriye dokunmaz).
//
// NEGATİF SONDALAR (2026-10-11, cp + sha256 geri alındı):
//   ① `dueAlarmTiers` alttaki kademeyi atlamadı (ilk vadeliyi çaldırdı) → §1c/§3d/§6e ❌
//   ② `birthTx`ten vardiya süzgeci çıkarıldı → §3f ❌ · ③ `closeTx` plan dışı iptali çıkarıldı → §5c/§5d ❌
//   ④ `runLoomAlarmOnce` bayrak kapısı çıkarıldı → §2a/§2b/§2c (+10) ❌
//   ⑤ `advanceTx` rung 0 + claim'den `tier < raise` çıkarıldı → §4a/§4f/§6d ❌
//   ⑥ `escalateWhenAcked` yüklemi claim'den çıkarıldı → §4e ❌
//   ⑦ tekrar turu ÜÇ katmanla korunur (rung · claim · kademe partial unique) — üçü birden kaldırılınca
//      §4b/§4c/§6f/§6g (+4) ❌; yalnız claim + sed kaldırılınca yeşil (rung tek başına yeter, ölçüldü)
// =============================================================================
import { LoomAlarmEventKind, LoomAlarmState, MachineStopLossClass, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../src/services/machine-stop.service";
import { runLoomAlarmOnce, type LoomAlarmTickOutcome, type LoomAlarmTickSummary } from "../src/services/loom-alarm.service";
import { alarmShiftEligible, dueAlarmTiers } from "../src/services/helpers/loom-floor.helper";

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
const ids = { station: "", looms: [] as string[], presets: [] as string[], shiftDef: "", shift: "", user: "" };

const YONETILEN = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES,
  SETTING_KEYS.TEZGAH_ALARM_ENABLED, SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED,
];
const ilk = new Map<string, unknown>();
async function ayarlariSakla(): Promise<void> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
}
async function ayarYaz(key: string, value: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function ayarlariGeriYaz(): Promise<void> {
  for (const [key, value] of ilk) {
    if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
  }
}

function ozet(r: LoomAlarmTickOutcome): LoomAlarmTickSummary {
  if (r === "disabled") throw new Error("tur beklenmedik biçimde 'disabled' döndü");
  return r;
}
const tur = (now: Date, only: string[] = ids.looms) => runLoomAlarmOnce({ now, onlyMachineIds: only });

async function alarmOf(stopId: string) {
  return prisma.loomAlarm.findUnique({ where: { stopEventId: stopId }, include: { events: { orderBy: { createdAt: "asc" } } } });
}
const olaylar = (a: Awaited<ReturnType<typeof alarmOf>>): string =>
  (a?.events ?? []).map((e) => `${e.kind}${e.tier ?? ""}${e.code ? `:${e.code}` : ""}`).join(",");

async function main(): Promise<void> {
  console.log("\n=== Dokuma alarm motoru — kademe · geç kayıt · vardiya · plan dışı · bayrak · kapanış ===\n");
  await ayarlariSakla();
  try {
    await govde();
  } finally {
    await ayarlariGeriYaz();
    const geri = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
    const ayni = YONETILEN.every((k) => JSON.stringify(geri.find((r) => r.key === k)?.value) === JSON.stringify(ilk.get(k)));
    check("§0 global ayarlar bulunduğu değere geri yazıldı", ayni);
  }
}

async function govde(): Promise<void> {
  // ── §1 saf ──────────────────────────────────────────────────────────────────
  const t0 = new Date("2026-10-10T08:00:00Z");
  const plan = { k1DueAt: new Date(t0.getTime() + 10 * MIN), k2DueAt: new Date(t0.getTime() + 15 * MIN) };
  const d = (rung: number, dk: number) => JSON.stringify(dueAlarmTiers(plan, rung, new Date(t0.getTime() + dk * MIN)));
  check("§1a K1 vadesinden önce hiçbir kademe", d(0, 9) === JSON.stringify({ raise: null, skip: [] }), d(0, 9));
  check("§1b K1 vadesinde (sınır dahil) yalnız K1", d(0, 10) === JSON.stringify({ raise: 1, skip: [] }), d(0, 10));
  check("§1c geç kayıt: ikisi de geçmiş → yalnız K2 çalar, K1 ATLANIR", d(0, 40) === JSON.stringify({ raise: 2, skip: [1] }), d(0, 40));
  check("§1d K1 çalmışken K2 vadesi → yalnız K2", d(1, 15) === JSON.stringify({ raise: 2, skip: [] }), d(1, 15));
  check("§1e iki kademe de çalmış → yeni kademe yok", d(2, 999) === JSON.stringify({ raise: null, skip: [] }), d(2, 999));
  check("§1f K2'siz plan → yalnız K1", JSON.stringify(dueAlarmTiers({ ...plan, k2DueAt: null }, 0, new Date(t0.getTime() + 99 * MIN))) === JSON.stringify({ raise: 1, skip: [] }));
  check("§1g vardiya süzgeci: yok/iptal → doğmaz, canlı → doğar",
    !alarmShiftEligible(null) && !alarmShiftEligible({ isCancelled: true }) && alarmShiftEligible({ isCancelled: false }));

  // ── fikstür ────────────────────────────────────────────────────────────────
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, 15);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED, true);

  // Ölçüm anı GEÇMİŞTE (damga kapıları geçmişe açık); vardiya [simdi-3sa, simdi+1sa].
  const simdi = new Date(Math.floor((Date.now() - 2 * 60 * MIN) / MIN) * MIN);
  const at = (dk: number) => new Date(simdi.getTime() + dk * MIN);
  const def = await prisma.shiftDefinition.create({
    data: { code: `T${ek}`.slice(-8).toUpperCase(), name: `TEST-LA vardiya ${ek}`, startMinute: 0, durationMinutes: 240, isActive: false },
  });
  ids.shiftDef = def.id;
  const shift = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-01-01T00:00:00Z"), startsAt: at(-180), endsAt: at(60) } });
  ids.shift = shift.id;

  const station = await prisma.station.create({
    data: { name: `TEST-LA-HOL-${ek}`, code: `TEST-LA-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  });
  ids.station = station.id;
  const tezgah = async (n: number): Promise<string> => {
    const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-LA-T${n}-${ek}`, code: `TEST-LA-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
    ids.looms.push(m.id);
    return m.id;
  };
  const P = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LA ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  const Q = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LA ayar ${ek}`, stopLossClass: "SETUP", targetMinutes: 20 });
  const N = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LA plandisi ${ek}`, stopLossClass: MachineStopLossClass.NON_SCHEDULED });
  ids.presets.push(P.id, Q.id, N.id);

  // A: K1 dolu (12 dk, hedef 10, pay 5) · B: geç kayıt (60 dk) · C: vardiya dışı (4 sa önce) ·
  // D: plan dışı sebeple açık · E: sebepsiz (ortak hedef 15; K1 0, K2 +5) · F: sonra plan dışına
  // sınıflanacak (K2 +5) · G: escalateWhenAcked sınaması (K2 +5)
  const ac = async (n: number, dk: number, reasonCode?: string) =>
    (await openManualStop({ machineId: await tezgah(n), startedAt: at(-dk), ...(reasonCode ? { reasonCode } : {}) })).data;
  const A = await ac(1, 12, P.code);
  const B = await ac(2, 60, P.code);
  const C = await ac(3, 240, P.code);
  const D = await ac(4, 60, N.code);
  const E = await ac(5, 15);
  const F = await ac(6, 10, P.code);
  const G = await ac(7, 10, P.code);
  check("§0a fikstür: vardiya içi duruşlar vardiyaya bağlı, C vardiya dışı",
    [A, B, D, E, F, G].every((s) => s.shiftInstanceId === shift.id) && C.shiftInstanceId === null);

  // ── §2 bayrak kapalı ───────────────────────────────────────────────────────
  const toplamOnce = await prisma.loomAlarm.count();
  const olayOnce = await prisma.loomAlarmEvent.count();
  const kapali = await tur(at(30));
  check("§2a alarm bayrağı kapalı → tur 'disabled'", kapali === "disabled", JSON.stringify(kapali));
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, false);
  const tezgahKapali = await tur(at(30));
  check("§2b tezgah modülü kapalı (alarm açık) → tur 'disabled'", tezgahKapali === "disabled", JSON.stringify(tezgahKapali));
  check("§2c bayrak kapalıyken SIFIR satır (fikstür + tablonun tamamı)",
    (await prisma.loomAlarm.count({ where: { machineId: { in: ids.looms } } })) === 0
      && (await prisma.loomAlarm.count()) === toplamOnce && (await prisma.loomAlarmEvent.count()) === olayOnce);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);

  // ── §3 doğuş ───────────────────────────────────────────────────────────────
  const r1 = ozet(await tur(simdi));
  check("§3a ilk tur hatasız", r1.failed === 0, JSON.stringify(r1));
  const a = await alarmOf(A.id);
  check("§3b A: K1 vadesi geçti → alarm doğdu, yalnız RAISED1", a?.state === LoomAlarmState.OPEN && a.tier === 1 && olaylar(a) === "RAISED1", olaylar(a));
  check("§3c A: plan DONDU (hedef 10 · pay 5 · K1 = başlangıç+10 · K2 = başlangıç+15 · sebep P)",
    a?.targetMinutes === 10 && a.graceMinutes === 5 && a.k1DueAt.getTime() === at(-2).getTime() && a.k2DueAt?.getTime() === at(3).getTime() && a.planReasonCode === P.code);
  const b = await alarmOf(B.id);
  check("§3d B geç kayıt: yalnız EN YÜKSEK kademe çaldı (RAISED2), K1 atlandı", b?.tier === 2 && olaylar(b) === "TIER_SKIPPED1,RAISED2", olaylar(b));
  check("§3e B: K1 için RAISED satırı YOK (sağanak yok)", (b?.events ?? []).filter((e) => e.kind === LoomAlarmEventKind.RAISED).length === 1);
  check("§3f C vardiya dışı → alarm doğmadı", (await alarmOf(C.id)) === null);
  check("§3g D plan dışı → alarm doğmadı (ortak hedef ayarı dolu olsa da)", (await alarmOf(D.id)) === null);
  const e = await alarmOf(E.id);
  check("§3h E sebepsiz → ortak hedefle (15) doğdu, planReasonCode boş", e?.tier === 1 && e.targetMinutes === 15 && e.planReasonCode === null && olaylar(e) === "RAISED1", olaylar(e));

  // ── §4 kademe ──────────────────────────────────────────────────────────────
  const r2 = ozet(await tur(at(4)));
  const a2 = await alarmOf(A.id);
  check("§4a A: K2 vadesi geçti → RAISED2", a2?.tier === 2 && olaylar(a2) === "RAISED1,RAISED2", olaylar(a2));
  check("§4b ikinci tur hatasız", r2.failed === 0, JSON.stringify(r2));
  const olaySayisi = await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: { in: ids.looms } } } });
  const r3 = ozet(await tur(at(4)));
  check("§4c aynı anla tekrar tur → yeni kademe yok, hata yok", r3.raised === 0 && r3.skipped === 0 && r3.failed === 0, JSON.stringify(r3));
  check("§4d tekrar turda defter satırı ARTMADI (çift kademe yok)",
    (await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: { in: ids.looms } } } })) === olaySayisi);

  const kisi = await prisma.user.create({ data: { username: `test-la-${ek}`, fullName: `TEST-LA üstlenen ${ek}`, passwordHash: "x", isActive: false }, select: { id: true } });
  ids.user = kisi.id;
  const g = await alarmOf(G.id);
  // Üstlenme ucu A1b'de doğar; burada durum satırı doğrudan ACKED'e çekilir (fikstür).
  await prisma.loomAlarm.update({ where: { id: g!.id }, data: { state: LoomAlarmState.ACKED, ackedById: kisi.id, ackedAt: at(0) } });
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED, false);
  await tur(at(5), [G.machineId]);
  const g2 = await alarmOf(G.id);
  check("§4e escalateWhenAcked KAPALI: üstlenilmiş alarm K2 vadesinde de K1'de bekler", g2?.tier === 1 && olaylar(g2) === "RAISED1", olaylar(g2));
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED, true);
  await tur(at(5), [G.machineId]);
  const g3 = await alarmOf(G.id);
  check("§4f escalateWhenAcked AÇIK (varsayılan): üstlenilmiş alarm da K2'ye çıkar", g3?.tier === 2 && g3.state === LoomAlarmState.ACKED && olaylar(g3) === "RAISED1,RAISED2", olaylar(g3));

  // ── §5 yeniden plan ────────────────────────────────────────────────────────
  // E: başlangıç -15, ortak hedef 15 (K1 0, K2 +5). Q (hedef 20) → K2 = -15+20+5 = +10.
  await classifyStop(E.id, { reasonCode: Q.code });
  await reclassifyStop(F.id, { fromReasonCode: P.code, toReasonCode: N.code, reason: "bekçi" });
  const r5 = ozet(await tur(at(5)));
  const e2 = await alarmOf(E.id);
  check("§5a sebep değişti → yeniden plan: K2 yeni hedeften (başlangıç+20+5), plan sebebi Q",
    r5.replanned >= 1 && e2?.k2DueAt?.getTime() === at(10).getTime() && e2.targetMinutes === 20 && e2.planReasonCode === Q.code, `${e2?.k2DueAt?.toISOString()} / ${at(10).toISOString()}`);
  check("§5b eski K2 vadesi (+5) geçmiş olsa da K2 çalmadı; K1 (çalmış) DEĞİŞMEDİ", e2?.tier === 1 && e2.k1DueAt.getTime() === at(0).getTime() && olaylar(e2) === "RAISED1", olaylar(e2));
  const f = await alarmOf(F.id);
  check("§5c plan dışına sınıflandı → CANCELLED NON_SCHEDULED", f?.state === LoomAlarmState.CANCELLED && f.cancelReason === "NON_SCHEDULED" && f.closedAt !== null, `${f?.state}/${f?.cancelReason}`);
  check("§5d iptal defterde ters satır (CANCELLED:NON_SCHEDULED), ileri satır DURUYOR", olaylar(f) === "RAISED1,CANCELLED:NON_SCHEDULED", olaylar(f));

  // ── §6 kapanış ─────────────────────────────────────────────────────────────
  await closeManualStop(A.id, at(5));
  const bekleyen = await alarmOf(A.id);
  check("§6a bekçi sürecinde dürtme no-op: kapanış alarmı tur koşmadan değiştirmedi", bekleyen?.state === LoomAlarmState.OPEN);
  await revokeStop(B.id, "bekçi geri alma");
  const r6 = ozet(await tur(at(6)));
  const a3 = await alarmOf(A.id);
  check("§6b duruş kapandı → RESOLVED, kapanış = duruş bitişi", a3?.state === LoomAlarmState.RESOLVED && a3.closedAt?.getTime() === at(5).getTime(), `${a3?.state}`);
  check("§6c süreler DONDU: toplam 17 dk, aşım 7 dk (bitiş − K1)", a3?.totalSec === 17 * 60 && a3.overdueSec === 7 * 60, `${a3?.totalSec}/${a3?.overdueSec}`);
  check("§6d RESOLVED defterde", olaylar(a3) === "RAISED1,RAISED2,RESOLVED", olaylar(a3));
  const b2 = await alarmOf(B.id);
  check("§6e duruş geri alındı → CANCELLED STOP_REVOKED", b2?.state === LoomAlarmState.CANCELLED && b2.cancelReason === "STOP_REVOKED" && olaylar(b2) === "TIER_SKIPPED1,RAISED2,CANCELLED:STOP_REVOKED", olaylar(b2));
  check("§6f kapanış turu hatasız", r6.failed === 0 && r6.resolved === 1 && r6.cancelled === 1, JSON.stringify(r6));
  const kapaliSayi = await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: { in: ids.looms } } } });
  const r7 = ozet(await tur(at(30)));
  check("§6g kapanmış alarmlar bir daha işlenmez (tekrar tur: yeni kapanış yok)", r7.resolved === 0 && r7.cancelled === 0 && r7.failed === 0, JSON.stringify(r7));
  check("§6h son tur yalnız canlı alarmlara kademe yazdı (E K2 +10, G zaten 2)",
    (await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: { in: ids.looms } } } })) === kapaliSayi + r7.raised + r7.skipped && r7.raised === 1);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.looms.length) {
      // Fikstür temizliği: alarm silinir, olaylar kaskatla gider (mühür kaskada izin verir) — üretim yolu değil.
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
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
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
    process.exit(fail > 0 ? 1 : 0);
  });
