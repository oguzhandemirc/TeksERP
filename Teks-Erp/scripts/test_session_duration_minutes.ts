// =============================================================================
// Test: Oturum süresi DAKİKA-granüler ayarı (auth.sessionDurationMinutes)
// Çalıştır: npx tsx scripts/test_session_duration_minutes.ts
// Doğrulananlar:
//   1. Default 480 dk (8 saat) — hiçbir kayıt yokken reader + FeatureFlags.
//   2. Dakika ayarı persist eder (setFeatureFlags) → reader + FeatureFlags blob
//      (sessionDurationHours = round(dk/60) türevi tutarlı).
//   3. JWT exp ayarı yansıtır — login token'ında exp-iat ≈ dakika×60 (±tolerans).
//   4. Geriye-uyum: yalnız auth.sessionDurationHours varken minutes = hours×60.
//   5. Doğrulama: 0 / 43201 reddedilir, 43200 kabul edilir (Türkçe AppError).
// İzolasyon: dedicated TEST kullanıcısı + oturum süresi ayarları snapshot alınıp
// finally'de aynen geri yüklenir → dev verisine kalıcı iz bırakmaz.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config() → JWT_SECRET/DATABASE_URL yüklenir
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { AuthService } from "../src/services/auth.service";
import {
  systemSettingService,
  readSessionDurationMinutes,
  readAbsoluteSessionCapDays,
  invalidateFeatureFlagsCache,
  SETTING_KEYS,
  DEFAULT_SESSION_DURATION_MINUTES,
  DEFAULT_ABSOLUTE_SESSION_CAP_DAYS,
} from "../src/services/system-setting.service";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const MIN_KEY = SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES;
const HRS_KEY = SETTING_KEYS.AUTH_SESSION_DURATION_HOURS;
const AUTO_KEY = SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY;
const CAP_KEY = SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS;

/** Ayarı doğrudan yaz (audit gürültüsü olmadan; updatedById TEST user'a bağlı). */
async function rawSet(key: string, value: Prisma.InputJsonValue, userId: string) {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
  invalidateFeatureFlagsCache();
}
async function clearKey(key: string) {
  await prisma.systemSetting.deleteMany({ where: { key } });
  invalidateFeatureFlagsCache();
}

