// =============================================================================
// Bekçi: bulut web paneli çerez oturumu (sözleşme: docs/design/BULUT-WEB-PANELI.md, K2/K4)
// =============================================================================
// Çalıştır: npx tsx scripts/test_web_cerez_oturumu.ts
// Ölçer (süreç içi sunucu 127.0.0.1:0, HTTP; panel kipi `WEB_DIST_DIR` app import'undan SONRA açılır):
//   §1 panel kipi kapalı (yok / boş dizgi): web girişi JSON token, Set-Cookie yok, TOTP sorulmaz.
//   §2 panel kipi + clientType web: çerez HttpOnly/Secure/SameSite=Strict/Path=/ + Max-Age≈exp,
//      gövdede token yok + cookieSession:true, Session WEB; aynı kipte Electron girişi JSON token.
//   §3 çerezli GET geçer; çerezli POST CSRF başlıksız 403 CSRF_REQUIRED, başlıkla geçer.
//   §4 Authorization varken çerez hiç okunmaz (geçerli Bearer + çöp çerez 200; çöp Bearer + geçerli çerez 401).
//   §5 TOTP: kurulmamış 403 TOTP_ENROLLMENT_REQUIRED, kodsuz 409 TOTP_REQUIRED, yanlış 401 TOTP_INVALID;
//      PIN yolu da (panel kipi kapalıyken kodsuz geçer, açıkken 409).
//   §6 web:access yok → 403 WEB_ACCESS_DENIED, Session açılmaz.
//   §7 logout (CSRF'li) Max-Age=0 basar + oturum LOGOUT; aynı çerez sonra 401 ve ölü çerez silinir.
//   §8 ELECTRON oturumunun JWT'si çerez olarak gönderilirse 401 (Bearer olarak geçer).
//   §9 zorunlu parola değişimi: kısıtlı oturum çerezde; change-password CSRF'siz 403, CSRF'li 200 + çerez silinir.
//   §10 statik: WEB_DIST_DIR src'de yalnız helper'da (app.ts Dilim B'de) · üç giriş yolu respondLogin'den çıkar.
//   §11 lisans durumu ucu çerezi görür: geçerli çerez ayrinti:true, çöp çerez 401, çerezsiz ayrinti:false.
//   §12 çerez JWT'si izin taşımaz (tam katalogla < 4096 bayt), gövde + /auth/me dolu, izinli uç 200 /
//       izinsiz 403; Bearer (Electron) ve panel kipi kapalı JSON token claim'i bugünkü gibi dolu.
//   §13 iki katmanlı web 2FA (2026-11-01): politika `auth.webTotpPolicy` REQUIRED'da opt-out etkisiz;
//       USER_CHOICE ∧ opt-out → kurulumsuz ve kodsuz giriş; opt-out değil → bugünkü; süperadmin hep kod
//       (CHECK + 403); kendi-uç kapatma parolasız/kodsuz 400, REQUIRED'da 409, başkası adına yazma yok,
//       genel kullanıcı güncelleme ucu alanı yazamaz; politika yalnız süperadmin (403) ve ham uçtan rezerve.
// İzolasyon: TEST kullanıcıları + giriş yöntemi ayarı anlık görüntüsü; finally geri yükler/siler. DB GEREKİR.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Express } from "express";
import { AuthService } from "../src/services/auth.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { WebTotpService } from "../src/services/web-totp.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

const KOK = resolve(__dirname, "..");

/**
 * Sunucu: tam `app.ts`. Yalnız app.ts İÇE AKTARILAMIYORSA (Prisma istemcisi şemanın gerisinde kalmış
 * çalışma kopyası — generate koşulmamış worktree) aynı kimlik/lisans katmanlarını taşıyan dar uygulamaya
 * düşer; düşüş SESLİDİR (⚠️ satırı). CI'da istemci tazedir → tam app ölçülür.
 */
async function sunucuUygulamasi(): Promise<Express> {
  try {
    return (await import("../src/app")).default;
  } catch (e) {
    console.log(`⚠️ app.ts içe aktarılamadı (${(e as Error).message}) — dar uygulamayla koşuluyor (json + licenseGate + /api/auth + /api/license + errorHandler)`);
    const { licenseGate } = await import("../src/middlewares/license.middleware");
    const authRoutes = (await import("../src/routes/auth.routes")).default;
    const licenseRoutes = (await import("../src/routes/license.routes")).default;
    const { errorHandler } = await import("../src/middlewares/error.middleware");
    const dar = express();
    dar.use(express.json());
    dar.use("/api", licenseGate);
    dar.use("/api/auth", authRoutes);
    dar.use("/api/license", licenseRoutes);
    dar.use(errorHandler);
    return dar;
  }
}
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Govde = { message?: string; data?: Record<string, unknown>; details?: { code?: string } };
type Yanit = { status: number; body: Govde; setCookie: string[] };
const PAROLA = "Deneme-webc-12345";
const ozgunEnv = process.env.WEB_DIST_DIR;
const panelAc = () => { process.env.WEB_DIST_DIR = join(tmpdir(), "ef-a-dist-web-yok"); };
const panelKapat = (deger: string | undefined = undefined) => {
  if (deger === undefined) delete process.env.WEB_DIST_DIR;
  else process.env.WEB_DIST_DIR = deger;
};

