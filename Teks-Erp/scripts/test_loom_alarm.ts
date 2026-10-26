// =============================================================================
// BEKÇİ — DOKUMA ALARM MOTORU (`loom-alarm.service.runLoomAlarmOnce`, Faz A1a)
// =============================================================================
//   §1 saf: `dueAlarmTiers` (geç kayıt → yalnız vadesi EN GEÇ kademe çalar, daha önce geçmiş alttakiler
//      atlanır; vadesi EŞİT kademeler — pay 0 — ikisi de çalar) ·
//      `alarmShiftEligible` (vardiya yok / iptal → doğmaz) · `alarmClockStart` (saat başlangıcı + uygunluk)
//   §2 bayrak KAPALI (`tezgah.alarmEnabled` ya da `tezgah.enabled`) → tur "disabled", SIFIR satır
//      (fikstür + tablonun tamamı) · bekçi sürecinde dürtme no-op (motoru yalnız sunucu koşar)
//   §3 doğuş: K1 vadesinde RAISED(1), plan DONAR · geç kayıt RAISED(2) + TIER_SKIPPED(1), K1 çalmaz ·
//      vardiya yokken doğmaz · plan dışı doğmaz · sebepsiz duruş ortak hedefle doğar · pay 0 → RAISED(1)+RAISED(2) ·
//      VARDİYAYA TAŞAN duruş (vardiya dışında açıldı, vardiya başladı, hâlâ açık) DOĞAR — saat vardiya başından,
//      Tezgah Salonu aynı saati gösterir, duruşun kendi kaydı değişmez · vardiya içinde açılıp sonraki vardiyaya
//      geçen duruşun saati açılıştan (bugünkü davranış) · vardiya bitince canlı alarm sürer
//   §4 kademe: K2 vadesinde RAISED(2) · aynı anla ikinci tur ÇİFT KADEME yazmaz ·
//      `escalateWhenAcked` kapalı → üstlenilmiş alarm K2'de bekler, açılınca çalar
//   §5 yeniden plan: sebep değişince çalmamış K2 yeni hedeften · plan dışına sınıflama → CANCELLED
//   §6 kapanış: duruş kapanınca RESOLVED + süreler DONAR · geri alınınca CANCELLED STOP_REVOKED ·
//      kapanmış alarm bir daha işlenmez
//   §9 VARDİYASIZ KİP (`tezgah.alarm.noShiftMode`): okuyucu varsayılanı WARN (satır yok / çöp) · saf matris
//      3 kip × (vardiya tanımsız · tanımlı ama şu an dışı · içi) `alarmClockStart` + şerit (`alarmShiftNotice`) +
//      açma kilidi (`alarmEnableBlocked`) · DB matrisi: aynı üç durum × üç kip motor turu (doğdu mu, saat nereden) ·
//      Tezgah Salonu AYNI saat (her kipte `clockStartedAt` = K1 − hedef) · REQUIRE_SHIFT sunucu kapısı (yalnız
//      geçişte 400 `TEZGAH_ALARM_SHIFT_REQUIRED`, yazmadan önce) · durum ucu servisi · şerit kararı tek çağrı yerinde (AST)
//   §10 SEBEPSİZ ANAHTAR (`tezgah.alarm.unclassifiedEnabled`): satır yoksa süreden türer · kapalıyken motor doğurmaz,
//      salon hedef göstermez · açıkken süre zorunlu (400 `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`) · kapatmak süreyi
//      silmez · eski istemci (yalnız süre) bugünkü anlamda · etkin hedef tek resolver'dan (AST)
//   §8 tek saat: StopClock yalnız `stopClockOf`la kurulur, `alarmShiftEligible` yalnız helper'da çağrılır (AST)
//   §7 yabancı motor: aynı DB'de gerçek saatle koşan sunucu zamanlayıcısı (CI'da beş HTTP sunucusu) fikstüre
//      DOKUNAMAZ — global alarm bayrağı §2'den sonra KAPALI kalır, bekçinin turları kapıyı `enabled` ile geçer;
//      üretim çağıranı `enabled` vermez. Çıpa (`simdi`) duvar saatinden türer ama sonuç ona bağlı değildir:
//      `TEST_LOOM_ALARM_SIMDI=<ISO>` ile sabitlenir (vardiya/gün sınırı sondaları).
//
// Global ayar yazar (`production.enabled` · `tezgah.enabled` · `tezgah.escalationGraceMinutes` ·
// `tezgah.alarmEnabled` · `tezgah.alarm.unclassifiedTargetMinutes` · `tezgah.alarm.unclassifiedEnabled` ·
// `tezgah.alarm.escalateWhenAcked` · `tezgah.alarm.noShiftMode`);
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
//   ⑧ `dueAlarmTiers` eşit vadeli alttakini de atladı (yalnız en yüksek çaldı) → §1h/§1i/§3i ❌
//   ⑨ §2 sonrası global bayrak AÇIK bırakıldı (eski fikstür) → yabancı turlar §3b–§6h + §7a (11) ❌; eski bekçiye
//      classify↔reclassify arasına TEK yabancı tur → §5a/§5b/§5d/§6h (37/4, CI 38110738522 imzasının aynısı)
//   ⑩ `runLoomAlarmOnce` `opts.enabled`i yok saydı → §3a'dan itibaren tur 'disabled' ❌
//   VARDİYAYA TAŞMA (2026-10-11): ⑪ `birthTx` eski süzgece döndü (`alarmShiftEligible(stop.shiftInstance)`) →
//   §3k/§3m/§3p ❌ · ⑫ `alarmClockStart` taşan duruşta saati açılıştan başlattı → §1j/§1n/§1o/§3j/§3k/§3m/§3n ❌ ·
//   ⑬ Salon kendi saatini kurdu (`startedAt: s.startedAt`) → §3n/§8a ❌ · ⑭ vardiyada açılan duruşun saati de şu
//   anki vardiyanın başından (max(açılış, vardiya başı)) → §1m ❌
//   VARDİYASIZ KİP + SEBEPSİZ ANAHTAR (2026-10-12): ⑮a `alarmClockStart` ALWAYS dalı silindi → §9b/§9d/§9d2/§9e ❌ ·
//   ⑮b salon kipi okumadı (WARN sabit) → §9e ❌ · ⑮c REQUIRE_SHIFT kapı çağrısı silindi → §9f/§9f2/§9f5 ❌ · ⑮d kip
//   okuyucusunun `includes` sigortası silindi → §9a ❌ · ⑮e ikinci `alarmShiftNotice` çağrısı → §9g ❌ · ⑯ motor ham
//   sebepsiz süreyi okudu → §10b/§10d ❌ · ⑰ sebepsiz süre kapısı silindi → §10c ❌ · ⑱ eski istemci dalı silindi → §10c2 ❌
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { LoomAlarmEventKind, LoomAlarmState, MachineStopLossClass, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invalidateFeatureFlagsCache, readTezgahAlarmNoShiftMode, readTezgahAlarmUnclassifiedEnabled, readTezgahAlarmUnclassifiedTargetMinutes, resolveTezgahAlarmUnclassifiedTarget, SETTING_KEYS, systemSettingService, TEZGAH_ALARM_NO_SHIFT_MODES, type TezgahAlarmNoShiftMode } from "../src/services/system-setting.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop, revokeStop } from "../src/services/machine-stop.service";
import { runLoomAlarmOnce, type LoomAlarmTickOutcome, type LoomAlarmTickSummary } from "../src/services/loom-alarm.service";
import { alarmClockStart, alarmEnableBlocked, alarmShiftEligible, alarmShiftNotice, dueAlarmTiers } from "../src/services/helpers/loom-floor.helper";
import { getAlarmShiftStatus, getLoomFloor } from "../src/services/loom-floor.service";
import { AppError } from "../src/utils/app-error";
import { testActorId } from "./fixture-test-user";

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
const ids = { station: "", looms: [] as string[], presets: [] as string[], shiftDef: "", shifts: [] as string[], user: "", extraDefs: [] as string[] };

