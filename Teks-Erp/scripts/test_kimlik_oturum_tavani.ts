// =============================================================================
// BEKÇİ — KİMLİK DİLİM 2: kilit kapatılamaz · oturum bitişi sunucuda (güvenlik denetimi)
// Çalıştır: npx tsx scripts/test_kimlik_oturum_tavani.ts [--sonda=kapanir|--sonda=bitis|--sonda=tavan|--sonda=budama|--sonda=y1]
// =============================================================================
// NEDEN: denetim O-04 — `settings:session` sahibi giriş deneme kilidini tek PATCH ile
// kapatıp PIN/şifre uzayını sınırsız deneyebiliyordu. Artık kilit kapatılamaz: `false`
// 400 `PIN_LOCKOUT_REQUIRED`, eski kurulumda kalan `false` satırı yok sayılır, eşikler ≥1.
//
// §1 kilit kapatılamaz: false → 400 (DB değişmez) · eski false satırı → okuyucu true,
//    rezervasyon eşikte bloklar · sıfır eşik/süre 400 · statik: kapalı dalı ve panel
//    anahtarı yok
// §2 oturum bitişi SUNUCUDA (denetim §B3e): DB `expiresAt` geçmişse JWT `exp`i +10 yıl
//    olsa da, exp'siz olsa da 401; geçerli zemin 200; `isSessionValid` aynı yüklem
// §3 eşzamanlı oturum tavanı: politika `off`ta 21. giriş en eskiyi `SESSION_LIMIT` ile düşürür,
//    düşen token 401 SESSION_REVOKED; üç tipten 30 paralel giriş tavanı aşmaz (kilit kullanıcı
//    başına); varsayılan `kick`te üç tip açıkken hiçbir oturum SESSION_LIMIT ile düşmez
// §4 süresi geçmiş kimlik kayıtlarının budaması (defter DEĞİL): gece bakımında ölü oturum
//    (90 gün) ve TÜKETİLMEDEN süresi dolan 2FA kurulum penceresi (30 gün, aday sır taşır);
//    tüketilmiş pencere (kurulum kanıtı, G1 mührü onu okur) ve taze pencere kalır
// §5 (Y1) tavan 0 + zaman aşımı kapalı → token 365 gün DEĞİL, kapatılamaz sert tavan (30 gün);
//    açık gün sayısı (45) ve zaman aşımı açık yolu değişmez; panel aynası aynı sayıyı söyler
// SONDA (kalıcı): --sonda=kapanir → §1 statik metne eski kapalı dalını ekler (KIRMIZI olmalı)
//                 --sonda=bitis   → §2 statik metinden süre denetimini siler (KIRMIZI olmalı)
//                 --sonda=tavan   → §3 statik metinden tavan çağrısını siler (KIRMIZI olmalı)
//                 --sonda=budama  → §4 statik metinde budama yüklemi `consumedAt: null`ı kaybeder (KIRMIZI olmalı)
//                 --sonda=y1      → §5 issueToken'da tavan 0 eski "en uzun tavan"a (365) döner (KIRMIZI olmalı)
// =============================================================================
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import prisma from "../src/lib/prisma";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { ClientType } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../src/middlewares/auth.middleware";
import { MAX_ACTIVE_SESSIONS_PER_USER, SessionRegistryService } from "../src/services/session-registry.service";
import { reserveLoginAttempt } from "../src/middlewares/login-lockout";
import {
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
  readPinLockoutConfig,
  systemSettingService,
} from "../src/services/system-setting.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { storeTotpSecret } from "../src/services/helpers/totp-state.helper";
import { generateTotpSecret } from "../src/services/totp.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { MAINTENANCE_TASKS, TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS } from "../src/jobs/maintenance.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuthService } from "../src/services/auth.service";
import {
  DEFAULT_ABSOLUTE_SESSION_CAP_DAYS,
  UNSET_ABSOLUTE_SESSION_CAP_DAYS,
  effectiveAbsoluteSessionCapDays,
  readSessionDurationMinutes,
} from "../src/services/system-setting.service";