const ids: string[] = [];
const adlar: string[] = [];
async function kullanici(ek: string, izinler: string[], ekVeri: { mustChangePassword?: boolean } = {}) {
  const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true, code: true } });
  if (perms.length !== izinler.length) throw new Error(`Fikstür: izin eksik (${izinler.join(",")}) — uzlaştırma koşmamış olabilir`);
  const username = `TEST-webc-${ek}-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(PAROLA),
      fullName: `TEST web çerez ${ek}`,
      ...ekVeri,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  ids.push(u.id);
  adlar.push(username);
  return { id: u.id, username };
}
async function totpKur(userId: string, aktor: string): Promise<string> {
  const w = await TotpAccountService.openWindow({ userId, openedById: aktor });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  return w.secret;
}
// Kurulum şimdiki adımı tüketti (replay kilidi) → her sır bir kez sonraki adımla girer.
const kod = (secret: string) => totpCodeForStep(secret, totpStep() + 1);

function cerezDegeri(setCookie: string[]): string | null {
  const s = setCookie.find((c) => c.startsWith("tekserp_oturum="));
  if (!s) return null;
  return s.slice("tekserp_oturum=".length).split(";")[0];
}
/** JWT gövdesini imza doğrulamadan çöz (yalnız claim okuması). */
function jwtClaim(token: string): { permissions?: unknown; exp?: number } {
  try {
    return JSON.parse(Buffer.from(decodeURIComponent(token).split(".")[1] ?? "", "base64url").toString() || "{}") as { permissions?: unknown };
  } catch {
    return {};
  }
}
const silenCerez = (setCookie: string[]) =>
  setCookie.some((c) => c.startsWith("tekserp_oturum=;") && /Max-Age=0/.test(c));

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) out.push(...tsDosyalari(yol));
    else if (ad.endsWith(".ts")) out.push(yol);
  }
  return out;
}

function statik(): void {
  console.log("\n=== §10 statik ===");
  const okuyan = tsDosyalari(join(KOK, "src"))
    .filter((f) => readFileSync(f, "utf8").includes("WEB_DIST_DIR"))
    .map((f) => f.slice(KOK.length + 1))
    .filter((f) => f !== "src/lib/web-session-cookie.ts" && f !== "src/app.ts" && f !== "src/config/client-version-policy.ts");
  check("§10a WEB_DIST_DIR src'de yalnız helper'da okunur (app.ts statik sunum + yorum hariç)", okuyan.length === 0, okuyan.join(", "));
  const ctl = readFileSync(join(KOK, "src/controllers/auth.controller.ts"), "utf8");
  const cagri = (ctl.match(/respondLogin\(res, body\.clientType, result\)/g) ?? []).length;
  const ciplak = (ctl.match(/token: result\.token/g) ?? []).length;
  check("§10b üç giriş yolu respondLogin'den çıkar, gövdeye token yalnız onun içinde yazılır", cagri === 3 && ciplak === 1, `çağrı=${cagri} çıplak=${ciplak}`);
  const mw = readFileSync(join(KOK, "src/middlewares/auth.middleware.ts"), "utf8");
  check("§10c middleware kimlik bilgisini readRequestToken'dan okur (başlık önceliği tek yerde)", /readRequestToken\(req\)/.test(mw) && !/headers\.authorization/.test(mw));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("§0 hedef DB yazılabilir", false, engel); process.exit(1); }
  statik();
  // Boot uzlaştırmasıyla aynı yol (yalnız EKLER): yeni `web:access` satırı test DB'sinde doğsun.
  await reconcilePermissionCatalog();
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "ef-a-halka-")));
  const methodsKey = SETTING_KEYS.AUTH_LOGIN_METHODS;
  const methodsOnce = await prisma.systemSetting.findUnique({ where: { key: methodsKey }, select: { value: true } });
  const policyKey = SETTING_KEYS.AUTH_WEB_TOTP_POLICY;
  const policyOnce = await prisma.systemSetting.findUnique({ where: { key: policyKey }, select: { value: true } });
  const politika = async (v: "REQUIRED" | "USER_CHOICE") => {
    await prisma.systemSetting.upsert({ where: { key: policyKey }, create: { key: policyKey, value: v }, update: { value: v } });
    invalidateFeatureFlagsCache();
  };

  const app = await sunucuUygulamasi();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    method: string,
    p: string,
    opt: { bearer?: string; cookie?: string; csrf?: boolean; body?: unknown } = {},
  ): Promise<Yanit> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opt.bearer) headers.Authorization = `Bearer ${opt.bearer}`;
    if (opt.cookie) headers.Cookie = `baska=1; tekserp_oturum=${opt.cookie}`;
    if (opt.csrf) headers["X-TeksERP-CSRF"] = "1";
    const r = await fetch(`${base}${p}`, {
      method,
      headers,
      ...(opt.body !== undefined ? { body: JSON.stringify(opt.body) } : {}),
    });
    let body: Govde = {};
    try { body = (await r.json()) as Govde; } catch { /* boş gövde */ }
    return { status: r.status, body, setCookie: r.headers.getSetCookie() };
  };
  const giris = (username: string, clientType: string, ek: Record<string, unknown> = {}) =>
    call("POST", "/api/auth/login", { body: { username, password: PAROLA, clientType, confirmKick: true, ...ek } });

  try {
    const aktor = await kullanici("aktor", ["roll:read"]);
    const uWeb = await kullanici("web", ["roll:read", "web:access"]);
    const uTotpYok = await kullanici("totpyok", ["roll:read", "web:access"]);
    const uTotp2 = await kullanici("totp2", ["roll:read", "web:access"]);
    const uIzinsiz = await kullanici("izinsiz", ["roll:read"]);
    const uElec = await kullanici("elec", ["roll:read"]);
    const uPdz = await kullanici("pdz", ["roll:read", "web:access"], { mustChangePassword: true });
    const sWeb = await totpKur(uWeb.id, aktor.id);
    const sTotp2 = await totpKur(uTotp2.id, aktor.id);
    const sIzinsiz = await totpKur(uIzinsiz.id, aktor.id);
    const sPdz = await totpKur(uPdz.id, aktor.id);

    // ── §1 panel kipi kapalı ────────────────────────────────────────────────
    console.log("\n=== §1 panel kipi kapalı ===");
    panelKapat();
    const k1 = await giris(uElec.username, "web");
    check("§1a WEB_DIST_DIR yok: web girişi 200 + gövdede token, Set-Cookie yok, TOTP sorulmaz",
      k1.status === 200 && typeof k1.body.data?.token === "string" && k1.body.data?.cookieSession === undefined && cerezDegeri(k1.setCookie) === null,
      `status=${k1.status}`);
    panelKapat("   ");
    const k1b = await giris(uTotpYok.username, "web");
    check("§1b WEB_DIST_DIR boşluk = kapalı: JSON token, TOTP'siz kullanıcı girer",
      k1b.status === 200 && typeof k1b.body.data?.token === "string" && cerezDegeri(k1b.setCookie) === null, `status=${k1b.status}`);

    // ── §2 panel kipi + web ─────────────────────────────────────────────────
    console.log("\n=== §2 panel kipi çerez girişi ===");
    panelAc();
    const w = await giris(uWeb.username, "web", { totpCode: kod(sWeb) });
    const ham = w.setCookie.find((c) => c.startsWith("tekserp_oturum=")) ?? "";
    const cerez = cerezDegeri(w.setCookie) ?? "";
    const maxAge = Number(/Max-Age=(\d+)/.exec(ham)?.[1] ?? "-1");
    const exp = (JSON.parse(Buffer.from(decodeURIComponent(cerez).split(".")[1] ?? "", "base64url").toString() || "{}") as { exp?: number }).exp ?? 0;
    const beklenen = exp - Math.floor(Date.now() / 1000);
    check("§2a 200 + çerez basıldı", w.status === 200 && cerez.length > 0, `status=${w.status} code=${String(w.body.details?.code)}`);
    check("§2b çerez bayrakları HttpOnly; Secure; SameSite=Strict; Path=/",
      /;\s*HttpOnly/.test(ham) && /;\s*Secure/.test(ham) && /;\s*SameSite=Strict/.test(ham) && /;\s*Path=\/(;|$)/.test(ham), ham.replace(cerez, "<jwt>"));
    check("§2c Max-Age = JWT exp − şimdi (±5 sn)", maxAge > 0 && Math.abs(maxAge - beklenen) <= 5, `maxAge=${maxAge} beklenen=${beklenen}`);
    check("§2d gövdede token YOK + cookieSession:true + user",
      w.body.data !== undefined && !("token" in w.body.data) && w.body.data.cookieSession === true && typeof w.body.data.user === "object");
    const webOturum = await prisma.session.findFirst({ where: { userId: uWeb.id, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { deviceType: true, jti: true } });
    check("§2e Session.deviceType = WEB", webOturum?.deviceType === "WEB", String(webOturum?.deviceType));
    const e2 = await giris(uElec.username, "electron");
    const elecToken = String(e2.body.data?.token ?? "");
    check("§2f panel kipinde Electron girişi bayt-bayt bugünkü gibi: JSON token, Set-Cookie yok",
      e2.status === 200 && elecToken.length > 0 && e2.body.data?.cookieSession === undefined && cerezDegeri(e2.setCookie) === null, `status=${e2.status}`);

    // ── §12 çerez claim'i izin taşımaz (BULGU-1: tam liste çerezi 4096 bayta iter) ──
    console.log("\n=== §12 çerez claim'inde izin yok ===");
    const k1Izin = jwtClaim(String(k1.body.data?.token ?? "")).permissions;
    check("§12a panel kipi kapalı web girişi (JSON token): claim izinleri bugünkü gibi dolu",
      Array.isArray(k1Izin) && k1Izin.includes("roll:read"), JSON.stringify(k1Izin));
    const tumKodlar = (await prisma.permission.findMany({ select: { code: true } })).map((p) => p.code);
    const uTam = await kullanici("tam", tumKodlar);
    // Bearer girişi TOTP kurulmadan: kurulu hesapta Electron şifre girişi de kod ister (bu ölçümün konusu değil).
    const e12 = await giris(uTam.username, "electron");
    const e12Izin = jwtClaim(String(e12.body.data?.token ?? "")).permissions;
    const sTam = await totpKur(uTam.id, aktor.id);
    const t12 = await giris(uTam.username, "web", { totpCode: kod(sTam) });
    const hamTam = t12.setCookie.find((c) => c.startsWith("tekserp_oturum=")) ?? "";
    const cerezTam = cerezDegeri(t12.setCookie) ?? "";
    const claimTam = jwtClaim(cerezTam);
    check("§12b tam izinli web girişi 200 + çerez", t12.status === 200 && cerezTam.length > 0, `status=${t12.status} code=${String(t12.body.details?.code)}`);
    check("§12c çerezdeki JWT claim'i permissions: []",
      Array.isArray(claimTam.permissions) && claimTam.permissions.length === 0, `claim=${JSON.stringify(claimTam.permissions)?.slice(0, 80)}`);
    check("§12d Set-Cookie satırı < 4096 bayt (katalog büyüse de sabit kalır)",
      hamTam.length > 0 && Buffer.byteLength(hamTam) < 4096, `bayt=${Buffer.byteLength(hamTam)} katalog=${tumKodlar.length}`);
    const govdeIzin = ((t12.body.data?.user ?? {}) as { permissions?: unknown }).permissions;
    check("§12e gövdedeki user.permissions DOLU (panel buradan okur)",
      Array.isArray(govdeIzin) && govdeIzin.length === tumKodlar.length, `gövde=${Array.isArray(govdeIzin) ? govdeIzin.length : "yok"} katalog=${tumKodlar.length}`);
    const p12 = await call("GET", "/api/license/proxy", { cookie: cerezTam });
    check("§12f boş claim'li çerezle license:view uçu 200 (yetki DB'den)", p12.status === 200, `status=${p12.status} code=${String(p12.body.details?.code)}`);
    const me12 = await call("GET", "/api/auth/me", { cookie: cerezTam });
    const meIzin = me12.body.data?.permissions;
    check("§12g /auth/me çerezle tam izin listesini döner", me12.status === 200 && Array.isArray(meIzin) && meIzin.length === tumKodlar.length,
      `status=${me12.status} me=${Array.isArray(meIzin) ? meIzin.length : "yok"}`);
    const p12dar = await call("GET", "/api/license/proxy", { cookie: cerez });
    check("§12h izni olmayan çerez oturumu aynı uçta 403 PERMISSION_DENIED (kapı açık kalmadı)",
      p12dar.status === 403 && p12dar.body.details?.code === "PERMISSION_DENIED", `status=${p12dar.status} code=${String(p12dar.body.details?.code)}`);
    check("§12i Bearer (Electron) girişi: claim izinleri bugünkü gibi dolu",
      e12.status === 200 && Array.isArray(e12Izin) && e12Izin.length === tumKodlar.length, `status=${e12.status} code=${String(e12.body.details?.code)} claim=${Array.isArray(e12Izin) ? e12Izin.length : "yok"}`);

    // ── §3 CSRF ─────────────────────────────────────────────────────────────
    console.log("\n=== §3 CSRF ===");
    const me = await call("GET", "/api/auth/me", { cookie: cerez });
    check("§3a çerezle GET /auth/me 200 (CSRF gerekmez)", me.status === 200, `status=${me.status} code=${String(me.body.details?.code)}`);
    const csrfsiz = await call("POST", "/api/auth/logout", { cookie: cerez });
    check("§3b çerezle CSRF başlıksız POST 403 CSRF_REQUIRED", csrfsiz.status === 403 && csrfsiz.body.details?.code === "CSRF_REQUIRED",
      `status=${csrfsiz.status} code=${String(csrfsiz.body.details?.code)}`);
    const halaCanli = await prisma.session.findUnique({ where: { jti: webOturum?.jti ?? "" }, select: { revokedAt: true } });
    check("§3c reddedilen POST oturumu düşürmedi", halaCanli?.revokedAt === null);
    const prefs = await call("PUT", "/api/auth/preferences", { cookie: cerez, csrf: true, body: {} });
    check("§3d CSRF başlıklı çerezli yazma isteği kimlik kapısından geçer (401/403-CSRF değil)",
      prefs.status !== 401 && prefs.body.details?.code !== "CSRF_REQUIRED", `status=${prefs.status} code=${String(prefs.body.details?.code)}`);
    const bearerPost = await call("PUT", "/api/auth/preferences", { bearer: elecToken, body: {} });
    check("§3e Bearer akışında CSRF aranmaz", bearerPost.body.details?.code !== "CSRF_REQUIRED" && bearerPost.status !== 401, `status=${bearerPost.status}`);

    // ── §4 okuma önceliği ───────────────────────────────────────────────────
    console.log("\n=== §4 Authorization önceliği ===");
    const r4a = await call("GET", "/api/auth/me", { bearer: elecToken, cookie: "cop.cop.cop" });
    check("§4a geçerli Bearer + çöp çerez → 200 (çerez okunmadı)", r4a.status === 200, `status=${r4a.status}`);
    const r4b = await call("GET", "/api/auth/me", { bearer: "cop.cop.cop", cookie: cerez });
    check("§4b çöp Bearer + geçerli çerez → 401 (çereze geri düşülmez)", r4b.status === 401, `status=${r4b.status}`);
    const r4c = await fetch(`${base}/api/auth/me`, { headers: { Authorization: "Basic eA==", Cookie: `tekserp_oturum=${cerez}` } });
    check("§4c Bearer olmayan Authorization + geçerli çerez → 401", r4c.status === 401, `status=${r4c.status}`);

    // ── §5 TOTP ─────────────────────────────────────────────────────────────
    console.log("\n=== §5 TOTP zorunlu ===");
    const t5a = await giris(uTotpYok.username, "web");
    check("§5a TOTP kurulmamış → 403 TOTP_ENROLLMENT_REQUIRED, çerez yok",
      t5a.status === 403 && t5a.body.details?.code === "TOTP_ENROLLMENT_REQUIRED" && cerezDegeri(t5a.setCookie) === null,
      `status=${t5a.status} code=${String(t5a.body.details?.code)}`);
    const t5b = await giris(uTotp2.username, "web");
    check("§5b kodsuz → 409 TOTP_REQUIRED", t5b.status === 409 && t5b.body.details?.code === "TOTP_REQUIRED", `status=${t5b.status} code=${String(t5b.body.details?.code)}`);
    const t5c = await giris(uTotp2.username, "web", { totpCode: "000000" });
    check("§5c yanlış kod → 401 TOTP_INVALID", t5c.status === 401 && t5c.body.details?.code === "TOTP_INVALID", `status=${t5c.status} code=${String(t5c.body.details?.code)}`);
    check("§5d reddedilen denemeler oturum açmadı (uTotpYok yalnız §1b'deki)",
      (await prisma.session.count({ where: { userId: uTotp2.id } })) === 0);
    // PIN yolu: normal kullanıcıda bayrak kapalıyken kodsuz geçerdi; çerez kipinde TOTP dalı onu da kapsar.
    await prisma.systemSetting.upsert({
      where: { key: methodsKey },
      create: { key: methodsKey, value: { enabled: ["list", "pin"], primary: "list" } },
      update: { value: { enabled: ["list", "pin"], primary: "list" } },
    });
    invalidateFeatureFlagsCache();
    const { pin } = await AuthService.setQuickPin(uTotp2.id, {}, undefined);
    const pinSonuc = async () => {
      try { await AuthService.loginWithQuickPin(pin ?? "", { clientType: "web" }); return "200"; }
      catch (e) { const x = e as { statusCode?: number; details?: { code?: string } }; return `${x.statusCode}:${x.details?.code ?? ""}`; }
    };
    panelKapat();
    const p0 = await pinSonuc();
    panelAc();
    const p1 = await pinSonuc();
    check("§5e PIN web girişi: panel kipi kapalıyken kodsuz 200 (bugünkü), açıkken 409 TOTP_REQUIRED", p0 === "200" && p1 === "409:TOTP_REQUIRED", `kapalı=${p0} açık=${p1}`);
    // Çerez kipinde yanlış kod da bayatlamasın: §5c kodu tüketmedi → doğru kodla giriş açılır.
    const t5f = await giris(uTotp2.username, "web", { totpCode: kod(sTotp2) });
    check("§5f doğru kod → 200 + çerez", t5f.status === 200 && cerezDegeri(t5f.setCookie) !== null, `status=${t5f.status} code=${String(t5f.body.details?.code)}`);

    // ── §6 web:access ───────────────────────────────────────────────────────
    console.log("\n=== §6 web:access ===");
    const i6 = await giris(uIzinsiz.username, "web", { totpCode: kod(sIzinsiz) });
    check("§6a web:access yok → 403 WEB_ACCESS_DENIED, çerez yok",
      i6.status === 403 && i6.body.details?.code === "WEB_ACCESS_DENIED" && cerezDegeri(i6.setCookie) === null,
      `status=${i6.status} code=${String(i6.body.details?.code)}`);
    check("§6b reddedilen giriş Session açmadı", (await prisma.session.count({ where: { userId: uIzinsiz.id } })) === 0);

    // ── §8 kanal damgası (logout'tan önce: çerez canlıyken) ──────────────────
    console.log("\n=== §8 ELECTRON token'ı çerezde ===");
    const r8 = await call("GET", "/api/auth/me", { cookie: elecToken });
    check("§8a ELECTRON oturum JWT'si çerez olarak → 401 SESSION_INVALID", r8.status === 401 && r8.body.details?.code === "SESSION_INVALID",
      `status=${r8.status} code=${String(r8.body.details?.code)}`);
    check("§8b aynı JWT Bearer olarak geçer (oturum canlı)", (await call("GET", "/api/auth/me", { bearer: elecToken })).status === 200);
    check("§8c web oturumu Bearer olarak gönderilirse de geçer (kısıt yalnız çerez yönünde)",
      (await call("GET", "/api/auth/me", { bearer: decodeURIComponent(cerez) })).status === 200);

    // ── §11 lisans durumu ucu ───────────────────────────────────────────────
    console.log("\n=== §11 lisans kapısı çerezi görür ===");
    const l1 = await call("GET", "/api/license/durum", { cookie: cerez });
    check("§11a geçerli çerez → 200 ayrinti:true", l1.status === 200 && l1.body.data?.ayrinti === true, `status=${l1.status} ayrinti=${String(l1.body.data?.ayrinti)}`);
    const l2 = await call("GET", "/api/license/durum", { cookie: "cop.cop.cop" });
    check("§11b çöp çerez → 401 (kimlik bilgisi var sayılıp doğrulandı)", l2.status === 401, `status=${l2.status}`);
    const l3 = await call("GET", "/api/license/durum");
    check("§11c çerezsiz → 200 ayrinti:false (bugünkü)", l3.status === 200 && l3.body.data?.ayrinti === false, `status=${l3.status}`);

    // ── §7 logout ───────────────────────────────────────────────────────────
    console.log("\n=== §7 çıkış ===");
    const lo = await call("POST", "/api/auth/logout", { cookie: cerez, csrf: true });
    check("§7a CSRF'li logout 200 + Set-Cookie Max-Age=0", lo.status === 200 && silenCerez(lo.setCookie), `status=${lo.status} ${lo.setCookie.join(" | ")}`);
    const iptal = await prisma.session.findUnique({ where: { jti: webOturum?.jti ?? "" }, select: { revokedAt: true, revokeReason: true } });
    check("§7b oturum iptal (LOGOUT)", iptal?.revokedAt !== null && iptal?.revokeReason === "LOGOUT", String(iptal?.revokeReason));
    const sonra = await call("GET", "/api/auth/me", { cookie: cerez });
    check("§7c aynı çerezle sonraki istek 401 + ölü çerez silinir", sonra.status === 401 && silenCerez(sonra.setCookie), `status=${sonra.status}`);
    const bearer401 = await call("GET", "/api/auth/me", { bearer: "cop.cop.cop" });
    check("§7d Bearer 401'i Set-Cookie basmaz (Electron/tablet akışı aynı)", bearer401.status === 401 && bearer401.setCookie.length === 0);

    // ── §9 zorunlu parola değişimi ──────────────────────────────────────────
    console.log("\n=== §9 zorunlu parola değişimi ===");
    const z = await giris(uPdz.username, "web", { totpCode: kod(sPdz) });
    const zc = cerezDegeri(z.setCookie) ?? "";
    check("§9a değişim bekleyen hesap: çerez + mustChangePassword:true", z.status === 200 && zc.length > 0 && z.body.data?.mustChangePassword === true,
      `status=${z.status} code=${String(z.body.details?.code)}`);
    const zme = await call("GET", "/api/auth/me", { cookie: zc });
    check("§9b kısıtlı çerez oturumu /auth/me'ye geçer", zme.status === 200, `status=${zme.status}`);
    const yeni = { currentPassword: PAROLA, newPassword: "Yeni-webc-Parola-9876" };
    const zc1 = await call("POST", "/api/auth/change-password", { cookie: zc, body: yeni });
    check("§9c change-password CSRF'siz 403 CSRF_REQUIRED", zc1.status === 403 && zc1.body.details?.code === "CSRF_REQUIRED", `status=${zc1.status}`);
    const zc2 = await call("POST", "/api/auth/change-password", { cookie: zc, csrf: true, body: yeni });
    check("§9d change-password çerez + CSRF ile 200 + çerez silinir", zc2.status === 200 && silenCerez(zc2.setCookie),
      `status=${zc2.status} code=${String(zc2.body.details?.code)} msg=${zc2.body.message ?? ""}`);

    await webTotpIkiKatman({ giris, call, aktorId: aktor.id, politika, policyKey });
  } finally {
    panelKapat(ozgunEnv);
    await new Promise<void>((r) => server.close(() => r()));
    if (methodsOnce === null) await prisma.systemSetting.deleteMany({ where: { key: methodsKey } }).catch(() => undefined);
    else await prisma.systemSetting.update({ where: { key: methodsKey }, data: { value: methodsOnce.value as never } }).catch((e) => check("ayar geri yükleme", false, String(e)));
    if (policyOnce === null) await prisma.systemSetting.deleteMany({ where: { key: policyKey } }).catch(() => undefined);
    else await prisma.systemSetting.update({ where: { key: policyKey }, data: { value: policyOnce.value as never } }).catch((e) => check("politika geri yükleme", false, String(e)));
    invalidateFeatureFlagsCache();
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...adlar] } }] } }).catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => check("fikstür temizliği", false, String(e)));
    setShortCredentialKeyDirForTests(null);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

type Giris = (username: string, clientType: string, ek?: Record<string, unknown>) => Promise<Yanit>;
type Call = (method: string, p: string, opt?: { bearer?: string; cookie?: string; csrf?: boolean; body?: unknown }) => Promise<Yanit>;
const kodu = (r: Yanit) => `${r.status}:${r.body.details?.code ?? ""}`;
async function servisSonuc(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return "200"; }
  catch (e) { const x = e as { statusCode?: number; details?: { code?: string } }; return `${x.statusCode}:${x.details?.code ?? ""}`; }
}

async function webTotpIkiKatman(o: {
  giris: Giris; call: Call; aktorId: string; politika: (v: "REQUIRED" | "USER_CHOICE") => Promise<void>; policyKey: string;
}): Promise<void> {
  const { giris, call, politika } = o;
  console.log("\n=== §13 web 2FA: politika + kullanıcı tercihi ===");
  panelAc();
  const uOpt = await kullanici("opt", ["roll:read", "web:access"]);
  const uOptT = await kullanici("optt", ["roll:read", "web:access"]);
  const uNoOpt = await kullanici("noopt", ["roll:read", "web:access"]);
  const uKendi = await kullanici("kendi", ["roll:read", "web:access"]);
  const uAdm = await kullanici("adm", ["roll:read", "admin:users", "admin:settings"]);
  const sOptT = await totpKur(uOptT.id, o.aktorId);
  await prisma.user.updateMany({ where: { id: { in: [uOpt.id, uOptT.id] } }, data: { webTotpOptOut: true } });

  // REQUIRED (varsayılan): opt-out etkisiz — bugünkü davranış bayt-aynı.
  await politika("REQUIRED");
  const a1 = await giris(uOpt.username, "web");
  check("§13a REQUIRED: opt-out'lu ama kurulumsuz → 403 TOTP_ENROLLMENT_REQUIRED (tercih etkisiz)", kodu(a1) === "403:TOTP_ENROLLMENT_REQUIRED", kodu(a1));
  const a2 = await giris(uOptT.username, "web");
  check("§13a' REQUIRED: opt-out'lu + kurulu, kodsuz → 409 TOTP_REQUIRED", kodu(a2) === "409:TOTP_REQUIRED", kodu(a2));

  await politika("USER_CHOICE");
  const b1 = await giris(uOpt.username, "web");
  check("§13b ⭐ USER_CHOICE ∧ opt-out, TOTP kurulmamış → 200 + çerez", b1.status === 200 && cerezDegeri(b1.setCookie) !== null, kodu(b1));
  const b2 = await giris(uOptT.username, "web");
  check("§13c ⭐ USER_CHOICE ∧ opt-out, TOTP kurulu → kod SORULMADAN 200", b2.status === 200 && cerezDegeri(b2.setCookie) !== null, kodu(b2));
  const b3 = await giris(uNoOpt.username, "web");
  check("§13d USER_CHOICE ∧ opt-out değil → 403 TOTP_ENROLLMENT_REQUIRED (bugünkü)", kodu(b3) === "403:TOTP_ENROLLMENT_REQUIRED", kodu(b3));
  const b4 = await giris(uOptT.username, "electron");
  check("§13d' masaüstü parola girişi tercihten etkilenmez: kurulu TOTP → 409", kodu(b4) === "409:TOTP_REQUIRED", kodu(b4));
  void sOptT;

  // Süperadmin: tercih yok sayılır ve yazılamaz.
  const sa = await prisma.user.create({
    data: { username: `TEST-webc-sa-${Date.now()}`, passwordHash: await AuthService.hashPassword(PAROLA), fullName: "TEST web sa", isSystemAccount: true },
    select: { id: true, username: true },
  });
  ids.push(sa.id);
  const c1 = await giris(sa.username, "web");
  check("§13e ⭐ süperadmin USER_CHOICE'ta da kurulumsuz → 403 TOTP_ENROLLMENT_REQUIRED", kodu(c1) === "403:TOTP_ENROLLMENT_REQUIRED", kodu(c1));
  const dbSed = await prisma.user.update({ where: { id: sa.id }, data: { webTotpOptOut: true } }).then(() => "yazıldı", () => "red");
  check("§13f süperadminde opt-out DB CHECK'iyle yazılamaz", dbSed === "red", dbSed);
  const c2 = await servisSonuc(() => WebTotpService.setOwnOptOut(sa.id, { optOut: true, currentPassword: PAROLA }));
  check("§13g süperadmin kendi ucundan kapatamaz → 403 WEB_TOTP_SYSTEM_ACCOUNT", c2 === "403:WEB_TOTP_SYSTEM_ACCOUNT", c2);
  await totpKur(sa.id, o.aktorId);
  const c3 = await giris(sa.username, "web");
  check("§13h ⭐ süperadmin USER_CHOICE'ta kodsuz → 409 TOTP_REQUIRED", kodu(c3) === "409:TOTP_REQUIRED", kodu(c3));

  // Kendi-uç: kapatmak yeniden doğrulama ister, açmak serbest.
  const kt = String((await giris(uKendi.username, "electron")).body.data?.token ?? "");
  const admT = String((await giris(uAdm.username, "electron")).body.data?.token ?? "");
  check("§13 fikstür: Bearer token'lar alındı", kt.length > 0 && admT.length > 0);
  const d1 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: true } });
  check("§13i ⭐ parolasız kapatma → 400 CURRENT_PASSWORD_INVALID", kodu(d1) === "400:CURRENT_PASSWORD_INVALID", kodu(d1));
  const d2 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: true, currentPassword: "yanlis-parola-1" } });
  check("§13j yanlış parola → 400 CURRENT_PASSWORD_INVALID", kodu(d2) === "400:CURRENT_PASSWORD_INVALID", kodu(d2));
  const d3 = await servisSonuc(() => WebTotpService.setOwnOptOut(uNoOpt.id, { optOut: true, currentPassword: PAROLA }));
  const sNo = await totpKur(uNoOpt.id, o.aktorId);
  const d4 = await servisSonuc(() => WebTotpService.setOwnOptOut(uNoOpt.id, { optOut: true, currentPassword: PAROLA }));
  const d5 = await servisSonuc(() => WebTotpService.setOwnOptOut(uNoOpt.id, { optOut: true, currentPassword: PAROLA, totpCode: "000000" }));
  check("§13k ⭐ TOTP kurulu hesapta kodsuz kapatma 400 TOTP_REQUIRED, yanlış kod 400 TOTP_INVALID",
    d3 === "200" && d4 === "400:TOTP_REQUIRED" && d5 === "400:TOTP_INVALID", `kurulumsuz=${d3} kodsuz=${d4} yanlış=${d5}`);
  void sNo;
  const d6 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: true, currentPassword: PAROLA, userId: uNoOpt.id } });
  check("§13l başkası adına yazma alanı yok: gövdede userId → 400", d6.status === 400, kodu(d6));
  const d7 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: true, currentPassword: PAROLA } });
  const kendiSatir = await prisma.user.findUnique({ where: { id: uKendi.id }, select: { webTotpOptOut: true } });
  check("§13m doğru parolayla kapatma → 200 + kayıt", d7.status === 200 && kendiSatir?.webTotpOptOut === true && d7.body.data?.effective === true, kodu(d7));
  const iz = await prisma.systemLog.count({ where: { tableName: "USER_WEB_TOTP", recordId: uKendi.id } });
  check("§13n değişim audit'e girdi (USER_WEB_TOTP)", iz >= 1, `${iz}`);
  const d8 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: false } });
  check("§13o geri açmak serbest (parolasız 200)", d8.status === 200 && d8.body.data?.optOut === false, kodu(d8));
  await politika("REQUIRED");
  const d9 = await call("PUT", "/api/auth/web-totp", { bearer: kt, body: { optOut: true, currentPassword: PAROLA } });
  check("§13p REQUIRED'da kapatma → 409 WEB_TOTP_POLICY_REQUIRED", kodu(d9) === "409:WEB_TOTP_POLICY_REQUIRED", kodu(d9));

  // Yönetici başkasının tercihini değiştiremez; politika yalnız süperadmin.
  // Hedef uKendi: §13o'da kendi ucundan geri açtı (false) — yönetici gövdesi onu true'ya çeviremez.
  const e1 = await call("PATCH", `/api/admin/users/${uKendi.id}`, { bearer: admT, body: { fullName: "TEST web kendi", webTotpOptOut: true } });
  const noOptSatir = await prisma.user.findUnique({ where: { id: uKendi.id }, select: { webTotpOptOut: true } });
  check("§13q ⭐ genel kullanıcı güncelleme ucu webTotpOptOut YAZAMAZ", e1.status === 200 && noOptSatir?.webTotpOptOut === false, `${kodu(e1)} optOut=${String(noOptSatir?.webTotpOptOut)}`);
  const e2 = await call("GET", `/api/admin/users/${uOpt.id}/totp`, { bearer: admT });
  check("§13r yönetici tercihi GÖRÜR (salt okuma)", e2.status === 200 && e2.body.data?.webTotpOptOut === true, kodu(e2));
  const e3 = await call("PATCH", "/api/feature-flags", { bearer: admT, body: { webTotpPolicy: "USER_CHOICE" } });
  const polSatir = await prisma.systemSetting.findUnique({ where: { key: o.policyKey }, select: { value: true } });
  check("§13s ⭐ süperadmin olmayan admin:settings politikayı yazamaz → 403 MODULE_FLAG_SUPERADMIN_ONLY, değer değişmedi",
    kodu(e3) === "403:MODULE_FLAG_SUPERADMIN_ONLY" && polSatir?.value === "REQUIRED", `${kodu(e3)} değer=${JSON.stringify(polSatir?.value)}`);
  const e4 = await call("PUT", `/api/admin/settings/${o.policyKey}`, { bearer: admT, body: { value: "USER_CHOICE" } });
  check("§13t ham ayar ucu ikinci yazma yüzeyi açmaz → 400 MODULE_KEY_RESERVED", kodu(e4) === "400:MODULE_KEY_RESERVED", kodu(e4));
  const e5 = await call("GET", "/api/admin/web-totp-summary", { bearer: admT });
  check("§13u özet ucu politika + kapatan sayısı döner", e5.status === 200 && e5.body.data?.policy === "REQUIRED" && Number(e5.body.data?.optedOutCount) >= 2, kodu(e5));
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 3;
});
