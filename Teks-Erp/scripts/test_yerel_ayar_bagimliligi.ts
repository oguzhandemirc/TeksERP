// =============================================================================
// YEREL AYAR BAĞIMLILIĞI — süreç locale'i bir BİÇİM kararı değildir
// =============================================================================
// NEDEN VAR: `test_latency_persist`in üç saatlik penceresi (süreç SAAT DİLİMİ)
// bir ailenin ilk üyesiydi; bu, ikinci ekseni — süreç YEREL AYARI — kapıya
// bağlar. CI runner'ın locale'i `C`/en-US, fabrika sunucusu tr-TR ⇒ argümansız
// bir `toLocaleString()` iki ortamda İKİ FARKLI metin üretir ("9.999,99" ↔
// "9,999.99", "14.09.2026" ↔ "9/14/2026") ve bunu hiçbir yerde yazmaz.
//
// ⚠️ ÖLÇTÜM VE HİPOTEZ ÇÜRÜDÜ (2026-09-14, 2985 dosya: `Teks-Erp/src` +
// `Teks-Erp/scripts` + `Electron/src` + `mobil/src`):
//   · ÜRÜN yollarında argümansız çağrı: **0**. Bulunan 16 eşleşmenin 2'si zaten
//     *"`toLocaleDateString()` KULLANMA"* diyen YORUM (Electron sınıfı biliyor),
//     14'ü `Teks-Erp/scripts/` altında `console.log` binlik ayracı.
//   · Kimliğe uygulanan Türkçe locale: 22 site, **hepsi SİMETRİK** — yazan ile
//     okuyan aynı katlamayı kullanıyor (`import.service.ts:248` ↔ 16 adaptör;
//     arama yüzeylerinde needle ve haystack aynı) ⇒ kök kuralın i/İ tuzağı
//     tetiklenmiyor. Kusur BUGÜNKÜ kodda değil, gelecekteki TEK YANLI bir
//     düzenlemede olurdu.
//   · Locale'siz `localeCompare`: 29 site, hepsi ASCII değer (para birimi kodu,
//     enum, ISO damga, UUID) ⇒ sıralama locale'den bağımsız.
// ⇒ Bu kapı bir borcu kapatmıyor, TEMİZ bir ekseni KİLİTLİYOR: §1 bugün SIFIR
//   borçla SERTTİR ve öyle kalması ölçülür. *Borçsuz kurulan kapı en ucuz kapıdır.*
//
// TEK KAYNAK: locale ASLA örtük bırakılmaz. Tarih/saat/sayı biçimi için açık
// locale ya da fabrika yardımcısı (`src/constants/time.ts`); kimlik katlaması
// için kanonik `"tr-TR"` (1e hükmü 2026-09-14) ve tek bir katlama yardımcısı.
//
// Koşum: npx tsx scripts/test_yerel_ayar_bagimliligi.ts   (DB GEREKMEZ)
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const REPO = path.resolve(__dirname, "..", "..");
const KAPSAM = ["Teks-Erp/src", "Teks-Erp/scripts", "Electron/src", "mobil/src"];
/** Ürün DEĞİL, geliştirici aleti: konsol çıktısı sahaya gitmez. */
const ALET_ONEKI = "Teks-Erp/scripts/";

/**
 * ARGÜMANSIZ locale çağrısı = süreç yerel ayarına örtük bağımlılık.
 * `toLocaleString("tr-TR")` bunun KARŞITIDIR ve sayılmaz — TZ ekseninde
 * `getUTCFullYear()` neyse, burada açık locale odur: karar BEYAN EDİLMİŞTİR.
 */
const ARGUMANSIZ =
  /(toLocaleDateString|toLocaleTimeString|toLocaleString|toLocaleUpperCase|toLocaleLowerCase)\(\s*\)|new Intl\.[A-Za-z]+\(\s*(\)|undefined)/;
