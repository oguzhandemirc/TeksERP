// =============================================================================
// BAYİ SAHİPLİĞİ (D10 + D8'in bayi ayağı) — bayi yalnız KENDİ müşterisinin kaydında işlem yapar ve bu
// sahiplik eylemin tx'inde müşteri kilidi ALTINDA okunur; müşterinin bayisini değiştirmek yalnız YÖNETİCİ,
// eski + yeni bayi kilidiyle ve yeni bayinin GÜNCEL tavanı müşterinin canlı kurulumlarını kaldırıyorsa.
//   §1 bayi değişimi yetkisi: operatör 403 (ad değişikliği serbest) · yönetici geçer; yeni müşteriyi bayiye
//      bağlamak da atamadır (operatör 403, bayisiz müşteri serbest)
//   §2 tavan denetimi: adet ve kanal dışı → 409 BAYI_TAVANI_ASILDI, müşteri bağı değişmedi; tavan genişleyince 200
//   §3 kilit altında sahiplik: müşteri başka bayiye geçtikten sonra ESKİ bayinin tx'leri (tesis · kurulum · hak
//      taslağı · kod) BULUNAMADI ile düşer — rota ön okuması atlatılsa da
//   §4 bayi YALNIZ hiç etkinleşmemiş kuruluma kod üretir; ETKİN kuruluma 409 (makine değişimi satıcı onaylı taşıma)
//   §5 bayi görünümünde `yapan`: satıcı kullanıcı adı ve başka bayinin kullanıcı adı gösterilmez, kendi adı görünür
// ⭐ KALICI SONDA ✓K3 (her koşumda): bayi değişimi olmayan güncelleme operatöre açık · yeni bayinin tx'i
//    (aynı fonksiyon) GEÇER — ret sahiplikten, körü körüne değil · etkinleşmemiş kuruluma bayi kodu 201.
// Koşum: npx tsx scripts/test_bayi_sahipligi.ts   (kendi _test DB'si)
// =============================================================================
import { randomUUID } from "node:crypto";
import { DAY_MS, ENDPOINTS } from "../src/lisans-protokol";
import { runAsCli } from "../src/lib/request-scope";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  bayiKurulumlari,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kanalFiksturu,
  kapat,
  kontrol,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  type PortalYanit,
} from "./lib/test-ortam";

