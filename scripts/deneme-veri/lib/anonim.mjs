// =============================================================================
// deneme-veri — ANONİMLEŞTİRME saf çekirdeği (DB'siz, ağsız; bekçi: scripts/test_deneme_veri.mjs).
//
// İlke: takma ad BELİRLENİMLİDİR (aynı girdi → aynı çıktı) ve KENDİ ÇIKTISINI yeniden değiştirmez ⇒
// betik ikinci kez koşunca sıfır satır değişir (idempotent). Ad değişimi iki katmanlıdır:
//   ① ifade sözlüğü — bir varlığın TAM adı (ör. tümü genel kelime olan bir unvan) → yeni ad
//   ② kelime sözlüğü — ayırt edici ad parçası (marka/kişi adı) → havuzdan takma kelime; her metinde,
//      JSON anlık görüntülerinde de AYNI eşleme (tutarlılık: aynı cari her yerde aynı yeni ad).
// Genel kelimeler (sektör/hukuki ek/konum) korunur: "X TEKSTİL" → "Y TEKSTİL".
// =============================================================================
import { createHash } from "node:crypto";

// ── Türkçe harf işlemleri (yerel ayar API'si kullanılmaz — sonuç ortamdan bağımsız) ───────────────
export const buyukTr = (s) => String(s).replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
export const kucukTr = (s) => String(s).replace(/I/g, "ı").replace(/İ/g, "i").toLowerCase();
export const basHarfTr = (s) => (s ? buyukTr(s[0]) + kucukTr(s.slice(1)) : s);
const ASCII = { Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U", ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
export const asciiTr = (s) => String(s).replace(/[ÇĞİÖŞÜçğıöşü]/g, (c) => ASCII[c]);
/** Karşılaştırma anahtarı: Türkçe büyük harf + ASCII katlama ("Şahin" ≡ "SAHIN" ≡ "ŞAHİN"). */
export const katla = (s) => asciiTr(buyukTr(s));

/** Kelimelere böl (harf olmayan her şey ayırıcıdır); 2 harften kısa ve salt rakam parçalar atılır. */
export function kelimeler(s) {
  return String(s ?? "").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !/^\p{N}+$/u.test(t));
}

/** Belirlenimli tam sayı (0..2^32) — tuz + anahtar. */
export function ozet32(...parca) {
  return createHash("sha256").update(parca.join("\u0000")).digest().readUInt32BE(0);
}

// ── Genel kelimeler — sektör, hukuki ek, konum, rol (değişmez) ──────────────────────────────────
export const GENEL_KELIMELER = new Set([
  "TEKSTIL", "TEKSTILI", "TEKS", "TEX", "HOME", "EV", "PERDE", "PERDECILIK", "DOKUMA", "ZIMPARA", "URETIM", "KARTELACI",
  "KARTELA", "DEKORASYON", "DOSEMELIK", "MOBILYA", "KUMAS", "KUMASCILIK", "BOYA", "BOYAHANE", "APRE", "IPLIK", "ORME",
  "KONFEKSIYON", "SANAYI", "SAN", "TICARET", "TIC", "LTD", "STI", "AS", "VE", "ITHALAT", "IHRACAT", "DIS", "PAZARLAMA",
  "GRUP", "HOLDING", "FABRIKA", "FABRIKASI", "ATOLYE", "ATOLYESI", "MAGAZA", "MAGAZASI", "COLLECTION", "DESIGN", "TEXTILE",
  "QUALITY", "LALELI", "MOSKOVA", "ROMANYA", "GURCISTAN", "ISTANBUL", "BURSA", "MERTER", "ANKARA", "IZMIR", "DENIZLI",
  "SISTEM", "BAKIMI", "YONETICISI", "HAM", "GIRIS", "KURSUN", "ETKILI", "YAZILIM", "KULLANICI",
].map(katla));

