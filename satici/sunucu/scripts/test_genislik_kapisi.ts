// =============================================================================
// GENİŞLİK KAPISI (lisans v2 · yetenek düşüşü, yönetici kararı 2026-10-01) — `hak-ara` bildirmeyen alıcıya eski kök imzalı
// HAK sürümü YALNIZ güncel sürümden GENİŞ değilse teslim edilir (`isEntitlementWithin`: aynı sınıf · modüller ⊆ · kalıcı
// yalnız güncel kalıcıysa · bakım sonu ≤ · ufuk ≤ · kip alt sınırı korunur). Genişse HAK değişikliği teslim edilmez:
// kira fabrikanın elindeki güvenli sürüme bağlanır (yanıtta `hak: null`), güncel şartların kök imzası kuyruğa İDEMPOTENT
// girer ve YEREL_MUDAHALE uyarısına YETENEK_DUSUSU nedeni düşer. Fabrika bu kirayı bağlayamıyorsa (elinde güncelden geniş
// olmayan HAK yok) kira verilmez (403 KIRA_VERILMEDI) — talep ACİL, KOK_IMZASI_ACIL bildirimi (e-posta + Telegram), fabrika
// elindeki kirayla ödenmiş tarihe (P) dek NORMAL sürer. Gerçek satıcı süreci, kendi _test DB'si.
//   §1 saf genişlik ölçüsü (her alan tek başına genişletir; eşit ve dar içeridedir)
//   §2 teslim seçimi: dar ara sürümden sonra yeteneksize eski kök sürüm VERİLMEZ (elindeki güvenli sürüme bağ)
//   §3 yetenek gizleme (yerel yönetici yeteneği bildirmez, elinde güncel v2): 200, kira v2'ye bağlı, HAK yok, v1 YOK;
//      YETENEK_DUSUSU uyarısı + kök kuyruğu (acil değil)
//   §4 meşru geri dönüş (Dağıtım v2 rollback: yeni derleme ara imzalı v2'yi aldı → v2'yi tanımayan eski derleme): 403,
//      kira defteri ve zincir ucu değişmez, talep ACİL + bildirim talep başına bir kez; elinde geniş v1'i sunan da 403;
//      fabrikanın elindeki kira + HAK fabrika durum makinesinde P'ye dek NORMAL, P'den sonra EK_SURE (aniden durmaz)
//   §5 kök imzası içe aktarılınca eski derleme güncel şartlı kök imzalı v3'ü alır (200, talep IMZALANDI)
//   §6 etkinleştirme: yeteneksiz derleme kod TÜKETMEDEN 403 (acil talep); aynı kod yetenekli derlemeyle 200
// ⭐ KALICI SONDA ✓K (her koşumda): §2d genişlemeyen ara sürümde eski kök sürüm GERÇEKTEN teslim edilir (kapı her
//    yeteneksize ret veren kör bir ret değil) · §5a kök imzası gelince eski derleme GERÇEKTEN kira alır.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_genislik_kapisi.ts   (kendi _test DB'si)
// =============================================================================
import path from "node:path";
import { DAY_MS, EntitlementSchema, ENDPOINTS, TYP, jwsDigest, parseJws, signDocument, verifyEntitlement, verifyLease, type EntitlementDoc, type LicenseClass } from "../src/lisans-protokol";
import { kurulumAnahtariUret, sertifikaBas, sertifikaYuku, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { computeLicenseState, toDocResult } from "../../../Teks-Erp/src/lib/license/state";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
import { isEntitlementWithin, type EntitlementBreadth } from "../src/services/entitlement-policy";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kiraYuku,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
  type KurulumFiksturu,
  type Yanit,
} from "./lib/test-ortam";

const ARA_PAROLASI = "bekci-ara-parolasi-genislik";
const ARA_SINIFLARI: LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];
const YETENEKLER = ["hak-ara", "iptal", "odenmis-tarih"];
const TABAN: EntitlementBreadth = {
  sinif: "URETIM",
  moduller: ["production.enabled", "finance.enabled"],
  kalici: true,
  bakimBitis: "2027-10-01T00:00:00.000Z",
  cevrimdisiUfukGun: 400,
};

