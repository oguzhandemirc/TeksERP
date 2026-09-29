// =============================================================================
// KİRA ZİNCİRİ — VM/konteyner kopyasına karşı asıl savunma (plan §4, protokol §13). Üç hâl:
//   (a) AYNI parmak izinden geride kalmış uç (snapshot geri alma) → uca "yakala", uyarı YOK
//   (b) 15 dk içinde aynı ucun ağ tekrarı → AYNI çocuk kira (idempotent, yeni satır yok)
//   (c) İKİ FARKLI parmak izi aynı ucu ileri taşıyor → ZINCIR_CATALI uyarısı; ilk pencerede yalnız
//       uyarı (kira verilir), ikinci pencerede sürerse EŞLEŞMEYEN tarafa kira yok (403
//       KIRA_VERILMEDI); sahip taraf hiç reddedilmez — asla anında durdurma.
// Ek: kabul edilen küme yalnız tek etkenlik değişimde kayar (çatal açıkken asla) · kabul edilen
// kümeyle ESLESMEDI (kopyalanan LICENSE_DIR) → uyarı, ikinci pencerede red; satıcı uyarıyı kapatıp
// kümeyi kabul edince (meşru donanım değişimi) kira döner · ardışık "yakala" → ayırt edilemeyen
// kopya uyarısı (yalnız uyarı).
// Sunucu kısa kopya penceresiyle kalkar (KOPYA_PENCERE_SN=2) — ikinci pencere beklenerek ölçülür.
// ⭐ KALICI SONDA ✓K2 (her koşumda): sahip taraf ikinci pencerede de 200 alır (kapı "çatalda herkesi
//    reddet" diye kör olsaydı kırmızı) · pencere dolmadan eşleşmeyen taraf 200 alır (anında red yok).
// Koşum: npx tsx scripts/test_kira_zinciri.ts
// =============================================================================
import { ENDPOINTS, digestFingerprint, parseJws, type Fingerprint } from "../src/lisans-protokol";
import { HAM_PARMAK_IZI, kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
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
  yoklamaGovdesi,
  type CalisanSunucu,
  type Yanit,
} from "./lib/test-ortam";

