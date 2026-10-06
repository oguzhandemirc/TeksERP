// =============================================================================
// Cloudflare Worker — İNDİRME KAPISI (güncelleme sunucusu)
// =============================================================================
// `/<kanal>/electron/*` · `/<kanal>/mobil/*` · `/<kanal>/backend/*` dosyalarını yalnız fabrikanın
// KENDİ backend'inden alınmış kısa ömürlü İNDİRME belirteciyle verir; adresi bulan
// dışarıdaki biri indiremez. Belirteç JWS + Ed25519 (`typ: tekserp-indirme`) —
// Worker'da YALNIZ açık anahtar durur, imzalayamaz. Anahtarlar İNDİRME LİSTESİNDEN gelir (L2-8): çapa kipi başına
// ayrı liste (üretim · hazırlık), satır başına izinli kanal kümesi ve geçerlilik penceresi (sertifikanınki).
//
// KÂHİN: `Teks-Erp/src/lib/license/protocol/indirme.ts`. Sınırlar birebir aynıdır;
// ayrışırsa kâhin kazanır. Bekçi: `Teks-Erp/scripts/test_indirme_kapisi.ts`.
// KURULUM · GERİ ALMA: `docs/ops/INDIRME-KAPISI-WORKER.md` (panelden yapıştırılır;
// wrangler yok). Rota FAIL CLOSED olmalı: Worker atlanırsa dosyalar AÇILMAZ.
// Kapsam DIŞI her istek olduğu gibi geçer. Grup-nötr OTA takma adı `/ota/<rv>/manifest` (tek ortak paket
// §3.3): grup YALNIZ doğrulanmış belirteçten çözülür, geçiş listesi uygulanmaz; adnansahin'in eski adresinde
// bu Worker yoktur.
// =============================================================================

/**
 * Dosyaya gömülü varsayılan. Panelde `TKL_INDIRME_AYAR` değişkeni (JSON) verilirse
 * alanları bunun ÜSTÜNE yazar. Tanınmayan alan, biçimsiz değer ya da bitişsiz geçiş
 * satırı ayarı GEÇERSİZ kılar ⇒ kapsamdaki her istek 503 (sessiz gevşeme yok).
 */
export const VARSAYILAN_AYAR = Object.freeze({
  /**
   * ESKİ BİÇİM (L2-8 öncesi): [{ kid: "ind-…", x: "<base64url, 32 bayt>" }] — kanal ve pencere KISITSIZ.
   * Bir Worker sürümü daha tanınır (tasarım v2 §4.2); yeni anahtar buraya YAZILMAZ, `indirmeListesi`ne yazılır.
   */
  anahtarlar: [],
  /**
   * İNDİRME listesi — çapa kipi başına AYRI (G3): üretim satıcısının anahtarları `uretim`e, hazırlığınki `hazirlik`e.
   * Satır: { kid, x, kanallar: ["<kanal>", …], baslangic: ISO Z, bitis: ISO Z } (pencere = sertifikanınki).
   * Belirteç yalnız kid listedeyse, kanalı satırın kümesindeyse ve şimdi pencerede (±10 dk) ise geçer.
   * Bir kanal iki listede birden olamaz; kid ve açık anahtar bütün satırlarda (eski biçim dahil) tekildir.
   */
  indirmeListesi: Object.freeze({ uretim: Object.freeze([]), hazirlik: Object.freeze([]) }),
  /** Süreli anonim geçiş — yalnız BUGÜNKÜ sürüm dosyaları: [{ yol | onek, bitis: ISO Z }]. */
  gecisListesi: [],
  /** true: manifest yanıtına varlık belirteci yazılır ve OTA varlıkları da kapılanır. */
  varlikBelirteci: false,
  /** Değişmez dosyaların (exe · blockmap · apk · OTA varlığı) kenar önbellek süresi. */
  onbellekSn: 604800,
});

/** Kanal başına ürün dizinleri — kâhin `DOWNLOAD_PRODUCTS` (protocol/belgeler.ts) ile birebir (bekçi §8). */
export const URUN_DIZINLERI = Object.freeze(["electron", "mobil", "backend"]);

/** OTA takma adının öneki — dağıtım kaydının `otaTakmaAd` türetimiyle aynı (check-dagitim §3); `ota` grup adı olamaz. */
export const OTA_TAKMA_AD_ONEKI = "/ota/";

