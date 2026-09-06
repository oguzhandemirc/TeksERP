// =============================================================================
// Test: PermissionManagementService — grant/revoke/set/applyTemplate
// Çalıştır: npx tsx scripts/test_permission_management.ts
// Doğrulananlar:
//   1. grantPermission tek yetki atar (idempotent upsert)
//   2. revokePermission kaldırır
//   3. setUserPermissions hedef-state yapar (ekle+sil)
//   4. setUserPermissions geçersiz id → 400
//   5. applyTemplate merge ekler, replace değiştirir
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `permission-management.service.ts:314`
//    içindeki `toRemove` hesabı boş diziye çevrildi (hedef-state'in SİLME yarısı
//    öldürüldü, yalnız EKLEME kaldı) → İKİ kontrol KIRMIZI: "set: hedef-state
//    (öncekiler silindi)" ve "applyTemplate replace: yalnız şablon". Geri konunca
//    8/8 yeşil. Yani bekçi "replace fiilen merge'e dönüştü" sınıfını yakalıyor —
//    bu sınıf sessizdir: kullanıcı fazladan yetkiyle kalır ve kimse fark etmez.
// =============================================================================
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import { PermissionManagementService as PM } from "../src/services/permission-management.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

async function main() {
  const ts = Date.now();
  const perms = await prisma.permission.findMany({
    where: { code: { in: ["order:read", "order:write", "roll:read"] } },
    select: { id: true, code: true },
  });
  if (perms.length < 3) throw new Error("Seed izinleri eksik (npm run seed)");
  const pOrderRead = perms.find((p) => p.code === "order:read")!;
  const pOrderWrite = perms.find((p) => p.code === "order:write")!;
  const pRollRead = perms.find((p) => p.code === "roll:read")!;

  const user = await prisma.user.create({
    data: {
      username: `test-pm-${ts}`,
      fullName: "TEST PM Kullanıcı",
      passwordHash: await bcrypt.hash("test123", 10),
      isActive: true,
    },
    select: { id: true },
  });
  let templateId = "";

  const userPermCodes = async () => {
    const ups = await prisma.userPermission.findMany({
      where: { userId: user.id },
      select: { permission: { select: { code: true } } },
    });
    return ups.map((u) => u.permission.code).sort();
  };

  try {
    // 1) grant
    await PM.grantPermission(user.id, { permissionId: pOrderRead.id }, undefined);
    check("grantPermission tek yetki attı", (await userPermCodes()).includes("order:read"));
    // idempotent (ikinci grant patlamaz)
    await PM.grantPermission(user.id, { permissionId: pOrderRead.id }, undefined);
    check("grant idempotent (tek kayıt)", (await userPermCodes()).filter((c) => c === "order:read").length === 1);

    // 2) revoke
    await PM.revokePermission(user.id, pOrderRead.id, undefined);
    check("revokePermission kaldırdı", !(await userPermCodes()).includes("order:read"));

    // 3) setUserPermissions hedef-state
    await PM.setUserPermissions(user.id, [pOrderRead.id, pOrderWrite.id], undefined);
    check("set: ikisi de var", JSON.stringify(await userPermCodes()) === JSON.stringify(["order:read", "order:write"]));
    await PM.setUserPermissions(user.id, [pRollRead.id], undefined);
    check("set: hedef-state (öncekiler silindi)", JSON.stringify(await userPermCodes()) === JSON.stringify(["roll:read"]));

    // 4) geçersiz id
    await expectErr("set geçersiz id → 400", "geçersiz yetki", () =>
      PM.setUserPermissions(user.id, ["00000000-0000-0000-0000-000000000000"], undefined),
    );

    // 5) applyTemplate
    const template = await prisma.permissionTemplate.create({
      data: {
        name: `TEST PM Şablon ${ts}`,
        permissions: { create: [{ permissionId: pOrderRead.id }, { permissionId: pOrderWrite.id }] },
      },
      select: { id: true },
    });
    templateId = template.id;
    // merge: mevcut roll:read korunur + şablon eklenir
    await PM.applyTemplate(user.id, templateId, "merge", undefined);
    check(
      "applyTemplate merge: roll:read + şablon",
      JSON.stringify(await userPermCodes()) === JSON.stringify(["order:read", "order:write", "roll:read"]),
    );
    // replace: yalnız şablon
    await PM.applyTemplate(user.id, templateId, "replace", undefined);
    check(
      "applyTemplate replace: yalnız şablon",
      JSON.stringify(await userPermCodes()) === JSON.stringify(["order:read", "order:write"]),
    );
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: user.id } });
    // PermissionTemplateItem onDelete:Cascade → template silinince item'lar düşer.
    if (templateId) await prisma.permissionTemplate.delete({ where: { id: templateId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
