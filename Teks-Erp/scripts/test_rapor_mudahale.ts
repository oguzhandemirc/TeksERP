// =============================================================================
// BEKÇİ — DOKUMA · MÜDAHALE / ÇÖZÜM SÜRESİ RAPORU (B4, `reports/alarm-response.report.service`)
// =============================================================================
//   §1 hesap doğruluğu: bilinen süreli fikstür (2020-03-10 fabrika günü — başka bekçinin alarmı bu güne düşmez) →
//      özet: alarm/iptal sayısı, ort. üstlenme (ilk ACK; bırakıp başkası üstlense de ilk sayılır), ort. çözüm
//      (donmuş closedAt − ilk doğuş), hedef aşımı (K2 çaldı ∨ çözüm > k2DueAt; belirsiz/hedefsiz/iptal paydada değil)
//   §2 kırılımlar: sebep (sebepsiz kovası) · hol · tezgah · vardiya (gece yarısını aşan vardiya · 14:00 sınırı
//      sonraki vardiyada · bitişin tam anı ardı boşluksa "Vardiyasız") · kişi
//   §3 pencere = FABRİKA günü: günün ilk ve son anı dahil, ertesi günün ilk anı ve önceki günün son anı hariç;
//      UTC günüyle ayrışan iki an (yerel 01:00 iki tarafta) doğru tarafa düşer; ilk doğuşu pencere dışında olup
//      K2'si pencereye düşen alarm SAYILMAZ · ters aralık 400
//   §4 yetki: `withPeople:false` → `kisiler` anahtarı YOK; route kararı tek yüklemden (`hasAlarmEscalation`, elle
//      literal yok) · HTTP (sunucu varsa): yalnız `report:production` → kisiler yok; + `loom:alarm-escalation` → var
//
// NEGATİF SONDALAR (2026-10-13, geri alındı): ① ilk ACK yerine son ACK → §1c/§2k ❌ · ② aşımda yalnız K2 olayı
// (k2DueAt kıyası yok) → §1e ❌ · ③ vardiya yüklemi `endsAt >= an` → §2g/§2h ❌ · ④ pencere UTC günü → §3a/§3b ❌ ·
// ⑤ route `withPeople: true` sabit → §4b ❌ (statik) · ⑥ t0 = penceredeki ilk doğuş olayı → §3c ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import { LoomAlarmEventKind, LoomAlarmKind, LoomAlarmState, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { factoryDayEndOfKey, factoryDayStartOfKey } from "../src/constants/time";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { alarmResponseReport, type AlarmResponseRow } from "../src/services/reports/alarm-response.report.service";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const ATLAMA = atlamaDefteri(() => { fail++; });
const MIN = 60_000;
const ek = Date.now().toString(36);
const GUN = "2020-03-10";
const S = factoryDayStartOfKey(GUN);
const E = factoryDayEndOfKey(GUN);
const at = (dk: number, base: Date = S): Date => new Date(base.getTime() + dk * MIN);
const ids = { stations: [] as string[], looms: [] as string[], presets: [] as string[], users: [] as string[], defs: [] as string[] };

type Ev = { kind: LoomAlarmEventKind; at: Date; tier?: number; userId?: string };
async function alarmKur(o: {
  machineId: string; reasonCode: string | null; t0: Date; state: LoomAlarmState; closedAt?: Date; k2DueAt: Date | null; events: Ev[];
}): Promise<string> {
  const stop = await prisma.machineStopEvent.create({
    data: {
      machineId: o.machineId, stopKey: randomUUID(), startedAt: at(-15, o.t0), factoryDay: new Date(`${GUN}T00:00:00Z`), source: "OPERATOR",
      // Duruş hep kapalı yazılır (tezgah başına tek açık duruş seddi); rapor duruşun bitişini değil alarmın durumunu okur.
      reasonCode: o.reasonCode, endedAt: o.closedAt ?? at(1, o.t0),
    },
  });
  const ack = [...o.events].reverse().find((e) => e.kind === LoomAlarmEventKind.ACK);
  const acked = o.state === LoomAlarmState.ACKED;
  const id = randomUUID();
  const terminal = o.state === LoomAlarmState.RESOLVED || o.state === LoomAlarmState.CANCELLED;
  await prisma.loomAlarm.create({
    data: {
      id, kind: LoomAlarmKind.STOP_OVERDUE, stopEventId: stop.id, machineId: o.machineId, state: o.state,
      tier: o.events.some((e) => e.kind === LoomAlarmEventKind.RAISED && e.tier === 2) ? 2 : 1,
      targetMinutes: o.k2DueAt ? 10 : null, graceMinutes: 5, planReasonCode: o.reasonCode, k1DueAt: o.t0, k2DueAt: o.k2DueAt,
      ...(acked && ack ? { ackedById: ack.userId!, ackedAt: ack.at } : {}),
      ...(terminal ? { closedAt: o.closedAt ?? at(1, o.t0) } : {}),
      ...(o.state === LoomAlarmState.CANCELLED ? { cancelReason: "STOP_REVOKED" } : {}),
      createdAt: o.t0,
    },
  });
  for (const e of o.events) {
    await prisma.loomAlarmEvent.create({ data: { alarmId: id, kind: e.kind, tier: e.tier ?? null, userId: e.userId ?? null, code: e.kind === LoomAlarmEventKind.CANCELLED ? "STOP_REVOKED" : null, createdAt: e.at } });
  }
  return id;
}

