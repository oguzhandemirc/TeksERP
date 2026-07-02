// =============================================================================
// Test: QR personel kartıyla giriş (auth.loginMode="card") — Faz 5
// Çalıştır: npx tsx scripts/test_card_login.ts
// Doğrulananlar:
//   1. mod "pin" (default) iken login-card 403 (kart altyapısı kapalı)
//   2. rotateCardToken → TEKSU:<userId>:<32-hex> kart kodu üretir
//   3. mod "card" iken geçerli kartla giriş → JWT + doğru kullanıcı
//   4. rotasyon sonrası ESKİ kart 401 (anında ölür), yeni kart çalışır
//   5. bozuk format 401; pasif kullanıcı kartı 401
//   6. PIN girişi "card" modunda da çalışır (fallback)
// =============================================================================
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { systemSettingService, SETTING_KEYS } from "../src/services/system-setting.service";

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

  // Ayarın test öncesi değerini sakla (finally'de geri yüklenir).
  const prevMode = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
    select: { value: true },
  });

  // Test kullanıcısı (aktif + pasif)
  const testUser = await prisma.user.create({
    data: {
      username: `test-card-${ts}`,
      passwordHash: await AuthService.hashPassword("123456"),
      fullName: "TEST Kart Kullanıcısı",
    },
    select: { id: true, username: true },
  });
  const passiveUser = await prisma.user.create({
    data: {
      username: `test-card-p-${ts}`,
      passwordHash: await AuthService.hashPassword("123456"),
      fullName: "TEST Pasif Kart",
      isActive: false,
    },
    select: { id: true },
  });

  try {
    // 1) default mod "pin" → login-card kapalı
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.AUTH_LOGIN_MODE } });
    await expectErr("mod pin iken login-card 403", "Kartla giriş kapalı", () =>
      AuthService.loginWithCard("TEKSU:x:y"));

    // 2) kart üret
    const issued = await AuthService.rotateCardToken(testUser.id, admin.id);
    check(
      "kart kodu formatı TEKSU:<uuid>:<32-hex>",
      new RegExp(`^TEKSU:${testUser.id}:[0-9a-f]{32}$`).test(issued.cardCode),
      issued.cardCode.slice(0, 20) + "…",
    );
    check("ilk üretimde rotated=false", issued.rotated === false);

    // 3) mod "card" → geçerli kartla giriş
    await systemSettingService.setFeatureFlags({ loginMode: "card" }, admin.id);
    const login1 = await AuthService.loginWithCard(issued.cardCode);
    check("kartla giriş → JWT + doğru kullanıcı", !!login1.token && login1.user.username === testUser.username);

    // 4) rotasyon → eski kart ölür, yeni çalışır
    const rotated = await AuthService.rotateCardToken(testUser.id, admin.id);
    check("rotasyonda rotated=true", rotated.rotated === true);
    await expectErr("eski kart rotasyon sonrası 401", "iptal", () =>
      AuthService.loginWithCard(issued.cardCode));
    const login2 = await AuthService.loginWithCard(rotated.cardCode);
    check("yeni kart çalışır", login2.user.userId === testUser.id);

    // 5) bozuk format + pasif kullanıcı
    await expectErr("bozuk format 401", "Geçersiz personel kartı", () =>
      AuthService.loginWithCard("BOZUK-KART"));
    await expectErr("pasif kullanıcıya kart üretilemez", "bulunamadı veya pasif", () =>
      AuthService.rotateCardToken(passiveUser.id, admin.id));

    // 6) PIN fallback "card" modunda da çalışır
    const pinLogin = await AuthService.login(testUser.username, "123456");
    check("PIN girişi card modunda da çalışır (fallback)", pinLogin.user.userId === testUser.id);
  } finally {
    // Ayarı test öncesi haline döndür
    if (prevMode) {
      await prisma.systemSetting.update({
        where: { key: SETTING_KEYS.AUTH_LOGIN_MODE },
        data: { value: prevMode.value as never },
      }).catch(() => {});
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.AUTH_LOGIN_MODE } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: [testUser.id, passiveUser.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
