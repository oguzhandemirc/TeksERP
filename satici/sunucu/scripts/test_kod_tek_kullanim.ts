// =============================================================================
// ETKİNLEŞTİRME KODU TEK KULLANIMLIK — yarış: aynı kod, iki FARKLI makine anahtarı, eşzamanlı.
// Beklenen her turda: tam bir 200 + bir 409 ETKINLESTIRME_KODU_KULLANILMIS; kurulumun anahtarı
// kazananınki; kod bir kez KULLANILDI; zincirde tek kök kira (ikinci kira basılmadı).
// Gerçek süreç, gerçek eşzamanlılık (iki fetch aynı anda) — atomik claim + kurulum kilidi.
// ⭐ KALICI SONDA ✓K1 (her koşumda): aynı yarış AYNI anahtarla (ağ tekrarı) koşulur → İKİSİ de 200
//    ve AYNI kira — kapı "ikinciyi her zaman reddet" diye kör yazılmış olsaydı bu kırmızı olurdu.
// Koşum: npx tsx scripts/test_kod_tek_kullanim.ts
// =============================================================================
import { ENDPOINTS } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
} from "./lib/test-ortam";

const TUR = 6;

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  try {
    console.log(`\n§1 farklı anahtarlar, ${TUR} tur`);
    let tamTurlar = 0;
    for (let i = 0; i < TUR; i++) {
      const k = await kurulumFiksturu(ctx);
      temizlenecek.push(k.kurulumDbId);
      const a = kurulumAnahtariUret();
      const b = kurulumAnahtariUret();
      const istek = (anahtar: typeof a) =>
        imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
          kurulumId: k.kurulumId,
          amac: "etkinlestir",
          anahtar,
          govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
        });
      const [ra, rb] = await Promise.all([istek(a), istek(b)]);
      const durumlar = [ra.status, rb.status].sort().join("+");
      const kazanan = ra.status === 200 ? a : rb.status === 200 ? b : null;
      const kaybeden = ra.status === 200 ? rb : ra;
      const kurulum = await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } });
      const kiralar = await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
      const kod = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
      const tam =
        durumlar === "200+409" &&
        kaybeden.kod === "ETKINLESTIRME_KODU_KULLANILMIS" &&
        kazanan !== null &&
        kurulum.anahtarKimligi === kazanan.kid &&
        kod.kullananAnahtarKimligi === kazanan.kid &&
        kiralar === 1;
      if (tam) tamTurlar++;
      else console.log(`     ↳ tur ${i + 1}: ${durumlar} kaybeden=${kaybeden.kod} kira=${kiralar}`);
    }
    kontrol(`§1a her turda tam bir 200 + bir 409; anahtar kazananın; tek kök kira`, tamTurlar === TUR, `${tamTurlar}/${TUR}`);

    console.log("\n§2 ✓K sondası: aynı anahtarla yarış (ağ tekrarı) — ikisi de aynı sonucu alır");
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const ayni = kurulumAnahtariUret();
    const govde = etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: ayni, parmakIzi: f.parmakIzi });
    const [r1, r2] = await Promise.all([
      imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar: ayni, govde }),
      imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar: ayni, govde }),
    ]);
    kontrol("§2a ikisi de 200", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status} ${r1.kod ?? ""} ${r2.kod ?? ""}`);
    kontrol("§2b ikisi de AYNI kira (yeni kira basılmadı)", r1.json.kira === r2.json.kira && (await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } })) === 1);
  } finally {
    await sunucu.durdur();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
