// =============================================================================
// BEKÇİ — NEGATİF SONDA KAPSAMI (CIRCIR: yalnız YÜKSELİR) — 2026-09-06
// =============================================================================
// PROBLEM: `[TD-14]` her yeni bekçinin negatif sondayla yazılmasını emrediyor
// (korunan davranışı bilerek boz → KIRMIZI gör → geri al). Ama bu kural bugüne
// kadar HİÇBİR mekanik kapıyla desteklenmiyordu ve ölçüm acı: 460 backend
// bekçisinin yalnız **78'inde** (%17) dosyada kayıtlı bir sonda var.
//
// ⭐ NEDEN ÖNEMLİ: ısırmayan bir bekçi, hiç bekçi olmamasından TEHLİKELİDİR —
//    çünkü kural "kapandı" sayılır. Bu oturumda tam bu sınıf iki kez ısırdı:
//    `test_superadmin`in HTTP bölümü GERİ ALINMIŞ bir davranışı ölçüyordu ve
//    kendi fixture'ıyla çelişen bir yüklem taşıyordu — iki gün görülmedi.
//
// ⚠️ BU BEKÇİ NE ÖLÇER, NE ÖLÇMEZ — dürüst sınır:
//    ÖLÇER  : dosyada bir sonda KAYDI var mı ve sayı DÜŞTÜ mü.
//    ÖLÇMEZ : sondanın gerçekten koşulup koşulmadığını. Metin yazarak bu kapı
//             kandırılabilir. Kandırmaya karşı savunma mekanik değil kültüreldir
//             (`docs/RECETELER.md` § bekçi: sonda commit mesajına yazılır).
//    Yani bu bir KAPSAM CIRCIRI'dır, bir ispat değil. Amacı GERİLEMEYİ durdurmak
//    ve sayıyı GÖRÜNÜR kılmak — lint tavanı cırcırıyla birebir aynı desen
//    (`scripts/check-lint-baseline.mjs`), tavan orada da yalnız DÜŞER.
//
// ⚠️ TABAN NEDEN "YALNIZ YÜKSELİR": lint tavanının tersi. Orada ölçülen şey BORÇ
//    (azalmalı), burada ÖLÇÜLMÜŞ GÜVENCE (artmalı). İki cırcır aynı dosyada
//    olsaydı yön karışırdı; ayrı tutuldu.
//
// ⭐ NEGATİF SONDA (2026-09-06): `TABAN` 200'e çekildi → kırmızı (78 < 200);
//    bir bekçi dosyasından sonda satırı silindi → sayı 77'ye düştü, kırmızı.
//    İkisi de ölçüldü.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = join(__dirname);
const BEKCI_DESENI = /^test_.*\.ts$/;

/**
 * Sonda kaydının işareti. Dosyanın HERHANGİ bir yerinde geçmesi yeter: kimi
 * bekçi başlıkta, kimi ilgili bölümün yanında yazıyor ve ikisi de meşru.
 *
 * ⚠️ TÜRKÇE BÜYÜK İ TUZAĞI — `İ` HARFİ AÇIKÇA YAZILI. JS'in `/i` bayrağı
 * Unicode katlaması yapar: `NEGATİF` küçültülünce `negati̇f` olur (i + BİRLEŞEN
 * NOKTA, U+0307) ve düz `negatif` ile EŞLEŞMEZ. İlk yazımda tam bu yüzden 78
 * yerine 49 saydım — yani kapı, kuralı UYGULAYAN 29 bekçiyi "sondasız" sayıp
 * tabanı yanlış yere kuracaktı. Repo bu sınıfı zaten yasaklıyor
 * (`toLocaleUpperCase("tr")`, SQL fold'da `\s`); burada çözüm karakter kümesi.
 */
const SONDA_ISARETI = /negat[iİı]?f\s+sonda/i;

/**
 * BUGÜNKÜ TABAN — ölçüldü 2026-09-06. Yalnız YÜKSELİR.
 * Yükseltmek için: `node -e` ile saymak yerine bu bekçiyi koş, çıktı yeni sayıyı
 * basar; sayıyı buraya yaz ve commit mesajında hangi bekçilere sonda eklendiğini
 * söyle. DÜŞÜRMEK bir karardır ve gerekçesi bu satırın yanına yazılır.
 */
const TABAN = 108;

/** Taranan dosya sayısı bunun altına düşerse "0 ihlal" ile "hiç bakmadım" karışır. */
const EN_AZ_DOSYA = 400;

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

const sondali: string[] = [];
const sondasiz: string[] = [];
for (const f of dosyalar) {
  const kaynak = readFileSync(join(SCRIPTS_DIR, f), "utf8");
  if (SONDA_ISARETI.test(kaynak)) sondali.push(f);
  else sondasiz.push(f);
}

const oran = Math.round((sondali.length / dosyalar.length) * 1000) / 10;
check(
  `⭐ kayıtlı negatif sonda sayısı TABANIN altına düşmedi (${TABAN})`,
  sondali.length >= TABAN,
  `${sondali.length} / ${dosyalar.length} dosya (%${oran})`,
);

if (sondali.length > TABAN) {
  console.log(
    `\nℹ️  TABAN YÜKSELTİLEBİLİR: ${sondali.length} ölçüldü, dosyadaki taban ${TABAN}.` +
      `\n   \`TABAN = ${sondali.length}\` yaz ve hangi bekçilere sonda eklediğini commit'e geç.`,
  );
}

// Sondasız dosyaları SAYIYLA değil GÖRÜNÜR bırakmak: hangi alanın açıkta olduğu
// bilinmeden "bir sonraki turda 10 tane ekle" kararı verilemez.
console.log(`\n── SONDASIZ ${sondasiz.length} dosya (ilk 25) ──`);
for (const f of sondasiz.slice(0, 25)) console.log(`  • ${f}`);
if (sondasiz.length > 25) console.log(`  … ve ${sondasiz.length - 25} tane daha`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
