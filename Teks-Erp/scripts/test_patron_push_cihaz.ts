// =============================================================================
// BEKÇİ — PATRON PUSH CİHAZI: `POST/DELETE /api/bildirim/cihaz` + bulut turu (push köprüsü P2, 2026-11-13)
// =============================================================================
//   §1 statik: toplu kapı (verifyToken + patron-app:login) ilk uçtan önce; gövde katı şema
//   §2 kapılar: iki bayraktan biri kapalı → POST 409 PATRON_PUSH_KAPALI, satır yok · patron dışı oturum 403
//      PATRON_ISTEMCI_DEGIL · patron-app:login yok 403 · başkası adına yazım (userId alanı) 400
//   §3 kayıt: özetle idempotent (iki POST tek satır) · DB'de ham yok (`ptk1:` sarılı), yanıtta ham/özet yok
//   §4 sahiplik devri (aynı belirteç başka kullanıcıya geçer) · başkasının belirteci silinemez · dirilme
//   §5 tavan 10: 11. kayıt EN ESKİYİ bırakır
//   §6 yaşam sonu: çıkış · parola değişimi · pasife alma → BIRAKILACAK + ham silinmiş
//   §7 anahtar halkası yok → 503 PUSH_ANAHTAR_YOK, satır yazılmaz
//   §8 kapı kapalıyken DELETE başarılı; tur KAPALI, dışarı istek YOK; `/auth/me` patronPush yok
//   §9 bulut turu (sahte taşıyıcı): imza amaç `bildir` + `yol` · gövdede ham yok · 503 → istek etkilenmez, geri
//      çekilme, sonra KAYITLI · bırakılan → `birak` → BIRAKILDI · lisans uygun değil → dışarı istek YOK
//   §10 sır hijyeni: ham belirteç günlükte (stdout/stderr, testte açıkça yakalanır) ve system_logs'ta YOK
// NEGATİF SONDA: harita satırında (`docs/bekci-harita/bildirim.md`). Gerçek bulut çağrısı YOK.
// Koşum: npx tsx scripts/run-all-tests.ts patron_push_cihaz   (kendi _test DB'si; ayar yazar → hedef DB kapısı)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { PATRON_LOGIN_PERMISSION } from "../src/constants/permission-catalog";
import { SHORT_CREDENTIAL_KEY_FILE, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { digestPushToken, openPushToken, PUSH_TOKEN_SEAL_PREFIX } from "../src/services/patron-push/token-seal";
import { runPatronPushRound } from "../src/services/patron-push/cloud-round.service";
import { MAX_PUSH_TOKENS_PER_USER } from "../src/services/patron-push/device.service";
import type { CloudTransport } from "../src/cloud-sync/cloud-client";
import { PUSH_BRIDGE_PATHS } from "../src/cloud-sync/wire";
import { setCloudUrlForTests } from "../src/cloud-sync/cloud-url";
import { REQUEST_HEADER, verifyRequest } from "../src/lib/license/protocol";
import { uyari } from "../src/lib/logger";
import { lisansKipKur, temizleLisansKipDizini } from "./lib/lisans-kip-fikstur";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
type Reply = { status: number; text: string; body: { data?: Record<string, unknown>; details?: { code?: string } } };

// Günlük yakalama AÇIKÇA açılır (ortamdan bağımsız): stdout/stderr'e yazılan her bayt tampona da düşer.
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

interface FakeCloud { calls: Array<{ yol: string; body: string; signedOk: boolean; amac: string | null; yolImza: string | null }>; transport: CloudTransport; mode: "OK" | "503" }
function fakeCloud(publicKeyX: string, installationId: string): FakeCloud {
  const c: FakeCloud = {
    calls: [],
    mode: "OK",
    transport: async (req) => {
      const yol = new URL(req.url).pathname;
      const body = req.body.toString("utf8");
      const v = verifyRequest(req.headers[REQUEST_HEADER], { publicKeyX, body: req.body, nowMs: Date.now(), purposes: ["bildir"], installationId, path: yol });
      c.calls.push({ yol, body, signedOk: v.ok, amac: v.ok ? v.value.amac : null, yolImza: v.ok ? (v.value.yol ?? null) : null });
      if (!v.ok) return { status: 401, body: Buffer.from(JSON.stringify({ success: false, details: { code: v.code } })) };
      if (c.mode === "503") return { status: 503, body: Buffer.from(JSON.stringify({ success: false, message: "x", details: { code: "TEKRAR_DENEYIN" } })) };
      const ozetler = (JSON.parse(body) as { ozetler: string[] }).ozetler;
      if (yol === PUSH_BRIDGE_PATHS.REGISTER) return { status: 200, body: Buffer.from(JSON.stringify({ v: 1, bagli: ozetler })) };
      if (yol === PUSH_BRIDGE_PATHS.RELEASE) return { status: 200, body: Buffer.from(JSON.stringify({ v: 1, birakilan: ozetler.length })) };
      return { status: 404, body: Buffer.from("{}") };
    },
  };
  return c;
}

function statik(): void {
  console.log("=== §1 statik ===");
  const route = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "patron-push.routes.ts"), "utf8");
  const use = route.indexOf("router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION))");
  const first = Math.min(...["router.post(", "router.delete("].map((s) => route.indexOf(s)).filter((i) => i >= 0));
  check("§1a toplu kapı verifyToken + patron-app:login, ilk uçtan ÖNCE", use > 0 && use < first);
  check("§1b gövde şemaları katı (z.strictObject)", (route.match(/z\.strictObject\(/g) ?? []).length === 2);
}

