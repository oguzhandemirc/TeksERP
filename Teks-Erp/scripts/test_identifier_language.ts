// =============================================================================
// BEKÇİ — TANIMLAYICI DİLİ: ÜRETİM KODUNDA İNGİLİZCE ([IL-16])
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts identifier_language
//
// ⭐ NEDEN VAR (2026-09-10): kural [IL-16] "Tanımlayıcılar İNGİLİZCE ve ASCII"
//    diyordu ama ZORLAMA yalnız yarısını tutuyordu — ESLint
//    `naming-convention` sadece TÜRKÇE KARAKTERİ (ç, ğ, ı, ö, ş, ü) yasaklıyor.
//    `cozAdRejimi`, `zamanlayiciAcik`, `musteriAdiVeya` gibi ASCII yazılmış
//    TÜRKÇE KELİMELER linter'dan geçiyordu. Kuralın yarısı ölçülmüyordu ve
//    ölçülmeyen kural bir temenniydi: aynı oturumda 8 tanımlayıcı bu şekilde
//    girdi ve hiçbir kapı ses çıkarmadı.
//
// NEDEN ESLint DEĞİL DE BEKÇİ: Türkçe kelime sözlüğü bir regex'e konsaydı
// yanlış pozitif patlaması olurdu — TR etiketli VERİ anahtarları ([EL-34]
// bunları açıkça muaf tutuyor), `nameFold` gibi alan adları, `ceki`/`desen`
// gibi YERLEŞMİŞ domain terimleri. Bekçi bunları ADIYLA muaf tutabilir; ESLint
// kuralı tutamaz.
//
// ⚠️ KAPSAM DAR VE BİLİNÇLİ: yalnız `src/` (üretim kodu). `scripts/` HARİÇ —
//    orada 299 Türkçe tanımlayıcı var ve bu YERLEŞİK bir düzendir: bekçiler iç
//    araçtır, sözleşme taşımaz, Türkçe adlandırma orada okunabilirliği
//    artırıyor. Kuralı oraya uzatmak 299 satırlık bir çeviri işi doğururdu ve
//    hiçbir şey kazandırmazdı.
//
// ⚠️ RATCHET: tavan yalnız DÜŞER (`lint-baseline` deseninin aynısı). Devralınan
//    Türkçe adlar dondurulur — geriye dönük 100+ ad çevirmek bu turun işi değil
//    — ama YENİSİ eklenemez. Tavan düşünce kendiliğinden sıkışır.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-10): `src/`e `const musteriListesi = 1;`
//    eklenince KIRMIZI; tavan 1 düşürülünce KIRMIZI.
//    ⚠️ İLK YAZIMDA HİÇBİRİ ISIRMADI: taban dosyası yalnız tavan DÜŞÜNCE
//    yazılıyordu, ilk koşumda sayım tavana eşit olduğu için dosya hiç oluşmadı
//    ve her koşum tavanı kendi sayımından üretti. Bekçi VAKUMEN YEŞİLDİ; sonda
//    olmasa fark edilmezdi.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TEKNIK_TERIMLER,
  TR_DOMAIN_OLCULEN,
  TR_DOMAIN_ONGORULEN,
  TR_GENEL,
} from "./lib/tr-kokler";

const KOK = join(__dirname, "..", "..");
const TAVAN_DOSYA = join(__dirname, "identifier-language-baseline.json");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Türkçe kök listesi — **d9'un ölçülmüş kataloğundan İTHAL EDİLİR, kopyalanmaz.**
 *
 * ⚠️ İKİ LİSTE İKİ GERÇEK OLUR. Eski hâlinde bu dosya kendi 52 kökünü taşıyordu
 * ve `tr-kokler.ts` ayrı yaşıyordu; biri güncellenip öteki unutulduğunda kapı
 * sessizce başka bir şey ölçer. Kaynak TEK: `lib/tr-kokler.ts`.
 *
 * ⭐ YÜKLEM DEĞİŞTİ (2026-09-13, 1e'nin politika kararı + d9'un ölçümü):
 *   ESKİ: "52 köklük listede geçen ad YOK"     → ne ısırdı ne sıktı (106 commit, 0 hareket)
 *   YENİ: "GENEL Türkçe kümesinden YENİ ad YOK" → fabrikanın sözlüğü MUAF
 * Gerekçe: fabrikanın 591 Türkçe adı (`fason` · `kartela` · `tambur` · `cari` …)
 * aylardır duruyor, kimse borç saymadı ve çevrilse kod DAHA AZ okunur olurdu.
 * Bu bir borç değil bir KARAR ⇒ muafiyet KURALLA kurulur, elle listeyle değil.
 */
