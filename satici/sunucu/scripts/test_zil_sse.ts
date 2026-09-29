// =============================================================================
// KAPI ZİLİ (SSE) — kurulum imzalı abonelik; zil içerik taşımaz, yalnız "şimdi yokla".
// Ölçülen: başlıklar (text/event-stream, `Cache-Control: no-transform`, tampon kapalı, sıkıştırma
// YOK); bağlanınca ve periyodik yorum satırı (kalp atışı; burada 1 sn); BAŞKA bir süreçten
// (portal/CLI/zamanlayıcı yerine bu bekçi) PG NOTIFY ile çalınan zil her konuda ≤2 sn'de gelir;
// yaptırım eylemi zili KENDİ tx'inde çalar; abone sayısı tailnet sağlık ucunda görünür ve kopunca
// düşer; imzasız/yanlış amaçlı abonelik reddedilir.
// ⭐ KALICI SONDA ✓K1 (her koşumda): başka kurulumun zili bu aboneye GELMEZ (çapraz teslim yok).
// Koşum: npx tsx scripts/test_zil_sse.ts
// =============================================================================
import { DOORBELL_TOPICS, ENDPOINTS, REQUEST_HEADER } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliBaslik,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  zilAboneOl,
} from "./lib/test-ortam";

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { notifyDoorbell } = await import("../src/services/doorbell");
  const { applySanction } = await import("../src/services/sanction.service");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam, { ZIL_KALP_SN: "1" });
  const saglik = async () => {
    const r = await fetch(`${sunucu.tailnet}/portal/saglik`);
    return ((await r.json()) as { data: { zil: { abone: number; dinliyor: boolean } } }).data.zil;
  };
  try {
    const anahtar = kurulumAnahtariUret();
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    if (et.status !== 200) throw new Error(`etkinleştirme ${et.status}`);

    console.log("\n§1 abonelik kapısı");
    const imzasiz = await gonder(`${sunucu.genel}${ENDPOINTS.DOORBELL}`, { yontem: "GET" });
    kontrol("§1a imzasız abonelik → 401", imzasiz.status === 401, `${imzasiz.status} ${imzasiz.kod}`);
    const yanlisAmac = await gonder(`${sunucu.genel}${ENDPOINTS.DOORBELL}`, {
      yontem: "GET",
      baslik: imzaliBaslik({ kurulumId: k.kurulumId, amac: "yokla", govde: "", anahtar }),
    });
    kontrol("§1b 'yokla' amaçlı imzayla abonelik → 401 ISTEK_AMAC", yanlisAmac.status === 401 && yanlisAmac.kod === "ISTEK_AMAC", `${yanlisAmac.status} ${yanlisAmac.kod}`);

    console.log("\n§2 akış başlıkları ve kalp atışı");
    const zil = await zilAboneOl(sunucu.genel, { kurulumId: k.kurulumId, anahtar });
    kontrol("§2a 200 + text/event-stream", zil.status === 200 && (zil.basliklar.get("content-type") ?? "").startsWith("text/event-stream"));
    kontrol("§2b Cache-Control no-transform + tampon kapalı", /no-transform/.test(zil.basliklar.get("cache-control") ?? "") && zil.basliklar.get("x-accel-buffering") === "no");
    kontrol("§2c sıkıştırma YOK (content-encoding boş)", !zil.basliklar.get("content-encoding"));
    await bekle(1_600);
    kontrol("§2d bağlantı + kalp atışı yorum satırları geliyor", zil.yorumSayisi() >= 2, `${zil.yorumSayisi()} yorum`);
    const s1 = await saglik();
    kontrol("§2e tailnet sağlığında 1 abone, PG dinleyicisi bağlı", s1.abone === 1 && s1.dinliyor, JSON.stringify(s1));

    console.log("\n§3 başka süreçten zil (PG NOTIFY) — her konu ≤2 sn");
    let hepsi = true;
    for (const konu of DOORBELL_TOPICS) {
      const bekleme = zil.bekleKonu(konu, 2_000);
      await notifyDoorbell(prisma, k.kurulumDbId, konu);
      const ms = await bekleme;
      if (ms === null) {
        hepsi = false;
        console.log(`     ↳ ${konu} gelmedi`);
      }
    }
    kontrol("§3a altı konunun hepsi ≤2 sn'de teslim", hepsi, DOORBELL_TOPICS.join(","));

    console.log("\n§4 yaptırım eylemi zili kendi tx'inde çalar");
    const bekleme = zil.bekleKonu("lisans", 2_000);
    await applySanction({ installationDbId: k.kurulumDbId, level: "K0", message: "Bakım bildirimi", reason: "zil bekçisi", actor: "bekci" });
    const ms = await bekleme;
    kontrol("§4a K0 → 'lisans' zili ≤2 sn", ms !== null, ms === null ? "gelmedi" : `${ms} ms`);

    console.log("\n§5 ✓K çapraz teslim yok");
    const oncesi = zil.konular.length;
    const baska = await kurulumFiksturu(ctx);
    temizlenecek.push(baska.kurulumDbId);
    await notifyDoorbell(prisma, baska.kurulumDbId, "lisans");
    await bekle(700);
    kontrol("§5a başka kurulumun zili bu aboneye gelmedi", zil.konular.length === oncesi, `${zil.konular.length - oncesi} fazla`);

    console.log("\n§6 kopunca abone düşer");
    zil.kapat();
    await bekle(500);
    const s2 = await saglik();
    kontrol("§6a abone sayısı 0", s2.abone === 0, JSON.stringify(s2));
    const genelPortal = await fetch(`${sunucu.genel}/portal/saglik`, { headers: { [REQUEST_HEADER]: "x" } });
    kontrol("§6b portal sağlık ucu GENEL dinleyicide YOK (404)", genelPortal.status === 404, `${genelPortal.status}`);
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