const SONDA = process.argv.find((a) => a.startsWith("--sonda="))?.slice("--sonda=".length) ?? null;
const KOK = resolve(__dirname, "..");
const MONO = resolve(KOK, "..");

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const oku = (p: string) => readFileSync(p, "utf8");
const kodu = (e: unknown) => (e as { details?: { code?: string } })?.details?.code;
const durumu = (e: unknown) => (e as { statusCode?: number })?.statusCode;

/** Değiştirilen ayarların özgün satırı — finally'de BİREBİR geri konur. */
const ozgun = new Map<string, { value: unknown; description: string | null } | null>();
async function sakla(key: string) {
  if (ozgun.has(key)) return;
  const r = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true, description: true } });
  ozgun.set(key, r ? { value: r.value, description: r.description } : null);
}
async function hamYaz(key: string, value: unknown) {
  await sakla(key);
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST kimlik dilim 2" },
    update: { value: value as never },
  });
  invalidateFeatureFlagsCache();
}
async function geriYukle() {
  for (const [key, row] of ozgun) {
    if (row === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never, description: row.description } });
  }
  invalidateFeatureFlagsCache();
}

let aktorId: string | undefined;
async function reddeder(input: Record<string, unknown>): Promise<unknown> {
  try {
    await systemSettingService.setFeatureFlags(input as never, aktorId);
    return null;
  } catch (e) {
    return e;
  }
}

async function kilitKapatilamaz() {
  console.log("\n=== §1 giriş deneme kilidi kapatılamaz (O-04) ===");
  await sakla(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED);
  await sakla(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS);
  const once = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED } });
  const e = await reddeder({ pinLockoutEnabled: false });
  check("§1a pinLockoutEnabled:false → 400 PIN_LOCKOUT_REQUIRED", durumu(e) === 400 && kodu(e) === "PIN_LOCKOUT_REQUIRED",
    `status=${durumu(e)} code=${kodu(e)}`);
  check("§1a' ileti Türkçe ve 'kapatılamaz' der", /kapatılamaz/.test((e as Error)?.message ?? ""));
  const sonra = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED } });
  check("§1b reddedilen istek DB satırını değiştirmedi", JSON.stringify(once?.value) === JSON.stringify(sonra?.value));
  check("§1c pinLockoutEnabled:true kabul edilir (no-op)", (await reddeder({ pinLockoutEnabled: true })) === null);

  // Eski kurulumdan kalan `false` satırı: panelden artık yazılamaz ama DB'de durabilir.
  await hamYaz(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, false);
  await hamYaz(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, 3);
  const cfg = await readPinLockoutConfig();
  check("§1d eski false satırı → readPinLockoutConfig().enabled === true", cfg.enabled === true, `enabled=${cfg.enabled}`);
  const flags = await systemSettingService.getFeatureFlags();
  check("§1e eski false satırı → getFeatureFlags().pinLockoutEnabled === true", flags.data?.pinLockoutEnabled === true);
  const anahtar = `TEST-KIMLIK2-${Date.now()}`;
  let bloklandi = false;
  for (let i = 0; i < cfg.attempts + 1; i++) if ((await reserveLoginAttempt(anahtar)).blocked) bloklandi = true;
  check("§1f eski false satırı varken eşik aşılınca BLOKLAR", bloklandi, `eşik=${cfg.attempts}`);

  for (const [alan, deger] of [
    ["pinLockoutAttempts", 0],
    ["pinLockoutPenaltySec", 0],
    ["pinLockoutEscalateAfter", 0],
    ["pinLockoutLongPenaltyMin", 0],
  ] as const) {
    const r = await reddeder({ [alan]: deger });
    check(`§1g ${alan}=0 → 400 (sıfır/kapalı eşik yok)`, durumu(r) === 400, `status=${durumu(r)}`);
  }

  let kilit = oku(resolve(KOK, "src/middlewares/login-lockout.ts"));
  let ayar = oku(resolve(KOK, "src/services/system-setting.service.ts"));
  if (SONDA === "kapanir") {
    kilit = kilit.replace("await readPinLockoutConfig();", "await readPinLockoutConfig();\n  if (!enabled) return { blocked: false, retryAfterSec: 0, justLocked: false };");
    ayar = ayar.replace("return DEFAULT_PIN_LOCKOUT_ENABLED;\n}", "return asBoolean(setting.value);\n}");
  }
  check("§1h login-lockout: kilidin kapalı dalı yok", !/if \(!enabled\)/.test(kilit));
  const okuyucu = ayar.slice(ayar.indexOf("export async function readPinLockoutEnabled("));
  const govde = okuyucu.slice(0, okuyucu.indexOf("\n}\n"));
  check("§1i readPinLockoutEnabled DB değerini okumaz (her zaman açık)", govde.includes("return DEFAULT_PIN_LOCKOUT_ENABLED;") && !govde.includes("asBoolean"));
  const panel = oku(resolve(MONO, "Electron/src/pages/GeneralSettings/SessionSettingsSection.tsx"));
  check("§1j panelde kilit için aç/kapa anahtarı yok", !panel.includes("onChange={s.setPinEnabled}"));
}

