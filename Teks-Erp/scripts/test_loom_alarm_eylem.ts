// =============================================================================
// BEKÇİ — DOKUMA ALARMI KİŞİ EYLEMLERİ + OKUMA (`loom-alarm.service` A1b · `loom-alarm-read.service`)
// =============================================================================
//   §1 üstlen: OPEN → ACKED, defterde ACK (kişi + token), audit izi · yarış: iki kişi aynı anda →
//      bir 200, bir 409 LOOM_ALARM_ALREADY_ACKED (kim + saat)
//   §2 replay dört durum: ilk · aynı token aynı yük (aynı satır, defter artmaz) · aynı token başka yük
//      (409 CLIENT_TOKEN_COLLISION; farklı alan adıyla) · ileri eylem sonradan geri alındı (409 CLIENT_TOKEN_REVOKED)
//   §3 bırak: başkasınınkini yetkisiz → 403 · üst kademe yetkilisi bırakır · üstlenilmemişe 409
//   §4 sustur / kaldır: kapalı süre kümesi · bitiş = olay anı + dk · kaldırma karşı olay · ikinci kaldırma 409
//   §5 not / geri çek: sahibi dışında 403 · not başına bir kez (yarışta bir 200 bir 409) · not olmayan satır 400
//   §6 kapanmış alarm: üstlen 409 LOOM_ALARM_CLOSED · not serbest
//   §7 liste: özet şeridi listeyle AYNI where (sayılar listeyle eşit) · cursor sayfaları tam ve ayrık ·
//      bozuk cursor 400 · kapsam süzgeci
//   §8 detay: zaman çizgisi defter sırasıyla, geri çekilen not işaretli · sonraki vade yalnız canlı K1'de
//   §9 Tezgah Salonu: K2 çalmış canlı alarm → `ESCALATED` + `alarmId` + iletim anı alarmın donmuş K2'si ·
//      alarm bayrağı kapalıyken alarm okunmaz
//   §10 AST: hedef/pay aritmetiği yalnız `helpers/loom-floor.helper`da (motor ve ekran aynı fonksiyon)
//   §11 uç kapısı: alarm bayrağı kapalı → 403 LOOM_ALARM_DISABLED
//   §13 uç izin matrisi: `mobile:tezgah-uyari` liste+detay+eylem; `mobile:dokuma` YALNIZ liste (tablet şeridi)
//   §12 yabancı motor: bayrak AÇIKKEN aynı DB'de gerçek saatle koşan sunucu zamanlayıcısı (CI'da beş HTTP
//      sunucusu) fikstürde iş bulmaz — K1'deki alarmların K2'si uzak gelecekte, her duruşun alarmı var
//
// Negatif sondalar (her biri kırmızı görüldü, geri alındı): ack claim'i yüklemsiz → §1c/§6a · replay
// ACK canlılık dalı yok → §2d · başkasını bırakma kapısı yok → §3a · retract P2002 dalı yok → §5d ·
// şerit `{}` where → §7a/§7e · salonda bayrak yüklemi yok → §9c · servis içinde `targetMinutes * 60000` → §10a ·
// K1 alarmlarının K2'si geçmişte (eski fikstür `at(-5)`) → §12a · §9b (yabancı tur K2 çaldı) · §8c.
//
// Global ayar yazar (`production.enabled` · `tezgah.enabled` · `tezgah.alarmEnabled` ·
// `tezgah.escalationGraceMinutes`); bulduğu değere `finally`de döner. Fikstür kendi tezgahlarını,
// kullanıcılarını ve alarm satırlarını kurar, temizlikte siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { LoomAlarmEventKind, LoomAlarmKind, LoomAlarmState, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { openManualStop } from "../src/services/machine-stop.service";
import {
  ackLoomAlarm, noteLoomAlarm, releaseLoomAlarm, retractLoomAlarmNote, runLoomAlarmOnce, snoozeLoomAlarm, unsnoozeLoomAlarm,
} from "../src/services/loom-alarm.service";
import { getLoomAlarmDetail, listLoomAlarms } from "../src/services/loom-alarm-read.service";
import { getLoomFloor } from "../src/services/loom-floor.service";
import loomAlarmRouter, { requireLoomAlarmEnabled } from "../src/routes/loom-alarm.routes";
import { walkTs } from "./lib/ts-tarama";

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
const ids = { station: "", looms: [] as string[], presets: [] as string[], users: [] as string[] };

