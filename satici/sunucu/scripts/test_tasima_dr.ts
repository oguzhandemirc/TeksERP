// =============================================================================
// TAŞIMA + DR DEVRALIMI — her taşıma satıcı onayıyla; DR self-servis + anında bildirim.
// Taşıma: yeni makine (aynı installationId, yeni anahtar + parmak izi) talep açar → BEKLIYOR
// (idempotent); onaydan önce yeni anahtarın yoklaması 409 TASIMA_ONAYI_BEKLIYOR, eski makine
// çalışmaya devam eder; ikinci bir anahtar 409; onay (atomik claim, ikinci onay 409) → eski anahtar
// 403 KURULUM_IPTAL, yeni anahtar kira alır (zincir kökü TASIMA); red → REDDEDILDI.
// DR: yalnız aynı tesisin ETKİN DR sınıfı kurulumu, aynı tesisin ÜRETİM kurulumunu devralır →
// ana DEVREDILDI (kurulum kaydı iki satır + denetim), anaya zil 'lisans' ≤2 sn, ana yoklamada
// `devredildi: true` kira (indirme belirteci yok); tekrar idempotent; geri alma ETKİN'e döndürür.
// İptal: kurulum IPTAL → 403 KURULUM_IPTAL, ikinci iptal 409; ters yol önceki duruma döndürür.
// ⭐ KALICI SONDA ✓K2 (her koşumda): DR sınıfı olmayan kurulum devralamaz · başka tesisin DR'si
//    devralamaz — kapı "her imzalı isteği kabul et" diye kör olsaydı kırmızı.
// Koşum: npx tsx scripts/test_tasima_dr.ts
// =============================================================================
import { ENDPOINTS, LicenseResponseSchema, digestFingerprint, parseJws, verifyLease, type Fingerprint } from "../src/lisans-protokol";
import { HAM_PARMAK_IZI, kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  ORTAM,
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
  zilAboneOl,
  type KurulumFiksturu,
  type Yanit,
} from "./lib/test-ortam";

