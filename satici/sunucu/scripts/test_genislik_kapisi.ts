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
//   §6 etkinleştirme: yeteneksiz derleme kod TÜKETMEDEN 403 (acil talep); aynı kod yetenekli derlemeyle 200; yeni kurulumun
//      ara imzalı ilk HAK'ı (beklenen yetenek): eski derleme 403 + TEK acil talep → kök içe aktarımı sonrası aynı kodla 200
//      (kök v2); yetenekli derleme ara v1'i alır ve yetenek kümesi yazılır
//   KİRA BAĞI KAPISI (`lease-binding.ts`) — bağlanamayan kira (`hak: null`, alıcının elinde bağlayacak HAK yok) HİÇBİR
//   yoldan çıkmaz; kural tek yardımcıda:
//   §7 DR devri (yeteneksiz DR, istek elindeki HAK'ı bildirmez): ön denetim 403 — devir YAZILMAZ (ana ETKİN), nonce ve
//      kira yok, DR'nin HAK'ı acil kuyrukta; raporsuz yenileme (`renewLease`) de istisna değil (403); kök imzasından sonra 200
//   §8 kapanış kirası (iptal kurulum): alan taraf bağlayamıyorsa kapanış kirası YOK → eski 403 KURULUM_IPTAL, kuyruk
//      açılmaz (alan taraf zincir sahibi değil); elinde güvenli sürüm olan alıcı kapanış kirasını alır
//   §9 donanım öğrenmesi (güçlüler tutuyor ama kira bağlanamaz): 403 — öğrenme de kira da yok (küme, talep, kurulum kaydı
//      değişmez), acil talep + bildirim; kök imzasından sonra aynı bildirim ONAYLANDI + kira
//   §10 tek kaynak: eski derleme adayı (`newestLegacyVersion`, saf) · kira bağı kararı yalnız `lease-binding.ts`te
//      (heldBound okuması + kuyruk çağrısı tek dosyada — kopya yok)
// ⭐ KALICI SONDA ✓K (her koşumda): §2d genişlemeyen ara sürümde eski kök sürüm GERÇEKTEN teslim edilir (kapı her
//    yeteneksize ret veren kör bir ret değil) · §5a kök imzası gelince eski derleme GERÇEKTEN kira alır · §7d · §8b · §9b
//    bağlanabilen yol GERÇEKTEN kira alır (kapı her şeyi reddeden kör kapı değil) · §10c tarayıcı GERÇEKTEN ölçüyor.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_genislik_kapisi.ts   (kendi _test DB'si)
// =============================================================================
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  DAY_MS,
  EntitlementSchema,
  ENDPOINTS,
  HardwareReportResponseSchema,
  TYP,
  b64uEncode,
  jwsDigest,
  parseJws,
  signDocument,
  verifyEntitlement,
  verifyLease,
  type EntitlementDoc,
  type Fingerprint,
  type LicenseClass,
} from "../src/lisans-protokol";
import { kurulumAnahtariUret, sertifikaBas, sertifikaYuku, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { computeLicenseState, toDocResult } from "../../../Teks-Erp/src/lib/license/state";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
import { isEntitlementWithin, newestLegacyVersion, type EntitlementBreadth } from "../src/services/entitlement-policy";
import { VendorError } from "../src/lib/errors";
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

/** Yorumları atılmış kaynak (tarayıcı yalnız kodu ölçer). */
function kodOf(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tsDosyalari(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? (n === "lisans-protokol" ? [] : tsDosyalari(p)) : n.endsWith(".ts") ? [p] : [];
  });
}

/** Deseni taşıyan src dosyaları (göreli yol, sıralı). */
function tasiyanlar(desen: RegExp): string[] {
  const kok = path.resolve(__dirname, "..", "src");
  return tsDosyalari(kok)
    .filter((f) => desen.test(kodOf(f)))
    .map((f) => path.relative(kok, f))
    .sort();
}

