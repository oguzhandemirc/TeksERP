// =============================================================================
// DONANIM DEĞİŞİKLİĞİ BİLDİRİMİ + ZAYIF TANIMA LİSTESİ (lisans v2 K8 · L2-11) — donanım değişikliği lisansı iptal ETMEZ,
// öğrenilir. Satıcı uygulamaları süreç içinde (genel + tailnet), kendi _test DB'si.
//   §1 saf politika: kümenin kuralı (zayıf küme → `zayif`) · öğrenme (güçlülerden ≥ 2; f1 + f5 tutup güçlüler tutmuyorsa
//      HAYIR; zayıf kümede zayıf kural) · portalın etken etken karşılaştırması
//   §2 `POST /v1/donanim` güçlüler tutuyor: kendiliğinden ONAYLANDI + yeni kümeyi taşıyan kira (zincir ucu ilerler, kural
//      `standart`), kabul edilen küme kayar, kurulum kaydı; sonraki yoklama uyarısız
//   §3 güçlüler tutmuyor: BEKLIYOR (lisans yok), bildirim talep başına bir kez, ikinci bildirim AYNI talebi tazeler;
//      kabul edilen küme ve kira defteri değişmez
//   §4 portal: liste karşılaştırma taşır (tuzlu özet değil) · sebepsiz 400 · onay → kabul edilen küme = bildirilen,
//      kurulum kaydı, ikinci karar 409 · sonraki yoklama yeni kümeyle uyarısız · ret kabul edilen kümeye dokunmaz
//   §5 zarf (çevrimdışı/QR) yolu: aynı gövde `/v1/cevrimdisi`de HardwareReportResponse döner; `/v1/donanim` yoluna
//      imzalı zarf 401 ISTEK_YOL
//   §6 kapılar: başka amaçla imzalı istek 401 · KATI gövde 400 · nonce tekrarı 409 · iptal kurulum 403
//   §7 v1'den gelen zayıf kurulum `parmak-izi-v2` bildirince DURMAZ (kira `zayif` kuralıyla) ve onay listesine düşer
// ⭐ KALICI SONDA ✓K (her koşumda): §1b f1 + f5 eşleşip güçlüler tutmuyorsa öğrenme GERÇEKTEN reddedilir · §2a güçlüler
//    tutunca GERÇEKTEN kira döner (kapı her bildirimi kuyruğa atan kör kapı değil).
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_donanim_bildirimi.ts   (kendi _test DB'si)
// =============================================================================
import { createHash } from "node:crypto";
import {
  ENDPOINTS,
  HardwareReportResponseSchema,
  LicenseResponseSchema,
  b64uEncode,
  checkLeaseBinding,
  verifyEntitlement,
  verifyLease,
  wrapEnvelope,
  type Fingerprint,
} from "../src/lisans-protokol";
import { kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { canLearnFingerprint, fingerprintComparison, fingerprintRuleOf } from "../src/services/fingerprint-policy";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliBaslik,
  imzaliPost,
  kapat,
  kiraIdOf,
  kiraYuku,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
  type KurulumFiksturu,
} from "./lib/test-ortam";

const YETENEKLER = ["odenmis-tarih", "iptal", "parmak-izi-v2"];

/** Kira yanıttaki HAK'a bağlı mı (fabrikanın doğrulayıcısıyla: imza + sürüm + bayt özeti + sınıf). */
function bagliMi(kira: string, hak: string, kokler: Parameters<typeof verifyLease>[1]): boolean {
  const k = verifyLease(kira, kokler);
  const h = verifyEntitlement(hak, kokler, { nowMs: Date.now() });
  return k.ok && h.ok && checkLeaseBinding(k.value, h.value).ok;
}

/** Sahte tuzlu özet (43 karakter base64url) — satıcı yalnız özetleri karşılaştırır. */
const ozet = (etiket: string): string => b64uEncode(createHash("sha256").update(etiket).digest());

function saf(f: Fingerprint): void {
  console.log("\n§1 saf politika (fingerprint-policy)");
  const zayifKume: Fingerprint = { f1: f.f1, f2: null, f3: null, f4: null, f5: f.f5 };
  kontrol("§1a kural: beş etkenli küme → standart · f1 + f5 kümesi → zayif · DR'de f5 sayılmaz (f1 + f2 + f5 DR'de zayıf, URETIM'de zayıf)",
    fingerprintRuleOf(f, "URETIM") === "standart" && fingerprintRuleOf(zayifKume, "URETIM") === "zayif" && fingerprintRuleOf({ ...zayifKume, f2: f.f2, f3: f.f3 }, "DR") === "standart" &&
      fingerprintRuleOf({ ...zayifKume, f2: f.f2 }, "DR") === "zayif");
  const yalnizF1F5: Fingerprint = { f1: f.f1, f2: ozet("x2"), f3: ozet("x3"), f4: ozet("x4"), f5: f.f5 };
  const ikiGuclu: Fingerprint = { ...f, f1: ozet("y1"), f4: ozet("y4"), f5: ozet("y5") };
  kontrol("§1b ✓K öğrenme: f1 + f5 tutup güçlüler tutmuyor → HAYIR (VM/disk kopyası) · güçlülerden ikisi tutuyor (f1 · f4 · f5 değişti) → EVET",
    !canLearnFingerprint(f, yalnizF1F5, "URETIM") && canLearnFingerprint(f, ikiGuclu, "URETIM"));
  kontrol("§1c kayıp etken öğrenmeyi tek başına düşürmez (f4 kayıp, f2 + f3 tutar) · zayıf kümede zayıf kural (f1 + f5 ikisi de tutmalı)",
    canLearnFingerprint(f, { ...f, f4: null }, "URETIM") && canLearnFingerprint(zayifKume, zayifKume, "URETIM") && !canLearnFingerprint(zayifKume, { ...zayifKume, f5: ozet("z5") }, "URETIM"));
  const k = fingerprintComparison(f, { ...f, f2: ozet("k2"), f4: null }, "URETIM");
  kontrol("§1d karşılaştırma: AYNI · FARKLI · KAYIP · tutan güçlü sayısı · öğrenilebilir",
    k.etkenler.f1 === "AYNI" && k.etkenler.f2 === "FARKLI" && k.etkenler.f4 === "KAYIP" && k.tutanGuclu === 1 && !k.ogrenilebilir && k.kural === "standart",
    JSON.stringify(k.etkenler));
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  saf(f.parmakIzi);
  const { prisma } = await import("../src/lib/prisma");
  const sunucular = await portalSunuculariKur(ctx);
  const temizlenecek: string[] = [];
  const kullanicilar: string[] = [];
  try {
    const genel = sunucular.genel;
    const yeni = async (): Promise<KurulumFiksturu> => {
      const k = await kurulumFiksturu(ctx);
      temizlenecek.push(k.kurulumDbId);
      return k;
    };
    const etkinlestir = (k: KurulumFiksturu, a: TestAnahtari, parmakIzi: Fingerprint = f.parmakIzi) =>
      imzaliPost(genel, ENDPOINTS.ACTIVATE, {
        kurulumId: k.kurulumId,
        amac: "etkinlestir",
        anahtar: a,
        govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: a, parmakIzi }), yetenekler: YETENEKLER },
      });
    const bildir = (k: KurulumFiksturu, a: TestAnahtari, parmakIzi: Fingerprint, kayip: string[] = [], gerekce: string | null = "anakart değişti") =>
      imzaliPost(genel, ENDPOINTS.HARDWARE, { kurulumId: k.kurulumId, amac: "donanim", anahtar: a, govde: { v: 1, parmakIzi, kayip, gerekce }, imzaYolu: ENDPOINTS.HARDWARE });
    const yokla = (k: KurulumFiksturu, a: TestAnahtari, sonKiraId: string, parmakIzi: Fingerprint, yetenekler: string[] = YETENEKLER) =>
      imzaliPost(genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar: a, govde: yoklamaGovdesi({ sonKiraId, hak: null, parmakIzi, v2: { yetenekler } }) });
    const kabul = async (k: KurulumFiksturu) => (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).kabulEdilenParmakIzi as Fingerprint;
    const uyusmaz = (k: KurulumFiksturu) => prisma.kopyaUyarisi.count({ where: { kurulumId: k.kurulumDbId, tur: "PARMAK_IZI_UYUSMAZ" } });

    console.log("\n§2 güçlüler tutuyor → kendiliğinden öğrenme + kira");
    const k = await yeni();
    const a = kurulumAnahtariUret();
    const e = await etkinlestir(k, a);
    const tip0 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).sonKiraId;
    kontrol("§2 hazırlık: etkinleştirme 200, kira kuralı `standart` (alıcı parmak-izi-v2 bildirdi)", e.status === 200 && kiraYuku(e.json).parmakIziKurali === "standart", `${e.status} ${e.kod ?? ""}`);
    const yeniF4: Fingerprint = { ...f.parmakIzi, f4: ozet("yeni-anakart") };
    const b1 = await bildir(k, a, yeniF4);
    const y1 = HardwareReportResponseSchema.safeParse(b1.json);
    const lisans1 = y1.success ? y1.data.lisans : null;
    const kira1 = lisans1 ? verifyLease(lisans1.kira, f.kokler) : null;
    kontrol("§2a ✓K 200 ONAYLANDI + lisans; kira yeni kümeyi taşır (f4 yeni), kural standart, kiraya bağlı HAK ile bağ geçer",
      b1.status === 200 && y1.success && y1.data.durum === "ONAYLANDI" && !!kira1?.ok && kira1.value.document.parmakIzi.f4 === yeniF4.f4 && kira1.value.document.parmakIziKurali === "standart" &&
        !!lisans1?.hak && bagliMi(lisans1.kira, lisans1.hak, f.kokler),
      `${b1.status} ${b1.kod ?? ""} ${y1.success ? y1.data.durum : "biçimsiz"}`);
    const inst2 = await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } });
    const talep2 = y1.success ? await prisma.donanimTalebi.findUniqueOrThrow({ where: { id: y1.data.talepId } }) : null;
    kontrol("§2b kabul edilen küme kaydı (f4 yeni), zincir ucu yeni kiraya ilerledi (öncekinin çocuğu), talep otomatik + sistem kararı, kurulum kaydı PARMAK_IZI_OGRENILDI",
      (inst2.kabulEdilenParmakIzi as Fingerprint).f4 === yeniF4.f4 && inst2.sonKiraId === (kira1?.ok ? kira1.value.document.kiraId : "") &&
        (await prisma.kira.findUniqueOrThrow({ where: { id: inst2.sonKiraId! } })).oncekiKiraId === tip0 && talep2?.otomatik === true && talep2.kararVeren === "sistem:guclu-etken" &&
        (await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "PARMAK_IZI_OGRENILDI" } })) === 1);
    const p2 = await yokla(k, a, inst2.sonKiraId!, yeniF4);
    kontrol("§2c sonraki yoklama (yeni kirayla, yeni donanım) 200, parmak izi uyarısı YOK", p2.status === 200 && (await uyusmaz(k)) === 0, `${p2.status} ${p2.kod ?? ""}`);

    console.log("\n§3 güçlüler tutmuyor → onay kuyruğu");
    const ikiGucluDegisti: Fingerprint = { ...yeniF4, f2: ozet("yeni-smbios"), f3: ozet("yeni-disk") };
    const kiraSayisi = () => prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
    const once = await kiraSayisi();
    const b2 = await bildir(k, a, ikiGucluDegisti, [], "sunucu değişti");
    const y2 = HardwareReportResponseSchema.safeParse(b2.json);
    const bildirimler = () => prisma.bildirim.count({ where: { kurulumId: k.kurulumDbId, olay: "DONANIM_ONAYI_BEKLIYOR" } });
    kontrol("§3a 200 BEKLIYOR, lisans YOK; kabul edilen küme ve kira defteri değişmedi; bildirim e-posta + Telegram",
      b2.status === 200 && y2.success && y2.data.durum === "BEKLIYOR" && y2.data.lisans === null && (await kabul(k)).f2 === f.parmakIzi.f2 && (await kiraSayisi()) === once && (await bildirimler()) === 2,
      `${b2.status} ${b2.kod ?? ""}`);
    const ucuncu: Fingerprint = { ...ikiGucluDegisti, f4: ozet("ucuncu-anakart") };
    const b3 = await bildir(k, a, ucuncu, [], null);
    const y3 = HardwareReportResponseSchema.safeParse(b3.json);
    const talep3 = y2.success ? await prisma.donanimTalebi.findUniqueOrThrow({ where: { id: y2.data.talepId } }) : null;
    kontrol("§3b ikinci bildirim AYNI talep (bildirim sayısı 2, ölçüm tazelendi, gerekçe korundu), yeni bildirim satırı yok",
      y3.success && y2.success && y3.data.talepId === y2.data.talepId && talep3?.bildirimSayisi === 2 && (talep3.parmakIzi as Fingerprint).f4 === ucuncu.f4 && talep3.gerekce === "sunucu değişti" && (await bildirimler()) === 2);

    console.log("\n§4 portal kararı");
    const op = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    kullanicilar.push(op.id);
    const giris = await portalGiris(sunucular.tailnet, "/portal/api", op);
    const cerez = giris.cerez ?? "";
    const liste = await portalIstek(sunucular.tailnet, "/portal/api/donanim-talepleri?durum=BEKLIYOR", { cerez });
    const satirlar = ((liste.veri as { items?: Record<string, unknown>[] }).items ?? []).filter((r) => r.kurulumId === k.kurulumDbId);
    const satir = satirlar[0] as { id?: string; karsilastirma?: { etkenler?: Record<string, string>; tutanGuclu?: number }; parmakIzi?: unknown } | undefined;
    kontrol("§4a liste: talep etken etken karşılaştırmayla (f2 · f3 · f4 FARKLI, tutan güçlü 0), tuzlu özet YOK",
      liste.status === 200 && satirlar.length === 1 && satir?.karsilastirma?.etkenler?.f2 === "FARKLI" && satir.karsilastirma.etkenler.f4 === "FARKLI" && satir.karsilastirma.tutanGuclu === 0 &&
        satir.parmakIzi === undefined && !JSON.stringify(liste.json).includes(ucuncu.f4!),
      `${liste.status} ${JSON.stringify(satir?.karsilastirma?.etkenler ?? {})}`);
    const talepId = y2.success ? y2.data.talepId : "";
    const sebepsiz = await portalIstek(sunucular.tailnet, `/portal/api/donanim-talepleri/${talepId}/onayla`, { cerez, govde: { clientToken: crypto.randomUUID(), sebep: " " } });
    const onay = await portalIstek(sunucular.tailnet, `/portal/api/donanim-talepleri/${talepId}/onayla`, { cerez, govde: { clientToken: crypto.randomUUID(), sebep: "müşteri sunucuyu yeniledi (fatura görüldü)" } });
    const ikinci = await portalIstek(sunucular.tailnet, `/portal/api/donanim-talepleri/${talepId}/reddet`, { cerez, govde: { clientToken: crypto.randomUUID(), sebep: "geç kalan karar" } });
    kontrol("§4b sebepsiz 400 · onay 200 · ikinci karar 409 DURUM_CAKISMASI",
      sebepsiz.status === 400 && onay.status === 200 && (onay.veri as { durum?: string }).durum === "ONAYLANDI" && ikinci.status === 409 && ikinci.kod === "DURUM_CAKISMASI",
      `${sebepsiz.status}/${onay.status} ${onay.kod ?? ""}/${ikinci.status} ${ikinci.kod ?? ""}`);
    kontrol("§4c kabul edilen küme = BİLDİRİLEN son küme; kurulum kaydı PARMAK_IZI_ONAYLANDI (sebepli)",
      JSON.stringify(await kabul(k)) === JSON.stringify(ucuncu) && (await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "PARMAK_IZI_ONAYLANDI" } })) === 1);
    const p4 = await yokla(k, a, (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).sonKiraId!, ucuncu);
    kontrol("§4d onaydan sonra yeni donanımın yoklaması 200, kira yeni kümeyi taşır, parmak izi uyarısı YOK",
      p4.status === 200 && (kiraYuku(p4.json).parmakIzi as Fingerprint).f2 === ucuncu.f2 && (await uyusmaz(k)) === 0, `${p4.status} ${p4.kod ?? ""}`);
    const b5 = await bildir(k, a, { ...ucuncu, f2: ozet("baska"), f3: ozet("baska3") });
    const y5 = HardwareReportResponseSchema.safeParse(b5.json);
    const ret = await portalIstek(sunucular.tailnet, `/portal/api/donanim-talepleri/${y5.success ? y5.data.talepId : ""}/reddet`, { cerez, govde: { clientToken: crypto.randomUUID(), sebep: "müşteri bilgisi yok" } });
    kontrol("§4e ret 200 REDDEDILDI, kabul edilen küme DEĞİŞMEDİ, kurulum kaydı PARMAK_IZI_REDDEDILDI",
      y5.success && y5.data.durum === "BEKLIYOR" && ret.status === 200 && JSON.stringify(await kabul(k)) === JSON.stringify(ucuncu) &&
        (await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "PARMAK_IZI_REDDEDILDI" } })) === 1,
      `${ret.status} ${ret.kod ?? ""}`);

    console.log("\n§5 zarf (çevrimdışı / QR) yolu");
    const zarfGovde = JSON.stringify({ v: 1, parmakIzi: ucuncu, kayip: [], gerekce: null });
    const zarfla = (yol: string) =>
      gonder(`${genel}${ENDPOINTS.OFFLINE}`, { govde: JSON.stringify({ v: 1, zarf: wrapEnvelope(imzaliBaslik({ kurulumId: k.kurulumId, amac: "donanim", govde: zarfGovde, anahtar: a, yol }), zarfGovde) }) });
    const z1 = await zarfla(ENDPOINTS.OFFLINE);
    const zy = HardwareReportResponseSchema.safeParse(z1.json);
    kontrol("§5a ⭐ zarf `/v1/cevrimdisi`de HardwareReportResponse: güçlüler tutuyor → ONAYLANDI + kira (çevrimdışı yanıt QR'a girer)",
      z1.status === 200 && zy.success && zy.data.durum === "ONAYLANDI" && !!zy.data.lisans && LicenseResponseSchema.safeParse(zy.data.lisans).success, `${z1.status} ${z1.kod ?? ""}`);
    const z2 = await zarfla(ENDPOINTS.HARDWARE);
    kontrol("§5b `/v1/donanim` yoluna imzalı istek zarfla gelirse 401 ISTEK_YOL", z2.status === 401 && z2.kod === "ISTEK_YOL", `${z2.status} ${z2.kod ?? ""}`);

    console.log("\n§6 kapılar");
    const govde = JSON.stringify({ v: 1, parmakIzi: ucuncu, kayip: [], gerekce: null });
    const yanlisAmac = await gonder(`${genel}${ENDPOINTS.HARDWARE}`, { baslik: imzaliBaslik({ kurulumId: k.kurulumId, amac: "yokla", govde, anahtar: a, yol: ENDPOINTS.HARDWARE }), govde });
    const katiGovde = await imzaliPost(genel, ENDPOINTS.HARDWARE, { kurulumId: k.kurulumId, amac: "donanim", anahtar: a, govde: { v: 1, parmakIzi: ucuncu, kayip: [], gerekce: null, fazla: 1 }, imzaYolu: ENDPOINTS.HARDWARE });
    const baslik = imzaliBaslik({ kurulumId: k.kurulumId, amac: "donanim", govde, anahtar: a, yol: ENDPOINTS.HARDWARE });
    const ilk = await gonder(`${genel}${ENDPOINTS.HARDWARE}`, { baslik, govde });
    const tekrar = await gonder(`${genel}${ENDPOINTS.HARDWARE}`, { baslik, govde });
    kontrol("§6a başka amaçla imzalı 401 ISTEK_AMAC · KATI gövde 400 · nonce tekrarı 409 ISTEK_TEKRAR",
      yanlisAmac.status === 401 && yanlisAmac.kod === "ISTEK_AMAC" && katiGovde.status === 400 && ilk.status === 200 && tekrar.status === 409 && tekrar.kod === "ISTEK_TEKRAR",
      `${yanlisAmac.status} ${yanlisAmac.kod ?? ""} / ${katiGovde.status} / ${ilk.status} / ${tekrar.status} ${tekrar.kod ?? ""}`);
    const kI = await yeni();
    const aI = kurulumAnahtariUret();
    await etkinlestir(kI, aI);
    await prisma.kurulum.update({ where: { id: kI.kurulumDbId }, data: { durum: "IPTAL" } });
    const iptal = await bildir(kI, aI, f.parmakIzi);
    kontrol("§6b iptal edilmiş kurulumun bildirimi 403 KURULUM_IPTAL (talep açılmadı)",
      iptal.status === 403 && iptal.kod === "KURULUM_IPTAL" && (await prisma.donanimTalebi.count({ where: { kurulumId: kI.kurulumDbId } })) === 0, `${iptal.status} ${iptal.kod ?? ""}`);

    console.log("\n§7 v1'den gelen zayıf kurulum");
    const kZ = await yeni();
    const aZ = kurulumAnahtariUret();
    const eZ = await imzaliPost(genel, ENDPOINTS.ACTIVATE, { kurulumId: kZ.kurulumId, amac: "etkinlestir", anahtar: aZ, govde: etkinlestirmeGovdesi({ kod: kZ.kod, kurulumId: kZ.kurulumId, anahtar: aZ, parmakIzi: f.parmakIzi }) });
    // v1 döneminde zayıf kümeyle etkinleşmiş kurulum (bugün kapı 409 verirdi): kabul edilen küme doğrudan zayıf yazılır.
    const zayifKume: Fingerprint = { f1: f.parmakIzi.f1, f2: null, f3: null, f4: null, f5: f.parmakIzi.f5 };
    await prisma.kurulum.update({ where: { id: kZ.kurulumDbId }, data: { kabulEdilenParmakIzi: zayifKume } });
    const pZ = await yokla(kZ, aZ, kiraIdOf(eZ.json), zayifKume);
    const tZ = await prisma.donanimTalebi.findMany({ where: { kurulumId: kZ.kurulumDbId, tur: "ZAYIF_TANIMA" } });
    kontrol("§7a ⭐ yoklama 200 (durmaz), kira kuralı `zayif`, kurulum ZAYIF_TANIMA onay listesinde (BEKLIYOR, tek)",
      pZ.status === 200 && kiraYuku(pZ.json).parmakIziKurali === "zayif" && tZ.length === 1 && tZ[0]!.durum === "BEKLIYOR", `${pZ.status} ${pZ.kod ?? ""} talep=${tZ.length}`);
    const pZ2 = await yokla(kZ, aZ, kiraIdOf(pZ.json), zayifKume);
    const pEski = await imzaliPost(genel, ENDPOINTS.POLL, { kurulumId: kZ.kurulumId, amac: "yokla", anahtar: aZ, govde: yoklamaGovdesi({ sonKiraId: kiraIdOf(pZ2.json), hak: null, parmakIzi: zayifKume }) });
    kontrol("§7b ikinci yoklama yeni talep AÇMAZ; yetenek bildirmeyen (eski) fabrikanın kirasında kural alanı YOK",
      pZ2.status === 200 && (await prisma.donanimTalebi.count({ where: { kurulumId: kZ.kurulumDbId } })) === 1 && pEski.status === 200 && kiraYuku(pEski.json).parmakIziKurali === undefined,
      `${pZ2.status} / ${pEski.status}`);
  } finally {
    await sunucular.kapat();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    await temizlePortal({ kullanicilar });
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