const olusanKullanicilar: string[] = [];
async function testKullanicisi(etiket: string) {
  const u = await prisma.user.create({
    data: { username: `TEST-kimlik2-${etiket}-${Date.now()}`, passwordHash: "x", fullName: `TEST Kimlik2 ${etiket}` },
    select: { id: true, username: true, tokenVersion: true },
  });
  olusanKullanicilar.push(u.id);
  return u;
}
async function oturumAc(
  userId: string,
  expiresAt: Date,
  deviceType: ClientType = ClientType.MOBILE,
  policy: "off" | "kick" = "off",
) {
  const jti = randomUUID();
  await SessionRegistryService.openLoginSession({ userId, deviceType, deviceId: null, jti, expiresAt, policy });
  return jti;
}
const aktifSay = (userId: string) =>
  prisma.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } });

async function oturumTavani() {
  console.log("\n=== §3 kullanıcı başına eşzamanlı oturum tavanı ===");
  const sir = process.env.JWT_SECRET ?? "";
  const T = MAX_ACTIVE_SESSIONS_PER_USER;
  check("§3a tavan anlamlı bir sabit (3 < tavan ≤ 50)", T > 3 && T <= 50, `tavan=${T}`);
  const ileri = () => new Date(Date.now() + 3_600_000);
  const u = await testKullanicisi("tavan");
  const jtiler: string[] = [];
  for (let i = 0; i < T; i++) jtiler.push(await oturumAc(u.id, ileri()));
  check("§3b tavana kadar (off) hiçbiri düşmez", (await aktifSay(u.id)) === T);
  const yeni = await oturumAc(u.id, ileri());
  const enEski = await prisma.session.findUnique({ where: { jti: jtiler[0]! }, select: { revokedAt: true, revokeReason: true } });
  check("§3c tavan+1. giriş → en eski oturum SESSION_LIMIT ile düştü", enEski?.revokedAt !== null && enEski?.revokeReason === "SESSION_LIMIT",
    JSON.stringify(enEski));
  check("§3d aktif oturum sayısı tavanda kaldı, yeni oturum açık", (await aktifSay(u.id)) === T && (await SessionRegistryService.isSessionValid(yeni)));
  const ikinci = await prisma.session.findUnique({ where: { jti: jtiler[1]! }, select: { revokedAt: true } });
  check("§3e yalnız EN ESKİ düştü (ikinci açık)", ikinci?.revokedAt === null);
  const tok = jwt.sign({ userId: u.id, username: u.username, permissions: [], tokenVersion: u.tokenVersion }, sir,
    { jwtid: jtiler[0]!, algorithm: "HS256", expiresIn: 3600 });
  const r = await arakatman(tok);
  const det = (r.err as { details?: { code?: string; reason?: string } })?.details;
  check("§3f düşen oturumun token'ı 401 SESSION_REVOKED / SESSION_LIMIT", durumu(r.err) === 401 && det?.code === "SESSION_REVOKED" && det?.reason === "SESSION_LIMIT",
    JSON.stringify(det));

  const p = await testKullanicisi("paralel");
  const tipler = [ClientType.ELECTRON, ClientType.MOBILE, ClientType.WEB];
  await Promise.all(Array.from({ length: T + 10 }, (_, i) => oturumAc(p.id, ileri(), tipler[i % 3])));
  const pAktif = await aktifSay(p.id);
  check("§3g üç tipten tavan+10 paralel giriş → aktif oturum tam tavan (yarış aşmaz)", pAktif === T, `aktif=${pAktif}`);

  const k = await testKullanicisi("kick");
  for (let tur = 0; tur < 3; tur++) for (const t of tipler) await oturumAc(k.id, ileri(), t, "kick");
  const limitli = await prisma.session.count({ where: { userId: k.id, revokeReason: "SESSION_LIMIT" } });
  check("§3h varsayılan kick: üç tip açık, SESSION_LIMIT ile düşen yok (bugünkü davranış)", (await aktifSay(k.id)) === 3 && limitli === 0,
    `aktif=${await aktifSay(k.id)} limitli=${limitli}`);

  let reg = oku(resolve(KOK, "src/services/session-registry.service.ts"));
  if (SONDA === "tavan") reg = reg.replace("await revokeOverCap(tx, userId);", "");
  const ac = reg.slice(reg.indexOf("static async openLoginSession("), reg.indexOf("static async revokeSession("));
  check("§3i statik: openLoginSession tavanı create'ten önce uygular, kilit kullanıcı başına",
    /await revokeOverCap\(tx, userId\);\s*return tx\.session\.create/.test(ac) && ac.includes("hashtext(${userId})"));
}
/** auth.middleware'i sahte req/res/next ile koştur. */
async function arakatman(token: string): Promise<{ err: unknown; gecti: boolean }> {
  let err: unknown = null;
  let gecti = false;
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  await verifyToken(req, {} as Response, ((e?: unknown) => {
    if (e) err = e;
    else gecti = !!req.user;
  }) as unknown as NextFunction);
  return { err, gecti };
}

