// =============================================================================
// Test: Yeni kullanıcı varsayılan üretim izinleri (createUser)
// Çalıştır: npx tsx scripts/test_user_default_perms.ts
// Doğrulananlar:
//   1. grantOperatorDefaults verilmezse (default) → KK1/KK2/Tambur izinleri gelir
//   2. grantOperatorDefaults=true → aynı üç izin
//   3. grantOperatorDefaults=false → sıfır izin (web/admin kullanıcısı)
//   4. verilen izinler TAM olarak üç üretim izni (fazlası yok)
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  PermissionManagementService,
  DEFAULT_OPERATOR_PERMISSION_CODES,
} from "../src/services/permission-management.service";
import { AuthService } from "../src/services/auth.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function permsOf(userId: string): Promise<Set<string>> {
  return new Set(await AuthService.getEffectivePermissions(userId));
}

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcısı yok (npm run seed)");

  const expected = new Set<string>(DEFAULT_OPERATOR_PERMISSION_CODES);
  const created: string[] = [];

  try {
    // 1) default (bayrak yok) → üretim izinleri
    const u1 = await PermissionManagementService.createUser(
      { username: `test-perm-def-${ts}`, fullName: "TEST Default", password: "123456" },
      admin.id,
    );
    created.push(u1.id);
    const p1 = await permsOf(u1.id);
    check("default → 3 üretim izni geldi", DEFAULT_OPERATOR_PERMISSION_CODES.every((c) => p1.has(c)));
    check("default → TAM üç izin (fazlası yok)", p1.size === expected.size);

    // 2) grantOperatorDefaults=true → aynı
    const u2 = await PermissionManagementService.createUser(
      { username: `test-perm-on-${ts}`, fullName: "TEST On", password: "123456", grantOperatorDefaults: true },
      admin.id,
    );
    created.push(u2.id);
    const p2 = await permsOf(u2.id);
    check("grantOperatorDefaults=true → üretim izinleri", DEFAULT_OPERATOR_PERMISSION_CODES.every((c) => p2.has(c)));

    // 3) grantOperatorDefaults=false → sıfır izin
    const u3 = await PermissionManagementService.createUser(
      { username: `test-perm-off-${ts}`, fullName: "TEST Off", password: "123456", grantOperatorDefaults: false },
      admin.id,
    );
    created.push(u3.id);
    const p3 = await permsOf(u3.id);
    check("grantOperatorDefaults=false → sıfır izin (web/admin)", p3.size === 0, `size=${p3.size}`);
  } finally {
    // UserPermission cascade FK yoksa önce izinleri sil
    await prisma.userPermission.deleteMany({ where: { userId: { in: created } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