const TYP = "tekserp-indirme";
const JWS_ALG = "EdDSA";
const JWS_MAX = 32 * 1024;
const IMZA_BAYT = 64;
const ACIK_ANAHTAR_BAYT = 32;
const OMUR_TAVANI_MS = 70 * 60 * 1000;
const SAAT_TOLERANSI_MS = 10 * 60 * 1000;
const GECIS_AZAMI_MS = 90 * 24 * 60 * 60 * 1000;
const ONBELLEK_AZAMI_SN = 365 * 24 * 60 * 60;
// Sertifika ömrünün tavanı (`satici/sunucu/scripts/anahtar.ts` `--gun` ≤ 730): daha uzun pencere yazım hatasıdır.
const PENCERE_AZAMI_MS = 730 * 24 * 60 * 60 * 1000;
const KANAL_AZAMI = 64;
const LISTE_ADLARI = ["uretim", "hazirlik"];
const LISTE_SATIRI_ALANLARI = new Set(["kid", "x", "kanallar", "baslangic", "bitis"]);
const BASLIK_ALANLARI = new Set(["alg", "typ", "kid"]);
const AYAR_ALANLARI = new Set(Object.keys(VARSAYILAN_AYAR));

const KID_BICIMI = /^[a-z]+-[A-Za-z0-9_-]{1,64}$/;
const INDIRME_KID = /^ind-[a-z0-9-]{1,60}$/;
const TYP_BICIMI = /^tekserp-[a-z]+$/;
const X_BICIMI = /^[A-Za-z0-9_-]{43}$/;
const B64U = /^[A-Za-z0-9_-]*$/;
const KANAL_BICIMI = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UUID_BICIMI =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
// Zod `z.iso.datetime()` ile aynı: yalnız `Z`, saniye ve kesir isteğe bağlı, takvim denetimli.
const TARIH =
  "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))";
const ISO_BICIMI = new RegExp(`^${TARIH}T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$`);
const YASAK_YOL = /(\.\.|\\|\/\/|%2e|%2f|%5c|%00)/i;

export const BELIRTEC_BASLIGI = "X-TKL-Indirme";
export const KOD_BASLIGI = "X-TKL-Kod";

function duzNesne(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isoMu(v) {
  return typeof v === "string" && ISO_BICIMI.test(v);
}

/** Katı base64url: dolgu, yabancı karakter, kanonik olmayan kuyruk biti RED (kâhin `b64uDecode`). */
function b64uCoz(metin) {
  if (typeof metin !== "string" || !B64U.test(metin) || metin.length % 4 === 1) return null;
  let ikili;
  try {
    const b64 = metin.replace(/-/g, "+").replace(/_/g, "/");
    ikili = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
  const baytlar = new Uint8Array(ikili.length);
  for (let i = 0; i < ikili.length; i++) baytlar[i] = ikili.charCodeAt(i);
  const geri = btoa(ikili).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return geri === metin ? baytlar : null;
}

function jsonParca(parca) {
  const baytlar = b64uCoz(parca);
  if (!baytlar) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(baytlar));
  } catch {
    return undefined;
  }
}

