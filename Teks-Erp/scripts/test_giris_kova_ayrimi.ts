// =============================================================================
// BEKÇİ — giriş/yazma kova ayrımı (VDS denetimi Y2 + Y3 + O4 + D4, 2026-11-01)
// =============================================================================
//   §1 Y3 hız sınırı: aynı IP'den 50 kanıtlı cihaz 429 almaz · cihazsız 11. giriş 429 · sahte cihaz IP kovasında ·
//      yazma kullanıcı başına · fabrika IP'si × çarpan (IPv4-eşlemli dahil) · LAN'da (internete kapalı) bugünkü IP kovası ·
//      belirteç kimliği yalnız imzalıysa · gerçek cihaz kanıtı middleware'i → limiter (geçerli kanıt cihaz kovası, bozuk IP)
//   §2 Y2 yumuşak kova: eşik altı serbest · eşik üstü yabancı kaynak bekler · tanınan kaynak beklemez · sert kilit yok ·
//      uyarı eşiği tek kez · eşzamanlı yabancılardan 1'i geçer (yuva) · LAN'da etkisiz · bildirim outbox satırı
//   §3 parola politikası: yaygın / firma türevi / rakam dizisi red, güçlü kabul · parola değişimi 400 PASSWORD_POLICY Türkçe
//   §4 O4 kilit: yöntem ayrı geniş kova · kanıtlı cihaz PIN geniş kovadan muaf · LAN tek anahtar · fabrika çarpanı ·
//      başarıda dar kovanın ceza merdiveni sıfır, genişin/PIN'in değil · yönetici listesi + audit'li kaldırma + 409 ·
//      ayar şifresi kovası listelenmez/kaldırılamaz (403)
//   §5 D4: LOGIN_FAILED dakikalık özet (internete açıkta) · LAN'da her hata yazılır · kimliksiz 401/404 izi örneklenir
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { createRateLimiter } from "../src/middlewares/web-hardening";
import { resolveRateLimitSubject, identifyTokenUser, type SubjectResolverDeps } from "../src/middlewares/rate-limit-subject";
import { readFactoryEgressConfig } from "../src/middlewares/factory-egress";
import {
  ACCOUNT_ALERT_THRESHOLD, ACCOUNT_SOFT_THRESHOLD, accountThrottleWaitSec, claimAccountAttempt, noteAccountFailure,
  noteAccountSuccess, releaseAccountGate, resetAccountThrottleForTests,
} from "../src/middlewares/account-soft-throttle";
import {
  accountThrottleError, recordAccountFailure, shouldWriteLoginFailure, flushLoginFailureSummaries,
} from "../src/services/login-attempt-monitor.service";
import { passwordPolicyViolation } from "../src/constants/password-policy";
import { AuthService } from "../src/services/auth.service";
import {
  flushLoginLockoutPersistence, listBlockedLoginBuckets, reserveLoginAttempt, resetLoginLockout, resolveLoginLockoutKeys,
} from "../src/middlewares/login-lockout";
import { LoginLockoutAdminService } from "../src/services/login-lockout-admin.service";
import { resolveDevice } from "../src/middlewares/device.middleware";
import { buildDeviceProof, deriveDeviceSecret, newProofSalt, DEVICE_PROOF_HEADER } from "../src/lib/device-proof";
import { getShortCredentialKeyRing, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { recordTrace, getRequestTraceHealth, setAnonTraceBucketForTest, type TraceSnapshot } from "../src/services/request-trace.service";
import { SUSPICIOUS_LOGIN_KIND } from "../src/services/notification-sources/kimlik";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

const TAG = `TEST-GKA-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
const HOSTED_ENV = "TEKSERP_KURULUM_SINIFI";

type FakeReq = Partial<Request> & { headers: Record<string, string>; ip: string };
function fakeReq(o: { ip: string; method?: string; url?: string; device?: Request["device"]; headers?: Record<string, string> }): Request {
  const r: FakeReq = {
    ip: o.ip,
    method: o.method ?? "POST",
    originalUrl: o.url ?? "/api/auth/login",
    headers: o.headers ?? {},
    device: o.device,
  };
  return r as Request;
}
const fakeRes = { setHeader: () => undefined } as unknown as Response;

/** Sınırlayıcıdan geçti mi (next hatasız çağrıldı). */
function runLimiter(lim: ReturnType<typeof createRateLimiter>, req: Request): boolean {
  let ok = false;
  lim(req, fakeRes, (err?: unknown) => { ok = !err; });
  return ok;
}

function deps(over: Partial<SubjectResolverDeps> = {}): SubjectResolverDeps {
  return {
    clientIp: (req) => req.ip ?? null,
    internetFacing: () => true,
    identifyUser: (req) => (req.headers["x-test-user"] as string | undefined) ?? null,
    factory: readFactoryEgressConfig({}, () => {}),
    ...over,
  };
}

function limiter(d: SubjectResolverDeps, login = 10, write = 120): ReturnType<typeof createRateLimiter> {
  return createRateLimiter({ windowMs: 60_000, limits: { login, write }, resolveSubject: (req, b) => resolveRateLimitSubject(req, b, d) });
}

const proven = (i: number): NonNullable<Request["device"]> => ({ id: `dev-${i}`, deviceId: `local-${i}`, name: "t", machineId: null, kind: "TABLET", proofVerified: true });

function section1(): void {
  console.log("\n=== §1 Y3 hız sınırı kova sahibi ===");
  const NAT = "198.51.100.7";
  {
    const lim = limiter(deps());
    let ok = 0;
    for (let i = 0; i < 50; i++) if (runLimiter(lim, fakeReq({ ip: NAT, device: proven(i) }))) ok++;
    check("§1a ⭐ aynı IP'den 50 kanıtlı cihazın girişi 429 almaz", ok === 50, `${ok}/50`);
    let anon = 0;
    for (let i = 0; i < 11; i++) if (runLimiter(lim, fakeReq({ ip: NAT }))) anon++;
    check("§1b ⭐ aynı IP'den cihazsız 11. giriş sınırlanır (10 geçer)", anon === 10, `${anon}/11 geçti`);
    const forged = { ...proven(99), proofVerified: false };
    check("§1c sahte (kanıtsız) cihaz IP kovasına düşer → 429", !runLimiter(lim, fakeReq({ ip: NAT, device: forged })));
  }
  {
    const lim = limiter(deps(), 10, 5);
    let users = 0;
    for (let i = 0; i < 20; i++) if (runLimiter(lim, fakeReq({ ip: NAT, url: "/api/rolls", headers: { "x-test-user": `u${i}` } }))) users++;
    check("§1d yazma kullanıcı başına: aynı IP'den 20 kullanıcı (tavan 5) 429 almaz", users === 20, `${users}/20`);
    let same = 0;
    for (let i = 0; i < 6; i++) if (runLimiter(lim, fakeReq({ ip: NAT, url: "/api/rolls", headers: { "x-test-user": "tek" } }))) same++;
    check("§1e aynı kullanıcının 6. yazması 429", same === 5, `${same}/6`);
  }
  {
    const factory = readFactoryEgressConfig({ RATE_LIMIT_FACTORY_IPS: "203.0.113.10, 2001:db8:1:2::5, bozuk!adres", RATE_LIMIT_FACTORY_MULTIPLIER: "3" }, () => {});
    const lim = limiter(deps({ factory, internetFacing: () => true }));
    let f = 0;
    for (let i = 0; i < 31; i++) if (runLimiter(lim, fakeReq({ ip: "::ffff:203.0.113.10" }))) f++;
    check("§1f fabrika IP'si (IPv4-eşlemli soket) eşik × 3 = 30, 31. 429", f === 30, `${f}/31`);
    let v6 = 0;
    for (let i = 0; i < 30; i++) if (runLimiter(lim, fakeReq({ ip: `2001:db8:1:2::${(i + 1).toString(16)}` }))) v6++;
    check("§1g fabrika IPv6 /64 beyanı aynı bloktaki her adresi kapsar (30 geçer)", v6 === 30, `${v6}/30`);
    check("§1h bozuk adres atlanır, iki geçerli adres okunur", factory.ips.size === 2 && factory.multiplier === 3, `${factory.ips.size}`);
    const empty = readFactoryEgressConfig({}, () => {});
    check("§1i env boş → beyan yok, çarpan uygulanmaz (bugünkü davranış)", empty.ips.size === 0);
  }
  {
    const lim = limiter(deps({ internetFacing: () => false }));
    let lan = 0;
    for (let i = 0; i < 11; i++) if (runLimiter(lim, fakeReq({ ip: "192.168.1.20", device: proven(i) }))) lan++;
    check("§1j ⭐ LAN (internete kapalı): kanıtlı cihaz da IP kovasında — bugünkü davranış (10 geçer)", lan === 10, `${lan}/11`);
  }
  {
    const secret = process.env.JWT_SECRET ?? "";
    const good = jwt.sign({ userId: "u-imzali", tokenVersion: 0 }, secret, { algorithm: "HS256", expiresIn: 60 });
    const bad = jwt.sign({ userId: "u-sahte", tokenVersion: 0 }, "baska-sir", { algorithm: "HS256", expiresIn: 60 });
    check("§1k imzalı belirteç kullanıcı kimliği verir", identifyTokenUser(fakeReq({ ip: "x", headers: { authorization: `Bearer ${good}` } })) === "u-imzali");
    check("§1l ⭐ sahte imzalı belirteç kova kimliği VERMEZ (IP kovasında kalır)", identifyTokenUser(fakeReq({ ip: "x", headers: { authorization: `Bearer ${bad}` } })) === null);
  }
}

/** §1m-n: gerçek resolveDevice → limiter zinciri; `proofVerified` işaretini middleware koymazsa Y3 ölü kalır. */
async function section1Integration(): Promise<void> {
  console.log("\n=== §1 entegrasyon: cihaz kanıtı middleware'i → hız sınırı ===");
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "giris-kova-halka-")));
  const st = getShortCredentialKeyRing();
  if (!st.ok) {
    check("§1m anahtar halkası okunur (ön koşul)", false, st.detail);
    return;
  }
  const deviceId = `${TAG}-dev`;
  const salt = newProofSalt(st.ring.active);
  const secret = deriveDeviceSecret(st.ring, deviceId, salt)!;
  const dev = await prisma.device.create({
    data: { deviceId, name: "Kova bekçisi tableti", status: "APPROVED", isActive: true, proofSalt: salt },
    select: { id: true },
  });
  try {
    const NAT = "198.51.100.77";
    const lim = limiter(deps());
    const res = { status: () => res, json: () => res, setHeader: () => undefined } as unknown as Response;
    const through = async (headers: Record<string, string>): Promise<boolean> => {
      const r = { ...fakeReq({ ip: NAT, headers }), path: "/api/auth/login" } as Request;
      let err: unknown;
      await resolveDevice(r, res, (e?: unknown) => { err = e; });
      return !err && runLimiter(lim, r);
    };
    for (let i = 0; i < 10; i++) await through({});
    const proof = buildDeviceProof(secret, Date.now(), "POST", "/api/auth/login");
    const okProof = await through({ "x-device-id": deviceId, [DEVICE_PROOF_HEADER]: proof });
    check("§1m ⭐ gerçek middleware: geçerli kanıtlı cihaz, IP kovası dolu NAT'ta 11. girişte 429 almaz", okProof);
    const badProof = buildDeviceProof("00".repeat(32), Date.now(), "POST", "/api/auth/login");
    const bad = await through({ "x-device-id": deviceId, [DEVICE_PROOF_HEADER]: badProof });
    const none = await through({ "x-device-id": deviceId });
    check("§1n ⭐ bozuk HMAC'li ya da kanıtsız aynı cihaz IP kovasına düşer → 429", !bad && !none, `bad=${bad} none=${none}`);
  } finally {
    await prisma.device.delete({ where: { id: dev.id } }).catch(() => undefined);
  }
}

async function section2(): Promise<void> {
  console.log("\n=== §2 Y2 hesap başına yumuşak kova ===");
  resetAccountThrottleForTests();
  const t0 = 1_800_000_000_000;
  const acc = `${TAG}-acc`;
  for (let i = 0; i < ACCOUNT_SOFT_THRESHOLD - 1; i++) noteAccountFailure(acc, `2001:db8:${i}::/64`, t0 + i);
  check("§2a ⭐ eşik altı (9 hata, farklı /64'ler) → doğru parola beklemeden denenir", accountThrottleWaitSec(acc, "2001:db8:ff::/64", t0 + 20) === 0);
  noteAccountFailure(acc, "2001:db8:99::/64", t0 + 30);
  noteAccountFailure(acc, "2001:db8:98::/64", t0 + 40);
  const w = accountThrottleWaitSec(acc, "2001:db8:aa::/64", t0 + 41);
  check("§2b ⭐ eşik üstü yabancı /64 bekler (kademeli gecikme)", w > 0, `wait=${w}`);
  check("§2c ⭐ sert kilit yok: gecikme dolunca yabancı kaynak yine dener", accountThrottleWaitSec(acc, "2001:db8:aa::/64", t0 + 40 + 61_000) === 0);
  noteAccountSuccess(acc, "198.51.100.7", t0 + 50);
  check("§2d ⭐ tanınan kaynak (önceki başarılı giriş) eşik üstünde de beklemez", accountThrottleWaitSec(acc, "198.51.100.7", t0 + 51) === 0);
  let alerts = 0;
  for (let i = 0; i < ACCOUNT_ALERT_THRESHOLD + 5; i++) if (noteAccountFailure(`${acc}-al`, `s${i}`, t0 + i).alert) alerts++;
  check("§2e uyarı 1 saatte eşik aşılınca TEK kez", alerts === 1, `alerts=${alerts}`);
  {
    const race = `${TAG}-race`;
    for (let i = 0; i < ACCOUNT_SOFT_THRESHOLD + 1; i++) noteAccountFailure(race, `r${i}`, t0 + i);
    const at = t0 + 10 * 60_000; // bekleme penceresi çoktan doldu
    let passed = 0;
    let gate = 0;
    for (let i = 0; i < 10; i++) {
      const c = claimAccountAttempt(race, `2001:db8:${(0x100 + i).toString(16)}::/64`, at);
      if (c.wait === 0) { passed++; gate = c.gateAt; }
    }
    check("§2i ⭐ eşik üstü: aynı anda 10 yabancı denemeden yalnız 1'i bcrypt'e iner (yuva rezervasyonu)", passed === 1, `geçen=${passed}`);
    releaseAccountGate(race, gate);
    check("§2j 401 dışı sonuçta yuva bırakılır → sıradaki deneme geçer", claimAccountAttempt(race, "2001:db8:200::/64", at + 1).wait === 0);
  }

  const prev = process.env[HOSTED_ENV];
  try {
    delete process.env[HOSTED_ENV];
    resetAccountThrottleForTests();
    const lanAcc = `${TAG}-lan`;
    const req = fakeReq({ ip: "192.168.1.5" });
    for (let i = 0; i < 30; i++) recordAccountFailure(req, lanAcc);
    check("§2f ⭐ LAN: hesap kovası etkisiz (30 hatadan sonra da bekleme yok)", accountThrottleError(req, lanAcc) === null);

    process.env[HOSTED_ENV] = "BARINDIRILAN";
    const user = await prisma.user.create({
      data: { username: `${TAG}-sup`.toLowerCase(), fullName: `${TAG} Şüpheli`, passwordHash: await AuthService.hashPassword("Ga-7Lmq-29xk"), isActive: true },
      select: { id: true, username: true },
    });
    try {
      for (let i = 0; i < ACCOUNT_ALERT_THRESHOLD; i++) {
        recordAccountFailure(fakeReq({ ip: `2001:db8:${(i + 1).toString(16)}::1` }), user.username);
      }
      const thr = accountThrottleError(fakeReq({ ip: "2001:db8:ffff::1" }), user.username);
      check("§2g barındırılan: eşik üstü yabancı kaynak 429 LOGIN_THROTTLED + Retry-After",
        thr !== null && thr.retryAfterSec > 0 && (thr.error.details as { code?: string } | undefined)?.code === "LOGIN_THROTTLED");
      let n = 0;
      for (let k = 0; k < 30 && n === 0; k++) {
        await new Promise((r) => setTimeout(r, 100));
        n = await prisma.notificationOutbox.count({ where: { kind: SUSPICIOUS_LOGIN_KIND, subjectId: user.id } });
      }
      check("§2h ⭐ uyarı eşiği → sahibine/yöneticilere bildirim outbox satırı", n === 1, `outbox=${n}`);
    } finally {
      await prisma.notificationOutbox.deleteMany({ where: { kind: SUSPICIOUS_LOGIN_KIND, subjectId: user.id } }).catch(() => undefined);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } }).catch(() => undefined);
    }
  } finally {
    if (prev === undefined) delete process.env[HOSTED_ENV];
    else process.env[HOSTED_ENV] = prev;
    resetAccountThrottleForTests();
  }
}

async function section3(): Promise<void> {
  console.log("\n=== §3 parola politikası ===");
  const firm = ["Seyitoğlu Tekstil San. Tic. Ltd. Şti."];
  const v1 = passwordPolicyViolation("Parola2024!", firm);
  check("§3a ⭐ yaygın kök (Parola2024!) Türkçe gerekçeyle reddedilir", v1 !== null && /yaygın/.test(v1), String(v1));
  check("§3b ⭐ firma adı türevi (Seyitoglu1, SEYİTOĞLU.tekstil24) red",
    passwordPolicyViolation("Seyitoglu1", firm) !== null && passwordPolicyViolation("SEYİTOĞLU.tekstil24", firm) !== null);
  check("§3c rakam dizisi / tekrar (1234567890, 1111122222) red",
    passwordPolicyViolation("1234567890") !== null && passwordPolicyViolation("1111122222") !== null);
  check("§3d güçlü parola ve firma adını içeren uzun ifade kabul",
    passwordPolicyViolation("mavi-Deniz-48k", firm) === null && passwordPolicyViolation("seyitoglu-mavi-kapı-77", firm) === null);
  check("§3e kısa parola eski gerekçeyle (uzunluk) — sıra korunur", /en az/.test(passwordPolicyViolation("abc") ?? ""));
  check("§3h harfli klavye desenleri (1qaz2wsx3edc, zaq12wsxcde3) red",
    passwordPolicyViolation("1qaz2wsx3edc") !== null && passwordPolicyViolation("zaq12wsxcde3") !== null);

  const u = await prisma.user.create({
    data: { username: `${TAG}-pw`.toLowerCase(), fullName: `${TAG} Parola`, passwordHash: await AuthService.hashPassword("Qz-81-mavi-kap"), isActive: true },
    select: { id: true },
  });
  try {
    let code: unknown = null;
    let status = 0;
    let msg = "";
    try {
      await AuthService.changeOwnPassword(u.id, "Qz-81-mavi-kap", "Qwerty12345");
    } catch (e) {
      if (e instanceof AppError) {
        status = e.statusCode;
        code = (e.details as { code?: string } | undefined)?.code;
        msg = e.message;
      }
    }
    check("§3f ⭐ yaygın parolaya değişim 400 PASSWORD_POLICY Türkçe", status === 400 && code === "PASSWORD_POLICY" && /yaygın/.test(msg), `${status} ${String(code)} ${msg}`);
    const login = await AuthService.login(`${TAG}-pw`.toLowerCase(), "Qz-81-mavi-kap").then(() => true, () => false);
    check("§3g mevcut parola girişte politikadan etkilenmez", login);
  } finally {
    await prisma.session.deleteMany({ where: { userId: u.id } }).catch(() => undefined);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } }).catch(() => undefined);
  }
}

async function section4(): Promise<void> {
  console.log("\n=== §4 O4 yönteme göre kilit kovaları + yönetici kaldırma ===");
  const proxy = { TRUST_PROXY: "1" };
  const ip = `10.77.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  const pw = resolveLoginLockoutKeys(fakeReq({ ip }), "u:ali", proxy);
  const pin = resolveLoginLockoutKeys(fakeReq({ ip }), "pin:tab1", proxy);
  const card = resolveLoginLockoutKeys(fakeReq({ ip }), "card:tab1", proxy);
  check("§4a ⭐ geniş kova yönteme göre ayrı (parola `ip`, PIN `pin|ip`, kart `card|ip`)",
    pw[1]?.key === ip && pin[1]?.key === `pin|${ip}` && card[1]?.key === `card|${ip}`, JSON.stringify([pw[1], pin[1], card[1]]));
  const pinDev = resolveLoginLockoutKeys(fakeReq({ ip, device: proven(1) }), "pin:tab1", proxy);
  check("§4b ⭐ kanıtlı cihazdan PIN geniş IP kovasından muaf (yalnız dar kova)", pinDev.length === 1 && pinDev[0]!.key.endsWith("|pin:tab1"));
  const pwDev = resolveLoginLockoutKeys(fakeReq({ ip, device: proven(1) }), "u:ali", proxy);
  check("§4c parola yolu kanıtlı cihazda da geniş kovada kalır (spraying)", pwDev.length === 2);
  const lan = resolveLoginLockoutKeys(fakeReq({ ip, device: proven(1) }), "pin:tab1", {});
  check("§4d ⭐ LAN (vekilsiz): tek anahtar = IP — bugünkü davranış", lan.length === 1 && lan[0]!.key === ip && lan[0]!.budgetMultiplier === 1);
  const fac = resolveLoginLockoutKeys(fakeReq({ ip }), "u:ali", { ...proxy, RATE_LIMIT_FACTORY_IPS: ip, RATE_LIMIT_FACTORY_MULTIPLIER: "4" });
  check("§4e fabrika IP'si geniş kova bütçesi × çarpan (5×4)", fac[1]?.budgetMultiplier === 20, String(fac[1]?.budgetMultiplier));

  // Ceza merdiveni: dar kovayı kilitle, başarıda dar sıfırlanır.
  const user = `${TAG}-lock`.toLowerCase();
  const keys = resolveLoginLockoutKeys(fakeReq({ ip }), `u:${user}`, proxy);
  let locked = false;
  for (let i = 0; i < 20 && !locked; i++) locked = (await reserveLoginAttempt(keys)).justLocked;
  check("§4f dar kova kilitlendi (ön koşul)", locked);
  const list1 = await listBlockedLoginBuckets();
  const mine = list1.find((b) => b.label === `${ip}|u:${user}`);
  check("§4g ⭐ yönetici listesi kilitli kovayı okunur etiketle gösterir (sır yok)", !!mine && mine.penaltyRounds >= 1, JSON.stringify(list1.slice(0, 3)));

  const admin = await prisma.user.create({
    data: { username: `${TAG}-yon`.toLowerCase(), fullName: `${TAG} Yönetici`, passwordHash: await AuthService.hashPassword("Yn-41-kapi-mavi"), isActive: true },
    select: { id: true },
  });
  if (mine && admin) {
    const view = await LoginLockoutAdminService.release(admin.id, mine.id, "127.0.0.1");
    check("§4h yönetici kaldırma yöntem etiketiyle döner", view.method === "PASSWORD", view.method);
    const after = await reserveLoginAttempt(keys);
    check("§4i ⭐ kaldırılan kova hemen giriş denemesine açık", !after.blocked);
    await new Promise((r) => setTimeout(r, 200));
    const audit = await prisma.systemLog.findFirst({ where: { action: "LOGIN_LOCK_RELEASED", recordId: mine.id.slice(0, 16) }, select: { userId: true, newData: true } });
    check("§4j ⭐ kaldırma audit'li (LOGIN_LOCK_RELEASED, yapan yönetici)", audit?.userId === admin.id, JSON.stringify(audit));
    let st = 0;
    let code: unknown;
    try {
      await LoginLockoutAdminService.release(admin.id, mine.id, null);
    } catch (e) {
      if (e instanceof AppError) {
        st = e.statusCode;
        code = (e.details as { code?: string } | undefined)?.code;
      }
    }
    check("§4k kilitli olmayan kovayı kaldırma 409 LOCKOUT_NOT_ACTIVE", st === 409 && code === "LOCKOUT_NOT_ACTIVE", `${st} ${String(code)}`);
    // Ayar şifresi kovası (sp:) yöneticiye kapalı: admin kendini kilitleyen ikinci kapıyı açamasın.
    const spKeys = resolveLoginLockoutKeys(fakeReq({ ip }), `sp:${admin.id}`, proxy).map((k) => ({ ...k, key: `sp:${k.key}` }));
    let spLocked = false;
    for (let i = 0; i < 20 && !spLocked; i++) spLocked = (await reserveLoginAttempt(spKeys)).justLocked;
    const listed = (await LoginLockoutAdminService.list()).some((b) => b.label?.startsWith("sp:"));
    let spStatus = 0;
    let spCode: unknown;
    const spId = createHash("sha256").update(spKeys[0]!.key).digest("hex");
    try {
      await LoginLockoutAdminService.release(admin.id, spId, null);
    } catch (e) {
      if (e instanceof AppError) {
        spStatus = e.statusCode;
        spCode = (e.details as { code?: string } | undefined)?.code;
      }
    }
    const stillLocked = (await reserveLoginAttempt(spKeys)).blocked;
    check("§4n ⭐ ayar şifresi kovası listede yok, kaldırma 403 LOCKOUT_NOT_RELEASABLE ve kova kilitli kalır",
      spLocked && !listed && spStatus === 403 && spCode === "LOCKOUT_NOT_RELEASABLE" && stillLocked,
      `kilit=${spLocked} listede=${listed} ${spStatus} ${String(spCode)} kilitli=${stillLocked}`);
    resetLoginLockout(spKeys);
    await prisma.systemLog.deleteMany({ where: { action: "LOGIN_LOCK_RELEASED", recordId: mine.id.slice(0, 16) } }).catch(() => undefined);
  }
  await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } }).catch(() => undefined);
  if (!mine) {
    check("§4h-k yönetici/kova bulunamadı", false, `admin=${!!admin} mine=${!!mine}`);
  }

  // Başarı: dar kovanın ceza merdiveni sıfır, genişinki değil.
  const u2 = `${TAG}-pen`.toLowerCase();
  const k2 = resolveLoginLockoutKeys(fakeReq({ ip }), `u:${u2}`, proxy);
  let l2 = false;
  for (let i = 0; i < 20 && !l2; i++) l2 = (await reserveLoginAttempt(k2)).justLocked;
  const before = (await listBlockedLoginBuckets()).find((b) => b.label === `${ip}|u:${u2}`);
  resetLoginLockout(k2);
  await flushLoginLockoutPersistence();
  const row = before ? await prisma.loginLockoutBucket.findUnique({ where: { keyHash: before.id }, select: { penaltyRounds: true } }) : null;
  check("§4l ⭐ başarılı girişte dar kovanın ceza merdiveni sıfırlanır", !!before && before.penaltyRounds >= 1 && row?.penaltyRounds === 0, `önce=${before?.penaltyRounds} sonra=${row?.penaltyRounds}`);
  const wide = await reserveLoginAttempt([{ key: ip, budgetMultiplier: 1000 }]);
  check("§4m geniş kova paylaşımlı — başarı onun merdivenini sıfırlamaz (resetPenaltyOnSuccess yok)", k2[1]?.resetPenaltyOnSuccess !== true && !wide.blocked);
  const pinNarrow = resolveLoginLockoutKeys(fakeReq({ ip }), "pin:tab1", proxy)[0];
  check("§4o PIN dar kovası cihazdır — başarı ceza merdivenini sıfırlamaz", pinNarrow?.resetPenaltyOnSuccess === false);
}