async function main() {
  const ts = Date.now();
  const secret = need(process.env.JWT_SECRET, "JWT_SECRET (.env)");

  // Oturum-süresi ayarlarının mevcut halini yakala (finally'de aynen geri yüklenir).
  // updatedById de saklanır: test bu satırları TEST user'a bağlarsa, restore etmezsek
  // FK Restrict user silinemez.
  type SettingSnap = { value: Prisma.JsonValue; updatedById: string | null };
  const originals = new Map<string, SettingSnap | undefined>();
  for (const k of [MIN_KEY, HRS_KEY, AUTO_KEY, CAP_KEY]) {
    const row = await prisma.systemSetting.findUnique({
      where: { key: k },
      select: { value: true, updatedById: true },
    });
    originals.set(k, row ? { value: row.value, updatedById: row.updatedById } : undefined);
  }

  const username = `TEST-sdm-${ts}`;
  const password = "test123";
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(password),
      fullName: "TEST Oturum Süresi",
    },
    select: { id: true },
  });
  const createdSessionUserId = user.id;

  /** Login yap, JWT decode et → exp-iat (saniye). */
  async function loginExpSpan(): Promise<number> {
    const { token } = await AuthService.login(username, password);
    const decoded = jwt.verify(token, secret) as { iat: number; exp: number };
    return decoded.exp - decoded.iat;
  }
  /** Login yap, decode et → tüm payload (exp yoksa undefined). */
  async function loginDecode(): Promise<{ iat: number; exp?: number }> {
    const { token } = await AuthService.login(username, password);
    return jwt.verify(token, secret) as { iat: number; exp?: number };
  }

  try {
    // --- 1. Default (hiç kayıt yok) → 480 dk ---
    await clearKey(MIN_KEY);
    await clearKey(HRS_KEY);
    // Zaman aşımı AÇIK dayatılır: exp-span kontrolleri (1d/2d/3d) JWT exp claim'i
    // bekler; ambient DB'de autoLogoutOnExpiry=false olabilir (kullanıcı kapatmış).
    // Section 5 ayrıca false'u test eder; finally AUTO_KEY'i orijinaline geri yükler.
    await systemSettingService.setFeatureFlags({ autoLogoutOnExpiry: true }, createdSessionUserId);
    const def = await readSessionDurationMinutes();
    check("1a reader default = 480 dk", def === DEFAULT_SESSION_DURATION_MINUTES, `got ${def}`);

    const flagsDef = (await systemSettingService.getFeatureFlags()).data;
    check("1b FeatureFlags.sessionDurationMinutes = 480", flagsDef.sessionDurationMinutes === 480, `got ${flagsDef.sessionDurationMinutes}`);
    check("1c FeatureFlags.sessionDurationHours = 8 (compat)", flagsDef.sessionDurationHours === 8, `got ${flagsDef.sessionDurationHours}`);

    const defSpan = await loginExpSpan();
    check("1d default login exp-iat ≈ 480×60", Math.abs(defSpan - 480 * 60) <= 2, `got ${defSpan}s`);

    // --- 2. Dakika ayarı persist + JWT yansıtır (123 dk) ---
    await systemSettingService.setFeatureFlags({ sessionDurationMinutes: 123 }, createdSessionUserId);
    const persisted = await readSessionDurationMinutes();
    check("2a reader 123 dk persist etti", persisted === 123, `got ${persisted}`);

    const flags123 = (await systemSettingService.getFeatureFlags()).data;
    check("2b FeatureFlags.sessionDurationMinutes = 123", flags123.sessionDurationMinutes === 123, `got ${flags123.sessionDurationMinutes}`);
    // round(123/60) = round(2.05) = 2
    check("2c FeatureFlags.sessionDurationHours = 2 (türev)", flags123.sessionDurationHours === 2, `got ${flags123.sessionDurationHours}`);

    const span123 = await loginExpSpan();
    check("2d login exp-iat ≈ 123×60 = 7380s", Math.abs(span123 - 123 * 60) <= 2, `got ${span123}s`);

    // --- 3. Geriye-uyum: yalnız SAAT ayarı varken minutes = hours×60 ---
    await clearKey(MIN_KEY);
    await rawSet(HRS_KEY, 5, createdSessionUserId);
    const fallback = await readSessionDurationMinutes();
    check("3a fallback: yalnız hours=5 → 300 dk", fallback === 300, `got ${fallback}`);

    const flagsFb = (await systemSettingService.getFeatureFlags()).data;
    check("3b FeatureFlags.sessionDurationMinutes = 300 (fallback)", flagsFb.sessionDurationMinutes === 300, `got ${flagsFb.sessionDurationMinutes}`);
    check("3c FeatureFlags.sessionDurationHours = 5", flagsFb.sessionDurationHours === 5, `got ${flagsFb.sessionDurationHours}`);

    const spanFb = await loginExpSpan();
    check("3d fallback login exp-iat ≈ 300×60 = 18000s", Math.abs(spanFb - 300 * 60) <= 2, `got ${spanFb}s`);

    // Dakika ayarı VARSA saat ayarı yok sayılır (öncelik dakika).
    await rawSet(MIN_KEY, 45, createdSessionUserId); // hours hâlâ 5
    const prio = await readSessionDurationMinutes();
    check("3e dakika ayarı saat ayarını EZER (45, 300 değil)", prio === 45, `got ${prio}`);

    // --- 4. Doğrulama (Türkçe AppError.badRequest) ---
    const expectReject = async (v: number, label: string) => {
      try {
        await systemSettingService.setFeatureFlags({ sessionDurationMinutes: v }, createdSessionUserId);
        check(label, false, "reddedilmedi");
      } catch (e) {
        check(label, e instanceof Error && /dakika/i.test((e as Error).message), (e as Error).message);
      }
    };
    await expectReject(0, "4a 0 dk reddedilir");
    await expectReject(43201, "4b 43201 dk reddedilir");
    await expectReject(1.5, "4c ondalık reddedilir");

    // 43200 (30 gün tavanı) kabul edilir.
    await systemSettingService.setFeatureFlags({ sessionDurationMinutes: 43200 }, createdSessionUserId);
    const maxOk = await readSessionDurationMinutes();
    check("4d 43200 dk kabul edilir (tavan)", maxOk === 43200, `got ${maxOk}`);

    // --- 5. Zaman aşımı KAPALI → Part A "mutlak oturum tavanı" devreye girer ---
    // Zaman aşımı kapalıyken token artık SÜRESİZ DEĞİL: auth.absoluteSessionCapDays
    // (default 30 gün) exp/expiresAt tavanını koyar. cap=0 → gerçekten süresiz.
    check(
      "5-pre default cap = 30 gün",
      DEFAULT_ABSOLUTE_SESSION_CAP_DAYS === 30 && (await readAbsoluteSessionCapDays()) === 30,
    );
    await systemSettingService.setFeatureFlags({ autoLogoutOnExpiry: false }, createdSessionUserId);
    const decodedCap = await loginDecode();
    const capSpan = typeof decodedCap.exp === "number" ? decodedCap.exp - (decodedCap.iat ?? 0) : NaN;
    const capExpectSec = 30 * 24 * 60 * 60;
    check(
      "5a zaman aşımı kapalı + cap=30 → JWT exp VAR (≈30 gün)",
      typeof decodedCap.exp === "number" && Math.abs(capSpan - capExpectSec) < 120,
      `span=${capSpan}s (beklenen ~${capExpectSec}s)`,
    );
    const sessCap = await prisma.session.findFirst({
      where: { userId: createdSessionUserId },
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true },
    });
    const capMsSpan = sessCap ? sessCap.expiresAt.getTime() - Date.now() : NaN;
    check(
      "5b session expiresAt ≈ 30 gün (tavan)",
      !!sessCap && Math.abs(capMsSpan - capExpectSec * 1000) < 5 * 60 * 1000,
      sessCap ? sessCap.expiresAt.toISOString() : "session yok",
    );

    // 5c/5d: cap=0 → gerçekten süresiz (exp yok, expiresAt uzak gelecek) — eski davranış.
    await systemSettingService.setFeatureFlags({ absoluteSessionCapDays: 0 }, createdSessionUserId);
    const decodedOff = await loginDecode();
    check("5c zaman aşımı kapalı + cap=0 → JWT exp claim YOK", decodedOff.exp === undefined, `exp=${decodedOff.exp}`);
    const sessOff = await prisma.session.findFirst({
      where: { userId: createdSessionUserId },
      orderBy: { createdAt: "desc" },
      select: { expiresAt: true },
    });
    check(
      "5d cap=0 → session expiresAt uzak gelecek (>1 yıl)",
      !!sessOff && sessOff.expiresAt.getTime() - Date.now() > 365 * 24 * 60 * 60 * 1000,
      sessOff ? sessOff.expiresAt.toISOString() : "session yok",
    );
    // Cap'i default'a döndür (sonraki bölüm + restore hijyeni).
    await systemSettingService.setFeatureFlags(
      { absoluteSessionCapDays: DEFAULT_ABSOLUTE_SESSION_CAP_DAYS },
      createdSessionUserId,
    );

    // --- 6. Tekrar AÇ → exp geri gelir ---
    await systemSettingService.setFeatureFlags({ autoLogoutOnExpiry: true }, createdSessionUserId);
    const decodedOn = await loginDecode();
    check("6a zaman aşımı açık → JWT exp claim VAR", typeof decodedOn.exp === "number", `exp=${decodedOn.exp}`);
  } finally {
    // Oturum kayıtları + audit log + TEST user temizliği (FK sırası: sessions/logs → user).
    await prisma.session.deleteMany({ where: { userId: createdSessionUserId } });
    await prisma.systemLog.deleteMany({ where: { userId: createdSessionUserId } });
    // Ayarları eski haline getir (test yarattıysa sil, vardıysa value+updatedById geri yaz —
    // updatedById restore edilmezse satır TEST user'a bağlı kalır ve user silinemez).
    for (const k of [MIN_KEY, HRS_KEY, AUTO_KEY, CAP_KEY]) {
      const orig = originals.get(k);
      if (orig === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key: k } });
      } else {
        await prisma.systemSetting.upsert({
          where: { key: k },
          create: { key: k, value: orig.value as Prisma.InputJsonValue, updatedById: orig.updatedById },
          update: { value: orig.value as Prisma.InputJsonValue, updatedById: orig.updatedById },
        });
      }
    }
    invalidateFeatureFlagsCache();
    await prisma.user.deleteMany({ where: { id: createdSessionUserId } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