/** Ayarı doğrular; geçersizse `{ ok: false, neden }` — çağıran kapsamdaki isteği 503'le düşürür. */
export function ayarCoz(ham, simdiMs) {
  const gecersiz = (neden) => ({ ok: false, neden });
  if (!duzNesne(ham)) return gecersiz("ayar bir nesne değil");
  for (const alan of Object.keys(ham)) if (!AYAR_ALANLARI.has(alan)) return gecersiz(`tanınmayan alan: ${alan}`);
  const { anahtarlar, indirmeListesi, gecisListesi, varlikBelirteci, onbellekSn } = ham;
  if (!Array.isArray(anahtarlar)) return gecersiz("anahtarlar dizi değil");
  const kidler = new Set();
  const xler = new Set();
  for (const a of anahtarlar) {
    if (!duzNesne(a) || !INDIRME_KID.test(String(a.kid)) || !X_BICIMI.test(String(a.x))) return gecersiz("anahtar biçimsiz");
    // Kanal/pencere taşıyan satır eski listeye düşerse liste ayrımı (G3) denetlenmeden geçerdi.
    if (Object.keys(a).some((alan) => alan !== "kid" && alan !== "x")) return gecersiz(`eski biçim satırı yalnız kid + x taşır: ${a.kid}`);
    if (kidler.has(a.kid)) return gecersiz(`kid iki kez: ${a.kid}`);
    kidler.add(a.kid);
    xler.add(a.x);
  }
  const liste = listeCoz(indirmeListesi, kidler, xler);
  if (!liste.ok) return gecersiz(liste.neden);
  if (!Array.isArray(gecisListesi)) return gecersiz("gecisListesi dizi değil");
  for (const g of gecisListesi) {
    if (!duzNesne(g) || !isoMu(g.bitis)) return gecersiz("geçiş satırında bitiş yok ya da biçimsiz");
    if (Date.parse(g.bitis) - simdiMs > GECIS_AZAMI_MS) return gecersiz("geçiş bitişi 90 günden uzak");
    const tek = (typeof g.yol === "string") !== (typeof g.onek === "string");
    const deger = typeof g.yol === "string" ? g.yol : g.onek;
    if (!tek || !deger.startsWith("/") || YASAK_YOL.test(deger)) return gecersiz("geçiş satırı yol ya da önek taşımalı");
    if (typeof g.onek === "string" && (!g.onek.endsWith("/") || g.onek.split("/").length < 4)) {
      return gecersiz("geçiş öneki en az /<kanal>/<ürün>/ derinliğinde ve / ile bitmeli");
    }
    for (const alan of Object.keys(g)) if (!["yol", "onek", "bitis"].includes(alan)) return gecersiz(`geçiş satırında tanınmayan alan: ${alan}`);
  }
  if (typeof varlikBelirteci !== "boolean") return gecersiz("varlikBelirteci boolean değil");
  if (!Number.isInteger(onbellekSn) || onbellekSn < 0 || onbellekSn > ONBELLEK_AZAMI_SN) return gecersiz("onbellekSn aralık dışı");
  const dogrulamaAnahtarlari = [...anahtarlar, ...liste.satirlar];
  return { ok: true, ayar: { anahtarlar, indirmeListesi, dogrulamaAnahtarlari, gecisListesi, varlikBelirteci, onbellekSn } };
}

/**
 * İNDİRME listesini doğrular. Döner `{ ok: true, satirlar }` (iki listenin satırları, kopya) ya da `{ ok: false, neden }`.
 * `kidler`/`xler` eski biçimin kümeleridir; satırlar onlara eklenir (tekillik bütün kaynaklarda).
 */
function listeCoz(ham, kidler, xler) {
  const gecersiz = (neden) => ({ ok: false, neden });
  if (!duzNesne(ham)) return gecersiz("indirmeListesi nesne değil");
  for (const ad of Object.keys(ham)) if (!LISTE_ADLARI.includes(ad)) return gecersiz(`indirmeListesi: tanınmayan liste: ${ad}`);
  const listeKanallari = new Map(LISTE_ADLARI.map((ad) => [ad, new Set()]));
  const satirlar = [];
  for (const ad of LISTE_ADLARI) {
    const liste = ham[ad];
    if (!Array.isArray(liste)) return gecersiz(`indirmeListesi.${ad} dizi değil`);
    for (const s of liste) {
      if (!duzNesne(s)) return gecersiz(`${ad}: satır nesne değil`);
      for (const alan of Object.keys(s)) if (!LISTE_SATIRI_ALANLARI.has(alan)) return gecersiz(`${ad}: tanınmayan alan: ${alan}`);
      if (!INDIRME_KID.test(String(s.kid)) || !X_BICIMI.test(String(s.x))) return gecersiz(`${ad}: anahtar biçimsiz`);
      if (kidler.has(s.kid)) return gecersiz(`kid iki kez: ${s.kid}`);
      if (xler.has(s.x)) return gecersiz(`açık anahtar iki satırda: ${s.kid}`);
      const k = s.kanallar;
      if (!Array.isArray(k) || k.length === 0 || k.length > KANAL_AZAMI) return gecersiz(`${s.kid}: kanallar 1–${KANAL_AZAMI} elemanlı dizi olmalı`);
      if (!k.every((x) => typeof x === "string" && KANAL_BICIMI.test(x))) return gecersiz(`${s.kid}: kanal biçimsiz`);
      if (new Set(k).size !== k.length) return gecersiz(`${s.kid}: kanal iki kez`);
      if (!isoMu(s.baslangic) || !isoMu(s.bitis)) return gecersiz(`${s.kid}: baslangic/bitis ISO (Z) olmalı`);
      const sure = Date.parse(s.bitis) - Date.parse(s.baslangic);
      if (!(sure > 0) || sure > PENCERE_AZAMI_MS) return gecersiz(`${s.kid}: pencere boş, ters ya da 730 günden uzun`);
      kidler.add(s.kid);
      xler.add(s.x);
      for (const kanal of k) listeKanallari.get(ad).add(kanal);
      satirlar.push({ kid: s.kid, x: s.x, kanallar: [...k], baslangic: s.baslangic, bitis: s.bitis });
    }
  }
  const [uretim, hazirlik] = LISTE_ADLARI.map((ad) => listeKanallari.get(ad));
  const ortak = [...uretim].find((kanal) => hazirlik.has(kanal));
  if (ortak !== undefined) return gecersiz(`kanal iki listede (uretim + hazirlik): ${ortak}`);
  return { ok: true, satirlar };
}