/** Ham katlama çağrısı — yardımcıya alınmamış her `toLocale*Case`. */
const HAM_FOLD = /toLocale(Upper|Lower)Case\(/g;

export type Bulgu = { urunArgumansiz: string[]; aletArgumansiz: string[]; hamFold: number; dosya: number };

/** Satırdaki kodu yorumlardan arındırır (blok gövdesi + satır sonu yorumu). */
export function koduAyikla(satir: string): string | null {
  if (/^\s*\*/.test(satir)) return null;
  return satir.replace(/\/\/.*$/, "");
}

export function argumansizMi(satir: string): boolean {
  const kod = koduAyikla(satir);
  return kod !== null && ARGUMANSIZ.test(kod);
}

/** Taranan dosyalar — ENVANTER ÖLÇÜLÜR; `--others` ile İZLENMEYENLER de dahil. */
export function taranacakDosyalar(repo: string): string[] {
  // ⚠️ `--cached --others --exclude-standard`: çıplak `ls-files` yalnız index'i
  // verir ve HENÜZ `git add` edilmemiş yeni bir dosyanın ihlali GÖRÜNMEZ. Bu
  // sınıf iki kez ısırdı (2026-09-14: 5e'nin `test_belge_capa_atfi`si yeni bir
  // `.md`yi hiç görmedi; benim gün-anahtarı kapım kendi sondamı görmedi).
  // ⛔ Ve körlük zemini bunu GÖREMEZ: kapsam boş değil, yalnız EKSİK.
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", ...KAPSAM], {
    cwd: repo,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f))
    // ⚠️ ARAÇ, GÖZLEDİĞİ KÜMENİN İÇİNDE OLAMAZ: §3 sondaları deseni ÖRNEK olarak
    // taşımak zorunda. Muafiyet kapsam daraltması değil, ÖLÇÜM KOŞULUDUR.
    .filter((f) => !f.endsWith("scripts/test_yerel_ayar_bagimliligi.ts"));
}