async function oturumBitisiSunucuda() {
  console.log("\n=== §2 oturum bitişi sunucuda (denetim §B3e) ===");
  const sir = process.env.JWT_SECRET;
  if (!sir) { check("§2 ön koşul JWT_SECRET", false); return; }
  const u = await testKullanicisi("bitis");
  const govde = { userId: u.id, username: u.username, permissions: [], tokenVersion: u.tokenVersion };
  const jti = await oturumAc(u.id, new Date(Date.now() + 3_600_000));
  const onYil = jwt.sign(govde, sir, { jwtid: jti, algorithm: "HS256", expiresIn: 10 * 365 * 86_400 });
  const expsiz = jwt.sign(govde, sir, { jwtid: jti, algorithm: "HS256" });
  const zemin = await arakatman(onYil);
  check("§2a zemin: expiresAt ileride → middleware geçer", zemin.err === null && zemin.gecti);
  check("§2b zemin: isSessionValid true", await SessionRegistryService.isSessionValid(jti));
  await prisma.session.update({ where: { jti }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  const r1 = await arakatman(onYil);
  check("§2c expiresAt geçmiş + JWT exp +10 yıl → 401", durumu(r1.err) === 401 && !r1.gecti, `status=${durumu(r1.err)}`);
  const r2 = await arakatman(expsiz);
  check("§2d expiresAt geçmiş + exp'siz token → 401", durumu(r2.err) === 401 && !r2.gecti, `status=${durumu(r2.err)}`);
  check("§2e isSessionValid süresi dolmuş oturumda false", !(await SessionRegistryService.isSessionValid(jti)));

  let mw = oku(resolve(KOK, "src/middlewares/auth.middleware.ts"));
  if (SONDA === "bitis") mw = mw.replace(/session\.expiresAt\.getTime\(\) <= Date\.now\(\)/, "false");
  check("§2f statik: middleware oturum satırının expiresAt'ini okur ve şimdiyle karşılaştırır",
    /select: \{[^}]*expiresAt: true[^}]*\}/.test(mw) && /session\.expiresAt\.getTime\(\) <= Date\.now\(\)/.test(mw));
}