// ── Havuzlar (uydurma; büyük ünlü markalar ve gerçek tanınmış firma adları bilerek yok) ─────────
export const HAVUZ_MARKA = [
  "Akasya", "Begonya", "Defne", "Ilgın", "Lavanta", "Manolya", "Mimoza", "Nergis", "Orkide", "Papatya", "Sardunya",
  "Yasemin", "Zambak", "Fulya", "Kardelen", "Menekşe", "Nilüfer", "Sümbül", "Çiğdem", "Hanımeli", "Karanfil", "Leylak",
  "Gelincik", "Ardıç", "Çınar", "Ihlamur", "Kestane", "Meşe", "Söğüt", "Servi", "Sedir", "Kavak", "Gürgen", "Badem",
  "Ayva", "Nar", "İncir", "Zeytin", "Kiraz", "Vişne", "Dut", "Erik", "Lale", "Gonca", "Ebrar", "Selvi", "Pelin",
  "Rüzgar", "Yakamoz", "Gökkuşağı", "Şimşek", "Yıldız", "Dolunay", "Şafak", "Tan", "Bulut", "Ayaz", "Poyraz",
  "Lodos", "Meltem", "Kumru", "Serçe", "Turna", "Ceylan", "Atlas", "Mavera", "Safir", "Zümrüt", "Mercan", "İnci",
  "Kehribar", "Firuze", "Lacivert", "Ipek", "Kadife", "Saten", "Tafta", "Gizem", "Doruk", "Pınar",
];
export const HAVUZ_AD = [
  "Mert", "Burak", "Selin", "Elif", "Kerem", "Cem", "Ece", "Tolga", "Hakan", "Serkan", "Gizem", "Yusuf", "İlker",
  "Volkan", "Seda", "Barış", "Can", "Derya", "Ferhat", "Gökhan", "Hande", "İrem", "Kaan", "Levent", "Melis", "Nazlı",
  "Ozan", "Pelin", "Rana", "Sinan", "Tuba", "Umut", "Yasin", "Zeynep", "Bora", "Cansu", "Duygu", "Erdem", "Fatih",
  "Gamze", "Halil", "Işıl", "Koray", "Merve", "Nihat", "Orhan", "Sevgi", "Taner", "Ufuk", "Yeliz",
];
export const HAVUZ_SOYAD = [
  "Yılmaz", "Kaya", "Demir", "Çelik", "Arslan", "Doğan", "Kılıç", "Aydın", "Öztürk", "Yıldırım", "Aksoy", "Polat",
  "Erdem", "Kurt", "Özdemir", "Aslan", "Çetin", "Kara", "Korkmaz", "Güneş", "Tekin", "Bulut", "Ünal",
  "Acar", "Kaplan", "Bozkurt", "Toprak", "Karaca", "Uçar", "Sezer", "Ateş", "Erdoğdu", "Tuncer", "Duman", "Bayram",
];
const HAVUZ_KATLI = new Set([...HAVUZ_MARKA, ...HAVUZ_AD, ...HAVUZ_SOYAD].map(katla));
export const havuzdanMi = (kelime) => HAVUZ_KATLI.has(katla(kelime));

/**
 * Sözlük kur. Girdi: kişi adları (son kelime soyad sayılır) ve firma adları. Çıktı:
 *   kelime: Map(katla(kelime) → takma kelime)  ·  ifade: Map(TAM ad → yeni ad)  ·  yeniAd(eski) → yeni
 * Havuz kelimesi zaten takma addır (ikinci koşum) → eşlenmez. Atama sıralı + çakışmasız ⇒ belirlenimli.
 */
