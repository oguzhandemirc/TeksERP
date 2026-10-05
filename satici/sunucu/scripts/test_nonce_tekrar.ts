// =============================================================================
// NONCE TEKRAR OYNATMA — aynı imzalı istek ikinci kez 409 ISTEK_TEKRAR; (kurulumId, nonce) UNIQUE
// atomik kayıt; saklama isteğin ZAMANI + 10 dk (±10 dk tolerans → geçerli pencere 20 dk; sabit
// "görüldükten sonra N dk" bu pencereden kısa kalırsa tekrar kabul edilir — protokol §12/1).
// Zaman dışı istek (±10 dk ötesi) 401 ISTEK_ZAMAN. Budama yalnız süresi geçmişi siler ve
// budanabilir her satır, isteği ZATEN zaman denetiminden düşürecek andan sonra budanır.
// §5 (L2-1) İSTEK YOL BAĞI: imzalı `yol` taşıyan istek yalnız o uca (zarfla gelende taşıyan uç
//    `/v1/cevrimdisi`) — başka uç 401 `ISTEK_YOL`, kod/nonce tüketilmez; yol taşımayan (eski) istek değişmez.
// §6 (6.3c) YANIT İSTEK BAĞI: canlı uçların (etkinleştir · yokla) lisans yanıtı `yanitBagi` taşır — kirayı (`kiraOzeti`)
//    isteğin nonce'una ALT imzasıyla bağlar, kira `yanitBagli: true` beyan eder; başka nonce'la doğrulama
//    `YANIT_NONCE_UYUSMAZ`; zarf ucu (`/v1/cevrimdisi`) bağ basmaz; aynı kirayı yeniden veren tekrar yolu TAZE bağ basar.
// ⭐ KALICI SONDA ✓K2 (her koşumda): (1) aynı nonce BAŞKA kurulumda kabul (ad alanı kurulum başına —
//    kapı "nonce'u küresel reddet" diye kör olsaydı kırmızı); (2) DB'ye doğrudan ikinci satır P2002.
// Koşum: npx tsx scripts/test_nonce_tekrar.ts
// =============================================================================
import { CLOCK_SKEW_MS, ENDPOINTS, generateNonce, jwsDigest, parseJws, verifyResponseBinding, wrapEnvelope } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliBaslik,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
} from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { pruneExpiredNonces } = await import("../src/services/maintenance");
  const { isUniqueViolation } = await import("../src/lib/prisma-errors");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  try {
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    if (et.status !== 200) throw new Error(`etkinleştirme ${et.status}`);
    const kiraId = kiraIdOf(et.json);

    console.log("\n§1 aynı istek iki kez");
    const govde = yoklamaGovdesi({ sonKiraId: kiraId, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: f.parmakIzi });
    const ilk = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde });
    kontrol("§1a ilk istek 200", ilk.status === 200, `${ilk.status} ${ilk.kod ?? ""}`);
    const ikinci = await gonder(`${sunucu.genel}${ENDPOINTS.POLL}`, { baslik: ilk.baslik, govde: ilk.metin });
    kontrol("§1b AYNI imzalı istek tekrar → 409 ISTEK_TEKRAR", ikinci.status === 409 && ikinci.kod === "ISTEK_TEKRAR", `${ikinci.status} ${ikinci.kod}`);
    const kiralar = await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§1c tekrar yeni kira BASMADI (kök + 1)", kiralar === 2, `${kiralar}`);

    console.log("\n§2 zaman penceresi");
    const eski = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: k.kurulumId,
      amac: "yokla",
      anahtar,
      govde,
      zamanMs: Date.now() - CLOCK_SKEW_MS - 60_000,
    });
    kontrol("§2a 11 dk eski istek → 401 ISTEK_ZAMAN", eski.status === 401 && eski.kod === "ISTEK_ZAMAN", `${eski.status} ${eski.kod}`);
    const sunucuSaati = (eski.json.details as { sunucuSaati?: unknown } | undefined)?.sunucuSaati;
    kontrol(
      "§2a2 ISTEK_ZAMAN yanıtı satıcının saatini taşır (details.sunucuSaati, ISO, şimdiye ±5 sn — D4)",
      typeof sunucuSaati === "string" && Math.abs(Date.parse(sunucuSaati) - Date.now()) < 5_000,
      String(sunucuSaati),
    );
    const ileri = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: k.kurulumId,
      amac: "yokla",
      anahtar,
      govde,
      zamanMs: Date.now() + CLOCK_SKEW_MS + 60_000,
    });
    kontrol("§2b 11 dk ileri istek → 401 ISTEK_ZAMAN", ileri.status === 401 && ileri.kod === "ISTEK_ZAMAN", `${ileri.status} ${ileri.kod}`);
    const ileriNonce = generateNonce();
    const ileriZaman = Date.now() + 9 * 60_000;
    const kabul = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: k.kurulumId,
      amac: "yokla",
      anahtar,
      govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(ilk.json), parmakIzi: f.parmakIzi }),
      zamanMs: ileriZaman,
      nonce: ileriNonce,
    });
    kontrol("§2c +9 dk damgalı istek tolerans içinde → 200", kabul.status === 200, `${kabul.status} ${kabul.kod ?? ""}`);
    const satir = await prisma.nonceDefteri.findUniqueOrThrow({ where: { kapsam_nonce: { kapsam: k.kurulumDbId, nonce: ileriNonce } } });
    kontrol(
      "§2d saklama = istek ZAMANI + 10 dk (şimdi + 19 dk'dan az değil)",
      satir.sonKullanim.getTime() >= ileriZaman + CLOCK_SKEW_MS - 1_000,
      `${Math.round((satir.sonKullanim.getTime() - Date.now()) / 60_000)} dk sonra`,
    );

    console.log("\n§3 budama");
    const hepsi = await prisma.nonceDefteri.findMany({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§3a her satır: saklama ≥ istek anı + tolerans (budanan satırın isteği zaten zaman dışı)", hepsi.every((n) => n.sonKullanim.getTime() >= n.createdAt.getTime() + CLOCK_SKEW_MS - 1_000));
    const simdiBudanan = await pruneExpiredNonces(Date.now());
    const kalan = await prisma.nonceDefteri.count({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§3b süresi dolmamış nonce budanmaz", kalan === hepsi.length, `${simdiBudanan} budandı, ${kalan}/${hepsi.length} kaldı`);
    await pruneExpiredNonces(Date.now() + 2 * CLOCK_SKEW_MS + 60_000);
    const sonra = await prisma.nonceDefteri.count({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§3c pencere geçince budanır", sonra === 0, `${sonra}`);

    console.log("\n§4 ✓K sondaları");
    const k2 = await kurulumFiksturu(ctx);
    temizlenecek.push(k2.kurulumDbId);
    const ortakNonce = generateNonce();
    const ilkEt = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k2.kurulumId,
      amac: "etkinlestir",
      anahtar: f.kurulum,
      govde: etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: k2.kurulumId, anahtar: f.kurulum, parmakIzi: f.parmakIzi }),
      nonce: ortakNonce,
    });
    const k3 = await kurulumFiksturu(ctx);
    temizlenecek.push(k3.kurulumDbId);
    const baska = kurulumAnahtariUret();
    const ikinciEt = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k3.kurulumId,
      amac: "etkinlestir",
      anahtar: baska,
      govde: etkinlestirmeGovdesi({ kod: k3.kod, kurulumId: k3.kurulumId, anahtar: baska, parmakIzi: f.parmakIzi }),
      nonce: ortakNonce,
    });
    kontrol("§4a aynı nonce BAŞKA kurulumda kabul (ad alanı kurulum başına)", ilkEt.status === 200 && ikinciEt.status === 200, `${ilkEt.status}/${ikinciEt.status}`);
    let p2002 = false;
    try {
      await prisma.nonceDefteri.create({ data: { kapsam: k2.kurulumDbId, kurulumId: k2.kurulumDbId, nonce: ortakNonce, amac: "yokla", sonKullanim: new Date() } });
    } catch (err) {
      p2002 = isUniqueViolation(err);
    }
    kontrol("§4b DB seddi: aynı (kapsam, nonce) ikinci satır → P2002", p2002);

    console.log("\n§5 İSTEK yol bağı (L2-1)");
    const yoklama = (sonKiraId: string) => yoklamaGovdesi({ sonKiraId, parmakIzi: f.parmakIzi });
    const kira0 = kiraIdOf(kabul.json);
    const yanlis = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklama(kira0), imzaYolu: ENDPOINTS.SUPPORT });
    kontrol("§5a ⭐ destek ucu için imzalanmış yoklama yokla ucunda → 401 ISTEK_YOL", yanlis.status === 401 && yanlis.kod === "ISTEK_YOL", `${yanlis.status} ${yanlis.kod}`);
    const dogru = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklama(kira0), imzaYolu: ENDPOINTS.POLL });
    kontrol("§5b kendi ucu için imzalanmış yoklama → 200", dogru.status === 200, `${dogru.status} ${dogru.kod ?? ""}`);
    const zarfla = async (yol: string, sonKiraId: string) => {
      const metin = JSON.stringify(yoklama(sonKiraId));
      const baslik = imzaliBaslik({ kurulumId: k.kurulumId, amac: "cevrimdisi", govde: metin, anahtar, yol });
      return gonder(`${sunucu.genel}${ENDPOINTS.OFFLINE}`, { govde: JSON.stringify({ v: 1, zarf: wrapEnvelope(baslik, metin) }) });
    };
    const zarfYanlis = await zarfla(ENDPOINTS.POLL, kiraIdOf(dogru.json));
    kontrol("§5c ⭐ zarfla gelen istek yokla ucu için imzalanmışsa → 401 ISTEK_YOL (taşıyan uç /v1/cevrimdisi)", zarfYanlis.status === 401 && zarfYanlis.kod === "ISTEK_YOL", `${zarfYanlis.status} ${zarfYanlis.kod}`);
    const zarfDogru = await zarfla(ENDPOINTS.OFFLINE, kiraIdOf(dogru.json));
    kontrol("§5d zarf içindeki istek /v1/cevrimdisi için imzalanmışsa → 200", zarfDogru.status === 200, `${zarfDogru.status} ${zarfDogru.kod ?? ""}`);
    const k4 = await kurulumFiksturu(ctx);
    temizlenecek.push(k4.kurulumDbId);
    const yeniAnahtar = kurulumAnahtariUret();
    const etGovde = etkinlestirmeGovdesi({ kod: k4.kod, kurulumId: k4.kurulumId, anahtar: yeniAnahtar, parmakIzi: f.parmakIzi });
    const etYanlis = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k4.kurulumId, amac: "etkinlestir", anahtar: yeniAnahtar, govde: etGovde, imzaYolu: ENDPOINTS.POLL });
    kontrol("§5e ⭐ gövde anahtarlı yol da bağlı: başka uç için imzalanmış etkinleştirme → 401 ISTEK_YOL", etYanlis.status === 401 && etYanlis.kod === "ISTEK_YOL", `${etYanlis.status} ${etYanlis.kod}`);
    const etDogru = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k4.kurulumId, amac: "etkinlestir", anahtar: yeniAnahtar, govde: etGovde, imzaYolu: ENDPOINTS.ACTIVATE });
    kontrol("§5f reddedilen istek kodu TÜKETMEDİ: aynı kod kendi ucu için imzalanınca 200", etDogru.status === 200, `${etDogru.status} ${etDogru.kod ?? ""}`);

    console.log("\n§6 yanıt istek bağı (6.3c)");
    const sinif = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId }, select: { sinif: true } })).sinif;
    const bagOf = (j: Record<string, unknown>) => (typeof j.yanitBagi === "string" ? j.yanitBagi : undefined);
    const kiraOf = (j: Record<string, unknown>) => String(j.kira);
    const yuk = (jws: string): Record<string, unknown> => {
      const p = parseJws(jws);
      return p.ok ? (p.value.payload as Record<string, unknown>) : {};
    };
    const etBag = verifyResponseBinding(bagOf(et.json), f.kokler, { lease: kiraOf(et.json), nonce: String(yuk(et.baslik).nonce), sinif });
    kontrol("§6a ⭐ etkinleştirme yanıtı isteğin nonce'una bağlı (bağ doğrulanır)", etBag.ok, etBag.ok ? "" : `${etBag.code} ${etBag.message}`);
    const n1 = generateNonce();
    const tip = kiraIdOf(zarfDogru.json);
    const y1 = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklama(tip), nonce: n1 });
    const bag1 = verifyResponseBinding(bagOf(y1.json), f.kokler, { lease: kiraOf(y1.json), nonce: n1, sinif });
    kontrol("§6b ⭐ yoklama yanıtı kendi nonce'una bağlı", y1.status === 200 && bag1.ok, bag1.ok ? "" : `${y1.status} ${bag1.code} ${bag1.message}`);
    const yabanci = verifyResponseBinding(bagOf(y1.json), f.kokler, { lease: kiraOf(y1.json), nonce: generateNonce(), sinif });
    kontrol("§6c ⭐ aynı yanıt BAŞKA isteğin nonce'uyla → YANIT_NONCE_UYUSMAZ (eski yanıtı oynatma)", !yabanci.ok && yabanci.code === "YANIT_NONCE_UYUSMAZ", yabanci.ok ? "kabul" : yabanci.code);
    const baskaKira = verifyResponseBinding(bagOf(y1.json), f.kokler, { lease: kiraOf(et.json), nonce: n1, sinif });
    kontrol("§6d bağ başka kiraya takılamaz → YANIT_BAGI_UYUSMAZ", !baskaKira.ok && baskaKira.code === "YANIT_BAGI_UYUSMAZ", baskaKira.ok ? "kabul" : baskaKira.code);
    kontrol("§6e kira bağla teslimi beyan eder (yanitBagli: true, imzalı)", yuk(kiraOf(y1.json)).yanitBagli === true, String(yuk(kiraOf(y1.json)).yanitBagli));
    kontrol("§6f zarf ucunun yanıtı bağ BASMAZ (taşınmış yanıt; QR yükü büyümez)", zarfDogru.status === 200 && bagOf(zarfDogru.json) === undefined);
    const n2 = generateNonce();
    const tekrar = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: yoklama(tip), nonce: n2 });
    const bag2 = verifyResponseBinding(bagOf(tekrar.json), f.kokler, { lease: kiraOf(tekrar.json), nonce: n2, sinif });
    kontrol(
      "§6g ⭐ yanıtı kaybolan istek tekrarı AYNI kirayı TAZE bağla alır (yeni nonce'a bağlı, kira bayt-eşit)",
      tekrar.status === 200 && kiraOf(tekrar.json) === kiraOf(y1.json) && bag2.ok && bagOf(tekrar.json) !== bagOf(y1.json),
      bag2.ok ? `${jwsDigest(kiraOf(tekrar.json)).slice(0, 8)}` : `${tekrar.status} ${bag2.code}`,
    );
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
