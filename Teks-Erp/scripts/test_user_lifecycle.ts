// =============================================================================
// Test: Kullanıcı yaşam döngüsü — pasife alınca username SERBEST kalır (aynı isim
// tekrar açılabilir), kimlikler temizlenir. Çalıştır: npx tsx scripts/test_user_lifecycle.ts
// Doğrulananlar:
//   1. createUser → aktif; deactivateUser → isActive false + username "del_XXXXXX_" ön-ekli
//   2. pasif kaydın quickPin + cardToken temizlenir (benzersiz havuz tıkanmaz)
//   3. ORİJİNAL username ile YENİ kullanıcı açılabilir (çakışma yok)
//   4. deactivate idempotent — ikinci kez "del_" ön-eki KATLANMAZ
//   NOT: username regex backend admin.routes/Electron zod'da (HTTP katmanı); burada
//   servis seviyesi lifecycle test edilir.
// =============================================================================
import prisma from "../src/lib/prisma";
import { PermissionManagementService as PM } from "../src/services/permission-management.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcısı yok (npm run seed)");
  const uname = `test.lifecycle.${ts}`;
  const created: string[] = [];

  try {
    // 1) oluştur (mobil kimlik de üret — quickPin/cardToken dolsun) → pasife al
    const u1 = await PM.createUser(
      { username: uname, fullName: "TEST Lifecycle", password: "123456", generateMobileCredentials: true },
      admin.id,
    );
    created.push(u1.id);
    // Etkin yöntem yoksa kimlik üretilmez; garanti için elle set et.
    await prisma.user.update({ where: { id: u1.id }, data: { quickPin: `9${String(ts).slice(-5)}`.slice(0, 6), cardToken: "aa".repeat(16) } }).catch(() => {});

    await PM.deactivateUser(u1.id, admin.id);
    const after = await prisma.user.findUnique({
      where: { id: u1.id },
      select: { isActive: true, username: true, quickPin: true, cardToken: true },
    });
    check("deactivate → isActive false", after?.isActive === false);
    check("deactivate → username 'del_XXXXXX_' ön-ekli", /^del_[0-9a-f]{6}_/.test(after?.username ?? ""));
    check("deactivate → orijinal isim ön-ekte korunur", (after?.username ?? "").includes(uname.slice(0, 30)));
    check("deactivate → quickPin + cardToken temizlendi", after?.quickPin === null && after?.cardToken === null);

    // 3) ORİJİNAL username ile yeni kullanıcı açılabilir
    const u2 = await PM.createUser(
      { username: uname, fullName: "TEST Lifecycle 2", password: "123456", generateMobileCredentials: false },
      admin.id,
    );
    created.push(u2.id);
    check("orijinal isimle yeni kullanıcı açıldı", u2.username === uname && u2.id !== u1.id);

    // 4) idempotent: ikinci deactivate ön-eki KATLAMAZ
    const freedOnce = after?.username ?? "";
    await PM.deactivateUser(u1.id, admin.id);
    const after2 = await prisma.user.findUnique({ where: { id: u1.id }, select: { username: true } });
    check("ikinci deactivate ön-eki katlamaz", after2?.username === freedOnce, after2?.username);
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: { in: created } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
