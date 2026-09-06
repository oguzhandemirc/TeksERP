// =============================================================================
// BEKÇİ ÇIKTI SÖZLEŞMESİ — META BEKÇİ (2026-09-06)
// =============================================================================
// NEDEN: koşucu (`run-all-tests.ts`) her bekçinin kaç kontrol koşturduğunu
// ÇIKTIDAN kazır; tanımadığı formatı sessizce "geçti (exit 0)" diye yazar. O
// satır yeşildir ama kontrol sayısını GİZLER — kontrol sayısı sıfıra düşse bile
// fark edilmez. Bu tam olarak reponun kovaladığı sınıf: sessiz yanlış-BAŞARI.
// 2026-09-06 ölçümü: iki dosya İngilizce `== N passed, M failed ==` basıyordu
// (test_manual_move_backflush, test_manual_move_qc_reversal) ve ikisi de özet
// tablosunda "geçti (exit 0)" görünüyordu — 14 kontrol görünmezdi.
//
// İKİNCİ ÖLÇÜ: "N atlandı" sayacı yalnız ÖZET SATIRINDA anlamlıdır. Serbest
// metindeki "atlandı" kelimesi koşucunun demirli regex'ine takılmaz; ama bir
// bekçi gerçekten kontrol atlıyorsa sayıyı özet satırında BEYAN ETMEK zorundadır
// yoksa "yeşil ≠ kapsandı" bandı o dosyayı hiç göstermez.
//
// KÖRLÜK ZEMİNİ: taranan dosya sayısı bir tabanın altına düşerse bekçi kırmızı
// verir — "0 ihlal" ile "hiç bakmadım" aynı yeşile çıkamaz.
//
// ÖLÇÜLDÜ VE YAZILMADI: "kontrol atlayan bekçi sayıyı özet satırında beyan
// etmeli" kuralı METİNDEN ölçülemiyor. Aday yüklem ("atlandı" kelimesi geçiyor
// ama özet satırında sayaç yok) 458 dosyanın 52'sini işaretledi ve tek tek
// bakıldığında çoğu bir check ETİKETİNDE geçen kelimeydi — yüklem gerçek
// atlamayı değil kelimeyi ölçüyor. Ölçüm çürüttüğü için kural YAZILMADI;
// gerçek atlama sayacı bugün koşucunun `Sonuç:` satırına demirli regex'iyle
// ölçülüyor (run-all-tests.ts) ve kapsam kaybı orada görünüyor.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = join(__dirname);
/** Koşucunun bugünkü dosya süzgeci ile BİREBİR aynı (run-all-tests.ts:219). */
const BEKCI_DESENI = /^test_.*\.ts$/;
/** Bugün 458 dosya var; taban körlüğe karşı. Dosya sayısı düşerse bilerek kırmızı. */
const EN_AZ_DOSYA = 400;

/**
 * Koşucunun TANIDIĞI özet formatları (run-all-tests.ts:299-302).
 * Kaynak metinde şablon literali olarak arandığı için `${...}` yerine `.*` var.
 */
const TANINAN_OZET = [
  // ① `Sonuç:`/`SONUÇ:` başlıklı ② başlıksız `N geçti, M başarısız|kaldı`
  // ③ `N/T geçti`. Kaynak metinde şablon literali arandığı için sayı yerine
  // `${...}` de kabul edilir. ⚠️ "düştü"/"passed" gibi kelimeler BİLEREK yok:
  // koşucu onları tanımıyor (2026-09-06'da üç dosya bu yüzden görünmezdi).
  /(?:Sonuç|SONUÇ):[^`\n]*geçti,[^`\n]*(?:başarısız|kaldı)/,
  /geçti,\s*(?:\$\{[^}]*\}|\d+)\s*(?:başarısız|kaldı)/,
  /(?:\$\{[^}]*\}|\d+)\/(?:\$\{[^}]*\}|\d+)\s*geçti/,
];

/**
 * Özet satırı basmayan meşru dosyalar. İKİ YÖNLÜ: listede olup ARTIK özet basan
 * dosya da kırmızı verir (muafiyet bayatlarsa görünür).
 * ⚠️ Bu listeye ekleme yapmadan önce sor: dosya gerçekten kontrol saymıyor mu?
 */
const MUAF: readonly string[] = [];

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dosyalar = readdirSync(SCRIPTS_DIR).filter((f) => BEKCI_DESENI.test(f)).sort();

check(
  `körlük zemini: en az ${EN_AZ_DOSYA} bekçi dosyası tarandı`,
  dosyalar.length >= EN_AZ_DOSYA,
  `${dosyalar.length} dosya`,
);

const ozetsiz: string[] = [];
const ingilizce: string[] = [];

for (const f of dosyalar) {
  if (f === "test_bekci_sozlesmesi.ts") continue;
  const kaynak = readFileSync(join(SCRIPTS_DIR, f), "utf8");

  if (/\$\{[^}]*\}\s*passed,\s*\$\{[^}]*\}\s*failed/.test(kaynak)) ingilizce.push(f);

  const taniniyor = TANINAN_OZET.some((r) => r.test(kaynak));
  if (!taniniyor && !MUAF.includes(f)) ozetsiz.push(f);

}

check(
  "⭐ her bekçi koşucunun TANIDIĞI özet formatını basıyor",
  ozetsiz.length === 0,
  ozetsiz.length ? ozetsiz.join(", ") : `${dosyalar.length - 1} dosya uyuyor`,
);

check(
  "İngilizce `N passed, M failed` formatı KULLANILMIYOR (koşucu tanımaz)",
  ingilizce.length === 0,
  ingilizce.join(", ") || "temiz",
);

// Muafiyet listesi iki yönlü: artık özet basan bir dosya listede kalmamalı.
const bayatMuaf = MUAF.filter((f) => {
  if (!dosyalar.includes(f)) return true;
  return TANINAN_OZET.some((r) => r.test(readFileSync(join(SCRIPTS_DIR, f), "utf8")));
});
check(
  "muafiyet listesi bayat değil (iki yönlü)",
  bayatMuaf.length === 0,
  bayatMuaf.join(", ") || `${MUAF.length} muaf`,
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
