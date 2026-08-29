// =============================================================================
// Test: Süreli izinler (Part C) — validUntil pencereli yetki + oturum tavanı etkisi
// Çalıştır: npx tsx scripts/test_timed_permissions.ts
// Doğrulananlar:
//   1. setUserPermissions {permissionId, validUntil} tarihi DB'ye yazar.
//   2. getEffectivePermissions gelecekteki validUntil'i AKTİF sayar.
//   3. issueToken exp = min(cap tabanı, EN YAKIN gelecekteki validUntil):
//      cap=30 gün iken 2-gün-sonra biten izin → token exp ≈ 2 gün.
//   4. cap=0 (gerçekten süresiz) olsa bile nearest validUntil exp'i kırpar.
//   5. GEÇMİŞ validUntil → getEffectivePermissions izni HARİÇ tutar
//      (grant tokenVersion++ ile re-login zorlar → süre bitince oturum ölür).
//   6. Geçmiş/nearest yoksa exp = cap tabanına döner.
//   7. Herhangi bir tarih değişimi tokenVersion++ tetikler (anında re-login).
//   8. validUntil=null (süresiz izin) → izin aktif + token exp = cap.
// İzolasyon: dedicated TEST kullanıcısı; auth.absoluteSessionCapDays /
// auth.autoLogoutOnExpiry snapshot alınıp finally'de aynen geri yüklenir.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv → JWT_SECRET/DATABASE_URL
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { AuthService } from "../src/services/auth.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { systemSettingService, SETTING_KEYS } from "../src/services/system-setting.service";

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
const DAY = 24 * 60 * 60; // saniye
function spanOf(token: string, secret: string): number | undefined {
  const d = jwt.verify(token, secret) as { iat: number; exp?: number };
  return d.exp === undefined ? undefined : d.exp - d.iat;
}
async function tokenVersionOf(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  return need(u, "user").tokenVersion;
}

const AUTO_KEY = SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY;
const CAP_KEY = SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS;