async function budama() {
  console.log("\n=== §4 süresi geçmiş kimlik kayıtlarının budaması ===");
  const gorevler = MAINTENANCE_TASKS.map((t) => t.name);
  check("§4a gece bakımında oturum ve 2FA penceresi budaması kayıtlı", gorevler.includes("session-purge") && gorevler.includes("totp-enrollment-purge"),
    gorevler.join(","));
  check("§4b pencere saklama süresi 7–90 gün arası", TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS >= 7 && TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS <= 90);
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "bekci-kimlik2-halka-")));
  const u = await testKullanicisi("totp");
  const gun = 86_400_000;
  const pencere = (expiresAt: Date, consumedAt: Date | null) =>
    prisma.totpEnrollment.create({
      data: { userId: u.id, openedById: aktorId!, token: randomUUID(), secret: storeTotpSecret(generateTotpSecret()), expiresAt, consumedAt },
      select: { id: true },
    });
  const eski = await pencere(new Date(Date.now() - 40 * gun), null);
  const taze = await pencere(new Date(Date.now() - 5 * gun), null);
  const kanit = await pencere(new Date(Date.now() - 40 * gun), new Date(Date.now() - 41 * gun));
  const r = await TotpAccountService.purgeExpiredEnrollments(TOTP_ENROLLMENT_PURGE_OLDER_THAN_DAYS);
  const kalan = new Set((await prisma.totpEnrollment.findMany({ where: { userId: u.id }, select: { id: true } })).map((x) => x.id));
  check("§4c tüketilmeden 40 gün önce dolmuş pencere silindi", !kalan.has(eski.id) && r.deleted >= 1, `silinen=${r.deleted}`);
  check("§4d 5 gün önce dolmuş pencere kaldı (saklama süresi içinde)", kalan.has(taze.id));
  check("§4e tüketilmiş pencere (kurulum kanıtı) kaldı", kalan.has(kanit.id));
  await prisma.totpEnrollment.deleteMany({ where: { userId: u.id } });
  setShortCredentialKeyDirForTests(null);

  let svc = oku(resolve(KOK, "src/services/totp-account.service.ts"));
  if (SONDA === "budama") svc = svc.replace("where: { consumedAt: null, expiresAt: { lt: cutoff } },", "where: { expiresAt: { lt: cutoff } },");
  check("§4f statik: pencere budaması yalnız tüketilmemiş ve süresi eşikten eski satırı seçer",
    svc.includes("where: { consumedAt: null, expiresAt: { lt: cutoff } },"));
}

