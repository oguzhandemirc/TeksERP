// =============================================================================
// Bekçi: tarayıcı girişi bot koruması — Cloudflare Turnstile (V1c, 2026-11-13)
// =============================================================================
// Çalıştır: npx tsx scripts/test_turnstile_giris.ts
// Ölçer (süreç içi sunucu 127.0.0.1:0, HTTP; ağa ÇIKMAZ — sahte doğrulayıcı enjekte edilir):
//   §1 kapalıyken (varsayılan): web çerez girişi belirteçsiz 200, doğrulayıcı hiç çağrılmaz, login-methods alan taşımaz.
//   §2 yönetim ucu: site anahtarsız / gizli anahtarsız açma 400 TURNSTILE_KEYS_MISSING; ikisiyle 200; ham ayar ucu
//      anahtarları yazamaz (400 SETTING_KEY_RESERVED); yetkisiz 403; gizli anahtar hiçbir yanıtta ve audit'te yok.
//   §3 açıkken web çerez girişi: belirteçsiz / yanlış 403 TURNSTILE_FAILED, Cloudflare'e ulaşılamıyor 503
//      TURNSTILE_UNAVAILABLE (fail-closed), gizli anahtar ortamdan kalkınca 503, doğru belirteç 200 + çerez;
//      PIN ucu da kapıda; login-methods site anahtarını yalnız panel kipinde verir.
//   §4 kapsam dışı: Electron / tablet (mobile) / patron Bearer girişleri ve panel kipi kapalıyken "web" belirteçsiz geçer.
// İzolasyon: TEST- kullanıcıları + ayar anlık görüntüsü + ortam; finally geri yükler. DB GEREKİR.
// Negatif sondalar: dosya sonu.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { TURNSTILE_ENABLED_SETTING_KEY, TURNSTILE_SITE_KEY_SETTING_KEY } from "../src/constants/reserved-settings";
import { TURNSTILE_SECRET_ENV } from "../src/services/turnstile/turnstile-config";
import { setTurnstileVerifierForTests, type TurnstileVerdict } from "../src/services/turnstile/turnstile-verify";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Body = { data?: Record<string, unknown>; details?: Record<string, unknown> };
type Reply = { status: number; body: Body; raw: string; setCookie: string | null };
const PASSWORD = "Deneme-tsg-12345";
const SITE_KEY = "1x00000000000000000000AA";
const SECRET = `tsg-gizli-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const codeOf = (r: Reply) => `${r.status}:${String(r.body.details?.code ?? "")}`;
const isTurnstile = (r: Reply) => String(r.body.details?.code ?? "").startsWith("TURNSTILE");

const ids: string[] = [];
const names: string[] = [];
async function makeUser(tag: string, codes: string[]) {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
  const username = `TEST-tsg-${tag}-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      fullName: `TEST turnstile ${tag}`,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  ids.push(u.id);
  names.push(username);
  return { id: u.id, username };
}

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); process.exitCode = 1; return; }
  await reconcilePermissionCatalog();
  const originalEnv = { web: process.env.WEB_DIST_DIR, secret: process.env[TURNSTILE_SECRET_ENV], cls: process.env[INSTALL_CLASS_ENV] };
  delete process.env.WEB_DIST_DIR;
  delete process.env[TURNSTILE_SECRET_ENV];
  delete process.env[INSTALL_CLASS_ENV];
  const keys = [TURNSTILE_ENABLED_SETTING_KEY, TURNSTILE_SITE_KEY_SETTING_KEY, SETTING_KEYS.AUTH_WEB_TOTP_POLICY, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const setting = async (key: string, value: unknown) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };
  let calls = 0;
  setTurnstileVerifierForTests(async ({ secret, token }): Promise<TurnstileVerdict> => {
    calls++;
    if (secret !== SECRET) return "REJECTED";
    return token === "iyi" ? "OK" : token === "kopuk" ? "UNAVAILABLE" : "REJECTED";
  });
  const startedAt = new Date();

  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, opt: { bearer?: string; body?: unknown } = {}): Promise<Reply> => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(opt.bearer ? { Authorization: `Bearer ${opt.bearer}` } : {}) },
      ...(opt.body !== undefined ? { body: JSON.stringify(opt.body) } : {}),
    });
    const raw = await r.text();
    let body: Body = {};
    try { body = JSON.parse(raw) as Body; } catch { /* boş */ }
    return { status: r.status, body, raw, setCookie: r.headers.get("set-cookie") };
  };
  const login = (username: string, clientType: string, extra: Record<string, unknown> = {}) =>
    call("POST", "/api/auth/login", { body: { username, password: PASSWORD, clientType, confirmKick: true, ...extra } });
  const panel = (on: boolean) => { if (on) process.env.WEB_DIST_DIR = "/tmp/tsg-yok"; else delete process.env.WEB_DIST_DIR; };

  try {
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE");
    await setting(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");
    await prisma.systemSetting.deleteMany({ where: { key: { in: [TURNSTILE_ENABLED_SETTING_KEY, TURNSTILE_SITE_KEY_SETTING_KEY] } } });
    const webUser = await makeUser("web", ["roll:read", "web:access"]);
    const admin = await makeUser("adm", ["admin:settings"]);
    const plain = await makeUser("duz", ["roll:read"]);
    const patron = await makeUser("patron", ["roll:read", "patron-app:login"]);
    const admT = String((await login(admin.username, "electron")).body.data?.token ?? "");
    const plainT = String((await login(plain.username, "electron")).body.data?.token ?? "");
    check("§0 fikstür: Bearer token'lar alındı", admT.length > 0 && plainT.length > 0);

    // ── §1 kapalı ───────────────────────────────────────────────────────
    console.log("\n=== §1 kapalıyken bugünkü davranış ===");
    panel(true);
    const w0 = await login(webUser.username, "web");
    check("§1a ⭐ kapalı: web çerez girişi belirteçsiz 200 + çerez", w0.status === 200 && (w0.setCookie ?? "").includes("tekserp_oturum="), codeOf(w0));
    check("§1b kapalı: doğrulayıcı hiç çağrılmadı", calls === 0, String(calls));
    const m0 = await call("GET", "/api/auth/login-methods");
    check("§1c kapalı: login-methods turnstileSiteKey taşımaz", m0.status === 200 && !("turnstileSiteKey" in (m0.body.data ?? {})), m0.raw.slice(0, 160));

    // ── §2 yönetim ucu ──────────────────────────────────────────────────
    console.log("\n=== §2 yönetim ucu ===");
    const a1 = await call("PUT", "/api/admin/turnstile", { bearer: admT, body: { enabled: true } });
    check("§2a ⭐ site anahtarsız açma → 400 TURNSTILE_KEYS_MISSING", codeOf(a1) === "400:TURNSTILE_KEYS_MISSING", codeOf(a1));
    const a2 = await call("PUT", "/api/admin/turnstile", { bearer: admT, body: { enabled: true, siteKey: SITE_KEY } });
    check("§2b ⭐ gizli anahtar ortamda yokken açma → 400 TURNSTILE_KEYS_MISSING", codeOf(a2) === "400:TURNSTILE_KEYS_MISSING", codeOf(a2));
    const stillOff = await prisma.systemSetting.findUnique({ where: { key: TURNSTILE_ENABLED_SETTING_KEY }, select: { value: true } });
    check("§2c reddedilen açma DB'ye yazmadı", stillOff === null || stillOff.value !== true, JSON.stringify(stillOff?.value));
    const a3 = await call("PUT", "/api/admin/turnstile", { bearer: plainT, body: { enabled: false } });
    check("§2d admin:settings'siz → 403", a3.status === 403, codeOf(a3));
    const a4 = await call("PUT", `/api/admin/settings/${TURNSTILE_ENABLED_SETTING_KEY}`, { bearer: admT, body: { value: true } });
    check("§2e ⭐ ham ayar ucu anahtarı yazamaz → 400 SETTING_KEY_RESERVED", codeOf(a4) === "400:SETTING_KEY_RESERVED", codeOf(a4));
    process.env[TURNSTILE_SECRET_ENV] = SECRET;
    const a5 = await call("PUT", "/api/admin/turnstile", { bearer: admT, body: { enabled: true, siteKey: SITE_KEY } });
    check("§2f anahtarlarla açma → 200, secretConfigured", a5.status === 200 && a5.body.data?.enabled === true && a5.body.data?.secretConfigured === true, codeOf(a5));
    const g1 = await call("GET", "/api/admin/turnstile", { bearer: admT });
    check("§2g ⭐ gizli anahtar hiçbir yanıtta yok", g1.status === 200 && !g1.raw.includes(SECRET) && !a5.raw.includes(SECRET) && !a2.raw.includes(SECRET), codeOf(g1));

    // ── §3 açık ─────────────────────────────────────────────────────────
    console.log("\n=== §3 açıkken web çerez girişi ===");
    const m1 = await call("GET", "/api/auth/login-methods");
    check("§3a login-methods site anahtarını verir (panel kipi)", m1.body.data?.turnstileSiteKey === SITE_KEY && !m1.raw.includes(SECRET), String(m1.body.data?.turnstileSiteKey));
    const t1 = await login(webUser.username, "web");
    check("§3b ⭐ belirteçsiz → 403 TURNSTILE_FAILED, çerez yok", codeOf(t1) === "403:TURNSTILE_FAILED" && !(t1.setCookie ?? "").includes("tekserp_oturum="), codeOf(t1));
    const t2 = await login(webUser.username, "web", { turnstileToken: "kotu" });
    check("§3c ⭐ yanlış belirteç → 403 TURNSTILE_FAILED", codeOf(t2) === "403:TURNSTILE_FAILED", codeOf(t2));
    const t3 = await login(webUser.username, "web", { turnstileToken: "kopuk" });
    check("§3d ⭐ Cloudflare'e ulaşılamıyor → 503 TURNSTILE_UNAVAILABLE (fail-closed)", codeOf(t3) === "503:TURNSTILE_UNAVAILABLE", codeOf(t3));
    const t4 = await login(webUser.username, "web", { turnstileToken: "iyi" });
    check("§3e ⭐ doğru belirteç → 200 + çerez", t4.status === 200 && (t4.setCookie ?? "").includes("tekserp_oturum="), codeOf(t4));
    const p1 = await call("POST", "/api/auth/login-quick-pin", { body: { pin: "123456", clientType: "web" } });
    check("§3f PIN ucu da kapıda: belirteçsiz web → 403 TURNSTILE_FAILED", codeOf(p1) === "403:TURNSTILE_FAILED", codeOf(p1));
    delete process.env[TURNSTILE_SECRET_ENV];
    const t5 = await login(webUser.username, "web", { turnstileToken: "iyi" });
    check("§3g gizli anahtar ortamdan kalkınca → 503 TURNSTILE_UNAVAILABLE", codeOf(t5) === "503:TURNSTILE_UNAVAILABLE", codeOf(t5));
    process.env[TURNSTILE_SECRET_ENV] = SECRET;

    // ── §4 kapsam dışı ──────────────────────────────────────────────────
    console.log("\n=== §4 Bearer girişler etkilenmez ===");
    const callsBefore = calls;
    const e1 = await login(webUser.username, "electron");
    check("§4a ⭐ Electron belirteçsiz 200", e1.status === 200 && typeof e1.body.data?.token === "string", codeOf(e1));
    const e2 = await login(plain.username, "mobile");
    check("§4b ⭐ tablet (mobile) belirteçsiz 200", e2.status === 200, codeOf(e2));
    const e3 = await login(patron.username, "patron");
    check("§4c ⭐ patron telefonu belirteçsiz Turnstile'a takılmaz", e3.status === 200 && !isTurnstile(e3), codeOf(e3));
    panel(false);
    const e4 = await login(webUser.username, "web");
    check("§4d panel kipi kapalıyken 'web' beyanı Bearer yolunda, belirteçsiz 200", e4.status === 200 && !isTurnstile(e4), codeOf(e4));
    const m2 = await call("GET", "/api/auth/login-methods");
    check("§4e panel kipi kapalıyken login-methods site anahtarı vermez", !("turnstileSiteKey" in (m2.body.data ?? {})), m2.raw.slice(0, 120));
    check("§4f Bearer girişlerde doğrulayıcı çağrılmadı", calls === callsBefore, `${calls - callsBefore}`);

    const logs = await prisma.systemLog.findMany({ where: { createdAt: { gte: startedAt } }, select: { newData: true, oldData: true, changes: true, recordId: true } });
    check("§2h ⭐ gizli anahtar audit/sistem kaydında yok", !JSON.stringify(logs).includes(SECRET), `${logs.length} satır`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    setTurnstileVerifierForTests(null);
    for (const [k, v] of [["WEB_DIST_DIR", originalEnv.web], [TURNSTILE_SECRET_ENV, originalEnv.secret], [INSTALL_CLASS_ENV, originalEnv.cls]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const key of keys) {
      const o = before.find((x) => x.key === key);
      if (!o) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
      else await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } }).catch((e) => check(`ayar geri yükleme ${key}`, false, String(e)));
    }
    invalidateFeatureFlagsCache();
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...names] } }] } }).catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => check("fikstür temizliği", false, String(e)));
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

// Negatif sondalar (2026-11-13, uygulandı + md5 ile geri alındı):
//   N1 kapı açıkken de erken döner (`if (!cfg.enabled || cfg) return`) → §3b §3c §3d §3f §3g kırmızı (5).
//   N2 UNAVAILABLE geçer sayıldı (`verdict !== "REJECTED"`) → §3d §3g kırmızı: fail-closed ölçülüyor.
//   N3 açma doğrulamasından gizli anahtar şartı çıkarıldı → §2b §2c kırmızı: çıkışsız kapı açılamıyor.
