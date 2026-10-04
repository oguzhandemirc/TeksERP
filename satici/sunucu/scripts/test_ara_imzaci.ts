// =============================================================================
// HAK ARA İMZACISI (G4) · YETENEK KAPISI · KÖK KUYRUĞU · UZUN UFUK (K2) · ANAHTAR SÜRESİ (K4) — kendi _test DB'si.
//   §1 anahtar deposu: `*.ara.json` (sarılı + kök imzalı `HAK` sertifikası) yüklenir ve imzalar; süresi dolmuş ara
//      künyede görünür ama İMZALAMAZ; başka anahtarın sertifikası · sınıf kümesi uyuşmayan · çapa dışı kökün imzaladığı ·
//      yanlış uzantıyla konmuş (`.kok.json`) ara dosyası YÜKLENMEZ; emekli künye (`*.sertifika.json`) künyede EMEKLI
//   §2 imza alt süreci: ara imzacı YALNIZ kendi sertifikasını gömülü taşıyan HAK'ı imzalar; sertifika ve iptal belgesi
//      basamaz; ufuk tavanını (TEST > 45) aşan HAK'ı basmaz; kök, ara sertifikalı HAK'ı basmaz; kapsam ARA: ERİŞİM·CLI
//      geçer, GENEL (bayi yolu) ve emekli TAILNET 404, parola alt sürece yazılmaz
//   §3 yetenek kapısı: `hak-ara` bildiren kuruluma ARA, bildirmeyene KÖK (VDS'te varsa), ikisi de yoksa KUYRUK; ara
//      imzalı HAK fabrikanın doğrulayıcısından ARA olarak geçer; eski derlemeye ara imzalı HAK GİTMEZ
//      (`deliverableEntitlement`); arayüz planı uyuşmazsa 409 ve parola kullanılmaz
//   §4 uzun ufuk (K2): süresiz/400+ yalnız yönetici + lisans numarası (parola alt sürece gitmeden RED); defterde
//      `uzunUfuk` + `UZUN_UFUK_VERILDI` TEK kez; aynı uzun ufkun yeniden imzası onay istemez; DEMO/TEST ≤ 45
//      (UFUK_TAVANI_ASIMI); varsayılan 400 / 45; sınıf daralınca ufuk tavana iner
//   §5 kök VDS'te YOKKEN: eski derlemenin HAK değişikliği kuyruğa düşer (HAK alanları değişmez), bekleyen talep varken
//      yeni sürüm yazılmaz — kuyruktan ÖNCE hazırlanmış imzalı sürüm de (TOCTOU, yazıcı kilit altında yeniden bakar);
//      kira + indirme belirteci GERÇEK sunucuda sürer (etkinleştirme + yoklama 200)
//   §6 kuyruk → tören → içe aktarma: dışa aktarılan yük CLI'da (`kuyruk-imzala`) kökle imzalanır, içe aktarmada sürüm
//      yazılır, talep IMZALANDI; tekrar VARDI; başka talebin belgesi 409; pasif HAK ESKIDI; iptal BEKLIYOR → IPTAL
//   §7 portal: imza planı · plan uyuşmazlığı 409 (imza sayacı artmaz) · eski arayüz gövdesi (kokParolasi) KOK'ta 201 ·
//      kuyruk 202 (parola taşıyamaz) · liste + iptal · uzun ufuk rol + onay · toplu yeniden basım (yeteneksiz → atlar)
//   §8 toplu yeniden basım servisi: tek parola, yetenekliler ARA imzalı yeni sürüm, yeteneksiz atlanır; yanlış parola
//      hiçbir sürüm yazmaz
//   §9 anahtar süresi (K4): kullanım başına en yeni sertifikanın bitişine 30/15/7/1 gün kala bildirim, eşik başına TEK
// ⭐ KALICI SONDA ✓K (her koşumda): §1b ara GERÇEKTEN imzalar (kör RED değil) · §2g ERİŞİM'de ara imzası
//    parolayı alt sürece GERÇEKTEN yazar · §4c onaylı uzun ufuk GERÇEKTEN imzalanır · §5f kök yokken yoklama GERÇEKTEN 200.
// NEGATİF SONDA (dosya DIŞI, cp + shasum ile geri alındı; 2026-10-04): `SIGNING_ORIGINS.ARA` eski `[TAILNET, CLI]` → §0a ❌ ·
//   §2g ❌ (ERİŞİM 404); `"GENEL"` eklendi → §0a ❌ · §2g ❌ (GENEL imzaladı).
// NEGATİF SONDA (tünel kapatma T1, 2026-10-05): `SIGNING_ORIGINS.ARA`ya "TAILNET" geri → §0a · §2g ❌ · düzenek portal
//   isteklerine Access JWT'si eklemedi → §7a–§7i ❌ (taşıma ERİŞİM'den gerçekten geçiyor); cp + shasum ile geri alındı.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_ara_imzaci.ts   (kendi _test DB'si)
// =============================================================================
import type { Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DAY_MS, DOWNLOAD_PRODUCTS, ENDPOINTS, LicenseResponseSchema, TYP, msToIso, parseJws, verifyEntitlement, verifyLease, type CertificateDoc, type LicenseClass } from "../src/lisans-protokol";
import {
  anahtarUret,
  hakYuku,
  kurulumAnahtariUret,
  sertifikaBas,
  sertifikaYuku,
  type Fikstur,
  type TestAnahtari,
} from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { KeyFileError, RETIRED_KEY_TYPE, passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { SIGNING_ORIGINS, signingKindOf } from "../src/keys/signing-scope";
import { runAsCli, runInScope, type ScopeOrigin } from "../src/lib/request-scope";
import type { VendorContext } from "../src/services/context";
import {
  SATICI_KOKU,
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraIdOf,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
} from "./lib/test-ortam";

const ARA_PAROLASI = "bekci-ara-parolasi-2026";
const YANLIS = "yanlis-parola-bekci-2026";
const ARA_SINIFLARI: LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];

/** Ara anahtar dosyası (sarılı, sertifika gömülü); `ek` sertifikayı, `dosyaKid` dosyanın kid'ini ayrı verir (sondalar). */
async function araYaz(
  dizin: string,
  f: Fikstur,
  g: { konu?: TestAnahtari; imzalayan?: TestAnahtari; ek?: Partial<CertificateDoc>; dosyaSiniflari?: LicenseClass[]; dosyaKid?: string; dosyaAdi?: string } = {},
): Promise<string> {
  const konu = g.konu ?? f.ara;
  const sertifika = sertifikaBas(g.imzalayan ?? f.kok, sertifikaYuku(f, konu, "HAK", { siniflar: ARA_SINIFLARI, ...g.ek }));
  const kid = g.dosyaKid ?? konu.kid;
  const dosya = path.join(dizin, g.dosyaAdi ?? `${kid}.ara.json`);
  writeKeyFileExclusive(dosya, await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid, siniflar: g.dosyaSiniflari ?? (g.ek?.siniflar as LicenseClass[] | undefined) ?? ARA_SINIFLARI, sertifika }, konu.privateKey, passwordBuffer(ARA_PAROLASI)));
  return sertifika;
}

