// =============================================================================
// PORTAL — BAYİ TAVANI AŞIMI RED. Bayi imzalı HAK iki katmanla sınırlıdır: (1) protokolün
// KRİPTOGRAFİK kısıtı — bayi sertifikasındaki modül/sınıf (fabrika da denetler) · (2) EK olarak
// sunucuda bayinin GÜNCEL tavanı (modül ⊆ · sınıf ⊆ · kurulum adedi · kanal ⊆ · kalıcı izni · bakım
// ay tavanı — yönetici kararı g). Sertifika geniş kalsa da
// sonradan daraltılan tavan bağlar; tavan sertifikadan genişse sertifika bağlar. Denetim imzadan
// ÖNCE ve deftere yazarken bayi kilidi ALTINDA yeniden yapılır. Tavan sürümlü defterdir.
//   §0 portal modül kataloğu = backend MODULE_SETTING_KEYS ∪ {patron-bulut}
//   §9 kalıcı izni (varsayılan HAYIR) + bakım ay tavanı sürüm imzasında da bağlar
// Ölçüm gerçek HTTP ile (süreç içi iki dinleyici: satıcı tailnet, bayi genel; kendi `_test` DB'si).
// ⭐ KALICI SONDA ✓K5 (her koşumda): (1) tavan içindeki HAK imzalanır ve protokolden BAYİ imzalı
//    olarak geçer · (2) sertifikanın izin verdiği ama tavanın dışındaki modüllü HAK'ı protokol
//    TEK BAŞINA kabul eder (sunucu katmanı gerçekten EK) · (3) tavan tekrar genişleyince aynı
//    işlem geçer (ret tavandan, körlükten değil) · (4) atanmamış kanal RED, atanmış kanal geçer ·
//    (5) kalıcı izni/bakım tavanı genişleyince aynı imza geçer.
// Koşum: npx tsx scripts/test_portal_bayi_tavani.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DAY_MS, EntitlementSchema, TYP, signDocument, verifyEntitlement } from "../src/lisans-protokol";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { PORTAL_MODULE_KEYS } from "../src/portal/module-catalog";
import { MODULE_SETTING_KEYS } from "../../../Teks-Erp/src/constants/module-flags";
import { hakYuku, sertifikaBas, sertifikaYuku } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  bayiKurulumlari,
  hedefDbKapisi,
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

const BAYI_PAROLASI = "bekci-bayi-parolasi-2026";
const URETIM = "production.enabled";
const FINANS = "finance.enabled";
const TICARET = "ticaret.enabled";
const DOKUMA = "dokuma.enabled";
const KANAL = "bayi-kanal";
const KANAL_DISI = "bayi-kanal-disi";
const yilSonra = (gun = 365): string => new Date(Date.now() + gun * DAY_MS).toISOString();

const ihlal = (y: PortalYanit): string =>
  JSON.stringify((y.json.details as { ihlaller?: unknown; protokolKodu?: unknown } | undefined) ?? {});