export function tara(repo: string): Bulgu {
  const urunArgumansiz: string[] = [];
  const aletArgumansiz: string[] = [];
  let hamFold = 0;
  const dosyalar = taranacakDosyalar(repo);
  for (const f of dosyalar) {
    const alet = f.startsWith(ALET_ONEKI);
    readFileSync(path.join(repo, f), "utf8")
      .split("\n")
      .forEach((l, i) => {
        const kod = koduAyikla(l);
        if (kod === null) return;
        if (ARGUMANSIZ.test(kod)) (alet ? aletArgumansiz : urunArgumansiz).push(`${f}:${i + 1}`);
        hamFold += [...kod.matchAll(HAM_FOLD)].length;
      });
  }
  return { urunArgumansiz, aletArgumansiz, hamFold, dosya: dosyalar.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// TABANLAR — ölçüldü 2026-09-14. ⛔ Bu sabitleri ölçen oturum DÜŞÜRMEZ; düşüşü
// yönetici oturum tren sonunda birleşik ağaçta yazar (kadro kuralı 2026-09-13).
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `Teks-Erp/scripts/` altındaki argümansız çağrılar: `bench_audit_summary` ·
 * `scale_report` · `seed-load-scale` içindeki `console.log` binlik ayraçları.
 * GEREKÇE: geliştirici konsolu — sahaya gitmez, saklanmaz, karşılaştırılmaz.
 */
const ALET_TABAN = 14;
/**
 * Ham `toLocale*Case` çağrı sayısı.
 * ⚠️ BU BİR KUSUR SAYISI DEĞİL, BİR **YARDIMCISIZLIK** SAYISIDIR — stok
 * defterinin `K_TABAN`ı gibi okunur. Bugün 113 çağrı simetriyi ELLE koruyor ve
 * iki yazım yan yana yaşıyor (`"tr"` 39 · `"tr-TR"` 68, ölçüldü 2026-09-14).
 * Katlama tek bir yardımcıya alındıkça (kanonik `"tr-TR"`, 1e hükmü) bu sayı
 * 113 → 0 düşer; 0'da bu cırcır SERT'e çevrilir ve "iki yan aynı mı katlıyor"
 * sorusu YAPISAL olarak kapanır — elle tutulan bir çift listesiyle değil.
 */
const HAM_FOLD_TABAN = 113;

function main(): void {
  console.log("\n=== Yerel ayar bağımlılığı (süreç locale'i) ===\n");
  const b = tara(REPO);

  // ── §0 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  console.log("§0 — körlük zemini");
  check("§0a taranan dosya sayısı makul", b.dosya > 2000, `${b.dosya} .ts/.tsx`);
  check("§0b desen GERÇEKTEN eşleşiyor (tarayıcı ölü değil)", b.hamFold > 0, `${b.hamFold} ham katlama`);
  console.log("");

  // ── §1 SERT — ürün yolunda örtük locale YOK ────────────────────────────────
  console.log("§1 — ÜRÜN yolunda argümansız locale çağrısı (SERT, taban 0)");
  check(
    "§1 ⭐ ürün yollarında örtük locale YOK",
    b.urunArgumansiz.length === 0,
    b.urunArgumansiz.length === 0
      ? "0 çağrı (Teks-Erp/src · Electron/src · mobil/src)"
      : `${b.urunArgumansiz.join(" · ")} ⇒ locale'i AÇIKÇA ver ("tr-TR") ya da fabrika ` +
          "yardımcısını kullan. ⛔ Bu kapı borçsuz kuruldu, muafiyeti YOK",
  );
  console.log("");

  // ── §2 CIRCIR — geliştirici aletlerindeki konsol çıktısı ───────────────────
  console.log("§2 — geliştirici aletleri (Teks-Erp/scripts) cırcırı");
  check(
    "§2a ARTMADI",
    b.aletArgumansiz.length <= ALET_TABAN,
    b.aletArgumansiz.length <= ALET_TABAN
      ? `${b.aletArgumansiz.length} ≤ ${ALET_TABAN} · gerekçe: geliştirici konsolu`
      : `${b.aletArgumansiz.length} > ${ALET_TABAN} ⇒ YENİ örtük locale eklendi`,
  );
  check(
    "§2b ⭐ taban ÇÜRÜMEDİ (düştüyse sabiti yönetici indirir)",
    b.aletArgumansiz.length >= ALET_TABAN,
    b.aletArgumansiz.length >= ALET_TABAN ? `${b.aletArgumansiz.length}` : `${b.aletArgumansiz.length} < ${ALET_TABAN}`,
  );
  console.log("");

  // ── §3 CIRCIR — yardımcısız ham katlama ───────────────────────────────────
  console.log("§3 — ham `toLocale*Case` (YARDIMCISIZLIK sayısı, kusur değil)");
  check(
    "§3a ARTMADI",
    b.hamFold <= HAM_FOLD_TABAN,
    b.hamFold <= HAM_FOLD_TABAN ? `${b.hamFold} ≤ ${HAM_FOLD_TABAN}` : `${b.hamFold} > ${HAM_FOLD_TABAN} ⇒ yeni ham katlama`,
  );
  check(
    "§3b ⭐ taban ÇÜRÜMEDİ (düştüyse sabiti yönetici indirir)",
    b.hamFold >= HAM_FOLD_TABAN,
    b.hamFold >= HAM_FOLD_TABAN ? `${b.hamFold}` : `${b.hamFold} < ${HAM_FOLD_TABAN} ⇒ yardımcıya taşındı, sabiti indir`,
  );
  console.log("");

  // ── §4 SONDALAR — sınıflandırıcının kendisi ───────────────────────────────
  console.log("§4 — sondalar (sınıflandırıcı)");
  check("§4a ⭐ argümansız çağrı YAKALANIR", argumansizMi("const s = n.toLocaleString();"));
  check(
    "§4b ⭐ AÇIK locale sayılmaz (karşıt sınıf)",
    !argumansizMi('const s = n.toLocaleString("tr-TR");'),
    "TZ ekseninde getUTCFullYear neyse, burada açık locale odur",
  );
  check("§4c argümansız Intl YAKALANIR", argumansizMi("const f = new Intl.NumberFormat();"));
  check("§4d `undefined` locale de örtüktür", argumansizMi("const f = new Intl.NumberFormat(undefined);"));
  check("§4e açık locale'li Intl sayılmaz", !argumansizMi('const f = new Intl.NumberFormat("tr-TR");'));
  check("§4f satır-sonu yorumu sayılmaz", !argumansizMi("const x = 1; // n.toLocaleString() kullanma"));
  check("§4g blok yorumu gövdesi sayılmaz", !argumansizMi(" * ⚠️ `toLocaleDateString()` KULLANMA"));
  check("§4h locale'siz olmayan satır temiz", !argumansizMi("const s = fmtFactoryDate(d);"));
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
