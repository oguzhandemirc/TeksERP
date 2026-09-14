// =============================================================================
// P2 auth-rbac bucket testi — F49 (release semantics) + F253/F254 (son-admin
// efektif-pencere guard'ı).  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_auth.ts
// HTTP yok; modül + prisma doğrudan. Seed admin GEÇİCİ pasifleştirilir (F254'ün
// efektif penceresini seed admin maskelememesi için) ve finally'de RESTORE edilir.
// =============================================================================

import prisma from "../src/lib/prisma";
import {
  reserveLoginAttempt,
  resetLoginLockout,
  releaseLoginAttempt,
} from "../src/middlewares/login-lockout";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { AppError } from "../src/utils/app-error";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectConflict(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; }
  catch (e) { return e instanceof AppError && e.statusCode === 409; }
}

const ADMIN_WINDOW = (now: Date) => ({
  permission: { code: { in: ["admin:users", "admin:*"] } },
  AND: [
    { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
    { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
  ],
});

async function main(): Promise<void> {
  const ts = Date.now();
  const past = new Date(Date.now() - 86_400_000); // dün
  const future = new Date(Date.now() + 86_400_000); // yarın

  // ⚠️ BAYRAK YAZIMI, TÜKETİCİLERİ ve TEMİZLİĞİ AYNI `try/finally` içinde.
  // Bayrak `try`dan ÖNCE yazılıp düz akışta TÜKETİLİYORDU (kilitlenme denemeleri), yani
  // yazımı aşağı almak testin ÖNKOŞULUNU bozardı — çözüm try'ı YUKARI taşımak.
  // Eski hâlde temizlik main'in SONUNDAYDI: aradaki herhangi bir hata bayrağı SIZDIRIR ve
  // sızan bayrak KOMŞU bekçiyi kırar (2026-09-14 sınıfı).
  // ⚠️ KORUYAN TRY = BU. İçerideki `try/finally` seed admin'leri geri alır, bayrağı DEĞİL.
  let userA: { id: string } | null = null;
  let userB: { id: string } | null = null;
  try {
    // ---------------------------------------------------------------------------
    // F49: releaseLoginAttempt — assume-fail'i TEK adım düşer; birikmiş fails'i silmez.
    // ---------------------------------------------------------------------------
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED },
      create: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, value: true },
      update: { value: true },
    });
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS },
      create: { key: SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, value: 5 },
      update: { value: 5 },
    });
    invalidateFeatureFlagsCache();

    const rk = `rel-${ts}`;
    // 4 reserve (fails=4), sonra release (fails=3): eşiğe ulaşmak 2 reserve daha ister.
    for (let i = 0; i < 4; i++) await reserveLoginAttempt(rk);
    releaseLoginAttempt(rk);
    const r5 = await reserveLoginAttempt(rk); // fails 3→4
    const r6 = await reserveLoginAttempt(rk); // fails 4→5 (eşik, blok kurulur, yine false)
    const r7 = await reserveLoginAttempt(rk); // bloklu
    check("F49: release sonrası eşik +1 denemeye ötelendi (r5,r6 serbest; r7 bloklu)",
      !r5.blocked && !r6.blocked && r7.blocked, `r5=${r5.blocked} r6=${r6.blocked} r7=${r7.blocked}`);
    resetLoginLockout(rk);

    // ---------------------------------------------------------------------------
    // F253/F254: son-admin efektif-pencere guard'ı. Seed admin'i geçici pasifle.
    // ---------------------------------------------------------------------------
    const now = new Date();
    const seedAdmins = await prisma.user.findMany({
      where: { isActive: true, permissions: { some: ADMIN_WINDOW(now) } },
      select: { id: true },
    });
    const adminPerm = await prisma.permission.findUnique({
      where: { code: "admin:users" }, select: { id: true },
    });
    if (!adminPerm) throw new Error("admin:users permission seed'de yok");

    userA = await prisma.user.create({
      data: { username: `TEST-adminA-${ts}`, passwordHash: await AuthService.hashPassword("test123"), fullName: "TEST AdminA" },
      select: { id: true },
    });
    userB = await prisma.user.create({
      data: { username: `TEST-adminB-${ts}`, passwordHash: await AuthService.hashPassword("test123"), fullName: "TEST AdminB" },
      select: { id: true },
    });
    // userA: geçerli admin:users (dates null). userB: SÜRESİ GEÇMİŞ admin:users.
    await prisma.userPermission.create({ data: { userId: userA!.id, permissionId: adminPerm.id } });
    await prisma.userPermission.create({ data: { userId: userB!.id, permissionId: adminPerm.id, validFrom: past, validUntil: past } });

    const actor = seedAdmins[0]?.id; // pasifleşmeden önce alınmış id (self-deactivation guard için ≠ userA)

    try {
      // Seed admin'leri GEÇİCİ pasifle → userA tek EFEKTİF admin (userB expired).
      await prisma.user.updateMany({ where: { id: { in: seedAdmins.map((s) => s.id) } }, data: { isActive: false } });

      // F254: userA'yı pasife almak SON efektif admin olduğundan bloklanmalı
      // (userB'nin süresi geçmiş grant'ı 'aktif admin' SAYILMAZ).
      const blocked254 = await expectConflict(() => PermissionManagementService.deactivateUser(userA!.id, actor));
      check("F254: son efektif admin pasife alınamaz (expired yedek sayılmaz)", blocked254);

      // F253: userA'nın admin:users iznini revoke etmek de bloklanmalı (başka efektif admin yok).
      const blocked253 = await expectConflict(() => PermissionManagementService.revokePermission(userA!.id, adminPerm.id, actor));
      check("F253: son admin:users revoke ile sökülemez", blocked253);

      // userB grant'ını GEÇERLİ yap → artık başka efektif admin var → userA serbest bırakılabilir.
      await prisma.userPermission.updateMany({
        where: { userId: userB!.id, permissionId: adminPerm.id },
        data: { validFrom: null, validUntil: future },
      });
      let allowed = false;
      try { await PermissionManagementService.revokePermission(userA!.id, adminPerm.id, actor); allowed = true; }
      catch { allowed = false; }
      check("F253: başka efektif admin (userB) varken revoke serbest", allowed);
    } finally {
      // Seed admin'leri MUTLAKA geri getir.
      await prisma.user.updateMany({ where: { id: { in: seedAdmins.map((s) => s.id) } }, data: { isActive: true } }).catch(() => {});
    }

  } finally {
    // Cleanup
    await prisma.userPermission.deleteMany({ where: { userId: { in: [userA?.id, userB?.id].filter((x): x is string => !!x) } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: { in: [userA?.id, userB?.id].filter((x): x is string => !!x) } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userA?.id, userB?.id].filter((x): x is string => !!x) } } }).catch(() => {});
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS] } },
    }).catch(() => {});
    invalidateFeatureFlagsCache();
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    // Güvenlik ağı: seed admin restore (main içinde finally kaçırırsa).
    await prisma.$disconnect();
    process.exit(1);
  });