function trace(over: Partial<TraceSnapshot>): TraceSnapshot {
  return {
    id: crypto.randomUUID(), userId: null, deviceRefId: null, panelInstanceId: null, deviceLocalId: null, clientType: null,
    appVersion: null, ip: "203.0.113.200", method: "POST", routeKey: "POST /api/rolls", status: 401, durationMs: 1,
    errorCode: null, audit: { count: 0 }, createdAt: new Date(), ...over,
  } as TraceSnapshot;
}

async function section5(): Promise<void> {
  console.log("\n=== §5 D4 iz/denetim gürültüsü ===");
  const prev = process.env[HOSTED_ENV];
  try {
    delete process.env[HOSTED_ENV];
    const lanUser = `${TAG}-d4lan`;
    check("§5a ⭐ LAN: her hatalı giriş ayrı LOGIN_FAILED (bugünkü davranış)",
      shouldWriteLoginFailure(lanUser, "1.1.1.1", "x") && shouldWriteLoginFailure(lanUser, "1.1.1.1", "x"));
    process.env[HOSTED_ENV] = "BARINDIRILAN";
    const u = `${TAG}-d4`;
    const t = 1_900_000_000_000;
    const first = shouldWriteLoginFailure(u, "2.2.2.2", "x", t);
    let later = 0;
    for (let i = 1; i <= 5; i++) if (shouldWriteLoginFailure(u, "2.2.2.2", "x", t + i * 1000)) later++;
    const other = shouldWriteLoginFailure(u, "3.3.3.3", "x", t + 2000);
    check("§5b ⭐ internete açık: aynı ad+IP dakikada ilk hata yazılır, kalan 5'i özetlenir; başka IP ayrı", first && later === 0 && other, `later=${later}`);
    flushLoginFailureSummaries(Number.POSITIVE_INFINITY);
    let sum = null as { payload: unknown } | null;
    for (let k = 0; k < 20 && !sum; k++) {
      await new Promise((r) => setTimeout(r, 100));
      const row = await prisma.systemLog.findFirst({ where: { action: "LOGIN_FAILED", recordId: u }, select: { newData: true } });
      sum = row ? { payload: row.newData } : null;
    }
    check("§5c ⭐ pencere kapanınca tek özet satırı (suppressedCount=5)", JSON.stringify(sum?.payload ?? null).includes('"suppressedCount":5'), JSON.stringify(sum));
    await prisma.systemLog.deleteMany({ where: { action: "LOGIN_FAILED", recordId: { startsWith: TAG } } }).catch(() => undefined);
  } finally {
    if (prev === undefined) delete process.env[HOSTED_ENV];
    else process.env[HOSTED_ENV] = prev;
  }
  setAnonTraceBucketForTest(0, 2);
  const h0 = getRequestTraceHealth().anonimOrneklenmeyen;
  for (let i = 0; i < 5; i++) recordTrace(trace({ status: i % 2 ? 404 : 401 }));
  recordTrace(trace({ status: 401, userId: crypto.randomUUID() }));
  recordTrace(trace({ status: 403 }));
  const h1 = getRequestTraceHealth().anonimOrneklenmeyen;
  check("§5d ⭐ kimliksiz 401/404 izi örneklenir (5'ten 2'si; oturumlu 401 ve 403 örneklenmez)", h1 - h0 === 3, `düşen=${h1 - h0}`);
  setAnonTraceBucketForTest(1, 60);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exitCode = 1;
    return;
  }
  const inboxKey = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const inboxBefore = await prisma.systemSetting.findUnique({ where: { key: inboxKey }, select: { value: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key: inboxKey }, create: { key: inboxKey, value: true as never }, update: { value: true as never } });
    section1();
    await section1Integration();
    await section2();
    await section3();
    await section4();
    await section5();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? e.stack ?? e.message : String(e));
  } finally {
    if (!inboxBefore) await prisma.systemSetting.deleteMany({ where: { key: inboxKey } }).catch(() => undefined);
    else await prisma.systemSetting.update({ where: { key: inboxKey }, data: { value: inboxBefore.value as never } }).catch(() => undefined);
    await flushLoginLockoutPersistence().catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  }
}

void main();