export function sozlukKur({ kisiAdlari = [], firmaAdlari = [] }) {
  const kelime = new Map();
  const kullanilan = new Set();
  const ata = (k, havuz, tur) => {
    const kk = katla(k);
    if (kelime.has(kk) || GENEL_KELIMELER.has(kk) || HAVUZ_KATLI.has(kk)) return;
    let i = ozet32(tur, kk) % havuz.length;
    for (let n = 0; n < havuz.length && kullanilan.has(katla(havuz[i])); n++) i = (i + 1) % havuz.length;
    if (kullanilan.has(katla(havuz[i]))) throw new Error(`havuz tükendi (${tur}) — havuzu genişlet`);
    kullanilan.add(katla(havuz[i]));
    kelime.set(kk, havuz[i]);
  };
  const siraliKisi = [...new Set(kisiAdlari.filter(Boolean))].sort();
  for (const ad of siraliKisi) {
    const ks = kelimeler(ad);
    ks.forEach((k, i) => ata(k, i === ks.length - 1 && ks.length > 1 ? HAVUZ_SOYAD : HAVUZ_AD, i === ks.length - 1 && ks.length > 1 ? "soyad" : "ad"));
  }
  const siraliFirma = [...new Set(firmaAdlari.filter(Boolean))].sort();
  for (const ad of siraliFirma) for (const k of kelimeler(ad)) ata(k, HAVUZ_MARKA, "marka");
  const sozluk = { kelime, ifade: new Map() };
  // Tümü genel kelime olan ad (ör. "KALİTE LALELİ") kelime katmanında değişmez → TAM ad ifade sözlüğüne girer.
  for (const ad of [...siraliFirma, ...siraliKisi]) {
    if (metniDegistir(ad, sozluk) !== ad) continue;
    const ks = kelimeler(ad);
    if (ks.length === 0 || ks.some((k) => HAVUZ_KATLI.has(katla(k)))) continue;
    const ilk = ks.find((k) => !GENEL_KELIMELER.has(katla(k))) ?? ks[0];
    let i = ozet32("ifade", katla(ad)) % HAVUZ_MARKA.length;
    for (let n = 0; n < HAVUZ_MARKA.length && kullanilan.has(katla(HAVUZ_MARKA[i])); n++) i = (i + 1) % HAVUZ_MARKA.length;
    kullanilan.add(katla(HAVUZ_MARKA[i]));
    sozluk.ifade.set(ad, ad.replace(ilk, bicimle(ilk, HAVUZ_MARKA[i])));
  }
  return sozluk;
}

/**
 * Gerçek adda havuz kelimesi + havuz dışı ayırt edici parça BİRLİKTE varsa havuz kelimesi takma ad sanılıp korunur
 * (sızıntı). Tamamı havuz olan ad zaten takma addır (ikinci koşum) → çakışma değildir.
 */
export function havuzCakismalari(adlar) {
  const out = [];
  for (const ad of adlar) {
    const ks = kelimeler(ad).filter((k) => !GENEL_KELIMELER.has(katla(k)));
    if (ks.some(havuzdanMi) && ks.some((k) => !havuzdanMi(k))) out.push(...ks.filter(havuzdanMi));
  }
  return out;
}

/** Eşleşen metnin harf biçimini (TAMAMI BÜYÜK · tamamı küçük · Baş harf) takma ada uygula. */
export function bicimle(ornek, takma) {
  if (ornek === buyukTr(ornek) && ornek !== kucukTr(ornek)) return buyukTr(takma);
  if (ornek === kucukTr(ornek)) return kucukTr(takma);
  return basHarfTr(takma);
}

/**
 * Metindeki ifade ve kelimeleri takma adlarla değiştir. Kelime eşleşmesi katla() ile yapılır (büyük/küçük ve
 * ASCII katlama duyarsız); çıktı eşleşen metnin biçimini korur.
 */
export function metniDegistir(metin, sozluk) {
  if (typeof metin !== "string" || metin.length === 0) return metin;
  let s = metin;
  for (const [eski, yeni] of sozluk.ifade) if (s.includes(eski)) s = s.split(eski).join(yeni);
  if (sozluk.kelime.size === 0) return s;
  return s.replace(/[\p{L}\p{N}]+/gu, (w) => {
    const yeni = sozluk.kelime.get(katla(w));
    return yeni ? bicimle(w, yeni) : w;
  });
}