// Anahtar içe aktarımı pahalı değil ama her istekte tekrarlanmasın; küme ayardan gelir, sınırlıdır.
const anahtarOnbellegi = new Map();
function acikAnahtar(a) {
  const k = `${a.kid}:${a.x}`;
  let p = anahtarOnbellegi.get(k);
  if (!p) {
    p = crypto.subtle
      .importKey("jwk", { kty: "OKP", crv: "Ed25519", x: a.x }, { name: "Ed25519" }, false, ["verify"])
      .catch(() => null);
    anahtarOnbellegi.set(k, p);
  }
  return p;
}

function belgeSemasiUyar(y) {
  return (
    y.v === 1 &&
    typeof y.kanal === "string" &&
    KANAL_BICIMI.test(y.kanal) &&
    typeof y.yolOneki === "string" &&
    y.yolOneki.length <= 80 &&
    typeof y.kurulumId === "string" &&
    UUID_BICIMI.test(y.kurulumId) &&
    isoMu(y.exp) &&
    URUN_DIZINLERI.some((urun) => y.yolOneki === `/${y.kanal}/${urun}/`)
  );
}

/** Satırın penceresi şimdi açık mı (±tolerans)? Pencere yoksa eski biçim (kısıtsız); yarım/biçimsiz KAPALI — kâhin `downloadKeyWindowOpen`. */
export function pencereAcik(kayit, simdiMs) {
  if (kayit.baslangic === undefined && kayit.bitis === undefined) return true;
  if (!isoMu(kayit.baslangic) || !isoMu(kayit.bitis)) return false;
  return simdiMs >= Date.parse(kayit.baslangic) - SAAT_TOLERANSI_MS && simdiMs <= Date.parse(kayit.bitis) + SAAT_TOLERANSI_MS;
}

/** Satır bu kanala izin veriyor mu? Küme yoksa eski biçim (kısıtsız); dizi değilse izin YOK — kâhin `downloadKeyAllowsChannel`. */
export function kanalIzinli(kayit, kanal) {
  if (kayit.kanallar === undefined) return true;
  return Array.isArray(kayit.kanallar) && kayit.kanallar.includes(kanal);
}

/**
 * İNDİRME belirtecini doğrular — kâhin `verifyDownloadToken` ile aynı sıra ve aynı kodlar.
 * `anahtarlar`: eski biçim `{kid, x}` ya da liste satırı `{kid, x, kanallar, baslangic, bitis}`; aynı kid'de ilk satır kazanır.
 * Döner: `{ ok: true, belge }` ya da `{ ok: false, kod }`.
 */
