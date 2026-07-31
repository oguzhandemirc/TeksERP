// =============================================================================
// Test: Son-admin guard yarışı (A1 — 2026-07-31 veri bütünlüğü denetimi)
// Çalıştır: npx tsx scripts/test_admin_guard_race.ts
// Doğrulananlar:
//   1. Sıralı: son aktif efektif admin pasifleştirilemez (409)
//   2. Yarış: tam 2 aktif admin ÇAPRAZ eşzamanlı pasifleştirmede TAM BİRİ geçer,
//      diğeri 409 alır ve sistemde ≥1 aktif efektif admin kalır (advisory-lock tx)
//   3. deleteUser aynı guard'dan geçer (son admin silinemez)
//
// NOT: Guard GLOBAL sayım yapar → test, TEST-dışı aktif admin'leri geçici
// pasifleştirir ve finally'de YALNIZ isActive bayrağını birebir geri yükler.
// Yarıda kesilirse: finally koşmazsa admin'ler pasif kalabilir — dev/CI DB'de
// kabul edilebilir; üretimde bu script koşulmaz.
// =============================================================================
import prisma from "../src/lib/prisma";
import { PermissionManagementService } from "../src/services/permission-management.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const STAMP = Date.now().toString(36);
const ADMIN_CODES = ["admin:users", "admin:*"];

function effectiveAdminWhere(now: Date) {
  return {
    permission: { code: { in: ADMIN_CODES } },
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    ],
  } as const;
}

async function countActiveEffectiveAdmins(): Promise<number> {
  return prisma.user.count({
    where: { isActive: true, permissions: { some: effectiveAdminWhere(new Date()) } },
  });
}

async function isConflict(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return status === 409;
  }
}

async function main() {
  const madeUserIds: string[] = [];
  const suspendedAdminIds: string[] = [];

  try {
    const adminPerm = await prisma.permission.findFirst({
      where: { code: "admin:users" },
      select: { id: true },
    });
    if (!adminPerm) throw new Error("admin:users permission kaydı yok (seed eksik?)");

    // İki TEST admin kullanıcısı (tarihsiz = her zaman efektif grant)
    const mk = (n: number) =>
      prisma.user.create({
        data: {
          username: `testadmrace${n}${STAMP}`.slice(0, 50),
          fullName: `TEST Admin Race ${n}`,
          passwordHash: "$2a$10$testtesttesttesttesttestteAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          isActive: true,
          permissions: { create: [{ permissionId: adminPerm.id }] },
        },
        select: { id: true },
      });
    const [ua, ub] = [await mk(1), await mk(2)];
    madeUserIds.push(ua.id, ub.id);

    // TEST-dışı aktif efektif admin'leri geçici pasifle (guard'ı izole et)
    const others = await prisma.user.findMany({
      where: {
        id: { notIn: madeUserIds },
        isActive: true,
        permissions: { some: effectiveAdminWhere(new Date()) },
      },
      select: { id: true },
    });
    suspendedAdminIds.push(...others.map((o) => o.id));
    if (suspendedAdminIds.length) {
      await prisma.user.updateMany({
        where: { id: { in: suspendedAdminIds } },
        data: { isActive: false },
      });
    }
    check("fixture: yalnız 2 TEST admin aktif", (await countActiveEffectiveAdmins()) === 2);

    // --- 1) Sıralı guard ---
    await PermissionManagementService.deactivateUser(ua.id, undefined);
    check("sıralı: ilk pasifleştirme geçer (diğeri hâlâ aktif)", true);
    check(
      "sıralı: SON admin pasifleştirilemez (409)",
      await isConflict(PermissionManagementService.deactivateUser(ub.id, undefined)),
    );
    check("sıralı: aktif admin 1 kaldı", (await countActiveEffectiveAdmins()) === 1);
    await prisma.user.update({ where: { id: ua.id }, data: { isActive: true } });

    // --- 2) Çapraz yarış ---
    const results = await Promise.allSettled([
      PermissionManagementService.deactivateUser(ua.id, undefined),
      PermissionManagementService.deactivateUser(ub.id, undefined),
    ]);
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const conflictCount = results.filter(
      (r) => r.status === "rejected" &&
        (r.reason as { statusCode?: number }).statusCode === 409,
    ).length;
    check("yarış: tam biri geçti", okCount === 1, `okCount=${okCount}`);
    check("yarış: diğeri 409 aldı", conflictCount === 1, `conflictCount=${conflictCount}`);
    const remaining = await countActiveEffectiveAdmins();
    check("yarış: sistem yöneticisiz KALMADI (aktif admin ≥ 1)", remaining >= 1, `kalan=${remaining}`);

    // --- 3) deleteUser aynı guard'dan geçer ---
    // Yarıştan tek aktif admin kaldı — onu bul, silmeyi dene → 409.
    const active = await prisma.user.findFirst({
      where: { id: { in: madeUserIds }, isActive: true },
      select: { id: true },
    });
    check("fixture: yarıştan tek aktif TEST admin kaldı", !!active);
    if (active) {
      check(
        "deleteUser: son aktif admin silinemez (409)",
        await isConflict(PermissionManagementService.deleteUser(active.id, undefined)),
      );
    }
  } finally {
    if (suspendedAdminIds.length) {
      await prisma.user
        .updateMany({ where: { id: { in: suspendedAdminIds } }, data: { isActive: true } })
        .catch(() => {});
    }
    await prisma.userPermission.deleteMany({ where: { userId: { in: madeUserIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: { in: madeUserIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