async function main(): Promise<void> {
  statik();
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); return; }
  await reconcilePermissionCatalog();
  process.env.RATE_LIMIT_ENABLED = "false";
  const stopCapture = startLogCapture();
  const startedAt = new Date();
  const ringRoot = fs.mkdtempSync(path.join(os.tmpdir(), "push-halka-"));
  const goodRing = path.join(ringRoot, "iyi");
  const badRing = path.join(ringRoot, "bozuk");
  fs.mkdirSync(badRing, { recursive: true });
  fs.writeFileSync(path.join(badRing, SHORT_CREDENTIAL_KEY_FILE), "bozuk-halka");
  setShortCredentialKeyDirForTests(goodRing);
  const T = `TEST-PPC-${Date.now()}`;
  const stamp = String(Date.now());
  const raw = (tag: string) => `ExponentPushToken[ZZhamSENTINEL${tag}x${stamp}]`;
  const PASS = "Deneme-patron-push-12345";
  const userIds: string[] = [];
  const settingKeys = [SETTING_KEYS.BILDIRIM_PATRON_PUSH_ENABLED, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: settingKeys } }, select: { key: true, value: true } });
  const setGate = async (push: boolean, inbox: boolean) => {
    for (const [key, value] of [[settingKeys[0]!, push], [settingKeys[1]!, inbox]] as const) {
      await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    invalidateFeatureFlagsCache();
  };
  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (p: string, token?: string, method = "GET", body?: unknown): Promise<Reply> => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    try { return { status: r.status, text, body: JSON.parse(text) as Reply["body"] }; } catch { return { status: r.status, text, body: {} }; }
  };
  const replies: string[] = [];
  const reg = async (token: string, belirtec: string, extra: Record<string, unknown> = {}) => {
    const r = await call("/bildirim/cihaz", token, "POST", { belirtec, platform: "android", cihazAdi: "Test telefonu", ...extra });
    replies.push(r.text);
    return r;
  };
  const del = async (token: string, belirtec: string) => {
    const r = await call("/bildirim/cihaz", token, "DELETE", { belirtec });
    replies.push(r.text);
    return r;
  };
  const row = (belirtec: string) => prisma.patronPushToken.findUnique({ where: { tokenDigest: digestPushToken(belirtec) } });
  const makeUser = async (tag: string, codes: string[], clientType = "patron") => {
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    if (perms.length !== codes.length) throw new Error(`fikstür izinleri eksik: ${codes.join(",")}`);
    const u = await prisma.user.create({ data: { username: `${T}-${tag}`, passwordHash: await AuthService.hashPassword(PASS), fullName: `TEST patron push ${tag}`, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } }, select: { id: true, username: true } });
    userIds.push(u.id);
    const r = await call("/auth/login", undefined, "POST", { username: u.username, password: PASS, clientType, confirmKick: true });
    const token = (r.body.data as { token?: string } | undefined)?.token;
    if (!token) throw new Error(`giriş başarısız ${tag}: ${r.status}`);
    return { id: u.id, token };
  };
  try {
    setCloudUrlForTests("https://patron-bulut.test");
    let kur = lisansKipKur({ zorlama: false });
    let cloud = fakeCloud(kur.f.kurulum.x, kur.f.kurulumId);
    await setGate(true, true);
    const a = await makeUser("a", [PATRON_LOGIN_PERMISSION]);
    const b = await makeUser("b", [PATRON_LOGIN_PERMISSION]);
    const c = await makeUser("c", [PATRON_LOGIN_PERMISSION]);
    const pw = await makeUser("pw", [PATRON_LOGIN_PERMISSION]);
    const pas = await makeUser("pas", [PATRON_LOGIN_PERMISSION]);
    const panel = await makeUser("panel", [PATRON_LOGIN_PERMISSION, "report:inventory"], "electron");
    const noPerm = await makeUser("noperm", ["report:inventory"], "electron");

    console.log("\n=== §2 kapılar ===");
    await setGate(false, true);
    let r = await reg(a.token, raw("A"));
    check("§2a push bayrağı kapalı → 409 PATRON_PUSH_KAPALI, satır yok", r.status === 409 && r.body.details?.code === "PATRON_PUSH_KAPALI" && (await row(raw("A"))) === null, String(r.status));
    await setGate(true, false);
    r = await reg(a.token, raw("A"));
    check("§2b gelen kutusu kapalı → 409 PATRON_PUSH_KAPALI, satır yok", r.status === 409 && r.body.details?.code === "PATRON_PUSH_KAPALI" && (await row(raw("A"))) === null, String(r.status));
    const meOff = await call("/auth/me", a.token);
    check("§2c kapı kapalıyken /auth/me patronPush yok", meOff.status === 200 && meOff.body.data?.patronPush === undefined);
    await setGate(true, true);
    r = await reg(panel.token, raw("P"));
    check("§2d patron dışı oturum (electron) → 403 PATRON_ISTEMCI_DEGIL, satır yok", r.status === 403 && r.body.details?.code === "PATRON_ISTEMCI_DEGIL" && (await row(raw("P"))) === null, String(r.status));
    r = await reg(noPerm.token, raw("N"));
    check("§2e patron-app:login yok → 403", r.status === 403 && (await row(raw("N"))) === null, String(r.status));
    r = await reg(a.token, raw("A"), { userId: b.id });
    check("§2f başkası adına yazım (userId alanı) → 400, satır yok", r.status === 400 && (await row(raw("A"))) === null, String(r.status));

    console.log("\n=== §3 kayıt + idempotency + gizlilik ===");
    r = await reg(a.token, raw("A"));
    check("§3a kayıt 200 BEKLIYOR", r.status === 200 && r.body.data?.kayitli === true && r.body.data.durum === "BEKLIYOR", `${r.status} ${r.text.slice(0, 120)}`);
    const first = await row(raw("A"));
    r = await reg(a.token, raw("A"));
    const again = await prisma.patronPushToken.findMany({ where: { tokenDigest: digestPushToken(raw("A")) } });
    check("§3b aynı belirteç ikinci kez → 200, TEK satır, aynı kimlik (özetle idempotent)", r.status === 200 && again.length === 1 && again[0]!.id === first?.id);
    check("§3c DB'de ham yok: tokenSealed `ptk1:` sarılı, ham metni içermez, açılınca hamı verir",
      !!first?.tokenSealed && first.tokenSealed.startsWith(PUSH_TOKEN_SEAL_PREFIX) && !first.tokenSealed.includes("SENTINEL") && openPushToken(first.tokenSealed, first.tokenDigest) === raw("A"));
    const rowJson = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM patron_push_tokens t WHERE row_to_json(t)::text LIKE ${"%SENTINEL%"}`;
    check("§3d tabloda hiçbir satırda ham düz metin yok", rowJson[0]?.n === 0, String(rowJson[0]?.n));
    check("§3e satır çağıranın oturumuna bağlı", first?.userId === a.id && first.sessionId !== null);

    console.log("\n=== §4 sahiplik devri + başkasının belirteci ===");
    r = await reg(b.token, raw("A"));
    const moved = await prisma.patronPushToken.findMany({ where: { tokenDigest: digestPushToken(raw("A")) } });
    check("§4a aynı belirteç b'de → tek satır, sahibi b (devir)", r.status === 200 && moved.length === 1 && moved[0]!.userId === b.id && moved[0]!.id === first?.id);
    r = await del(a.token, raw("A"));
    const stillLive = await row(raw("A"));
    check("§4b eski sahip DELETE → birakildi:false, satır b'de canlı", r.status === 200 && r.body.data?.birakildi === false && stillLive?.userId === b.id && stillLive.cloudState === "BEKLIYOR" && stillLive.tokenSealed !== null);
    r = await del(b.token, raw("A"));
    const released = await row(raw("A"));
    check("§4c sahibi DELETE → birakildi:true, BIRAKILACAK, ham silinmiş", r.body.data?.birakildi === true && released?.cloudState === "BIRAKILACAK" && released.tokenSealed === null);
    r = await reg(b.token, raw("A"));
    const revived = await row(raw("A"));
    check("§4d aynı belirteç yeniden → satır dirilir (BEKLIYOR, sarılı, aynı kimlik)", r.status === 200 && revived !== null && revived.id === first?.id && revived.cloudState === "BEKLIYOR" && revived.tokenSealed !== null);

    console.log("\n=== §5 tavan ===");
    for (let i = 0; i < MAX_PUSH_TOKENS_PER_USER; i++) await reg(c.token, raw(`C${i}`));
    await prisma.patronPushToken.updateMany({ where: { tokenDigest: digestPushToken(raw("C0")) }, data: { lastSeenAt: new Date(Date.now() - 3_600_000) } });
    r = await reg(c.token, raw("C10"));
    const liveC = await prisma.patronPushToken.count({ where: { userId: c.id, cloudState: { in: ["BEKLIYOR", "KAYITLI"] } } });
    const oldest = await row(raw("C0"));
    check("§5a 11. kayıt 200, birakilanEski=1, canlı 10", r.status === 200 && r.body.data?.birakilanEski === 1 && liveC === MAX_PUSH_TOKENS_PER_USER, `canlı=${liveC}`);
    check("§5b bırakılan EN ESKİ (son görülme) cihaz, ham silinmiş", oldest?.cloudState === "BIRAKILACAK" && oldest.tokenSealed === null && (await row(raw("C10")))?.cloudState === "BEKLIYOR");

    console.log("\n=== §6 yaşam sonu ===");
    await reg(a.token, raw("A2"));
    await call("/auth/logout", a.token, "POST", {});
    const afterLogout = await row(raw("A2"));
    check("§6a çıkış → BIRAKILACAK + ham silinmiş", afterLogout?.cloudState === "BIRAKILACAK" && afterLogout.tokenSealed === null, String(afterLogout?.cloudState));
    await reg(pw.token, raw("PW"));
    r = await call("/auth/change-password", pw.token, "POST", { currentPassword: PASS, newPassword: "Yeni-Parola-Push-98765!" });
    const afterPw = await row(raw("PW"));
    check("§6b parola değişimi → BIRAKILACAK + ham silinmiş", r.status === 200 && afterPw?.cloudState === "BIRAKILACAK" && afterPw.tokenSealed === null, `${r.status} ${String(afterPw?.cloudState)}`);
    await reg(pas.token, raw("PS"));
    await PermissionManagementService.deactivateUser(pas.id, undefined);
    const afterPas = await row(raw("PS"));
    check("§6c pasife alma → BIRAKILACAK + ham silinmiş", afterPas?.cloudState === "BIRAKILACAK" && afterPas.tokenSealed === null, String(afterPas?.cloudState));

    console.log("\n=== §7 anahtar halkası yok ===");
    setShortCredentialKeyDirForTests(badRing);
    r = await reg(b.token, raw("K"));
    check("§7a halka okunamıyor → 503 PUSH_ANAHTAR_YOK, satır yazılmadı", r.status === 503 && r.body.details?.code === "PUSH_ANAHTAR_YOK" && (await row(raw("K"))) === null, String(r.status));
    setShortCredentialKeyDirForTests(goodRing);

    console.log("\n=== §8 kapı kapalıyken DELETE + tur ===");
    await setGate(false, true);
    await reg(c.token, raw("C1")); // kapalı: 409, durum değişmez
    r = await del(c.token, raw("C1"));
    const c1 = await row(raw("C1"));
    check("§8a push kapalıyken DELETE 200 birakildi:true, satır yerelde bırakıldı", r.status === 200 && r.body.data?.birakildi === true && c1?.cloudState === "BIRAKILACAK" && c1.tokenSealed === null, `${r.status} ${String(c1?.cloudState)}`);
    let sum = await runPatronPushRound({ transport: cloud.transport });
    check("§8b tur KAPALI, dışarı istek YOK", sum.durum === "KAPALI" && cloud.calls.length === 0, `${sum.durum} çağrı=${cloud.calls.length}`);
    await setGate(true, false);
    r = await del(c.token, raw("C2"));
    sum = await runPatronPushRound({ transport: cloud.transport });
    check("§8c gelen kutusu kapalıyken DELETE 200; tur KAPALI, dışarı istek YOK", r.status === 200 && r.body.data?.birakildi === true && sum.durum === "KAPALI" && cloud.calls.length === 0, `${sum.durum} çağrı=${cloud.calls.length}`);

    console.log("\n=== §9 bulut turu (sahte taşıyıcı) ===");
    await setGate(true, true);
    const meOn = await call("/auth/me", b.token);
    check("§9a kapı açık + lisans uygun → /auth/me patronPush = 1", meOn.body.data?.patronPush === 1, String(meOn.body.data?.patronPush));
    for (let i = 0; i < 8; i++) {
      sum = await runPatronPushRound({ transport: cloud.transport });
      if (sum.durum !== "TAMAM" || (sum.kaydedilen === 0 && sum.birakilan === 0)) break;
    }
    const regCalls = cloud.calls.filter((x) => x.yol === PUSH_BRIDGE_PATHS.REGISTER);
    const relCalls = cloud.calls.filter((x) => x.yol === PUSH_BRIDGE_PATHS.RELEASE);
    check("§9b `kaydet` ve `birak` gitti, her imza geçerli, amaç `bildir`, imzalı `yol` = uç",
      regCalls.length > 0 && relCalls.length > 0 && cloud.calls.every((x) => x.signedOk && x.amac === "bildir" && x.yolImza === x.yol), `kaydet=${regCalls.length} birak=${relCalls.length} ${JSON.stringify(cloud.calls.find((x) => !x.signedOk) ?? {})}`);
    check("§9c giden gövdede ham belirteç yok (yalnız özet)", cloud.calls.every((x) => !x.body.includes("SENTINEL")) && regCalls.some((x) => x.body.includes(digestPushToken(raw("A")))));
    const [ra, rc0, rc1] = [await row(raw("A")), await row(raw("C0")), await row(raw("C1"))];
    check("§9d bekleyen → KAYITLI; bırakılan → BIRAKILDI + releasedAt", ra?.cloudState === "KAYITLI" && rc0?.cloudState === "BIRAKILDI" && rc0.releasedAt !== null && rc1?.cloudState === "BIRAKILDI", `${String(ra?.cloudState)} ${String(rc0?.cloudState)} ${String(rc1?.cloudState)}`);
    const b2 = await makeUser("b2", [PATRON_LOGIN_PERMISSION]);
    cloud.mode = "503";
    const callsBefore = cloud.calls.length;
    r = await reg(b2.token, raw("D"));
    const now = new Date();
    sum = await runPatronPushRound({ transport: cloud.transport, now });
    const rd = await row(raw("D"));
    check("§9e bulut 503 → kullanıcı isteği 200; satır BEKLIYOR, attempts 1, nextAttemptAt ileride, hata kodu",
      r.status === 200 && cloud.calls.length > callsBefore && rd?.cloudState === "BEKLIYOR" && rd.attempts === 1 && !!rd.nextAttemptAt && rd.nextAttemptAt > now && (rd.lastErrorCode ?? "").includes("503"), `${String(rd?.cloudState)} a=${rd?.attempts} e=${rd?.lastErrorCode}`);
    cloud.mode = "OK";
    const callsMid = cloud.calls.length;
    await runPatronPushRound({ transport: cloud.transport, now: new Date(now.getTime() + 1000) });
    check("§9f geri çekilme süresi dolmadan yeniden denenmez", cloud.calls.length === callsMid && (await row(raw("D")))?.attempts === 1);
    await runPatronPushRound({ transport: cloud.transport, now: new Date((rd?.nextAttemptAt ?? now).getTime() + 1000) });
    const rd2 = await row(raw("D"));
    check("§9g süre dolunca yeniden dener → KAYITLI, sayaç sıfır", rd2?.cloudState === "KAYITLI" && rd2.attempts === 0 && rd2.lastErrorCode === null, String(rd2?.cloudState));
    kur = lisansKipKur({ zorlama: false, kiraEk: { devredildi: true } });
    cloud = fakeCloud(kur.f.kurulum.x, kur.f.kurulumId);
    r = await reg(b2.token, raw("E"));
    sum = await runPatronPushRound({ transport: cloud.transport });
    const meNo = await call("/auth/me", b2.token);
    check("§9h lisans uygun değil (devredildi): kayıt 200 BEKLIYOR kalır, tur UYGUN_DEGIL, dışarı istek YOK, patronPush yok",
      r.status === 200 && sum.durum === "UYGUN_DEGIL" && cloud.calls.length === 0 && (await row(raw("E")))?.cloudState === "BEKLIYOR" && meNo.body.data?.patronPush === undefined, `${sum.durum}:${"sebep" in sum ? String(sum.sebep) : ""} çağrı=${cloud.calls.length}`);

    console.log("\n=== §10 sır hijyeni ===");
    uyari("test-patron-push", "yakalama-sondasi");
    check("§10a günlük yakalama çalışıyor (sonda satırı tamponda)", captured.includes("yakalama-sondasi"));
    const digests = ["A", "C0", "D"].map((t) => digestPushToken(raw(t)));
    check("§10b yanıt gövdelerinde ham ya da özet yok", replies.length > 10 && replies.every((t) => !t.includes("SENTINEL") && digests.every((d) => !t.includes(d))));
    check("§10c günlükte (stdout/stderr) ham yok", !captured.includes("SENTINEL"));
    const logs = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM system_logs s WHERE s."createdAt" >= ${startedAt} AND row_to_json(s)::text LIKE ${"%SENTINEL%"}`;
    check("§10d system_logs'ta (audit) ham yok", logs[0]?.n === 0, String(logs[0]?.n));
  } finally {
    stopCapture();
    temizleLisansKipDizini();
    setCloudUrlForTests(null);
    setShortCredentialKeyDirForTests(null);
    fs.rmSync(ringRoot, { recursive: true, force: true });
    for (const key of settingKeys) {
      const prev = before.find((f) => f.key === key);
      if (prev) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    invalidateFeatureFlagsCache();
    await prisma.patronPushToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
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