export async function belirteciDogrula(belirtec, { anahtarlar, simdiMs }) {
  const red = (kod) => ({ ok: false, kod });
  if (typeof belirtec !== "string" || belirtec.length === 0 || belirtec.length > JWS_MAX) return red("JWS_BICIM");
  const parcalar = belirtec.split(".");
  if (parcalar.length !== 3) return red("JWS_BICIM");
  const [p0, p1, p2] = parcalar;
  const baslik = jsonParca(p0);
  if (!duzNesne(baslik)) return red("JWS_BICIM");
  // alg ilk: `none` ya da simetrik alg başka hiçbir alana bakılmadan düşer.
  if (baslik.alg !== JWS_ALG) return red("JWS_ALG");
  for (const alan of Object.keys(baslik)) if (!BASLIK_ALANLARI.has(alan)) return red("JWS_BASLIK");
  if (typeof baslik.typ !== "string" || !TYP_BICIMI.test(baslik.typ)) return red("JWS_TYP");
  if (typeof baslik.kid !== "string" || !KID_BICIMI.test(baslik.kid)) return red("JWS_KID");
  const yuk = jsonParca(p1);
  if (!duzNesne(yuk)) return red("JWS_BICIM");
  const imza = b64uCoz(p2);
  if (!imza || imza.length !== IMZA_BAYT) return red("JWS_BICIM");
  if (baslik.typ !== TYP) return red("JWS_TYP");
  const kayit = anahtarlar.find((a) => a.kid === baslik.kid && INDIRME_KID.test(a.kid));
  const anahtar = kayit && b64uCoz(kayit.x)?.length === ACIK_ANAHTAR_BAYT ? await acikAnahtar(kayit) : null;
  if (!anahtar) return red("JWS_KID");
  let gecerli = false;
  try {
    gecerli = await crypto.subtle.verify({ name: "Ed25519" }, anahtar, imza, new TextEncoder().encode(`${p0}.${p1}`));
  } catch {
    gecerli = false;
  }
  if (!gecerli) return red("JWS_IMZA");
  if ("v" in yuk && yuk.v !== 1) return red("BELGE_SURUM");
  if (!belgeSemasiUyar(yuk)) return red("BELGE_SEMA");
  const exp = Date.parse(yuk.exp);
  if (simdiMs > exp + SAAT_TOLERANSI_MS) return red("BELGE_SURESI_DOLDU");
  if (exp - simdiMs > OMUR_TAVANI_MS + SAAT_TOLERANSI_MS) return red("INDIRME_OMUR");
  if (!pencereAcik(kayit, simdiMs)) return red("INDIRME_PENCERE");
  if (!kanalIzinli(kayit, yuk.kanal)) return red("INDIRME_KANAL");
  const { kanal, yolOneki, kurulumId } = yuk;
  return { ok: true, belge: { v: 1, kanal, yolOneki, kurulumId, exp: yuk.exp } };
}

/** Kâhin `isDownloadPathAllowed`: önekin ALTINDA (kendisi değil); kaçış dizileri RED. */
export function yolIzinli(belge, yol) {
  if (YASAK_YOL.test(yol)) return false;
  return yol.startsWith(belge.yolOneki) && yol.length > belge.yolOneki.length;
}

