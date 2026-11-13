// =============================================================================
// Bekçi: patron telefon uygulaması girişi — `clientType:"patron"` (V1, 2026-11-13)
// =============================================================================
// Çalıştır: npx tsx scripts/test_patron_giris.ts   (yalnız fikstür DB; süreç içi sunucu 127.0.0.1:0)
// Ölçer:
//   §1 tür: patron girişi Session.deviceType=PATRON; aynı kullanıcının ELECTRON/MOBILE/WEB oturumları `kick`te
//      düşmez; ikinci patron girişi yalnız önceki PATRON'u düşürür.
//   §2 ömür: LAN + otomatik çıkış açık (480 dk) → PATRON ≈ 30 gün, mobile ≈ 480 dk; barındırılan → PATRON ≈ 30 gün,
//      electron ≤ 24 sa; mutlak tavan 7 gün → PATRON ≈ 7 gün.
//   §3 ikinci faktör isteğe bağlı: TOTP'siz kullanıcı kodsuz 200 (LAN ve barındırılan REQUIRED); TOTP'li kodsuz
//      409 TOTP_REQUIRED, yanlış kod 401 TOTP_INVALID, doğru kod 200; TOTP'siz sistem hesabı 403 enrollment.
//   §4 izin: `patron-app:login` yoksa 403 PATRON_ACCESS_DENIED (oturum doğmaz); yalnız bu izin panel açmaz
//      (electron 403 CHANNEL_DENIED); PIN yolunda patron türü 400.
//   §5 kilit: yanlış parola ×eşik patron türünde de 429 LOGIN_LOCKED (doğru parola da bekler).
//   §6 sürüm/yetenek: GET /api/client-policy/patron 200 minVersion 0.0.0; /api/auth/me backendVersion +
//      patronApiVersion + permissions; GET /api/feature-flags modül bayrakları.
//   §7 statik: yenileme belirteci/ucu yok; katalog + rol muafı + ekransız beyan; migration yalnız ADD VALUE.
// Negatif sondalar: dosya sonu. İzolasyon: TEST- kullanıcıları + ayar anlık görüntüsü; finally geri yükler.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/services/auth.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { PERMISSION_CATALOG, PATRON_LOGIN_PERMISSION } from "../src/constants/permission-catalog";
import { ROLE_COVERAGE_EXEMPT, ROLE_TEMPLATE_CATALOG } from "../src/constants/role-template-catalog";
import { SCREENLESS_PERMISSIONS } from "../src/constants/screen-catalog";
import { APP_VERSION } from "../src/lib/app-version";
import { PATRON_API_VERSION } from "../src/constants/patron-app";
import { resetAccountThrottleForTests } from "../src/middlewares/account-soft-throttle";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Body = { data?: Record<string, unknown>; details?: Record<string, unknown> };
type Reply = { status: number; body: Body };
const PASSWORD = "Deneme-patron-12345";
const IP_HEADER = "x-test-client-ip";
const codeOf = (r: Reply) => `${r.status}:${String(r.body.details?.code ?? "")}`;
const DAY = 24 * 60 * 60 * 1000;
const near = (a: number, b: number, tol = 5 * 60 * 1000) => Math.abs(a - b) <= tol;
const ipGen = (): string => `198.51.${randomInt(0, 255)}.${randomInt(1, 254)}`;