/** JSON değerinin her dizesine (anahtarlara değil) uygula. */
export function jsonDegistir(deger, fn) {
  if (typeof deger === "string") return fn(deger);
  if (Array.isArray(deger)) return deger.map((x) => jsonDegistir(x, fn));
  if (deger && typeof deger === "object") {
    const o = {};
    for (const [k, v] of Object.entries(deger)) o[k] = jsonDegistir(v, fn);
    return o;
  }
  return deger;
}

// ── Serbest metin kararı ─────────────────────────────────────────────────────────────────────────
/** Sistemin ÜRETTİĞİ metin kalıpları — kişi yazmadı, korunur (ör. RETURNED_VIA_RECEIPT:FK123, DISPATCH:FS0810260020). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SISTEM_KODU = /^[A-Z0-9_:#|.,\-—() ]+$/;
/**
 * TR telefon deseni (cep 5xx, +90/0 önekli, boşluk/tire ayraçlı). Harf, rakam ya da tireye YAPIŞIK dizi telefon
 * sayılmaz: UUID parçası ("…-4a05…"), önekli belge/barkod kodu ("FK05…", "T26…") yanlış pozitiftir. UUID'ler önce atılır.
 */
export const TELEFON_DESENI = /(?<![\p{L}\p{N}-])(?:\+?90[ -]?)?0?5\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?![\p{L}\p{N}-])/gu;
export const telefonlar = (s) => String(s ?? "").replace(UUID, " ").match(TELEFON_DESENI) ?? [];
export const telefonIceriyorMu = (s) => telefonlar(s).length > 0;
export function sistemMetniMi(s) {
  const t = String(s).replace(UUID, "");
  return SISTEM_KODU.test(t) && (/[A-Z]+_[A-Z]+/.test(t) || /^[A-Z]{3,}[A-Z0-9_]*:/.test(t));
}
/** Serbest metinde YAYGIN ve kimliksiz kelimeler (havuz ifadeleri + iş dili). Katalog kelimeleri çalışmada eklenir. */
export const ORTAK_KELIMELER = new Set(`
kod not açıklama sevk sevki sevkiyat geri alındı alınmış iade top topu toplar metre metraj kabul kabulü kabulünde fason fasona
kesim payı makas düşüldü döndü doldu tartı içerik değişti önceki iptal iptali edildi yanlış müşteri iş emri emirlerinin sipariş
siparişi ürün renk seçildi girildi mükerrer giriş aynı iki kez kaydedildi deneme eğitim kaydı diğer fiziksel olarak yok hatalı
kayıt kayda girmemiş depoda barkodsuz kalmış tekrar alındı açılıp kontrol yapıldı sistem yapılmamış geçmiş vardiya tambur
metraj kaynak topa iade dönüşü ölçüldü boyut değişti talebi talebiyle doğrultusunda göre hazırlandı paketlendi bekliyor
devamı var ilave ilaveler olacak toplu gidecek grubu paket grup etiket etiketi numune fazla eksik kalite kusur leke
düzeltildi düzeltme gecikme teslim tarihi ertelendi planlandı onaylandı tamamlandı yeniden basıldı basım belge yazıcı
hata nedeniyle sevkiyat ayrı ayrıldı birleştirildi kumaş en gramaj boyahane renk farkı ton tonu kartela kartelası
alması açıldı çuval çuvalı gönderilecek gönderildi kumaşlar altı üstü adet mt kg kalan tamam\nstandart özel hızlı acil öncelikli normal ve ile için bir ilk son yeni eski üretim hat makine tezgah çözgü atkı levent
`.trim().split(/\s+/).map(katla));

/**
 * Serbest metin korunur mu? Korunur: boş · sistem kalıbı · harf parçası olmayan (kod/sayı) · tüm ≥3 harfli
 * kelimeleri sözlükte (ortak + katalog). Aksi hâlde kişi/firma adı taşıyabilir ⇒ havuz ifadesiyle değişir.
 */