const KAPSAM = new RegExp(`^\\/[^/]+\\/(${URUN_DIZINLERI.join("|")})(\\/|$)`, "i");
const TAKMA_AD_KAPSAMI = new RegExp(`^${OTA_TAKMA_AD_ONEKI.slice(0, -1)}(\\/|$)`, "i");
// Kanonik biçim tek: runtimeVersion dağıtım kaydıyla aynı biçimde (`55.0`); başka her yazım 403.
const TAKMA_AD = new RegExp(`^${OTA_TAKMA_AD_ONEKI}([0-9]{1,6}\\.[0-9]{1,6})\\/manifest$`);
const OTA_MANIFEST = /^\/[^/]+\/mobil\/ota\/[^/]+\/manifest(-[0-9]+)?$/;
const OTA_VARLIK = /^\/[^/]+\/mobil\/ota\/[^/]+\/[0-9]+\/[^?#]+$/;
// `son.json` backend kanalının en yeni sürüm işaretçisi: her yayında değişir, kenarda tutulmaz; zincirli
// ikizleri (`son-zincir.json` · `surum-zincir.json` · `pg-zincir.json`, protocol/paket-zinciri.ts) de öyle.
const DEGISKEN_DOSYA = /(\.ya?ml|\/manifest(-[0-9]+)?|\/surum\.json|\/son\.json|\/(son|surum|pg)-zincir\.json)$/i;

/**
 * Kapsam kararı, origin'in (nginx) GÖRECEĞİ yolda verilir: yüzde kodu çözülür, ters bölü
 * ve çoklu bölü katlanır — `/k/%65lectron/…` ya da `//k/electron/…` kapıyı atlayamasın.
 * Çözülemeyen yol kapsamda sayılır (fail-closed).
 */
export function kapsamdaMi(yol) {
  const katli = katla(yol);
  return katli === null || KAPSAM.test(katli) || KAPSAM.test(yol) || TAKMA_AD_KAPSAMI.test(katli) || TAKMA_AD_KAPSAMI.test(yol);
}

/** Takma ad uzayında mı (`/ota/…`, her yazımıyla — kodlanmış, çift bölü, büyük harf, çözülemeyen)? */
export function takmaAdMi(yol) {
  const katli = katla(yol);
  return TAKMA_AD_KAPSAMI.test(yol) || (katli !== null && TAKMA_AD_KAPSAMI.test(katli));
}

function katla(yol) {
  try {
    return decodeURIComponent(yol).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  } catch {
    return null;
  }
}

/** OTA varlığı mı (içerik adresli paket dosyası)? Kaçış dizisi taşıyan yol varlık SAYILMAZ. */
export function otaVarligiMi(yol) {
  return OTA_VARLIK.test(yol) && !YASAK_YOL.test(yol);
}

/**
 * RFC 8941 sözlüğünden bir anahtarın değeri (expo-updates `Expo-Extra-Params` bu biçimde
 * gönderir: `tkl="…"`). Yalnız dize/simge değer döner; biçimsiz başlık `null` (sonuncu kazanır).
 */
export function sozlukDegeri(metin, aranan) {
  const s = String(metin);
  let i = 0;
  let bulunan = null;
  const bosluk = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  const oge = () => {
    if (s[i] === '"') {
      i++;
      let v = "";
      for (;;) {
        if (i >= s.length) return undefined;
        const c = s[i++];
        if (c === "\\") {
          const n = s[i++];
          if (n !== '"' && n !== "\\") return undefined;
          v += n;
        } else if (c === '"') return v;
        else if (c < " " || c > "~") return undefined;
        else v += c;
      }
    }
    const m = /^(?:\?[01]|[A-Za-z0-9*:/!#$%&'+\-.^_`|~]+)/.exec(s.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    return /^[A-Za-z*]/.test(m[0]) ? m[0] : null;
  };
  bosluk();
  while (i < s.length) {
    const k = /^[a-z*][a-z0-9_\-.*]*/.exec(s.slice(i));
    if (!k) return null;
    i += k[0].length;
    let deger = null;
    if (s[i] === "=") {
      i++;
      deger = oge();
      if (deger === undefined) return null;
    }
    while (s[i] === ";") {
      i++;
      const pk = /^[a-z*][a-z0-9_\-.*]*/.exec(s.slice(i));
      if (!pk) return null;
      i += pk[0].length;
      if (s[i] === "=") {
        i++;
        if (oge() === undefined) return null;
      }
    }
    if (k[0] === aranan) bulunan = deger;
    bosluk();
    if (i >= s.length) break;
    if (s[i] !== ",") return null;
    i++;
    bosluk();
  }
  return bulunan;
}

/** Belirteç kaynakları, bu sırayla: başlık · tablet manifest isteğinde `tkl` · `?t=`. */
export function belirteciBul(request, url) {
  const baslik = request.headers.get(BELIRTEC_BASLIGI);
  if (baslik !== null) return baslik.trim();
  const ek = request.headers.get("expo-extra-params");
  const tkl = ek === null ? null : sozlukDegeri(ek, "tkl");
  if (tkl) return tkl;
  return url.searchParams.get("t");
}

function gecisteMi(ayar, yol, simdiMs) {
  if (YASAK_YOL.test(yol)) return false;
  return ayar.gecisListesi.some(
    (g) =>
      simdiMs <= Date.parse(g.bitis) &&
      (typeof g.yol === "string" ? yol === g.yol : yol.startsWith(g.onek) && yol.length > g.onek.length),
  );
}

/** Origin'e giden istek belirteçsizdir: önbellek anahtarı belirteç başına bölünmez, iz loga düşmez. */
function kaynakIstegi(request, url, hedefYol) {
  const hedef = new URL(url.toString());
  if (hedefYol !== url.pathname) hedef.pathname = hedefYol;
  if (hedef.searchParams.has("t")) hedef.searchParams.delete("t");
  const basliklar = new Headers(request.headers);
  basliklar.delete(BELIRTEC_BASLIGI);
  basliklar.delete("expo-extra-params");
  return new Request(hedef.toString(), { method: request.method, headers: basliklar, redirect: "manual" });
}

/**
 * Değişmez dosya uzun süre kenarda tutulur; 404/5xx TUTULMAZ (bir hafta önbellekte kalan 404
 * dersi — güncelleme-sunucusu README ①). Değişken dosyada (yml · manifest · surum.json)
 * origin'in `no-cache`i geçerli kalır: yeni yayın hemen görünür.
 */
export function onbellekSecenegi(yol, ayar) {
  if (DEGISKEN_DOSYA.test(yol)) return undefined;
  return { cacheEverything: true, cacheTtlByStatus: { "200-299": ayar.onbellekSn, 404: 1, "500-599": 0 } };
}

function varlikAnahtarlari(manifest) {
  const anahtarlar = [];
  if (duzNesne(manifest?.launchAsset) && typeof manifest.launchAsset.key === "string") anahtarlar.push(manifest.launchAsset.key);
  for (const v of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    if (duzNesne(v) && typeof v.key === "string") anahtarlar.push(v.key);
  }
  return anahtarlar;
}

/**
 * Donmuş multipart manifestin İMZA DIŞI `extensions` parçasına her varlık için belirteç
 * başlığı yazar (expo-updates `assetRequestHeaders`). `manifest` parçasının baytlarına
 * DOKUNULMAZ — imza onun üstündedir. Biçim tanınmazsa `null` (çağıran yanıtı aynen verir).
 */
export function extensionsYaz(metin, sinir, belirtec) {
  const ayrac = `--${sinir}`;
  const bloklar = metin.split(ayrac);
  if (bloklar.length < 3 || !bloklar[bloklar.length - 1].startsWith("--")) return null;
  let anahtarlar = null;
  let ext = {};
  let extSira = -1;
  for (let i = 1; i < bloklar.length - 1; i++) {
    const kesim = bloklar[i].indexOf("\r\n\r\n");
    if (kesim < 0) return null;
    const ad = /name="([^"]+)"/i.exec(bloklar[i].slice(0, kesim))?.[1];
    const govde = bloklar[i].slice(kesim + 4).replace(/\r\n$/, "");
    if (ad !== "manifest" && ad !== "extensions") continue;
    let json;
    try {
      json = JSON.parse(govde);
    } catch {
      return null;
    }
    if (!duzNesne(json)) return null;
    if (ad === "manifest") anahtarlar = varlikAnahtarlari(json);
    else [ext, extSira] = [json, i];
  }
  if (!anahtarlar) return null;
  const assetRequestHeaders = {};
  for (const k of anahtarlar) assetRequestHeaders[k] = { [BELIRTEC_BASLIGI]: belirtec };
  const yeni = JSON.stringify({ ...ext, assetRequestHeaders });
  if (yeni.includes(ayrac)) return null;
  const parca =
    `\r\ncontent-disposition: form-data; name="extensions"\r\n` +
    `content-type: application/json; charset=utf-8\r\n\r\n${yeni}\r\n`;
  if (extSira >= 0) bloklar[extSira] = parca;
  else bloklar.splice(bloklar.length - 1, 0, parca);
  return bloklar.join(ayrac);
}

async function varlikBelirteciYaz(yanit, belirtec) {
  const sinir = /boundary="?([^";\s]+)"?/i.exec(yanit.headers.get("content-type") ?? "")?.[1];
  if (!sinir) return yanit;
  const metin = await yanit.text();
  const yeni = extensionsYaz(metin, sinir, belirtec);
  const basliklar = new Headers(yanit.headers);
  basliklar.delete("content-length");
  if (yeni === null) return new Response(metin, { status: yanit.status, headers: basliklar });
  // Gövde artık belirteç taşıyor: hiçbir paylaşılan önbellek tutmasın.
  basliklar.set("cache-control", "private, no-store");
  return new Response(yeni, { status: yanit.status, headers: basliklar });
}