const ids: string[] = [];
const names: string[] = [];
async function makeUser(tag: string, codes: string[], system = false) {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (perms.length !== codes.length) throw new Error(`fikstür izinleri eksik: ${codes.join(",")}`);
  const username = `TEST-ptg-${tag}-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      fullName: `TEST patron giriş ${tag}`,
      ...(system ? { isSystemAccount: true } : {}),
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  ids.push(u.id);
  names.push(username);
  return { id: u.id, username };
}
async function enrollTotp(userId: string, actor: string): Promise<string> {
  const w = await TotpAccountService.openWindow({ userId, openedById: actor });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  return w.secret;
}
async function freshCode(userId: string, secret: string): Promise<string> {
  await prisma.user.update({ where: { id: userId }, data: { totpLastStep: null } });
  return totpCodeForStep(secret, totpStep());
}
const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); process.exitCode = 1; return; }
  await reconcilePermissionCatalog();
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "ptg-halka-")));
  const originalEnv = {
    cls: process.env[INSTALL_CLASS_ENV], web: process.env.WEB_DIST_DIR, ipH: process.env.CLIENT_IP_HEADER,
    rl: process.env.RATE_LIMIT_ENABLED, scope: process.env.LOGIN_LOCKOUT_SCOPE,
  };
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.WEB_DIST_DIR; // çerez kipi kapalı: "web" beyanı Bearer yolundan geçer
  process.env.CLIENT_IP_HEADER = IP_HEADER; // kalıcı kilit kovası 127.0.0.1'e değil koşuma özgü adrese düşsün
  process.env.RATE_LIMIT_ENABLED = "false";
  process.env.LOGIN_LOCKOUT_SCOPE = "ip";
  const keys = [SETTING_KEYS.AUTH_WEB_TOTP_POLICY, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY,
    SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES, SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, SETTING_KEYS.DEVICE_PROOF_REQUIRED,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const setting = async (key: string, value: unknown) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };
  const hosted = (on: boolean) => { if (on) process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN"; else delete process.env[INSTALL_CLASS_ENV]; invalidateFeatureFlagsCache(); };

  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let ip = ipGen();
  const call = async (method: string, path: string, body?: unknown, token?: string, ipAddr = ip): Promise<Reply> => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", [IP_HEADER]: ipAddr, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: Body = {};
    try { parsed = JSON.parse(await r.text()) as Body; } catch { /* boş */ }
    return { status: r.status, body: parsed };
  };
  const login = (username: string, clientType: string | undefined, extra: Record<string, unknown> = {}, password = PASSWORD, ipAddr = ip) =>
    call("POST", "/api/auth/login", { username, password, confirmKick: true, ...(clientType ? { clientType } : {}), ...extra }, undefined, ipAddr);
  const sessionOf = async (r: Reply) => {
    const jti = (r.body.data?.user as { jti?: string } | undefined)?.jti;
    return jti ? prisma.session.findUnique({ where: { jti }, select: { deviceType: true, expiresAt: true, revokedAt: true, createdAt: true } }) : null;
  };

  try {
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");
    await setting(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "kick");
    await setting(SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY, true);
    await setting(SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES, 480);
    await setting(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 30);
    await setting(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);

    const boss = await makeUser("boss", ["roll:read", PATRON_LOGIN_PERMISSION]);
    const noPerm = await makeUser("noperm", ["roll:read"]);
    const onlyPatron = await makeUser("only", [PATRON_LOGIN_PERMISSION]);
    const withTotp = await makeUser("totp", ["roll:read", PATRON_LOGIN_PERMISSION]);
    const sys = await makeUser("sys", [PATRON_LOGIN_PERMISSION], true);
    const secret = await enrollTotp(withTotp.id, boss.id);

    // ── §1 tür ve oturum yuvası ──
    console.log("\n=== §1 tür ===");
    const e1 = await login(boss.username, "electron");
    const m1 = await login(boss.username, "mobile");
    const w1 = await login(boss.username, "web");
    check("§1 ön koşul: electron/mobile/web girişleri 200", [e1, m1, w1].every((r) => r.status === 200), [e1, m1, w1].map(codeOf).join(" "));
    const p1 = await login(boss.username, "patron");
    const p1s = await sessionOf(p1);
    check("§1a ⭐ patron girişi 200 ve Session.deviceType=PATRON", p1.status === 200 && p1s?.deviceType === "PATRON", `${codeOf(p1)} ${p1s?.deviceType}`);
    const others = await Promise.all([e1, m1, w1].map(sessionOf));
    check("§1b ⭐ patron girişi electron/mobile/web oturumlarını DÜŞÜRMEZ (kick)", others.every((s) => s && s.revokedAt === null),
      others.map((s) => `${s?.deviceType}:${s?.revokedAt ? "düştü" : "açık"}`).join(" "));
    const p2 = await login(boss.username, "patron");
    const [p1after, ...othersAfter] = await Promise.all([p1, e1, m1, w1].map(sessionOf));
    check("§1c ikinci patron girişi önceki PATRON'u düşürür (aynı-tip politika patron için ayrı)", p2.status === 200 && p1after?.revokedAt !== null, codeOf(p2));
    check("§1d ikinci patron girişi diğer türlere dokunmaz", othersAfter.every((s) => s && s.revokedAt === null));

    // ── §2 ömür ──
    console.log("\n=== §2 ömür ===");
    const lanP = await login(boss.username, "patron");
    const lanPs = await sessionOf(lanP);
    const lanM = await login(boss.username, "mobile");
    const lanMs = await sessionOf(lanM);
    check("§2a ⭐ LAN + otomatik çıkış açık: PATRON ≈ 30 gün", !!lanPs && near(lanPs.expiresAt.getTime() - lanPs.createdAt.getTime(), 30 * DAY),
      lanPs ? `${((lanPs.expiresAt.getTime() - lanPs.createdAt.getTime()) / DAY).toFixed(3)} gün` : "oturum yok");
    check("§2b kıyas: aynı ayarda mobile ≈ 480 dk", !!lanMs && near(lanMs.expiresAt.getTime() - lanMs.createdAt.getTime(), 480 * 60 * 1000),
      lanMs ? `${((lanMs.expiresAt.getTime() - lanMs.createdAt.getTime()) / 60000).toFixed(1)} dk` : "oturum yok");
    hosted(true);
    await setting(SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES, 2880);
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE"); // electron kıyası TOTP'siz geçsin
    const hP = await login(boss.username, "patron");
    const hPs = await sessionOf(hP);
    const hE = await login(boss.username, "electron");
    const hEs = await sessionOf(hE);
    check("§2c ⭐ barındırılan: PATRON ≈ 30 gün (24 sa tavanı ve kilitli otomatik çıkış kapsamaz)",
      !!hPs && near(hPs.expiresAt.getTime() - hPs.createdAt.getTime(), 30 * DAY), hPs ? `${((hPs.expiresAt.getTime() - hPs.createdAt.getTime()) / DAY).toFixed(3)} gün` : codeOf(hP));
    check("§2d kıyas: barındırılan electron ≤ 24 sa", !!hEs && hEs.expiresAt.getTime() - hEs.createdAt.getTime() <= DAY + 60_000, hEs ? "" : codeOf(hE));
    hosted(false);
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");
    await setting(SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES, 480);
    await setting(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 7);
    const capP = await login(boss.username, "patron");
    const capPs = await sessionOf(capP);
    check("§2e mutlak tavan 7 gün → PATRON ≈ 7 gün (sıkı olan kazanır)", !!capPs && near(capPs.expiresAt.getTime() - capPs.createdAt.getTime(), 7 * DAY),
      capPs ? `${((capPs.expiresAt.getTime() - capPs.createdAt.getTime()) / DAY).toFixed(3)} gün` : codeOf(capP));
    await setting(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 30);

    // ── §3 ikinci faktör isteğe bağlı ──
    console.log("\n=== §3 ikinci faktör ===");
    for (const h of [false, true]) {
      hosted(h);
      const tag = h ? "barındırılan REQUIRED" : "LAN";
      const a = await login(boss.username, "patron");
      check(`§3a ⭐ ${tag}: TOTP'siz kullanıcı patron türüyle kodsuz girer`, a.status === 200, codeOf(a));
      const b = await login(withTotp.username, "patron");
      check(`§3b ⭐ ${tag}: TOTP'si açık kullanıcıya kod sorulur (409 TOTP_REQUIRED)`, codeOf(b) === "409:TOTP_REQUIRED", codeOf(b));
      const c = await login(withTotp.username, "patron", { totpCode: "000000" });
      check(`§3c ${tag}: yanlış kod 401 TOTP_INVALID`, codeOf(c) === "401:TOTP_INVALID", codeOf(c));
      ip = ipGen(); // yanlış kod kilit sayacına girer — sonraki ölçüm temiz kovadan
      const d = await login(withTotp.username, "patron", { totpCode: await freshCode(withTotp.id, secret) });
      check(`§3d ${tag}: doğru kodla 200`, d.status === 200, codeOf(d));
      const s = await login(sys.username, "patron");
      check(`§3e ${tag}: TOTP'siz sistem hesabı patron türünde 403 TOTP_ENROLLMENT_REQUIRED`, codeOf(s) === "403:TOTP_ENROLLMENT_REQUIRED", codeOf(s));
    }
    hosted(true);
    const hm = await login(boss.username, "mobile");
    check("§3f kıyas: barındırılan REQUIRED'da mobile beyanı Y1 kuralında kalır (403 enrollment)", codeOf(hm) === "403:TOTP_ENROLLMENT_REQUIRED", codeOf(hm));
    hosted(false);

    // ── §4 izin ──
    console.log("\n=== §4 izin ===");
    const np = await login(noPerm.username, "patron");
    const npRows = await prisma.session.count({ where: { userId: noPerm.id, deviceType: "PATRON" } });
    check("§4a ⭐ izinsiz hesap 403 PATRON_ACCESS_DENIED", codeOf(np) === "403:PATRON_ACCESS_DENIED", codeOf(np));
    check("§4b izinsiz hesapta PATRON oturumu doğmaz", npRows === 0, String(npRows));
    const npMobile = await login(noPerm.username, "mobile");
    check("§4c aynı hesap mobile beyanıyla bugünkü gibi girer (kapı yalnız patron türünde)", npMobile.status === 200, codeOf(npMobile));
    const op = await login(onlyPatron.username, "patron");
    check("§4d yalnız patron izinli hesap patron türüyle girer", op.status === 200, codeOf(op));
    const oe = await login(onlyPatron.username, "electron");
    check("§4e ⭐ patron izni masaüstü panelini AÇMAZ (electron 403 CHANNEL_DENIED)", codeOf(oe) === "403:CHANNEL_DENIED", codeOf(oe));
    const pin = await call("POST", "/api/auth/login-quick-pin", { pin: "123456", clientType: "patron" });
    check("§4f PIN yolunda patron türü 400 (yalnız parola)", pin.status === 400, codeOf(pin));
    const card = await call("POST", "/api/auth/login-card", { cardCode: "TEST-yok", clientType: "patron" });
    check("§4g kart yolunda patron türü 400", card.status === 400, codeOf(card));

    // ── §5 giriş kilidi ──
    console.log("\n=== §5 kilit ===");
    const THRESHOLD = 3;
    await setting(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, THRESHOLD);
    await setting(SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, 30);
    await setting(SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER, 20);
    resetAccountThrottleForTests();
    const attacker = ipGen();
    const wrong: string[] = [];
    for (let i = 0; i < THRESHOLD; i++) wrong.push(codeOf(await login(boss.username, "patron", {}, "yanlis-parola-xx", attacker)));
    const after = await login(boss.username, "patron", {}, PASSWORD, attacker);
    check(`§5a ⭐ ${THRESHOLD} yanlış parola sonrası patron türünde doğru parola da 429 LOGIN_LOCKED`,
      after.status === 429 && String(after.body.details?.code ?? "") === "LOGIN_LOCKED", `${wrong.join(" ")} → ${codeOf(after)}`);
    check("§5b yanlış parolalar 401 sayıldı", wrong.slice(0, THRESHOLD - 1).every((c) => c.startsWith("401")), wrong.join(" "));
    resetAccountThrottleForTests();

    // ── §6 sürüm politikası ve yetenek ──
    console.log("\n=== §6 sürüm/yetenek ===");
    const pol = await call("GET", "/api/client-policy/patron");
    check("§6a ⭐ GET /api/client-policy/patron 200, minVersion 0.0.0 (kilit yok)", pol.status === 200 && pol.body.data?.minVersion === "0.0.0", codeOf(pol));
    const tok = await login(boss.username, "patron");
    const token = String(tok.body.data?.token ?? "");
    const me = await call("GET", "/api/auth/me", undefined, token);
    check("§6b ⭐ /api/auth/me backendVersion = APP_VERSION", me.status === 200 && me.body.data?.backendVersion === APP_VERSION, String(me.body.data?.backendVersion));
    check("§6c ⭐ /api/auth/me patronApiVersion = PATRON_API_VERSION", me.body.data?.patronApiVersion === PATRON_API_VERSION, String(me.body.data?.patronApiVersion));
    const mePerms = me.body.data?.permissions as string[] | undefined;
    check("§6d /api/auth/me izin kümesini taşır", Array.isArray(mePerms) && mePerms.includes(PATRON_LOGIN_PERMISSION));
    const ff = await call("GET", "/api/feature-flags", undefined, token);
    check("§6e GET /api/feature-flags patron token'ıyla modül bayraklarını verir", ff.status === 200 && typeof ff.body.data?.productionEnabled === "boolean", codeOf(ff));

    // ── §7 statik ──
    console.log("\n=== §7 statik ===");
    const auth = src("src/services/auth.service.ts") + src("src/routes/auth.routes.ts") + src("src/controllers/auth.controller.ts");
    check("§7a yenileme belirteci/ucu yazılmadı (30 günde bir parola)", !/refresh[-_]?token|\/refresh\b|refreshToken/i.test(auth));
    check("§7b katalog satırı var (kategori web)", PERMISSION_CATALOG.some((p) => p.code === PATRON_LOGIN_PERMISSION && p.category === "web"));
    check("§7c dar rollere atanmaz (muaf beyanlı, ADMIN_FULL dışında hiçbir şablonda yok)",
      PATRON_LOGIN_PERMISSION in ROLE_COVERAGE_EXEMPT &&
        ROLE_TEMPLATE_CATALOG.filter((t) => t.mode !== "all").every((t) => !t.codes.includes(PATRON_LOGIN_PERMISSION)));
    check("§7d ekransız izin beyanı", SCREENLESS_PERMISSIONS.some((p) => p.code === PATRON_LOGIN_PERMISSION));
    const migDir = join(__dirname, "..", "prisma", "migrations");
    const mig = readdirSync(migDir).find((d) => d.endsWith("_client_type_patron"));
    const sql = mig ? readFileSync(join(migDir, mig, "migration.sql"), "utf8").replace(/--.*$/gm, "").trim() : "";
    check("§7e migration yalnız ADD VALUE IF NOT EXISTS 'PATRON'", sql === `ALTER TYPE "ClientType" ADD VALUE IF NOT EXISTS 'PATRON';`, mig ?? "yok");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    restore(INSTALL_CLASS_ENV, originalEnv.cls);
    restore("WEB_DIST_DIR", originalEnv.web);
    restore("CLIENT_IP_HEADER", originalEnv.ipH);
    restore("RATE_LIMIT_ENABLED", originalEnv.rl);
    restore("LOGIN_LOCKOUT_SCOPE", originalEnv.scope);
    for (const key of keys) {
      const o = before.find((x) => x.key === key);
      if (!o) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
      else await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } }).catch((e) => check(`ayar geri yükleme ${key}`, false, String(e)));
    }
    invalidateFeatureFlagsCache();
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.trustedDevice.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...names] } }] } }).catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => check("fikstür temizliği", false, String(e)));
    setShortCredentialKeyDirForTests(null);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 3;
});

// Negatif sondalar (2026-11-13, uygulandı + md5 ile geri alındı; sonra 40/40):
//   S1 resolveDeviceType patron → MOBILE → §1a/§1b/§1d (3 kırmızı): tablet/panel oturumu düşer.
//   S2 patron süre dalı kapalı → §2a/§2c/§2e (3): 480 dk / 24 sa / tavan.
//   S3 `patron-app:login` kapısı kapalı → §4a/§4b (2).
//   S4 `grantsDesktopPanel` patron istisnası kaldırıldı → §4e (1).
//   S5 assertSecondFactor patron dalı + appliesHostedBearerRule patron istisnası BİRLİKTE kapalı → §3a barındırılan,
//      §3e LAN (2); tek tek 0 — iki bağımsız sed (biri tek başına yetiyor).
//   S6 /me `patronApiVersion` kaldırıldı → §6c (1).
//   S7 PIN/kart Zod şeması `patron` kabul eder → §4f/§4g (2). Servisteki PATRON_PASSWORD_ONLY seddi Zod arkasında
//      kalır, geçerli PIN gerektirdiği için burada ÖLÇÜLMEDİ.