async function sertTavan() {
  console.log("\n=== §5 (Y1) tavan 0 + zaman aşımı kapalı → sert tavan ===");
  const U = UNSET_ABSOLUTE_SESSION_CAP_DAYS;
  check("§5a sert tavan makul: ≥1 gün (vardiya boyu oturum kırılmaz) ve ≤ varsayılan tavan",
    U >= 1 && U <= DEFAULT_ABSOLUTE_SESSION_CAP_DAYS, `sert=${U} varsayılan=${DEFAULT_ABSOLUTE_SESSION_CAP_DAYS}`);
  check("§5b effectiveAbsoluteSessionCapDays: 0 → sert tavan, 45 → 45, 365 → 365",
    effectiveAbsoluteSessionCapDays(0) === U && effectiveAbsoluteSessionCapDays(45) === 45 && effectiveAbsoluteSessionCapDays(365) === 365);

  const parola = `Tk-${randomUUID()}`;
  const u = await prisma.user.create({
    data: { username: `TEST-kimliky1-${Date.now()}`, passwordHash: await AuthService.hashPassword(parola), fullName: "TEST Kimlik Y1" },
    select: { id: true, username: true },
  });
  olusanKullanicilar.push(u.id);
  const omur = async () => {
    const g = await AuthService.login(u.username, parola);
    const d = jwt.decode(g.token) as { iat: number; exp?: number; jti?: string };
    const s = await prisma.session.findUnique({ where: { jti: d.jti! }, select: { expiresAt: true } });
    return { span: typeof d.exp === "number" ? d.exp - d.iat : NaN, sessSpan: s ? (s.expiresAt.getTime() - Date.now()) / 1000 : NaN };
  };
  const gun = 86_400;
  await hamYaz(SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY, false);
  await hamYaz(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 0);
  const o0 = await omur();
  check("§5c cap=0 + kapalı → JWT exp-iat ≈ sert tavan (365 gün DEĞİL)", Math.abs(o0.span - U * gun) < 120, `span=${o0.span}s`);
  check("§5d cap=0 + kapalı → Session.expiresAt ≈ sert tavan (sunucu kararı hizalı)", Math.abs(o0.sessSpan - U * gun) < 300, `sess=${Math.round(o0.sessSpan)}s`);
  await hamYaz(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 45);
  const o45 = await omur();
  check("§5e açık gün sayısı (45) DEĞİŞMEZ — ayarlı kurulum etkilenmez", Math.abs(o45.span - 45 * gun) < 120, `span=${o45.span}s`);
  await hamYaz(SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS, 0);
  await hamYaz(SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY, true);
  const dk = await readSessionDurationMinutes();
  const oAcik = await omur();
  check("§5f zaman aşımı AÇIK yolu değişmez (oturum süresi dakika)", Math.abs(oAcik.span - dk * 60) < 120, `span=${oAcik.span}s dk=${dk}`);

  let auth = oku(resolve(KOK, "src/services/auth.service.ts"));
  if (SONDA === "y1") auth = auth.replace("effectiveAbsoluteSessionCapDays(capDays)", "capDays > 0 ? capDays : MAX_ABSOLUTE_SESSION_CAP_DAYS");
  check("§5g statik: issueToken tavanı TEK kaynaktan çözer, en uzun tavana (365) düşmez",
    auth.includes("const effectiveCapDays = effectiveAbsoluteSessionCapDays(capDays);") && !auth.includes("MAX_ABSOLUTE_SESSION_CAP_DAYS"));
  const form = oku(resolve(MONO, "Electron/src/pages/GeneralSettings/useSessionSettingsForm.ts"));
  const bolum = oku(resolve(MONO, "Electron/src/pages/GeneralSettings/SessionSettingsSection.tsx"));
  check("§5h panel aynası: UNSET_ABSOLUTE_CAP_DAYS backend'le eşit, etiket 0'ı 'en fazla 365' diye anlatmaz",
    form.includes(`export const UNSET_ABSOLUTE_CAP_DAYS = ${U};`) && !bolum.includes("0 = en fazla"));
}

async function main() {
  const engel = hedefDbEngeli();
  if (engel) { check("§0 hedef DB yazılabilir", false, engel); process.exit(1); }
  // Aktör bekçinin KENDİ kullanıcısıdır (seed `admin`ine bağlanılmaz); audit FK yüzünden pasife alınır.
  const ts = Date.now();
  aktorId = (await prisma.user.create({
    data: { username: `TEST-kimlik2-aktor-${ts}`, passwordHash: "x", fullName: "TEST Kimlik2 aktör" },
    select: { id: true },
  })).id;
  try {
    await kilitKapatilamaz();
    await oturumBitisiSunucuda();
    await oturumTavani();
    await budama();
    await sertTavan();
  } finally {
    await prisma.session.deleteMany({ where: { userId: { in: olusanKullanicilar } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: olusanKullanicilar } }, data: { isActive: false } }).catch(() => undefined);
    await geriYukle().catch((e) => check("geri yükleme", false, String(e)));
    await prisma.user.update({ where: { id: aktorId }, data: { isActive: false } }).catch(() => undefined);
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