export function serbestMetinKorunurMu(s, katalogKelimeleri = new Set()) {
  return serbestMetinKarari(s, katalogKelimeleri) === null;
}
const bilinen = (k, katalog) => ORTAK_KELIMELER.has(katla(k)) || katalog.has(katla(k)) || GENEL_KELIMELER.has(katla(k)) || havuzdanMi(k);
const kimliksizMi = (s, katalog) => String(s).replace(UUID, " ").split(/[^\p{L}]+/u).filter((k) => k.length >= 3).every((k) => bilinen(k, katalog));
/**
 * null = korunur; aksi hâlde değişim ÖNEKİ ('' ya da sistem kodu öneki "WO_CANCEL_CANCELLED:"): sistem önekli
 * metinde yalnız kişinin yazdığı kuyruk değişir, makinenin okuduğu önek kalır.
 */
export function serbestMetinKarari(s, katalog = new Set()) {
  if (s == null || String(s).trim() === "") return null;
  // Telefon taşıyan metin sistem kalıbı/harfsiz olsa da korunmaz (eski sürümler sebep kuyruğunu önekle birleştirirdi).
  const tel = telefonIceriyorMu(s);
  if (!tel && (sistemMetniMi(s) || kimliksizMi(s, katalog))) return null;
  const m = /^([A-Z][A-Z0-9_]{2,}:)(.*)$/s.exec(String(s));
  if (m && !telefonIceriyorMu(m[2]) && kimliksizMi(m[2], katalog)) return null;
  return m ? m[1] + " " : "";
}

export const IFADE_HAVUZLARI = {
  NOT: ["Müşteri talebine göre paketlendi", "Standart kontrol yapıldı", "Teslim tarihi ertelendi", "Numune ayrıldı",
    "Kalite kontrol bekliyor", "Acil sevk", "Toplu sevk", "Devamı var"],
  SEBEP: ["Müşteri talebi", "Yanlış kayıt", "Kalite kusuru", "Ölçü farkı", "Plan değişti", "Mükerrer kayıt"],
  IPTAL: ["Yanlış kayıt — iptal edildi", "Müşteri talebiyle iptal edildi", "Plan değişti — iptal edildi"],
  TALIMAT: ["Standart işlem", "Renk tonuna dikkat", "Kenar kontrolü yapılsın", "Acil — öncelikli"],
  ACIKLAMA: ["Standart açıklama", "Genel kayıt"],
  ETIKET: ["Paket Grubu"],
};
for (const h of Object.values(IFADE_HAVUZLARI)) for (const i of h) for (const k of kelimeler(i)) ORTAK_KELIMELER.add(katla(k));

/** Kolon adından havuz türü (kolon adı = sözleşme; tahmin değil, ad kalıbı). */
export function havuzTuru(kolon) {
  if (/cancel|void|revoke|unlink/i.test(kolon)) return "IPTAL";
  if (/reason/i.test(kolon)) return "SEBEP";
  if (/instruction/i.test(kolon)) return "TALIMAT";
  if (/description/i.test(kolon)) return "ACIKLAMA";
  if (/^name$/i.test(kolon)) return "ETIKET";
  return "NOT";
}
export function ifadeSec(kolon, eski) {
  const h = IFADE_HAVUZLARI[havuzTuru(kolon)];
  return h[ozet32("ifade", kolon, eski) % h.length];
}

// ── Sahte iletişim/kimlik değerleri (biçimce geçerli; panel doğrulamasından geçer) ────────────────
const rakam = (tohum, n) => {
  let out = "";
  for (let i = 0; out.length < n; i++) out += String(ozet32(tohum, i)).padStart(10, "0");
  return out.slice(0, n);
};
export const sahteTelefon = (tohum) => `0212 555 ${rakam("tel" + tohum, 2)} ${rakam("tel2" + tohum, 2)}`;
export const sahteEposta = (tohum) => `iletisim${rakam("ep" + tohum, 4)}@ornek-firma.example`;
export const sahteVergiNo = (tohum) => "9" + rakam("vkn" + tohum, 9);
const ILLER = [["İstanbul", "Bağcılar"], ["İstanbul", "Esenyurt"], ["Bursa", "Nilüfer"], ["Bursa", "Osmangazi"], ["Denizli", "Merkezefendi"],
  ["Kayseri", "Kocasinan"], ["Gaziantep", "Şehitkamil"], ["Uşak", "Merkez"]];