const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ALARM_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES];
const ilk = new Map<string, unknown>();
async function ayarYaz(key: string, value: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Hata kodu (`details.code`) ve durum — beklenen hata yakalanır, beklenmeyen başarı "OK" döner. */
async function hataOf(p: Promise<unknown>): Promise<{ status: number | null; code: string | null; message: string; alanlar: string[] }> {
  try {
    await p;
    return { status: null, code: "OK", message: "", alanlar: [] };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string; farkliAlanlar?: string[] }; message?: string };
    return { status: err.statusCode ?? null, code: err.details?.code ?? null, message: err.message ?? "", alanlar: err.details?.farkliAlanlar ?? [] };
  }
}

async function main(): Promise<void> {
  console.log("\n=== Dokuma alarmı — kişi eylemleri · replay · liste/özet · detay · salon ===\n");
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
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 5);

  const simdi = new Date(Math.floor((Date.now() - 30 * MIN) / MIN) * MIN);
  const at = (dk: number) => new Date(simdi.getTime() + dk * MIN);
  const station = await prisma.station.create({
    data: { name: `TEST-LAE-HOL-${ek}`, code: `TEST-LAE-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  });
  ids.station = station.id;
  const P = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LAE ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  ids.presets.push(P.id);
  const kisi = async (n: string): Promise<{ id: string; name: string }> => {
    const u = await prisma.user.create({ data: { username: `test-lae-${n}-${ek}`, fullName: `TEST-LAE ${n} ${ek}`, passwordHash: "x", isActive: false }, select: { id: true, fullName: true } });
    ids.users.push(u.id);
    return { id: u.id, name: u.fullName };
  };
  const ahmet = await kisi("ahmet");
  const veli = await kisi("veli");
  const mudur = await kisi("mudur");

  // K1'deki alarmın K2'si uzak gelecekte: bayrak açıkken gerçek saatli sunucu turu çaldıramasın (§12).
  const k2Uzak = at(24 * 60);
  /** Açık duruş + alarm (fikstür: alarm satırı doğrudan — motor `test_loom_alarm`ın konusu). */
  const alarmKur = async (n: number, tier: 1 | 2, state: LoomAlarmState = LoomAlarmState.OPEN): Promise<{ alarmId: string; machineId: string; stopId: string }> => {
    const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-LAE-T${n}-${ek}`, code: `TEST-LAE-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
    ids.looms.push(m.id);
    const stop = (await openManualStop({ machineId: m.id, startedAt: at(-20), reasonCode: P.code })).data;
    const alarmId = randomUUID();
    const closed = state === LoomAlarmState.RESOLVED;
    await prisma.loomAlarm.create({
      data: {
        id: alarmId, kind: LoomAlarmKind.STOP_OVERDUE, stopEventId: stop.id, machineId: m.id, state, tier,
        targetMinutes: 10, graceMinutes: 5, planReasonCode: P.code, k1DueAt: at(-10), k2DueAt: tier === 1 ? k2Uzak : at(-5),
        ...(closed ? { closedAt: at(0), totalSec: 1200, overdueSec: 600 } : {}),
      },
    });
    return { alarmId, machineId: m.id, stopId: stop.id };
  };

  // ── §1 üstlen + yarış ──────────────────────────────────────────────────────
  const A = await alarmKur(1, 1);
  const t1 = randomUUID();
  const r1 = await ackLoomAlarm(A.alarmId, ahmet.id, t1);
  const a1 = await prisma.loomAlarm.findUnique({ where: { id: A.alarmId } });
  const ackEv = await prisma.loomAlarmEvent.findUnique({ where: { clientToken: t1 } });
  check("§1a üstlen: OPEN → ACKED, üstlenen Ahmet, üstlenme anı = defter satırının anı",
    a1?.state === LoomAlarmState.ACKED && a1.ackedById === ahmet.id && ackEv?.kind === LoomAlarmEventKind.ACK && ackEv.userId === ahmet.id
      && a1.ackedAt?.getTime() === ackEv.createdAt.getTime() && r1.data?.eventId === ackEv.id);
  const iz = await prisma.systemLog.count({ where: { tableName: "LOOM_ALARM_EVENT", recordId: ackEv?.id ?? "-" } });
  check("§1b kişi eylemi audit'e yazıldı (tx dışı, best-effort)", iz === 1, String(iz));

  const B = await alarmKur(2, 1);
  const yaris = await Promise.all([hataOf(ackLoomAlarm(B.alarmId, ahmet.id, randomUUID())), hataOf(ackLoomAlarm(B.alarmId, veli.id, randomUUID()))]);
  const kazanan = yaris.filter((y) => y.code === "OK").length;
  const kaybeden = yaris.find((y) => y.code !== "OK");
  check("§1c yarış: iki kişi aynı anda üstlenir → bir 200, bir 409 LOOM_ALARM_ALREADY_ACKED",
    kazanan === 1 && kaybeden?.status === 409 && kaybeden.code === "LOOM_ALARM_ALREADY_ACKED", JSON.stringify(yaris));
  const bAlarm = await prisma.loomAlarm.findUnique({ where: { id: B.alarmId }, select: { ackedById: true } });
  const kazananAd = bAlarm?.ackedById === ahmet.id ? ahmet.name : veli.name;
  check("§1d 409 mesajı KİMİN ve SAAT KAÇTA üstlendiğini söyler", (kaybeden?.message ?? "").includes(kazananAd) && /\d{2}:\d{2}'de üstlendi/.test(kaybeden?.message ?? ""), kaybeden?.message);
  check("§1e yarışta defterde tek ACK satırı", (await prisma.loomAlarmEvent.count({ where: { alarmId: B.alarmId, kind: LoomAlarmEventKind.ACK } })) === 1);

  // ── §2 replay dört durum ───────────────────────────────────────────────────
  const olayA = await prisma.loomAlarmEvent.count({ where: { alarmId: A.alarmId } });
  const r2 = await ackLoomAlarm(A.alarmId, ahmet.id, t1);
  check("§2a aynı token aynı yük → aynı satır, başarı, defter artmadı",
    r2.success === true && r2.data?.eventId === ackEv?.id && (await prisma.loomAlarmEvent.count({ where: { alarmId: A.alarmId } })) === olayA, r2.message);
  const carp = await hataOf(snoozeLoomAlarm(A.alarmId, ahmet.id, { minutes: 15, clientToken: t1 }));
  check("§2b aynı token BAŞKA yük → 409 CLIENT_TOKEN_COLLISION", carp.status === 409 && carp.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(carp));
  const carp2 = await hataOf(ackLoomAlarm(B.alarmId, ahmet.id, t1));
  check("§2c aynı token başka ALARM → 409 CLIENT_TOKEN_COLLISION", carp2.status === 409 && carp2.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(carp2));
  // Kimlik tablosu: çarpışma tek bir alanı adıyla söyler (`details.farkliAlanlar`).
  const tN = randomUUID();
  await noteLoomAlarm(B.alarmId, ahmet.id, { note: "atkı koptu", clientToken: tN });
  const kMetin = await hataOf(noteLoomAlarm(B.alarmId, ahmet.id, { note: "çözgü koptu", clientToken: tN }));
  check("§2e aynı token yalnız NOT METNİ farklı → çarpışma, farkliAlanlar=[detay]", kMetin.code === "CLIENT_TOKEN_COLLISION" && kMetin.alanlar.join() === "detay", JSON.stringify(kMetin));
  const kKisi = await hataOf(noteLoomAlarm(B.alarmId, veli.id, { note: "atkı koptu", clientToken: tN }));
  check("§2f aynı token yalnız KİŞİ farklı → çarpışma, farkliAlanlar=[userId]", kKisi.code === "CLIENT_TOKEN_COLLISION" && kKisi.alanlar.join() === "userId", JSON.stringify(kKisi));
  const kAlarm = await hataOf(noteLoomAlarm(A.alarmId, ahmet.id, { note: "atkı koptu", clientToken: tN }));
  check("§2g aynı token yalnız ALARM farklı → çarpışma, farkliAlanlar=[alarmId]", kAlarm.code === "CLIENT_TOKEN_COLLISION" && kAlarm.alanlar.join() === "alarmId", JSON.stringify(kAlarm));
  await releaseLoomAlarm(A.alarmId, ahmet.id, { clientToken: randomUUID(), canReleaseOthers: false });
  const olu = await hataOf(ackLoomAlarm(A.alarmId, ahmet.id, t1));
  check("§2d üstlenme sonradan bırakıldı → aynı token replay'i başarı DÖNMEZ (409 CLIENT_TOKEN_REVOKED)", olu.status === 409 && olu.code === "CLIENT_TOKEN_REVOKED", JSON.stringify(olu));

  // ── §3 bırak ───────────────────────────────────────────────────────────────
  await ackLoomAlarm(A.alarmId, ahmet.id, randomUUID());
  const yetkisiz = await hataOf(releaseLoomAlarm(A.alarmId, veli.id, { canReleaseOthers: false }));
  check("§3a başkasının üstlenmesini yetkisiz bırakmak → 403 LOOM_ALARM_ACKED_BY_OTHER", yetkisiz.status === 403 && yetkisiz.code === "LOOM_ALARM_ACKED_BY_OTHER", JSON.stringify(yetkisiz));
  await releaseLoomAlarm(A.alarmId, mudur.id, { canReleaseOthers: true });
  const a3 = await prisma.loomAlarm.findUnique({ where: { id: A.alarmId } });
  const rel = await prisma.loomAlarmEvent.findMany({ where: { alarmId: A.alarmId, kind: LoomAlarmEventKind.ACK_RELEASE }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 });
  check("§3b üst kademe yetkilisi bırakır → OPEN, üstlenen boş, karşı olay müdürün adına",
    a3?.state === LoomAlarmState.OPEN && a3.ackedById === null && a3.ackedAt === null && rel[0]?.userId === mudur.id);
  const bos = await hataOf(releaseLoomAlarm(A.alarmId, ahmet.id, { canReleaseOthers: false }));
  check("§3c üstlenilmemiş alarmı bırakmak → 409 LOOM_ALARM_NOT_ACKED", bos.status === 409 && bos.code === "LOOM_ALARM_NOT_ACKED", JSON.stringify(bos));

  // ── §4 sustur / kaldır ─────────────────────────────────────────────────────
  const gecersiz = await hataOf(snoozeLoomAlarm(A.alarmId, ahmet.id, { minutes: 20 as 15 }));
  check("§4a susturma süresi kapalı küme (20 dk) → 400", gecersiz.status === 400 && gecersiz.code === "LOOM_ALARM_SNOOZE_MINUTES", JSON.stringify(gecersiz));
  const sz = await snoozeLoomAlarm(A.alarmId, ahmet.id, { minutes: 30, note: "usta yolda", clientToken: randomUUID() });
  const szEv = await prisma.loomAlarmEvent.findUnique({ where: { id: sz.data!.eventId } });
  const a4 = await prisma.loomAlarm.findUnique({ where: { id: A.alarmId } });
  check("§4b susturma: bitiş = olay anı + 30 dk, durum ve defter aynı anı taşır",
    !!szEv?.snoozedUntil && szEv.snoozedUntil.getTime() === szEv.createdAt.getTime() + 30 * MIN && a4?.snoozedUntil?.getTime() === szEv.snoozedUntil.getTime() && a4.snoozedById === ahmet.id && szEv.note === "usta yolda");
  await unsnoozeLoomAlarm(A.alarmId, veli.id, randomUUID());
  const a5 = await prisma.loomAlarm.findUnique({ where: { id: A.alarmId } });
  check("§4c kaldırma karşı olay: susturma boşaldı, UNSNOOZE satırı", a5?.snoozedUntil === null && a5.snoozedById === null
    && (await prisma.loomAlarmEvent.count({ where: { alarmId: A.alarmId, kind: LoomAlarmEventKind.UNSNOOZE } })) === 1);
  const ikinci = await hataOf(unsnoozeLoomAlarm(A.alarmId, veli.id, randomUUID()));
  check("§4d susturulmamış alarmı kaldırmak → 409 LOOM_ALARM_NOT_SNOOZED", ikinci.status === 409 && ikinci.code === "LOOM_ALARM_NOT_SNOOZED", JSON.stringify(ikinci));

  // ── §5 not / geri çek ──────────────────────────────────────────────────────
  const n1 = await noteLoomAlarm(A.alarmId, ahmet.id, { note: "  mekik değişti  ", clientToken: randomUUID() });
  const n1Ev = await prisma.loomAlarmEvent.findUnique({ where: { id: n1.data!.eventId } });
  check("§5a not: NOTE satırı, metin kırpılmış", n1Ev?.kind === LoomAlarmEventKind.NOTE && n1Ev.note === "mekik değişti");
  const baskasi = await hataOf(retractLoomAlarmNote(A.alarmId, veli.id, { eventId: n1Ev!.id }));
  check("§5b notu sahibi dışında biri geri çekemez → 403", baskasi.status === 403 && baskasi.code === "LOOM_ALARM_NOTE_NOT_OWNER", JSON.stringify(baskasi));
  const notDegil = await hataOf(retractLoomAlarmNote(A.alarmId, ahmet.id, { eventId: szEv!.id }));
  check("§5c not olmayan satır (SNOOZE) geri çekilemez → 400", notDegil.status === 400 && notDegil.code === "LOOM_ALARM_NOTE_INVALID", JSON.stringify(notDegil));
  const geri = await Promise.all([
    hataOf(retractLoomAlarmNote(A.alarmId, ahmet.id, { eventId: n1Ev!.id, clientToken: randomUUID() })),
    hataOf(retractLoomAlarmNote(A.alarmId, ahmet.id, { eventId: n1Ev!.id, clientToken: randomUUID() })),
  ]);
  check("§5d not başına BİR KEZ: eşzamanlı iki geri çekme → bir 200, bir 409",
    geri.filter((g) => g.code === "OK").length === 1 && geri.some((g) => g.status === 409 && g.code === "LOOM_ALARM_NOTE_ALREADY_RETRACTED"), JSON.stringify(geri));
  check("§5e defterde tek NOTE_RETRACT, not satırı DURUYOR (silinmez/değişmez)",
    (await prisma.loomAlarmEvent.count({ where: { retractsEventId: n1Ev!.id } })) === 1 && (await prisma.loomAlarmEvent.findUnique({ where: { id: n1Ev!.id } }))?.note === "mekik değişti");

  // ── §6 kapanmış alarm ──────────────────────────────────────────────────────
  const K = await alarmKur(3, 2, LoomAlarmState.RESOLVED);
  const kapali = await hataOf(ackLoomAlarm(K.alarmId, ahmet.id, randomUUID()));
  check("§6a çözülmüş alarm üstlenilemez → 409 LOOM_ALARM_CLOSED", kapali.status === 409 && kapali.code === "LOOM_ALARM_CLOSED", JSON.stringify(kapali));
  const kSus = await hataOf(snoozeLoomAlarm(K.alarmId, ahmet.id, { minutes: 15 }));
  check("§6b çözülmüş alarm susturulamaz → 409 LOOM_ALARM_CLOSED", kSus.status === 409 && kSus.code === "LOOM_ALARM_CLOSED", JSON.stringify(kSus));
  const kNot = await hataOf(noteLoomAlarm(K.alarmId, ahmet.id, { note: "sonradan not" }));
  check("§6c kapanmış alarma not düşülebilir (olay sonrası açıklama)", kNot.code === "OK", JSON.stringify(kNot));

  // ── §7 liste + özet şeridi ─────────────────────────────────────────────────
  const E = await alarmKur(4, 2);
  const fikstur = ids.looms.join(",");
  await alarmKur(5, 1); // süzgeç DIŞI tuzak: şerit where'i listeden ayrılırsa toplam 4'ten sapar (boş DB'de de)
  const hepsi = await listLoomAlarms({ scope: "all", machineId: fikstur, limit: 200 });
  const s = hepsi.summary;
  check("§7a özet şeridi listeyle AYNI where: toplam = satır sayısı (CSV süzgeç readIdCondition'dan)", s.total === hepsi.items.length && s.total === 4, JSON.stringify(s));
  check("§7b şerit kırılımı satırlardan sayılanla eşit (durum · üst kademe)",
    s.open === hepsi.items.filter((i) => i.state === "OPEN").length && s.acked === hepsi.items.filter((i) => i.state === "ACKED").length
      && s.resolved === hepsi.items.filter((i) => i.state === "RESOLVED").length && s.escalated === hepsi.items.filter((i) => i.tier >= 2).length, JSON.stringify(s));
  const aktif = await listLoomAlarms({ scope: "active", machineId: fikstur });
  check("§7c kapsam 'active' kapanmışı dışlar; şerit de aynı kapsamda", aktif.items.every((i) => i.state === "OPEN" || i.state === "ACKED") && aktif.summary.total === 3 && aktif.summary.resolved === 0, JSON.stringify(aktif.summary));
  const gecmis = await listLoomAlarms({ scope: "history", machineId: fikstur });
  check("§7d kapsam 'history' yalnız kapanmış", gecmis.items.length === 1 && gecmis.items[0]!.id === K.alarmId);
  const sayfalar: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const p = await listLoomAlarms({ scope: "all", machineId: fikstur, limit: 1, cursor });
    sayfalar.push(...p.items.map((x) => x.id));
    check(`§7e sayfa ${i + 1}: şerit cursor'dan bağımsız (toplam hep 4)`, p.summary.total === 4, String(p.summary.total));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  check("§7f cursor sayfaları tam ve ayrık (4 farklı alarm, sıra listeyle aynı)", sayfalar.join() === hepsi.items.map((i) => i.id).join(), `${sayfalar.length}`);
  const bozuk = await hataOf(listLoomAlarms({ scope: "all", cursor: "bozuk!!" }));
  check("§7g bozuk cursor → 400 INVALID_CURSOR", bozuk.status === 400 && bozuk.code === "INVALID_CURSOR", JSON.stringify(bozuk));

  // ── §8 detay ───────────────────────────────────────────────────────────────
  const d = (await getLoomAlarmDetail(A.alarmId));
  const kinds = d.timeline.map((e) => e.kind).join(",");
  check("§8a zaman çizgisi defterin sırası (ACK, ACK_RELEASE, ACK, ACK_RELEASE, SNOOZE, UNSNOOZE, NOTE, NOTE_RETRACT)",
    kinds === "ACK,ACK_RELEASE,ACK,ACK_RELEASE,SNOOZE,UNSNOOZE,NOTE,NOTE_RETRACT", kinds);
  check("§8b geri çekilen not işaretli, metni duruyor", d.timeline.some((e) => e.kind === "NOTE" && e.retracted && e.note === "mekik değişti"));
  check("§8c canlı K1 alarmında sonraki adım = K2 vadesi; K2 çalmışta yok", d.nextDueAt?.getTime() === k2Uzak.getTime() && (await getLoomAlarmDetail(E.alarmId)).nextDueAt === null);
  check("§8d başlık: tezgah kodu + hol, sebep etiketi, benzer duruş istatistiği",
    d.alarm.machine.hallId === station.id && d.alarm.stop.reasonLabel === P.label && d.similar?.machine30d.count === 1 && d.recentStops.length === 1);
  const yok = await hataOf(getLoomAlarmDetail(randomUUID()));
  check("§8e olmayan alarm → 404", yok.status === 404 && yok.code === "LOOM_ALARM_NOT_FOUND", JSON.stringify(yok));

  // ── §12 yabancı motor ──────────────────────────────────────────────────────
  const yabanci = await runLoomAlarmOnce({ onlyMachineIds: ids.looms });
  check("§12a bayrak açıkken gerçek saatli yabancı tur fikstürde hiçbir şey yazmadı",
    yabanci !== "disabled" && yabanci.raised + yabanci.skipped + yabanci.replanned + yabanci.resolved + yabanci.cancelled + yabanci.failed === 0, JSON.stringify(yabanci));

  // ── §9 Tezgah Salonu ───────────────────────────────────────────────────────
  const salon = (await getLoomFloor(new Date())).data!;
  const eLoom = salon.looms.find((l) => l.id === E.machineId);
  const aLoom = salon.looms.find((l) => l.id === A.machineId);
  check("§9a K2 çalmış canlı alarm → tier ESCALATED + alarmId + iletim anı alarmın donmuş K2'si",
    eLoom?.openStop?.tier === "ESCALATED" && eLoom.openStop.alarmId === E.alarmId && eLoom.openStop.escalationDueAt?.getTime() === at(-5).getTime(), JSON.stringify(eLoom?.openStop));
  check("§9b K1'de canlı alarm → OVERDUE + alarmId", aLoom?.openStop?.tier === "OVERDUE" && aLoom.openStop.alarmId === A.alarmId, JSON.stringify(aLoom?.openStop?.tier));
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, false);
  const kapaliSalon = (await getLoomFloor(new Date())).data!;
  const eKapali = kapaliSalon.looms.find((l) => l.id === E.machineId);
  check("§9c alarm bayrağı KAPALI → salon alarmı okumaz (saatten OVERDUE, alarmId yok)", eKapali?.openStop?.tier === "OVERDUE" && eKapali.openStop.alarmId === null, JSON.stringify(eKapali?.openStop?.tier));

  // ── §11 uç kapısı ──────────────────────────────────────────────────────────
  const kapiSonuc = await new Promise<unknown>((resolve) => { void requireLoomAlarmEnabled({} as never, {} as never, (e?: unknown) => resolve(e ?? "next")); });
  const ke = kapiSonuc as { statusCode?: number; details?: { code?: string } };
  check("§11a alarm bayrağı kapalı → uç kapısı 403 LOOM_ALARM_DISABLED", ke?.statusCode === 403 && ke.details?.code === "LOOM_ALARM_DISABLED", JSON.stringify(kapiSonuc));
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_ENABLED, true);
  const acikSonuc = await new Promise<unknown>((resolve) => { void requireLoomAlarmEnabled({} as never, {} as never, (e?: unknown) => resolve(e ?? "next")); });
  check("§11b bayrak açık → kapı geçer", acikSonuc === "next", JSON.stringify(acikSonuc));

  // ── §13 uç izin matrisi (mobil dar ikiz + tablet şeridi) ───────────────────
  // Yollar bu yönlendiricide yönteme göre tekil — yolla bulunur; guard ilk katmandır (verifyToken router.use'ta).
  const izinSonucu = (yol: string, permissions: string[]): unknown => {
    const layer = loomAlarmRouter.stack.find((l) => l.route?.path === yol);
    const guard = layer?.route?.stack[0]?.handle;
    if (!guard) return "uç yok";
    let r: unknown = "çağrılmadı";
    const next = (e?: unknown) => { r = e instanceof Error && "statusCode" in e ? e.statusCode : e ? "hata" : "next"; };
    Reflect.apply(guard, undefined, [{ user: { userId: "u", permissions } }, {}, next]);
    return r;
  };
  const matris = (perms: string[]) => ["get /", "get /:id", "post /:id/ack", "post /:id/notes", "post /:id/notes/:eventId/retract"].map((k) => { const y = k.split(" ")[1]; return `${k}=${String(izinSonucu(y, perms))}`; }).join(" · ");
  const uyari = matris(["mobile:tezgah-uyari"]);
  check("§13a `mobile:tezgah-uyari` → liste · detay · eylemler geçer", !/=(?!next)/.test(uyari), uyari);
  const dokuma = matris(["mobile:dokuma"]);
  check("§13b `mobile:dokuma` → yalnız liste; detay ve eylem 403", dokuma === "get /=next · get /:id=403 · post /:id/ack=403 · post /:id/notes=403 · post /:id/notes/:eventId/retract=403", dokuma);
  const web = matris(["loom:alarm-view"]);
  check("§13c `loom:alarm-view` tek başına eylem açmaz (web ayrımı korunur)", web === "get /=next · get /:id=next · post /:id/ack=403 · post /:id/notes=403 · post /:id/notes/:eventId/retract=403", web);

  // ── §10 AST: hedef/pay aritmetiği tek yerde ────────────────────────────────
  check("§10a hedef/pay aritmetiği (targetMinutes · graceMinutes ile + / *) yalnız helpers/loom-floor.helper'da", hedefAritmetigi(SRC).length === 0, hedefAritmetigi(SRC).join(" · "));
  const sonda = hedefAritmetigiKaynak("const due = new Date(s.startedAt.getTime() + s.targetMinutes * 60000);", "sonda.ts");
  check("§10b sonda: helper dışında kopya vade hesabı yakalanır", sonda.length === 1, String(sonda.length));
  check("§10c sonda: virgüllü argüman listesi yakalanmaz", hedefAritmetigiKaynak("f(stop, targetMinutes, graceMinutes);", "sonda.ts").length === 0);
}