const YONETILEN = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES,
  SETTING_KEYS.TEZGAH_ALARM_ENABLED, SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED,
  SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED,
];
const ilk = new Map<string, unknown>();
async function ayarlariSakla(): Promise<void> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
}
async function ayarYaz(key: string, value: boolean | number | string): Promise<void> {
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
/** Bekçinin turu: sabit saat + bayrak kapısı enjekte (global bayrak kapalıyken de koşar). */
const tur = (now: Date, only: string[] = ids.looms) => runLoomAlarmOnce({ now, onlyMachineIds: only, enabled: true });
/** Bayrak kapısını DB'den okuyan tur (§2). */
const turDb = (now: Date) => runLoomAlarmOnce({ now, onlyMachineIds: ids.looms });
/** Sunucu zamanlayıcısı kılığı: DB saati + DB bayrağı (fikstüre sınırlı). Her çağrı 'disabled' dönmeli. */
const yabanciSonuclar: string[] = [];
const yabanciTur = async (an: string): Promise<void> => {
  const r = await runLoomAlarmOnce({ onlyMachineIds: ids.looms });
  yabanciSonuclar.push(`${an}:${typeof r === "string" ? r : JSON.stringify(r)}`);
};

/** Üretim kaynağında `runLoomAlarmOnce(...)` çağrısına `enabled` geçen yerler (yalnız bekçi enjekte eder). */
function enabledEnjeksiyonu(kaynak: string): number {
  return [...kaynak.matchAll(/runLoomAlarmOnce\s*\(([^)]*)\)/g)].filter((m) => /\benabled\b/.test(m[1] ?? "")).length;
}
function tsDosyalari(dizin: string): string[] {
  return fs.readdirSync(dizin, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dizin, e.name);
    return e.isDirectory() ? tsDosyalari(p) : e.name.endsWith(".ts") ? [p] : [];
  });
}

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
  check("§1a K1 vadesinden önce hiçbir kademe", d(0, 9) === JSON.stringify({ raise: [], skip: [] }), d(0, 9));
  check("§1b K1 vadesinde (sınır dahil) yalnız K1", d(0, 10) === JSON.stringify({ raise: [1], skip: [] }), d(0, 10));
  check("§1c geç kayıt: ikisi de geçmiş → yalnız K2 çalar, K1 ATLANIR", d(0, 40) === JSON.stringify({ raise: [2], skip: [1] }), d(0, 40));
  check("§1d K1 çalmışken K2 vadesi → yalnız K2", d(1, 15) === JSON.stringify({ raise: [2], skip: [] }), d(1, 15));
  check("§1e iki kademe de çalmış → yeni kademe yok", d(2, 999) === JSON.stringify({ raise: [], skip: [] }), d(2, 999));
  check("§1f K2'siz plan → yalnız K1", JSON.stringify(dueAlarmTiers({ ...plan, k2DueAt: null }, 0, new Date(t0.getTime() + 99 * MIN))) === JSON.stringify({ raise: [1], skip: [] }));
  // Pay 0 → K1 = K2: vadesi EŞİT kademeler sağanak değildir, ikisi de çalar (1e kararı 2026-10-11).
  const esit = { k1DueAt: plan.k1DueAt, k2DueAt: plan.k1DueAt };
  const e0 = (dk: number) => JSON.stringify(dueAlarmTiers(esit, 0, new Date(t0.getTime() + dk * MIN)));
  check("§1h pay 0 (K1 = K2): vadede İKİSİ DE çalar, hiçbiri atlanmaz", e0(10) === JSON.stringify({ raise: [1, 2], skip: [] }), e0(10));
  check("§1i pay 0, geç kayıt: yine ikisi de çalar (eşit vade sağanak değil)", e0(40) === JSON.stringify({ raise: [1, 2], skip: [] }), e0(40));
  check("§1g vardiya süzgeci: yok/iptal → doğmaz, canlı → doğar",
    !alarmShiftEligible(null) && !alarmShiftEligible({ isCancelled: true }) && alarmShiftEligible({ isCancelled: false }));
  // Saat başlangıcı: vardiya [t0, t0+8sa]; duruş t0-10sa'te vardiya dışında açıldı.
  const v = (bas: number, bit: number, isCancelled = false) => ({ startsAt: new Date(t0.getTime() + bas * MIN), endsAt: new Date(t0.getTime() + bit * MIN), isCancelled });
  // §1j–§1p varsayılan kipte (WARN = bugünkü davranış); kip matrisi §9.
  const cs = (bas: number, own: { isCancelled: boolean } | null, shifts: ReturnType<typeof v>[], an: number, mode: TezgahAlarmNoShiftMode = "WARN") => {
    const r = alarmClockStart({ startedAt: new Date(t0.getTime() + bas * MIN), shiftInstance: own }, shifts, new Date(t0.getTime() + an * MIN), mode);
    return `${(r.at.getTime() - t0.getTime()) / MIN}/${r.eligible}`;
  };
  check("§1j vardiyaya TAŞAN duruş: saat vardiya başından, uygun", cs(-600, null, [v(0, 480)], 30) === "0/true", cs(-600, null, [v(0, 480)], 30));
  check("§1k vardiyada açılan duruş: saat açılıştan, uygun (bugünkü davranış)", cs(10, { isCancelled: false }, [v(0, 480)], 30) === "10/true", cs(10, { isCancelled: false }, [v(0, 480)], 30));
  check("§1l hiç vardiyaya değmemiş duruş: saat açılıştan, UYGUN DEĞİL", cs(-600, null, [], 30) === "-600/false" && cs(-600, null, [v(60, 480)], 30) === "-600/false", cs(-600, null, [v(60, 480)], 30));
  check("§1m vardiyada açılıp sonraki vardiyaya geçen duruş: saat açılıştan (yeni vardiya başından DEĞİL)",
    cs(470, { isCancelled: false }, [v(0, 480), v(480, 960)], 500) === "470/true", cs(470, { isCancelled: false }, [v(0, 480), v(480, 960)], 500));
  check("§1n taştığı vardiya bitti, şimdi vardiya yok: saat taştığı vardiyanın başından, doğuşa uygun DEĞİL",
    cs(-600, null, [v(0, 480)], 500) === "0/false", cs(-600, null, [v(0, 480)], 500));
  check("§1o iptal edilmiş vardiya sayılmaz: açıldığı vardiya iptal, sonraki canlı vardiyanın başından",
    cs(-30, { isCancelled: true }, [v(-60, 0, true), v(0, 480)], 30) === "0/true" && cs(-30, { isCancelled: true }, [v(-60, 0, true)], -10) === "-30/false",
    cs(-30, { isCancelled: true }, [v(-60, 0, true), v(0, 480)], 30));
  check("§1p vardiya SONRADAN yaratıldı (duruşta vardiya bağı yok, an vardiyanın içinde): saat açılıştan, uygun",
    cs(30, null, [v(0, 480)], 60) === "30/true", cs(30, null, [v(0, 480)], 60));

  // ── fikstür ────────────────────────────────────────────────────────────────
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, 15);
  // Sebepsiz anahtar satırsız: süreden türer (açık) — §3h bugünkü davranışı ölçer; anahtar matrisi §10.
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED } });
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ESCALATE_WHEN_ACKED, true);

  // Ölçüm anı GEÇMİŞTE (damga kapıları geçmişe açık); vardiya [simdi-3sa, simdi+1sa]. Sabit çıpa: env.
  const cipa = process.env.TEST_LOOM_ALARM_SIMDI ? new Date(process.env.TEST_LOOM_ALARM_SIMDI).getTime() : Date.now() - 2 * 60 * MIN;
  if (Number.isNaN(cipa)) throw new Error("TEST_LOOM_ALARM_SIMDI ISO tarih olmalı");
  const simdi = new Date(Math.floor(cipa / MIN) * MIN);
  console.log(`(çıpa ${simdi.toISOString()})`);
  const at = (dk: number) => new Date(simdi.getTime() + dk * MIN);
  const def = await prisma.shiftDefinition.create({
    data: { code: `T${ek}`.slice(-8).toUpperCase(), name: `TEST-LA vardiya ${ek}`, startMinute: 0, durationMinutes: 240, isActive: false },
  });
  ids.shiftDef = def.id;
  const shift = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-01-01T00:00:00Z"), startsAt: at(-180), endsAt: at(60) } });
  ids.shifts.push(shift.id);
  // Ardışık ikinci vardiya: vardiyada açılıp sonrakine geçen duruşun saati açılıştan kalır (J).
  const shift2 = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: new Date("1999-01-02T00:00:00Z"), startsAt: at(60), endsAt: at(300) } });
  ids.shifts.push(shift2.id);
  const yabanciVardiya = await prisma.shiftInstance.count({ where: { id: { notIn: ids.shifts }, isCancelled: false, startsAt: { lt: at(340) }, endsAt: { gt: at(-320) } } });
  check("§0b ortam: fikstür vardiyalarının çevresinde (−320 dk … +340 dk) yabancı canlı vardiya YOK", yabanciVardiya === 0, String(yabanciVardiya));

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
  // H: pay 0 (duruş açılırken ayardan donar) — K1 = K2 = başlangıç+10.
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 0);
  const H = await ac(8, 12, P.code);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);
  // J: vardiya bitmeden 5 dk önce açıldı (hedef 20 → K1 +75), ikinci vardiyaya geçer.
  const J = (await openManualStop({ machineId: await tezgah(9), startedAt: at(55), reasonCode: Q.code })).data;
  check("§0a fikstür: vardiya içi duruşlar vardiyaya bağlı, C vardiya dışı",
    [A, B, D, E, F, G, H, J].every((s) => s.shiftInstanceId === shift.id) && C.shiftInstanceId === null);
  const cKayit = async () => JSON.stringify(await prisma.machineStopEvent.findUnique({ where: { id: C.id }, select: { shiftInstanceId: true, factoryDay: true, startedAt: true, targetMinutes: true } }));
  const cOnce = await cKayit();

  // ── §2 bayrak kapalı ───────────────────────────────────────────────────────
  const toplamOnce = await prisma.loomAlarm.count();
  const olayOnce = await prisma.loomAlarmEvent.count();
  const kapali = await turDb(at(30));
  check("§2a alarm bayrağı kapalı → tur 'disabled'", kapali === "disabled", JSON.stringify(kapali));
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, false);
  const tezgahKapali = await turDb(at(30));
  check("§2b tezgah modülü kapalı (alarm açık) → tur 'disabled'", tezgahKapali === "disabled", JSON.stringify(tezgahKapali));
  check("§2c bayrak kapalıyken SIFIR satır (fikstür + tablonun tamamı)",
    (await prisma.loomAlarm.count({ where: { machineId: { in: ids.looms } } })) === 0
      && (await prisma.loomAlarm.count()) === toplamOnce && (await prisma.loomAlarmEvent.count()) === olayOnce);
  // Global alarm bayrağı bundan sonra KAPALI: sunucu zamanlayıcıları (gerçek saat) fikstürü göremez.
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await yabanciTur("§2 sonu");

  // ── §3 doğuş ───────────────────────────────────────────────────────────────
  // C vardiya dışında açıldı (−240), vardiya −180'de başladı, duruş hâlâ açık. Hedef 10, pay 5.
  const salonC = async (an: Date) => (await getLoomFloor(an)).data?.looms.find((l) => l.id === C.machineId)?.openStop ?? null;
  ozet(await tur(at(-185), [C.machineId]));
  check("§3f vardiya yokken (duruş vardiya dışında, şu an vardiya yok) alarm doğmaz", (await alarmOf(C.id)) === null);
  ozet(await tur(at(-171), [C.machineId]));
  check("§3j vardiyaya taşan duruş: açılıştan 69 dk geçti ama vardiya başından 9 dk → henüz doğmaz (saat vardiya başından)", (await alarmOf(C.id)) === null);
  const sc1 = await salonC(at(-171));
  check("§3n Tezgah Salonu AYNI saat: taşan duruş hedef içinde (WITHIN), saat vardiya başından, iletim anı vardiya başı + 15",
    sc1?.tier === "WITHIN" && sc1.clockStartedAt.getTime() === at(-180).getTime() && sc1.escalationDueAt?.getTime() === at(-165).getTime() && sc1.startedAt.getTime() === at(-240).getTime(),
    JSON.stringify(sc1 && { tier: sc1.tier, clock: sc1.clockStartedAt, due: sc1.escalationDueAt }));
  ozet(await tur(at(-170), [C.machineId]));
  const c1 = await alarmOf(C.id);
  check("§3k vardiyaya taşan duruş: K1 vardiya başı + hedefte DOĞDU (RAISED1), plan vardiya başından donar",
    c1?.state === LoomAlarmState.OPEN && c1.tier === 1 && olaylar(c1) === "RAISED1" && c1.k1DueAt.getTime() === at(-170).getTime() && c1.k2DueAt?.getTime() === at(-165).getTime(),
    `${olaylar(c1)} k1=${c1?.k1DueAt.toISOString()} beklenen ${at(-170).toISOString()}`);
  check("§3l duruşun kendi kaydı DEĞİŞMEDİ (vardiya bağı boş · fabrika günü · başlangıç · hedef)", (await cKayit()) === cOnce, await cKayit());
  const sc2 = await salonC(at(-170));
  check("§3n2 Tezgah Salonu aynı anda hedef aşıldı (OVERDUE) gösterir", sc2?.tier === "OVERDUE", sc2?.tier ?? "yok");
  const r1 = ozet(await tur(simdi));
  check("§3a ilk tur hatasız", r1.failed === 0, JSON.stringify(r1));
  const a = await alarmOf(A.id);
  check("§3b A: K1 vadesi geçti → alarm doğdu, yalnız RAISED1", a?.state === LoomAlarmState.OPEN && a.tier === 1 && olaylar(a) === "RAISED1", olaylar(a));
  check("§3c A: plan DONDU (hedef 10 · pay 5 · K1 = başlangıç+10 · K2 = başlangıç+15 · sebep P)",
    a?.targetMinutes === 10 && a.graceMinutes === 5 && a.k1DueAt.getTime() === at(-2).getTime() && a.k2DueAt?.getTime() === at(3).getTime() && a.planReasonCode === P.code);
  const b = await alarmOf(B.id);
  check("§3d B geç kayıt: yalnız EN YÜKSEK kademe çaldı (RAISED2), K1 atlandı", b?.tier === 2 && olaylar(b) === "TIER_SKIPPED1,RAISED2", olaylar(b));
  check("§3e B: K1 için RAISED satırı YOK (sağanak yok)", (b?.events ?? []).filter((e) => e.kind === LoomAlarmEventKind.RAISED).length === 1);
  const c2 = await alarmOf(C.id);
  check("§3m taşan duruşun alarmı vardiyada kademe atladı (K2 vadesi geçti → RAISED2)", c2?.tier === 2 && olaylar(c2) === "RAISED1,RAISED2", olaylar(c2));
  const h = await alarmOf(H.id);
  check("§3i H pay 0: K1 ve K2 AYNI anda çaldı — ikisi de RAISED, TIER_SKIPPED YOK, kademe 2",
    h?.tier === 2 && h.graceMinutes === 0 && olaylar(h) === "RAISED1,RAISED2", olaylar(h));
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
  // Yabancı turun en zararlı aralığı: E yeniden planlanmış, F henüz plan dışına alınmamış.
  await yabanciTur("§5 classify↔reclassify");
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
  await yabanciTur("§6 kapanış sonrası");
  const r7 = ozet(await tur(at(30)));
  check("§6g kapanmış alarmlar bir daha işlenmez (tekrar tur: yeni kapanış yok)", r7.resolved === 0 && r7.cancelled === 0 && r7.failed === 0, JSON.stringify(r7));
  check("§6h son tur yalnız canlı alarmlara kademe yazdı (E K2 +10, G zaten 2)",
    (await prisma.loomAlarmEvent.count({ where: { alarm: { machineId: { in: ids.looms } } } })) === kapaliSayi + r7.raised + r7.skipped && r7.raised === 1);

  // J: vardiyada açıldı (+55), ikinci vardiya +60'ta başladı. Saat açılıştan: K1 = +75 (yeni vardiya başından olsaydı +80).
  ozet(await tur(at(76), [J.machineId]));
  const j = await alarmOf(J.id);
  check("§3o vardiyada açılıp sonraki vardiyaya geçen duruş: saat AÇILIŞTAN (K1 = açılış + 20), bugünkü davranış",
    j?.tier === 1 && j.k1DueAt.getTime() === at(75).getTime() && olaylar(j) === "RAISED1", `${olaylar(j)} k1=${j?.k1DueAt.toISOString()}`);
  // Vardiyalar bitti (+300 sonrası vardiya yok): canlı alarm duruş kapanana dek sürer.
  ozet(await tur(at(330), [C.machineId, J.machineId]));
  const cSon = await alarmOf(C.id);
  const jSon = await alarmOf(J.id);
  check("§3p vardiya bitince canlı alarm KAPANMAZ (kapanış yalnız duruşun kapanması / geri alınması / plan dışı)",
    cSon?.state === LoomAlarmState.OPEN && jSon?.state === LoomAlarmState.OPEN && jSon.tier === 2, `${cSon?.state}/${jSon?.state}/${jSon?.tier}`);

  await vardiyasizKip({ at, simdi, tezgah, P });
  await sebepsizAnahtar({ at, simdi, tezgah, P });

  // ── §8 tek saat (AST) ──────────────────────────────────────────────────────
  const ihlal = tekSaatIhlalleri(path.join(__dirname, "..", "src"));
  check("§8a StopClock yalnız `stopClockOf`la kurulur, `alarmShiftEligible` yalnız helper'da çağrılır", ihlal.length === 0, ihlal.join(" · "));
  const sondaSaat = tekSaatKaynak("const clock = { startedAt: s.startedAt, targetMinutes: t, graceMinutes: g, lossClass: s.lossClass };", "sonda.ts");
  const sondaSuzgec = tekSaatKaynak("if (!alarmShiftEligible(stop.shiftInstance)) return;", "sonda.ts");
  check("§8b sonda: elle kurulan saat ve doğrudan vardiya süzgeci yakalanır; `stopClockOf` çağrısı yakalanmaz",
    sondaSaat.length === 1 && sondaSuzgec.length === 1 && tekSaatKaynak("const c = stopClockOf(s, alarmClockStart(s, sh, now, mode), t, g);", "sonda.ts").length === 0,
    `${sondaSaat.length}/${sondaSuzgec.length}`);

  // ── §7 yabancı motor ───────────────────────────────────────────────────────
  check("§7a gerçek saatli yabancı tur (sunucu zamanlayıcısı) her noktada 'disabled' — fikstüre dokunamadı",
    yabanciSonuclar.length === 3 && yabanciSonuclar.every((x) => x.endsWith(":disabled")), yabanciSonuclar.join(" · "));
  const enjekte = tsDosyalari(path.join(__dirname, "..", "src")).filter((f) => enabledEnjeksiyonu(fs.readFileSync(f, "utf8")) > 0);
  check("§7b üretim kaynağı `runLoomAlarmOnce`a `enabled` geçmez (kapı yalnız bayraktan)", enjekte.length === 0, enjekte.join(" · "));
  check("§7c sonda: `enabled` geçen çağrı yakalanır, argümansız çağrı yakalanmaz",
    enabledEnjeksiyonu("void runLoomAlarmOnce({ enabled: true })") === 1 && enabledEnjeksiyonu("void runLoomAlarmOnce()") === 0);
}