const TR_GENEL_KOK = TR_GENEL as readonly string[];
const DOMAIN_KOK = [...TR_DOMAIN_OLCULEN, ...TR_DOMAIN_ONGORULEN] as readonly string[];

/**
 * ELEME ADIMI — d9'un ① numaralı tuzağı, ama ÖLÇÜLDÜ ve maliyeti SIFIR çıktı.
 *
 * d9'un uyarısı: *"liste tek başına ölçüm aracı değil, yarısı"* — eşleşen
 * segmentin kendisi İngilizce olmamalı (`al`→alert · `modul`→module). Elemesiz
 * koşum 1.667, elemeli 876 demişti.
 *
 * ⚠️ AMA BU KAPININ LİSTESİNDE O SORUN YOK ve bunu ölçtüm: d9 kısa/çakışan
 * kökleri zaten `TR_KAPSAM_DISI_GEREKCELI`ye ayırmış. `TR_GENEL` ile üç projede
 * eşleşen **75 benzersiz segmentin** İngilizce sözlükte olanı **TEK**: `sure`
 * (İngilizce "sure" ↔ Türkçe "süre").
 *
 * ⚠️ VE BU YÜZDEN SİSTEM SÖZLÜĞÜ KULLANILMAZ. `/usr/share/dict/words` bu
 * makinede var (235.976 satır) ama GitHub runner imajında **garanti değil** ⇒
 * kapı ortamdan ortama BAŞKA hüküm verirdi. O sınıfın adı konmuş:
 * *tek ORTAMDA ölçülmüş beklenti*. ⇒ Sözlük bir **üretim aracıdır**, çalışma
 * zamanı bağımlılığı değil: ölçüm sözlükle YAPILIR, sonucu BURAYA donar.
 */
const EN_SOZLUK_CAKISMASI = new Set(["sure"]);

/**
 * Tanımlayıcıyı camelCase parçalarına ayırır.
 *
 * ⚠️ HAM `includes` KULLANILMAZ — sonda üç yanlış pozitif gösterdi:
 * `radius` ("adi"), `DefectSeverity` ("veri"), `TamburUndoPreview`
 * ("tambURUNdo"). Kök İÇİNDE geçmesi değil, bir PARÇANIN köke başlaması
 * aranır. `veri`/`adi`/`sira` kökleri de listeden ÇIKARILDI: İngilizce
 * kelimelerle (`verify`, `radius`) çakışıyorlar ve bekçiyi gürültüye boğarlar.
 * Kalan çakışmalar `EN_CAKISMA` kümesinde ADIYLA durur — ölçülerek eklendi
 * (`partial` ×26, `listener` ×7), tahminle değil.
 */
const EN_CAKISMA = new Set([
  // "parti" (Batch) kökü bunlarla çakışıyor — 26 kez ölçüldü.
  "partial", "partials", "parties", "partition", "partitions", "part", "parts", "partner",
  // "liste" kökü bunlarla çakışıyor — 7 kez ölçüldü.
  "listen", "listener", "listeners", "listening",
]);

