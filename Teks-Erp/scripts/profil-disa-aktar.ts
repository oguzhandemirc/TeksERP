// =============================================================================
// PROFİL DIŞA AKTAR — fabrika yedeğinin `_test` KOPYASINDAN ayar profili (TEK-ORTAK-PAKET §6.2, K-8)
// =============================================================================
// Yalnız ayar okur: `getFeatureFlags()` çıktısı → allowlist süzgeci (`lib/profil.ts`).
// İş verisi, ana veri ve sır profile girmez; çıktı müşteri adı taşımaz (profil adı kısa
// kod, örn. `f1`; kod ↔ müşteri eşlemesi repo dışında tutulur).
//
// Koşum (Teks-Erp/ içinden; .env okunmaz, hedef açıkça verilir):
//   DATABASE_URL='postgresql://…/<oturum>_kaynak_test' \
//     npx tsx scripts/profil-disa-aktar.ts --ad f1 --kaynak "<döküm künyesi>" [--yaz]
//   --yaz yoksa profil yalnız ekrana basılır (kuru koşum).
//   --sonda  salt okuma negatif sondası: zararsız bir UPDATE (WHERE false) RED almalı.
// Bağlantı oturum düzeyinde SALT OKUMADIR (`default_transaction_read_only=on`, ölçülür).
// Çıkış: 0 tamam · 1 profil geçersiz · 2 hedef/kullanım reddi.
// =============================================================================
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FACTORY_TIMEZONE } from "../src/constants/time";
import { FIXTURE_OLMAYAN_DB, hedefDbAdi } from "./lib/hedef-db-kapisi";
import {
  bayraklardanAyarlar,
  disaAktarmaHedefEngeli,
  PROFIL_AD_DESENI,
  PROFIL_DIZINI,
  profilHatalari,
  URETILMIS_PROFILLER,
  type Profil,
} from "./lib/profil";

function arg(argv: string[], ad: string): string | undefined {
  const i = argv.indexOf(ad);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const ad = arg(argv, "--ad");
  const kaynak = arg(argv, "--kaynak");
  if (!ad || !kaynak) {
    console.error('❌ kullanım: tsx scripts/profil-disa-aktar.ts --ad <kısa-kod> --kaynak "<döküm künyesi>" [--yaz]');
    return 2;
  }
  if (!PROFIL_AD_DESENI.test(ad) || URETILMIS_PROFILLER.has(ad)) {
    console.error(`❌ profil adı '${ad}' geçersiz ya da üretilmiş bir profilin adı.`);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL ortamda yok — .env okunmaz, hedefi açıkça ver.");
    return 2;
  }
  const engel = disaAktarmaHedefEngeli(hedefDbAdi(), FIXTURE_OLMAYAN_DB);
  if (engel) {
    console.error(`❌ ${engel}`);
    return 2;
  }
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(`❌ hedef yerel değil (${host}); dışa aktarma yalnız yerel kopyaya koşar.`);
    return 2;
  }
  process.env.JWT_SECRET ??= `profil-disa-aktar-${process.pid}-yalniz-okuma-anahtari`;

  const { default: prisma, pool } = await import("../src/lib/prisma");
  // Havuzun her bağlantısı ilk sorgudan önce salt okumaya alınır (pg istemcisi sorguları sıralar).
  pool.on("connect", (c) => {
    void c.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  });
  try {
    const ro = await prisma.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
    if (ro[0]?.transaction_read_only !== "on") {
      console.error("❌ bağlantı salt okumaya alınamadı — dışa aktarma durduruldu.");
      return 2;
    }
    if (argv.includes("--sonda")) {
      try {
        await prisma.$executeRawUnsafe("UPDATE system_settings SET key = key WHERE false");
        console.error("❌ sonda: yazma ifadesi KABUL edildi — salt okuma kapısı kör.");
        return 1;
      } catch (e) {
        const reddedildi = /read-only transaction/i.test((e as Error).message);
        console.log(reddedildi ? "✅ sonda: yazma ifadesi salt okuma bağlantısında RED aldı." : `❌ sonda: beklenmeyen hata: ${(e as Error).message}`);
        return reddedildi ? 0 : 1;
      }
    }
    const { systemSettingService } = await import("../src/services/system-setting.service");
    const { updateSchema } = await import("../src/routes/feature-flag.routes");
    const r = await systemSettingService.getFeatureFlags();
    if (!r.success || !r.data) {
      console.error("❌ getFeatureFlags okunamadı.");
      return 1;
    }
    const bayraklar = r.data as unknown as Record<string, unknown>;
    const { ayarlar, atlanan } = bayraklardanAyarlar(bayraklar);
    const profil: Profil = { ad, kaynak, alinma: new Date().toISOString().slice(0, 10), ayarlar };
    const hatalar = profilHatalari(profil, updateSchema);
    if (hatalar.length > 0) {
      console.error(`❌ profil geçersiz:\n  ${hatalar.join("\n  ")}`);
      return 1;
    }
    const metin = `${JSON.stringify(profil, null, 2)}\n`;
    console.log(`ℹ️  ${Object.keys(ayarlar).length} ayar · ${Object.keys(atlanan).length} anahtar profil dışı:`);
    for (const [k, neden] of Object.entries(atlanan)) console.log(`   - ${k}: ${neden}`);
    if (typeof bayraklar.factoryTimezone === "string" && bayraklar.factoryTimezone !== DEFAULT_FACTORY_TIMEZONE) {
      console.log(`⚠️  saat dilimi '${bayraklar.factoryTimezone}' — profil biçimi dönem taşımıyor, matris varsayılanda koşar.`);
    }
    if (argv.includes("--yaz")) {
      const yol = join(PROFIL_DIZINI, `${ad}.json`);
      writeFileSync(yol, metin);
      console.log(`✅ profil yazıldı: ${yol}`);
    } else {
      process.stdout.write(metin);
      console.log("ℹ️  kuru koşum — dosyaya yazmak için --yaz.");
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((k) => process.exit(k), (e) => {
  console.error(`❌ dışa aktarma hatası: ${(e as Error).message}`);
  process.exit(1);
});