/**
 * `/ota/<rv>/manifest` → `/<belirteç.kanal>/mobil/ota/<rv>/manifest`. Belirteç ZORUNLU (geçiş listesi yok);
 * gerçek yol belirtecin `yolOneki`nin altında olmalı. Origin isteği ve önbellek anahtarı gerçek yoldur.
 */
async function takmaAd(request, url, ayar, simdiMs, teslim) {
  const m = TAKMA_AD.exec(url.pathname);
  if (!m) return redYaniti("INDIRME_YOL", 403);
  const belirtec = belirteciBul(request, url);
  if (!belirtec) return redYaniti("INDIRME_BELIRTEC_YOK", 403);
  const d = await belirteciDogrula(belirtec, { anahtarlar: ayar.dogrulamaAnahtarlari, simdiMs });
  if (!d.ok) return redYaniti(d.kod, 403);
  const gercek = `/${d.belge.kanal}/mobil/ota/${m[1]}/manifest`;
  if (!yolIzinli(d.belge, gercek)) return redYaniti("INDIRME_YOL", 403);
  return teslim(belirtec, gercek);
}

const MESAJ = {
  403: "İndirme izni yok: geçerli bir indirme belirteci gerekli.",
  405: "Bu yolda yalnız GET ve HEAD kabul edilir.",
  503: "İndirme kapısı yapılandırması geçersiz.",
};