const SRC = path.join(__dirname, "..", "src");
const HELPER = "services/helpers/loom-floor.helper.ts";
function hedefAritmetigiKaynak(kaynak: string, ad: string): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.PlusToken || n.operatorToken.kind === ts.SyntaxKind.AsteriskToken)) {
      const yan = (e: ts.Expression): boolean => /(^|\.)(targetMinutes|graceMinutes|escalationGraceMinutes)$/.test(e.getText(sf).trim());
      if (yan(n.left) || yan(n.right)) out.push(`${ad}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
function hedefAritmetigi(kok: string): string[] {
  return walkTs(kok)
    .filter((f) => path.relative(kok, f).split(path.sep).join("/") !== HELPER)
    .flatMap((f) => hedefAritmetigiKaynak(fs.readFileSync(f, "utf8"), path.relative(kok, f).split(path.sep).join("/")));
}

async function cleanup(): Promise<void> {
  try {
    if (ids.looms.length) {
      // Fikstür temizliği: alarm silinir, olaylar kaskatla gider — üretim yolu değil.
      await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.looms } } });
      const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.looms } }, select: { id: true } });
      const sid = stops.map((s) => s.id);
      await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
      await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
      await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
      await prisma.machine.deleteMany({ where: { id: { in: ids.looms } } });
    }
    if (ids.presets.length) await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    if (ids.users.length) {
      await prisma.systemLog.deleteMany({ where: { userId: { in: ids.users } } });
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
