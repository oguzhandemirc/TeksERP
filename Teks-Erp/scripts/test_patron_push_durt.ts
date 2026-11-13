// =============================================================================
// BEKÇİ — PATRON TELEFONU DÜRTÜ: bildirim doğunca köprüye `durt` (push köprüsü P3, 2026-11-13)
// =============================================================================
//   §1 karar (`decideDeliveries`): önemli tür varsayılan dürter, önemsiz dürtmez · tercih açar/kapatır · yalnız özet
//      dürtmez · sessiz saat susturur, nöbetteki ALARM deler · katalog: 4 önemli tür, her türde seçilebilir
//   §2 kuyruk (dispatch tx): tx geri alınınca dürt yok · yalnız `pp` ∧ canlı belirteç · birleşen olay ikinci dürt doğurmaz ·
//      push bayrağı kapalıyken yazılmaz
//   §3 kapı kapalı (push ya da gelen kutusu) / lisans uygun değil → dışarı istek YOK, canlı dürt ATLANDI (birikme yok)
//   §4 gönderim: imza `bildir` + yol · gövde TAM METİN + `/bildirimler` + bildirimId · belirteç açılır
//   §5 okunan bildirimin dürtü İPTAL, istek yok
//   §6 sonuç kodları: KAPALI · GECICI · KALICI · BAGSIZ (belirteç yeniden bağlanır) · GECERSIZ · `gecersiz[]`
//   §7 HTTP: 401/403 (tur durur, deneme sayılmaz) · 429 (duraklama) · 503 · ağ (geri çekilme) · 400 (vazgeç)
//   §8 çift tur aynı satırı iki kez göndermez (atomik claim) · §9 hız bütçesi dolunca sırada bekler
//   §10 24 saatte vazgeçer · §11 budama yalnız terminal satır · §12 sır hijyeni (günlük, system_logs, kuyruk satırı)
//   §13 kuyruk ile gönderim arasında türü görme izni kalkan kullanıcıya dürt gitmez (ATLANDI GORMEZ)
// NEGATİF SONDA: harita satırında (`docs/bekci-harita/bildirim.md`). Gerçek bulut/Expo çağrısı YOK (sahte taşıyıcı).
// Koşum: npx tsx scripts/run-all-tests.ts patron_push_durt   (kendi _test DB'si; ayar yazar → hedef DB kapısı)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ClientType } from "@prisma/client";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { digestPushToken, sealPushToken } from "../src/services/patron-push/token-seal";
import { runPatronPushRound } from "../src/services/patron-push/cloud-round.service";
import { runNudgePhase } from "../src/services/patron-push/nudge-round";
import { resetNudgeRate, noteNudgeSent, NUDGE_RATE_PER_MIN } from "../src/services/patron-push/nudge-rate";
import { pruneNotifications } from "../src/services/notification-prune.service";
import { emitNotification } from "../src/services/helpers/notification-emit.helper";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import { decideDeliveries, type DeliveryContext, type DeliveryReason } from "../src/services/helpers/notification-delivery.helper";
import { EMPTY_LAYERS, prefKey, type PreferenceLayers } from "../src/services/helpers/notification-preference.helper";
import type { NotificationVisibilityEnv } from "../src/services/helpers/notification-visibility.helper";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import type { CloudTransport } from "../src/cloud-sync/cloud-client";
import { pushBridgeEligibility } from "../src/cloud-sync/eligibility";
import { PUSH_BRIDGE_PATHS, PushNudgeRequestSchema } from "../src/cloud-sync/wire";
import { setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { REQUEST_HEADER, verifyRequest } from "../src/lib/license/protocol";
import { uyari } from "../src/lib/logger";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

let captured = "";
function startLogCapture(): () => void {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const tap = (orig: typeof out) => ((chunk: unknown, ...rest: unknown[]) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof out;
  process.stdout.write = tap(out);
  process.stderr.write = tap(err);
  return () => { process.stdout.write = out; process.stderr.write = err; };
}

type Reply = { status: number; json: unknown };
interface NudgeCall { yol: string; signedOk: boolean; amac: string | null; yolImza: string | null; body: Record<string, unknown> | null; raw: string }
interface FakeCloud { calls: NudgeCall[]; transport: CloudTransport; reply: (digests: string[], body: Record<string, unknown>) => Reply; delayMs: number; key: { x: string; id: string } }
const ok200 = (json: unknown): Reply => ({ status: 200, json });
const allSent = (digests: string[]): Reply => ok200({ v: 1, gonderim: "acik", sonuclar: digests.map((ozet) => ({ ozet, sonuc: "GONDERILDI" })), gecersiz: [] });

function fakeCloud(publicKeyX: string, installationId: string): FakeCloud {
  const c: FakeCloud = {
    key: { x: publicKeyX, id: installationId },
    calls: [],
    delayMs: 0,
    reply: allSent,
    transport: async (req) => {
      const yol = new URL(req.url).pathname;
      const raw = req.body.toString("utf8");
      const v = verifyRequest(req.headers[REQUEST_HEADER], { publicKeyX: c.key.x, body: req.body, nowMs: Date.now(), purposes: ["bildir"], installationId: c.key.id, path: yol });
      const body = JSON.parse(raw) as Record<string, unknown>;
      c.calls.push({ yol, signedOk: v.ok, amac: v.ok ? v.value.amac : null, yolImza: v.ok ? (v.value.yol ?? null) : null, body, raw });
      if (c.delayMs > 0) await new Promise((r) => setTimeout(r, c.delayMs));
      const send = (r: Reply) => ({ status: r.status, body: Buffer.from(JSON.stringify(r.json)) });
      if (!v.ok) return send({ status: 401, json: { success: false, details: { code: v.code } } });
      if (yol === PUSH_BRIDGE_PATHS.REGISTER) return send(ok200({ v: 1, bagli: body.ozetler }));
      if (yol === PUSH_BRIDGE_PATHS.RELEASE) return send(ok200({ v: 1, birakilan: (body.ozetler as string[]).length }));
      if (yol === PUSH_BRIDGE_PATHS.NUDGE) return send(c.reply((body.belirtecler as string[]).map(digestPushToken), body));
      return send({ status: 404, json: {} });
    },
  };
  return c;
}
const err = (status: number, code: string): Reply => ({ status, json: { success: false, message: "x", details: { code } } });

const ENV: NotificationVisibilityEnv = { modules: { tezgahEnabled: true, financeEnabled: true }, gates: { tezgahAlarm: true } };
const CARI: NotificationKind = "cari.kilitlendi";
const YAZICI: NotificationKind = "yazici.hata";
const ALARM: NotificationKind = "dokuma.tezgah-alarmi";

function layers(prefs: Record<string, Record<string, boolean>>): PreferenceLayers {
  return {
    ...EMPTY_LAYERS,
    prefs: new Map(Object.entries(prefs).map(([u, m]) => [u, new Map(Object.entries(m).map(([k, enabled]) => [k, { enabled, scope: null }]))])),
  };
}

async function bolum1(): Promise<void> {
  console.log("=== §1 karar ===");
  const fin = randomUUID(), prn = randomUUID(), off = randomUUID(), on = randomUUID(), dig = randomUUID();
  const grants = new Map<string, string[]>([
    [fin, ["finance:read", "finance:invoice"]], [prn, ["system:print-history"]], [off, ["finance:read", "finance:invoice"]],
    [on, ["system:print-history"]], [dig, ["system:print-history"]],
  ]);
  const row = { subjectType: "test", subjectId: null, payload: {}, actorUserId: null };
  const ctx = (l: PreferenceLayers, settings = new Map<string, DeliveryContext["settings"] extends ReadonlyMap<string, infer V> ? V : never>()): DeliveryContext =>
    ({ layers: l, now: new Date("2026-03-10T20:30:00Z"), myStations: new Map(), settings });
  const l = layers({
    [off]: { [prefKey(CARI, "PATRON_PUSH")]: false },
    [on]: { [prefKey(YAZICI, "PATRON_PUSH")]: true },
    [dig]: { [prefKey(YAZICI, "PATRON_PUSH")]: true, [prefKey(YAZICI, "UYGULAMA")]: false, [prefKey(YAZICI, "OZET")]: true },
  });
  const dc = await decideDeliveries({ tx: prisma, row, kind: CARI, entry: getNotificationEntry(CARI), env: ENV, grants, ctx: ctx(l) }, [{ userId: fin, reason: "IZIN" }, { userId: off, reason: "IZIN" }]);
  const dy = await decideDeliveries({ tx: prisma, row, kind: YAZICI, entry: getNotificationEntry(YAZICI), env: ENV, grants, ctx: ctx(l) },
    [{ userId: prn, reason: "IZIN" }, { userId: on, reason: "IZIN" }, { userId: dig, reason: "IZIN" }]);
  const by = new Map([...dc, ...dy].map((d) => [d.userId, d]));
  check("§1a önemli tür (cari kilidi) varsayılan dürter; önemsiz tür (yazıcı hatası) varsayılan dürtmez", by.get(fin)?.pp === true && by.get(prn)?.pp === false, `${by.get(fin)?.pp}/${by.get(prn)?.pp}`);
  check("§1b tercih: önemli türü kapatan almaz, önemsizi açan alır (masaüstü/tablet değişmez)",
    by.get(off)?.pp === false && by.get(on)?.pp === true && by.get(on)?.km === false && by.get(on)?.kt === false);
  check("§1c yalnız gün özeti teslimi dürtmez", by.get(dig)?.ozet === true && by.get(dig)?.pp === false, JSON.stringify(by.get(dig)));
  const nob = randomUUID(), ali = randomUUID(), acik = randomUUID();
  const ag = new Map<string, string[]>([[nob, ["loom:alarm-view"]], [ali, ["loom:alarm-view"]], [acik, ["loom:alarm-view"]]]);
  const quiet = { quietStart: "22:00", quietEnd: "07:00", quietChannels: ["PATRON_PUSH"] };
  const quietNoPush = { quietStart: "22:00", quietEnd: "07:00", quietChannels: ["MASAUSTU"] };
  const da = await decideDeliveries({ tx: prisma, row: { ...row, subjectType: "loom_alarm" }, kind: ALARM, entry: getNotificationEntry(ALARM), env: ENV, grants: ag,
    ctx: ctx(EMPTY_LAYERS, new Map([[nob, quiet], [ali, quiet], [acik, quietNoPush]])) },
  [{ userId: nob, reason: "NOBET" as DeliveryReason }, { userId: ali, reason: "ALARM_ALICISI" }, { userId: acik, reason: "ALARM_ALICISI" }]);
  const ba = new Map(da.map((d) => [d.userId, d]));
  check("§1d sessiz saat PATRON_PUSH'u susturur; nöbetteki ALARM deler; sessiz kümesinde PATRON_PUSH yoksa susmaz",
    ba.get(nob)?.pp === true && ba.get(ali)?.pp === false && ba.get(acik)?.pp === true, JSON.stringify(da.map((d) => [d.reason, d.pp])));
  const defaults = NOTIFICATION_KINDS.filter((k) => (getNotificationEntry(k).varsayilanKanallar as readonly string[]).includes("PATRON_PUSH")).sort();
  check("§1e varsayılan dürt yalnız 4 önemli türde; her tür PATRON_PUSH'u seçilebilir taşır",
    JSON.stringify(defaults) === JSON.stringify(["cari.kilitlendi", "dokuma.tezgah-alarmi", "kimlik.supheli-giris-denemesi", "kimlik.yeni-cihaz-girisi"])
      && NOTIFICATION_KINDS.every((k) => (getNotificationEntry(k).kanallar as readonly string[]).includes("PATRON_PUSH")), defaults.join(","));
}

async function main(): Promise<void> {
  await bolum1();
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); return; }
  const stopCapture = startLogCapture();
  const startedAt = new Date();
  const ringDir = fs.mkdtempSync(path.join(os.tmpdir(), "durt-halka-"));
  setShortCredentialKeyDirForTests(ringDir);
  const T = `TEST-PPD-${Date.now()}`;
  const raw = (tag: string) => `ExponentPushToken[ZZdurtSENTINEL${tag}x${Date.now().toString(36)}]`;
  const userIds: string[] = [];
  const settingKeys = [SETTING_KEYS.BILDIRIM_PATRON_PUSH_ENABLED, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: settingKeys } }, select: { key: true, value: true } });
  const setFlags = async (push: boolean, inbox: boolean) => {
    for (const [key, value] of [[settingKeys[0]!, push], [settingKeys[1]!, inbox]] as const) {
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    invalidateFeatureFlagsCache();
  };
  const perm = await prisma.permission.findUnique({ where: { code: "system:print-history" }, select: { id: true } });
  const makeUser = async (tag: string, pushPref: boolean) => {
    const u = await prisma.user.create({ data: { username: `${T}-${tag}`.slice(0, 50), passwordHash: "x", fullName: `TEST dürt ${tag}`, permissions: perm ? { create: [{ permissionId: perm.id }] } : undefined }, select: { id: true } });
    userIds.push(u.id);
    if (pushPref) await prisma.notificationPreference.create({ data: { userId: u.id, kind: YAZICI, channel: "PATRON_PUSH", enabled: true } });
    return u.id;
  };
  const addToken = async (userId: string, belirtec: string, state: "KAYITLI" | "BEKLIYOR" = "KAYITLI") => {
    const s = await prisma.session.create({ data: { userId, deviceType: ClientType.PATRON, jti: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) }, select: { id: true } });
    const d = digestPushToken(belirtec);
    await prisma.patronPushToken.create({ data: { userId, sessionId: s.id, tokenDigest: d, tokenSealed: sealPushToken(belirtec, d), platform: "android", cloudState: state } });
  };
  const emit = async (yazici: string, extra: Record<string, unknown> = {}) =>
    prisma.$transaction((tx) => emitNotification(tx, YAZICI, { type: "printer", id: null, key: yazici }, { yazici, yaziciAd: `Yazıcı ${yazici}`, kisi: "Ayşe", tur: "Etiket", neden: "Kâğıt bitti — uzun açıklama metni tam gider", ...extra }, { actorUserId: null }));
  const dispatch = async () => { for (let i = 0; i < 50; i++) if ((await runNotificationDispatchOnce()).processed === 0) break; };
  const inboxOf = (userId: string, yazici: string) => prisma.notificationInbox.findFirst({ where: { userId, kind: YAZICI, groupKey: { startsWith: `${YAZICI}:${yazici}:` } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const nudgesOf = async (userId: string, yazici: string) => {
    const i = await inboxOf(userId, yazici);
    return i ? prisma.patronPushNudge.findMany({ where: { inboxId: i.id }, orderBy: { createdAt: "asc" } }) : [];
  };
  const closeMine = async () => {
    await prisma.patronPushNudge.updateMany({ where: { state: { in: ["BEKLIYOR", "GONDERILIYOR"] }, inbox: { userId: { in: userIds } } }, data: { state: "ATLANDI", finishedAt: new Date(), claimedAt: null } });
  };
  try {
    if (!perm) throw new Error("fikstür izni yok: system:print-history");
    setCloudUrlForTests("https://patron-bulut.test");
    let kur = lisansKipKur({ zorlama: false });
    const cloud = fakeCloud(kur.f.kurulum.x, kur.f.kurulumId);
    const nudgeCalls = () => cloud.calls.filter((c) => c.yol === PUSH_BRIDGE_PATHS.NUDGE);
    const round = async (now?: Date) => { resetNudgeRate(); return runPatronPushRound({ transport: cloud.transport, ...(now ? { now } : {}) }); };
    await setFlags(true, true);
    const P = await makeUser("p", true);
    const Q = await makeUser("q", true);
    const R = await makeUser("r", false);
    const rawP = raw("P");
    await addToken(P, rawP);
    await addToken(R, raw("R"));

    console.log("\n=== §2 kuyruk ===");
    const y1 = `${T}-y1`;
    await emit(y1);
    const boom = async () => { throw new Error("sonda: commit öncesi düş"); };
    for (let i = 0; i < 3; i++) await runNotificationDispatchOnce({ beforeCommit: boom });
    const outboxLeft = await prisma.notificationOutbox.count({ where: { kind: YAZICI, subjectKey: y1, processedAt: null } });
    check("§2a dağıtım tx'i geri alınınca ne kutu satırı ne dürt var", outboxLeft === 1 && (await inboxOf(P, y1)) === null
      && (await prisma.patronPushNudge.count({ where: { inbox: { userId: P } } })) === 0, `outbox=${outboxLeft}`);
    await dispatch();
    const [nP, nQ, nR] = [await nudgesOf(P, y1), await nudgesOf(Q, y1), await nudgesOf(R, y1)];
    check("§2b yalnız tercihi açık ∧ belirteci olan kullanıcıya dürt (Q belirteçsiz, R tercihsiz)", nP.length === 1 && nP[0]!.state === "BEKLIYOR" && nQ.length === 0 && nR.length === 0,
      `${nP.length}/${nQ.length}/${nR.length}`);
    await emit(y1, { neden: "ikinci olay" });
    await dispatch();
    check("§2c aynı kutu satırına birleşen olay bekleyen dürt varken ikinci dürt doğurmaz", (await nudgesOf(P, y1)).length === 1);
    await setFlags(false, true);
    const y2 = `${T}-y2`;
    await emit(y2);
    await dispatch();
    check("§2d push bayrağı kapalıyken kutu satırı yazılır, dürt yazılmaz", (await inboxOf(P, y2)) !== null && (await nudgesOf(P, y2)).length === 0);

    console.log("\n=== §3 kapı kapalı ===");
    let sum = await round();
    const n1 = (await nudgesOf(P, y1))[0];
    check("§3a push kapalı → tur KAPALI, dışarı istek YOK, canlı dürt ATLANDI", sum.durum === "KAPALI" && cloud.calls.length === 0 && n1?.state === "ATLANDI" && n1.finishedAt !== null,
      `${sum.durum} çağrı=${cloud.calls.length} ${n1?.state}`);
    await setFlags(true, true);
    const y3 = `${T}-y3`;
    await emit(y3);
    await dispatch();
    kur = lisansKipKur({ zorlama: false, kiraEk: { devredildi: true } });
    sum = await round();
    check("§3b lisans uygun değil → UYGUN_DEGIL, dışarı istek YOK, dürt ATLANDI", sum.durum === "UYGUN_DEGIL" && cloud.calls.length === 0 && (await nudgesOf(P, y3))[0]?.state === "ATLANDI", sum.durum);
    kur = lisansKipKur({ zorlama: false });
    cloud.key = { x: kur.f.kurulum.x, id: kur.f.kurulumId };
    const y3c = `${T}-y3c`;
    await emit(y3c);
    await dispatch();
    await setFlags(true, false);
    sum = await round();
    await setFlags(true, true);
    check("§3c gelen kutusu kapalı → tur KAPALI, dışarı istek YOK, dürt ATLANDI", sum.durum === "KAPALI" && cloud.calls.length === 0 && (await nudgesOf(P, y3c))[0]?.state === "ATLANDI", sum.durum);

    console.log("\n=== §4 gönderim ===");
    const y4 = `${T}-y4`;
    await emit(y4);
    await dispatch();
    sum = await round();
    const c4 = nudgeCalls().at(-1);
    const inbox4 = await inboxOf(P, y4);
    const parsed = c4 ? PushNudgeRequestSchema.safeParse(c4.body) : null;
    const data = (c4?.body?.data ?? {}) as { bildirimId?: string; rota?: string };
    check("§4a imzalı `durt`: amaç `bildir`, imzalı yol = uç, gövde sözleşme şemasında", !!c4 && c4.signedOk && c4.amac === "bildir" && c4.yolImza === PUSH_BRIDGE_PATHS.NUDGE && !!parsed?.success);
    check("§4b gövde TAM METİN (başlık + gövde kutudan render) + rota `/bildirimler` + bildirimId = kutu satırı",
      c4?.body?.baslik === `Yazıcı ${y4} yazıcısında baskı hatası` && c4?.body?.govde === "Ayşe · Etiket · Kâğıt bitti — uzun açıklama metni tam gider"
        && data.rota === "/bildirimler" && data.bildirimId === inbox4?.id, JSON.stringify({ b: c4?.body?.baslik, r: data.rota }));
    check("§4c belirteç halkadan açıldı (ham yalnız istek gövdesinde) · satır GONDERILDI", JSON.stringify(c4?.body?.belirtecler) === JSON.stringify([rawP])
      && (await nudgesOf(P, y4))[0]?.state === "GONDERILDI");

    console.log("\n=== §5 okundu → iptal ===");
    const y5 = `${T}-y5`;
    await emit(y5);
    await dispatch();
    await prisma.notificationInbox.updateMany({ where: { id: (await inboxOf(P, y5))?.id }, data: { readAt: new Date() } });
    const before5 = nudgeCalls().length;
    await round();
    const n5 = (await nudgesOf(P, y5))[0];
    check("§5 okunmuş bildirimin dürtü İPTAL, istek gitmez", n5?.state === "IPTAL" && nudgeCalls().length === before5, String(n5?.state));

    console.log("\n=== §6 sonuç kodları ===");
    const one = async (tag: string, reply: FakeCloud["reply"], now?: Date) => {
      await closeMine();
      const y = `${T}-${tag}`;
      await emit(y);
      await dispatch();
      cloud.reply = reply;
      await round(now);
      cloud.reply = allSent;
      return { y, n: (await nudgesOf(P, y))[0] };
    };
    const outcome = (sonuc: string) => (d: string[]) => ok200({ v: 1, gonderim: sonuc === "KAPALI" ? "kapali" : "acik", sonuclar: d.map((ozet) => ({ ozet, sonuc })), gecersiz: [] });
    const tok = () => prisma.patronPushToken.findUnique({ where: { tokenDigest: digestPushToken(rawP) } });
    let r6 = await one("k", outcome("KAPALI"));
    check("§6a KAPALI → tamam (GONDERILDI, BULUT_KAPALI), belirteç SİLİNMEZ", r6.n?.state === "GONDERILDI" && r6.n.lastErrorCode === "BULUT_KAPALI" && (await tok())?.cloudState === "KAYITLI");
    const t6 = new Date();
    r6 = await one("g", outcome("GECICI"), t6);
    check("§6b GECICI → BEKLIYOR, deneme 1, ileri vade", r6.n?.state === "BEKLIYOR" && r6.n.attempts === 1 && !!r6.n.nextAttemptAt && r6.n.nextAttemptAt > t6, `${r6.n?.state} a=${r6.n?.attempts}`);
    r6 = await one("x", outcome("KALICI"));
    check("§6c KALICI → VAZGECILDI", r6.n?.state === "VAZGECILDI", String(r6.n?.state));
    const t6b = new Date();
    r6 = await one("b", outcome("BAGSIZ"), t6b);
    check("§6d BAGSIZ → dürt yeniden denenecek, belirteç BEKLIYOR'a döner", r6.n?.state === "BEKLIYOR" && (await tok())?.cloudState === "BEKLIYOR", `${r6.n?.state} ${(await tok())?.cloudState}`);
    await round(new Date((r6.n?.nextAttemptAt ?? t6b).getTime() + 1000));
    const nb = (await nudgesOf(P, r6.y))[0];
    check("§6e sonraki tur `kaydet` ile yeniden bağlar ve aynı dürtü gönderir", (await tok())?.cloudState === "KAYITLI" && nb?.state === "GONDERILDI", `${(await tok())?.cloudState} ${nb?.state}`);
    const rawP2 = raw("P2");
    await addToken(P, rawP2);
    r6 = await one("v", (d) => ok200({ v: 1, gonderim: "acik", sonuclar: d.map((ozet) => ({ ozet, sonuc: "GONDERILDI" })), gecersiz: [digestPushToken(rawP2)] }));
    const t2 = await prisma.patronPushToken.findUnique({ where: { tokenDigest: digestPushToken(rawP2) } });
    check("§6f `gecersiz[]` → o belirteç BIRAKILDI (ham silinmiş, birak YOK); dürt GONDERILDI",
      r6.n?.state === "GONDERILDI" && t2?.cloudState === "BIRAKILDI" && t2.tokenSealed === null && t2.releasedAt !== null && !cloud.calls.some((c) => c.yol === PUSH_BRIDGE_PATHS.RELEASE && c.raw.includes(digestPushToken(rawP2))));
    r6 = await one("i", outcome("GECERSIZ"));
    const t1 = await tok();
    check("§6g GECERSIZ → belirteç BIRAKILDI, dürt ATLANDI (gönderilecek cihaz kalmadı)", r6.n?.state === "ATLANDI" && t1?.cloudState === "BIRAKILDI" && t1.tokenSealed === null, `${r6.n?.state} ${t1?.cloudState}`);
    const rawP3 = raw("P3");
    await addToken(P, rawP3);

    console.log("\n=== §7 HTTP hataları ===");
    await closeMine();
    const [y7a, y7b] = [`${T}-h401a`, `${T}-h401b`];
    await emit(y7a);
    await emit(y7b);
    await dispatch();
    cloud.reply = () => err(401, "KURULUM_BILINMIYOR");
    const b401 = nudgeCalls().length;
    await round();
    cloud.reply = allSent;
    // İki satır aynı tx'te doğar (createdAt eşit, sıra id'ye göre): hangisinin istek gördüğü belirsiz, biri ve yalnız biri.
    const pair = [(await nudgesOf(P, y7a))[0], (await nudgesOf(P, y7b))[0]];
    const held = pair.filter((n) => (n?.lastErrorCode ?? "").startsWith("401") && !!n?.nextAttemptAt);
    const untouched = pair.filter((n) => n?.lastErrorCode === null && n.nextAttemptAt === null);
    check("§7a 401 → tur durur (tek istek), satırlar bekler, deneme sayılmaz, ileri vade",
      nudgeCalls().length - b401 === 1 && pair.every((n) => n?.state === "BEKLIYOR" && n.attempts === 0) && held.length === 1 && untouched.length === 1,
      `istek=${nudgeCalls().length - b401} ${pair.map((n) => `${n?.state}:${n?.lastErrorCode}`).join("/")}`);
    let r7 = await one("h403", () => err(403, "LISANS_GECERSIZ"));
    check("§7a2 403 → satır bekler (BEKLIYOR, deneme sayılmaz, ileri vade)", r7.n?.state === "BEKLIYOR" && r7.n.attempts === 0 && !!r7.n.nextAttemptAt && (r7.n.lastErrorCode ?? "").startsWith("403"), `${r7.n?.state} ${r7.n?.lastErrorCode}`);
    await closeMine();
    const y7 = `${T}-h429`;
    await emit(y7);
    await dispatch();
    cloud.reply = () => err(429, "HIZ_SINIRI");
    resetNudgeRate();
    await runPatronPushRound({ transport: cloud.transport });
    cloud.reply = allSent;
    const n429 = (await nudgesOf(P, y7))[0];
    const y7n = `${T}-h429n`;
    await emit(y7n);
    await dispatch();
    const calls429 = nudgeCalls().length;
    await runPatronPushRound({ transport: cloud.transport, now: new Date(Date.now() + 30_000) });
    check("§7b 429 → satır bekler (deneme sayılmaz); duraklama boyunca YENİ dürt de gitmez", n429?.state === "BEKLIYOR" && n429.attempts === 0 && nudgeCalls().length === calls429
      && (await nudgesOf(P, y7n))[0]?.state === "BEKLIYOR", `${n429?.state} istek=${nudgeCalls().length - calls429}`);
    r7 = await one("h503", () => err(503, "TEKRAR_DENEYIN"));
    check("§7c 503 → geri çekilme (deneme 1)", r7.n?.state === "BEKLIYOR" && r7.n.attempts === 1, `${r7.n?.state} a=${r7.n?.attempts}`);
    r7 = await one("hag", () => { throw new Error("sonda: ağ koptu"); });
    check("§7d ağ hatası → geri çekilme (deneme 1)", r7.n?.state === "BEKLIYOR" && r7.n.attempts === 1 && r7.n.lastErrorCode === "EGRESS_NETWORK", `${r7.n?.state} ${r7.n?.lastErrorCode}`);
    r7 = await one("h400", () => err(400, "GOVDE_GECERSIZ"));
    check("§7e 400 → VAZGECILDI (yeniden deneme yok)", r7.n?.state === "VAZGECILDI" && (r7.n.lastErrorCode ?? "").startsWith("400"), `${r7.n?.state}`);

    console.log("\n=== §8 çift tur ===");
    await closeMine();
    const [y8, y8b] = [`${T}-y8`, `${T}-y8b`];
    await emit(y8);
    await dispatch();
    await emit(y8b);
    await dispatch();
    const el = pushBridgeEligibility();
    if (!el.ok) throw new Error(`uygunluk yok: ${el.reason}`);
    const ctx = { baseUrl: el.baseUrl, installationId: el.installationId, transport: cloud.transport };
    resetNudgeRate();
    cloud.delayMs = 150;
    const b8 = nudgeCalls().length;
    // A iki satırı listeler, ilkini gönderirken (taşıyıcı 150 ms) B başlar ve ikinciyi alır; A ikinciye döndüğünde
    // claim'i boşa düşmeli. Koşulsuz claim'de ikinci dürt iki kez gider.
    const late = new Promise<void>((r) => setTimeout(r, 40)).then(() => runNudgePhase(ctx, new Date()));
    await Promise.all([runNudgePhase(ctx, new Date()), late]);
    cloud.delayMs = 0;
    const ids8 = [(await inboxOf(P, y8))?.id, (await inboxOf(P, y8b))?.id];
    const sent8 = ids8.map((id) => nudgeCalls().slice(b8).filter((c) => (c.body?.data as { bildirimId?: string } | undefined)?.bildirimId === id).length);
    check("§8 iki eşzamanlı tur her dürtü BİR kez gönderir (atomik claim)", sent8.every((n) => n === 1) && (await nudgesOf(P, y8))[0]?.state === "GONDERILDI"
      && (await nudgesOf(P, y8b))[0]?.state === "GONDERILDI", `gönderim=${sent8.join("/")}`);

    console.log("\n=== §9 hız bütçesi ===");
    const y9 = `${T}-y9`;
    await emit(y9);
    await dispatch();
    resetNudgeRate();
    for (let i = 0; i < NUDGE_RATE_PER_MIN; i++) noteNudgeSent(Date.now());
    const b9 = nudgeCalls().length;
    const s9 = await runNudgePhase(ctx, new Date());
    check("§9a bütçe dolu → dürt gitmez, satır sırada (BEKLIYOR, claim yok)", nudgeCalls().length === b9 && s9.sirada >= 1 && (await nudgesOf(P, y9))[0]?.state === "BEKLIYOR", `sirada=${s9.sirada}`);
    resetNudgeRate();
    await runNudgePhase(ctx, new Date());
    check("§9b bütçe açılınca aynı satır gider", (await nudgesOf(P, y9))[0]?.state === "GONDERILDI");

    console.log("\n=== §10 24 saat ===");
    const y10 = `${T}-y10`;
    await emit(y10);
    await dispatch();
    const n10 = (await nudgesOf(P, y10))[0]!;
    await prisma.patronPushNudge.update({ where: { id: n10.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const b10 = nudgeCalls().length;
    await round();
    const a10 = await prisma.patronPushNudge.findUnique({ where: { id: n10.id } });
    check("§10 24 saatten eski dürt VAZGECILDI (SURE_DOLDU), istek gitmez", a10?.state === "VAZGECILDI" && a10.lastErrorCode === "SURE_DOLDU" && nudgeCalls().length === b10, `${a10?.state}`);

    console.log("\n=== §11 budama ===");
    const y11 = `${T}-y11`;
    await emit(y11);
    await dispatch();
    const live11 = (await nudgesOf(P, y11))[0]!;
    await prisma.patronPushNudge.update({ where: { id: n10.id }, data: { finishedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await prisma.patronPushNudge.update({ where: { id: live11.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    await pruneNotifications();
    check("§11 budama yalnız 7 günden eski TERMİNAL satırı siler, canlı eski satır kalır",
      (await prisma.patronPushNudge.findUnique({ where: { id: n10.id } })) === null && (await prisma.patronPushNudge.findUnique({ where: { id: live11.id } })) !== null);

    console.log("\n=== §13 izin kaybı ===");
    await closeMine();
    const y13 = `${T}-y13`;
    await emit(y13);
    await dispatch();
    await prisma.userPermission.deleteMany({ where: { userId: P, permissionId: perm.id } });
    const b13 = nudgeCalls().length;
    await round();
    await prisma.userPermission.create({ data: { userId: P, permissionId: perm.id } });
    const n13 = (await nudgesOf(P, y13))[0];
    check("§13 izni kalkan kullanıcıya dürt gitmez (ATLANDI GORMEZ, istek yok)", n13?.state === "ATLANDI" && n13.lastErrorCode === "GORMEZ" && nudgeCalls().length === b13, `${n13?.state} ${n13?.lastErrorCode}`);

    console.log("\n=== §12 sır hijyeni ===");
    uyari("test-patron-durt", "yakalama-sondasi");
    check("§12a günlük yakalama çalışıyor", captured.includes("yakalama-sondasi"));
    check("§12b günlükte (stdout/stderr) ham belirteç ve bildirim metni yok", !captured.includes("SENTINEL") && !captured.includes("uzun açıklama metni"));
    const logs = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM system_logs s WHERE s."createdAt" >= ${startedAt} AND (row_to_json(s)::text LIKE ${"%SENTINEL%"} OR row_to_json(s)::text LIKE ${"%uzun açıklama metni%"})`;
    check("§12c system_logs'ta (audit) ham belirteç ve bildirim metni yok", logs[0]?.n === 0, String(logs[0]?.n));
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM patron_push_nudges n WHERE row_to_json(n)::text LIKE ${"%SENTINEL%"} OR row_to_json(n)::text LIKE ${"%Kâğıt%"}`;
    check("§12d kuyruk satırında belirteç ve bildirim metni yok", rows[0]?.n === 0, String(rows[0]?.n));
  } finally {
    stopCapture();
    resetNudgeRate();
    temizleLisansKipDizini();
    setCloudUrlForTests(null);
    setShortCredentialKeyDirForTests(null);
    fs.rmSync(ringDir, { recursive: true, force: true });
    for (const key of settingKeys) {
      const prev = before.find((f) => f.key === key);
      if (prev) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    invalidateFeatureFlagsCache();
    await prisma.notificationInbox.deleteMany({ where: { userId: { in: userIds } } }); // dürt satırları CASCADE
    await prisma.notificationInbox.deleteMany({ where: { kind: YAZICI, groupKey: { startsWith: `${YAZICI}:${T}` } } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: YAZICI, subjectKey: { startsWith: T } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.patronPushToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
  }
}

main()
  .catch((e) => { check("beklenmeyen hata", false, String((e as Error)?.stack ?? e)); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