function tekKaynak(): void {
  console.log("\n§10b tek kaynak tarayıcısı (src, yorum dışı)");
  const bagOkuyan = tasiyanlar(/\bheldBound\b/);
  kontrol("§10b kira bağı kararı (`heldBound` okuması) yalnız üreticide (entitlement-issue) ve kira bağı kapısında (lease-binding)",
    JSON.stringify(bagOkuyan) === JSON.stringify(["services/entitlement-issue.service.ts", "services/lease-binding.ts"]), bagOkuyan.join(", "));
  const kuyrukCagiran = tasiyanlar(/(?<!function )\bqueueCurrentTermsUnderLock\(/);
  kontrol("§10b' güncel şartların kuyruğa alınması yalnız kira bağı kapısından (kopya yok)", JSON.stringify(kuyrukCagiran) === JSON.stringify(["services/lease-binding.ts"]), kuyrukCagiran.join(", "));
  const yuklemci = tasiyanlar(/\bleaseUnbindable\(/);
  kontrol("§10c ✓K tarayıcı ölçüyor: kira bağı yüklemi her kira basan yolda (yoklama · kapanış · etkinleştirme) ve kapıda görünür",
    ["services/lease-binding.ts", "services/renewal.service.ts", "services/closing-lease.ts", "services/activation.service.ts"].every((f) => yuklemci.includes(f)), yuklemci.join(", "));
}

async function main(): Promise<void> {
  hedefDbKapisi();
  saf();
  tekKaynak();
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

    const yeni = async (g: Parameters<typeof kurulumFiksturu>[1] = {}): Promise<KurulumFiksturu> => {
      const k = await kurulumFiksturu(ctx, g);
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
    const surumler = [{ surum: 2, belge: v2D.belge }, { surum: 1, belge: v1D }];
    kontrol("§10a eski derleme adayı (saf, tek seçim): en yeni ARA İMZASIZ sürüm ≤ güncel, sıradan bağımsız; yalnız ara → yok",
      newestLegacyVersion(surumler, 2)?.surum === 1 && newestLegacyVersion([...surumler].reverse(), 2)?.surum === 1 && newestLegacyVersion(surumler, 1)?.surum === 1 &&
        newestLegacyVersion([surumler[0]!], 2) === null && newestLegacyVersion(surumler, 0) === null);

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

    // Yeni kurulumun ilk HAK'ı kök töreni beklemez: plan beklenen yetenekle ARA; eski derleme gelirse kapı aynen işler.
    const kF = await yeni({ ilkImzaParolasi: ARA_PAROLASI });
    const aF = kurulumAnahtariUret();
    const v1F = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: kF.hakId, surum: 1 } } });
    const redF = await etkinlestir(kF, aF);
    const kodF = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: kF.kurulumDbId }, orderBy: { createdAt: "desc" } });
    const talepF = await acikTalep(kF.hakId);
    kontrol("§6c ⭐ ara imzalı TEK v1 + yeteneksiz etkinleştirme → 403 KIRA_VERILMEDI, kod AKTIF, kurulum ETKINLESMEDI, TEK acil talep + bildirim",
      v1F.imzalayanKid === f.ara.kid && redF.status === 403 && redF.kod === "KIRA_VERILMEDI" && kodF.durum === "AKTIF" &&
        (await prisma.kurulum.findUniqueOrThrow({ where: { id: kF.kurulumDbId } })).durum === "ETKINLESMEDI" && talepF.length === 1 && talepF[0]!.acil && (await bildirimSay(kF.kurulumDbId, "KOK_IMZASI_ACIL")) === 2,
      `${v1F.imzalayanKid} ${redF.status} ${redF.kod ?? ""} kod=${kodF.durum} talep=${talepF.length}`);
    const kokF = signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: talepF[0]!.yuk as unknown as EntitlementDoc, key: { kid: f.kok.kid, privateKey: f.kok.privateKey } });
    const iceF = await importRootSignedEntitlement(ctx, { talepId: talepF[0]!.id, belge: kokF, actor: "bekci" });
    const okF = await etkinlestir(kF, aF);
    kontrol("§6d ✓K kök içe aktarımı sonrası AYNI kodla yeteneksiz etkinleştirme 200, yanıtta kök imzalı v2, kira v2'ye bağlı",
      iceF.durum === "IMZALANDI" && iceF.surum === 2 && okF.status === 200 && okF.json.hak === kokF && kiraYuku(okF.json).hakSurum === 2, `${iceF.durum} ${okF.status} ${okF.kod ?? ""}`);
    const kY = await yeni({ ilkImzaParolasi: ARA_PAROLASI });
    const v1Y = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: kY.hakId, surum: 1 } } });
    const okY = await etkinlestir(kY, kurulumAnahtariUret(), YETENEKLER);
    const kurY = await prisma.kurulum.findUniqueOrThrow({ where: { id: kY.kurulumDbId } });
    kontrol("§6e yetenekli etkinleştirme → 200, teslim ara imzalı v1, Kurulum.yetenekler yazıldı (ETKIN), kuyruk yok",
      v1Y.imzalayanKid === f.ara.kid && okY.status === 200 && okY.json.hak === v1Y.belge && kurY.durum === "ETKIN" && JSON.stringify(kurY.yetenekler) === JSON.stringify(YETENEKLER) && (await acikTalep(kY.hakId)).length === 0,
      `${okY.status} ${okY.kod ?? ""} ${JSON.stringify(kurY.yetenekler)}`);

    await kiraBagiYollari({ ctx, prisma, genel, yeni, araSurum, acikTalep, bildirimSay, importRootSignedEntitlement, kokImzala: (yuk) => signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: yuk, key: { kid: f.kok.kid, privateKey: f.kok.privateKey } }), parmakIzi: f.parmakIzi });
  } finally {
    await sunucu?.durdur();
    await temizleKurulumlar(temizlenecek, [...ortam.kidler, f.ara.kid]);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

// ---------------------------------------------------------------- §7–§9 kira bağı kapısı (DR · kapanış · donanım)

const ozetOf = (etiket: string): string => b64uEncode(createHash("sha256").update(etiket).digest());

interface BagOrtami {
  readonly ctx: Awaited<ReturnType<typeof anahtarOrtamiKur>>["ctx"];
  readonly prisma: (typeof import("../src/lib/prisma"))["prisma"];
  readonly genel: string;
  readonly yeni: (g?: Parameters<typeof kurulumFiksturu>[1]) => Promise<KurulumFiksturu>;
  readonly araSurum: (k: KurulumFiksturu, moduller: string[]) => Promise<{ belge: string }>;
  readonly acikTalep: (hakId: string) => Promise<{ id: string; acil: boolean; yuk: unknown }[]>;
  readonly bildirimSay: (kurulumDbId: string, olay: "KOK_IMZASI_ACIL" | "YEREL_MUDAHALE_SUPHESI") => Promise<number>;
  readonly importRootSignedEntitlement: (typeof import("../src/services/root-queue.service"))["importRootSignedEntitlement"];
  readonly kokImzala: (yuk: EntitlementDoc) => string;
  readonly parmakIzi: Fingerprint;
}

async function kiraBagiYollari(o: BagOrtami): Promise<void> {
  const { prisma, genel } = o;
  const etkinlestir = (k: KurulumFiksturu, a: TestAnahtari, yetenekler?: string[]) =>
    imzaliPost(genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: a,
      govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: a, parmakIzi: o.parmakIzi }), ...(yetenekler ? { yetenekler } : {}) },
    });
  const kiraSay = (k: KurulumFiksturu) => prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
  const kokuIceAktar = async (k: KurulumFiksturu) => {
    const t = (await o.acikTalep(k.hakId))[0]!;
    return o.importRootSignedEntitlement(o.ctx, { talepId: t.id, belge: o.kokImzala(t.yuk as EntitlementDoc), actor: "bekci" });
  };

  console.log("\n§7 DR devri — yeteneksiz DR, güncel HAK'ı dar ara imzalı (elindeki HAK bildirilmez → bağlanamaz)");
  const ana = await o.yeni({ sinif: "URETIM" });
  const anaA = kurulumAnahtariUret();
  await etkinlestir(ana, anaA, YETENEKLER);
  const dr = await o.yeni({ sinif: "DR", tesisId: ana.tesisId, musteriId: ana.musteriId });
  const drA = kurulumAnahtariUret();
  const drE = await etkinlestir(dr, drA);
  await o.araSurum(dr, ["production.enabled"]);
  const devral = () =>
    imzaliPost(genel, ENDPOINTS.DR_TAKEOVER, { kurulumId: dr.kurulumId, amac: "dr-devral", anahtar: drA, govde: { v: 1, anaKurulumId: ana.kurulumId, gerekce: "ana sunucu arızalı" } });
  const drKira0 = await kiraSay(dr);
  const drNonce0 = await prisma.nonceDefteri.count({ where: { kurulumId: dr.kurulumDbId } });
  const red = await devral();
  const anaDurum = (await prisma.kurulum.findUniqueOrThrow({ where: { id: ana.kurulumDbId } })).durum;
  const talepDr = await o.acikTalep(dr.hakId);
  kontrol("§7a ⭐ 403 KIRA_VERILMEDI; devir YAZILMADI (ana ETKİN, DEVREDILDI kaydı yok); DR'ye kira yok; nonce tüketilmedi",
    drE.status === 200 && red.status === 403 && red.kod === "KIRA_VERILMEDI" && anaDurum === "ETKIN" &&
      (await prisma.kurulumKaydi.count({ where: { kurulumId: ana.kurulumDbId, olay: "DEVREDILDI" } })) === 0 && (await kiraSay(dr)) === drKira0 &&
      (await prisma.nonceDefteri.count({ where: { kurulumId: dr.kurulumDbId } })) === drNonce0,
    `${drE.status} ${red.status} ${red.kod ?? ""} ana=${anaDurum}`);
  kontrol("§7a' DR'nin HAK'ı ACİL kuyrukta + KOK_IMZASI_ACIL (e-posta + Telegram)", talepDr.length === 1 && talepDr[0]!.acil && (await o.bildirimSay(dr.kurulumDbId, "KOK_IMZASI_ACIL")) === 2);
  const { renewLease } = await import("../src/services/renewal.service");
  let yenile: unknown = null;
  try {
    await renewLease(o.ctx, { installationDbId: dr.kurulumDbId, kid: drA.kid, presentedLeaseId: null, assumeAtTip: true, measured: null, clientEntitlement: null, telemetry: null, nowMs: Date.now() });
  } catch (err) {
    yenile = err;
  }
  kontrol("§7b raporsuz yenileme (DR devrinin kira adımı) istisna DEĞİL: 403 KIRA_VERILMEDI, kira defteri değişmedi",
    yenile instanceof VendorError && yenile.status === 403 && yenile.code === "KIRA_VERILMEDI" && (await kiraSay(dr)) === drKira0,
    yenile instanceof VendorError ? `${yenile.status} ${yenile.code}` : String(yenile));
  const ice7 = await kokuIceAktar(dr);
  const ok7 = await devral();
  kontrol("§7d ✓K kök imzası içe aktarılınca aynı DR devri 200 (kira kök imzalı güncel sürüme bağlı), ana DEVREDILDI",
    ice7.durum === "IMZALANDI" && ok7.status === 200 && kiraYuku(ok7.json).hakSurum === ice7.surum &&
      (await prisma.kurulum.findUniqueOrThrow({ where: { id: ana.kurulumDbId } })).durum === "DEVREDILDI",
    `${ice7.durum} ${ok7.status} ${ok7.kod ?? ""}`);

  console.log("\n§8 kapanış kirası — iptal kurulum, alan taraf yeteneksiz (yalnız `odenmis-tarih`)");
  const k8 = await o.yeni();
  const a8 = kurulumAnahtariUret();
  const e8 = await etkinlestir(k8, a8, ["odenmis-tarih", "iptal"]);
  const v1 = (await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: k8.hakId, surum: 1 } } })).belge;
  const v2 = await o.araSurum(k8, ["production.enabled"]);
  const { cancelInstallation } = await import("../src/services/installation-admin.service");
  await cancelInstallation({ installationDbId: k8.kurulumDbId, reason: "bekçi: sözleşme feshi", actor: "bekci" });
  const kapanisSay = () => prisma.kira.count({ where: { kurulumId: k8.kurulumDbId, karar: "KAPANIS" } });
  const yokla8 = (hak: { hakId: string; surum: number; ozet: string }) =>
    imzaliPost(genel, ENDPOINTS.POLL, { kurulumId: k8.kurulumId, amac: "yokla", anahtar: a8, govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(e8.json), hak, parmakIzi: o.parmakIzi, v2: { yetenekler: ["odenmis-tarih"] } }) });
  const red8 = await yokla8({ hakId: k8.hakId, surum: 1, ozet: jwsDigest(v1) });
  kontrol("§8a ⭐ elinde GENİŞ v1 → kapanış kirası YOK, eski 403 KURULUM_IPTAL; kuyruk AÇILMADI (alan taraf zincir sahibi değil)",
    red8.status === 403 && red8.kod === "KURULUM_IPTAL" && (await kapanisSay()) === 0 && (await o.acikTalep(k8.hakId)).length === 0, `${red8.status} ${red8.kod ?? ""}`);
  const ok8 = await yokla8({ hakId: k8.hakId, surum: 2, ozet: jwsDigest(v2.belge) });
  kontrol("§8b ✓K elinde güvenli v2 → 200 kapanış kirası IPTAL, v2'ye bağlı, HAK yanıtta yok",
    ok8.status === 200 && kiraYuku(ok8.json).kapanis === "IPTAL" && kiraYuku(ok8.json).hakSurum === 2 && ok8.json.hak === null && (await kapanisSay()) === 1, `${ok8.status} ${ok8.kod ?? ""}`);

  console.log("\n§9 donanım öğrenmesi — güçlüler tutuyor ama yeteneksiz kurulumun kirası bağlanamaz");
  const k9 = await o.yeni();
  const a9 = kurulumAnahtariUret();
  await etkinlestir(k9, a9);
  await o.araSurum(k9, ["production.enabled"]);
  const yeniF4: Fingerprint = { ...o.parmakIzi, f4: ozetOf("yeni-anakart") };
  const bildir = () => imzaliPost(genel, ENDPOINTS.HARDWARE, { kurulumId: k9.kurulumId, amac: "donanim", anahtar: a9, govde: { v: 1, parmakIzi: yeniF4, kayip: [], gerekce: "anakart değişti" }, imzaYolu: ENDPOINTS.HARDWARE });
  const kabul = async () => ((await prisma.kurulum.findUniqueOrThrow({ where: { id: k9.kurulumDbId } })).kabulEdilenParmakIzi as Fingerprint).f4;
  const kira9 = await kiraSay(k9);
  const red9 = await bildir();
  kontrol("§9a ⭐ 403 KIRA_VERILMEDI; öğrenme YOK (kabul edilen küme, talep, kurulum kaydı değişmedi), kira yok; ACİL talep + bildirim",
    red9.status === 403 && red9.kod === "KIRA_VERILMEDI" && (await kabul()) === o.parmakIzi.f4 && (await prisma.donanimTalebi.count({ where: { kurulumId: k9.kurulumDbId } })) === 0 &&
      (await prisma.kurulumKaydi.count({ where: { kurulumId: k9.kurulumDbId, olay: "PARMAK_IZI_OGRENILDI" } })) === 0 && (await kiraSay(k9)) === kira9 &&
      (await o.acikTalep(k9.hakId))[0]?.acil === true && (await o.bildirimSay(k9.kurulumDbId, "KOK_IMZASI_ACIL")) === 2,
    `${red9.status} ${red9.kod ?? ""}`);
  await kokuIceAktar(k9);
  const ok9 = await bildir();
  const y9 = HardwareReportResponseSchema.safeParse(ok9.json);
  kontrol("§9b ✓K kök imzasından sonra aynı bildirim 200 ONAYLANDI + kira (kök imzalı HAK yanıtta), küme öğrenildi",
    ok9.status === 200 && y9.success && y9.data.durum === "ONAYLANDI" && typeof y9.data.lisans?.hak === "string" && (await kabul()) === yeniF4.f4, `${ok9.status} ${ok9.kod ?? ""}`);
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