function redYaniti(kod, durum) {
  return new Response(MESAJ[durum], {
    status: durum,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", [KOD_BASLIGI]: kod },
  });
}

/**
 * Kapı işleyicisi. `ayar` ham ayardır (her istekte doğrulanır — geçiş bitişi saate bağlı);
 * `fetchImpl` ve `simdi` bekçi ve senaryo koşucusu içindir, Worker varsayılanları kullanır.
 */
export function kapiOlustur({ ayar: hamAyar, fetchImpl = (r, i) => fetch(r, i), simdi = () => Date.now() } = {}) {
  return async function kapi(request) {
    const url = new URL(request.url);
    const yol = url.pathname;
    if (!kapsamdaMi(yol)) return fetchImpl(request);
    const simdiMs = simdi();
    const cozum = ayarCoz(hamAyar, simdiMs);
    if (!cozum.ok) return redYaniti("AYAR_GECERSIZ", 503);
    const ayar = cozum.ayar;
    if (request.method !== "GET" && request.method !== "HEAD") return redYaniti("YONTEM", 405);
    const teslim = async (belirtec, hedefYol = yol) => {
      const cf = onbellekSecenegi(hedefYol, ayar);
      const yanit = await fetchImpl(kaynakIstegi(request, url, hedefYol), cf ? { cf } : undefined);
      const yaz = belirtec && ayar.varlikBelirteci && request.method === "GET" && OTA_MANIFEST.test(hedefYol);
      return yaz && yanit.status === 200 ? varlikBelirteciYaz(yanit, belirtec) : yanit;
    };
    if (takmaAdMi(yol)) return takmaAd(request, url, ayar, simdiMs, teslim);
    // Varlık belirteci kapalıyken OTA varlıkları içerik adreslidir; kapı manifesttedir (§3c).
    if (!ayar.varlikBelirteci && otaVarligiMi(yol)) return teslim(null);
    const belirtec = belirteciBul(request, url);
    let kod = "INDIRME_BELIRTEC_YOK";
    if (belirtec) {
      const d = await belirteciDogrula(belirtec, { anahtarlar: ayar.dogrulamaAnahtarlari, simdiMs });
      if (d.ok && yolIzinli(d.belge, yol)) return teslim(belirtec);
      kod = d.ok ? "INDIRME_YOL" : d.kod;
    }
    if (gecisteMi(ayar, yol, simdiMs)) return teslim(null);
    return redYaniti(kod, 403);
  };
}

export default {
  async fetch(request, env) {
    let ham = VARSAYILAN_AYAR;
    const dis = env?.TKL_INDIRME_AYAR;
    if (dis !== undefined) {
      try {
        const nesne = typeof dis === "string" ? JSON.parse(dis) : dis;
        ham = duzNesne(nesne) ? { ...VARSAYILAN_AYAR, ...nesne } : null;
      } catch {
        ham = null;
      }
    }
    return kapiOlustur({ ayar: ham })(request);
  },
};
