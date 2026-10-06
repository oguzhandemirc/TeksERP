// =============================================================================
// PROFİL UYGULA — bir test profilinin ayarlarını `_test` DB'ye servis katmanından yazar
// =============================================================================
// Koşum (DATABASE_URL + JWT_SECRET ortamdan; .env okunmaz):
//   DATABASE_URL='…/<ad>_test' tsx scripts/profil-uygula.ts <profil-adı>
// Uç değil servis: `setFeatureFlags` bağımlılık/lisans doğrulamasını koşar; tek gövde,
// böylece "iplik açık + ticaret kapalı" gibi yarım çift hiç doğmaz.
// Çıkış: 0 uygulandı · 1 uygulanamadı · 2 hedef reddi / kullanım.
// =============================================================================
import { fixtureHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";
import { profilHatalari, profilOku } from "./lib/profil";

async function main(): Promise<number> {
  const ad = process.argv[2];
  if (!ad) {
    console.error("❌ kullanım: tsx scripts/profil-uygula.ts <profil-adı>");
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok — .env okunmaz.");
    return 2;
  }
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`❌ ${engel}`);
    return 2;
  }
  const profil = profilOku(ad);
  const hatalar = profilHatalari(profil);
  if (hatalar.length > 0) {
    console.error(`❌ profil '${ad}' geçersiz:\n  ${hatalar.join("\n  ")}`);
    return 1;
  }
  const { default: prisma } = await import("../src/lib/prisma");
  const { systemSettingService } = await import("../src/services/system-setting.service");
  const admin = await prisma.user.findUnique({ where: { username: "admin" }, select: { id: true } });
  if (!admin) {
    console.error("❌ 'admin' kullanıcısı yok — önce `npm run seed`.");
    return 1;
  }
  const adet = Object.keys(profil.ayarlar).length;
  if (adet > 0) {
    await systemSettingService.setFeatureFlags(profil.ayarlar as never, admin.id);
  }
  console.log(`✅ profil '${ad}' uygulandı: ${adet} ayar → ${hedefDbAdi()}`);
  await prisma.$disconnect();
  return 0;
}

main().then((k) => process.exit(k), (e) => {
  console.error(`❌ profil uygulanamadı: ${(e as Error).message}`);
  process.exit(1);
});