const KANAL = "bekci-sahiplik-kanal";
const KANAL_DISI = "bekci-sahiplik-disi";
const MODULLER = ["production.enabled", "finance.enabled"];

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx, f } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const ownershipSvc = await import("../src/services/dealer-ownership.service");
  const masterSvc = await import("../src/services/master-data.service");
  const hakSvc = await import("../src/services/entitlement.service");
  const { passwordBuffer } = await import("../src/keys/key-files");
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const musteriler: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  try {
    await kanalFiksturu(KANAL);
    await kanalFiksturu(KANAL_DISI);
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    const operator = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id, operator.id);
    const yCerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez!;
    const oCerez = (await portalGiris(sunucu.tailnet, "/portal/api", operator)).cerez!;
    const satici = (yol: string, govde?: unknown, yontem?: string, cerez = yCerez) => portalIstek(sunucu.tailnet, `/portal/api${yol}`, { cerez, govde, yontem });
    const bayiAc = async (ad: string, kurulumAdedi: number, kanallar: string[]) => {
      const y = await satici("/bayiler", { clientToken: randomUUID(), ad, tavan: { moduller: MODULLER, siniflar: ["URETIM"], kurulumAdedi, kanallar }, sebep: "sahiplik bekçisi" });
      if (y.status !== 201) throw new Error(`bayi ${y.status} ${y.kod}`);
      const id = y.veri.id as string;
      bayiler.push(id);
      const parola = `bayi-hesap-${randomUUID()}`;
      const h = await satici("/kullanicilar", { clientToken: randomUUID(), kullaniciAdi: `bekci-${randomUUID().slice(0, 12)}`, adSoyad: "Bayi", rol: "BAYI", bayiId: id, parola });
      const hesap = h.veri.kullanici as { id: string; kullaniciAdi: string };
      kullanicilar.push(hesap.id);
      const giris = await portalGiris(sunucu.genel, "/bayi/api", { id: hesap.id, kullaniciAdi: hesap.kullaniciAdi, parola, sir: (h.veri.totp as { sir: string }).sir, rol: "BAYI" });
      const cerez = giris.cerez!;
      return { id, kullaniciAdi: hesap.kullaniciAdi, istek: (yol: string, govde?: unknown) => portalIstek(sunucu.genel, `/bayi/api${yol}`, { cerez, govde }) };
    };
    const A = await bayiAc("Bekçi Bayi A", 5, [KANAL]);
    const B = await bayiAc("Bekçi Bayi B", 0, [KANAL_DISI]);

    const m = await A.istek("/musteriler", { clientToken: randomUUID(), ad: "Sahiplik Tekstil" });
    const musteriId = m.veri.id as string;
    const t = await A.istek("/tesisler", { clientToken: randomUUID(), musteriId, ad: "Merkez" });
    const kur = await A.istek("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "URETIM", kanalKodu: KANAL });
    const kurId = kur.veri.id as string;
    if (m.status !== 201 || t.status !== 201 || kur.status !== 201) throw new Error(`bayi fikstürü ${m.status}/${t.status}/${kur.status} ${kur.kod}`);

    console.log("\n§1 bayi değişimi yetkisi");
    const opAd = await satici(`/musteriler/${musteriId}`, { clientToken: randomUUID(), ad: "Sahiplik Tekstil A.Ş." }, "PATCH", oCerez);
    kontrol("§1a ✓K bayi bağı değişmeyen güncelleme operatöre açık → 200", opAd.status === 200, `${opAd.status} ${opAd.kod ?? ""}`);
    const opBayi = await satici(`/musteriler/${musteriId}`, { clientToken: randomUUID(), bayiId: B.id }, "PATCH", oCerez);
    const opBayiNull = await satici(`/musteriler/${musteriId}`, { clientToken: randomUUID(), bayiId: null }, "PATCH", oCerez);
    kontrol("§1b operatör bayiyi değiştiremez ya da kaldıramaz → 403 YETKISIZ", opBayi.status === 403 && opBayi.kod === "YETKISIZ" && opBayiNull.status === 403, `${opBayi.status}/${opBayiNull.status}`);
    const opYeniBayili = await satici("/musteriler", { clientToken: randomUUID(), ad: "Operatör Bayili Tekstil", bayiId: A.id }, "POST", oCerez);
    const opYeni = await satici("/musteriler", { clientToken: randomUUID(), ad: "Operatör Doğrudan Tekstil", bayiId: null }, "POST", oCerez);
    if (opYeni.status === 201) musteriler.push(opYeni.veri.id as string);
    const yYeniBayili = await satici("/musteriler", { clientToken: randomUUID(), ad: "Yönetici Bayili Tekstil", bayiId: A.id }, "POST");
    kontrol(
      "§1c yeni müşteriyi bayiye bağlamak da atama: operatör → 403 · ✓K bayisiz müşteri operatöre açık (201) · yönetici bağlar (201)",
      opYeniBayili.status === 403 && opYeniBayili.kod === "YETKISIZ" && opYeni.status === 201 && yYeniBayili.status === 201 && yYeniBayili.veri.bayiId === A.id,
      `${opYeniBayili.status}/${opYeni.status}/${yYeniBayili.status}`,
    );

    console.log("\n§2 yeni bayinin tavanı");
    const asim = await satici(`/musteriler/${musteriId}`, { clientToken: randomUUID(), bayiId: B.id }, "PATCH");
    const ihlal = (y: PortalYanit) => JSON.stringify((y.json.details as { ihlaller?: unknown } | undefined)?.ihlaller ?? []);
    const bag0 = (await prisma.musteri.findUniqueOrThrow({ where: { id: musteriId } })).bayiId;
    kontrol(
      "§2a yönetici: B'nin adedi 0 ve kanalı başka → 409 BAYI_TAVANI_ASILDI (ADET + KANAL), bağ değişmedi",
      asim.status === 409 && asim.kod === "BAYI_TAVANI_ASILDI" && ihlal(asim).includes("ADET") && ihlal(asim).includes(KANAL) && bag0 === A.id,
      `${asim.status} ${asim.kod} ${ihlal(asim)}`,
    );
    await satici(`/bayiler/${B.id}/tavan`, { clientToken: randomUUID(), tavan: { moduller: MODULLER, siniflar: ["URETIM"], kurulumAdedi: 3, kanallar: [KANAL, KANAL_DISI] }, sebep: "devir" });
    const gecis = await satici(`/musteriler/${musteriId}`, { clientToken: randomUUID(), bayiId: B.id }, "PATCH");
    const bag1 = (await prisma.musteri.findUniqueOrThrow({ where: { id: musteriId } })).bayiId;
    kontrol("§2b tavan genişleyince yönetici geçirir → 200, müşteri B'nin", gecis.status === 200 && bag1 === B.id, `${gecis.status} ${gecis.kod ?? ""}`);

    console.log("\n§3 kilit altında sahiplik (eski bayi A artık düşer)");
    const tesis = await masterSvc.findSite(prisma, t.veri.id as string);
    const sonuc3: Record<string, string> = {};
    const dene = async (ad: string, is: () => Promise<unknown>) => {
      try {
        await is();
        sonuc3[ad] = "GECTI";
      } catch (err) {
        sonuc3[ad] = (err as { code?: string }).code ?? String(err);
      }
    };
    await dene("tesis", () => prisma.$transaction((tx) => masterSvc.createSiteTx(tx, { customerId: musteriId, name: "Depo", dealerId: A.id })));
    await dene("kurulum", () => prisma.$transaction((tx) => ownershipSvc.createDealerInstallationTx(tx, { dealerId: A.id, site: tesis, siteId: tesis.id, licenseClass: "URETIM", channelCode: KANAL })));
    await dene("hak", () =>
      prisma.$transaction((tx) =>
        ownershipSvc.createDealerEntitlementTx(tx, { dealerId: A.id, customerId: musteriId, licenseClass: "URETIM", installationDbId: kurId, modules: MODULLER, perpetual: false, maintenanceUntil: new Date(Date.now() + 200 * DAY_MS), nowMs: Date.now() }),
      ),
    );
    await dene("kod", () => prisma.$transaction((tx) => ownershipSvc.createDealerActivationCodeTx(tx, ctx, { dealerId: A.id, customerId: musteriId, installationDbId: kurId, actor: "bekci" })));
    kontrol("§3a eski bayinin tesis · kurulum · hak taslağı · kod tx'leri → BULUNAMADI", Object.values(sonuc3).every((v) => v === "BULUNAMADI"), JSON.stringify(sonuc3));
    const rotadan = await A.istek(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    kontrol("§3b rota da eski bayiye → 404", rotadan.status === 404, `${rotadan.status}`);
    let yeniBayi = "";
    await prisma
      .$transaction((tx) => masterSvc.createSiteTx(tx, { customerId: musteriId, name: "Depo B", dealerId: B.id }))
      .then(() => (yeniBayi = "GECTI"))
      .catch((err: { code?: string }) => (yeniBayi = err.code ?? String(err)));
    kontrol("§3c ✓K aynı tx yeni bayi (B) ile GEÇER", yeniBayi === "GECTI", yeniBayi);

    console.log("\n§4 bayi kodu yalnız etkinleşmemiş kuruluma");
    const hak = await hakSvc.createEntitlement({ installationDbId: kurId, modules: MODULLER, perpetual: false, maintenanceUntil: new Date(Date.now() + 200 * DAY_MS), actor: "bekci" });
    await runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: hak.id, password: passwordBuffer(TEST_KOK_PAROLASI), reason: "sahiplik bekçisi", actor: "bekci" }));
    const ilkKod = await B.istek(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    kontrol("§4a ✓K etkinleşmemiş kuruluma bayi kodu → 201", ilkKod.status === 201 && typeof ilkKod.veri.kod === "string", `${ilkKod.status} ${ilkKod.kod ?? ""}`);
    const kurulum = await prisma.kurulum.findUniqueOrThrow({ where: { id: kurId } });
    const anahtar = kurulumAnahtariUret();
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: null,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: String(ilkKod.veri.kod), kurulumId: null, anahtar, parmakIzi: f.parmakIzi }),
    });
    kontrol("§4b bayinin kodu kimliksiz etkinleştirir (kurulumu kod belirler)", et.status === 200 && et.json.kurulumId === kurulum.kurulumId, `${et.status} ${et.kod ?? ""}`);
    const etkinKod = await B.istek(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    kontrol("§4c ETKİN kuruluma bayi kodu → 409 DURUM_CAKISMASI (taşıma satıcı onaylı)", etkinKod.status === 409 && etkinKod.kod === "DURUM_CAKISMASI", `${etkinKod.status} ${etkinKod.kod}`);

    console.log("\n§5 bayi görünümünde yapan");
    await satici(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    const bGorunum = await B.istek(`/kurulumlar/${kurId}`);
    const sGorunum = await satici(`/kurulumlar/${kurId}`);
    const yapanlar = (y: PortalYanit) => ((y.veri.etkinlestirmeKodlari as { yapan: string }[] | undefined) ?? []).map((k) => k.yapan);
    const bY = yapanlar(bGorunum);
    const sY = yapanlar(sGorunum);
    kontrol(
      "§5a bayi görünümü: satıcı kullanıcısı 'satici', kendi hesabı adıyla; satıcı görünümü tam ad",
      bY.includes("satici") && !bY.some((y) => y.startsWith("satici:")) && bY.includes(`bayi:${B.kullaniciAdi}`) && sY.includes(`satici:${yonetici.kullaniciAdi}`),
      `bayi: ${bY.join(",")} · satıcı: ${sY.join(",")}`,
    );
    const surum2 = await satici(`/haklar/${hak.id}/surum`, { clientToken: randomUUID(), kokParolasi: TEST_KOK_PAROLASI, sebep: "portal imzası" });
    if (surum2.status !== 201) throw new Error(`portal imzası ${surum2.status} ${surum2.kod}`);
    const hakGorunum = await B.istek(`/haklar/${hak.id}`);
    const hakYapan = ((hakGorunum.veri.surumler as { yapan: string }[] | undefined) ?? []).map((v) => v.yapan);
    const sHak = await satici(`/haklar/${hak.id}`);
    const sHakYapan = ((sHak.veri.surumler as { yapan: string }[] | undefined) ?? []).map((v) => v.yapan);
    kontrol(
      "§5b hak sürümlerinde de satıcı kullanıcı adı yok (satıcı görünümünde var)",
      hakGorunum.status === 200 && hakYapan.includes("satici") && !hakYapan.some((y) => y.startsWith("satici:")) && sHakYapan.includes(`satici:${yonetici.kullaniciAdi}`),
      `${hakYapan.join(",")} · ${sHakYapan.join(",")}`,
    );
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(await bayiKurulumlari(bayiler), ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler, musteriler, kanallar: [KANAL, KANAL_DISI] });
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