/** Ortam dizininin KÖKSÜZ kopyası (VDS'in v2 hâli): anahtarlar + sırlar, `*.kok.json` hariç. */
function koksuzKopya(kaynak: string, araDahil = true): string {
  const hedef = mkdtempSync(path.join(os.tmpdir(), "satici-koksuz-"));
  for (const ad of readdirSync(kaynak)) {
    if (ad.endsWith(".kok.json") || (!araDahil && ad.endsWith(".ara.json"))) continue;
    copyFileSync(path.join(kaynak, ad), path.join(hedef, ad));
  }
  return hedef;
}

function kodu(err: unknown): string {
  const e = err as { status?: number; code?: string; kind?: string; message?: string };
  if (e instanceof KeyFileError) return `KeyFileError ${e.kind}`;
  return e.status !== undefined ? `${e.status} ${e.code}` : `HATA ${e.message ?? ""}`;
}

async function dene<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; kod: string; err: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, kod: kodu(err), err };
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const hakSvc = await import("../src/services/entitlement.service");
  const kuyrukSvc = await import("../src/services/root-queue.service");
  const { signWithWrappedKey, spawnSignerProcess } = await import("../src/keys/signer");
  const { syncKeyRegistry } = await import("../src/services/maintenance");
  const { keyExpiryWarnings, scanKeyExpiry } = await import("../src/notifications/key-expiry");
  const temizlenecek: string[] = [];
  const kullanicilar: string[] = [];
  const geciciDizinler: string[] = [];
  const ekKidler: string[] = [f.ara.kid];
  const bildirimAnahtarlari: string[] = [];
  let sunucu2: Awaited<ReturnType<typeof sunucuBaslat>> | null = null;
  let portal: Awaited<ReturnType<typeof portalSunuculariKur>> | null = null;
  let portalKoksuz: Awaited<ReturnType<typeof portalSunuculariKur>> | null = null;
  try {
    console.log("\n§0 kapsam haritası");
    kontrol("§0a ara anahtar türü → ARA; ARA yalnız ERİŞİM · CLI (GENEL/bayi yolu ve emekli TAILNET YOK)", signingKindOf("tekserp-ara-anahtar") === "ARA" && JSON.stringify(SIGNING_ORIGINS.ARA) === JSON.stringify(["ERISIM", "CLI"]), JSON.stringify(SIGNING_ORIGINS.ARA));

    console.log("\n§1 anahtar deposu");
    const araSertifikasi = await araYaz(ortam.dizin, f);
    const araDosyasi = path.join(ortam.dizin, `${f.ara.kid}.ara.json`);
    ctx.keys = KeyStore.load(ctx.config);
    const ara = ctx.keys.intermediateFor("URETIM", Date.now());
    kontrol("§1a ara imzacı yüklendi, şimdi geçerli, URETIM için seçildi; uyarı yok", ara?.kid === f.ara.kid && ara.usable && ctx.keys.warnings.filter((w) => !w.startsWith("Güven çapası DOSYADAN")).length === 0, ctx.keys.warnings.join(" | "));
    kontrol("§1a' ara BAYI ve BARINDIRILAN için seçilmez (sınıf sertifikadan)", ctx.keys.intermediateFor("BAYI", Date.now()) === null && ctx.keys.intermediateFor("BARINDIRILAN", Date.now()) === null);
    const ayri = mkdtempSync(path.join(os.tmpdir(), "satici-ara-depo-"));
    geciciDizinler.push(ayri);
    const eski = anahtarUret("ara-2025-9");
    await araYaz(ayri, f, { konu: eski, ek: { baslangic: msToIso(Date.now() - 200 * DAY_MS), bitis: msToIso(Date.now() - 80 * DAY_MS) } });
    await araYaz(ayri, f, { dosyaKid: "ara-2026-7" });
    await araYaz(ayri, f, { konu: anahtarUret("ara-2026-8"), dosyaSiniflari: ["URETIM"] });
    await araYaz(ayri, f, { konu: anahtarUret("ara-2026-9"), imzalayan: anahtarUret("kok-fikstur-1") });
    await araYaz(ayri, f, { konu: anahtarUret("ara-2026-6"), dosyaAdi: "kok-sonda-1.kok.json" });
    const depo = KeyStore.load({ ANAHTAR_DIZINI: ayri, GUVEN_CAPASI: undefined, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi });
    const uyari = depo.warnings.join(" | ");
    kontrol("§1b süresi dolmuş ara künyede (usable=false) ama İMZALAMAZ", depo.intermediates.some((k) => k.kid === "ara-2025-9" && !k.usable) && depo.intermediateFor("URETIM", Date.now()) === null && /ara-2025-9 ara imzacı sertifikası şu an geçerli değil/.test(uyari), uyari.slice(0, 200));
    kontrol("§1c başka anahtarın sertifikası · uyuşmayan sınıf kümesi · çapa dışı kök · yanlış uzantı YÜKLENMEZ",
      /ara-2026-7 sertifikası başka bir anahtara ya da sınıf kümesine ait/.test(uyari) &&
        /ara-2026-8 sertifikası başka bir anahtara ya da sınıf kümesine ait/.test(uyari) &&
        /ara-2026-9 ara imzacı sertifikası geçersiz \(/.test(uyari) &&
        /kok-sonda-1\.kok\.json türü \(tekserp-ara-anahtar\) uzantısıyla uyuşmuyor/.test(uyari) &&
        depo.intermediates.length === 1 &&
        depo.wrapped.length === 0,
      `${depo.intermediates.map((k) => k.kid).join(",")}`);
    const emekli = anahtarUret("alt-2025-1");
    const emekliSert = sertifikaBas(f.kok, sertifikaYuku(f, emekli, "ALT", { baslangic: msToIso(Date.now() - 200 * DAY_MS), bitis: msToIso(Date.now() - 10 * DAY_MS) }));
    writeKeyFileExclusive(path.join(ortam.dizin, "alt-2025-1.sertifika.json"), { tur: RETIRED_KEY_TYPE, surum: 1, kid: emekli.kid, kaynakTur: "tekserp-alt-anahtar", x: emekli.x, sertifika: emekliSert, emeklilik: new Date().toISOString() });
    ekKidler.push(emekli.kid);
    ctx.keys = KeyStore.load(ctx.config);
    await syncKeyRegistry(ctx.keys);
    const kayitlar = await prisma.anahtarKaydi.findMany({ where: { kid: { in: [f.ara.kid, emekli.kid] } } });
    kontrol("§1d künye: ara imzacı ARA/AKTIF, emekli künye EMEKLI (özel yarı yok, imzada yok)",
      kayitlar.find((r) => r.kid === f.ara.kid)?.tur === "ARA" && kayitlar.find((r) => r.kid === f.ara.kid)?.durum === "AKTIF" && kayitlar.find((r) => r.kid === emekli.kid)?.durum === "EMEKLI" && ctx.keys.leaseKeyFor("URETIM", Date.now())?.kid === f.alt.kid,
      kayitlar.map((r) => `${r.kid}:${r.tur}/${r.durum}`).join(" "));

    console.log("\n§2 imza alt süreci (CLI kapsamı) ve imza kapsamı");
    const araImzala = (yuk: Record<string, unknown>, typ: "tekserp-hak" | "tekserp-sertifika" | "tekserp-iptal" = TYP.HAK, parola = ARA_PAROLASI) =>
      dene(() => runAsCli(() => signWithWrappedKey({ keyFile: araDosyasi, typ, payload: yuk, password: passwordBuffer(parola) })));
    const iyi = await araImzala(hakYuku(f, { imzaciSertifikasi: araSertifikasi, cevrimdisiUfukGun: 400 }) as unknown as Record<string, unknown>);
    const iyiDogru = iyi.ok ? verifyEntitlement(iyi.value, f.kokler, { nowMs: Date.now() }) : null;
    kontrol("§2a ✓K ara kendi sertifikalı HAK'ı imzalar → doğrulayıcıda ARA", !!iyiDogru?.ok && iyiDogru.value.signer.kind === "ARA" && iyiDogru.value.signer.kid === f.ara.kid, iyi.ok ? "" : iyi.kod);
    const sertsiz = await araImzala(hakYuku(f) as unknown as Record<string, unknown>);
    const baskaSert = await araImzala(hakYuku(f, { imzaciSertifikasi: sertifikaBas(f.kok, sertifikaYuku(f, eski, "HAK", { siniflar: ARA_SINIFLARI })) }) as unknown as Record<string, unknown>);
    kontrol("§2b ara: sertifikasız HAK ve BAŞKA ara sertifikalı HAK RED (YETKISIZ)", !sertsiz.ok && /YETKISIZ/.test(sertsiz.kod) && !baskaSert.ok && /YETKISIZ/.test(baskaSert.kod), `${sertsiz.ok ? "GECTI" : sertsiz.kod} / ${baskaSert.ok ? "GECTI" : baskaSert.kod}`);
    const sertBas = await araImzala(sertifikaYuku(f, anahtarUret("alt-2026-5"), "ALT") as unknown as Record<string, unknown>, TYP.SERTIFIKA);
    const iptalBas = await araImzala({ v: 1, iptalId: randomUUID(), sira: 9, verilis: msToIso(Date.now()), iptaller: [] }, TYP.IPTAL);
    kontrol("§2c ara sertifika ve iptal belgesi BASAMAZ (yalnız kök)", !sertBas.ok && /YETKISIZ/.test(sertBas.kod) && !iptalBas.ok && /YETKISIZ/.test(iptalBas.kod), `${sertBas.ok ? "GECTI" : sertBas.kod} / ${iptalBas.ok ? "GECTI" : iptalBas.kod}`);
    const tavan = await araImzala(hakYuku(f, { sinif: "TEST", imzaciSertifikasi: araSertifikasi, cevrimdisiUfukGun: 100 }) as unknown as Record<string, unknown>);
    kontrol("§2d ufuk tavanı alt süreçte de: TEST HAK'ı 100 gün → RED", !tavan.ok && /YETKISIZ/.test(tavan.kod) && /en çok 45/.test(String((tavan as { err?: Error }).err?.message ?? "")), tavan.ok ? "GECTI" : tavan.kod);
    const kokAraSert = await dene(() =>
      runAsCli(() => signWithWrappedKey({ keyFile: path.join(ortam.dizin, `${f.kok.kid}.kok.json`), typ: TYP.HAK, payload: hakYuku(f, { imzaciSertifikasi: araSertifikasi }) as unknown as Record<string, unknown>, password: passwordBuffer(TEST_KOK_PAROLASI) })),
    );
    kontrol("§2e kök, ara sertifikalı HAK'ı basmaz", !kokAraSert.ok && /YETKISIZ/.test(kokAraSert.kod), kokAraSert.ok ? "GECTI" : kokAraSert.kod);
    const yanlisAra = await araImzala(hakYuku(f, { imzaciSertifikasi: araSertifikasi }) as unknown as Record<string, unknown>, TYP.HAK, YANLIS);
    kontrol("§2f yanlış ara parolası → YANLIS_PAROLA (mesajda parola yok)", !yanlisAra.ok && yanlisAra.kod === "KeyFileError YANLIS_PAROLA" && !String((yanlisAra as { err?: Error }).err?.message).includes(YANLIS));
    const kapsamDene = async (kapsam: ScopeOrigin): Promise<{ sonuc: string; yazilan: number; sifir: boolean }> => {
      const kukla = spawnSignerProcess();
      const buf = passwordBuffer(ARA_PAROLASI);
      const r = await dene(() =>
        runInScope(kapsam, () => signWithWrappedKey({ keyFile: araDosyasi, typ: TYP.HAK, payload: hakYuku(f, { imzaciSertifikasi: araSertifikasi }) as unknown as Record<string, unknown>, password: buf, child: kukla }), kapsam === "ERISIM" ? "sonda@ornek.test" : undefined),
      );
      const yazilan = (kukla.stdin as Socket | null)?.bytesWritten ?? -1;
      kukla.kill();
      return { sonuc: r.ok ? "GECTI" : r.kod, yazilan, sifir: buf.every((b) => b === 0) };
    };
    const erisim = await kapsamDene("ERISIM");
    const genel = await kapsamDene("GENEL");
    const tailnet = await kapsamDene("TAILNET" as never);
    kontrol("§2g ✓K ara imzası: GENEL ve elle kurulmuş emekli TAILNET kapsamı 404 (parola alt sürece YAZILMADI, sıfırlandı); ERİŞİM imzalar",
      [genel, tailnet].every((x) => x.sonuc === "404 BULUNAMADI" && x.yazilan === 0 && x.sifir) && erisim.sonuc === "GECTI" && erisim.yazilan > 0,
      `${erisim.sonuc}/${genel.sonuc}/${tailnet.sonuc} · ${erisim.yazilan} bayt`);

    console.log("\n§3 yetenek kapısı");
    const k1 = await kurulumFiksturu(ctx);
    temizlenecek.push(k1.kurulumDbId);
    const v1 = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: k1.hakId, surum: 1 } } });
    const v1Yuk = parseJws(v1.belge);
    kontrol("§3a yeteneksiz kurulum: KÖK imzası (kök VDS'te) + varsayılan ufuk 400 HAK'ta ve satırda", v1.imzalayanKid === f.kok.kid && v1Yuk.ok && v1Yuk.value.payload.cevrimdisiUfukGun === 400 && (await prisma.hak.findUniqueOrThrow({ where: { id: k1.hakId } })).cevrimdisiUfukGun === 400);
    const plan = (keys: KeyStore, sinif: LicenseClass, caps: string[]) => hakSvc.planEntitlementSigner(keys, sinif, caps, Date.now()).kind;
    const koksuzDizin = koksuzKopya(ortam.dizin);
    const koksuzAraDizin = koksuzKopya(ortam.dizin, false);
    geciciDizinler.push(koksuzDizin, koksuzAraDizin);
    const koksuz = KeyStore.load({ ...ctx.config, ANAHTAR_DIZINI: koksuzDizin });
    const hicbiri = KeyStore.load({ ...ctx.config, ANAHTAR_DIZINI: koksuzAraDizin });
    kontrol("§3b plan: hak-ara → ARA · yeteneksiz + kök → KOK · yeteneksiz köksüz → KUYRUK · hak-ara + ara yok + kök yok → KUYRUK · BAYI sınıfı hak-ara olsa da ara değil",
      plan(ctx.keys, "URETIM", ["hak-ara"]) === "ARA" && plan(ctx.keys, "URETIM", []) === "KOK" && plan(koksuz, "URETIM", []) === "KUYRUK" && plan(koksuz, "URETIM", ["hak-ara", "iptal"]) === "ARA" && plan(hicbiri, "URETIM", ["hak-ara"]) === "KUYRUK" && plan(ctx.keys, "BAYI", ["hak-ara"]) === "KOK");
    kontrol("§3b' yetenek okuyucusu fail-closed: kolon boş/biçimsiz → boş; geçerli liste aynen",
      hakSvc.installationCapabilities({ yetenekler: undefined }).length === 0 && hakSvc.installationCapabilities({ yetenekler: ["Hak Ara"] }).length === 0 && hakSvc.installationCapabilities({ yetenekler: "hak-ara" }).length === 0 && hakSvc.installationCapabilities({ yetenekler: ["hak-ara", "iptal"] }).join() === "hak-ara,iptal");
    const v2Sonuc = await dene(() =>
      runAsCli(() =>
        hakSvc.issueEntitlementVersion(ctx, { entitlementId: k1.hakId, changes: { modules: ["production.enabled", "finance.enabled", "depo.multiEnabled"] }, password: passwordBuffer(ARA_PAROLASI), capabilities: ["hak-ara"], reason: "ara imzacı bekçisi", actor: "bekci" }),
      ),
    );
    const v2Dogru = v2Sonuc.ok ? verifyEntitlement(v2Sonuc.value.belge, f.kokler, { nowMs: Date.now() }) : null;
    kontrol("§3c hak-ara bildiren kuruluma ARA imzalı sürüm: imzacı ara-…, HAK imzaciSertifikasi taşır, doğrulayıcıda ARA",
      v2Sonuc.ok && v2Sonuc.value.imzalayanKid === f.ara.kid && !!v2Dogru?.ok && v2Dogru.value.signer.kind === "ARA" && typeof v2Dogru.value.document.imzaciSertifikasi === "string",
      v2Sonuc.ok ? v2Sonuc.value.imzalayanKid : v2Sonuc.kod);
    const hak1 = await prisma.hak.findUniqueOrThrow({ where: { id: k1.hakId } });
    const eskiye = await hakSvc.deliverableEntitlement(prisma, hak1, []);
    const yeniye = await hakSvc.deliverableEntitlement(prisma, hak1, ["hak-ara"]);
    kontrol("§3d eski derlemeye ara imzalı HAK GİTMEZ: yeteneksize en yeni ara-dışı (v1 kök), yeteneklıya güncel (v2 ara)", eskiye?.surum === 1 && eskiye.imzalayanKid === f.kok.kid && yeniye?.surum === 2 && yeniye.imzalayanKid === f.ara.kid, `${eskiye?.surum}/${yeniye?.surum}`);
    const yanlisPlan = passwordBuffer(YANLIS);
    const uyusmaz = await dene(() => runAsCli(() => hakSvc.prepareEntitlementVersion(ctx, { entitlementId: k1.hakId, password: yanlisPlan, capabilities: [], expectedSigner: "ARA", reason: "plan sondası", actor: "bekci" })));
    kontrol("§3e arayüz planı uyuşmazsa 409 DURUM_CAKISMASI (yanlış parola denenmedi → 400 değil), parola sıfırlandı", !uyusmaz.ok && uyusmaz.kod === "409 DURUM_CAKISMASI" && yanlisPlan.every((b) => b === 0), uyusmaz.ok ? "GECTI" : uyusmaz.kod);
    const araYanlis = await dene(() => runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: k1.hakId, password: passwordBuffer(YANLIS), capabilities: ["hak-ara"], reason: "yanlış ara", actor: "bekci" })));
    kontrol("§3f yanlış ara parolası → 400 IMZA_PAROLASI_HATALI, sürüm yazılmadı", !araYanlis.ok && araYanlis.kod === "400 IMZA_PAROLASI_HATALI" && (await prisma.hak.findUniqueOrThrow({ where: { id: k1.hakId } })).guncelSurum === 2);

    console.log("\n§4 uzun ufuk (K2)");
    const kU = await kurulumFiksturu(ctx);
    temizlenecek.push(kU.kurulumDbId);
    const uzun = (onay: { admin: boolean; confirmation?: string } | undefined, parola = YANLIS, gun: number | null = null) =>
      dene(() =>
        runAsCli(() =>
          hakSvc.issueEntitlementVersion(ctx, { entitlementId: kU.hakId, changes: { offlineHorizonDays: gun }, password: passwordBuffer(parola), capabilities: ["hak-ara"], longHorizonApproval: onay, reason: "uzun ufuk bekçisi", actor: "bekci" }),
        ),
      );
    const yetkisiz = await uzun(undefined);
    const operator = await uzun({ admin: false, confirmation: kU.lisansNo });
    const onaysiz = await uzun({ admin: true });
    const yanlisOnay = await uzun({ admin: true, confirmation: "TKS-0000-0000" });
    kontrol("§4a süresiz ufuk: rol yoksa 403 · operatör 403 · onaysız/yanlış onay 400 IKINCI_ONAY_GEREKLI — hepsi YANLIŞ parolayla: parola alt sürece GİTMEDİ",
      [yetkisiz, operator].every((r) => !r.ok && r.kod === "403 YETKISIZ") && [onaysiz, yanlisOnay].every((r) => !r.ok && r.kod === "400 IKINCI_ONAY_GEREKLI"),
      [yetkisiz, operator, onaysiz, yanlisOnay].map((r) => (r.ok ? "GECTI" : r.kod)).join(" · "));
    const sayUzun = () => prisma.bildirim.count({ where: { olay: "UZUN_UFUK_VERILDI", kurulumId: kU.kurulumDbId } });
    kontrol("§4b reddedilen denemeler bildirim yazmadı, sürüm yazmadı", (await sayUzun()) === 0 && (await prisma.hak.findUniqueOrThrow({ where: { id: kU.hakId } })).guncelSurum === 1);
    const onayli = await uzun({ admin: true, confirmation: ` ${kU.lisansNo} ` }, ARA_PAROLASI);
    const uSatir = onayli.ok ? await prisma.hakSurumu.findUniqueOrThrow({ where: { id: (onayli.value as { id: string }).id } }) : null;
    const uHak = await prisma.hak.findUniqueOrThrow({ where: { id: kU.hakId } });
    const uYuk = uSatir ? parseJws(uSatir.belge) : null;
    kontrol("§4c ✓K yönetici + lisans no → ARA imzalı süresiz HAK: belgede cevrimdisiUfukGun=null, defterde uzunUfuk, satırda süresiz, bildirim 2 kanal",
      !!uSatir && uSatir.uzunUfuk && uHak.cevrimdisiUfukSuresiz && uHak.cevrimdisiUfukGun === null && !!uYuk?.ok && uYuk.value.payload.cevrimdisiUfukGun === null && (await sayUzun()) === 2,
      onayli.ok ? "" : onayli.kod);
    const tekrar = await dene(() =>
      runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: kU.hakId, changes: { modules: ["production.enabled"] }, password: passwordBuffer(ARA_PAROLASI), capabilities: ["hak-ara"], reason: "modül değişimi", actor: "bekci" })),
    );
    const tSatir = tekrar.ok ? await prisma.hakSurumu.findUniqueOrThrow({ where: { id: (tekrar.value as { id: string }).id } }) : null;
    kontrol("§4d aynı uzun ufkun yeniden imzası onay İSTEMEZ (yeni veriliş değil) — defterde yine uzunUfuk, bildirim yine 2", tekrar.ok && !!tSatir?.uzunUfuk && (await sayUzun()) === 2, tekrar.ok ? "" : tekrar.kod);
    const kD = await kurulumFiksturu(ctx, { sinif: "DEMO" });
    temizlenecek.push(kD.kurulumDbId);
    const dV1 = parseJws((await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: kD.hakId, surum: 1 } } })).belge);
    const demoUzun = await dene(() => runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: kD.hakId, changes: { offlineHorizonDays: 100 }, password: passwordBuffer(YANLIS), reason: "demo tavanı", actor: "bekci" })));
    kontrol("§4e DEMO: varsayılan ufuk 45; 100 gün → 400 UFUK_TAVANI_ASIMI (parola denenmeden)", dV1.ok && dV1.value.payload.cevrimdisiUfukGun === 45 && !demoUzun.ok && demoUzun.kod === "400 UFUK_TAVANI_ASIMI", demoUzun.ok ? "GECTI" : demoUzun.kod);
    const r = hakSvc.resolveOfflineHorizon;
    kontrol("§4f ufuk çözümü (saf): v1 HAK varsayılan 400/45 · bayi 400 tavanı · sınıf daralınca tavana iner · açık istek 3650 sınırı",
      r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: false }, undefined, "URETIM", "ARA").days === 400 &&
        r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: false }, undefined, "TEST", "KOK").days === 45 &&
        r({ cevrimdisiUfukGun: 400, cevrimdisiUfukSuresiz: false }, undefined, "TEST", "ARA").days === 45 &&
        r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: true }, undefined, "URETIM", "BAYI").days === 400 &&
        r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: true }, undefined, "URETIM", "ARA").granted === false &&
        r({ cevrimdisiUfukGun: 400, cevrimdisiUfukSuresiz: false }, 800, "DR", "KOK").granted === true &&
        (await dene(async () => r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: false }, 401, "URETIM", "BAYI"))).ok === false &&
        (await dene(async () => r({ cevrimdisiUfukGun: null, cevrimdisiUfukSuresiz: false }, 3651, "URETIM", "KOK"))).ok === false);

    console.log("\n§5 kök VDS'te yokken: kuyruk + kira/indirme sürer");
    const ctxKoksuz: VendorContext = { ...ctx, keys: koksuz };
    const kP = await kurulumFiksturu(ctx);
    temizlenecek.push(kP.kurulumDbId);
    const kPAnahtar = kurulumAnahtariUret();
    sunucu2 = await sunucuBaslat({ ...ortam, dizin: koksuzDizin });
    const etkin = await imzaliPost(sunucu2.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: kP.kurulumId,
      amac: "etkinlestir",
      anahtar: kPAnahtar,
      govde: etkinlestirmeGovdesi({ kod: kP.kod, kurulumId: kP.kurulumId, anahtar: kPAnahtar, parmakIzi: f.parmakIzi }),
    });
    kontrol("§5a köksüz satıcı etkinleştirir (HAK + kira)", etkin.status === 200 && LicenseResponseSchema.safeParse(etkin.json).success, `${etkin.status} ${etkin.kod ?? ""}`);
    const once = await prisma.hak.findUniqueOrThrow({ where: { id: kP.hakId } });
    // TOCTOU: kök yerindeyken imzalı sürüm HAZIRLANIR, yazılmadan önce kuyruk talebi doğar (başka oturum).
    const hazirSurum = await runAsCli(() => hakSvc.prepareEntitlementVersion(ctx, { entitlementId: kP.hakId, password: passwordBuffer(TEST_KOK_PAROLASI), expectedSigner: "KOK", reason: "yarış sondası", actor: "bekci" }));
    const kuyrugaGirdi = await runAsCli(() =>
      hakSvc.issueEntitlementVersion(ctxKoksuz, { entitlementId: kP.hakId, changes: { modules: ["production.enabled", "ticaret.enabled"] }, password: passwordBuffer("parola-kullanilmaz-1"), reason: "kök yokken değişiklik", actor: "bekci", allowQueue: true }),
    );
    const sonra = await prisma.hak.findUniqueOrThrow({ where: { id: kP.hakId } });
    kontrol("§5b yeteneksiz kurulumun değişikliği KUYRUĞA düştü; HAK alanları ve sürümü DEĞİŞMEDİ",
      kuyrugaGirdi.mode === "QUEUED" && kuyrugaGirdi.row.durum === "BEKLIYOR" && kuyrugaGirdi.row.surum === 2 && sonra.guncelSurum === once.guncelSurum && JSON.stringify(sonra.moduller) === JSON.stringify(once.moduller));
    const ikinci = await dene(() => hakSvc.prepareRootRequest(ctxKoksuz, { entitlementId: kP.hakId, changes: { perpetual: false }, reason: "ikinci talep", actor: "bekci" }));
    const kokluImza = await dene(() => runAsCli(() => hakSvc.issueEntitlementVersion(ctx, { entitlementId: kP.hakId, password: passwordBuffer(TEST_KOK_PAROLASI), reason: "bekleyen varken", actor: "bekci" })));
    kontrol("§5c bekleyen kök talebi varken ikinci talep de imzalı sürüm de 409 (kuyruk sessizce ezilmez)", !ikinci.ok && ikinci.kod === "409 DURUM_CAKISMASI" && !kokluImza.ok && kokluImza.kod === "409 DURUM_CAKISMASI", `${ikinci.ok ? "GECTI" : ikinci.kod} / ${kokluImza.ok ? "GECTI" : kokluImza.kod}`);
    const gecYazim = await dene(() => prisma.$transaction((tx) => hakSvc.recordEntitlementVersionTx(tx, hazirSurum)));
    kontrol("§5d TOCTOU: imzası kuyruktan ÖNCE hazırlanmış sürüm, talep doğduktan sonra YAZILAMAZ (yazıcı kilit altında yeniden bakar) → 409", !gecYazim.ok && gecYazim.kod === "409 DURUM_CAKISMASI" && (await prisma.hak.findUniqueOrThrow({ where: { id: kP.hakId } })).guncelSurum === once.guncelSurum, gecYazim.ok ? "YAZILDI" : gecYazim.kod);
    const imzaliYol = await dene(() => runAsCli(() => hakSvc.issueEntitlementVersion(ctxKoksuz, { entitlementId: k1.hakId, password: passwordBuffer("parola-kullanilmaz-2"), reason: "kuyruk düz biçimde", actor: "bekci" })));
    kontrol("§5e düz (kuyruğa izinsiz) çağrı KUYRUK planında 409 — imzalı sürüm beklenen yerde sessiz kuyruk yok", !imzaliYol.ok && imzaliYol.kod === "409 DURUM_CAKISMASI");
    const yoklama = await imzaliPost(sunucu2.genel, ENDPOINTS.POLL, {
      kurulumId: kP.kurulumId,
      amac: "yokla",
      anahtar: kPAnahtar,
      govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(etkin.json), hak: { hakId: kP.hakId, surum: 1 }, parmakIzi: f.parmakIzi }),
    });
    const yanit = LicenseResponseSchema.safeParse(yoklama.json);
    const kira = yanit.success ? verifyLease(yanit.data.kira, f.kokler) : null;
    kontrol("§5f ✓K kök yokken YOKLAMA 200: yeni kira ALT ile doğrulanır, her indirme ürününe belirteç var (kira/indirme sürer)",
      yoklama.status === 200 && !!kira?.ok && kira.value.document.hakSurum === 1 && yanit.success && yanit.data.indirmeBelirtecleri.length === DOWNLOAD_PRODUCTS.length,
      `${yoklama.status} ${yoklama.kod ?? ""}`);

    console.log("\n§6 kuyruk → tören (CLI) → içe aktarma");
    const disari = await kuyrukSvc.exportRootQueue(prisma);
    const talep = disari.talepler.find((t) => t.hakId === kP.hakId);
    kontrol("§6a dışa aktarma: bekleyen talep tam yüküyle (tür tekserp-kok-kuyrugu), imzacı sertifikası YOK", disari.tur === "tekserp-kok-kuyrugu" && !!talep && talep.yuk.surum === 2 && talep.yuk.imzaciSertifikasi === undefined && JSON.stringify(talep.yuk.moduller) === JSON.stringify(["production.enabled", "ticaret.enabled"]));
    const tdizin = mkdtempSync(path.join(os.tmpdir(), "satici-kuyruk-"));
    geciciDizinler.push(tdizin);
    const kuyrukDosyasi = path.join(tdizin, "kuyruk.json");
    writeFileSync(kuyrukDosyasi, JSON.stringify({ ...disari, talepler: disari.talepler.filter((t) => t.hakId === kP.hakId) }));
    const cikti = path.join(tdizin, "imzali.json");
    const cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "kuyruk-imzala", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--kuyruk=${kuyrukDosyasi}`, `--cikti=${cikti}`], {
      cwd: SATICI_KOKU,
      encoding: "utf8",
      input: `${TEST_KOK_PAROLASI}\n`,
      env: { PATH: process.env.PATH ?? "" },
    });
    const imzali = cli.status === 0 ? (JSON.parse(readFileSync(cikti, "utf8")) as { haklar: { talepId: string; belge: string }[] }) : null;
    kontrol("§6b CLI kuyruk-imzala: kök parolası stdin'den, belge kökle doğrulanır (KÖK imzacı)", !!imzali && imzali.haklar.length === 1 && verifyEntitlement(imzali.haklar[0]!.belge, f.kokler).ok, `${cli.status} ${cli.stderr.trim().slice(0, 160)}`);
    const belge = imzali?.haklar[0]?.belge ?? "";
    const ice = await dene(() => kuyrukSvc.importRootSignedEntitlement(ctx, { talepId: talep!.talepId, belge, actor: "bekci" }));
    const sonHak = await prisma.hak.findUniqueOrThrow({ where: { id: kP.hakId } });
    const kTalep = await prisma.hakKokTalebi.findUniqueOrThrow({ where: { id: talep!.talepId } });
    kontrol("§6c içe aktarma: sürüm 2 yazıldı (kök kid), HAK alanları imzalı yükle güncellendi, talep IMZALANDI + defter bağı",
      ice.ok && ice.value.durum === "IMZALANDI" && sonHak.guncelSurum === 2 && JSON.stringify(sonHak.moduller) === JSON.stringify(["production.enabled", "ticaret.enabled"]) && kTalep.durum === "IMZALANDI" && kTalep.hakSurumuId !== null,
      ice.ok ? ice.value.durum : ice.kod);
    const tekrarIce = await dene(() => kuyrukSvc.importRootSignedEntitlement(ctx, { talepId: talep!.talepId, belge, actor: "bekci" }));
    kontrol("§6d aynı belgenin tekrarı VARDI (idempotent, ikinci sürüm yok)", tekrarIce.ok && tekrarIce.value.durum === "VARDI" && (await prisma.hak.findUniqueOrThrow({ where: { id: kP.hakId } })).guncelSurum === 2);
    const t2 = await runAsCli(() => hakSvc.issueEntitlementVersion(ctxKoksuz, { entitlementId: kP.hakId, changes: { perpetual: false }, password: passwordBuffer("parola-kullanilmaz-3"), reason: "ikinci kuyruk", actor: "bekci", allowQueue: true }));
    const yabanci = await dene(() => kuyrukSvc.importRootSignedEntitlement(ctx, { talepId: t2.row.id, belge, actor: "bekci" }));
    kontrol("§6e BAŞKA talebin belgesi bu talebe yüklenemez → 409 (yük birebir değil)", !yabanci.ok && yabanci.kod === "409 DURUM_CAKISMASI", yabanci.ok ? "GECTI" : yabanci.kod);
    await prisma.hak.update({ where: { id: kP.hakId }, data: { aktif: false } });
    writeFileSync(path.join(tdizin, "k2.json"), JSON.stringify(await kuyrukSvc.exportRootQueue(prisma)));
    const k2cli = spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", "kuyruk-imzala", `--kok=${f.kok.kid}`, `--kok-dizin=${ortam.dizin}`, `--kuyruk=${path.join(tdizin, "k2.json")}`, `--cikti=${path.join(tdizin, "i2b.json")}`], { cwd: SATICI_KOKU, encoding: "utf8", input: `${TEST_KOK_PAROLASI}\n` });
    const i2 = k2cli.status === 0 ? (JSON.parse(readFileSync(path.join(tdizin, "i2b.json"), "utf8")) as { haklar: { talepId: string; belge: string }[] }) : { haklar: [] };
    const t2b = i2.haklar.find((h) => h.talepId === t2.row.id);
    const eskidi = t2b ? await dene(() => kuyrukSvc.importRootSignedEntitlement(ctx, { talepId: t2.row.id, belge: t2b.belge, actor: "bekci" })) : null;
    await prisma.hak.update({ where: { id: kP.hakId }, data: { aktif: true } });
    kontrol("§6f HAK taban sürümde/etkin değilse talep ESKIDI, sürüm yazılmaz", !!eskidi?.ok && eskidi.value.durum === "ESKIDI" && (await prisma.hakKokTalebi.findUniqueOrThrow({ where: { id: t2.row.id } })).durum === "ESKIDI", eskidi ? (eskidi.ok ? eskidi.value.durum : eskidi.kod) : `cli ${k2cli.status} ${k2cli.stderr.slice(0, 120)}`);
    const t3 = await runAsCli(() => hakSvc.issueEntitlementVersion(ctxKoksuz, { entitlementId: kP.hakId, changes: { perpetual: false }, password: passwordBuffer("parola-kullanilmaz-4"), reason: "iptal edilecek", actor: "bekci", allowQueue: true }));
    const iptal1 = await dene(() => prisma.$transaction(async (tx) => kuyrukSvc.cancelRootRequestTx(tx, { request: t3.row as never, reason: "vazgeçildi", actor: "bekci" })));
    const iptal2 = await dene(() => prisma.$transaction(async (tx) => kuyrukSvc.cancelRootRequestTx(tx, { request: t3.row as never, reason: "ikinci kez", actor: "bekci" })));
    kontrol("§6g iptal: BEKLIYOR → IPTAL (kapanış damgası + sebep); ikinci iptal 409", iptal1.ok && iptal1.value.durum === "IPTAL" && iptal1.value.kapanisSebebi === "vazgeçildi" && !iptal2.ok && iptal2.kod === "409 DURUM_CAKISMASI");

    console.log("\n§7 portal");
    portal = await portalSunuculariKur(ctx);
    portalKoksuz = await portalSunuculariKur(ctxKoksuz);
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    const op = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(yonetici.id, op.id);
    const cY = (await portalGiris(portal.portal, "/portal/api", yonetici)).cerez!;
    const cO = (await portalGiris(portal.portal, "/portal/api", op)).cerez!;
    const cYk = (await portalGiris(portalKoksuz.portal, "/portal/api", yonetici, { adimKaydir: 1 })).cerez!;
    const kW = await kurulumFiksturu(ctx);
    temizlenecek.push(kW.kurulumDbId);
    const planY = await portalIstek(portal.portal, `/portal/api/haklar/${kW.hakId}/imza-plani`, { cerez: cO });
    kontrol("§7a GET imza-plani: yeteneksiz + kök → KOK (kid ile)", planY.status === 200 && planY.veri.imzaci === "KOK" && planY.veri.kid === f.kok.kid, JSON.stringify(planY.veri));
    const surum = (taban: string, cerez: string, govde: Record<string, unknown>) => portalIstek(taban, `/portal/api/haklar/${kW.hakId}/surum`, { cerez, govde: { clientToken: randomUUID(), sebep: "portal bekçisi", ...govde } });
    const pUyusmaz = await surum(portal.portal, cO, { imzaci: "ARA", imzaParolasi: YANLIS });
    const sayac = (await prisma.portalKullanici.findUniqueOrThrow({ where: { id: op.id } })).imzaBasarisiz;
    kontrol("§7b plan uyuşmazlığı 409 DURUM_CAKISMASI; yanlış parola alt sürece gitmedi (imza sayacı 0)", pUyusmaz.status === 409 && pUyusmaz.kod === "DURUM_CAKISMASI" && sayac === 0, `${pUyusmaz.status} ${pUyusmaz.kod} · sayaç ${sayac}`);
    const eskiArayuz = await surum(portal.portal, cO, { kokParolasi: TEST_KOK_PAROLASI });
    kontrol("§7c eski arayüz gövdesi (yalnız kokParolasi) KOK planında 201", eskiArayuz.status === 201 && eskiArayuz.veri.imzalayanKid === f.kok.kid, `${eskiArayuz.status} ${eskiArayuz.kod ?? ""}`);
    const kuyrukKoklu = await surum(portal.portal, cO, { imzaci: "KUYRUK" });
    kontrol("§7d kök VDS'teyken KUYRUK isteği 409 (plan KOK)", kuyrukKoklu.status === 409 && kuyrukKoklu.kod === "DURUM_CAKISMASI", `${kuyrukKoklu.status}`);
    const parolali = await surum(portalKoksuz.portal, cYk, { imzaci: "KUYRUK", imzaParolasi: "kuyruga-parola-gitmez" });
    const kuyruk202 = await surum(portalKoksuz.portal, cYk, { imzaci: "KUYRUK", moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"] });
    kontrol("§7e köksüz: KUYRUK parola taşıyamaz (400); parolasız 202 + talep", parolali.status === 400 && kuyruk202.status === 202 && kuyruk202.veri.kuyruk === true && typeof kuyruk202.veri.talepId === "string", `${parolali.status} / ${kuyruk202.status} ${kuyruk202.kod ?? ""}`);
    const liste = await portalIstek(portal.portal, "/portal/api/kok-kuyrugu?durum=BEKLIYOR", { cerez: cO });
    const items = (liste.veri.items ?? []) as { id: string; lisansNo: string }[];
    kontrol("§7f GET kok-kuyrugu: bekleyen talep lisans numarasıyla listede", liste.status === 200 && items.some((i) => i.id === kuyruk202.veri.talepId && i.lisansNo === kW.lisansNo));
    const pIptal = await portalIstek(portal.portal, `/portal/api/kok-kuyrugu/${String(kuyruk202.veri.talepId)}/iptal`, { cerez: cO, govde: { clientToken: randomUUID(), sebep: "portal iptali" } });
    kontrol("§7g POST kok-kuyrugu/:id/iptal → IPTAL", pIptal.status === 200 && pIptal.veri.durum === "IPTAL", `${pIptal.status} ${pIptal.kod ?? ""}`);
    const opUzun = await surum(portal.portal, cO, { imzaci: "KOK", imzaParolasi: TEST_KOK_PAROLASI, cevrimdisiUfukGun: null, onay: kW.lisansNo });
    const yUzunOnaysiz = await surum(portal.portal, cY, { imzaci: "KOK", imzaParolasi: TEST_KOK_PAROLASI, cevrimdisiUfukGun: 900 });
    const yUzun = await surum(portal.portal, cY, { imzaci: "KOK", imzaParolasi: TEST_KOK_PAROLASI, cevrimdisiUfukGun: 900, onay: kW.lisansNo });
    kontrol("§7h uzun ufuk rotada: operatör 403 · yönetici onaysız 400 · yönetici + lisans no 201 (uzunUfuk)",
      opUzun.status === 403 && yUzunOnaysiz.status === 400 && yUzunOnaysiz.kod === "IKINCI_ONAY_GEREKLI" && yUzun.status === 201 && yUzun.veri.uzunUfuk === true,
      `${opUzun.status} / ${yUzunOnaysiz.status} ${yUzunOnaysiz.kod} / ${yUzun.status} ${yUzun.kod ?? ""}`);
    const toplu = await portalIstek(portal.portal, "/portal/api/haklar/toplu-yeniden-bas", { cerez: cY, govde: { clientToken: randomUUID(), imzaParolasi: ARA_PAROLASI, sebep: "toplu", hakIdleri: [kW.hakId] } });
    const sonuclar = (toplu.veri.sonuclar ?? []) as { durum: string; neden: string }[];
    kontrol("§7i toplu yeniden basım rotası: kurulum kaydı yetenek taşımadıkça ATLAR (kolon entegrasyonda bağlanır)", toplu.status === 201 && sonuclar.length === 1 && sonuclar[0]!.durum === "ATLANDI" && /hak-ara/.test(sonuclar[0]!.neden), `${toplu.status} ${JSON.stringify(sonuclar)}`);

    console.log("\n§8 toplu yeniden basım servisi");
    const kT1 = await kurulumFiksturu(ctx);
    const kT2 = await kurulumFiksturu(ctx);
    temizlenecek.push(kT1.kurulumDbId, kT2.kurulumDbId);
    const yetenek = (inst: { id: string }) => (inst.id === kT1.kurulumDbId ? ["hak-ara"] : []);
    const yanlisToplu = await dene(() => runAsCli(() => hakSvc.prepareIntermediateReissue(ctx, { entitlementIds: [kT1.hakId, kT2.hakId], password: passwordBuffer(YANLIS), reason: "toplu", actor: "bekci", capabilitiesOf: yetenek })));
    kontrol("§8a yanlış parola → 400 IMZA_PAROLASI_HATALI, sürüm yok", !yanlisToplu.ok && yanlisToplu.kod === "400 IMZA_PAROLASI_HATALI" && (await prisma.hak.findUniqueOrThrow({ where: { id: kT1.hakId } })).guncelSurum === 1);
    const asil = passwordBuffer(ARA_PAROLASI);
    const hazir = await runAsCli(() => hakSvc.prepareIntermediateReissue(ctx, { entitlementIds: [kT1.hakId, kT2.hakId], password: asil, reason: "toplu", actor: "bekci", capabilitiesOf: yetenek }));
    const yazilan = await prisma.$transaction((tx) => hakSvc.recordIntermediateReissueTx(tx, hazir.prepared));
    kontrol("§8b tek parola: yetenekli → ARA imzalı sürüm 2; yeteneksiz ATLANDI; asıl parola sıfırlandı",
      yazilan.length === 1 && yazilan[0]!.hakId === kT1.hakId && yazilan[0]!.imzalayanKid === f.ara.kid && hazir.results.find((x) => x.hakId === kT2.hakId)?.durum === "ATLANDI" && asil.every((b) => b === 0));

    console.log("\n§9 anahtar süresi bildirimi (K4)");
    const bitis = Date.parse(ctx.keys.leaseKeyFor("URETIM", Date.now())!.document.bitis);
    const u30 = keyExpiryWarnings(ctx.keys, bitis - 29 * DAY_MS);
    const u7 = keyExpiryWarnings(ctx.keys, bitis - 6 * DAY_MS);
    kontrol("§9a 29 gün kala ALT · ARA · İNDİRME eşik 30; 6 gün kala eşik 7; 60 gün kala ve süresi geçmiş uyarı YOK",
      ["ALT", "ARA", "INDIRME"].every((u) => u30.some((w) => w.usage === u && w.threshold === 30)) && u7.every((w) => w.threshold === 7) && keyExpiryWarnings(ctx.keys, bitis - 60 * DAY_MS).length === 0 && keyExpiryWarnings(ctx.keys, bitis + DAY_MS).length === 0,
      u30.map((w) => `${w.usage}:${w.threshold}`).join(" "));
    for (const w of [...u30, ...u7]) bildirimAnahtarlari.push(`ANAHTAR_SURESI_BITIYOR:${w.kid}:${w.threshold}`);
    const ilk = await scanKeyExpiry(ctx.keys, bitis - 29 * DAY_MS);
    const ikinciTur = await scanKeyExpiry(ctx.keys, bitis - 28 * DAY_MS);
    const yedi = await scanKeyExpiry(ctx.keys, bitis - 6 * DAY_MS);
    kontrol("§9b tarama: eşik başına TEK satır (3 anahtar × 2 kanal = 6), aynı eşik ikinci tur 0, yeni eşik (7) yeni 6", ilk === 6 && ikinciTur === 0 && yedi === 6, `${ilk}/${ikinciTur}/${yedi}`);
  } finally {
    await sunucu2?.durdur();
    await portal?.kapat();
    await portalKoksuz?.kapat();
    await prisma.bildirim.deleteMany({ where: { tekillikAnahtari: { in: bildirimAnahtarlari } } });
    await temizleKurulumlar(temizlenecek, [...ortam.kidler, ...ekKidler]);
    await temizlePortal({ kullanicilar });
    for (const d of geciciDizinler) rmSync(d, { recursive: true, force: true });
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
