// =============================================================================
// Test: Login + erişim kuralı (şifre / clientType erişim / token exp / oturum kaydı)
// Çalıştır: npx tsx scripts/test_login_access.ts
// Doğrulananlar:
//   1) Şifre girişi (list): doğru şifre → token (payload permissions/jti/tokenVersion);
//      yanlış şifre 401; pasif kullanıcı reddedilir; var olmayan kullanıcı 401.
//   2) clientType="electron" ERİŞİM KURALI (bu turda eklenen YENİ kural):
//      (a) yalnız mobil izinli (mobile:kk1) → 403 + token/oturum ÜRETİLMEZ (session yok),
//      (b) admin:* → başarılı, (c) masaüstü (report:production)+mobil karışık → başarılı.
//   3) clientType="mobile": yalnız mobil izinli → başarılı (mobil serbest);
//      default clientType (yok) → mobile gibi davranır (yalnız-mobil başarılı).
//   4) Token exp: autoLogoutOnExpiry AÇIK → JWT exp var (~dakika×60); KAPALI → exp YOK.
//   5) Oturum kaydı: başarılı login'de session tablosunda jti ile satır açılır.
// İzolasyon: dedicated TEST kullanıcıları; ayarlar test içinde set + finally'de restore.
// quickPin/card 403-when-disabled BURADA TEKRARLANMAZ (test_card_login/test_login_methods).
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv → JWT_SECRET/DATABASE_URL
import jwt from "jsonwebtoken";
import { AuthService } from "../src/services/auth.service";
import { systemSettingService, SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";
import type { Prisma } from "@prisma/client";

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

/** fn AppError fırlatmalı: statusCode (+ opsiyonel mesaj parçası) eşleşmeli. */
async function expectStatus(
  label: string,
  code: number,
  fn: () => Promise<unknown>,
  msgPart?: string,
) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu, dönüş geldi");
  } catch (e) {
    const ae = e instanceof AppError ? e : null;
    const ok = ae?.statusCode === code && (!msgPart || ae.message.includes(msgPart));
    check(label, ok, ae ? `${ae.statusCode} ${ae.message}` : `AppError değil: ${String(e)}`);
  }
}

const PW = "sifre123";

function decodeJwt(token: string) {
  return jwt.decode(token) as
    | { exp?: number; iat?: number; permissions?: unknown; jti?: string }
    | null;
}