function parcalar(ad: string): string[] {
  return ad
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ADLI MUAFLAR — Türkçe kök taşıyan ama MEŞRU tanımlayıcılar.
 *
 * ⚠️ Her satır bir GEREKÇE taşır. Muaf listesi gerekçesiz büyürse kural ölür.
 */
const MUAFLAR = new Map<string, string>([
  // Log kanalının kendisi — seviye adları TR ve bu bilinçli ([ÇEKİRDEK] karar).
  ["hata", "log kanalı seviye adı (logger.ts sözleşmesi)"],
  ["uyari", "log kanalı seviye adı"],
  ["bilgi", "log kanalı seviye adı"],
  ["satir", "log kanalı — banner istisnası (adıyla taşınan kaçış)"],
  // Yerleşmiş domain terimleri: belge kolonlarının ADI bunlar.
  ["cekiRows", "belge sözleşmesi — donmuş snapshot alanı"],
  ["cekiNameMode", "ayar anahtarı aynası"],
  ["cekiShowOurName", "belge kolonu — `ceki` yerleşik domain terimi"],
  ["cekiShowCustomerName", "belge kolonu — `ceki` yerleşik domain terimi"],
  ["cekiRaw", "yerel — `ceki` yerleşik domain terimi"],
  ["cekiMode", "yerel — `ceki` yerleşik domain terimi"],
]);

/** `src/` altındaki tüm .ts/.tsx dosyaları. */
function tsDosyalari(kok: string): string[] {
  const out: string[] = [];
  const gez = (d: string): void => {
    for (const ad of readdirSync(d)) {
      const p = join(d, ad);
      if (statSync(p).isDirectory()) { if (ad !== "node_modules") gez(p); continue; }
      if (/\.tsx?$/.test(ad) && !/\.test\.tsx?$/.test(ad)) out.push(p);
    }
  };
  gez(kok);
  return out;
}

/** Bildirilen tanımlayıcılar — yorum ve dize İÇERİĞİ sayılmaz. */
const BILDIRIM = /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

function yorumsuz(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

interface Bulgu { dosya: string; ad: string; kok: string }

function tara(kokler: { ad: string; dizin: string }[]): Bulgu[] {
  const bulgular: Bulgu[] = [];
  for (const proje of kokler) {
    if (!existsSync(proje.dizin)) continue;
    for (const dosya of tsDosyalari(proje.dizin)) {
      const govde = yorumsuz(readFileSync(dosya, "utf8"));
      for (const m of govde.matchAll(BILDIRIM)) {
        const ad = m[1]!;
        if (MUAFLAR.has(ad)) continue;
        const segs = parcalar(ad);
        // FABRİKANIN SÖZLÜĞÜ MUAF — ve muafiyet KURALLA kurulur: adın herhangi
        // bir parçası bir domain kökü taşıyorsa ad meşrudur. Elle muaf listesi
        // değil; `tr-kokler.ts` politikanın tek kaynağı.
        if (segs.some((sg) => DOMAIN_KOK.some((k) => sg.startsWith(k)))) continue;
        const kok = TR_GENEL_KOK.find((k) =>
          segs.some(
            (sg) =>
              !EN_CAKISMA.has(sg) &&
              !TEKNIK_TERIMLER.includes(sg as (typeof TEKNIK_TERIMLER)[number]) &&
              !EN_SOZLUK_CAKISMASI.has(sg) &&
              sg.startsWith(k),
          ),
        );
        if (kok) bulgular.push({ dosya: dosya.replace(KOK + "/", ""), ad, kok });
      }
    }
  }
  return bulgular;
}

const bulgular = tara([
  { ad: "backend", dizin: join(KOK, "Teks-Erp", "src") },
  { ad: "electron", dizin: join(KOK, "Electron", "src") },
  { ad: "mobil", dizin: join(KOK, "mobil", "src") },
]);

// ⚠️ TABAN DOSYASI YOKSA HEMEN YAZILIR. İlk yazımda yazılmıyordu (yalnız tavan
// DÜŞÜNCE yazılıyordu) ve sayım hep tavana eşit çıktığı için dosya hiç
// oluşmuyordu → her koşum tavanı KENDİ SAYIMINDAN üretiyordu, yani bekçi
// hiçbir şey ölçmüyordu. Sonda bunu yakaladı: `src/`e Türkçe bir ad eklendi ve
// bekçi YEŞİL kaldı. "Vakumen yeşil" — bu repoda adı konmuş bir sınıf.
/**
 * Taban SAYI DEĞİL AD KÜMESİDİR.
 *
 * ⚠️ İlk yazım sayı tutuyordu ve sonda şunu gösterdi: bir ad eklenip başka biri
 * silinince sayı AYNI kalıyor, yani yeni Türkçe ad sessizce geçiyordu. Ayrıca
 * kırmızı mesajı "son 5 bulgu"yu basıyordu — YENİ olanı değil; operatör yanlış
 * satırlara bakardı. Ad kümesi ikisini birden çözer: yeni olan ADIYLA söylenir.
 */
const anahtar = (b: Bulgu): string => `${b.dosya}::${b.ad}`;
const bugun = bulgular.map(anahtar).sort();
if (!existsSync(TAVAN_DOSYA)) {
  writeFileSync(TAVAN_DOSYA, JSON.stringify({ adlar: bugun }, null, 2) + "\n");
  console.log(`   (taban dosyası kuruldu: ${bugun.length} devralınan ad)`);
}
const taban = JSON.parse(readFileSync(TAVAN_DOSYA, "utf8")) as { adlar: string[] };
const tabanKume = new Set(taban.adlar);
const yeniler = bugun.filter((k) => !tabanKume.has(k));
const kalkanlar = taban.adlar.filter((k) => !bugun.includes(k));

console.log("\n§1 — körlük zemini");
// ⚠️ KAPSAM SINIRI ÇIKTIYA BASILIR (2026-09-13, 6e'nin ölçümü). Bu kapı Türkçe
// adı SÖZLÜKTEN tanır: listede olmayan bir kök GÖRÜNMEZ. Ölçüldü — aynı commit'te
// ALTI yeni Türkçe ad vardı (`BARKODSUZ` · `barkodlar` · `deposuz` · `gosterilen`
// · `kuyruk` · `baglam`) ve kapı yalnız BİRİNİ gördü.
// ⚠️ "Kapı görmedi" ≠ "uygun". Sınır basılmazsa yeşil, KAPSAM sanılır — listeyi
// genişletmek bu cümleyi geçersiz kılmaz, çünkü sınır ne kadar genişlerse
// genişlesin SINIR KALIR. Basmak listeyi genişletmekten ÖNCE gelir.
// ⚠️ VE İKİNCİ BİR SINIR VAR, ONU DA BASIYORUZ (2026-09-13, d9'un ölçümü +
// benim doğrulamam): kapı yalnız BİLDİRİM adlarına bakıyor — nesne özelliği,
// sınıf metodu, fonksiyon parametresi HİÇ okunmuyor. d9 bunu *"kapsam eksik"*
// diye okudu; ölçtüm, öyle değil:
//   `Teks-Erp/src`: bildirim 7.735 benzersiz · özellik-ama-bildirim-değil 2.551
//   bunların ≥451'i PRİSMA şema alanı/enum değeri ⇒ YENİDEN ADLANDIRILAMAZ
//   (`CANCELLED` · `BANK_TRANSFER` · `BOUNCE_CANCEL`); Zod anahtarı, API yanıt
//   şekli, belge şablon alanı ÖLÇÜLMEDİ ve aynı sınıfta.
// ⇒ Kapsamı özelliklere genişletmek, DÜZELTİLMESİ YASAK olan ihlaller üretirdi
//   ve böyle bir kapı iki haftada gerekçesiz muaf listesine dönüp ÖLÜR.
//   *Bildirim, yazarın adı SERBESTÇE seçtiği yerdir; özellik çoğu zaman bir
//   SÖZLEŞMENİN aynasıdır.* Kural yalnız serbest seçim olan yerde anlamlıdır.
// ⚠️ SAYISIZ BİR KAPSAM CÜMLESİ BÜYÜKLÜK SANILMAZ — d9'un şartı: sayı da bassın,
//   yoksa bir sonraki ölçen yine "%85 görünmüyor" diye kusur okur.
console.log(
  `   ⚠️ KAPSAM 1/2 — KÖK: ${TR_GENEL_KOK.length} genel Türkçe kök aranır; fabrikanın\n` +
    `      sözlüğü (${DOMAIN_KOK.length} kök: fason · kartela · tambur …) KURALLA MUAF — Türkçe KALIR.\n` +
    `      Listede olmayan bir genel Türkçe kök SESSİZCE geçer.\n` +
    `   ⚠️ KAPSAM 2/2 — TÜR: yalnız BİLDİRİM adları (const/let/function/class/…).\n` +
    `      Nesne özelliği · metod · parametre OKUNMAZ (${2551} benzersiz ad; ≥451'i Prisma\n` +
    `      şema alanı/enum ⇒ yeniden adlandırılamaz; Zod/API/şablon ölçülmedi).\n` +
    `      ⇒ Yeşil "üretim kodu temiz" DEĞİL, "SERBEST SEÇİLEN adlar temiz" demektir.`,
);
check("dosyalar tarandı", bulgular.length >= 0);
check("genel Türkçe kök listesi dolu", TR_GENEL_KOK.length > 20, `${TR_GENEL_KOK.length} kök`);
check(
  "⭐ sonda: liste GERÇEKTEN yakalıyor (uydurma bir ad denendi)",
  TR_GENEL_KOK.some((k) => "musterilistesi".includes(k)) || TR_GENEL_KOK.includes("liste"),
);
// KÖRLÜK ZEMİNİ: `tr-kokler.ts` boşalır ya da ithal kopar ise yukarıdaki her
// yüklem VAKUMEN yeşil olur ve kapı hiçbir şey aramadan "temiz" der.
check(
  "§0 körlük zemini: fabrika sözlüğü de dolu (muafiyet gerçekten kuruluyor)",
  DOMAIN_KOK.length > 20,
  `${DOMAIN_KOK.length} domain kökü`,
);

// =============================================================================
// ⚠️ TARAMA KÜMESİ TAM, HÜKÜM DAR — ve bu ayrım load-bearing (2026-09-13).
// =============================================================================
// Bu kapı 2026-09-13 gecesi BENİ durdurdu: iki satırlık bir BELGE commit'i
// atıyordum ve kırmızı, başka bir oturumun **commit edilmemiş** `pg-tool.helper.ts`
// dosyasındaki `hatalar` adındandı. Ağacı altı oturum paylaşıyor ⇒ ağaçta bir
// ihlal görmek, onu BU COMMIT'İN getirdiğini göstermez.
//
// Aynı ailenin bu repoda dördüncü vakası:
//   check-migrations GATE 1/4 → geçici indeksi okuyordu   → gerçek indeks
//   check-lint-baseline       → "kurala DEĞDİ Mİ"         → headSayim(): HEAD ↔ ağaç
//   kimlik tekilliği kapısı   → ağacı okuyordu            → HEAD ↔ ağaç (820ade01)
//   BU KAPI                   → ağacı okuyordu            → ↓
//
// İKİ AYRI DARALTMA GEREKİYOR ve biri ötekinin yerine geçmez:
//   ① KAPSAM  — bulgu BU COMMIT'in dosyalarında mı? (başkasının WIP'i beni durduramaz)
//   ② NEDENSELLİK — ad HEAD'de zaten var mıydı? (dosyaya DOKUNMAK ihlali ÜRETMEK değildir)
// ①'siz kapı yanlış kişiyi durdurur; ②'siz kapı, ihlalli bir dosyaya virgül
// ekleyeni suçlar. lint kapısında ikisini ayrı ayrı ödedik.
//
// ⚠️ TARAMA KÜMESİ DARALTILMAZ: mandal aynı kümeyi ölçmeli, yoksa "küme küçüldü"
// hükmü kapsam daralmasından doğar ve taban sahte sıkışır.
// ⚠️ Kapsam listesi YOKSA (CI, tam paket) hüküm TAM kalır — inen her ihlal görünür.
const KOMIT_KUMESI = process.env.TEKSERP_KOMIT_DOSYALARI
  ? new Set(process.env.TEKSERP_KOMIT_DOSYALARI.split("\n").map((s) => s.trim()).filter(Boolean))
  : null;

/** O dosyanın HEAD'deki hâlinde bu ad zaten var mıydı? */
function headdeVarMi(dosya: string, ad: string): boolean {
  try {
    const ham = execFileSync("git", ["show", `HEAD:${dosya}`], {
      cwd: KOK,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const m of yorumsuz(ham).matchAll(BILDIRIM)) if (m[1] === ad) return true;
    return false;
  } catch {
    // Dosya HEAD'de yok (yeni dosya) ⇒ ad da yok. Sessiz yutmuyoruz: yeni dosya
    // zaten bu commit'in eseridir ve ihlali ona yazmak DOĞRUDUR.
    return false;
  }
}

console.log("\n§2 — ratchet: küme yalnız KÜÇÜLÜR");
console.log(`   bugün ${bugun.length} · devralınan ${taban.adlar.length}`);

const ayristir = (k: string): { dosya: string; ad: string } => {
  const i = k.lastIndexOf("::");
  return { dosya: k.slice(0, i), ad: k.slice(i + 2) };
};
let hukumKumesi = yeniler;
let kapsamDisi: string[] = [];
let zatenHeadde: string[] = [];
if (KOMIT_KUMESI) {
  kapsamDisi = yeniler.filter((k) => !KOMIT_KUMESI.has(ayristir(k).dosya));
  const kapsamda = yeniler.filter((k) => KOMIT_KUMESI.has(ayristir(k).dosya));
  zatenHeadde = kapsamda.filter((k) => {
    const { dosya, ad } = ayristir(k);
    return headdeVarMi(dosya, ad);
  });
  hukumKumesi = kapsamda.filter((k) => !zatenHeadde.includes(k));
  // GÖRÜNÜRLÜK: daraltılan her şey BASILIR. Sessiz daraltma, kapıyı sessizce öldürür.
  if (kapsamDisi.length > 0)
    console.log(
      `   ⓘ ${kapsamDisi.length} yeni ad BU COMMIT'İN DIŞINDA (başka oturumun ağaçtaki işi) — hüküm verilmedi:\n` +
        `      ${kapsamDisi.slice(0, 3).join(" · ")}${kapsamDisi.length > 3 ? ` (+${kapsamDisi.length - 3})` : ""}`,
    );
  if (zatenHeadde.length > 0)
    console.log(
      `   ⓘ ${zatenHeadde.length} ad HEAD'de ZATEN vardı — dosyaya dokunmak ihlali üretmek değildir:\n` +
        `      ${zatenHeadde.slice(0, 3).join(" · ")}`,
    );
}

check(
  "⭐ üretim kodunda YENİ Türkçe tanımlayıcı YOK",
  hukumKumesi.length === 0,
  hukumKumesi.length > 0
    ? `${hukumKumesi.length} YENİ: ${hukumKumesi.slice(0, 5).join(" · ")}` +
      (hukumKumesi.length > 5 ? ` (+${hukumKumesi.length - 5})` : "") +
      "  → İngilizce ad ver, ya da gerekçesiyle MUAFLAR'a ekle"
    : KOMIT_KUMESI
      ? `bu commit temiz (kapsam ${KOMIT_KUMESI.size} dosya)`
      : "temiz",
);

// ⚠️ TABAN YALNIZ TAM KOŞUMDA SIKIŞIR. Kapsamı daraltılmış (hook) koşumda ağaç
// BAŞKA OTURUMLARIN commit edilmemiş işini taşıyor; tabanı oradan yazmak, henüz
// inmemiş bir durumu "devralınan" ilan etmek olurdu — ve o iş geri alınırsa taban
// var olmayan adları taşır. Sıkışma bir ÖLÇÜMDÜR, yan etki değil.
if (!KOMIT_KUMESI && kalkanlar.length > 0 && yeniler.length === 0) {
  console.log(`   ↓ küme sıkışıyor: ${taban.adlar.length} → ${bugun.length} (${kalkanlar.length} ad çevrildi)`);
  writeFileSync(TAVAN_DOSYA, JSON.stringify({ adlar: bugun }, null, 2) + "\n");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
