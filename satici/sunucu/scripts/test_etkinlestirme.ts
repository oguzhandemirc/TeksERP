// =============================================================================
// ETKİNLEŞTİRME UÇTAN UCA — gerçek satıcı süreci (tek süreç, iki dinleyici) + kendi _test DB'si.
// Portal tarafı: müşteri → tesis → kurulum → hak → HAK KÖK imzası (parola imza alt sürecine
// stdin'den) → tek kullanımlık kod. Fabrika tarafı: kurulum anahtarıyla imzalı istek.
// Ölçülen: yanıt sözleşmesi; HAK + KİRA + ALT sertifika zinciri fabrikanın doğrulayıcısından
// (Teks-Erp protokolünün aynası) geçer; kira kuruluma/anahtara/HAK sürümüne bağlı; gözlem kipi
// varsayılan; indirme belirteçleri kâhinden geçer; kod tüketildi; kurulum kaydı + künye + denetim
// sır taşımaz; aynı kod + aynı anahtar tekrar → aynı kira; hata yolları (kod, kurulum, gövde, sürüm,
// kurcalanmış gövde, anahtar uyuşmazlığı, imzasız istek) doğru kodla. Kod DB'de sunucu sırlı HMAC, son 4
// yalnız kod satırında. Yanıt lisans kimliğini + kod türünü taşır; KİMLİKSİZ istekte kurulumu kod belirler
// (D14), kimlik taşıyan istekte başka kurulumun kodu "yok"tur.
// ⭐ KALICI SONDA ✓K2 (her koşumda): (1) kurcalanmış gövde reddedilir — doğrulayıcı gerçekten
//    gövdeye bakıyor; (2) başka anahtarla imzalı kira fabrikada KIRA_HAK/JWS_KID ile düşer — bekçinin
//    "zincir doğrulandı" yeşili kurgu değil.
// §7 zayıf tanıma (K8): okunabilen etken < 3 ya da güçlü < 2 → 409 ZAYIF_TANIMA_ONAY_BEKLIYOR, kod ve nonce tüketilmez,
// talep onay listesinde (anahtar başına tek); onaydan sonra aynı kod 200 ve kira `parmakIziKurali: zayif`.
// Koşum: npx tsx scripts/test_etkinlestirme.ts
// =============================================================================
import {
  DOWNLOAD_PRODUCTS,
  ENDPOINTS,
  LicenseResponseSchema,
  checkLeaseBinding,
  isDownloadPathAllowed,
  parseJws,
  signJws,
  verifyDownloadToken,
  verifyEntitlement,
  verifyLease,
} from "../src/lisans-protokol";
import { createHash } from "node:crypto";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliBaslik,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
} from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  try {
    console.log("\n§1 portal fikstürü");
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const hak = await prisma.hak.findUniqueOrThrow({ where: { id: k.hakId } });
    const surum = await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: k.hakId, surum: 1 } } });
    kontrol("§1a HAK sürüm 1 KÖK ile imzalandı ve deftere yazıldı", hak.guncelSurum === 1 && surum.imzalayanKid === f.kok.kid);
    kontrol("§1b lisans no doğuşta materyalize (TKS-YYYY-NNNN)", /^TKS-\d{4}-\d{4,6}$/.test(k.lisansNo), k.lisansNo);
    const kodKaydi = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§1c kodun düz metni DB'de YOK (özet + son 4)", kodKaydi.kodOzeti !== k.kod && !JSON.stringify(kodKaydi).includes(k.kod) && kodKaydi.kodSonu === k.kod.slice(-4));
    const pepperiz = createHash("sha256").update(k.kod, "utf8").digest("hex");
    kontrol("§1d ✓K özet sunucu sırlı HMAC: sırsız sha256 TUTMAZ, sırlı özet tutar", kodKaydi.kodOzeti !== pepperiz && kodKaydi.kodOzeti === ctx.codeHasher.digest(k.kod));
    kontrol("§1e kod türü `ilk`, talepsiz", kodKaydi.tur === "ilk" && kodKaydi.tasimaTalebiId === null);

    console.log("\n§2 hata yolları (kod tüketilmeden)");
    const govde = etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: f.kurulum, parmakIzi: f.parmakIzi });
    const url = `${sunucu.genel}${ENDPOINTS.ACTIVATE}`;
    const imzasiz = await gonder(url, { govde: JSON.stringify(govde) });
    kontrol("§2a imzasız istek → 401 ISTEK_GECERSIZ", imzasiz.status === 401 && imzasiz.kod === "ISTEK_GECERSIZ", `${imzasiz.status} ${imzasiz.kod}`);
    const yanlisKod = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: f.kurulum,
      govde: { ...govde, kod: "TKS-0000-0000-0000" },
    });
    kontrol("§2b tanınmayan kod → 404 ETKINLESTIRME_KODU_GECERSIZ", yanlisKod.status === 404 && yanlisKod.kod === "ETKINLESTIRME_KODU_GECERSIZ", `${yanlisKod.status} ${yanlisKod.kod}`);
    const bilinmeyen = kurulumAnahtariUret();
    const yabanci = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: f.hakId, // satıcıda kaydı olmayan bir installationId
      amac: "etkinlestir",
      anahtar: bilinmeyen,
      govde: { ...govde, kurulumId: f.hakId, acikAnahtar: bilinmeyen.x },
    });
    kontrol("§2c kayıtsız kurulum → 401 KURULUM_BILINMIYOR", yabanci.status === 401 && yabanci.kod === "KURULUM_BILINMIYOR", `${yabanci.status} ${yabanci.kod}`);
    const fazlaAlan = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: f.kurulum,
      govde: { ...govde, musteriAdi: "sızıntı" },
    });
    kontrol("§2d KATI gövde: allowlist dışı anahtar → 400 GOVDE_GECERSIZ", fazlaAlan.status === 400 && fazlaAlan.kod === "GOVDE_GECERSIZ", `${fazlaAlan.status} ${fazlaAlan.kod}`);
    const v2 = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar: f.kurulum, govde: { ...govde, v: 2 } });
    kontrol("§2e bilinmeyen v → 400 PROTOKOL_SURUMU", v2.status === 400 && v2.kod === "PROTOKOL_SURUMU", `${v2.status} ${v2.kod}`);
    // ✓K1: imza bir gövdeye verilip BAŞKA gövde gönderilirse özet tutmaz.
    const metin = JSON.stringify(govde);
    const baslik = imzaliBaslik({ kurulumId: k.kurulumId, amac: "etkinlestir", govde: metin, anahtar: f.kurulum });
    const kurcali = await gonder(url, { baslik, govde: metin.replace(`"win32"`, `"linux"`) });
    kontrol("§2f ✓K kurcalanmış gövde → 401 ISTEK_GOVDE_OZETI", kurcali.status === 401 && kurcali.kod === "ISTEK_GOVDE_OZETI", `${kurcali.status} ${kurcali.kod}`);
    const baskaAnahtar = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: bilinmeyen,
      govde, // gövdedeki anahtar f.kurulum, imza bilinmeyen anahtarla
    });
    kontrol("§2g gövdedeki anahtarla imzalanmamış → 401 ISTEK_KID", baskaAnahtar.status === 401 && baskaAnahtar.kod === "ISTEK_KID", `${baskaAnahtar.status} ${baskaAnahtar.kod}`);
    const yanlisAmac = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "yokla", anahtar: f.kurulum, govde });
    kontrol("§2h yanlış amaçlı istek → 401 ISTEK_AMAC", yanlisAmac.status === 401 && yanlisAmac.kod === "ISTEK_AMAC", `${yanlisAmac.status} ${yanlisAmac.kod}`);
    const hala = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§2i reddedilen istekler kodu TÜKETMEDİ", hala.durum === "AKTIF");

    console.log("\n§3 etkinleştirme");
    const r = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar: f.kurulum, govde });
    kontrol("§3a 200", r.status === 200, `${r.status} ${r.kod ?? ""}`);
    const yanit = LicenseResponseSchema.safeParse(r.json);
    kontrol("§3b yanıt LicenseResponseSchema'ya uyar", yanit.success);
    if (!yanit.success) throw new Error("yanıt sözleşmeye uymuyor");
    const hakDogru = verifyEntitlement(yanit.data.hak, f.kokler);
    kontrol("§3c HAK fabrikanın doğrulayıcısından geçer (kök zinciri)", hakDogru.ok, hakDogru.ok ? "" : hakDogru.code);
    const kiraDogru = verifyLease(yanit.data.kira, f.kokler);
    kontrol("§3d KİRA + gömülü ALT sertifika doğrulanır", kiraDogru.ok, kiraDogru.ok ? "" : kiraDogru.code);
    if (!hakDogru.ok || !kiraDogru.ok) throw new Error("zincir doğrulanamadı");
    const bag = checkLeaseBinding(kiraDogru.value, hakDogru.value);
    kontrol("§3e kira HAK sürümüne bağlı (checkLeaseBinding)", bag.ok);
    const kira = kiraDogru.value.document;
    kontrol("§3f kira kuruluma ve anahtara bağlı", kira.kurulumId === k.kurulumId && kira.kurulumAnahtarKimligi === f.kurulum.kid);
    kontrol("§3g varsayılan GÖZLEM kipi (zorlama=false), yaptırım yok", kira.zorlama === false && kira.yaptirim.kademe === null && kira.devredildi === false);
    kontrol("§3h kiradaki parmak izi = etkinleştirmede ölçülen", JSON.stringify(kira.parmakIzi) === JSON.stringify(f.parmakIzi));
    kontrol("§3i kira ALT anahtarla imzalı", kiraDogru.value.subCertificate.document.kid === f.alt.kid);
    const tokenlar = yanit.data.indirmeBelirtecleri;
    const indOk = tokenlar.length === DOWNLOAD_PRODUCTS.length && tokenlar.every((t) => {
      const v = verifyDownloadToken(t.belirtec, { keys: [{ kid: f.ind.kid, x: f.ind.x }], nowMs: Date.now() });
      return v.ok && v.value.kurulumId === k.kurulumId && isDownloadPathAllowed(v.value, `${t.yolOneki}paket.exe`);
    });
    kontrol("§3j indirme belirteçleri (electron/ + mobil/ + backend/ — DOWNLOAD_PRODUCTS) kâhinden geçer", indOk, `${tokenlar.length} belirteç`);
    kontrol("§3k yanıt lisans kimliğini (kiranınkiyle aynı) ve kod türünü taşır", yanit.data.kurulumId === k.kurulumId && yanit.data.kurulumId === kira.kurulumId && yanit.data.kodTuru === "ilk", `${yanit.data.kurulumId} ${yanit.data.kodTuru}`);

    console.log("\n§4 DB izi");
    const kurulum = await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } });
    kontrol("§4a kurulum ETKİN, anahtar + parmak izi + zincir ucu yazıldı", kurulum.durum === "ETKIN" && kurulum.anahtarKimligi === f.kurulum.kid && kurulum.sonKiraId === kira.kiraId);
    const kod2 = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§4b kod KULLANILDI (anahtar + kira bağlı)", kod2.durum === "KULLANILDI" && kod2.kullananAnahtarKimligi === f.kurulum.kid && kod2.kiraId === kira.kiraId);
    const kayit = await prisma.kurulumKaydi.findMany({ where: { kurulumId: k.kurulumDbId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    kontrol("§4c kurulum kaydı: sözleşme kabulü → ETKINLESTI (Ek-7, aynı tx)", kayit.length === 2 && kayit[0]!.olay === "SOZLESME_KABUL_EDILDI" && kayit[1]!.olay === "ETKINLESTI", kayit.map((r) => r.olay).join(","));
    const kiraSatiri = await prisma.kira.findUniqueOrThrow({ where: { id: kira.kiraId } });
    kontrol("§4d kira defterde (zincir kökü)", kiraSatiri.karar === "ETKINLESTIRME" && kiraSatiri.oncekiKiraId === null);
    const kunye = await prisma.anahtarKaydi.findMany();
    const kunyeMetni = JSON.stringify(kunye);
    const ozelYarilar = [f.kok, f.alt, f.ind, f.hazirlik].map((a) => String(a.privateKey.export({ format: "jwk" }).d));
    kontrol("§4e anahtar künyesi: açık yarılar var, ÖZEL yarı YOK", kunye.some((a) => a.kid === f.alt.kid) && ozelYarilar.every((d) => !kunyeMetni.includes(d)));
    const denetim = await prisma.denetim.findMany({ where: { varlikId: k.kurulumDbId } });
    const denetimMetni = JSON.stringify(denetim);
    kontrol("§4f denetim: etkinleşme olayı var, kod düz metni/imzalı belge YOK", denetim.some((d) => d.olay === "KURULUM_ETKINLESTI") && !denetimMetni.includes(k.kod) && !denetimMetni.includes(yanit.data.kira));
    const kayitMetni = JSON.stringify(kayit);
    kontrol("§4g kodun son 4'ü YALNIZ kod satırında: denetim ve kurulum kaydı kod KİMLİĞİNİ taşır", !denetimMetni.includes("kodSonu") && !kayitMetni.includes("kodSonu") && kayitMetni.includes(kodKaydi.id) && denetimMetni.includes(kodKaydi.id));

    console.log("\n§5 tekrar ve ikinci kullanım");
    const tekrar = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar: f.kurulum, govde });
    const tekrarKira = tekrar.status === 200 ? parseJws(tekrar.json.kira).ok : false;
    kontrol("§5a aynı kod + aynı anahtar (ağ tekrarı) → 200 AYNI kira", tekrar.status === 200 && tekrarKira && tekrar.json.kira === yanit.data.kira, `${tekrar.status}`);
    const ikinci = kurulumAnahtariUret();
    const baska = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: ikinci,
      govde: { ...govde, acikAnahtar: ikinci.x },
    });
    kontrol("§5b aynı kod başka anahtarla → 409 ETKINLESTIRME_KODU_KULLANILMIS", baska.status === 409 && baska.kod === "ETKINLESTIRME_KODU_KULLANILMIS", `${baska.status} ${baska.kod}`);

    console.log("\n§5c kimliksiz etkinleştirme (D14) — kurulumu kod belirler");
    const k2 = await kurulumFiksturu(ctx);
    temizlenecek.push(k2.kurulumDbId);
    const kimliksizAnahtar = kurulumAnahtariUret();
    const kimliksizGovde = etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: null, anahtar: kimliksizAnahtar, parmakIzi: f.parmakIzi });
    const baskaKodla = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: kimliksizAnahtar,
      govde: { ...kimliksizGovde, kurulumId: k.kurulumId },
    });
    kontrol("§5c1 ✓K kimlik taşıyan istek + BAŞKA kurulumun kodu → 404 (kod o kuruluma ait değil)", baskaKodla.status === 404 && baskaKodla.kod === "ETKINLESTIRME_KODU_GECERSIZ", `${baskaKodla.status} ${baskaKodla.kod}`);
    const govdeKimlikli = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: null, amac: "etkinlestir", anahtar: kimliksizAnahtar, govde: { ...kimliksizGovde, kurulumId: k2.kurulumId } });
    kontrol("§5c2 kimliksiz imza + gövdede kimlik → 401 ISTEK_KURULUM", govdeKimlikli.status === 401 && govdeKimlikli.kod === "ISTEK_KURULUM", `${govdeKimlikli.status} ${govdeKimlikli.kod}`);
    const kimliksiz = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: null, amac: "etkinlestir", anahtar: kimliksizAnahtar, govde: kimliksizGovde });
    const kimliksizYanit = LicenseResponseSchema.safeParse(kimliksiz.json);
    const kimliksizKira = kimliksizYanit.success ? verifyLease(kimliksizYanit.data.kira, f.kokler) : null;
    kontrol(
      "§5c3 kimliksiz istek → 200, yanıt kurulumId = portalın kimliği = kiranın kimliği",
      kimliksiz.status === 200 && kimliksizYanit.success && kimliksizYanit.data.kurulumId === k2.kurulumId && kimliksizKira?.ok === true && kimliksizKira.value.document.kurulumId === k2.kurulumId,
      `${kimliksiz.status} ${kimliksiz.kod ?? ""}`,
    );
    const nonceSatiri = await prisma.nonceDefteri.count({ where: { kapsam: k2.kurulumDbId, kurulumId: k2.kurulumDbId } });
    kontrol("§5c4 kimliksiz etkinleştirmenin nonce kapsamı koddan bulunan kurulum", nonceSatiri === 1, `${nonceSatiri}`);

    console.log("\n§7 zayıf tanıma (K8): okunabilen etken < 3 ya da güçlü < 2 → satıcı onayı");
    const kz = await kurulumFiksturu(ctx);
    temizlenecek.push(kz.kurulumDbId);
    const az = kurulumAnahtariUret();
    const zayif = { f1: f.parmakIzi.f1, f2: f.parmakIzi.f2, f3: null, f4: null, f5: f.parmakIzi.f5 };
    const zayifEtkinlestir = () =>
      imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
        kurulumId: kz.kurulumId,
        amac: "etkinlestir",
        anahtar: az,
        govde: { ...etkinlestirmeGovdesi({ kod: kz.kod, kurulumId: kz.kurulumId, anahtar: az, parmakIzi: zayif }), yetenekler: ["odenmis-tarih", "parmak-izi-v2"] },
      });
    const z1 = await zayifEtkinlestir();
    const z2 = await zayifEtkinlestir();
    const kodZ = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: kz.kurulumDbId } });
    const talepZ = await prisma.donanimTalebi.findMany({ where: { kurulumId: kz.kurulumDbId, tur: "ZAYIF_TANIMA" } });
    kontrol("§7a ⭐ üç etkenli küme (güçlü yalnız f2) → 409 ZAYIF_TANIMA_ONAY_BEKLIYOR; kod TÜKETİLMEDİ, nonce yazılmadı, kurulum etkinleşmedi",
      z1.status === 409 && z1.kod === "ZAYIF_TANIMA_ONAY_BEKLIYOR" && z2.status === 409 && kodZ.durum === "AKTIF" &&
        (await prisma.nonceDefteri.count({ where: { kurulumId: kz.kurulumDbId } })) === 0 && (await prisma.kurulum.findUniqueOrThrow({ where: { id: kz.kurulumDbId } })).durum === "ETKINLESMEDI",
      `${z1.status} ${z1.kod ?? ""} kod=${kodZ.durum}`);
    kontrol("§7b onay listesinde TEK talep (bu anahtar; ikinci deneme tazeledi), bildirim talep başına bir kez",
      talepZ.length === 1 && talepZ[0]!.anahtarKimligi === az.kid && talepZ[0]!.durum === "BEKLIYOR" && talepZ[0]!.bildirimSayisi === 2 &&
        (await prisma.bildirim.count({ where: { kurulumId: kz.kurulumDbId, olay: "DONANIM_ONAYI_BEKLIYOR" } })) === 2);
    const { decideHardwareTx } = await import("../src/services/hardware.service");
    await prisma.$transaction((tx) => decideHardwareTx(tx, { talep: talepZ[0]!, decision: "ONAYLANDI", actor: "bekci", reason: "sanal sunucu, müşteriyle teyit edildi" }));
    const z3 = await zayifEtkinlestir();
    const kiraZ = LicenseResponseSchema.safeParse(z3.json);
    const kiraZDoc = kiraZ.success ? verifyLease(kiraZ.data.kira, f.kokler) : null;
    kontrol("§7c onaydan sonra AYNI kod 200; kira `parmakIziKurali: zayif`, kabul edilen küme bildirilen zayıf küme",
      z3.status === 200 && !!kiraZDoc?.ok && kiraZDoc.value.document.parmakIziKurali === "zayif" &&
        JSON.stringify((await prisma.kurulum.findUniqueOrThrow({ where: { id: kz.kurulumDbId } })).kabulEdilenParmakIzi) === JSON.stringify(zayif),
      `${z3.status} ${z3.kod ?? ""}`);
    const kz2 = await kurulumFiksturu(ctx);
    temizlenecek.push(kz2.kurulumDbId);
    const anahtarZ4 = kurulumAnahtariUret();
    const z4 = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: kz2.kurulumId,
      amac: "etkinlestir",
      anahtar: anahtarZ4,
      govde: etkinlestirmeGovdesi({ kod: kz2.kod, kurulumId: kz2.kurulumId, anahtar: anahtarZ4, parmakIzi: { ...zayif, f3: f.parmakIzi.f3 } }),
    });
    kontrol("§7d karşı: dört etkenli, iki güçlü küme zayıf DEĞİL → onaysız 200, talep yok; eski gövde (yeteneksiz) kirasında kural alanı YOK",
      z4.status === 200 && (await prisma.donanimTalebi.count({ where: { kurulumId: kz2.kurulumDbId } })) === 0 && (LicenseResponseSchema.safeParse(z4.json).success ? (parseJws((z4.json as { kira: string }).kira) as { ok: boolean; value?: { payload: Record<string, unknown> } }).value?.payload.parmakIziKurali : "?") === undefined,
      `${z4.status} ${z4.kod ?? ""}`);

    console.log("\n§6 ✓K sondası: kurgu yeşil değil");
    const sahte = signJws({ typ: "tekserp-kira", kid: f.alt.kid, payload: parseJws(yanit.data.kira).ok ? (parseJws(yanit.data.kira) as { ok: true; value: { payload: Record<string, unknown> } }).value.payload : {}, privateKey: ikinci.privateKey });
    const sahteDogru = verifyLease(sahte, f.kokler);
    kontrol("§6a başka anahtarla imzalı kira fabrikada düşer (JWS_IMZA)", !sahteDogru.ok && sahteDogru.code === "JWS_IMZA", sahteDogru.ok ? "GEÇTİ?!" : sahteDogru.code);
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