function kiraOf(y: Yanit): { kiraId: string; kurulumAnahtarKimligi: string; devredildi: boolean } | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as { kiraId: string; kurulumAnahtarKimligi: string; devredildi: boolean }) : null;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { approveTransfer, rejectTransfer } = await import("../src/services/transfer.service");
  const { revertDrTakeover } = await import("../src/services/dr.service");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  const fpYeni: Fingerprint = digestFingerprint(
    { ...HAM_PARMAK_IZI, f1: "{0a0b0c0d-0e0f-4a4b-9c9d-0e0f0a0b0c0d}", f2: "99999999-8888-7777-6666-555555555555", f3: "YENISUNUCU01" },
    f.tuz,
  );

  const etkinlestir = async (k: KurulumFiksturu, anahtar: TestAnahtari) => {
    temizlenecek.push(k.kurulumDbId);
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: f.parmakIzi }),
    });
    const kira = kiraOf(y);
    if (!kira) throw new Error(`etkinleştirme ${y.status} ${y.kod}`);
    return kira.kiraId;
  };
  const yokla = (kurulumId: string, anahtar: TestAnahtari, sonKiraId: string | null, parmakIzi: Fingerprint = f.parmakIzi) =>
    imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId, parmakIzi }) });
  const tasi = (kurulumId: string, anahtar: TestAnahtari, parmakIzi: Fingerprint) =>
    imzaliPost(sunucu.genel, ENDPOINTS.TRANSFER, {
      kurulumId,
      amac: "tasima",
      anahtar,
      govde: { v: 1, kurulumId, acikAnahtar: anahtar.x, parmakIzi, ortam: ORTAM, gerekce: "sunucu değişti" },
    });

  try {
    console.log("\n§1 taşıma talebi");
    const eski = kurulumAnahtariUret();
    const k = await kurulumFiksturu(ctx);
    const t0 = await etkinlestir(k, eski);
    const yeni = kurulumAnahtariUret();
    const talep1 = await tasi(k.kurulumId, yeni, fpYeni);
    kontrol("§1a yeni anahtar talep açar → 200 BEKLIYOR, lisans yok", talep1.status === 200 && talep1.json.durum === "BEKLIYOR" && talep1.json.lisans === null, `${talep1.status} ${talep1.kod ?? ""}`);
    const talep2 = await tasi(k.kurulumId, yeni, fpYeni);
    kontrol("§1b tekrar → aynı talep (idempotent)", talep2.json.talepId === talep1.json.talepId && talep2.json.durum === "BEKLIYOR");
    const bekleyenYoklama = await yokla(k.kurulumId, yeni, null, fpYeni);
    kontrol("§1c onay öncesi yeni anahtarın yoklaması → 409 TASIMA_ONAYI_BEKLIYOR", bekleyenYoklama.status === 409 && bekleyenYoklama.kod === "TASIMA_ONAYI_BEKLIYOR", `${bekleyenYoklama.status} ${bekleyenYoklama.kod}`);
    const ucuncu = await tasi(k.kurulumId, kurulumAnahtariUret(), fpYeni);
    kontrol("§1d başka talep beklerken üçüncü anahtar → 409 TASIMA_ONAYI_BEKLIYOR", ucuncu.status === 409 && ucuncu.kod === "TASIMA_ONAYI_BEKLIYOR", `${ucuncu.status} ${ucuncu.kod}`);
    const eskiCalisir = await yokla(k.kurulumId, eski, t0);
    kontrol("§1e onaya dek eski makine çalışır (200)", eskiCalisir.status === 200);

    console.log("\n§2 onay");
    const talepId = String(talep1.json.talepId);
    await approveTransfer({ talepId, actor: "bekci", reason: "müşteri sunucu değiştirdi" });
    let ikinciOnay = "";
    try {
      await approveTransfer({ talepId, actor: "bekci", reason: "ikinci kez" });
    } catch (err) {
      ikinciOnay = (err as { code?: string; status?: number }).status === 409 ? "409" : String(err);
    }
    kontrol("§2a ikinci onay → 409 (atomik claim)", ikinciOnay === "409", ikinciOnay);
    const kayit = await prisma.kurulumKaydi.findFirst({ where: { kurulumId: k.kurulumDbId, olay: "TASINDI" } });
    kontrol("§2b kurulum kaydı TASINDI (eski anahtar saklı)", kayit?.eskiAnahtarKimligi === eski.kid && kayit.anahtarKimligi === yeni.kid);
    const eskiRed = await yokla(k.kurulumId, eski, kiraOf(eskiCalisir)?.kiraId ?? null);
    kontrol("§2c eski anahtar → 403 KURULUM_IPTAL", eskiRed.status === 403 && eskiRed.kod === "KURULUM_IPTAL", `${eskiRed.status} ${eskiRed.kod}`);
    const onayli = await tasi(k.kurulumId, yeni, fpYeni);
    const lisans = LicenseResponseSchema.safeParse(onayli.json.lisans);
    const yeniKira = lisans.success ? verifyLease(lisans.data.kira, f.kokler) : null;
    kontrol("§2d yeni anahtar talebi yeniden sorar → ONAYLANDI + geçerli kira", onayli.json.durum === "ONAYLANDI" && yeniKira?.ok === true && yeniKira.value.document.kurulumAnahtarKimligi === yeni.kid, `${onayli.status}`);
    const kok = yeniKira?.ok ? await prisma.kira.findUnique({ where: { id: yeniKira.value.document.kiraId } }) : null;
    kontrol("§2e yeni zincirin kökü TASIMA", kok?.karar === "TASIMA" && kok.oncekiKiraId === null);
    const yeniYoklama = await yokla(k.kurulumId, yeni, kok?.id ?? null, fpYeni);
    kontrol("§2f yeni makine yoklar → 200 NORMAL", yeniYoklama.status === 200, `${yeniYoklama.status} ${yeniYoklama.kod ?? ""}`);

    console.log("\n§3 red");
    const redAnahtar = kurulumAnahtariUret();
    const redTalep = await tasi(k.kurulumId, redAnahtar, fpYeni);
    await rejectTransfer({ talepId: String(redTalep.json.talepId), actor: "bekci", reason: "müşteri doğrulanmadı" });
    const redSonra = await tasi(k.kurulumId, redAnahtar, fpYeni);
    kontrol("§3a reddedilen talep → REDDEDILDI, lisans yok", redSonra.status === 200 && redSonra.json.durum === "REDDEDILDI" && redSonra.json.lisans === null);
    const redYoklama = await yokla(k.kurulumId, redAnahtar, null, fpYeni);
    kontrol("§3b reddedilen anahtarın yoklaması → 401 ISTEK_KID", redYoklama.status === 401 && redYoklama.kod === "ISTEK_KID", `${redYoklama.status} ${redYoklama.kod}`);

    console.log("\n§4 DR devralımı");
    const anaAnahtar = kurulumAnahtariUret();
    const ana = await kurulumFiksturu(ctx, { sinif: "URETIM" });
    const anaT0 = await etkinlestir(ana, anaAnahtar);
    const drAnahtar = kurulumAnahtariUret();
    const dr = await kurulumFiksturu(ctx, { sinif: "DR", tesisId: ana.tesisId, musteriId: ana.musteriId });
    await etkinlestir(dr, drAnahtar);
    const digerAnahtar = kurulumAnahtariUret();
    const diger = await kurulumFiksturu(ctx, { sinif: "URETIM", tesisId: ana.tesisId, musteriId: ana.musteriId });
    await etkinlestir(diger, digerAnahtar);
    const devral = (kurulumId: string, anahtar: TestAnahtari) =>
      imzaliPost(sunucu.genel, ENDPOINTS.DR_TAKEOVER, {
        kurulumId,
        amac: "dr-devral",
        anahtar,
        govde: { v: 1, anaKurulumId: ana.kurulumId, gerekce: "ana sunucu arızalı" },
      });
    const uretimDenedi = await devral(diger.kurulumId, digerAnahtar);
    kontrol("§4a ✓K DR sınıfı olmayan kurulum devralamaz → 400", uretimDenedi.status === 400 && uretimDenedi.kod === "GOVDE_GECERSIZ", `${uretimDenedi.status} ${uretimDenedi.kod}`);
    const yabanciAnahtar = kurulumAnahtariUret();
    const yabanciDr = await kurulumFiksturu(ctx, { sinif: "DR" });
    await etkinlestir(yabanciDr, yabanciAnahtar);
    const yabanciDenedi = await devral(yabanciDr.kurulumId, yabanciAnahtar);
    kontrol("§4b ✓K başka tesisin DR'si devralamaz → 400", yabanciDenedi.status === 400, `${yabanciDenedi.status} ${yabanciDenedi.kod}`);
    const anaDurum0 = await prisma.kurulum.findUniqueOrThrow({ where: { id: ana.kurulumDbId } });
    kontrol("§4c reddedilen denemeler anayı DEĞİŞTİRMEDİ", anaDurum0.durum === "ETKIN");

    const zil = await zilAboneOl(sunucu.genel, { kurulumId: ana.kurulumId, anahtar: anaAnahtar });
    const zilBekle = zil.bekleKonu("lisans", 2_000);
    const devir = await devral(dr.kurulumId, drAnahtar);
    const drKira = LicenseResponseSchema.safeParse(devir.json);
    kontrol("§4d DR devralır → 200 + DR'nin geçerli kirası", devir.status === 200 && drKira.success && verifyLease(drKira.data.kira, f.kokler).ok, `${devir.status} ${devir.kod ?? ""}`);
    const zilMs = await zilBekle;
    kontrol("§4e anaya zil 'lisans' ≤ 2 sn", zilMs !== null, zilMs === null ? "gelmedi" : `${zilMs} ms`);
    zil.kapat();
    const anaDurum = await prisma.kurulum.findUniqueOrThrow({ where: { id: ana.kurulumDbId } });
    const kayitlar = await prisma.kurulumKaydi.findMany({ where: { kurulumId: { in: [ana.kurulumDbId, dr.kurulumDbId] }, olay: { in: ["DEVREDILDI", "DR_DEVRALDI"] } } });
    const denetim = await prisma.denetim.findFirst({ where: { olay: "DR_DEVRALINDI", varlikId: ana.kurulumDbId } });
    kontrol("§4f ana DEVREDILDI + iki kurulum kaydı + denetim (satıcıya bildirim)", anaDurum.durum === "DEVREDILDI" && kayitlar.length === 2 && denetim !== null);
    const anaYoklar = await yokla(ana.kurulumId, anaAnahtar, anaT0);
    const anaKira = kiraOf(anaYoklar);
    kontrol("§4g ana yoklar → 200, kira devredildi=true, indirme belirteci yok", anaKira?.devredildi === true && Array.isArray(anaYoklar.json.indirmeBelirtecleri) && (anaYoklar.json.indirmeBelirtecleri as unknown[]).length === 0);
    const tekrar = await devral(dr.kurulumId, drAnahtar);
    const kayitlar2 = await prisma.kurulumKaydi.count({ where: { kurulumId: { in: [ana.kurulumDbId, dr.kurulumDbId] }, olay: { in: ["DEVREDILDI", "DR_DEVRALDI"] } } });
    kontrol("§4h tekrar devralma idempotent (200, yeni kayıt yok)", tekrar.status === 200 && kayitlar2 === 2);

    console.log("\n§5 ters yol");
    await revertDrTakeover({ mainInstallationDbId: ana.kurulumDbId, actor: "bekci", reason: "ana sunucu onarıldı" });
    const geri = await yokla(ana.kurulumId, anaAnahtar, anaKira?.kiraId ?? null);
    kontrol("§5a geri alma → ana ETKİN, kira devredildi=false", kiraOf(geri)?.devredildi === false && (await prisma.kurulum.findUniqueOrThrow({ where: { id: ana.kurulumDbId } })).durum === "ETKIN");
    kontrol("§5b geri alma kurulum kaydında (DR_GERI_ALINDI)", (await prisma.kurulumKaydi.count({ where: { kurulumId: ana.kurulumDbId, olay: "DR_GERI_ALINDI" } })) === 1);
    temizlenecek.push(yabanciDr.kurulumDbId);

    console.log("\n§6 kurulum iptali ve ters yolu");
    const { cancelInstallation, reinstateInstallation } = await import("../src/services/installation-admin.service");
    await cancelInstallation({ installationDbId: ana.kurulumDbId, reason: "sözleşme feshedildi", actor: "bekci" });
    const iptalYoklama = await yokla(ana.kurulumId, anaAnahtar, kiraOf(geri)?.kiraId ?? null);
    kontrol("§6a iptal edilen kurulum → 403 KURULUM_IPTAL", iptalYoklama.status === 403 && iptalYoklama.kod === "KURULUM_IPTAL", `${iptalYoklama.status} ${iptalYoklama.kod}`);
    let ikinciIptal = "";
    try {
      await cancelInstallation({ installationDbId: ana.kurulumDbId, reason: "tekrar", actor: "bekci" });
    } catch (err) {
      ikinciIptal = String((err as { status?: number }).status);
    }
    kontrol("§6b ikinci iptal → 409", ikinciIptal === "409");
    await reinstateInstallation({ installationDbId: ana.kurulumDbId, reason: "yeni sözleşme", actor: "bekci" });
    const donus = await yokla(ana.kurulumId, anaAnahtar, kiraOf(geri)?.kiraId ?? null);
    const iptalKayitlari = await prisma.kurulumKaydi.findMany({ where: { kurulumId: ana.kurulumDbId, olay: { in: ["IPTAL", "IPTAL_GERI_ALINDI"] } } });
    kontrol("§6c ters yol → önceki duruma (ETKİN) döner, yoklama 200; iki kurulum kaydı", donus.status === 200 && iptalKayitlari.length === 2, `${donus.status} ${donus.kod ?? ""}`);
  } finally {
    await sunucu.durdur();
    await temizleKurulumlar([...new Set(temizlenecek)], ortam.kidler);
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