const satir = (rows: AlarmResponseRow[] | undefined, etiket: string): AlarmResponseRow | undefined => rows?.find((r) => r.etiket === etiket);
const ozetMetni = (r: AlarmResponseRow | undefined): string =>
  r ? `alarm=${r.alarm} iptal=${r.iptal} ack=${r.ustlenmeOrtSn} coz=${r.cozumOrtSn} asim=${r.asim}/${r.zamaninda} bel=${r.belirsiz} hs=${r.hedefsiz} %=${r.asimOraniPct}` : "YOK";

async function govde(): Promise<void> {
  const hol = async (n: string): Promise<{ id: string; name: string }> => {
    const s = await prisma.station.create({ data: { name: `TEST-RMD-HOL${n}-${ek}`, code: `TEST-RMD-H${n}-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
    ids.stations.push(s.id);
    return { id: s.id, name: s.name };
  };
  const H1 = await hol("1");
  const H2 = await hol("2");
  const tezgah = async (n: string, stationId: string): Promise<{ id: string; label: string }> => {
    const code = `TEST-RMD-T${n}-${ek}`.toUpperCase().slice(0, 32);
    const m = await prisma.machine.create({ data: { stationId, name: `TEST-RMD-T${n}-${ek}`, code, isActive: true } });
    ids.looms.push(m.id);
    return { id: m.id, label: `${m.code} · ${m.name}` };
  };
  const M1 = await tezgah("1", H1.id);
  const M2 = await tezgah("2", H2.id);
  const P1 = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-RMD ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  const P2 = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-RMD iplik ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  ids.presets.push(P1.id, P2.id);
  const kisi = async (n: string): Promise<{ id: string; name: string }> => {
    const u = await prisma.user.create({ data: { username: `test-rmd-${n}-${ek}`, fullName: `TEST-RMD ${n} ${ek}`, passwordHash: "x", isActive: false }, select: { id: true, fullName: true } });
    ids.users.push(u.id);
    return { id: u.id, name: u.fullName };
  };
  const ahmet = await kisi("ahmet");
  const veli = await kisi("veli");

  // Vardiyalar (PASİF tanım — "vardiya tanımlı mı" sorusunu başka bekçiler için değiştirmez; örnek canlı):
  // Gece 22:00→06:00 (önceki günden taşar + günün gecesi) · Gündüz 06:00→14:00 · Akşam 14:00→21:00 · 21:00–22:00 BOŞLUK.
  const tanim = async (code: string, name: string, startMinute: number, durationMinutes: number): Promise<{ id: string; name: string }> => {
    const d = await prisma.shiftDefinition.create({ data: { code: `${code}${ek.slice(-7)}`.toUpperCase(), name: `${name} ${ek}`, startMinute, durationMinutes, isActive: false } });
    ids.defs.push(d.id);
    return { id: d.id, name: d.name };
  };
  const gece = await tanim("G", "TEST-RMD Gece", 22 * 60, 480);
  const gunduz = await tanim("D", "TEST-RMD Gündüz", 6 * 60, 480);
  const aksam = await tanim("A", "TEST-RMD Akşam", 14 * 60, 420);
  const ornek = async (def: string, dayKey: string, startsAt: Date, endsAt: Date): Promise<void> => {
    await prisma.shiftInstance.create({ data: { shiftDefinitionId: def, factoryDayKey: new Date(`${dayKey}T00:00:00Z`), startsAt, endsAt } });
  };
  await ornek(gece.id, "2020-03-09", at(-120), at(360));
  await ornek(gunduz.id, GUN, at(360), at(840));
  await ornek(aksam.id, GUN, at(840), at(1260));
  await ornek(gece.id, GUN, at(1320), at(1800));

  const R = LoomAlarmEventKind.RAISED;
  const SK = LoomAlarmEventKind.TIER_SKIPPED;
  const ACK = LoomAlarmEventKind.ACK;
  const REL = LoomAlarmEventKind.ACK_RELEASE;
  const UZAK = new Date("2099-01-01T00:00:00Z");
  // A1 Gece(01:00) · ilk üstlenen Ahmet +5 (bırakıp Veli +8 üstlenir) · çözüm +20 · K2 vadesi +15, K2 ÇALMADI (üstlenince bekler) → aşım
  let t = at(60);
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(20, t), k2DueAt: at(15, t),
    events: [{ kind: R, tier: 1, at: t }, { kind: ACK, userId: ahmet.id, at: at(5, t) }, { kind: REL, userId: ahmet.id, at: at(6, t) }, { kind: ACK, userId: veli.id, at: at(8, t) }] });
  // A2 Akşam (TAM 14:00 — sınır sonraki vardiyanın) · Veli +3 · K2 +10 çaldı · çözüm +30 → aşım
  t = at(840);
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(30, t), k2DueAt: at(10, t),
    events: [{ kind: R, tier: 1, at: t }, { kind: ACK, userId: veli.id, at: at(3, t) }, { kind: R, tier: 2, at: at(10, t) }] });
  // A3 Gündüz 08:00 · Ahmet +10 · çözüm +12 · K2 +15 → zamanında
  t = at(480);
  await alarmKur({ machineId: M2.id, reasonCode: P2.code, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(12, t), k2DueAt: at(15, t),
    events: [{ kind: R, tier: 1, at: t }, { kind: ACK, userId: ahmet.id, at: at(10, t) }] });
  // A4 Gündüz 09:00 · sebepsiz · üstlenilmedi · çözüm +6 · K2 +10 → zamanında
  t = at(540);
  await alarmKur({ machineId: M2.id, reasonCode: null, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(6, t), k2DueAt: at(10, t), events: [{ kind: R, tier: 1, at: t }] });
  // A5 Gece (günün SON anı 23:59:59.999 — pencere dahil) · canlı, K2 vadesi uzak → belirsiz
  t = E;
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: t, state: LoomAlarmState.OPEN, k2DueAt: UZAK, events: [{ kind: R, tier: 1, at: t }] });
  // A6 Gündüz 10:00 · İPTAL (üstlenilmişti) → ölçülerden çıkar, sayılır
  t = at(600);
  await alarmKur({ machineId: M2.id, reasonCode: P2.code, t0: t, state: LoomAlarmState.CANCELLED, closedAt: at(4, t), k2DueAt: at(10, t),
    events: [{ kind: R, tier: 1, at: t }, { kind: ACK, userId: ahmet.id, at: at(2, t) }, { kind: LoomAlarmEventKind.CANCELLED, at: at(4, t) }] });
  // A7 Gündüz 11:00 · Veli +1 · çözüm +40 · plan yok (k2DueAt NULL) → hedefsiz
  t = at(660);
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(40, t), k2DueAt: null,
    events: [{ kind: R, tier: 1, at: t }, { kind: ACK, userId: veli.id, at: at(1, t) }] });
  // A8 Gündüz 12:00 · geç girilen kayıt: K1 ATLANDI + K2 çaldı (doğuş = ATLANDI satırı) · çözüm +2 → aşım
  t = at(720);
  await alarmKur({ machineId: M2.id, reasonCode: P2.code, t0: t, state: LoomAlarmState.RESOLVED, closedAt: at(2, t), k2DueAt: at(-1, t),
    events: [{ kind: SK, tier: 1, at: t }, { kind: R, tier: 2, at: new Date(t.getTime() + 1) }] });
  // A9 TAM 21:00 (Akşam'ın bitişi, ardından BOŞLUK) → Vardiyasız (bitiş anı vardiyaya ait değil) · sebepsiz · canlı → belirsiz
  t = at(1260);
  await alarmKur({ machineId: M2.id, reasonCode: null, t0: t, state: LoomAlarmState.OPEN, k2DueAt: UZAK, events: [{ kind: R, tier: 1, at: t }] });
  // Pencere DIŞI: ertesi günün ilk anı · ertesi gün yerel 01:00 (UTC'de hâlâ 10'u) · önceki günün son anı (K2'si pencerede)
  const ertesi = factoryDayStartOfKey("2020-03-11");
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: ertesi, state: LoomAlarmState.OPEN, k2DueAt: UZAK, events: [{ kind: R, tier: 1, at: ertesi }] });
  await alarmKur({ machineId: M1.id, reasonCode: P1.code, t0: at(60, ertesi), state: LoomAlarmState.OPEN, k2DueAt: UZAK, events: [{ kind: R, tier: 1, at: at(60, ertesi) }] });
  const once = new Date(S.getTime() - 1);
  await alarmKur({ machineId: M2.id, reasonCode: P2.code, t0: once, state: LoomAlarmState.RESOLVED, closedAt: at(30), k2DueAt: at(5),
    events: [{ kind: R, tier: 1, at: once }, { kind: R, tier: 2, at: at(5) }] });

  // ── §1 ÖZET ────────────────────────────────────────────────────────────────
  const yetkili = (await alarmResponseReport({ from: GUN, to: GUN, withPeople: true })).data;
  const o = yetkili.ozet;
  console.log(`   özet: ${JSON.stringify(o)}`);
  check("§1a iptal dışı alarm 8, iptal 1 (pencere dışı 3 alarm sayılmadı)", o.alarm === 8 && o.iptal === 1, `${o.alarm}/${o.iptal}`);
  check("§1b üstlenilen 4 (iptalin üstlenmesi ölçüye girmez)", o.ustlenilen === 4, `${o.ustlenilen}`);
  check("§1c ort. üstlenme = (5+3+10+1)/4 dk = 285 sn (ilk ACK; bırakılıp devredilen alarmda ilk üstlenen)", o.ustlenmeOrtSn === 285, `${o.ustlenmeOrtSn}`);
  check("§1d ort. çözüm = (20+30+12+6+40+2)/6 dk = 1100 sn (donmuş kapanış − ilk doğuş)", o.cozulen === 6 && o.cozumOrtSn === 1100, `${o.cozulen} · ${o.cozumOrtSn}`);
  check("§1e aşım 3 (K2 çalmadan geç çözülen dahil) · zamanında 2 · belirsiz 2 · hedefsiz 1", o.asim === 3 && o.zamaninda === 2 && o.belirsiz === 2 && o.hedefsiz === 1,
    `${o.asim}/${o.zamaninda}/${o.belirsiz}/${o.hedefsiz}`);
  check("§1f hedef aşım oranı %60,0 (payda yalnız sonucu belli olanlar)", o.asimOraniPct === 60, `${o.asimOraniPct}`);

  // ── §2 KIRILIMLAR ──────────────────────────────────────────────────────────
  const p1 = satir(yetkili.sebepler, P1.label);
  const p2 = satir(yetkili.sebepler, P2.label);
  const sebepsiz = satir(yetkili.sebepler, "Sebepsiz");
  check("§2a sebep P1: 4 alarm · üstlenme 180 · çözüm 1800 · aşım 2/0 · %100", p1?.alarm === 4 && p1.ustlenmeOrtSn === 180 && p1.cozumOrtSn === 1800 && p1.asim === 2 && p1.zamaninda === 0 && p1.asimOraniPct === 100, ozetMetni(p1));
  check("§2b sebep P2: 2 alarm + 1 iptal · üstlenme 600 · çözüm 420 · %50", p2?.alarm === 2 && p2.iptal === 1 && p2.ustlenmeOrtSn === 600 && p2.cozumOrtSn === 420 && p2.asimOraniPct === 50, ozetMetni(p2));
  check("§2c sebepsiz kova: 2 alarm · üstlenme yok (null) · çözüm 360 · %0", sebepsiz?.alarm === 2 && sebepsiz.ustlenmeOrtSn === null && sebepsiz.cozumOrtSn === 360 && sebepsiz.asimOraniPct === 0, ozetMetni(sebepsiz));
  const h1 = satir(yetkili.holler, H1.name);
  const h2 = satir(yetkili.holler, H2.name);
  check("§2d hol: H1 4 alarm · H2 4 alarm + 1 iptal", h1?.alarm === 4 && h2?.alarm === 4 && h2.iptal === 1, `${ozetMetni(h1)} | ${ozetMetni(h2)}`);
  const m1 = satir(yetkili.tezgahlar, M1.label);
  check("§2e tezgah M1: 4 alarm · çözüm 1800", m1?.alarm === 4 && m1.cozumOrtSn === 1800, ozetMetni(m1));
  const vG = satir(yetkili.vardiyalar, gece.name);
  const vD = satir(yetkili.vardiyalar, gunduz.name);
  const vA = satir(yetkili.vardiyalar, aksam.name);
  const vY = satir(yetkili.vardiyalar, "Vardiyasız");
  check("§2f Gece: önceki günden taşan vardiyanın 01:00'i + günün son anı = 2 alarm (aynı tanım)", vG?.alarm === 2, ozetMetni(vG));
  check("§2g vardiya sınırı: TAM 14:00 doğan alarm Akşam'da (1), Gündüz 4 alarm + 1 iptal", vA?.alarm === 1 && vD?.alarm === 4 && vD.iptal === 1, `${ozetMetni(vA)} | ${ozetMetni(vD)}`);
  check("§2h vardiya bitişinin TAM anında (ardı boşluk) doğan alarm 'Vardiyasız' kovasında", vY?.alarm === 1, ozetMetni(vY));
  const kA = satir(yetkili.kisiler, ahmet.name);
  const kV = satir(yetkili.kisiler, veli.name);
  const kN = satir(yetkili.kisiler, "Üstlenilmedi");
  check("§2i kişi Ahmet: 2 alarm + 1 iptal · üstlenme 450 · çözüm 960 · %50", kA?.alarm === 2 && kA.iptal === 1 && kA.ustlenmeOrtSn === 450 && kA.cozumOrtSn === 960 && kA.asimOraniPct === 50, ozetMetni(kA));
  check("§2j kişi Veli: 2 alarm · üstlenme 120 · çözüm 2100 · %100 (hedefsiz paydada değil)", kV?.alarm === 2 && kV.ustlenmeOrtSn === 120 && kV.cozumOrtSn === 2100 && kV.asimOraniPct === 100, ozetMetni(kV));
  check("§2k 'Üstlenilmedi' kovası 4 alarm (A1'i sonradan üstlenen Veli'ye yazılmadı)", kN?.alarm === 4, ozetMetni(kN));
  const toplam = (rows: AlarmResponseRow[] | undefined): number => (rows ?? []).reduce((s, r) => s + r.alarm, 0);
  check("§2l her eksenin satır toplamı = özet (eksen bir bölüntü)", [yetkili.sebepler, yetkili.holler, yetkili.vardiyalar, yetkili.kisiler].every((r) => toplam(r) === o.alarm),
    [yetkili.sebepler, yetkili.holler, yetkili.vardiyalar, yetkili.kisiler].map(toplam).join("/"));

  // ── §3 PENCERE ─────────────────────────────────────────────────────────────
  const ertesiRapor = (await alarmResponseReport({ from: "2020-03-11", to: "2020-03-11", withPeople: false })).data;
  check("§3a fabrika günü: ertesi günün ilk anı + yerel 01:00'i (UTC'de hâlâ 10 Mart) ERTESİ günde = 2", ertesiRapor.ozet.alarm === 2, `${ertesiRapor.ozet.alarm}`);
  const onceki = (await alarmResponseReport({ from: "2020-03-09", to: "2020-03-09", withPeople: false })).data;
  check("§3b önceki günün son anı (23:59:59.999) önceki günde = 1", onceki.ozet.alarm === 1, `${onceki.ozet.alarm}`);
  check("§3c ilk doğuşu pencere dışında, K2'si içinde olan alarm sayılmadı (§1a'daki 8'in parçası) ve önceki günde aşım", onceki.ozet.asim === 1 && o.alarm === 8, `${onceki.ozet.asim}`);
  const ters = await alarmResponseReport({ from: "2020-03-11", to: "2020-03-10", withPeople: false }).then(() => null, (e: { statusCode?: number }) => e.statusCode ?? -1);
  check("§3d ters aralık 400", ters === 400, `${ters}`);

  // ── §4 YETKİ ───────────────────────────────────────────────────────────────
  const yetkisiz = (await alarmResponseReport({ from: GUN, to: GUN, withPeople: false })).data;
  check("§4a withPeople:false → `kisiler` anahtarı YOK, kisiKirilimi false; özet aynı", !("kisiler" in yetkisiz) && yetkisiz.kisiKirilimi === false && yetkisiz.ozet.alarm === o.alarm);
  const route = readFileSync(join(__dirname, "../src/routes/reports/dokuma.report.routes.ts"), "utf8");
  const blok = route.slice(route.indexOf('router.get("/mudahale"'));
  check("§4b route kişi kararı tek yüklemden (`hasAlarmEscalation(req.user…)`), literal izin kopyası yok",
    /withPeople:\s*hasAlarmEscalation\(req\.user\?\.permissions \?\? \[\]\)/.test(blok) && !/loom:alarm-escalation/.test(blok.slice(0, blok.indexOf("export default"))));
  await httpBolumu();
}

// ── §4c HTTP (sunucu varsa) ─────────────────────────────────────────────────
const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 3;
async function httpBolumu(): Promise<void> {
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("§4c HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("§4c HTTP", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const ilk = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, create: { key: SETTING_KEYS.DOKUMA_ENABLED, value: true }, update: { value: true } });
  try {
    const perm = new Map((await prisma.permission.findMany({ where: { code: { in: ["report:production", "loom:alarm-escalation", "loom:alarm-view"] } }, select: { id: true, code: true } })).map((p) => [p.code, p.id]));
    const giris = async (n: string, codes: string[]): Promise<string | null> => {
      const password = `Rmd-${randomUUID()}`;
      const username = `test-rmd-h${n}-${ek}`;
      const u = await prisma.user.create({ data: { username, fullName: `TEST-RMD h${n} ${ek}`, passwordHash: await bcrypt.hash(password, 4), isActive: true }, select: { id: true } });
      ids.users.push(u.id);
      for (const c of codes) await prisma.userPermission.create({ data: { userId: u.id, permissionId: perm.get(c)! } });
      const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return r.ok ? ((await r.json()) as { data?: { token?: string } }).data?.token ?? null : null;
    };
    const getir = async (tok: string | null): Promise<{ status: number; data?: Record<string, unknown> }> => {
      const r = await fetch(`${BASE}/api/reports/dokuma/mudahale?from=${GUN}&to=${GUN}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
      return { status: r.status, data: ((await r.json().catch(() => ({}))) as { data?: Record<string, unknown> }).data };
    };
    const dar = await getir(await giris("dar", ["report:production"]));
    check("§4c HTTP yalnız report:production → 200, kisiler YOK", dar.status === 200 && dar.data !== undefined && !("kisiler" in dar.data) && dar.data.kisiKirilimi === false, `${dar.status}`);
    const amir = await getir(await giris("amir", ["report:production", "loom:alarm-escalation"]));
    check("§4d HTTP + loom:alarm-escalation → kisiler VAR", amir.status === 200 && Array.isArray(amir.data?.kisiler) && amir.data?.kisiKirilimi === true, `${amir.status}`);
    // Masaüstüne girebilen ama rapor izni olmayan hesap (izinsiz hesap giriş bile yapamaz).
    const yok = await getir(await giris("yok", ["loom:alarm-view", "loom:alarm-escalation"]));
    check("§4e HTTP report:production yok (alarm üst kademesi olsa da) → 403", yok.status === 403, `${yok.status}`);
  } finally {
    if (ilk) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DOKUMA_ENABLED } });
  }
}

async function cleanup(): Promise<void> {
  try {
    if (ids.looms.length) {
      // Fikstür temizliği: alarm silinir, olaylar kaskatla gider — üretim yolu değil.
      await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.looms } } });
      await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.looms } } });
      await prisma.machine.deleteMany({ where: { id: { in: ids.looms } } });
    }
    if (ids.defs.length) {
      await prisma.shiftInstance.deleteMany({ where: { shiftDefinitionId: { in: ids.defs } } });
      await prisma.shiftDefinition.deleteMany({ where: { id: { in: ids.defs } } });
    }
    if (ids.presets.length) await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    if (ids.users.length) {
      await prisma.systemLog.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.session.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => undefined);
      await prisma.userPermission.deleteMany({ where: { userId: { in: ids.users } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
  } catch (err) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (err as Error).message);
  }
}

console.log("\n=== Dokuma — müdahale / çözüm süresi raporu (B4) ===\n");
govde()
  .catch((err) => { fail++; console.error("❌ Bekçi hata ile durdu:", err); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