export const sahteIl = (tohum) => ILLER[ozet32("il" + tohum) % ILLER.length];
export function sahteAdres(tohum) {
  const [il, ilce] = sahteIl(tohum);
  return `Organize Sanayi Bölgesi ${1 + (ozet32("cd" + tohum) % 9)}. Cadde No:${1 + (ozet32("no" + tohum) % 140)} ${ilce}/${il}`;
}
export const sahteVergiDairesi = (tohum) => `${sahteIl(tohum)[1]} Vergi Dairesi`;
/** Biçimce geçerli TR IBAN (mod-97 kontrol hanesi doğru): TR + kk + 5 hane banka + 0 + 16 hane hesap. */
export function sahteIban(tohum) {
  const bban = "00099" + "0" + rakam("iban" + tohum, 16);
  let kalan = 0;
  for (const c of bban + "292700") kalan = (kalan * 10 + Number(c)) % 97;
  const kk = String(98 - kalan).padStart(2, "0");
  return `TR${kk}${bban}`;
}
export function ibanGecerliMi(iban) {
  const s = iban.replace(/\s/g, "");
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let kalan = 0;
  for (const c of r) kalan = (kalan * 10 + Number(c)) % 97;
  return kalan === 1;
}

/**
 * Kişisel/iletişim kolonu → üreteç. Kolon kümesi şemadan bu desenle TÜRETİLİR (bkz. anonimlestir.mjs);
 * desen kolon ADINA bakar — değer tahmini yok. null döndüren tür: kolon kişisel değil.
 */
export function kisiselKolonTuru(kolon) {
  if (/^(phone|mobile|fax|gsm)$|Phone$|Mobile$|Fax$/.test(kolon)) return "TELEFON";
  if (/^email$|Email$/.test(kolon)) return "EPOSTA";
  if (/^taxNumber$|TaxNumber$|^taxNo$|^tckn$|^identityNo$|^mersisNo$/.test(kolon)) return "VERGI_NO";
  if (/^taxOffice$|TaxOffice$/.test(kolon)) return "VERGI_DAIRESI";
  if (/^iban$|Iban$/.test(kolon)) return "IBAN";
  if (/^address$|Address$|^addressLine\d?$/.test(kolon)) return "ADRES";
  if (/^district$/.test(kolon)) return "ILCE";
  if (/^city$/.test(kolon)) return "IL";
  if (/^contactName$|^drawerName$|^driverName$|^accountHolder(Name)?$|^holderName$|^contactPerson$/.test(kolon)) return "KISI_ADI";
  if (/^plateNumber$|^plate$|^vehiclePlate$/.test(kolon)) return "PLAKA";
  return null;
}
export function sahteDeger(tur, tohum, eski, sozluk) {
  switch (tur) {
    case "TELEFON": return sahteTelefon(tohum);
    case "EPOSTA": return sahteEposta(tohum);
    case "VERGI_NO": return sahteVergiNo(tohum);
    case "VERGI_DAIRESI": return sahteVergiDairesi(tohum);
    case "IBAN": return sahteIban(tohum);
    case "ADRES": return sahteAdres(tohum);
    case "ILCE": return sahteIl(tohum)[1];
    case "IL": return sahteIl(tohum)[0];
    case "PLAKA": return `${String(10 + (ozet32("pl" + tohum) % 70)).padStart(2, "0")} DV ${rakam("pl2" + tohum, 3)}`;
    case "KISI_ADI": {
      const ks = kelimeler(eski);
      if (ks.length && ks.every(havuzdanMi)) return eski;
      return `${HAVUZ_AD[ozet32("ka" + tohum) % HAVUZ_AD.length]} ${HAVUZ_SOYAD[ozet32("ks" + tohum) % HAVUZ_SOYAD.length]}`;
    }
    default: throw new Error(`bilinmeyen kişisel tür ${tur}`);
  }
}
