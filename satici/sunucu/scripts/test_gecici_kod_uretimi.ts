// =============================================================================
// GEÇİCİ AÇILIŞ KODU ÜRETİMİ (satıcı) — yazarak etkinleştirmenin satıcı yarısı. Kendi _test DB'si, süreç içi portal.
//   §1 yetki: operatör üretemez (403) · bayi satıcı ucunu bulamaz (404) · bayi yalnız TALEP açar · başka bayinin
//      kurulumu "yok" · operatör talebi üretemez/reddedemez (403)
//   §2 gün sınırı 7–90 (yönetici ve bayi talebi 400; DB CHECK de)
//   §3 üretim: kod 23×5 grup, protokolle çözülür ve kök imzası çapaya karşı DOĞRULANIR; başka istek koduyla
//      doğrulanmaz; bitiş = gün sonu; DB'de düz kod yok (özet + son 4); tekrar yanıtı kodu göstermez; sağlamasız istek
//      kodu 400 (neden); bağlı anahtarın olmayan istek kodu 409; koda sığan kök yoksa 409
//   §4 denetim ve saklanan yanıt kodu ya da son 4'ünü taşımaz
//   §5 bayi talebi → yönetici üretir → bayi kodu kendi talebinde okur; ikinci üretim/ret 409; ret; mükerrer bekleyen 409
//   §6 tüketim bildirimi (imzalı): ilkinde yeni=1, tekrarında yeni=0 ve damga değişmez; başka anahtar işaretleyemez;
//      aynı istek ikinci kez 409 ISTEK_TEKRAR
// ⭐ KALICI SONDA ✓K: §3c kod GERÇEKTEN kökle imzalı ve doğrulanıyor · §6a tüketim GERÇEKTEN işaretliyor (kör geçiş değil).
// NEGATİF SONDA (2026-10-12, dosya DIŞI, cp + shasum ile geri alındı): `kurulum:gecici-kod` VENDOR yapıldı → §1a ❌;
//   `assertTempDays` gövdesi boşaltıldı → §2a ❌; tüketimde `anahtarOzeti` koşulu kaldırıldı → §6c ❌.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_gecici_kod_uretimi.ts
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  LICENSE_CLASSES,
  TYP_GECICI,
  buildTempRequestCode,
  dayOfMs,
  decodeTempOpeningCode,
  formatTempRequestCode,
  normalizeTempText,
  prepareTrustAnchor,
  tempCodeDigest,
  tempCodeEndMs,
  verifyJws,
  TEMP_CODE_PREFIX,
} from "../src/lisans-protokol";
import { anahtarUret, kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { runAsCli } from "../src/lib/request-scope";
import type { VendorContext } from "../src/services/context";
import {
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
} from "./lib/test-ortam";

process.env.TEKSERP_PAROLA_KASASI = "kapali";

const GECICI_KOK_KID = "kok-2026-9";
const KOD_DESENI = /^TG(-[0-9A-Z]{5}){23}$/;

const istekKoduUret = (kid: string): string => formatTempRequestCode(buildTempRequestCode(kid, randomBytes(5)));

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  // Fikstür kökleri (`kok-fikstur-…`) koda sığmaz: koda sığan bir kök çapaya ve anahtar dizinine eklenir.
  const kok = anahtarUret(GECICI_KOK_KID);
  writeKeyFileExclusive(
    path.join(ortam.dizin, `${GECICI_KOK_KID}.kok.json`),
    await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid: GECICI_KOK_KID, siniflar: [...LICENSE_CLASSES] }, kok.privateKey, passwordBuffer(TEST_KOK_PAROLASI)),
  );
  const capa = JSON.parse(readFileSync(ortam.capaDosyasi, "utf8")) as unknown[];
  writeFileSync(ortam.capaDosyasi, JSON.stringify([...capa, { kid: GECICI_KOK_KID, x: kok.x, classes: [...LICENSE_CLASSES] }]));
  const ctx: VendorContext = { ...ortam.ctx, keys: KeyStore.load(ortam.ctx.config, Date.now()) };
  const { prisma } = await import("../src/lib/prisma");
  const svc = await import("../src/services/temp-code.service");
  const sunucular = await portalSunuculariKur(ctx);
  const kurulumlar: string[] = [];
  const kullanicilar: string[] = [];
  const bayiler: string[] = [];
  const nonceKapsamlari: string[] = [];
  try {
    const bayiA = await prisma.bayi.create({ data: { ad: `Bekçi Bayi A ${randomUUID().slice(0, 6)}` } });
    const bayiB = await prisma.bayi.create({ data: { ad: `Bekçi Bayi B ${randomUUID().slice(0, 6)}` } });
    bayiler.push(bayiA.id, bayiB.id);
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    const operator = await portalKullaniciAc(ctx, "SATICI_OPERATOR");
    const bayiKul = await portalKullaniciAc(ctx, "BAYI", bayiA.id);
    const bayiKulB = await portalKullaniciAc(ctx, "BAYI", bayiB.id);
    kullanicilar.push(yonetici.id, operator.id, bayiKul.id, bayiKulB.id);
    const yCerez = (await portalGiris(sunucular.portal, "/portal/api", yonetici)).cerez!;
    const oCerez = (await portalGiris(sunucular.portal, "/portal/api", operator)).cerez!;
    const bCerez = (await portalGiris(sunucular.genel, "/bayi/api", bayiKul)).cerez!;
    const bCerezB = (await portalGiris(sunucular.genel, "/bayi/api", bayiKulB)).cerez!;
    const satici = (yol: string, govde?: unknown, cerez = yCerez) => portalIstek(sunucular.portal, `/portal/api${yol}`, { govde, cerez });
    const bayi = (yol: string, govde?: unknown, cerez = bCerez) => portalIstek(sunucular.genel, `/bayi/api${yol}`, { govde, cerez });

    const k = await kurulumFiksturu(ctx);
    kurulumlar.push(k.kurulumDbId);
    await prisma.musteri.update({ where: { id: k.musteriId }, data: { bayiId: bayiA.id } });
    const fabrika = kurulumAnahtariUret();
    nonceKapsamlari.push(`kid:${fabrika.kid}`);
    const istek = istekKoduUret(fabrika.kid);
    const uret = (govde: Record<string, unknown>, cerez = yCerez, id = k.kurulumDbId) =>
      satici(`/kurulumlar/${id}/gecici-kod`, { clientToken: randomUUID(), istekKodu: istek, gun: 30, imzaParolasi: TEST_KOK_PAROLASI, sebep: "internetsiz kurulum", ...govde }, cerez);

    console.log("\n§1 yetki");
    const op = await uret({}, oCerez);
    kontrol("§1a operatör geçici kod üretemez → 403", op.status === 403, `${op.status} ${op.kod}`);
    const bayiSatici = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod`, { clientToken: randomUUID(), istekKodu: istek, imzaParolasi: "x", sebep: "x" });
    kontrol("§1b bayi yolunda üretim ucu yok → 404", bayiSatici.status === 404, `${bayiSatici.status}`);
    const yabanci = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talep`, { clientToken: randomUUID(), istekKodu: istek, gun: 30, sebep: "x" }, bCerezB);
    kontrol("§1c başka bayinin kurulumuna talep → 404", yabanci.status === 404, `${yabanci.status} ${yabanci.kod}`);

    console.log("\n§2 gün sınırı");
    const az = await uret({ gun: 6 });
    const cok = await uret({ gun: 91 });
    const bayiCok = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talep`, { clientToken: randomUUID(), istekKodu: istek, gun: 91, sebep: "x" });
    kontrol("§2a 6 gün ve 91 gün → 400 (yönetici + bayi talebi)", az.status === 400 && cok.status === 400 && bayiCok.status === 400, `${az.status} ${cok.status} ${bayiCok.status}`);
    let checkRed = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO gecici_kod_talebi (id, "kurulumId", "bayiId", "istekKodu", "anahtarOzeti", gun, sebep, yapan, "updatedAt") VALUES ($1::uuid, $2::uuid, $3::uuid, 'X', 'X', 5, 'x', 'x', now())`,
        randomUUID(),
        k.kurulumDbId,
        bayiA.id,
      );
    } catch {
      checkRed = true;
    }
    kontrol("§2b DB CHECK: 5 günlük talep yazılamaz", checkRed);

    console.log("\n§3 üretim");
    const token = randomUUID();
    const y = await uret({ clientToken: token });
    const kod = String(y.veri.kod ?? "");
    kontrol("§3a yönetici 201 · kod 23 × 5 grup (TG-…)", y.status === 201 && KOD_DESENI.test(kod), `${y.status} ${y.kod ?? ""} ${kod.slice(0, 20)}`);
    const cozum = decodeTempOpeningCode(kod, normalizeTempText(istek, "TI"));
    const roots = prepareTrustAnchor(ctx.keys.anchor);
    const dogru = cozum.ok && roots.ok && verifyJws(cozum.value.jws, { typ: TYP_GECICI, findKey: (kid) => roots.value.get(kid)?.key }).ok;
    kontrol("§3b bitiş = bugün + 30 gün, günün sonu", cozum.ok && cozum.value.doc.bitisGunu === dayOfMs(Date.now()) + 30 && new Date(String(y.veri.bitis)).getTime() === tempCodeEndMs(cozum.value.doc.bitisGunu));
    kontrol("§3c ✓K kod kökle (kok-2026-9) imzalı ve çapaya karşı doğrulanıyor", dogru && cozum.ok && cozum.value.rootKid === GECICI_KOK_KID);
    const baska = decodeTempOpeningCode(kod, normalizeTempText(istekKoduUret(fabrika.kid), "TI"));
    const baskaDogru = baska.ok && roots.ok && verifyJws(baska.value.jws, { typ: TYP_GECICI, findKey: (kid) => roots.value.get(kid)?.key }).ok;
    kontrol("§3d başka istek koduyla imza tutmaz", !baskaDogru);
    const govdesi = normalizeTempText(kod, TEMP_CODE_PREFIX);
    const satir = await prisma.geciciAcilisKodu.findUnique({ where: { id: String(y.veri.id) } });
    kontrol(
      "§3e DB: özet + son 4, düz kod yok (sarılı kolon da boş)",
      satir?.ozet === tempCodeDigest(govdesi) && satir.kodSonu === govdesi.slice(-4) && satir.sariliKod === null && !JSON.stringify(satir).includes(govdesi.slice(0, 20)),
    );
    const tekrar = await uret({ clientToken: token });
    kontrol("§3f aynı işlem kimliği: aynı kayıt, kod gösterilmez", tekrar.status === 201 && tekrar.veri.id === y.veri.id && tekrar.veri.kod === null && tekrar.veri.kodGosterilemez === true, JSON.stringify(tekrar.veri));
    const bozuk = await uret({ istekKodu: istek.slice(0, -1) + (istek.endsWith("0") ? "1" : "0") });
    const bozukNeden = (bozuk.json.details as { neden?: string } | undefined)?.neden;
    kontrol("§3g sağlaması tutmayan istek kodu → 400 (neden SAGLAMA)", bozuk.status === 400 && bozukNeden === "SAGLAMA", `${bozuk.status} ${bozukNeden}`);
    const k2 = await kurulumFiksturu(ctx);
    kurulumlar.push(k2.kurulumDbId);
    const bagli = kurulumAnahtariUret();
    await prisma.kurulum.update({ where: { id: k2.kurulumDbId }, data: { anahtarKimligi: bagli.kid, acikAnahtar: bagli.x } });
    const yabanciAnahtar = await uret({}, yCerez, k2.kurulumDbId);
    const kendiAnahtari = await uret({ istekKodu: istekKoduUret(bagli.kid) }, yCerez, k2.kurulumDbId);
    kontrol("§3h bağlı anahtarın olmayan istek kodu → 409 · kendi anahtarınınki 201", yabanciAnahtar.status === 409 && kendiAnahtari.status === 201, `${yabanciAnahtar.status} ${kendiAnahtari.status}`);
    const kokYok = await runAsCli(() =>
      svc.prepareTempCode(ortam.ctx, { installationDbId: k.kurulumDbId, requestCode: istek, days: 30, reason: "x", password: passwordBuffer(TEST_KOK_PAROLASI), nowMs: Date.now() }),
    ).then(
      () => "HATA_YOK",
      (e: { status?: number }) => String(e.status),
    );
    kontrol("§3i koda sığan kök yoksa → 409 (parola alt sürece gitmez)", kokYok === "409", kokYok);

    console.log("\n§4 denetim");
    const denetim = await prisma.denetim.findMany({ where: { varlikId: k.kurulumDbId, olay: "GECICI_KOD_URETILDI" } });
    const islem = await prisma.portalIslemi.findUnique({ where: { clientToken: token } });
    const izler = JSON.stringify(denetim) + JSON.stringify(islem);
    kontrol("§4 denetim satırı var; denetim + saklanan yanıt kodu ve son 4'ü taşımaz", denetim.length >= 1 && !izler.includes(govdesi.slice(0, 20)) && !izler.includes(`"${govdesi.slice(-4)}"`));

    console.log("\n§5 bayi talebi");
    const istek2 = istekKoduUret(fabrika.kid);
    const talep = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talep`, { clientToken: randomUUID(), istekKodu: istek2, gun: 14, sebep: "müşteri internetsiz" });
    const talepId = String(talep.veri.id);
    const mukerrer = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talep`, { clientToken: randomUUID(), istekKodu: istek2, gun: 14, sebep: "yine" });
    kontrol("§5a bayi talep açar (201) · aynı istek koduyla ikinci bekleyen → 409", talep.status === 201 && talep.veri.durum === "BEKLIYOR" && mukerrer.status === 409, `${talep.status} ${mukerrer.status}`);
    const kuyruk = await satici("/gecici-kod-talepleri");
    kontrol("§5b talep satıcı kuyruğunda", Array.isArray(kuyruk.json.data) && (kuyruk.json.data as { id: string }[]).some((r) => r.id === talepId));
    const opUret = await satici(`/gecici-kod-talepleri/${talepId}/uret`, { clientToken: randomUUID(), imzaParolasi: TEST_KOK_PAROLASI, sebep: "onay" }, oCerez);
    const opRed = await satici(`/gecici-kod-talepleri/${talepId}/reddet`, { clientToken: randomUUID(), sebep: "x" }, oCerez);
    kontrol("§5c operatör talebi üretemez/reddedemez → 403", opUret.status === 403 && opRed.status === 403, `${opUret.status} ${opRed.status}`);
    const onay = await satici(`/gecici-kod-talepleri/${talepId}/uret`, { clientToken: randomUUID(), imzaParolasi: TEST_KOK_PAROLASI, sebep: "onay" });
    const liste = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talepleri`);
    const benim = (liste.json.data as { id: string; durum: string; kod: { kod: string | null } | null }[] | undefined)?.find((r) => r.id === talepId);
    kontrol("§5d yönetici üretir; bayi kodu kendi talebinde AYNEN okur", onay.status === 201 && KOD_DESENI.test(String(onay.veri.kod)) && benim?.durum === "URETILDI" && benim.kod?.kod === onay.veri.kod, `${onay.status} ${onay.kod ?? ""}`);
    const baskaListe = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talepleri`, undefined, bCerezB);
    kontrol("§5e başka bayi listeyi göremez → 404", baskaListe.status === 404, `${baskaListe.status}`);
    const ikinci = await satici(`/gecici-kod-talepleri/${talepId}/uret`, { clientToken: randomUUID(), imzaParolasi: TEST_KOK_PAROLASI, sebep: "yine" });
    const uretilmisRed = await satici(`/gecici-kod-talepleri/${talepId}/reddet`, { clientToken: randomUUID(), sebep: "geç" });
    kontrol("§5f üretilmiş talebe ikinci üretim ve ret → 409", ikinci.status === 409 && uretilmisRed.status === 409, `${ikinci.status} ${uretilmisRed.status}`);
    const talep3 = await bayi(`/kurulumlar/${k.kurulumDbId}/gecici-kod-talep`, { clientToken: randomUUID(), istekKodu: istekKoduUret(fabrika.kid), gun: 7, sebep: "deneme" });
    const red = await satici(`/gecici-kod-talepleri/${String(talep3.veri.id)}/reddet`, { clientToken: randomUUID(), sebep: "gereksiz" });
    kontrol("§5g ret: durum REDDEDILDI", red.status === 200 && red.veri.durum === "REDDEDILDI", `${red.status} ${red.kod ?? ""}`);

    console.log("\n§6 tüketim bildirimi");
    const ozet = tempCodeDigest(govdesi);
    const bildir = (anahtar: typeof fabrika, nonce?: string) =>
      imzaliPost(sunucular.genel, "/v1/gecici-kod/tuketildi", { kurulumId: null, amac: "gecici-tuketim", govde: { v: 1, acikAnahtar: anahtar.x, ozetler: [ozet] }, anahtar, nonce, imzaYolu: "/v1/gecici-kod/tuketildi" });
    const ilk = await bildir(fabrika);
    const damga1 = (await prisma.geciciAcilisKodu.findUnique({ where: { ozet } }))?.tuketildiAt;
    kontrol("§6a ✓K ilk bildirim: tanindi=1 yeni=1, damga doldu", ilk.status === 200 && ilk.json.tanindi === 1 && ilk.json.yeni === 1 && damga1 instanceof Date, `${ilk.status} ${JSON.stringify(ilk.json)}`);
    const ikinciBildirim = await bildir(fabrika);
    const damga2 = (await prisma.geciciAcilisKodu.findUnique({ where: { ozet } }))?.tuketildiAt;
    kontrol("§6b tekrar bildirim zararsız: yeni=0, damga değişmez", ikinciBildirim.status === 200 && ikinciBildirim.json.yeni === 0 && damga2?.getTime() === damga1?.getTime());
    const yabanciFabrika = kurulumAnahtariUret();
    nonceKapsamlari.push(`kid:${yabanciFabrika.kid}`);
    const yb = await bildir(yabanciFabrika);
    kontrol("§6c başka anahtar başkasının kodunu tanıtamaz (tanindi=0)", yb.status === 200 && yb.json.tanindi === 0, JSON.stringify(yb.json));
    const nonce = randomBytes(16).toString("base64url");
    await bildir(fabrika, nonce);
    const ayni = await bildir(fabrika, nonce);
    kontrol("§6d aynı istek (nonce) ikinci kez → 409 ISTEK_TEKRAR", ayni.status === 409 && ayni.kod === "ISTEK_TEKRAR", `${ayni.status} ${ayni.kod}`);
  } finally {
    await sunucular.kapat();
    await temizleKurulumlar(kurulumlar, [...ortam.kidler, GECICI_KOK_KID]);
    await prisma.nonceDefteri.deleteMany({ where: { kapsam: { in: nonceKapsamlari } } });
    await temizlePortal({ kullanicilar, bayiler });
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

void main();