async function main() {
  const ts = Date.now();
  const admin = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı (npm run seed)",
  );

  const createdUserIds: string[] = [];
  const mkUser = async (tag: string, opts: { isActive?: boolean } = {}) => {
    const u = await prisma.user.create({
      data: {
        username: `TEST-acc-${tag}-${ts}`,
        passwordHash: await AuthService.hashPassword(PW),
        fullName: `TEST Erişim ${tag}`,
        isActive: opts.isActive ?? true,
      },
      select: { id: true, username: true, tokenVersion: true },
    });
    createdUserIds.push(u.id);
    return u;
  };
  const grant = async (userId: string, code: string) => {
    const perm = need(
      await prisma.permission.findUnique({ where: { code }, select: { id: true } }),
      `permission ${code} (seed)`,
    );
    await prisma.userPermission.create({ data: { userId, permissionId: perm.id } });
  };

  // --- Ayarları sakla (finally'de restore) — ambient DB değerine güvenme. ---
  const savedKeys = [
    SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
    SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY,
    SETTING_KEYS.AUTH_SESSION_DURATION_MINUTES,
  ] as const;
  const saved: Record<string, Prisma.JsonValue | undefined> = {};
  for (const k of savedKeys) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    saved[k] = row ? row.value : undefined; // undefined = satır yoktu
  }

  try {
    // Çoklu login'de kick/notify sürprizi olmasın → 'off' (serbest çoklu oturum).
    await systemSettingService.setFeatureFlags({ sameTypeSessionPolicy: "off" }, admin.id);

    // =====================================================================
    // 1) Şifre girişi (list)
    // =====================================================================
    const uList = await mkUser("list");
    await grant(uList.id, "report:production");

    const ok1 = await AuthService.login(uList.username, PW); // ctx yok → mobile (serbest)
    check("1a doğru şifre → token döner", typeof ok1.token === "string" && ok1.token.length > 20);
    check(
      "1b payload permissions dizi + report:production içerir",
      Array.isArray(ok1.user.permissions) && ok1.user.permissions.includes("report:production"),
      JSON.stringify(ok1.user.permissions),
    );
    check("1c payload jti string", typeof ok1.user.jti === "string" && ok1.user.jti.length > 0);
    check("1d payload tokenVersion number", typeof ok1.user.tokenVersion === "number");
    check("1e payload userId doğru kullanıcı", ok1.user.userId === uList.id);

    await expectStatus(
      "1f yanlış şifre → 401",
      401,
      () => AuthService.login(uList.username, "yanlis-sifre"),
      "Geçersiz",
    );

    const uPassive = await mkUser("passive", { isActive: false });
    await expectStatus(
      "1g pasif kullanıcı (isActive=false) → 401 reddedilir",
      401,
      () => AuthService.login(uPassive.username, PW),
      "Geçersiz",
    );

    await expectStatus(
      "1h var olmayan kullanıcı → 401",
      401,
      () => AuthService.login(`TEST-yok-${ts}-xyz`, PW),
      "Geçersiz",
    );

    // =====================================================================
    // 2) clientType="electron" ERİŞİM KURALI
    // =====================================================================
    // (a) yalnız mobil izinli → 403 + token/oturum ÜRETİLMEZ.
    const u2a = await mkUser("mobonly-electron");
    await grant(u2a.id, "mobile:kk1");
    await expectStatus(
      "2a yalnız-mobil kullanıcı electron → 403 forbidden",
      403,
      () => AuthService.login(u2a.username, PW, { clientType: "electron" }),
      "masaüstü",
    );
    const sess2a = await prisma.session.count({ where: { userId: u2a.id } });
    check("2a-2 token/oturum ÜRETİLMEZ (session satırı açılmadı)", sess2a === 0, `session sayısı=${sess2a}`);

    // (b) admin:* → başarılı.
    const u2b = await mkUser("adminstar");
    await grant(u2b.id, "admin:*");
    const ok2b = await AuthService.login(u2b.username, PW, { clientType: "electron" });
    check("2b admin:* electron → başarılı (token)", !!ok2b.token && ok2b.user.userId === u2b.id);

    // (c) masaüstü izni + mobil izin karışık → başarılı.
    const u2c = await mkUser("mixed");
    await grant(u2c.id, "report:production");
    await grant(u2c.id, "mobile:kk1");
    const ok2c = await AuthService.login(u2c.username, PW, { clientType: "electron" });
    check(
      "2c masaüstü+mobil karışık electron → başarılı",
      !!ok2c.token && ok2c.user.userId === u2c.id,
    );

    // =====================================================================
    // 3) clientType="mobile" + default clientType
    // =====================================================================
    const u3 = await mkUser("mobonly-mobile");
    await grant(u3.id, "mobile:kk1");
    const ok3 = await AuthService.login(u3.username, PW, { clientType: "mobile" });
    check("3a yalnız-mobil kullanıcı mobile → başarılı (mobil serbest)", !!ok3.token && ok3.user.userId === u3.id);
    const ok3def = await AuthService.login(u3.username, PW); // clientType yok
    check("3b default clientType (yok) → mobile gibi, yalnız-mobil başarılı", !!ok3def.token && ok3def.user.userId === u3.id);

    // =====================================================================
    // 4) Token exp — autoLogoutOnExpiry AÇIK/KAPALI
    // =====================================================================
    const EXP_MIN = 120; // bilinen değer set et → deterministik exp kontrolü
    await systemSettingService.setFeatureFlags(
      { autoLogoutOnExpiry: true, sessionDurationMinutes: EXP_MIN },
      admin.id,
    );
    const expOn = await AuthService.login(uList.username, PW);
    const decOn = need(decodeJwt(expOn.token), "decode(expOn)");
    check("4a autoLogout AÇIK → JWT exp claim VAR", typeof decOn.exp === "number");
    const span = (decOn.exp ?? 0) - (decOn.iat ?? 0);
    check(
      "4b exp ≈ dakika×60 (120dk → 7200sn)",
      Math.abs(span - EXP_MIN * 60) <= 2,
      `exp-iat=${span}sn`,
    );

    await systemSettingService.setFeatureFlags({ autoLogoutOnExpiry: false }, admin.id);
    const expOff = await AuthService.login(uList.username, PW);
    const decOff = need(decodeJwt(expOff.token), "decode(expOff)");
    check("4c autoLogout KAPALI → JWT exp claim YOK", decOff.exp === undefined, `exp=${String(decOff.exp)}`);

    // =====================================================================
    // 5) Oturum kaydı — başarılı login'de jti ile session satırı açılır
    // =====================================================================
    const ok5 = await AuthService.login(uList.username, PW);
    const jti = ok5.user.jti;
    const sessRow = await prisma.session.findUnique({
      where: { jti },
      select: { jti: true, userId: true, revokedAt: true },
    });
    check("5a login sonrası session satırı jti ile açık", !!sessRow, `jti=${jti}`);
    check("5b session.userId doğru kullanıcı", sessRow?.userId === uList.id);
    check("5c yeni session revoke edilmemiş (revokedAt null)", sessRow?.revokedAt == null);
  } finally {
    // Ayarları restore et
    for (const k of savedKeys) {
      const v = saved[k];
      if (v === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
      } else {
        await prisma.systemSetting
          .upsert({
            where: { key: k },
            create: { key: k, value: v as never, updatedById: admin.id },
            update: { value: v as never },
          })
          .catch(() => {});
      }
    }
    // FK Restrict sırası: sessions → user_permissions (Cascade ama açık sil) → users.
    if (createdUserIds.length) {
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.userPermission.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
    }
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
