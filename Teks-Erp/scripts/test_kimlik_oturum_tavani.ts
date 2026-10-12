// =============================================================================
// BEKÇİ — KİMLİK DİLİM 2: kilit kapatılamaz · oturum bitişi sunucuda (güvenlik denetimi)
// Çalıştır: npx tsx scripts/test_kimlik_oturum_tavani.ts [--sonda=kapanir|--sonda=bitis]
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
// SONDA (kalıcı): --sonda=kapanir → §1 statik metne eski kapalı dalını ekler (KIRMIZI olmalı)
//                 --sonda=bitis   → §2 statik metinden süre denetimini siler (KIRMIZI olmalı)
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../src/lib/prisma";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { ClientType } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../src/middlewares/auth.middleware";
import { SessionRegistryService } from "../src/services/session-registry.service";
import { reserveLoginAttempt } from "../src/middlewares/login-lockout";
import {
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
  readPinLockoutConfig,
  systemSettingService,
} from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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
async function oturumAc(userId: string, expiresAt: Date, deviceType: ClientType = ClientType.MOBILE) {
  const jti = randomUUID();
  await SessionRegistryService.openLoginSession({ userId, deviceType, deviceId: null, jti, expiresAt, policy: "off" });
  return jti;
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
  } finally {
    await prisma.session.deleteMany({ where: { userId: { in: olusanKullanicilar } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: olusanKullanicilar } }, data: { isActive: false } }).catch(() => undefined);
    await geriYukle().catch((e) => check("geri yükleme", false, String(e)));
    await prisma.user.update({ where: { id: aktorId }, data: { isActive: false } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(3);
});
