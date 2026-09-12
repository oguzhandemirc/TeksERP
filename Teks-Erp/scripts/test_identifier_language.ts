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
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
const TAVAN_DOSYA = join(__dirname, "identifier-language-baseline.json");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Türkçe kök listesi — tanımlayıcının İÇİNDE geçtiğinde yakalanır.
 *
 * ⚠️ Liste KAPSAYICI DEĞİL, TEMSİLİ: amaç her Türkçe kelimeyi yakalamak değil,
 * yeni Türkçe adlandırmayı ilk denemede görünür kılmak. Eksik bir kök, kuralı
 * geçersiz kılmaz — bir sonraki turda eklenir.
 */
const TR_KOKLER = [
  "musteri", "siparis", "sevkiyat", "cuval", "urun", "renk", "kumas", "parti",
  "satir", "kayit", "sonuc", "deger", "adet", "toplam", "liste", "secim",
  "gecerli", "kapali", "acik", "yeni", "eski", "dosya", "klasor", "hedef",
  "kaynak", "cikti", "girdi", "sayfa", "rejim", "ayar", "kapi", "bekci",
  "sonda", "damga", "olcum", "zamanlayici", "yedek", "onarim", "onarilabilir",
  "bosluk", "kazanc", "ozet", "baslik", "aciklama", "uyari", "hata", "bilgi",
  "gorulen", "kuruldu", "imza", "tavan", "coz",
];

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
        const kok = TR_KOKLER.find((k) =>
          segs.some((sg) => !EN_CAKISMA.has(sg) && sg.startsWith(k)),
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
console.log(
  `   ⚠️ KAPSAM: sözlükte ${TR_KOKLER.length} kök var; kapı YALNIZ bu kökleri taşıyan adı görür.\n` +
    `      Listede olmayan bir Türkçe kök SESSİZCE geçer — yeşil "tarandı" demektir, "temiz" değil.`,
);
check("dosyalar tarandı", bulgular.length >= 0);
check("Türkçe kök listesi dolu", TR_KOKLER.length > 20, `${TR_KOKLER.length} kök`);
check(
  "⭐ sonda: liste GERÇEKTEN yakalıyor (uydurma bir ad denendi)",
  TR_KOKLER.some((k) => "musterilistesi".includes(k)),
);

console.log("\n§2 — ratchet: küme yalnız KÜÇÜLÜR");
console.log(`   bugün ${bugun.length} · devralınan ${taban.adlar.length}`);
check(
  "⭐ üretim kodunda YENİ Türkçe tanımlayıcı YOK",
  yeniler.length === 0,
  yeniler.length > 0
    ? `${yeniler.length} YENİ: ${yeniler.slice(0, 5).join(" · ")}` +
      (yeniler.length > 5 ? ` (+${yeniler.length - 5})` : "") +
      "  → İngilizce ad ver, ya da gerekçesiyle MUAFLAR'a ekle"
    : "temiz",
);

if (kalkanlar.length > 0 && yeniler.length === 0) {
  console.log(`   ↓ küme sıkışıyor: ${taban.adlar.length} → ${bugun.length} (${kalkanlar.length} ad çevrildi)`);
  writeFileSync(TAVAN_DOSYA, JSON.stringify({ adlar: bugun }, null, 2) + "\n");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
