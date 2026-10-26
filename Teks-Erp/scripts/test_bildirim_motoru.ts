// =============================================================================
// BEKÇİ — BİLDİRİM MOTORU (N1-MOTOR: emit · görme süzgeci · dağıtıcı · koşul tarayıcısı · budama)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_motoru
// =============================================================================
//   §0 saf: dedupeKey kalıbı (eksik alan → konu kimliği) · groupKey (pencere kovası, KOSUL, ALARM)
//   §1 iş tx'i rollback → outbox yok          §2 bayrak kapalı → emit no-op, outbox yok
//   §3 işlenmemiş satır: düşen tur attempts++ alır, "yeniden başlatma" turu BİR kez işler
//   §4 pencere içinde 3 olay → tek satır count=3 · §5 10 paralel olay + 2 paralel dağıtıcı → tek satır count=10
//   §6 aktör almaz · varsayılan izni (order:write) olmayan almaz · görmeyen/pasif almaz
//   §7 izin kaybı → görme süzgeci gizler, dağıtım durur · modül kapalı → görmez
//   §8 evaluate hatası açık koşulu KAPATMAZ · açık koşul ikinci kez ACILDI almaz
//   §9 KAPANDI → resolvedAt + okundu · yeniden açılan koşul YENİ satır · §10 budama süreleri
//   §11 gözetmen: bayrak açılınca işler başlar (yeniden başlatmasız), kapanınca durur; commit sonrası
//       dürtme (pg_notify) süpürmeyi beklemeden dağıtır · §11e koparılan LISTEN yeniden kurulur · §11f durunca
//       LISTEN bağlantısı UNLISTEN + havuza döner · §11g yardımcı sunucular dağıtmaz (yabancı dinleyen yok) · §12 günlük sayaç · §M tek tur ölçümü (2026-10-24, bu bekçi basar)
//
// NEGATİF SONDALAR (2026-10-24, sha256 ile birebir geri alındı): ① dağıtıcıda aktör süzgeci etkisizleştirildi
// → yalnız §6a ❌ (35 ✅ / 1 ❌) · ② ikinci outbox yazarı → `test_bildirim_tek_kaynak` §1 ❌ (oradaki başlık) ·
// ③ süpürmeden yeniden dinleme çıkarıldı → §11e ❌ (37/1) · ④ durdurmada UNLISTEN/release çıkarıldı → §11f ❌ (36/2, süreç pool.end'te asılır).
// ⑤ (2026-10-25) bayrak açıkken aynı DB'de 5 yardımcı sunucu `NOTIFICATION_JOBS_ENABLED`siz → §11e/f/g ❌ (CI imzası
//   "dinleyen 5"); kapamayla 5 sunucu açıkken yeşil · ci.yml satırından kapama silinince §11g ❌.
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); bulduğu değere `finally`de döner. Kendi satırlarını
// tür ∧ başlangıç anı + kendi kullanıcılarıyla temizler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { emitNotification, NOTIFICATION_NOTIFY_CHANNEL, notificationDedupeKey } from "../src/services/helpers/notification-emit.helper";
import {
  canSeeNotificationType,
  loadNotificationVisibilityEnv,
  visibleKindsFor,
  visibleUsersFor,
} from "../src/services/helpers/notification-visibility.helper";
import { notificationGroupKey, runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { registerConditionSource, runConditionSourceOnce, type ConditionSubject } from "../src/jobs/notification-condition.job";
import { isNotificationDispatcherRunning, reconcileNotificationJobs, stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { NOTIFICATION_RETENTION, pruneNotifications } from "../src/services/notification-prune.service";
import { factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";
import type { NotificationKind, NotificationPhase } from "../src/constants/notification-catalog";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { kosulTabaniHazir } from "./lib/bildirim-kosul-tabani";

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

const ek = Date.now().toString(36);
const BASLANGIC = new Date(Date.now() - 1000);
const OLAY: NotificationKind = "siparis.patron-siparisi"; // OLAY · pencere 600 sn · izin order:read · varsayılan order:write
const KOSUL: NotificationKind = "siparis.termin-gecti";   // KOSUL · izin order:read · varsayılan order:write
const TURLER = [OLAY, KOSUL];
const users: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

async function kisi(ad: string, codes: string[], aktif = true): Promise<string> {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`izin kataloğu eksik: ${codes.join(",")}`);
  const u = await prisma.user.create({
    data: { username: `tbm_${ad}_${ek}`.slice(0, 50), fullName: `TEST-BILDIRIM ${ad} ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: aktif },
    select: { id: true },
  });
  users.push(u.id);
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  return u.id;
}

async function emitIn(kind: NotificationKind, key: string, payload: Record<string, unknown>, o: { actor?: string; phase?: NotificationPhase; conditionId?: string } = {}): Promise<string | null> {
  return prisma.$transaction((tx) => emitNotification(tx, kind, { type: "order", id: null, key }, payload, { actorUserId: o.actor ?? null, phase: o.phase, conditionId: o.conditionId ?? null }));
}

async function bayrak(v: boolean): Promise<void> {
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

/** Bütün kuyruğu boşalt (tur başı 100). */
async function dagit(): Promise<{ processed: number; upserts: number; resolved: number }> {
  const t = { processed: 0, upserts: 0, resolved: 0 };
  for (let i = 0; i < 100; i++) {
    const r = await runNotificationDispatchOnce();
    t.processed += r.processed;
    t.upserts += r.upserts;
    t.resolved += r.resolved;
    if (r.processed === 0) break;
  }
  return t;
}

async function kutu(userId: string, groupKey: string) {
  return prisma.notificationInbox.findMany({ where: { userId, groupKey }, orderBy: { createdAt: "asc" } });
}

const statsOnce = new Map<string, number | null>();
async function statsKaydet(day: string, kind: string): Promise<void> {
  const k = `${day}|${kind}`;
  if (statsOnce.has(k)) return;
  const r = await prisma.notificationDailyStats.findUnique({ where: { factoryDay_kind: { factoryDay: new Date(`${day}T00:00:00Z`), kind } }, select: { events: true } });
  statsOnce.set(k, r?.events ?? null);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim motoru — emit · görme · dağıtıcı · koşul · budama ===\n");
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const tabanGeri = await kosulTabaniHazir([KOSUL]);
  try {
    await govde();
  } finally {
    stopNotificationJobs();
    await tabanGeri();
    await temizle();
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

async function govde(): Promise<void> {
  // ── §0 saf ────────────────────────────────────────────────────────────────
  check("§0a dedupeKey sabit kalıp (`patron-siparisi`) → tür:kalıp (konular birleşir)",
    notificationDedupeKey(OLAY, "x1", {}) === "siparis.patron-siparisi:patron-siparisi");
  check("§0b dedupeKey `{siparisId}` payload'dan dolar", notificationDedupeKey(KOSUL, "k", { siparisId: "S9" }) === "siparis.termin-gecti:S9");
  check("§0c dedupeKey eksik alan → konu kimliği (sahte birleşme yok)", notificationDedupeKey(KOSUL, "konu-7", {}) === "siparis.termin-gecti:konu-7");
  const t0 = new Date("2026-01-01T00:00:00Z");
  const g1 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "a", conditionId: null, dedupeKey: "d", occurredAt: t0 });
  const g2 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "b", conditionId: null, dedupeKey: "d", occurredAt: new Date(t0.getTime() + 599_000) });
  const g3 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "c", conditionId: null, dedupeKey: "d", occurredAt: new Date(t0.getTime() + 600_000) });
  check("§0d OLAY pencere kovası: aynı 600 sn → aynı groupKey, sonraki kova → farklı", g1 === g2 && g1 !== g3, `${g1} · ${g3}`);
  check("§0e KOSUL groupKey = kind:subjectKey:conditionId",
    notificationGroupKey({ kind: KOSUL, subjectId: null, subjectKey: "s", conditionId: "c1", dedupeKey: "x", occurredAt: t0 }) === "siparis.termin-gecti:s:c1");
  check("§0f ALARM groupKey = alarm:<id>",
    notificationGroupKey({ kind: "dokuma.tezgah-alarmi", subjectId: "A1", subjectKey: "A1", conditionId: null, dedupeKey: "x", occurredAt: t0 }) === "alarm:A1");

  // ── fikstür ───────────────────────────────────────────────────────────────
  // Sayaç satırlarının ÖNCEKİ değeri (temizlik geri yazar): sabit günler + bugün.
  for (const d of ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", factoryYmd(new Date())]) {
    for (const k of TURLER) await statsKaydet(d, k);
  }
  const A = await kisi("a", ["order:read", "order:write"]);
  const B = await kisi("b", ["order:read", "order:write"]);
  const C = await kisi("c", ["order:read"]);
  const D = await kisi("d", ["shipping:read"]);
  const E = await kisi("e", ["order:read", "order:write"], false);
  await bayrak(true);

  // ── §1 rollback ───────────────────────────────────────────────────────────
  const k1 = `rb-${ek}`;
  try {
    await prisma.$transaction(async (tx) => {
      await emitNotification(tx, OLAY, { type: "order", key: k1 }, { siparisNo: "X" });
      throw new Error("bilinçli geri alma");
    });
  } catch { /* beklenen */ }
  check("§1 ⭐ iş tx'i geri alınınca outbox satırı YOK", (await prisma.notificationOutbox.count({ where: { subjectKey: k1 } })) === 0);

  // ── §2 bayrak kapalı ──────────────────────────────────────────────────────
  await bayrak(false);
  const k2 = `off-${ek}`;
  const r2 = await emitIn(OLAY, k2, { siparisNo: "X" });
  check("§2 ⭐ bayrak kapalı → emit no-op, outbox satırı YOK", r2 === null && (await prisma.notificationOutbox.count({ where: { subjectKey: k2 } })) === 0);
  await bayrak(true);

  // ── §3 düşen tur + yeniden başlatma ───────────────────────────────────────
  await dagit(); // önceki kalıntı
  const k3 = `rs-${ek}`;
  const id3 = await emitIn(OLAY, k3, { siparisNo: "R3" });
  const sabit3 = new Date("2026-02-01T00:00:00Z");
  await prisma.notificationOutbox.update({ where: { id: id3! }, data: { occurredAt: sabit3 } });
  const dus = await runNotificationDispatchOnce({ beforeCommit: async () => { throw new Error("çöküş benzetimi"); } });
  const o3a = await prisma.notificationOutbox.findUnique({ where: { id: id3! } });
  const gk3 = notificationGroupKey({ ...o3a!, occurredAt: o3a!.occurredAt });
  check("§3a düşen tur: satır işlenmedi, attempts=1, lastErrorCode yazıldı, kutu boş",
    dus.failed >= 1 && o3a!.processedAt === null && o3a!.attempts === 1 && !!o3a!.lastErrorCode && (await kutu(A, gk3)).length === 0,
    `failed=${dus.failed} attempts=${o3a!.attempts} kod=${o3a!.lastErrorCode}`);
  await dagit();
  await dagit();
  const o3b = await prisma.notificationOutbox.findUnique({ where: { id: id3! } });
  const kA3 = await kutu(A, gk3);
  check("§3b ⭐ yeniden başlatma turu satırı BİR kez işler (iki tur sonra count=1)",
    o3b!.processedAt !== null && kA3.length === 1 && kA3[0]!.count === 1, `rows=${kA3.length} count=${kA3[0]?.count}`);

  // ── §4 pencere ────────────────────────────────────────────────────────────
  const sabit4 = new Date("2026-03-01T00:00:00Z");
  const ids4: string[] = [];
  for (let i = 0; i < 3; i++) ids4.push((await emitIn(OLAY, `w-${ek}-${i}`, { siparisNo: `W${i}` }))!);
  for (const [i, id] of ids4.entries()) await prisma.notificationOutbox.update({ where: { id }, data: { occurredAt: new Date(sabit4.getTime() + i * 60_000) } });
  await dagit();
  const gk4 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "", conditionId: null, dedupeKey: notificationDedupeKey(OLAY, "", {}), occurredAt: sabit4 });
  const kA4 = await kutu(A, gk4);
  check("§4 ⭐ pencere içinde 3 olay → TEK satır, count=3, son payload", kA4.length === 1 && kA4[0]!.count === 3 && (kA4[0]!.payload as { siparisNo?: string }).siparisNo === "W2",
    `rows=${kA4.length} count=${kA4[0]?.count}`);

  // ── §5 10 paralel olay + iki paralel dağıtıcı ─────────────────────────────
  const sabit5 = new Date("2026-04-01T00:00:00Z");
  const ids5 = await Promise.all(Array.from({ length: 10 }, (_, i) => emitIn(OLAY, `p-${ek}-${i}`, { siparisNo: `P${i}` })));
  await prisma.notificationOutbox.updateMany({ where: { id: { in: ids5 as string[] } }, data: { occurredAt: sabit5 } });
  await Promise.all([runNotificationDispatchOnce(), runNotificationDispatchOnce()]);
  await dagit();
  const gk5 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "", conditionId: null, dedupeKey: notificationDedupeKey(OLAY, "", {}), occurredAt: sabit5 });
  const kA5 = await kutu(A, gk5);
  const o5 = await prisma.notificationOutbox.findMany({ where: { id: { in: ids5 as string[] } }, select: { processedAt: true } });
  check("§5 ⭐ 10 paralel olay → TEK satır count=10, her outbox bir kez işlendi",
    kA5.length === 1 && kA5[0]!.count === 10 && o5.every((o) => o.processedAt !== null), `rows=${kA5.length} count=${kA5[0]?.count}`);

  // ── §6 aktör ve alıcı süzgeci ─────────────────────────────────────────────
  const sabit6 = new Date("2026-05-01T00:00:00Z");
  const id6 = await emitIn(OLAY, `act-${ek}`, { siparisNo: "A6" }, { actor: B });
  await prisma.notificationOutbox.update({ where: { id: id6! }, data: { occurredAt: sabit6 } });
  await dagit();
  const gk6 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "", conditionId: null, dedupeKey: notificationDedupeKey(OLAY, "", {}), occurredAt: sabit6 });
  check("§6a ⭐ aktör kendi eyleminin bildirimini ALMAZ, diğer alıcı alır",
    (await kutu(B, gk6)).length === 0 && (await kutu(A, gk6)).length === 1);
  check("§6b varsayılan izni (order:write) olmayan görür ama ALMAZ", (await kutu(C, gk6)).length === 0);
  check("§6c türü göremeyen ve pasif kullanıcı ALMAZ", (await kutu(D, gk6)).length === 0 && (await kutu(E, gk6)).length === 0);
  check("§6d aktörün kendi eylemi dışındaki olayı alır (B, §5 satırı)", (await kutu(B, gk5)).length === 1);

  // ── §7 izin kaybı / modül ─────────────────────────────────────────────────
  const env = await loadNotificationVisibilityEnv(prisma);
  const goren = await visibleUsersFor(prisma, OLAY, env, { userIds: [A, B, C, D, E] });
  check("§7a toplu görme: A, B, C görür; D (izinsiz) ve E (pasif) görmez",
    goren.includes(A) && goren.includes(B) && goren.includes(C) && !goren.includes(D) && !goren.includes(E), JSON.stringify(goren.length));
  check("§7b visibleKindsFor tekil yüklemle aynı küme",
    visibleKindsFor({ permissions: ["order:read"] }, env).includes(OLAY) && !visibleKindsFor({ permissions: ["shipping:read"] }, env).includes(OLAY));
  check("§7c modül kapalı → görmez (productionEnabled kapalıyken `isemri.gecikti`)",
    !canSeeNotificationType({ permissions: ["*"] }, "isemri.gecikti", { modules: { productionEnabled: false }, gates: {} })
    && canSeeNotificationType({ permissions: ["*"] }, "isemri.gecikti", { modules: { productionEnabled: true }, gates: {} }));
  check("§7d ek kapı kapalı → tezgah alarmı görünmez (modül açık olsa da)",
    !canSeeNotificationType({ permissions: ["*"] }, "dokuma.tezgah-alarmi", { modules: { tezgahEnabled: true }, gates: { tezgahAlarm: false } }));
  const readPerm = await prisma.permission.findUnique({ where: { code: "order:read" }, select: { id: true } });
  await prisma.userPermission.deleteMany({ where: { userId: A, permissionId: readPerm!.id } });
  const goren2 = await visibleUsersFor(prisma, OLAY, env, { userIds: [A] });
  const sabit7 = new Date("2026-06-01T00:00:00Z");
  const id7 = await emitIn(OLAY, `loss-${ek}`, { siparisNo: "L7" });
  await prisma.notificationOutbox.update({ where: { id: id7! }, data: { occurredAt: sabit7 } });
  await dagit();
  const gk7 = notificationGroupKey({ kind: OLAY, subjectId: null, subjectKey: "", conditionId: null, dedupeKey: notificationDedupeKey(OLAY, "", {}), occurredAt: sabit7 });
  check("§7e ⭐ izin kaybı → görme süzgeci gizler ve dağıtım DURUR (order:write tek başına yetmez)",
    goren2.length === 0 && (await kutu(A, gk7)).length === 0 && (await kutu(B, gk7)).length === 1);
  await prisma.userPermission.create({ data: { userId: A, permissionId: readPerm!.id } });

  // ── §8–§9 koşul tarayıcısı ────────────────────────────────────────────────
  let gercek: ConditionSubject[] | "hata" = [];
  registerConditionSource({
    kind: KOSUL, periodMs: 3_600_000,
    evaluate: async () => {
      if (gercek === "hata") throw new Error("kaynak okunamadı");
      return gercek;
    },
  });
  const sk = `S-${ek}`;
  gercek = [{ key: sk, type: "order", id: null, payload: { siparisId: sk, siparisNo: "T1", gun: 3 } }];
  const r81 = await runConditionSourceOnce(KOSUL);
  const r82 = await runConditionSourceOnce(KOSUL);
  const kos1 = await prisma.notificationCondition.findFirst({ where: { kind: KOSUL, subjectKey: sk, resolvedAt: null } });
  check("§8a koşul açıldı (ACILDI bir kez); ikinci tur açık koşula ikinci ACILDI yazmaz",
    typeof r81 === "object" && r81.opened === 1 && typeof r82 === "object" && r82.opened === 0 && !!kos1
    && (await prisma.notificationOutbox.count({ where: { kind: KOSUL, subjectKey: sk, phase: "ACILDI" } })) === 1,
    `${JSON.stringify(r81)} ${JSON.stringify(r82)}`);
  await dagit();
  const gk8 = `${KOSUL}:${sk}:${kos1!.id}`;
  const kA8 = await kutu(A, gk8);
  check("§8b ACILDI gelen kutusuna düştü (okunmamış, çözülmemiş)", kA8.length === 1 && kA8[0]!.readAt === null && kA8[0]!.resolvedAt === null);
  gercek = "hata";
  const r83 = await runConditionSourceOnce(KOSUL);
  const kos2 = await prisma.notificationCondition.findUnique({ where: { id: kos1!.id } });
  check("§8c ⭐ evaluate hatası → açık koşul KAPANMAZ, KAPANDI yazılmaz",
    r83 === "error" && kos2!.resolvedAt === null && (await prisma.notificationOutbox.count({ where: { kind: KOSUL, subjectKey: sk, phase: "KAPANDI" } })) === 0);
  gercek = [];
  const r84 = await runConditionSourceOnce(KOSUL);
  await dagit();
  const kos3 = await prisma.notificationCondition.findUnique({ where: { id: kos1!.id } });
  const kA9 = await kutu(A, gk8);
  check("§9a ⭐ koşul düzelince KAPANDI: koşul resolvedAt, kutu satırı resolvedAt + okundu",
    typeof r84 === "object" && r84.closed === 1 && kos3!.resolvedAt !== null && kA9.length === 1 && kA9[0]!.resolvedAt !== null && kA9[0]!.readAt !== null);
  gercek = [{ key: sk, type: "order", id: null, payload: { siparisId: sk, siparisNo: "T1", gun: 4 } }];
  await runConditionSourceOnce(KOSUL);
  await dagit();
  const kos4 = await prisma.notificationCondition.findFirst({ where: { kind: KOSUL, subjectKey: sk, resolvedAt: null } });
  const yeni = await kutu(A, `${KOSUL}:${sk}:${kos4?.id}`);
  check("§9b yeniden açılan koşul YENİ koşul + YENİ kutu satırı (eskisi çözülmüş kalır)",
    !!kos4 && kos4.id !== kos1!.id && yeni.length === 1 && yeni[0]!.resolvedAt === null && (await kutu(A, gk8))[0]!.resolvedAt !== null);
  gercek = [];
  await runConditionSourceOnce(KOSUL);
  await dagit();

  // ── §10 budama ────────────────────────────────────────────────────────────
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const R = NOTIFICATION_RETENTION;
  const inbox = async (readAt: Date | null, lastAt: Date, tag: string) => (await prisma.notificationInbox.create({ data: {
    userId: A, kind: OLAY, klass: "BILDIRIM", subjectType: "order", groupKey: `prune-${tag}-${ek}`, count: 1, firstAt: lastAt, lastAt,
    lastOutboxId: randomUUID(), payload: {}, reason: "IZIN", readAt, resolvedAt: null,
  }, select: { id: true } })).id;
  const iOkunmusEski = await inbox(ago(R.inboxReadDays + 1), ago(200), "oe");
  const iOkunmusGenc = await inbox(ago(R.inboxReadDays - 1), ago(200), "og");
  const iOkunmamisEski = await inbox(null, ago(R.inboxUnreadDays + 1), "ue");
  const iOkunmamisGenc = await inbox(null, ago(R.inboxUnreadDays - 1), "ug");
  const outbox = async (processedAt: Date | null, createdAt: Date, attempts: number) => (await prisma.notificationOutbox.create({ data: {
    kind: OLAY, phase: "OLAY", subjectType: "order", subjectKey: `prune-${ek}`, payload: {}, dedupeKey: `prune-${ek}`, processedAt, createdAt, attempts,
  }, select: { id: true } })).id;
  const oEski = await outbox(ago(R.outboxDays + 1), ago(30), 0);
  const oGenc = await outbox(ago(R.outboxDays - 1), ago(30), 0);
  const oOlu = await outbox(null, ago(R.outboxDays + 1), 99);
  const oCanli = await outbox(null, ago(R.outboxDays + 1), 0);
  const cond = async (resolvedAt: Date | null, tag: string) => (await prisma.notificationCondition.create({ data: {
    kind: KOSUL, subjectKey: `prune-${tag}-${ek}`, subjectType: "order", openedAt: ago(400), resolvedAt, payload: {},
  }, select: { id: true } })).id;
  const cEski = await cond(ago(R.conditionResolvedDays + 1), "ce");
  const cGenc = await cond(ago(R.conditionResolvedDays - 1), "cg");
  const cAcik = await cond(null, "ca");
  const bugun = factoryDayKeyUtcMidnight(now);
  const sEskiGun = new Date(bugun.getTime() - (R.dailyStatsDays + 1) * DAY);
  const sGencGun = new Date(bugun.getTime() - (R.dailyStatsDays - 1) * DAY);
  const pruneKind = `test.prune-${ek}`;
  await prisma.notificationDailyStats.create({ data: { factoryDay: sEskiGun, kind: pruneKind, events: 1 } });
  await prisma.notificationDailyStats.create({ data: { factoryDay: sGencGun, kind: pruneKind, events: 1 } });
  const pr = await pruneNotifications(now);
  const var_ = async (fn: () => Promise<unknown>) => (await fn()) !== null;
  const inb = (id: string) => var_(() => prisma.notificationInbox.findUnique({ where: { id } }));
  const out = (id: string) => var_(() => prisma.notificationOutbox.findUnique({ where: { id } }));
  const con = (id: string) => var_(() => prisma.notificationCondition.findUnique({ where: { id } }));
  check("§10a ⭐ kutu: okunmuş >90 gün ve okunmamış >180 gün gider; gençleri kalır",
    !(await inb(iOkunmusEski)) && (await inb(iOkunmusGenc)) && !(await inb(iOkunmamisEski)) && (await inb(iOkunmamisGenc)), JSON.stringify(pr));
  check("§10b ⭐ outbox: işlenmiş >7 gün ve vazgeçilmiş (attempts ≥ sınır) >7 gün gider; genç ve canlı işlenmemiş kalır",
    !(await out(oEski)) && (await out(oGenc)) && !(await out(oOlu)) && (await out(oCanli)));
  check("§10c koşul: çözülmüş >180 gün gider; genci ve AÇIK olan (400 günlük) kalır",
    !(await con(cEski)) && (await con(cGenc)) && (await con(cAcik)));
  const st = await prisma.notificationDailyStats.findMany({ where: { kind: pruneKind }, select: { factoryDay: true } });
  check("§10d sayaç: 35 günden eski fabrika günü gider, genci kalır",
    st.length === 1 && st[0]!.factoryDay.getTime() === sGencGun.getTime(), st.map((x) => x.factoryDay.toISOString()).join(","));
  await prisma.notificationOutbox.update({ where: { id: oCanli }, data: { processedAt: now } });
  await prisma.notificationCondition.update({ where: { id: cAcik }, data: { resolvedAt: now } });

  // ── §11 gözetmen + commit sonrası dürtme ──────────────────────────────────
  await bayrak(false);
  const j0 = await reconcileNotificationJobs({ sweepMs: 600_000 });
  await bayrak(true);
  const j1 = await reconcileNotificationJobs({ sweepMs: 600_000 });
  check("§11a ⭐ bayrak kapalı → işler yok; bayrak açılınca gözetmen turu başlatır (yeniden başlatmasız)", j0 === false && j1 === true && isNotificationDispatcherRunning());
  await new Promise((r) => setTimeout(r, 500)); // açılış turu bitsin
  const sureler: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    const id = await emitIn(OLAY, `kick-${ek}-${i}`, { siparisNo: `K${i}` });
    let islendi = false;
    while (Date.now() - t < 4_000) {
      const o = await prisma.notificationOutbox.findUnique({ where: { id: id! }, select: { processedAt: true } });
      if (o?.processedAt) { islendi = true; break; }
      await new Promise((r) => setTimeout(r, 50));
    }
    sureler.push(islendi ? Date.now() - t : -1);
  }
  check("§11b ⭐ commit sonrası dürtme süpürmeyi (10 dk) beklemeden dağıtır (< 2 sn)", sureler.every((s) => s >= 0 && s < 2_000), `${sureler.join(" · ")} ms`);
  const rb = Date.now();
  try {
    await prisma.$transaction(async (tx) => {
      await emitNotification(tx, OLAY, { type: "order", key: `kick-rb-${ek}` }, {});
      throw new Error("geri al");
    });
  } catch { /* beklenen */ }
  check("§11c geri alınan tx dürtme bırakmaz, satır da yok", (await prisma.notificationOutbox.count({ where: { subjectKey: `kick-rb-${ek}` } })) === 0, `${Date.now() - rb} ms`);
  // §11e/f LISTEN bağlantısı (patron onayı koşulu): koparılınca süpürme yeniden dinler; durunca havuza temiz döner.
  const dinleyenler = async () => (await prisma.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND query = ${`LISTEN ${NOTIFICATION_NOTIFY_CHANNEL}`}`).map((r) => r.pid);
  const bekle = async (kosul: () => Promise<boolean>, ms: number): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await kosul()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  await bayrak(false);
  await reconcileNotificationJobs();
  // §11g aynı DB'de YABANCI dağıtıcı yok: CI'nin yardımcı sunucuları bayrağı görüp dinliyordu (§11e/f "dinleyen 5",
  // zil §5b "gelmedi") — kapama `NOTIFICATION_JOBS_ENABLED=false` ile, iki açılış yüzeyinde ölçülür.
  const yabanci = await dinleyenler();
  const ciYml = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  const ciSunucu = ciYml.split("\n").filter((l) => l.includes("npx tsx src/server.ts"));
  const bekciHttp = readFileSync(join(__dirname, "bekci-http.ts"), "utf8");
  check("§11g ⭐ yardımcı sunucular bildirim dağıtmaz (ci.yml + bekci-http `NOTIFICATION_JOBS_ENABLED=false`) · yabancı dinleyen yok",
    ciSunucu.length > 0 && ciSunucu.every((l) => l.includes("NOTIFICATION_JOBS_ENABLED=false")) &&
      /NOTIFICATION_JOBS_ENABLED: "false"/.test(bekciHttp) && yabanci.length === 0,
    `ci.yml ${ciSunucu.length} satır · yabancı dinleyen ${yabanci.join(",") || "yok"}`);
  await bayrak(true);
  await reconcileNotificationJobs({ sweepMs: 200 });
  let p1: number[] = [];
  await bekle(async () => (p1 = await dinleyenler()).length === 1, 3_000);
  if (p1.length === 1) await prisma.$queryRaw`SELECT pg_terminate_backend(${p1[0]}::int)`;
  let p2: number[] = [];
  const yeniden = await bekle(async () => (p2 = await dinleyenler()).length === 1 && p2[0] !== p1[0], 3_000);
  check("§11e LISTEN bağlantısı koparılınca süpürme turu yeniden dinler (tek bağlantı)", p1.length === 1 && yeniden && isNotificationDispatcherRunning(),
    `önce ${p1.join(",")} · sonra ${p2.join(",")}`);
  await bayrak(false);
  const j2 = await reconcileNotificationJobs();
  check("§11d bayrak kapanınca gözetmen işleri durdurur", j2 === false && !isNotificationDispatcherRunning());
  const temiz = await bekle(async () => (await dinleyenler()).length === 0 && pool.totalCount - pool.idleCount === 0, 3_000);
  check("§11f durunca LISTEN bağlantısı UNLISTEN + havuza döner (dinleyen yok, ödünç istemci yok)", temiz,
    `dinleyen ${(await dinleyenler()).length} · ödünçte ${pool.totalCount - pool.idleCount}`);
  await bayrak(true);

  // ── §12 günlük sayaç ──────────────────────────────────────────────────────
  const gun = factoryYmd(new Date());
  const once = (await prisma.notificationDailyStats.findUnique({ where: { factoryDay_kind: { factoryDay: new Date(`${gun}T00:00:00Z`), kind: OLAY } } }))?.events ?? 0;
  for (let i = 0; i < 2; i++) await emitIn(OLAY, `st-${ek}-${i}`, {});
  await dagit();
  const sonra = (await prisma.notificationDailyStats.findUnique({ where: { factoryDay_kind: { factoryDay: new Date(`${gun}T00:00:00Z`), kind: OLAY } } }))?.events ?? 0;
  check("§12 günlük sayaç fabrika gününde olay başına +1", sonra - once === 2, `${once} → ${sonra}`);

  // ── §M tek tur ölçümü (yük: yüz outbox, elli ek alıcı) ─────────────────────
  for (let i = 0; i < 50; i++) await kisi(`m${i}`, ["order:read", "order:write"]);
  for (let i = 0; i < 100; i++) await emitIn(KOSUL, `m-${ek}-${i}`, { siparisId: `m-${ek}-${i}` }, { phase: "ACILDI", conditionId: randomUUID() });
  const t = process.hrtime.bigint();
  const m = await runNotificationDispatchOnce();
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  check("§M ölçüm: 100 outbox tek turda, ≥5000 upsert", m.processed === 100 && m.upserts >= 5000, `${m.upserts} upsert · ${ms.toFixed(0)} ms`);
  console.log(`   ⓘ ÖLÇÜM: tek tur ${m.processed} outbox → ${m.upserts} gelen kutusu upsert'i → ${ms.toFixed(0)} ms`);
}

async function temizle(): Promise<void> {
  try {
    const turler = TURLER as string[];
    await prisma.notificationInbox.deleteMany({ where: { OR: [{ userId: { in: users } }, { kind: { in: turler }, createdAt: { gte: BASLANGIC } }] } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: { in: turler }, createdAt: { gte: BASLANGIC } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectKey: `prune-${ek}` } });
    await prisma.notificationCondition.deleteMany({ where: { kind: { in: turler }, createdAt: { gte: BASLANGIC } } });
    await prisma.notificationDailyStats.deleteMany({ where: { kind: `test.prune-${ek}` } });
    for (const [kk, v] of statsOnce) {
      const [day, kind] = kk.split("|") as [string, string];
      const where = { factoryDay_kind: { factoryDay: new Date(`${day}T00:00:00Z`), kind } };
      if (v === null) await prisma.notificationDailyStats.deleteMany({ where: { factoryDay: new Date(`${day}T00:00:00Z`), kind } });
      else await prisma.notificationDailyStats.update({ where, data: { events: v } });
    }
    if (users.length > 0) {
      await prisma.userPermission.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
  } catch (err) {
    fail++;
    console.error("❌ temizlik başarısız", err);
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