// ── §9 vardiyasız kip ─────────────────────────────────────────────────────────
interface KipCtx { at: (dk: number) => Date; simdi: Date; tezgah: (n: number) => Promise<string>; P: { code: string } }

async function vardiyasizKip({ at, simdi, tezgah, P: preset }: KipCtx): Promise<void> {
  const KIPLER = TEZGAH_ALARM_NO_SHIFT_MODES;
  // §9a okuyucu: satır yok / çöp → WARN (varsayılan = bugünkü davranış; §1–§6 satırsız koştu).
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE } });
  const satirsiz = await readTezgahAlarmNoShiftMode();
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, "HER_ZAMAN");
  const cop = await readTezgahAlarmNoShiftMode();
  const gecerli: string[] = [];
  for (const k of KIPLER) {
    await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, k);
    gecerli.push(await readTezgahAlarmNoShiftMode());
  }
  check("§9a okuyucu: satır yok → WARN · çöp → WARN · üç geçerli kip kendisi", satirsiz === "WARN" && cop === "WARN" && gecerli.join(",") === KIPLER.join(","), `${satirsiz}/${cop}/${gecerli.join(",")}`);

  // §9b saf matris — t0 göreli dakika. Duruş −30'da açıldı, an +30.
  const t0 = new Date("2026-10-10T08:00:00Z");
  const v = (bas: number, bit: number) => ({ startsAt: new Date(t0.getTime() + bas * MIN), endsAt: new Date(t0.getTime() + bit * MIN), isCancelled: false });
  const hucre = (mode: TezgahAlarmNoShiftMode, bas: number, own: { isCancelled: boolean } | null, shifts: ReturnType<typeof v>[], an: number) => {
    const r = alarmClockStart({ startedAt: new Date(t0.getTime() + bas * MIN), shiftInstance: own }, shifts, new Date(t0.getTime() + an * MIN), mode);
    return `${(r.at.getTime() - t0.getTime()) / MIN}/${r.eligible}`;
  };
  const DURUMLAR = {
    tanimsiz: (m: TezgahAlarmNoShiftMode) => hucre(m, -30, null, [], 30),
    disi: (m: TezgahAlarmNoShiftMode) => hucre(m, -30, null, [v(60, 480)], 30),
    ici: (m: TezgahAlarmNoShiftMode) => hucre(m, -30, { isCancelled: false }, [v(-60, 480)], 30),
    tasan: (m: TezgahAlarmNoShiftMode) => hucre(m, -600, null, [v(0, 480)], 30),
  };
  const BEKLENEN: Record<TezgahAlarmNoShiftMode, Record<keyof typeof DURUMLAR, string>> = {
    WARN: { tanimsiz: "-30/false", disi: "-30/false", ici: "-30/true", tasan: "0/true" },
    REQUIRE_SHIFT: { tanimsiz: "-30/false", disi: "-30/false", ici: "-30/true", tasan: "0/true" },
    ALWAYS: { tanimsiz: "-30/true", disi: "-30/true", ici: "-30/true", tasan: "-600/true" },
  };
  const durumAdlari = Object.keys(DURUMLAR) as (keyof typeof DURUMLAR)[];
  for (const m of KIPLER) {
    const olcum = durumAdlari.map((d) => `${d}=${DURUMLAR[d](m)}`).join(" ");
    const beklenen = durumAdlari.map((d) => `${d}=${BEKLENEN[m][d]}`).join(" ");
    check(`§9b ${m}: saat başlangıcı + uygunluk (tanımsız · dışı · içi · taşan)`, olcum === beklenen, olcum);
  }
  // §9c şerit + açma kilidi.
  const N = (alarmEnabled: boolean, mode: TezgahAlarmNoShiftMode, shiftDefined: boolean, shiftNow: boolean) => String(alarmShiftNotice({ alarmEnabled, mode, shiftDefined, shiftNow }));
  for (const m of KIPLER) {
    const olcum = [N(true, m, false, false), N(true, m, true, false), N(true, m, true, true), N(false, m, false, false)].join(",");
    const beklenen = m === "ALWAYS" ? "null,null,null,null" : "NO_SHIFT_DEFINED,NO_SHIFT_NOW,null,null";
    check(`§9c ${m}: şerit (tanımsız · tanımlı ama dışı · içi · alarm kapalı)`, olcum === beklenen, olcum);
  }
  check("§9c2 şu an canlı vardiya varsa (tanım sonradan arşivlense de) şerit yok — alarm şu an doğabilir", N(true, "WARN", false, true) === "null");
  const kilit = KIPLER.map((m) => `${m}:${alarmEnableBlocked(m, false)}/${alarmEnableBlocked(m, true)}`).join(" ");
  check("§9c3 açma kilidi yalnız REQUIRE_SHIFT ∧ tanımsız", kilit === "WARN:false/false ALWAYS:false/false REQUIRE_SHIFT:true/false", kilit);

  // §9d DB matrisi — fikstür vardiyaları [−180, 60] + [60, 300]; çevrede yabancı vardiya yok (§0b). Hedef 10, pay 5.
  //   tanımsız: −300'de açıldı, an −260 (hiç vardiya penceresi yok) · dışı: −240'ta açıldı, vardiyalardan geçti, an
  //   +330 (vardiya bitti) · içi: −12'de açıldı (kip başına ayrı tezgah — doğuş bir kez olur).
  const ac = async (n: number, dk: number) => (await openManualStop({ machineId: await tezgah(n), startedAt: at(-dk), reasonCode: preset.code })).data;
  const T = await ac(20, 300);
  const D = await ac(21, 240);
  const I: Record<TezgahAlarmNoShiftMode, Awaited<ReturnType<typeof ac>>> = { WARN: await ac(22, 12), REQUIRE_SHIFT: await ac(23, 12), ALWAYS: await ac(24, 12) };
  const ANLAR = { T: at(-260), D: at(330), I: simdi };
  const kd = async (stopId: string) => {
    const a = await alarmOf(stopId);
    return a ? `k1=${(a.k1DueAt.getTime() - simdi.getTime()) / MIN}` : "yok";
  };
  const satir: string[] = [];
  // ALWAYS en son koşar: tanımsız/dışı duruşlar önceki kiplerde doğmamış olmalı.
  for (const m of ["WARN", "REQUIRE_SHIFT", "ALWAYS"] as const) {
    await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, m);
    ozet(await tur(ANLAR.T, [T.machineId]));
    ozet(await tur(ANLAR.D, [D.machineId]));
    ozet(await tur(ANLAR.I, [I[m].machineId]));
    satir.push(`${m}[${await kd(T.id)} ${await kd(D.id)} ${await kd(I[m].id)}]`);
  }
  check("§9d motor: WARN/REQUIRE_SHIFT tanımsız ve vardiya dışında doğurmaz, içinde doğurur; ALWAYS üçünde de doğurur, saat duruş başından",
    satir.join(" ") === "WARN[yok yok k1=-2] REQUIRE_SHIFT[yok yok k1=-2] ALWAYS[k1=-290 k1=-230 k1=-2]", satir.join(" "));
  const dA = await alarmOf(D.id);
  check("§9d2 ALWAYS vardiya dışı geç kayıt: kademe atlama kuralı aynı (TIER_SKIPPED1, RAISED2)", olaylar(dA) === "TIER_SKIPPED1,RAISED2", olaylar(dA));

  // §9e Tezgah Salonu AYNI saat — ALWAYS'te K1 − hedef = salonun clockStartedAt'i; WARN'da taşan duruş vardiya başından.
  const salon = async (an: Date, machineId: string) => (await getLoomFloor(an)).data?.looms.find((l) => l.id === machineId)?.openStop ?? null;
  const ayni: string[] = [];
  for (const [stop, an] of [[T, ANLAR.T], [D, ANLAR.D], [I.ALWAYS, ANLAR.I]] as const) {
    const a = await alarmOf(stop.id);
    const o = await salon(an, stop.machineId);
    ayni.push(String(!!a && !!o && a.targetMinutes !== null && o.clockStartedAt.getTime() === a.k1DueAt.getTime() - a.targetMinutes * MIN));
  }
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, "WARN");
  const oW = await salon(ANLAR.D, D.machineId);
  check("§9e Tezgah Salonu motorla AYNI saat: ALWAYS üç durumda clockStartedAt = K1 − hedef; WARN'da taşan duruş vardiya başından (−180)",
    ayni.join(",") === "true,true,true" && oW?.clockStartedAt.getTime() === at(-180).getTime(), `${ayni.join(",")} warn=${oW?.clockStartedAt.toISOString()}`);

  // §9f REQUIRE_SHIFT sunucu kapısı — tezgah modülü KAPALI tutulur: ham alarm bayrağı açılsa da ETKİN alarm
  // kapalı kalır, yabancı motor turu fikstüre dokunamaz (§7). Kapı ham bayrağa bakar.
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  const kullanici = { id: await testActorId() };
  const yaz = async (input: Record<string, unknown>): Promise<string> => {
    try {
      await systemSettingService.setFeatureFlags(input as never, kullanici.id);
      return "ok";
    } catch (e) {
      return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code)}` : `hata:${(e as Error).message}`;
    }
  };
  const durum = async () => `${JSON.stringify((await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.TEZGAH_ALARM_ENABLED } }))?.value)}/${await readTezgahAlarmNoShiftMode()}`;
  const yabanciTanim = await prisma.shiftDefinition.count({ where: { isActive: true } });
  if (yabanciTanim === 0) {
    const r1 = await yaz({ tezgahAlarmNoShiftMode: "REQUIRE_SHIFT", tezgahAlarmEnabled: true });
    const d1 = await durum();
    check("§9f tanım yokken REQUIRE_SHIFT + aç → 400 TEZGAH_ALARM_SHIFT_REQUIRED ve HİÇBİR ŞEY yazılmadı", r1 === "400:TEZGAH_ALARM_SHIFT_REQUIRED" && d1 === "false/WARN", `${r1} ${d1}`);
    const r2 = await yaz({ tezgahAlarmNoShiftMode: "REQUIRE_SHIFT" });
    const r3 = await yaz({ tezgahAlarmEnabled: true });
    const d3 = await durum();
    check("§9f2 alarm kapalıyken kip seçilebilir; tanım yokken açmak 400", r2 === "ok" && r3 === "400:TEZGAH_ALARM_SHIFT_REQUIRED" && d3 === "false/REQUIRE_SHIFT", `${r2} ${r3} ${d3}`);
    const st = (await getAlarmShiftStatus(simdi)).data!;
    check("§9f3 durum ucu: tanım yok, engelli kip yalnız REQUIRE_SHIFT, etkin alarm kapalı → şerit yok",
      st.shiftDefined === false && st.enableBlockedModes.join(",") === "REQUIRE_SHIFT" && st.notice === null && st.mode === "REQUIRE_SHIFT", JSON.stringify(st));
  } else {
    console.log(`⚠ §9f tanımsız ayağı daraltıldı: ortamda ${yabanciTanim} yabancı aktif vardiya tanımı var (saf kilit §9c3 ölçüyor)`);
    await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, "REQUIRE_SHIFT");
  }
  const def = await prisma.shiftDefinition.create({ data: { code: `Y${ek.slice(-7)}`.toUpperCase(), name: `TEST-LA aktif ${ek}`, startMinute: 0, durationMinutes: 60, isActive: true } });
  ids.extraDefs.push(def.id);
  const r4 = await yaz({ tezgahAlarmEnabled: true });
  const st2 = (await getAlarmShiftStatus(simdi)).data!;
  const d4 = await durum();
  check("§9f4 aktif tanım varken REQUIRE_SHIFT'te açılır; durum ucu engelli kip yok", r4 === "ok" && d4 === "true/REQUIRE_SHIFT" && st2.shiftDefined && st2.enableBlockedModes.length === 0, `${r4} ${d4} ${JSON.stringify(st2)}`);
  await prisma.shiftDefinition.update({ where: { id: def.id }, data: { isActive: false } });
  if ((await prisma.shiftDefinition.count({ where: { isActive: true } })) === 0) {
    const r5 = await yaz({ tezgahAlarmEnabled: true, tezgahAlarmNoShiftMode: "REQUIRE_SHIFT" });
    const r6 = await yaz({ tezgahAlarmNoShiftMode: "WARN" });
    const r7 = await yaz({ tezgahAlarmNoShiftMode: "REQUIRE_SHIFT" });
    const r8 = await yaz({ tezgahAlarmEnabled: false });
    const d8 = await durum();
    check("§9f5 tanım sonradan kalktı: değişmeyen değer engellenmez · WARN'a geçilir · açıkken REQUIRE_SHIFT'e dönmek 400 · kapatmak serbest",
      [r5, r6, r7, r8].join(",") === "ok,ok,400:TEZGAH_ALARM_SHIFT_REQUIRED,ok" && d8 === "false/WARN", `${[r5, r6, r7, r8].join(",")} ${d8}`);
  }
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);

  // §9g şerit kararı TEK çağrı yerinde: salon ucu ve ayar ekranı ucu aynı fonksiyondan (`alarmShiftState`).
  const cagri = tsDosyalari(path.join(__dirname, "..", "src")).flatMap((f) => {
    if (f.endsWith("loom-floor.helper.ts")) return [];
    const n = [...fs.readFileSync(f, "utf8").matchAll(/\balarmShiftNotice\s*\(/g)].length;
    return n > 0 ? [`${path.basename(f)}:${n}`] : [];
  });
  check("§9g `alarmShiftNotice` üretim kaynağında (tanım dışında) yalnız loom-floor.service'te BİR kez çağrılır (salon + ayar ucu ortak)",
    cagri.join(",") === "loom-floor.service.ts:1", cagri.join(","));
}

// ── §10 sebepsiz duruş anahtarı ──────────────────────────────────────────────
async function sebepsizAnahtar({ at, simdi, tezgah }: KipCtx): Promise<void> {
  const EN = SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED;
  const DK = SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES;
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, "WARN");
  const etkin = async () => `${await readTezgahAlarmUnclassifiedEnabled()}/${await resolveTezgahAlarmUnclassifiedTarget()}`;
  // §10a okuyucu: satır yoksa süreden türer (bugünkü davranış); anahtar kapalıyken ham süre korunur.
  await prisma.systemSetting.deleteMany({ where: { key: EN } });
  await ayarYaz(DK, 15);
  const a1 = await etkin();
  await ayarYaz(DK, 0);
  const a2 = await etkin();
  await ayarYaz(DK, 15);
  await ayarYaz(EN, false);
  const a3 = await etkin();
  const ham = await readTezgahAlarmUnclassifiedTargetMinutes();
  check("§10a okuyucu: satır yok + süre 15 → açık/15 · satır yok + boş → kapalı/null · anahtar kapalı → etkin null, ham süre 15 korunur",
    a1 === "true/15" && a2 === "false/null" && a3 === "false/null" && ham === 15, `${a1} ${a2} ${a3} ham=${ham}`);

  // §10b motor + salon: anahtar kapalıyken sebepsiz duruş alarm doğurmaz, salon hedef göstermez; açılınca doğar.
  const E = (await openManualStop({ machineId: await tezgah(30), startedAt: at(-20) })).data;
  const salonHedef = async () => (await getLoomFloor(simdi)).data?.looms.find((l) => l.id === E.machineId)?.openStop?.targetMinutes ?? null;
  ozet(await tur(simdi, [E.machineId]));
  const kapaliAlarm = await alarmOf(E.id);
  const kapaliSalon = await salonHedef();
  await ayarYaz(EN, true);
  ozet(await tur(simdi, [E.machineId]));
  const acikAlarm = await alarmOf(E.id);
  const acikSalon = await salonHedef();
  check("§10b anahtar KAPALI: sebepsiz duruş alarm doğurmaz, salon hedef göstermez · AÇIK: ortak hedefle (15) doğar, K1 = açılış + 15",
    kapaliAlarm === null && kapaliSalon === null && acikAlarm?.targetMinutes === 15 && acikAlarm.k1DueAt.getTime() === at(-5).getTime() && acikSalon === 15,
    `kapalı=${kapaliAlarm?.id ?? "yok"}/${kapaliSalon} açık=${acikAlarm?.targetMinutes}/${acikSalon}`);

  // §10c yazma kapısı + eski istemci. Kapı her yazmadan ÖNCE: 400'de hiçbir şey yazılmaz.
  const kullanici = { id: await testActorId() };
  const yaz = async (input: Record<string, unknown>): Promise<string> => {
    try {
      await systemSettingService.setFeatureFlags(input as never, kullanici.id);
      return "ok";
    } catch (e) {
      return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code)}` : `hata:${(e as Error).message}`;
    }
  };
  const durum = async () => `${await readTezgahAlarmUnclassifiedEnabled()}/${await readTezgahAlarmUnclassifiedTargetMinutes()}`;
  const KOD = "400:TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED";
  await ayarYaz(EN, false);
  await ayarYaz(DK, 15);
  const adimlar: string[] = [];
  const adim = async (input: Record<string, unknown>) => adimlar.push(`${await yaz(input)}→${await durum()}`);
  await adim({ tezgahAlarmUnclassifiedEnabled: true, tezgahAlarmUnclassifiedTargetMinutes: null });
  await ayarYaz(DK, 0);
  await adim({ tezgahAlarmUnclassifiedEnabled: true });
  await adim({ tezgahAlarmUnclassifiedEnabled: true, tezgahAlarmUnclassifiedTargetMinutes: 20 });
  await adim({ tezgahAlarmUnclassifiedEnabled: false });
  invalidateFeatureFlagsCache();
  const ff = (await systemSettingService.getFeatureFlags()).data!;
  check("§10c açıkken süre zorunlu (gövdede boş ya da kayıtlı boş → 400, HİÇBİR ŞEY yazılmadı) · süreyle açılır · kapatmak süreyi SİLMEZ",
    adimlar.join(" ") === `${KOD}→false/15 ${KOD}→false/null ok→true/20 ok→false/20` && ff.tezgahAlarmUnclassifiedEnabled === false && ff.tezgahAlarmUnclassifiedTargetMinutes === 20,
    `${adimlar.join(" ")} ff=${ff.tezgahAlarmUnclassifiedEnabled}/${ff.tezgahAlarmUnclassifiedTargetMinutes}`);
  adimlar.length = 0;
  await adim({ tezgahAlarmUnclassifiedTargetMinutes: 25 });
  await adim({ tezgahAlarmUnclassifiedTargetMinutes: null });
  check("§10c2 eski istemci (yalnız süre): sayı → açık, boş → kapalı — bugünkü anlamı korunur, 400'e takılmaz",
    adimlar.join(" ") === "ok→true/25 ok→false/null", adimlar.join(" "));

  // §10d etkin hedef TEK resolver'dan: ham süre okuyucusu üretim kaynağında yalnız ayar servisinde çağrılır.
  const ham2 = tsDosyalari(path.join(__dirname, "..", "src")).flatMap((f) => {
    if (f.endsWith("system-setting.service.ts")) return [];
    return /\breadTezgahAlarmUnclassifiedTargetMinutes\s*\(/.test(fs.readFileSync(f, "utf8")) ? [path.basename(f)] : [];
  });
  check("§10d motor ve salon sebepsiz hedefi `resolveTezgahAlarmUnclassifiedTarget`ten okur (ham süre okuyucusu yalnız ayar servisinde)", ham2.length === 0, ham2.join(","));
}

