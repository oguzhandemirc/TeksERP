// =============================================================================
// Test: Giriş yöntemleri (auth.loginMethods) + salt hızlı-PIN girişi
// Çalıştır: npx tsx scripts/test_login_methods.ts
// Doğrulananlar:
//   1.  ayar yokken default { enabled:[list], primary:list }
//   2.  GERİYE-UYUM: eski auth.loginMode="card" → { enabled:[card,list], primary:card }
//   3.  setFeatureFlags geçersiz konfigürasyonları reddeder (boş enabled / primary ∉ enabled)
//   4.  pin etkin değilken login-quick-pin 403
//   5.  setQuickPin: PIN seçilemez (Y-01) — istenen `pin` yok sayılır, rastgele ve benzersiz döner
//   6.  rastgele üretim 6 hane döner
//   7.  pin etkinken doğru PIN → JWT + doğru kullanıcı; yanlış PIN → 401
//   8.  clear=true → PIN kaldırılır, girişi 401
//   9.  pasif kullanıcının PIN'i çalışmaz
// =============================================================================
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import {
  systemSettingService,
  SETTING_KEYS,
  readLoginMethods,
} from "../src/services/system-setting.service";

let pass = 0, fail = 0;
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
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcısı yok (npm run seed)");

  const prevMethods = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS }, select: { value: true },
  });
  const prevLegacy = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_MODE }, select: { value: true },
  });

  const u1 = await prisma.user.create({
    data: { username: `test-qpin-${ts}`, passwordHash: await AuthService.hashPassword("123456"), fullName: "TEST QuickPin" },
    select: { id: true, username: true },
  });
  const u2 = await prisma.user.create({
    data: { username: `test-qpin2-${ts}`, passwordHash: await AuthService.hashPassword("123456"), fullName: "TEST QuickPin 2" },
    select: { id: true },
  });
  const created: string[] = []; // createUser ile açılan ek kullanıcılar (cleanup)

  try {
    // 1) default
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [SETTING_KEYS.AUTH_LOGIN_METHODS, SETTING_KEYS.AUTH_LOGIN_MODE] } },
    });
    const def = await readLoginMethods();
    check("default → yalnız liste", def.enabled.join(",") === "list" && def.primary === "list");

    // 2) geriye-uyum: eski loginMode="card"
    await prisma.systemSetting.create({
      data: { key: SETTING_KEYS.AUTH_LOGIN_MODE, value: "card", updatedById: admin.id },
    });
    const legacy = await readLoginMethods();
    check(
      "geriye-uyum: eski card → kart öncelikli + liste yedek",
      legacy.primary === "card" && legacy.enabled.includes("card") && legacy.enabled.includes("list"),
    );
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.AUTH_LOGIN_MODE } });

    // 3) geçersiz konfigürasyonlar
    await expectErr("boş enabled reddi", "en az bir yöntem", () =>
      systemSettingService.setFeatureFlags(
        { loginMethods: { enabled: [] as never, primary: "list" } as never }, admin.id));
    await expectErr("primary ∉ enabled reddi", "öncelikli yöntem", () =>
      systemSettingService.setFeatureFlags(
        { loginMethods: { enabled: ["list"], primary: "card" } as never }, admin.id));

    // 4) pin etkin değilken login-quick-pin 403
    await expectErr("pin etkin değilken 403", "Hızlı PIN ile giriş kapalı", () =>
      AuthService.loginWithQuickPin("123456"));

    // 5) PIN seçilemez: istenen değer (eski panel gövdesi) yok sayılır, rastgele döner
    const setRes = await AuthService.setQuickPin(u1.id, { pin: "424242" } as { clear?: boolean }, admin.id);
    const pin1 = setRes.pin ?? "";
    check("PIN atandı (6 hane, istenen değer yok sayıldı)", /^\d{6}$/.test(pin1) && pin1 !== "424242", pin1);

    // 6) ikinci kullanıcı — rastgele ve benzersiz
    const rnd = await AuthService.setQuickPin(u2.id, {}, admin.id);
    check("rastgele PIN 6 hane, ilkinden farklı", /^\d{6}$/.test(rnd.pin ?? "") && rnd.pin !== pin1, rnd.pin ?? "");

    // 7) pin etkinken giriş
    await systemSettingService.setFeatureFlags(
      { loginMethods: { enabled: ["list", "pin"], primary: "pin" } }, admin.id);
    const login = await AuthService.loginWithQuickPin(pin1);
    check("doğru PIN → doğru kullanıcı", login.user.username === u1.username);
    const yanlis = ["000001", "000002"].find((x) => x !== pin1 && x !== rnd.pin)!;
    await expectErr("yanlış PIN 401", "tanınmadı", () => AuthService.loginWithQuickPin(yanlis));

    // 8) clear → giriş kapanır
    await AuthService.setQuickPin(u1.id, { clear: true }, admin.id);
    await expectErr("PIN kaldırılınca 401", "tanınmadı", () => AuthService.loginWithQuickPin(pin1));

    // 9) pasif kullanıcının PIN'i çalışmaz
    const pin3 = (await AuthService.setQuickPin(u1.id, {}, admin.id)).pin!;
    await prisma.user.update({ where: { id: u1.id }, data: { isActive: false } });
    await expectErr("pasif kullanıcı PIN'i 401", "tanınmadı", () => AuthService.loginWithQuickPin(pin3));

    // 10) getUserCredentials — panel okuması: düz PIN YALNIZ basım penceresinde (bellek), DB'de özet
    const cred = await AuthService.getUserCredentials(u1.id);
    check("getUserCredentials → yeni verilen PIN basım penceresinde okunur", cred.quickPin === pin3 && cred.quickPinRevealed);
    check("getUserCredentials → PIN özetli saklanıyor (OZET)", cred.quickPinSet && cred.quickPinStorage === "OZET");
    check("getUserCredentials → kart kodu (kart yoksa null)", cred.cardCode === null && !cred.cardSet);

    // 11) createUser YALNIZ etkin yöntemlerin kimliğini üretir — pin+card etkin yap.
    await systemSettingService.setFeatureFlags(
      { loginMethods: { enabled: ["list", "pin", "card"], primary: "pin" } }, admin.id);
    const auto = await PermissionManagementService.createUser(
      { username: `test-qpin-auto-${ts}`, fullName: "TEST Auto", password: "123456" },
      admin.id,
    );
    created.push(auto.id);
    const autoCred = await AuthService.getUserCredentials(auto.id);
    check("createUser (pin+card etkin) → otomatik hızlı PIN", /^\d{6}$/.test(autoCred.quickPin ?? ""));
    check("createUser (pin+card etkin) → otomatik QR kart kodu", /^TEKSU:/.test(autoCred.cardCode ?? ""));

    // 11b) yalnız card etkinken → PIN üretilmez, yalnız kart
    await systemSettingService.setFeatureFlags(
      { loginMethods: { enabled: ["list", "card"], primary: "card" } }, admin.id);
    const cardOnly = await PermissionManagementService.createUser(
      { username: `test-qpin-card-${ts}`, fullName: "TEST CardOnly", password: "123456" },
      admin.id,
    );
    created.push(cardOnly.id);
    const cardOnlyCred = await AuthService.getUserCredentials(cardOnly.id);
    check("yalnız card etkin → kart var, PIN yok",
      cardOnlyCred.cardCode !== null && cardOnlyCred.quickPin === null);

    // 12) generateMobileCredentials=false → kimlik üretilmez (web kullanıcısı)
    const web = await PermissionManagementService.createUser(
      {
        username: `test-qpin-web-${ts}`, fullName: "TEST Web", password: "123456",
        grantOperatorDefaults: false, generateMobileCredentials: false,
      },
      admin.id,
    );
    created.push(web.id);
    const webCred = await AuthService.getUserCredentials(web.id);
    check("web kullanıcısı → PIN yok", webCred.quickPin === null && webCred.cardCode === null);
  } finally {
    if (prevMethods) {
      await prisma.systemSetting.upsert({
        where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS },
        create: { key: SETTING_KEYS.AUTH_LOGIN_METHODS, value: prevMethods.value as never, updatedById: admin.id },
        update: { value: prevMethods.value as never },
      }).catch(() => {});
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.AUTH_LOGIN_METHODS } }).catch(() => {});
    }
    if (prevLegacy) {
      await prisma.systemSetting.upsert({
        where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
        create: { key: SETTING_KEYS.AUTH_LOGIN_MODE, value: prevLegacy.value as never, updatedById: admin.id },
        update: { value: prevLegacy.value as never },
      }).catch(() => {});
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.AUTH_LOGIN_MODE } }).catch(() => {});
    }
    const allIds = [u1.id, u2.id, ...created];
    await prisma.userPermission.deleteMany({ where: { userId: { in: allIds } } }).catch(() => {});
    // Login artık Session kaydı yaratıyor (jti registry) → user silmeden önce temizle
    // (sessions.userId onDelete Restrict).
    await prisma.session.deleteMany({ where: { userId: { in: allIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: allIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