async function main(): Promise<void> {
  console.log("\n§0 modül kataloğu");
  const beklenen = new Set([...MODULE_SETTING_KEYS, "patron-bulut"]);
  const portal = new Set<string>(PORTAL_MODULE_KEYS);
  const eksik = [...beklenen].filter((m) => !portal.has(m));
  const fazla = [...portal].filter((m) => !beklenen.has(m));
  kontrol("§0 PORTAL_MODULE_KEYS = MODULE_SETTING_KEYS ∪ {patron-bulut}", eksik.length === 0 && fazla.length === 0 && portal.size >= 5, `eksik: ${eksik.join(",")} · fazla: ${fazla.join(",")}`);

  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx, f } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const dealerSvc = await import("../src/services/dealer.service");
  const ownershipSvc = await import("../src/services/dealer-ownership.service");
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const yCerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez!;
    const satici = (yol: string, govde?: unknown) => portalIstek(sunucu.tailnet, `/portal/api${yol}`, { cerez: yCerez, govde });
    const tavanYaz = (bayiId: string, moduller: string[], siniflar: string[], kurulumAdedi: number, sebep: string, ek: { kaliciIzni?: boolean; bakimAyTavani?: number } = {}) =>
      satici(`/bayiler/${bayiId}/tavan`, { clientToken: randomUUID(), tavan: { moduller, siniflar, kurulumAdedi, kanallar: [KANAL], ...ek }, sebep });
    await kanalFiksturu(KANAL);
    await kanalFiksturu(KANAL_DISI);

    console.log("\n§1 bayi hesabı + anahtar");
    const kayitsizKanal = await satici("/bayiler", { clientToken: randomUUID(), ad: "Bekçi Bayi", tavan: { moduller: [URETIM], siniflar: ["URETIM"], kurulumAdedi: 1, kanallar: ["kayitsiz-kanal-yok"] }, sebep: "x" });
    kontrol("§1a0 tavana kayıtsız kanal yazılamaz → 400", kayitsizKanal.status === 400, `${kayitsizKanal.status} ${kayitsizKanal.kod ?? ""}`);
    const bayiY = await satici("/bayiler", { clientToken: randomUUID(), ad: "Bekçi Bayi", tavan: { moduller: [URETIM, FINANS], siniflar: ["URETIM"], kurulumAdedi: 2, kanallar: [KANAL] }, sebep: "yeni bayi sözleşmesi" });
    const bayiId = bayiY.veri.id as string;
    bayiler.push(bayiId);
    const v1 = bayiY.veri.tavan as { surum?: number; kaliciIzni?: boolean; bakimAyTavani?: number; kanallar?: string[] };
    kontrol(
      "§1a bayi + tavan v1 → 201; kalıcı izni varsayılan HAYIR, bakım tavanı 12 ay, kanal atandı",
      bayiY.status === 201 && v1.surum === 1 && v1.kaliciIzni === false && v1.bakimAyTavani === 12 && JSON.stringify(v1.kanallar) === JSON.stringify([KANAL]),
      `${bayiY.status} ${bayiY.kod ?? ""} ${JSON.stringify(v1)}`,
    );
    // Sertifika tavandan GENİŞ: TICARET ve TEST sertifikada var, tavanda yok.
    const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, f.bayi, "BAYI", { siniflar: ["URETIM", "TEST"], bayi: { bayiId, moduller: [URETIM, FINANS, TICARET] } }));
    writeKeyFileExclusive(
      path.join(ortam.dizin, `${f.bayi.kid}.bayi.json`),
      await wrapPrivateKey({ tur: "tekserp-bayi-anahtar", kid: f.bayi.kid, siniflar: ["URETIM", "TEST"], sertifika }, f.bayi.privateKey, passwordBuffer(BAYI_PAROLASI)),
    );
    const yanlisKid = await satici(`/bayiler/${bayiId}/anahtar`, { clientToken: randomUUID(), kid: "bayi-olmayan" });
    const bagla = await satici(`/bayiler/${bayiId}/anahtar`, { clientToken: randomUUID(), kid: f.bayi.kid });
    kontrol("§1b dizinde olmayan anahtar → 400; bayinin sertifikalı anahtarı → 200", yanlisKid.status === 400 && bagla.status === 200 && bagla.veri.anahtarKid === f.bayi.kid, `${yanlisKid.status}/${bagla.status}`);
    const bayiParolasiHesap = `bayi-hesap-${randomUUID()}`;
    const bayiHesap = await satici("/kullanicilar", { clientToken: randomUUID(), kullaniciAdi: `bekci-${randomUUID().slice(0, 12)}`, adSoyad: "Bayi Kullanıcı", rol: "BAYI", bayiId, parola: bayiParolasiHesap });
    const hesap = bayiHesap.veri.kullanici as { id: string; kullaniciAdi: string; rol: string; bayiId: string };
    const hesapTotp = bayiHesap.veri.totp as { sir: string };
    kullanicilar.push(hesap.id);
    const bGiris = await portalGiris(sunucu.genel, "/bayi/api", { id: hesap.id, kullaniciAdi: hesap.kullaniciAdi, parola: bayiParolasiHesap, sir: hesapTotp.sir, rol: "BAYI" });
    kontrol("§1c yönetici bayi hesabı açar (BAYI + bayiId); hesap genelden girer", bayiHesap.status === 201 && hesap.rol === "BAYI" && hesap.bayiId === bayiId && bGiris.status === 200, `${bayiHesap.status}/${bGiris.status}`);
    const bCerez = bGiris.cerez!;
    const bayi = (yol: string, govde?: unknown) => portalIstek(sunucu.genel, `/bayi/api${yol}`, { cerez: bCerez, govde });

    console.log("\n§2 kurulum: sınıf tavanı");
    const m = await bayi("/musteriler", { clientToken: randomUUID(), ad: "Bayi Müşterisi Tekstil" });
    const t = await bayi("/tesisler", { clientToken: randomUUID(), musteriId: m.veri.id, ad: "Merkez" });
    const kur = await bayi("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "URETIM", kanalKodu: KANAL });
    kontrol("§2a müşteri · tesis · URETIM kurulum → 201", m.status === 201 && t.status === 201 && kur.status === 201, `${m.status}/${t.status}/${kur.status} ${kur.kod ?? ""}`);
    const testSinif = await bayi("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "TEST", kanalKodu: KANAL });
    kontrol("§2b TEST (sertifikada VAR, tavanda YOK) → 409 BAYI_TAVANI_ASILDI · SINIF", testSinif.status === 409 && testSinif.kod === "BAYI_TAVANI_ASILDI" && ihlal(testSinif).includes("SINIF"), `${testSinif.status} ${ihlal(testSinif)}`);
    const kanalDisi = await bayi("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "URETIM", kanalKodu: KANAL_DISI });
    kontrol("§2c ✓K kayıtlı ama bayiye ATANMAMIŞ kanal → 409 · KANAL (atanmış kanal §2a'da geçti)", kanalDisi.status === 409 && kanalDisi.kod === "BAYI_TAVANI_ASILDI" && ihlal(kanalDisi).includes(KANAL_DISI), `${kanalDisi.status} ${ihlal(kanalDisi)}`);
    const kurId = kur.veri.id as string;

    console.log("\n§3 HAK: modül tavanı + bayi imzası");
    const kalici = await bayi(`/kurulumlar/${kurId}/hak`, { clientToken: randomUUID(), moduller: [URETIM, FINANS], kalici: true, bakimBitis: yilSonra() });
    kontrol("§3a0 kalıcı izni yokken KALICI taslak → 409 · KALICI", kalici.status === 409 && ihlal(kalici).includes("KALICI"), `${kalici.status} ${ihlal(kalici)}`);
    const uzunBakim = await bayi(`/kurulumlar/${kurId}/hak`, { clientToken: randomUUID(), moduller: [URETIM, FINANS], kalici: false, bakimBitis: yilSonra(400) });
    kontrol("§3a1 bakım bitişi 12 ay tavanını aşan taslak → 409 · BAKIM", uzunBakim.status === 409 && ihlal(uzunBakim).includes("BAKIM"), `${uzunBakim.status} ${ihlal(uzunBakim)}`);
    const ticaretli = await bayi(`/kurulumlar/${kurId}/hak`, { clientToken: randomUUID(), moduller: [URETIM, TICARET], kalici: false, bakimBitis: yilSonra() });
    kontrol("§3a TICARET (sertifikada VAR, tavanda YOK) → 409 · MODUL", ticaretli.status === 409 && ihlal(ticaretli).includes(TICARET), `${ticaretli.status} ${ihlal(ticaretli)}`);
    const hak = await bayi(`/kurulumlar/${kurId}/hak`, { clientToken: randomUUID(), moduller: [URETIM, FINANS], kalici: false, bakimBitis: yilSonra() });
    const hakId = hak.veri.id as string;
    kontrol("§3b tavan içindeki taslak → 201", hak.status === 201, `${hak.status} ${hak.kod ?? ""}`);
    const yanlisParola = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), bayiParolasi: "yanlis-bayi-parolasi", sebep: "ilk imza" });
    const hak0 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol("§3c yanlış bayi parolası → 400 IMZA_PAROLASI_HATALI, sürüm yazılmadı", yanlisParola.status === 400 && yanlisParola.kod === "IMZA_PAROLASI_HATALI" && hak0.guncelSurum === 0, `${yanlisParola.status} ${yanlisParola.kod}`);
    const imza = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), bayiParolasi: BAYI_PAROLASI, sebep: "ilk imza" });
    const surum1 = await prisma.hakSurumu.findFirst({ where: { hakId, surum: 1 } });
    const dogrula = surum1 ? verifyEntitlement(surum1.belge, f.kokler) : null;
    kontrol(
      "§3d ✓K tavan içinde bayi imzası → 201; protokolden BAYİ imzalı geçer, bayiId bu bayi",
      imza.status === 201 && surum1?.imzalayanKid === f.bayi.kid && dogrula?.ok === true && dogrula.value.signer.kind === "BAYI" && dogrula.value.document.bayiId === bayiId,
      `${imza.status} ${imza.kod ?? ""} ${dogrula && !dogrula.ok ? dogrula.code : ""}`,
    );

    console.log("\n§4 tavan DARALIR — sertifika hâlâ geniş");
    const v2 = await tavanYaz(bayiId, [URETIM], ["URETIM"], 2, "finans satışı durdu");
    kontrol("§4a tavan v2 (yalnız üretim) → 201", v2.status === 201 && v2.veri.surum === 2);
    const elle = signDocument({
      typ: TYP.HAK,
      schema: EntitlementSchema,
      payload: hakYuku(f, { moduller: [URETIM, FINANS], bayiId, bayiSertifikasi: sertifika }),
      key: f.bayi,
    });
    const protokolTekBasina = verifyEntitlement(elle, f.kokler);
    kontrol("§4b ✓K protokol TEK BAŞINA finanslı bayi HAK'ını KABUL eder (sertifika izin veriyor)", protokolTekBasina.ok, protokolTekBasina.ok ? "" : protokolTekBasina.code);
    const yeniden = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), bayiParolasi: BAYI_PAROLASI, sebep: "bakım yenileme" });
    const hak1 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol("§4c aynı modüllerle yeniden imza → 409 BAYI_TAVANI_ASILDI (GÜNCEL tavan), sürüm 1'de kaldı", yeniden.status === 409 && yeniden.kod === "BAYI_TAVANI_ASILDI" && ihlal(yeniden).includes(FINANS) && hak1.guncelSurum === 1, `${yeniden.status} ${ihlal(yeniden)}`);
    const kodEski = await bayi(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    kontrol("§4d tavan dışı kalmış imzalı hak için KOD üretilemez → 409", kodEski.status === 409 && kodEski.kod === "BAYI_TAVANI_ASILDI", `${kodEski.status} ${kodEski.kod}`);
    const daralt = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), bayiParolasi: BAYI_PAROLASI, sebep: "tavana uyum", moduller: [URETIM] });
    const kod = await bayi(`/kurulumlar/${kurId}/etkinlestirme-kodu`, { clientToken: randomUUID() });
    kontrol("§4e hak tavana indirilince imza 201 ve kod üretilir (düz kod yalnız bu yanıtta)", daralt.status === 201 && kod.status === 201 && /^TKS(-[0-9A-Z]{4}){4}$/.test(String(kod.veri.kod)), `${daralt.status}/${kod.status}`);

    console.log("\n§5 kurulum ADEDİ");
    await tavanYaz(bayiId, [URETIM, FINANS], ["URETIM"], 1, "tek kurulum hakkı");
    const ikinci = await bayi("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "URETIM", kanalKodu: KANAL });
    kontrol("§5a adet 1, kullanım 1 → ikinci kurulum 409 · ADET", ikinci.status === 409 && ihlal(ikinci).includes("ADET"), `${ikinci.status} ${ihlal(ikinci)}`);
    await tavanYaz(bayiId, [URETIM, FINANS], ["URETIM"], 2, "ek kurulum satıldı");
    const ikinciOk = await bayi("/kurulumlar", { clientToken: randomUUID(), tesisId: t.veri.id, sinif: "URETIM", kanalKodu: KANAL });
    kontrol("§5b ✓K tavan genişleyince aynı işlem → 201", ikinciOk.status === 201, `${ikinciOk.status} ${ikinciOk.kod ?? ""}`);

    console.log("\n§6 tavan sertifikadan GENİŞ — kriptografik katman bağlar");
    await tavanYaz(bayiId, [URETIM, FINANS, DOKUMA], ["URETIM"], 2, "dokuma eklendi (sertifika eski)");
    const dokumali = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), bayiParolasi: BAYI_PAROLASI, sebep: "dokuma", moduller: [URETIM, DOKUMA] });
    const protokolKodu = (dokumali.json.details as { protokolKodu?: string } | undefined)?.protokolKodu;
    const hak2 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol("§6 sertifikada olmayan modül → 409 (protokol BAYI_TAVAN_MODUL), sürüm yazılmadı", dokumali.status === 409 && protokolKodu === "BAYI_TAVAN_MODUL" && hak2.guncelSurum === 2, `${dokumali.status} ${protokolKodu} v${hak2.guncelSurum}`);

    console.log("\n§7 imzadan SONRA daralan tavan — kilit altında yeniden denetim");
    const hazir = await dealerSvc.prepareDealerEntitlementVersion(ctx, { dealerId: bayiId, entitlementId: hakId, changes: { modules: [URETIM, FINANS] }, password: passwordBuffer(BAYI_PAROLASI), reason: "yarış", actor: "bekci" });
    await prisma.$transaction((tx) => dealerSvc.setDealerCeilingTx(tx, { dealerId: bayiId, ceiling: { modules: [URETIM], classes: ["URETIM"], installationCount: 2, channels: [KANAL] }, reason: "imza sırasında daraldı", actor: "bekci" }));
    let yazim = "";
    try {
      await prisma.$transaction((tx) => ownershipSvc.recordDealerEntitlementVersionTx(tx, { ...hazir, customerId: t.veri.musteriId as string }));
      yazim = "YAZILDI";
    } catch (err) {
      yazim = (err as { code?: string }).code ?? String(err);
    }
    const hak3 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol("§7 hazırlanmış (imzalı) sürüm, daralan tavanla deftere YAZILMAZ → BAYI_TAVANI_ASILDI", yazim === "BAYI_TAVANI_ASILDI" && hak3.guncelSurum === 2, `${yazim} v${hak3.guncelSurum}`);

    console.log("\n§8 tavan defteri");
    const gecmis = await satici(`/bayiler/${bayiId}`);
    const surumler = ((gecmis.veri.tavanGecmisi as { surum: number }[] | undefined) ?? []).map((x) => x.surum);
    kontrol("§8a her tavan değişimi yeni sürüm satırı (1…6, azalan)", JSON.stringify(surumler) === JSON.stringify([6, 5, 4, 3, 2, 1]), surumler.join(","));
    let red = "";
    try {
      await prisma.$executeRawUnsafe(`UPDATE bayi_tavani SET "kurulumAdedi" = 99 WHERE "bayiId" = '${bayiId}'`);
    } catch (err) {
      red = (err as Error).message;
    }
    kontrol("§8b DB seddi: tavan satırı düzeltilemez", /Defter satırı/.test(red));
    const bayiYaptirim = await bayi(`/kurulumlar/${kurId}/yaptirim`, { clientToken: randomUUID(), kademe: "K0", sebep: "x" });
    kontrol("§8c bayi alt-portalında yaptırım ucu YOK → 404", bayiYaptirim.status === 404, `${bayiYaptirim.status}`);

    console.log("\n§9 kalıcı izni + bakım ay tavanı sürüm imzasında");
    const kaliciSurum = { bayiParolasi: BAYI_PAROLASI, sebep: "kalıcıya çevir", kalici: true, bakimBitis: yilSonra(700) };
    const kaliciRed = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), ...kaliciSurum });
    const hak4 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol(
      "§9a izinsiz tavanla kalıcı + 23 aylık bakım sürümü → 409 · KALICI + BAKIM, sürüm yazılmadı",
      kaliciRed.status === 409 && ihlal(kaliciRed).includes("KALICI") && ihlal(kaliciRed).includes("BAKIM") && hak4.guncelSurum === 2,
      `${kaliciRed.status} ${ihlal(kaliciRed)} v${hak4.guncelSurum}`,
    );
    await tavanYaz(bayiId, [URETIM], ["URETIM"], 2, "kalıcı satış yetkisi", { kaliciIzni: true, bakimAyTavani: 24 });
    const kaliciOk = await bayi(`/haklar/${hakId}/surum`, { clientToken: randomUUID(), ...kaliciSurum });
    const hak5 = await prisma.hak.findUniqueOrThrow({ where: { id: hakId } });
    kontrol("§9b ✓K kalıcı izni + 24 ay tavanıyla aynı sürüm → 201, hak kalıcı", kaliciOk.status === 201 && hak5.kalici && hak5.guncelSurum === 3, `${kaliciOk.status} ${kaliciOk.kod ?? ""} ${ihlal(kaliciOk)}`);
  } finally {
    await sunucu.kapat();
    await temizleKurulumlar(await bayiKurulumlari(bayiler), ortam.kidler);
    await temizlePortal({ kullanicilar, bayiler });
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