async function main() {
  const ts = Date.now();
  const secret = need(process.env.JWT_SECRET, "JWT_SECRET (.env)");
  const username = `TEST-tp-${ts}`;
  const password = "test123";

  // Master-data yetkileri business-key ile çöz (hardcoded UUID YASAK).
  const permA = need(
    await prisma.permission.findUnique({ where: { code: "roll:read" }, select: { id: true, code: true } }),
    "permission roll:read",
  );

  // Dokunulan ayarları snapshot al (finally'de aynen geri yüklenir).
  const savedKeys = [AUTO_KEY, CAP_KEY] as const;
  const saved: Record<string, Prisma.JsonValue | undefined> = {};
  for (const k of savedKeys) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    saved[k] = row ? row.value : undefined;
  }

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(password),
      fullName: "TEST Süreli İzin",
    },
    select: { id: true },
  });
  const uid = user.id;
  // ⚠️ AKTÖR ≠ HEDEF olmalı (2026-08-29 / T2-013): kendi yetkisini genişletmek
  // artık 409 SELF_ESCALATION veriyor ve bu testin konusu SÜRE alanları, aktör
  // kimliği değil. Gerçek kullanımda da yetkiyi başka bir yönetici verir.
  const AKTOR = (await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }))?.id;

  try {
    // Baseline: zaman aşımı KAPALI + cap=30 gün → Part C etkileşimi deterministik.
    await systemSettingService.setFeatureFlags(
      { autoLogoutOnExpiry: false, absoluteSessionCapDays: 30 },
      uid,
    );

    // --- 1. setUserPermissions validUntil'i DB'ye yazar ---
    const in2d = new Date(ts + 2 * DAY * 1000);
    await PermissionManagementService.setUserPermissions(uid, [{ permissionId: permA.id, validUntil: in2d }], AKTOR);
    const rowA = await prisma.userPermission.findFirst({
      where: { userId: uid, permissionId: permA.id },
      select: { validUntil: true },
    });
    check(
      "1 setUserPermissions validUntil DB'ye yazıldı",
      rowA?.validUntil?.getTime() === in2d.getTime(),
      rowA?.validUntil?.toISOString() ?? "yok",
    );

    // --- 2. getEffectivePermissions gelecekteki validUntil'i AKTİF sayar ---
    const eff1 = await AuthService.getEffectivePermissions(uid);
    check("2 gelecekteki validUntil → izin AKTİF", eff1.includes(permA.code));

    // --- 3. issueToken exp = min(cap=30gün, nearest=2gün) → 2 gün ---
    const span3 = spanOf((await AuthService.login(username, password)).token, secret);
    check(
      "3 token exp ≈ 2 gün (nearest validUntil < cap)",
      span3 !== undefined && Math.abs(span3 - 2 * DAY) < 300,
      `span=${span3}s`,
    );

    // --- 4. cap=0 (süresiz) bile olsa nearest validUntil exp'i kırpar ---
    await systemSettingService.setFeatureFlags({ absoluteSessionCapDays: 0 }, AKTOR);
    const span4 = spanOf((await AuthService.login(username, password)).token, secret);
    check(
      "4 cap=0 süresiz olsa da exp = nearest validUntil (2 gün)",
      span4 !== undefined && Math.abs(span4 - 2 * DAY) < 300,
      `span=${span4}s`,
    );
    await systemSettingService.setFeatureFlags({ absoluteSessionCapDays: 30 }, AKTOR);

    // --- 5. GEÇMİŞ validUntil → getEffectivePermissions izni HARİÇ tutar ---
    const past = new Date(ts - 60 * 1000);
    await PermissionManagementService.setUserPermissions(uid, [{ permissionId: permA.id, validUntil: past }], AKTOR);
    const eff2 = await AuthService.getEffectivePermissions(uid);
    check("5 süresi geçmiş izin → re-login'de HARİÇ (oturum ölür)", !eff2.includes(permA.code));

    // --- 6. nearest yok (hepsi geçmiş) → exp cap tabanına (30 gün) döner ---
    const span6 = spanOf((await AuthService.login(username, password)).token, secret);
    check(
      "6 geçmiş validUntil → nearest yok → exp = cap (30 gün)",
      span6 !== undefined && Math.abs(span6 - 30 * DAY) < 300,
      `span=${span6}s`,
    );

    // --- 7. tarih değişimi tokenVersion++ (anında re-login) ---
    const tvBefore = await tokenVersionOf(uid);
    await PermissionManagementService.setUserPermissions(
      uid,
      [{ permissionId: permA.id, validUntil: new Date(ts + 5 * DAY * 1000) }],
      uid,
    );
    const tvAfter = await tokenVersionOf(uid);
    check("7 süre değişimi tokenVersion++", tvAfter === tvBefore + 1, `${tvBefore}→${tvAfter}`);

    // --- 8. validUntil=null (süresiz izin) → izin aktif + exp = cap ---
    await PermissionManagementService.setUserPermissions(uid, [{ permissionId: permA.id, validUntil: null }], AKTOR);
    const eff3 = await AuthService.getEffectivePermissions(uid);
    const rowNull = await prisma.userPermission.findFirst({
      where: { userId: uid, permissionId: permA.id },
      select: { validUntil: true },
    });
    const span8 = spanOf((await AuthService.login(username, password)).token, secret);
    check(
      "8 validUntil=null → izin aktif + tarih temizlendi + exp = cap",
      eff3.includes(permA.code) &&
        rowNull?.validUntil === null &&
        span8 !== undefined &&
        Math.abs(span8 - 30 * DAY) < 300,
      `validUntil=${rowNull?.validUntil}, span=${span8}s`,
    );
  } finally {
    // Ayarları restore et (yoktu → sil; vardı → değeri geri yaz).
    for (const k of savedKeys) {
      const v = saved[k];
      if (v === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
      } else {
        await prisma.systemSetting
          .upsert({ where: { key: k }, create: { key: k, value: v as never, updatedById: uid }, update: { value: v as never } })
          .catch(() => {});
      }
    }
    // FK sırası: sessions → user_permissions → system_logs → user.
    await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.userPermission.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: uid } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: uid } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
