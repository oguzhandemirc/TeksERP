// =============================================================================
// TESLİM BAĞI (lisans v2 entegrasyonu: L2-3 ↔ L2-4) — kiranın `hakSurum`/`hakOzeti`/`iptalSira`sı ile yanıtın `hak`/`iptal`i
// TEK seçim noktalarından doğar (`entitlementForDelivery` → `deliverableEntitlement`, `leaseRevocation` →
// `distributableRevocation`); yetenekler `Kurulum.yetenekler` kolonundan (`installationCapabilities`). Gerçek satıcı süreci,
// kendi _test DB'si.
//   §1 kolon bağı: etkinleştirme gövdesinin yetenekleri kolona yazılır; yetenekli kurulumun yeni HAK sürümü kolondan
//      okunan yetenekle ARA imzacıya gider (kolon yokken boş liste → KÖK idi)
//   §2 yetenekli yoklama: yanıt ara imzalı güncel HAK + iptal belgesi; kira `hakSurum` = teslim edilen sürüm,
//      `hakOzeti` = teslim edilen belgenin özeti, `iptalSira` = dağıtılan belgenin sırası
//   §3 yeteneksiz (eski) yoklama: güncel sürüm ara imzalı olsa da kira en yeni ARA-DIŞI sürüme bağlanır; fabrikanın elindeki
//      o sürümse HAK yeniden gönderilmez, HAK'sız fabrikaya kök imzalı belge gider; iptal yine eklenir (gevşek yanıt)
//   §4 aynı kirayı yeniden veren yollar kiranın BAĞLI olduğu sürümü teslim eder: yoklama tekrarı (REPEAT) ve
//      etkinleştirme tekrarı — araya giren yeni HAK sürümü o yanıta girmez
//   §5 sürüm geri dönüşü: yetenek bildirmeyen yoklama (eski derlemeye dönen fabrika) AYNI yanıtta ara imzalı HAK almaz
//   §6 hiç etkinleşmemiş kurulum: imza planının beklenen yeteneği (`signingCapabilities`) teslime GİRMEZ — teslim kayıttan
//      (`installationCapabilities`, boş) ya da gövdeden seçilir
// ⭐ KALICI SONDA ✓K (her koşumda): §2 yetenekli kurulum GERÇEKTEN ara imzalı HAK + iptal alır (her yere eski biçim
//    veren kör bağ yeşil veremez) · §3 yeteneksiz kurulumun güncel sürümü GERÇEKTEN ara imzalıdır (eşitlik tesadüf değil).
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_teslim_bagi.ts   (kendi _test DB'si)
// =============================================================================
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ENDPOINTS, LicenseResponseSchema, jwsDigest, msToIso, verifyEntitlement, verifyLease, verifyRevocation, type LicenseClass } from "../src/lisans-protokol";
import { anahtarUret, iptalBas, iptalYuku, kurulumAnahtariUret, sertifikaBas, sertifikaYuku, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
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
  temizleIptalBelgeleri,
  temizleKurulumlar,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

const ARA_PAROLASI = "bekci-ara-parolasi-teslim";
const YUKLEYEN = "bekci-teslim-bagi";
const ARA_SINIFLARI: LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];
const YETENEKLER = ["hak-ara", "iptal", "odenmis-tarih"];