function saf(): void {
  console.log("\n§1 saf genişlik ölçüsü (isEntitlementWithin)");
  const ic = (eski: Partial<EntitlementBreadth>, guncel: Partial<EntitlementBreadth> = {}) => isEntitlementWithin({ ...TABAN, ...eski }, { ...TABAN, ...guncel });
  kontrol("§1a eşit ve dar sürüm içeride (modül alt kümesi · kısa bakım · kısa ufuk · kalıcı değil · kip alt sınırı fazladan)",
    ic({}) && ic({ moduller: ["production.enabled"] }) && ic({ bakimBitis: "2027-01-01T00:00:00.000Z" }) && ic({ cevrimdisiUfukGun: 30 }) && ic({ kalici: false }) && ic({ kipAltSiniri: "zorla" }));
  kontrol("§1b her alan TEK BAŞINA genişletir: çıkarılmış modül · kaldırılmış kalıcılık · uzun bakım · uzun ufuk · süresiz ufuk · kaldırılmış kip alt sınırı · başka sınıf",
    !ic({}, { moduller: ["production.enabled"] }) &&
      !ic({}, { kalici: false }) &&
      !ic({ bakimBitis: "2028-01-01T00:00:00.000Z" }) &&
      !ic({}, { cevrimdisiUfukGun: 200 }) &&
      !ic({ cevrimdisiUfukGun: null }) &&
      !ic({}, { kipAltSiniri: "zorla" }) &&
      !ic({ sinif: "DR" }));
  kontrol("§1c ufuk sırası: alanı olmayan (eski çapa) ≤ gün ≤ süresiz",
    ic({ cevrimdisiUfukGun: undefined }) && ic({ cevrimdisiUfukGun: 3650 }, { cevrimdisiUfukGun: null }) && !ic({ cevrimdisiUfukGun: 45 }, { cevrimdisiUfukGun: undefined }));
}