const PENCERE_SN = 2;
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kiraOf(y: Yanit): { kiraId: string; parmakIzi: Fingerprint } | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as { kiraId: string; parmakIzi: Fingerprint }) : null;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { closeCopyAlert } = await import("../src/services/installation-admin.service");
  const temizlenecek: string[] = [];
  const sunucu: CalisanSunucu = await sunucuBaslat(ortam, { KOPYA_PENCERE_SN: String(PENCERE_SN) });
  const fpA = f.parmakIzi;
  const fpB = digestFingerprint({ ...HAM_PARMAK_IZI, f2: "11111111-2222-3333-4444-555555555555", f3: "KLONDISK0001" }, f.tuz);
  const fpC = digestFingerprint({ ...HAM_PARMAK_IZI, f1: "{0a0b0c0d-0e0f-4a4b-9c9d-0e0f0a0b0c0d}", f2: "99999999-8888-7777-6666-555555555555", f3: "BASKADISK77" }, f.tuz);

  const etkinlestir = async (anahtar: TestAnahtari) => {
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: fpA }),
    });
    const kira = kiraOf(y);
    if (!kira) throw new Error(`etkinleştirme ${y.status} ${y.kod}`);
    return { k, t0: kira.kiraId };
  };
  const yokla = (kurulumId: string, anahtar: TestAnahtari, sonKiraId: string | null, parmakIzi: Fingerprint) =>
    imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId, parmakIzi }) });
  const karar = async (kiraId: string | undefined) => (kiraId ? (await prisma.kira.findUnique({ where: { id: kiraId } }))?.karar : undefined);

  try {
    const anahtar = kurulumAnahtariUret();
    const { k, t0 } = await etkinlestir(anahtar);

    console.log("\n§1 normal zincir");
    const t1 = kiraOf(await yokla(k.kurulumId, anahtar, t0, fpA))?.kiraId;
    const t2y = await yokla(k.kurulumId, anahtar, t1 ?? null, fpA);
    const t2 = kiraOf(t2y)?.kiraId;
    kontrol("§1a uçtan yoklama → NORMAL çocuk", (await karar(t1)) === "NORMAL" && (await karar(t2)) === "NORMAL");

    console.log("\n§2 (b) ağ tekrarı — 15 dk içinde aynı uç");
    const oncekiSayi = await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
    const tekrar = await yokla(k.kurulumId, anahtar, t1 ?? null, fpA);
    kontrol("§2a aynı çocuk kira döner (idempotent)", tekrar.status === 200 && tekrar.json.kira === t2y.json.kira, `${tekrar.status}`);
    kontrol("§2b yeni kira satırı YOK", (await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } })) === oncekiSayi);
    const sonYoklama = await prisma.yoklama.findFirst({ where: { kurulumId: k.kurulumDbId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    kontrol("§2c yoklama telemetrisi sonucu TEKRAR", sonYoklama?.sonuc === "TEKRAR", sonYoklama?.sonuc);

    console.log("\n§3 (a) snapshot geri alma — aynı parmak izi, eski uç");
    const yakala = await yokla(k.kurulumId, anahtar, t0, fpA);
    const t3 = kiraOf(yakala)?.kiraId;
    const t3satir = t3 ? await prisma.kira.findUnique({ where: { id: t3 } }) : null;
    kontrol("§3a eski uçla yoklama → 200, YAKALA, ucun çocuğu", yakala.status === 200 && t3satir?.karar === "YAKALA" && t3satir.oncekiKiraId === t2);
    kontrol("§3b kopya uyarısı YOK", (await prisma.kopyaUyarisi.count({ where: { kurulumId: k.kurulumDbId } })) === 0);

    console.log("\n§4 (c) çatal — iki farklı makine aynı zinciri taşıyor");
    const kabulOnce = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).kabulEdilenParmakIzi;
    const klon1 = await yokla(k.kurulumId, anahtar, t0, fpB);
    const t4 = kiraOf(klon1);
    kontrol("§4a ✓K ilk pencere: eşleşmeyen taraf YİNE kira alır (anında red yok)", klon1.status === 200 && (await karar(t4?.kiraId)) === "CATAL", `${klon1.status} ${klon1.kod ?? ""}`);
    const uyari = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k.kurulumDbId, tur: "ZINCIR_CATALI", durum: "ACIK" } });
    kontrol("§4b ZINCIR_CATALI uyarısı açıldı", uyari !== null && JSON.stringify(uyari.digerParmakIzi) === JSON.stringify(fpB));
    const kabulSonra = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§4c çatalda kabul edilen küme KAYMADI; klonun kirası sahibin kümesini taşır", JSON.stringify(kabulSonra) === JSON.stringify(kabulOnce) && JSON.stringify(t4?.parmakIzi) === JSON.stringify(fpA));
    const sahip1 = await yokla(k.kurulumId, anahtar, t3 ?? null, fpA);
    kontrol("§4d sahip taraf (geride kaldı) → 200", sahip1.status === 200, `${sahip1.status} ${sahip1.kod ?? ""}`);
    await bekle(PENCERE_SN * 1000 + 300);
    const klon2 = await yokla(k.kurulumId, anahtar, t4?.kiraId ?? null, fpB);
    kontrol("§4e ikinci pencere: eşleşmeyen taraf → 403 KIRA_VERILMEDI", klon2.status === 403 && klon2.kod === "KIRA_VERILMEDI", `${klon2.status} ${klon2.kod}`);
    const redSonrasi = await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uyari!.id } });
    kontrol("§4f red uyarıya işlendi (redZamani, görülme sayısı)", redSonrasi.redZamani !== null && redSonrasi.gorulmeSayisi >= 3, `görülme ${redSonrasi.gorulmeSayisi}`);
    const redYoklama = await prisma.yoklama.findFirst({ where: { kurulumId: k.kurulumDbId, sonuc: "RED_KIRA_VERILMEDI" } });
    kontrol("§4g red yoklama telemetrisinde (kira yok)", redYoklama !== null && redYoklama.kiraId === null);
    const sahip2 = await yokla(k.kurulumId, anahtar, kiraOf(sahip1)?.kiraId ?? null, fpA);
    kontrol("§4h ✓K sahip taraf ikinci pencerede de → 200", sahip2.status === 200, `${sahip2.status} ${sahip2.kod ?? ""}`);

    console.log("\n§5 kabul edilen kümenin kayması");
    const tekEtken = digestFingerprint({ ...HAM_PARMAK_IZI, f3: "YENIDISK2027" }, f.tuz);
    const anahtar2 = kurulumAnahtariUret();
    const { k: k2, t0: s0 } = await etkinlestir(anahtar2);
    const s1y = await yokla(k2.kurulumId, anahtar2, s0, tekEtken);
    const s1 = kiraOf(s1y);
    const kabul2 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k2.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§5a tek etken değişti (disk) → küme kayar, kira yeni kümeyi taşır", JSON.stringify(kabul2) === JSON.stringify(tekEtken) && JSON.stringify(s1?.parmakIzi) === JSON.stringify(tekEtken));
    const s2y = await yokla(k2.kurulumId, anahtar2, s1?.kiraId ?? null, fpB);
    const kabul3 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k2.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§5b iki etken birden değişti → küme KAYMAZ (kira yine verilir)", s2y.status === 200 && JSON.stringify(kabul3) === JSON.stringify(tekEtken), `${s2y.status}`);

    console.log("\n§6 kopyalanan LICENSE_DIR — kabul edilen kümeyle ESLESMEDI");
    const anahtar3 = kurulumAnahtariUret();
    const { k: k3, t0: u0 } = await etkinlestir(anahtar3);
    const u1y = await yokla(k3.kurulumId, anahtar3, u0, fpC);
    const u1 = kiraOf(u1y);
    const uy = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k3.kurulumDbId, tur: "PARMAK_IZI_UYUSMAZ" } });
    kontrol("§6a ilk pencere: kira verilir (sahibin kümesiyle) + PARMAK_IZI_UYUSMAZ uyarısı", u1y.status === 200 && uy !== null && JSON.stringify(u1?.parmakIzi) === JSON.stringify(fpA));
    await bekle(PENCERE_SN * 1000 + 300);
    const u2y = await yokla(k3.kurulumId, anahtar3, u1?.kiraId ?? null, fpC);
    kontrol("§6b ikinci pencere: 403 KIRA_VERILMEDI", u2y.status === 403 && u2y.kod === "KIRA_VERILMEDI", `${u2y.status} ${u2y.kod}`);
    // Meşru donanım değişimi: satıcı uyarıyı kapatır ve ölçülen kümeyi kabul eder → kira döner.
    await closeCopyAlert({ alertId: uy!.id, acceptOtherFingerprint: true, reason: "anakart değişti — müşteriyle doğrulandı", actor: "bekci" });
    const u3y = await yokla(k3.kurulumId, anahtar3, u1?.kiraId ?? null, fpC);
    const kabul4 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k3.kurulumDbId } })).kabulEdilenParmakIzi;
    const kapandi = await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uy!.id } });
    kontrol("§6c uyarı kapatılıp küme kabul edilince → 200, kabul edilen küme = yeni makine, uyarı KAPANDI", u3y.status === 200 && JSON.stringify(kabul4) === JSON.stringify(fpC) && kapandi.durum === "KAPANDI", `${u3y.status} ${u3y.kod ?? ""}`);
    let ikinciKapanis = "";
    try {
      await closeCopyAlert({ alertId: uy!.id, acceptOtherFingerprint: false, reason: "tekrar", actor: "bekci" });
    } catch (err) {
      ikinciKapanis = String((err as { status?: number }).status);
    }
    kontrol("§6d kapalı uyarı ikinci kez kapatılamaz → 409", ikinciKapanis === "409");

    console.log("\n§7 ardışık 'yakala' — ayırt edilemeyen kopya (yalnız uyarı)");
    const anahtar4 = kurulumAnahtariUret();
    const { k: k4, t0: v0 } = await etkinlestir(anahtar4);
    const v1 = kiraOf(await yokla(k4.kurulumId, anahtar4, v0, fpA))!.kiraId;
    kiraOf(await yokla(k4.kurulumId, anahtar4, v1, fpA));
    const y1 = await yokla(k4.kurulumId, anahtar4, v0, fpA);
    const y2 = await yokla(k4.kurulumId, anahtar4, v1, fpA);
    const y3 = await yokla(k4.kurulumId, anahtar4, v0, fpA);
    const yakalaSayisi = await prisma.kira.count({ where: { kurulumId: k4.kurulumDbId, karar: "YAKALA" } });
    const ayni = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k4.kurulumDbId, tur: "AYNI_PARMAK_IZI_TEKRAR" } });
    kontrol("§7a üç yakalama → AYNI_PARMAK_IZI_TEKRAR uyarısı, hiçbiri reddedilmedi", yakalaSayisi === 3 && ayni !== null && [y1, y2, y3].every((y) => y.status === 200), `yakala=${yakalaSayisi}`);
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