/** Yanıtın HAK belgesi ara imzalı mı (doğrulayıcının imzacı türü)? null: yanıtta HAK yok ya da doğrulanmadı. */
function araImzali(belge: unknown, kokler: Parameters<typeof verifyEntitlement>[1]): boolean | null {
  if (typeof belge !== "string") return null;
  const v = verifyEntitlement(belge, kokler, { nowMs: Date.now() });
  return v.ok ? v.value.signer.kind === "ARA" : null;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const ara = (belge: unknown) => araImzali(belge, f.kokler);
  const { prisma } = await import("../src/lib/prisma");
  const hakSvc = await import("../src/services/entitlement.service");
  const { importRevocation } = await import("../src/services/revocation.service");
  const temizlenecek: string[] = [];
  let sunucu: Awaited<ReturnType<typeof sunucuBaslat>> | null = null;
  try {
    await temizleIptalBelgeleri(YUKLEYEN);
    const yabanci = await prisma.iptalBelgesi.count();
    kontrol("§0 iptal defterinde bu bekçinin dışında satır yok (dağıtılan sıra bu bekçinin belgesi olmalı)", yabanci === 0, `${yabanci} satır`);

    // Ara imzacı anahtar dizininde (sunucu da aynı dizinden yükler).
    const sertifika = sertifikaBas(f.kok, sertifikaYuku(f, f.ara, "HAK", { siniflar: ARA_SINIFLARI }));
    writeKeyFileExclusive(
      path.join(ortam.dizin, `${f.ara.kid}.ara.json`),
      await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid: f.ara.kid, siniflar: ARA_SINIFLARI, sertifika }, f.ara.privateKey, passwordBuffer(ARA_PAROLASI)),
    );
    ctx.keys = KeyStore.load(ctx.config);
    kontrol("§0b ara imzacı yüklü ve URETIM için seçiliyor", ctx.keys.intermediateFor("URETIM", Date.now())?.kid === f.ara.kid, ctx.keys.warnings.join(" | "));

    const kY = await kurulumFiksturu(ctx);
    temizlenecek.push(kY.kurulumDbId);
    const kE = await kurulumFiksturu(ctx);
    temizlenecek.push(kE.kurulumDbId);
    const aY: TestAnahtari = kurulumAnahtariUret();
    const aE: TestAnahtari = kurulumAnahtariUret();
    sunucu = await sunucuBaslat(ortam);
    const genel = sunucu.genel;
    const etkinlestir = (k: typeof kY, a: TestAnahtari, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.ACTIVATE, {
        kurulumId: k.kurulumId,
        amac: "etkinlestir",
        anahtar: a,
        govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: a, parmakIzi: f.parmakIzi }), ...(yetenekler ? { yetenekler } : {}) },
      });
    const yokla = (k: typeof kY, a: TestAnahtari, sonKiraId: string, hak: { hakId: string; surum: number; ozet?: string } | null, yetenekler?: string[]) =>
      imzaliPost(genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId,
        amac: "yokla",
        anahtar: a,
        govde: yoklamaGovdesi({ sonKiraId, hak, parmakIzi: f.parmakIzi, ...(yetenekler ? { v2: { yetenekler } } : {}) }),
      });
    const surumBelgesi = async (hakId: string, surum: number) => (await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId, surum } } })).belge;
    const yanitOzeti = (y: Yanit) => {
      const kira = kiraYuku(y.json);
      return `${y.status} ${y.kod ?? ""} hakSurum=${String(kira.hakSurum)} iptalSira=${String(kira.iptalSira)} hak=${ara(y.json.hak)}`;
    };

    console.log("\n§1 kolon bağı (etkinleştirme → yetenek kolonu → imzacı planı)");
    const eY = await etkinlestir(kY, aY, YETENEKLER);
    const eE = await etkinlestir(kE, aE);
    const instY = await prisma.kurulum.findUniqueOrThrow({ where: { id: kY.kurulumDbId } });
    const instE = await prisma.kurulum.findUniqueOrThrow({ where: { id: kE.kurulumDbId } });
    kontrol("§1a etkinleştirme 200 · yetenekler kolona yazıldı (yetenekli: üçü, eski: boş) · iki kira da v1'e bağlı",
      eY.status === 200 && eE.status === 200 && instY.yetenekler.join() === YETENEKLER.join() && instE.yetenekler.length === 0 && kiraYuku(eY.json).hakSurum === 1 && kiraYuku(eE.json).hakSurum === 1,
      `${eY.status}/${eE.status} ${instY.yetenekler.join()}`);
    const v2Y = await runAsCli(() =>
      hakSvc.issueEntitlementVersion(ctx, { entitlementId: kY.hakId, changes: { modules: ["production.enabled", "finance.enabled", "depo.multiEnabled"] }, password: passwordBuffer(ARA_PAROLASI), reason: "teslim bağı bekçisi", actor: "bekci" }),
    ).then(
      (r) => r,
      (e: { status?: number; code?: string; message?: string }) => `${e.status ?? ""} ${e.code ?? e.message ?? ""}`,
    );
    kontrol("§1b yetenekli kurulumun yeni sürümü (yetenek parametresi VERİLMEDEN) kolondan okunan `hak-ara` ile ARA imzacıya gitti",
      typeof v2Y !== "string" && v2Y.surum === 2 && v2Y.imzalayanKid === f.ara.kid,
      typeof v2Y === "string" ? v2Y : v2Y.imzalayanKid);
    if (typeof v2Y === "string") throw new Error(`yetenekli kurulumun v2'si basılamadı: ${v2Y}`);
    // Eski derlemeye dönmüş kurulum: güncel sürüm ara imzalı (geçmişte yetenekliydi), kolon bugün boş.
    const v2E = await runAsCli(() =>
      hakSvc.issueEntitlementVersion(ctx, { entitlementId: kE.hakId, changes: { modules: ["production.enabled", "finance.enabled", "depo.multiEnabled"] }, password: passwordBuffer(ARA_PAROLASI), capabilities: ["hak-ara"], reason: "teslim bağı bekçisi", actor: "bekci" }),
    );
    kontrol("§1c ✓K eski kurulumun GÜNCEL sürümü ara imzalı (v2) — §3'ün eşitliği tesadüf değil", v2E.surum === 2 && v2E.imzalayanKid === f.ara.kid);

    const iptalSatiri = { kid: anahtarUret("alt-2024-9").kid, sertifikaId: randomUUID(), kullanim: "ALT" as const, tarih: msToIso(Date.now()), neden: "bekçi: teslim bağı" };
    const iptalBelgesi = iptalBas(f.kok, iptalYuku(f, { sira: 1, iptaller: [iptalSatiri] }));
    const ice = await importRevocation({ token: iptalBelgesi, anchor: ctx.keys.anchor, actor: YUKLEYEN });
    kontrol("§1d iptal belgesi (sıra 1, yüklü olmayan bir ALT) deftere girdi", ice.durum === "EKLENDI" && ice.sira === 1);

    console.log("\n§2 yetenekli yoklama");
    const v1Y = await surumBelgesi(kY.hakId, 1);
    const pY = await yokla(kY, aY, kiraIdOf(eY.json), { hakId: kY.hakId, surum: 1, ozet: jwsDigest(v1Y) }, YETENEKLER);
    const kiraY = kiraYuku(pY.json);
    const yanitY = LicenseResponseSchema.safeParse(pY.json);
    const kiraYDogru = yanitY.success ? verifyLease(yanitY.data.kira, f.kokler) : null;
    kontrol("§2a ✓K yanıt ARA imzalı güncel HAK (v2) taşır; kira hakSurum = 2, hakOzeti = teslim edilen belgenin özeti; kira ALT ile doğrulanır",
      pY.status === 200 && ara(pY.json.hak) === true && pY.json.hak === v2Y.belge && kiraY.hakSurum === 2 && kiraY.hakOzeti === jwsDigest(v2Y.belge) && !!kiraYDogru?.ok,
      yanitOzeti(pY));
    const iptalY = typeof pY.json.iptal === "string" ? verifyRevocation(pY.json.iptal, f.kokler) : null;
    kontrol("§2b ✓K yanıt dağıtılan iptal belgesini taşır (kökle doğrulanır, sıra 1) ve kira iptalSira = 1",
      pY.json.iptal === iptalBelgesi && !!iptalY?.ok && iptalY.value.document.sira === 1 && kiraY.iptalSira === 1,
      yanitOzeti(pY));
    const kiraSatiriY = await prisma.kira.findUniqueOrThrow({ where: { id: kiraIdOf(pY.json) } });
    kontrol("§2c kira defteri satırı da teslim edilen sürüme bağlı (hakSurum 2)", kiraSatiriY.hakSurum === 2);

    console.log("\n§3 yeteneksiz (eski) yoklama");
    const v1E = await surumBelgesi(kE.hakId, 1);
    const pE = await yokla(kE, aE, kiraIdOf(eE.json), { hakId: kE.hakId, surum: 1 });
    const kiraE = kiraYuku(pE.json);
    kontrol("§3a kira en yeni ARA-DIŞI sürüme (v1) bağlı, hakOzeti v1'in özeti; fabrikanın elindeki v1 → HAK yeniden GÖNDERİLMEZ",
      pE.status === 200 && kiraE.hakSurum === 1 && kiraE.hakOzeti === jwsDigest(v1E) && pE.json.hak === null,
      yanitOzeti(pE));
    kontrol("§3b iptal belgesi eski fabrikaya da gider (yanıt gevşek, eski fabrika atar) ve kira iptalSira = 1",
      pE.json.iptal === iptalBelgesi && kiraE.iptalSira === 1, yanitOzeti(pE));
    const pE2 = await yokla(kE, aE, kiraIdOf(pE.json), null);
    const kiraE2 = kiraYuku(pE2.json);
    kontrol("§3c HAK'sız eski fabrikaya kök imzalı v1 gönderilir (ara imzalı v2 ASLA), kira v1'e bağlı",
      pE2.status === 200 && pE2.json.hak === v1E && ara(pE2.json.hak) === false && kiraE2.hakSurum === 1 && kiraE2.hakOzeti === jwsDigest(v1E),
      yanitOzeti(pE2));

    console.log("\n§4 aynı kirayı yeniden veren yollar");
    const v3Y = await runAsCli(() =>
      hakSvc.issueEntitlementVersion(ctx, { entitlementId: kY.hakId, changes: { modules: ["production.enabled", "finance.enabled"] }, password: passwordBuffer(ARA_PAROLASI), reason: "araya giren sürüm", actor: "bekci" }),
    );
    const tekrar = await yokla(kY, aY, kiraIdOf(eY.json), { hakId: kY.hakId, surum: 1, ozet: jwsDigest(v1Y) }, YETENEKLER);
    kontrol("§4a yoklama tekrarı (önceki kirayla, pencere içinde) AYNI kirayı verir ve HAK o kiranın bağlı olduğu v2'dir — araya giren v3 DEĞİL",
      v3Y.surum === 3 && tekrar.status === 200 && kiraIdOf(tekrar.json) === kiraIdOf(pY.json) && tekrar.json.hak === v2Y.belge,
      `${tekrar.status} ${tekrar.kod ?? ""} kira=${kiraIdOf(tekrar.json) === kiraIdOf(pY.json)} hak=v${tekrar.json.hak === v3Y.belge ? 3 : tekrar.json.hak === v2Y.belge ? 2 : "?"}`);
    const eTekrar = await etkinlestir(kY, aY, YETENEKLER);
    kontrol("§4b etkinleştirme tekrarı aynı etkinleştirme kirasını verir ve HAK o kiranın bağlı olduğu v1'dir (hakOzeti tutar)",
      eTekrar.status === 200 && kiraIdOf(eTekrar.json) === kiraIdOf(eY.json) && eTekrar.json.hak === v1Y && kiraYuku(eTekrar.json).hakOzeti === jwsDigest(v1Y),
      `${eTekrar.status} ${eTekrar.kod ?? ""}`);

    console.log("\n§5 sürüm geri dönüşü (yetenek bildirmeyen yoklama)");
    const geri = await yokla(kY, aY, kiraIdOf(pY.json), { hakId: kY.hakId, surum: 2, ozet: jwsDigest(v2Y.belge) });
    const kiraGeri = kiraYuku(geri.json);
    const instGeri = await prisma.kurulum.findUniqueOrThrow({ where: { id: kY.kurulumDbId } });
    kontrol("§5a eski derlemeye dönen fabrika AYNI yanıtta kök imzalı v1 alır (ara imzalı v2/v3 değil), kira v1'e bağlı; kolon boşaldı",
      geri.status === 200 && geri.json.hak === v1Y && kiraGeri.hakSurum === 1 && kiraGeri.hakOzeti === jwsDigest(v1Y) && instGeri.yetenekler.length === 0,
      `${yanitOzeti(geri)} kolon=${instGeri.yetenekler.join()}`);

    console.log("\n§6 hiç etkinleşmemiş kurulum: beklenen yetenek yalnız imzaya, teslim kayıttan");
    const { findEntitlementForDelivery } = await import("../src/services/lease.service");
    const kN = await kurulumFiksturu(ctx, { ilkImzaParolasi: ARA_PAROLASI });
    temizlenecek.push(kN.kurulumDbId);
    const instN = await prisma.kurulum.findUniqueOrThrow({ where: { id: kN.kurulumDbId } });
    const hakN = await prisma.hak.findUniqueOrThrow({ where: { id: kN.hakId } });
    const v1N = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: kN.hakId, surum: 1 } } });
    const kayittan = await findEntitlementForDelivery(prisma, instN, hakN);
    const govdeden = await findEntitlementForDelivery(prisma, instN, hakN, { capabilities: YETENEKLER });
    kontrol("§6a ETKINLESMEDI: v1 ara imzalı (imza planı beklenen yetenek) ama kayıttan teslim YETENEKSİZ yoldan (withheld) · gövdede hak-ara bildirene ara v1",
      instN.durum === "ETKINLESMEDI" && instN.yetenekler.length === 0 && v1N.imzalayanKid === f.ara.kid && kayittan?.surum === 1 && kayittan.withheld !== undefined && govdeden?.belge === v1N.belge && govdeden.withheld === undefined,
      JSON.stringify({ k: kayittan && { s: kayittan.surum, w: kayittan.withheld }, g: govdeden?.surum }));
  } finally {
    await sunucu?.durdur();
    await temizleIptalBelgeleri(YUKLEYEN);
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
