// =============================================================================
// Test: Kullanıcı yaşam döngüsü — pasife alma (GERİ ALINABİLİR) vs silme (KALICI)
// Çalıştır: npx tsx scripts/test_user_lifecycle.ts
// Doğrulananlar:
//   1. deactivate → isActive false, username & kimlikler KORUNUR (geri alınabilir)
//   2. reactivate → isActive true (pasiften geri döner)
//   3. delete → deletedAt dolu + username "del_XXXXXX_" serbest + PIN/kart temizlenir
//   4. silinen reactivate EDİLEMEZ (geri alınamaz)
//   5. silinen deactivate EDİLEMEZ
//   6. ORİJİNAL username ile YENİ kullanıcı açılabilir (silme sonrası)
//   7. delete idempotent — ikinci silme ön-eki katlamaz/patlamaz
//   8. listUsers silinenleri GİZLER, pasifleri GÖSTERİR
// =============================================================================
import prisma from "../src/lib/prisma";
import { PermissionManagementService as PM } from "../src/services/permission-management.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}
const raw = (id: string) => prisma.user.findUnique({
  where: { id }, select: { isActive: true, username: true, quickPin: true, cardToken: true, deletedAt: true },
});

async function main() {
  const ts = Date.now();
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcısı yok (npm run seed)");
  const uname = `test.life.${ts}`;
  const created: string[] = [];

  try {
    // Pasife alma yolu — kimlikler korunur
    const u1 = await PM.createUser(
      { username: uname, fullName: "TEST Life", password: "123456", generateMobileCredentials: false },
      admin.id,
    );
    created.push(u1.id);
    await prisma.user.update({ where: { id: u1.id }, data: { quickPin: `7${String(ts).slice(-5)}`.slice(0, 6), cardToken: "bb".repeat(16) } });

    // 1) deactivate — geri alınabilir
    await PM.deactivateUser(u1.id, admin.id);
    const d = await raw(u1.id);
    check("deactivate → isActive false", d?.isActive === false);
    check("deactivate → deletedAt NULL (silinmiş değil)", d?.deletedAt === null);
    check("deactivate → username & kimlikler KORUNUR", d?.username === uname && d?.quickPin !== null && d?.cardToken !== null);

    // 2) reactivate — geri döner
    await PM.reactivateUser(u1.id, admin.id);
    check("reactivate → isActive true", (await raw(u1.id))?.isActive === true);

    // 8) listUsers pasifleri gösterir (u1 aktif şu an), silinenleri gizler (aşağıda)
    await PM.deactivateUser(u1.id, admin.id);
    const listAfterDeact = await PM.listUsers();
    check("listUsers pasifi GÖSTERİR", listAfterDeact.some((u) => u.id === u1.id));

    // 3) delete — kalıcı, username serbest, kimlik temizlenir
    await PM.deleteUser(u1.id, admin.id);
    const del = await raw(u1.id);
    check("delete → deletedAt dolu", del?.deletedAt != null);
    check("delete → username 'del_XXXXXX_' serbest", /^del_[0-9a-f]{6}_/.test(del?.username ?? ""));
    check("delete → PIN + kart temizlendi", del?.quickPin === null && del?.cardToken === null);
    const listAfterDel = await PM.listUsers();
    check("listUsers silineni GİZLER", !listAfterDel.some((u) => u.id === u1.id));

    // 4-5) silinen geri getirilemez
    await expectErr("silinen reactivate reddi", "geri getirilemez", () => PM.reactivateUser(u1.id, admin.id));
    await expectErr("silinen deactivate reddi", "silinmiş", () => PM.deactivateUser(u1.id, admin.id));

    // 6) orijinal isimle yeni kullanıcı
    const u2 = await PM.createUser(
      { username: uname, fullName: "TEST Life 2", password: "123456", generateMobileCredentials: false },
      admin.id,
    );
    created.push(u2.id);
    check("silme sonrası orijinal isimle yeni kullanıcı", u2.username === uname);

    // 7) delete idempotent
    const freed = del?.username ?? "";
    await PM.deleteUser(u1.id, admin.id);
    check("delete idempotent (ön-ek katlamaz)", (await raw(u1.id))?.username === freed);
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: { in: created } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