async function main(): Promise<void> {
  hedefDbKapisi();
  saf();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const hakSvc = await import("../src/services/entitlement.service");
  const { importRootSignedEntitlement } = await import("../src/services/root-queue.service");
  const temizlenecek: string[] = [];
  let sunucu: Awaited<ReturnType<typeof sunucuBaslat>> | null = null;
  try {
    const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, f.ara, "HAK", { siniflar: ARA_SINIFLARI }));
    writeKeyFileExclusive(
      path.join(ortam.dizin, `${f.ara.kid}.ara.json`),
      await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid: f.ara.kid, siniflar: ARA_SINIFLARI, sertifika }, f.ara.privateKey, passwordBuffer(ARA_PAROLASI)),
    );
    ctx.keys = KeyStore.load(ctx.config);
    kontrol("§0 ara imzacı yüklü", ctx.keys.intermediateFor("URETIM", Date.now())?.kid === f.ara.kid, ctx.keys.warnings.join(" | "));

    const yeni = async (): Promise<KurulumFiksturu> => {
      const k = await kurulumFiksturu(ctx);
      temizlenecek.push(k.kurulumDbId);
      return k;
    };
    const araSurum = (k: KurulumFiksturu, moduller: string[]) =>
      runAsCli(() =>
        hakSvc.issueEntitlementVersion(ctx, { entitlementId: k.hakId, changes: { modules: moduller }, password: passwordBuffer(ARA_PAROLASI), capabilities: ["hak-ara"], reason: "genişlik kapısı bekçisi", actor: "bekci" }),
      );
    const belge = async (hakId: string, surum: number) => (await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId, surum } } })).belge;
    const hakSatiri = (k: KurulumFiksturu) => prisma.hak.findUniqueOrThrow({ where: { id: k.hakId } });

    console.log("\n§2 teslim seçimi (deliverableEntitlement)");
    const kD = await yeni();
    const v2D = await araSurum(kD, ["production.enabled"]);
    const v1D = await belge(kD.hakId, 1);
    const hakD = await hakSatiri(kD);
    const bos = await hakSvc.deliverableEntitlement(prisma, hakD, []);
    const elindeV2 = await hakSvc.deliverableEntitlement(prisma, hakD, [], { hakId: kD.hakId, surum: 2, ozet: jwsDigest(v2D.belge) });
    const elindeV1 = await hakSvc.deliverableEntitlement(prisma, hakD, [], { hakId: kD.hakId, surum: 1, ozet: jwsDigest(v1D) });
    const sahteOzet = await hakSvc.deliverableEntitlement(prisma, hakD, [], { hakId: kD.hakId, surum: 2, ozet: jwsDigest(v1D) });
    const yetenekli = await hakSvc.deliverableEntitlement(prisma, hakD, ["hak-ara"]);
    kontrol("§2a dar ara v2 (finance çıkarıldı) sonrası yeteneksize v1 VERİLMEZ: güncel v2'ye bağ, withheld (geniş v1), elinde güvenli sürüm yok",
      bos?.surum === 2 && bos.withheld?.broaderVersion === 1 && bos.withheld.heldBound === false, JSON.stringify(bos && { s: bos.surum, w: bos.withheld }));
    kontrol("§2b elinde güncel v2 (bayt özeti tutar) → kira v2'ye bağlanabilir (heldBound)", elindeV2?.surum === 2 && elindeV2.withheld?.heldBound === true);
    kontrol("§2c elinde GENİŞ v1 → v1'e bağlanmaz (güncel v2, heldBound=false) · özeti tutmayan v2 sunumu da bağ sayılmaz",
      elindeV1?.surum === 2 && elindeV1.withheld?.heldBound === false && sahteOzet?.withheld?.heldBound === false);
    const kG = await yeni();
    await araSurum(kG, ["production.enabled", "finance.enabled", "depo.multiEnabled"]);
    const genis = await hakSvc.deliverableEntitlement(prisma, await hakSatiri(kG), []);
    kontrol("§2d ✓K genişleyen ara v2 (modül eklendi) → yeteneksize eski kök v1 GERÇEKTEN teslim edilir (withheld yok) · yeteneklıya güncel",
      genis?.surum === 1 && genis.withheld === undefined && yetenekli?.surum === 2 && yetenekli.withheld === undefined,
      `${genis?.surum}/${String(genis?.withheld)}`);

    sunucu = await sunucuBaslat(ortam);
    const genel = sunucu.genel;
    const etkinlestir = (k: KurulumFiksturu, a: TestAnahtari, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.ACTIVATE, {
        kurulumId: k.kurulumId,
        amac: "etkinlestir",
        anahtar: a,
        govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: a, parmakIzi: f.parmakIzi }), ...(yetenekler ? { yetenekler } : {}) },
      });
    const yokla = (k: KurulumFiksturu, a: TestAnahtari, sonKiraId: string, hak: { hakId: string; surum: number; ozet?: string } | null, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId,
        amac: "yokla",
        anahtar: a,
        govde: yoklamaGovdesi({ sonKiraId, hak, parmakIzi: f.parmakIzi, ...(yetenekler ? { v2: { yetenekler } } : {}) }),
      });
    const ozet = (y: Yanit) => {
      const kira = y.json.kira ? kiraYuku(y.json) : {};
      return `${y.status} ${y.kod ?? ""} hakSurum=${String(kira.hakSurum)} hak=${y.json.hak === null ? "null" : typeof y.json.hak}`;
    };
    const acikTalep = (hakId: string) => prisma.hakKokTalebi.findMany({ where: { hakId, durum: "BEKLIYOR" } });
    const bildirimSay = (kurulumDbId: string, olay: "KOK_IMZASI_ACIL" | "YEREL_MUDAHALE_SUPHESI") => prisma.bildirim.count({ where: { kurulumId: kurulumDbId, olay } });
    const nedenler = async (kurulumDbId: string): Promise<string[]> => {
      const u = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: kurulumDbId, tur: "YEREL_MUDAHALE", durum: "ACIK" } });
      return ((u?.ayrinti as { nedenler?: string[] } | null)?.nedenler ?? []).slice();
    };

    console.log("\n§3 yetenek gizleme (yerel yönetici yeteneği bildirmez; elinde güncel ara imzalı v2)");
    const k = await yeni();
    const a = kurulumAnahtariUret();
    const e = await etkinlestir(k, a, YETENEKLER);
    const v2 = await araSurum(k, ["production.enabled"]);
    const v1 = await belge(k.hakId, 1);
    const p1 = await yokla(k, a, kiraIdOf(e.json), { hakId: k.hakId, surum: 1, ozet: jwsDigest(v1) }, YETENEKLER);
    kontrol("§3a hazırlık: yetenekli yoklama dar ara v2'yi alır (kira v2)", e.status === 200 && p1.status === 200 && p1.json.hak === v2.belge && kiraYuku(p1.json).hakSurum === 2, ozet(p1));
    const p2 = await yokla(k, a, kiraIdOf(p1.json), { hakId: k.hakId, surum: 2, ozet: jwsDigest(v2.belge) });
    const kira2 = kiraYuku(p2.json);
    kontrol("§3b ⭐ yetenek bildirmeyen yoklama 200, kira ELİNDEKİ v2'ye bağlı (hakOzeti v2), yanıtta HAK YOK — geniş v1 asla",
      p2.status === 200 && kira2.hakSurum === 2 && kira2.hakOzeti === jwsDigest(v2.belge) && p2.json.hak === null, ozet(p2));
    const talep3 = await acikTalep(k.hakId);
    const yuk3 = talep3[0]?.yuk as EntitlementDoc | undefined;
    kontrol("§3c güncel şartların kök imzası kuyrukta (tek talep, acil DEĞİL, yük v3 = güncel modüller, imzacı sertifikası yok, sistem yazdı)",
      talep3.length === 1 && talep3[0]!.acil === false && talep3[0]!.tabanSurum === 2 && yuk3?.surum === 3 && JSON.stringify(yuk3.moduller) === JSON.stringify(["production.enabled"]) && yuk3.imzaciSertifikasi === undefined && talep3[0]!.yapan === "sistem:yetenek-dususu",
      JSON.stringify(talep3.map((t) => ({ a: t.acil, s: t.surum, y: t.yapan }))));
    kontrol("§3d YEREL_MUDAHALE uyarısında YETENEK_DUSUSU + bildirimi (2 kanal); acil bildirim YOK; yetenek kolonu boşaldı",
      (await nedenler(k.kurulumDbId)).includes("YETENEK_DUSUSU") && (await bildirimSay(k.kurulumDbId, "YEREL_MUDAHALE_SUPHESI")) === 2 && (await bildirimSay(k.kurulumDbId, "KOK_IMZASI_ACIL")) === 0 && (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).yetenekler.length === 0);

    console.log("\n§4 meşru geri dönüş: ara imzalı v2'yi tanımayan eski derleme (elinde doğrulanmış HAK yok)");
    const kiraSayisi = () => prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
    const once = await kiraSayisi();
    const uc = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).sonKiraId;
    const r1 = await yokla(k, a, kiraIdOf(p2.json), null);
    const talep4 = await acikTalep(k.hakId);
    kontrol("§4a ⭐ 403 KIRA_VERILMEDI; kira defteri ve zincir ucu DEĞİŞMEDİ; yoklama satırı RED_KOK_IMZASI_BEKLIYOR",
      r1.status === 403 && r1.kod === "KIRA_VERILMEDI" && (await kiraSayisi()) === once && (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).sonKiraId === uc &&
        (await prisma.yoklama.count({ where: { kurulumId: k.kurulumDbId, sonuc: "RED_KOK_IMZASI_BEKLIYOR" } })) === 1,
      ozet(r1));
    kontrol("§4b aynı talep ACİL oldu (ikinci talep açılmadı) ve KOK_IMZASI_ACIL bildirimi e-posta + Telegram",
      talep4.length === 1 && talep4[0]!.id === talep3[0]!.id && talep4[0]!.acil === true &&
        (await prisma.bildirim.findMany({ where: { kurulumId: k.kurulumDbId, olay: "KOK_IMZASI_ACIL" }, select: { kanal: true } })).map((b) => b.kanal).sort().join() === "EPOSTA,TELEGRAM");
    const r2 = await yokla(k, a, kiraIdOf(p2.json), { hakId: k.hakId, surum: 1, ozet: jwsDigest(v1) });
    kontrol("§4c elinde GENİŞ v1'i sunan (eski dosyayı geri koyan) da 403; acil bildirim talep başına TEK (2 satır), talep yine tek",
      r2.status === 403 && r2.kod === "KIRA_VERILMEDI" && (await bildirimSay(k.kurulumDbId, "KOK_IMZASI_ACIL")) === 2 && (await acikTalep(k.hakId)).length === 1 && (await kiraSayisi()) === once,
      ozet(r2));
    // Aniden durmaz: fabrikanın elindeki kira (§3b) + HAK v2 fabrika durum makinesinde (Teks-Erp `computeLicenseState`).
    const elKirasi = verifyLease(p2.json.kira, f.kokler);
    const elHak = verifyEntitlement(v2.belge, f.kokler, { nowMs: Date.now() });
    if (!elKirasi.ok || !elHak.ok) throw new Error("fabrikanın elindeki belgeler doğrulanamadı");
    const kiraDoc = elKirasi.value.document;
    const verilis = Date.parse(kiraDoc.verilis);
    const durumAt = (t: number) =>
      computeLicenseState({
        kurulumId: kiraDoc.kurulumId,
        kurulumAnahtarKimligi: a.kid,
        hak: toDocResult(elHak),
        kira: toDocResult(elKirasi),
        saat: { duvarMs: t, yuksekSuMs: verilis, monotonik: { kiraId: kiraDoc.kiraId, gecenMs: t - verilis }, durumDosyasiGecerli: true },
        parmakIziEslesme: "ESLESTI",
        butunluk: "KAPSAM_DISI",
        derlemeTarihiMs: verilis - 30 * DAY_MS,
        ilkAcilisMs: verilis - 100 * DAY_MS,
        varsayilanKip: "zorla",
        sonKiraZorlamasi: null,
        sonYaptirim: null,
        sonKira: { kiraId: kiraDoc.kiraId, verilisMs: verilis },
      });
    const pMs = verilis + 400 * DAY_MS;
    const simdi = durumAt(verilis + 60_000);
    const kiraSonrasi = durumAt(Date.parse(kiraDoc.bitis) + 31 * DAY_MS);
    const pSonrasi = durumAt(pMs + DAY_MS);
    kontrol("§4d ⭐ 403'ten sonra fabrikanın elindeki kira ile kademe NORMAL; kira bitişi + 31 gün (internetsiz) hâlâ NORMAL — süre çapası P",
      simdi.hesaplananKademe === "NORMAL" && kiraSonrasi.hesaplananKademe === "NORMAL" && kiraSonrasi.odenmisTarih?.tarihMs === pMs,
      `${simdi.hesaplananKademe} / ${kiraSonrasi.hesaplananKademe} [${kiraSonrasi.nedenler.map((n) => n.kod).join(",")}]`);
    kontrol("§4e P geçince ek süre (EK_SURE, KISITLI değil) — kısıtlı ancak P + 30 günde",
      pSonrasi.hesaplananKademe === "EK_SURE" && durumAt(pMs + 31 * DAY_MS).hesaplananKademe === "KISITLI", `${pSonrasi.hesaplananKademe} [${pSonrasi.nedenler.map((n) => n.kod).join(",")}]`);

    console.log("\n§5 kök imzası içe aktarılınca eski derleme güncel şartlı kök sürümü alır");
    const talep = (await acikTalep(k.hakId))[0]!;
    const kokBelge = signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: talep.yuk as unknown as EntitlementDoc, key: { kid: f.kok.kid, privateKey: f.kok.privateKey } });
    const ice = await importRootSignedEntitlement(ctx, { talepId: talep.id, belge: kokBelge, actor: "bekci" });
    const r3 = await yokla(k, a, kiraIdOf(p2.json), null);
    const kira3 = r3.json.kira ? kiraYuku(r3.json) : {};
    const v3Yuk = parseJws(r3.json.hak);
    kontrol("§5a ✓K talep IMZALANDI (v3, kök) → eski derleme 200, yanıtta kök imzalı v3 (güncel modüller), kira v3'e bağlı",
      ice.durum === "IMZALANDI" && ice.surum === 3 && r3.status === 200 && r3.json.hak === kokBelge && kira3.hakSurum === 3 &&
        v3Yuk.ok && JSON.stringify((v3Yuk.value.payload as EntitlementDoc).moduller) === JSON.stringify(["production.enabled"]),
      `${ice.durum} ${ozet(r3)}`);
    kontrol("§5b içe aktarma sonrası açık talep kalmadı (yeteneksiz yoklama yeni talep AÇMADI)", (await acikTalep(k.hakId)).length === 0);

    console.log("\n§6 etkinleştirme (yeteneksiz derleme, güncel sürüm dar ve ara imzalı)");
    const kE = await yeni();
    const aE = kurulumAnahtariUret();
    const v2E = await araSurum(kE, ["production.enabled"]);
    const red = await etkinlestir(kE, aE);
    const kod = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: kE.kurulumDbId }, orderBy: { createdAt: "desc" } });
    const talepE = await acikTalep(kE.hakId);
    kontrol("§6a ⭐ 403 KIRA_VERILMEDI, kod TÜKETİLMEDİ (AKTIF), nonce yazılmadı, kurulum etkinleşmedi; acil talep + bildirim",
      red.status === 403 && red.kod === "KIRA_VERILMEDI" && kod.durum === "AKTIF" && (await prisma.nonceDefteri.count({ where: { kurulumId: kE.kurulumDbId } })) === 0 &&
        (await prisma.kurulum.findUniqueOrThrow({ where: { id: kE.kurulumDbId } })).durum === "ETKINLESMEDI" && talepE.length === 1 && talepE[0]!.acil && (await bildirimSay(kE.kurulumDbId, "KOK_IMZASI_ACIL")) === 2,
      `${red.status} ${red.kod ?? ""} kod=${kod.durum}`);
    const ok = await etkinlestir(kE, aE, YETENEKLER);
    kontrol("§6b aynı kod yetenekli derlemeyle 200 ve ara imzalı güncel v2", ok.status === 200 && ok.json.hak === v2E.belge && kiraYuku(ok.json).hakSurum === 2, `${ok.status} ${ok.kod ?? ""}`);
  } finally {
    await sunucu?.durdur();
    await temizleKurulumlar(temizlenecek, [...ortam.kidler, f.ara.kid]);
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