/** Saat helper'larının dışında: StopClock biçimli nesne (anahtarları yalnız saat alanları, startedAt + targetMinutes dahil) ya da doğrudan vardiya süzgeci. */
const SAAT_HELPERLARI = new Set(["services/helpers/loom-floor.helper.ts", "services/helpers/loom-alarm-shift.helper.ts"]);
function tekSaatKaynak(kaynak: string, ad: string): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const yer = (n: ts.Node) => `${ad}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const adlar = new Set(n.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "")));
      const saatAnahtari = (k: string) => k === "startedAt" || k === "targetMinutes" || k === "graceMinutes" || k === "lossClass";
      if (adlar.has("startedAt") && adlar.has("targetMinutes") && [...adlar].every(saatAnahtari)) out.push(yer(n));
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "alarmShiftEligible") out.push(yer(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function tekSaatIhlalleri(kok: string): string[] {
  return tsDosyalari(kok)
    .map((f) => ({ f, rel: path.relative(kok, f).split(path.sep).join("/") }))
    .filter(({ rel }) => !SAAT_HELPERLARI.has(rel))
    .flatMap(({ f, rel }) => tekSaatKaynak(fs.readFileSync(f, "utf8"), rel));
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
    if (ids.shifts.length) await prisma.shiftInstance.deleteMany({ where: { id: { in: ids.shifts } } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    if (ids.extraDefs.length) await prisma.shiftDefinition.deleteMany({ where: { id: { in: ids.extraDefs } } });
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
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
