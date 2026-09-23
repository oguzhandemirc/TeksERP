// =============================================================================
// BAYAT KOD LİTERALİ — kaynakta yazılı örnek kodlar, biçim VERİ olduğu için yalan olur
// =============================================================================
// NEDEN VAR (D7, 2026-09-23): Faz D ile numara biçimi tamamen VERİ oldu — fabrika
// panelden ön eki, tarih segmentini, haneyi ve iki ayracı değiştirebiliyor. Kaynakta
// yazılı her örnek kod (`CV1408260001` gibi bir Swagger `example:`, bir placeholder,
// bir belge önizleme verisi) o günden sonra SESSİZCE YALAN olur. Kullanıcının kendi
// değişmezi bunun tam karşısında duruyor: *"belge · çıktı · programdaki veriler
// birbiriyle aynı olmalı."*
//
// ⚠️ KAPSAM DÜZENLENEBİLİR SERİLERLE SINIRLI ve bu ÖLÇÜLMÜŞ bir sınırdır: `lockedReason`
// taşıyan serinin biçimi YAPILANDIRMAYLA DEĞİŞEMEZ (top barkodu · kısa parti no · iş emri
// no · iade belge no), dolayısıyla onların literali bayatlayamaz. Bugün 49/52 seri
// düzenlenebilir.
//
// ⚠️ DESENLER KATALOGDAN TÜRETİLİR, elle yazılmaz: her seri için YÜRÜRLÜKTEKİ biçimden
// (`resolveSeriesFormat`) bir regex kurulur. Elle yazılmış bir desen listesi, biçim
// değiştiği gün bu bekçiyi de bayatlatırdı — yani tam olarak ölçmeye çalıştığı hastalığa
// yakalanırdı.
//
// ⚠️ CIRCIR (taban), toplu yeniden yazım DEĞİL: bugün 68 bulgu var ve hepsini türetmeye
// çevirmek bu dilimin işi değil. Taban donar, YENİ literal eklenemez, düşürmek serbesttir.
// İKİ SONDA (kök kural): ihlal eklenince taban ARTAR · ihlal düzeltilince taban DÜŞER.
// İkincisi bu commit'te GERÇEKTEN yapıldı — `document-render/sample-data.ts`in on örnek
// numarası seriden türetilir oldu (78 → 68).
//
// ⚠️ TÜRETME HER SERİDE GEÇERLİ DEĞİL ve bu bir TUZAK: `previewSeriesCode` katalog
// `infix`ini (top barkodunun faz harfi `[HF]`) YAZMAZ — o eşleştirme parçasıdır, üretim
// parçası değil. `roll` örneğini seriden türetmek `T2309260001` üretirdi: faz harfi YOK,
// yani sessiz bir yanlış. ⇒ Örnek, o kodu GERÇEKTEN üreten yoldan türetilir
// (`roll` için `rollBarcodePrefix`), seri tablosundan değil.
//
// ⛔ ÖLÇMEDİĞİ (beyanlı): geçmişte GERÇEKTEN yaşanmış saha vakaları (`inventory.service.ts`
// içindeki `T050826H0033` gibi) — onlar örnek değil KANIT, ve zaten kilitli seridendir.
// Testler (`*.test.*`) kapsam dışı: fikstür kodu `TEST-` ön ekiyle doğar.
//
// İKİ KOLLU SONDA (ölçüldü 2026-09-23; ikisi de geri alındı, `cmp` birebir):
//   A (negatif) `item.service.ts`e `CV2309260099` yorumu eklendi → 69 > 68, §1 ❌
//   B (pozitif)  `STK-000001` literali `STK-ORNEK` yapıldı      → 67 < 68, §2 ❌
// ⚠️ A İLK DENEMEDE ISIRMADI ve sebebi BEKÇİ DEĞİLDİ: `perl -0pi -e 's|^import|…'`
//   slurp modunda `^`i yalnız DOSYA BAŞINA uygular, dosya ise yorumla başlıyordu ⇒
//   mutasyon HİÇ UYGULANMAMIŞTI. Sonda tekrarı `grep -c` ile mutasyonun indiğini
//   DOĞRULAYARAK yapıldı. ⇒ Bir sonda ısırmayınca ilk soru "kapı mı kör" değil,
//   "mutasyon gerçekten uygulandı mı" olmalı.
//
// Koşum: npx tsx scripts/test_bayat_kod_literali.ts
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NUMBER_SERIES_CATALOG } from "../src/constants/number-series-catalog";
import { DATE_SEGMENTS } from "../src/services/helpers/series-format.helper";
import { resolveSeriesFormat } from "../src/services/number-series.service";

/**
 * TABAN — bugün ölçülen literal sayısı. YÜKSELTİLMEZ; düşürmek serbesttir.
 * Düşürmenin yolu literali silmek değil, örneği ÜRETEN YOLDAN türetmektir.
 */
const TABAN = 68;

const KOK = join(__dirname, "..", "..");
const TARANAN = ["Teks-Erp/src", "Electron/src", "mobil/src"];

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

function* kaynakDosyalari(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "node_modules") yield* kaynakDosyalari(p);
      continue;
    }
    if (/\.(ts|tsx)$/.test(e) && !/\.test\.|\.spec\./.test(e)) yield p;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Serinin YÜRÜRLÜKTEKİ biçiminden tam-kod deseni (katalogdan türetilir). */
export function seriDeseni(key: string): RegExp {
  const f = resolveSeriesFormat(key);
  const len = DATE_SEGMENTS[f.dateSegment].len;
  const s1 = f.separator === "" ? "" : escapeRe(f.separator);
  const ikinci = f.separator2 ?? f.separator;
  const s2 = ikinci === "" ? "" : escapeRe(ikinci);
  const bas = len === 0 ? `${escapeRe(f.prefix)}${s1}` : `${escapeRe(f.prefix)}${s1}\\d{${len}}${s2}`;
  return new RegExp(`\\b${bas}\\d{${f.digits},}\\b`, "g");
}

export function bulgulariTopla(): Array<{ key: string; kod: string; yer: string }> {
  const out: Array<{ key: string; kod: string; yer: string }> = [];
  const duzenlenebilir = NUMBER_SERIES_CATALOG.filter((e) => !e.lockedReason);
  for (const e of duzenlenebilir) {
    const re = seriDeseni(e.key);
    for (const dir of TARANAN) {
      for (const dosya of kaynakDosyalari(join(KOK, dir))) {
        for (const m of readFileSync(dosya, "utf-8").matchAll(re)) {
          out.push({ key: e.key, kod: m[0], yer: relative(KOK, dosya) });
        }
      }
    }
  }
  return out;
}

console.log("=== BAYAT KOD LİTERALİ (cırcır) ===\n");

const kilitli = NUMBER_SERIES_CATALOG.filter((e) => e.lockedReason).length;
check("§0 körlük zemini: kapsam gerçekten dar değil (düzenlenebilir seri çoğunlukta)",
  NUMBER_SERIES_CATALOG.length - kilitli >= 40,
  `${NUMBER_SERIES_CATALOG.length - kilitli} düzenlenebilir / ${kilitli} kilitli`);

const bulgular = bulgulariTopla();
check("§0 körlük zemini: tarayıcı GERÇEKTEN eşleşiyor (ölü regex değil)",
  bulgular.length > 0, `${bulgular.length} literal`);

check("§1 ⭐ kaynakta yazılı örnek kod sayısı TABANI AŞMIYOR (yeni literal yazılmaz)",
  bulgular.length <= TABAN, `${bulgular.length} / taban ${TABAN}`);

// ⚠️ İKİ YÖNLÜ: taban DÜŞTÜYSE de kırmızı — sabit güncellenmeli, yoksa kazanım
// sessizce geri alınabilir hâle gelir (cırcır bir kez gevşerse bir daha sıkılmaz).
check("§2 ⭐ taban ÇÜRÜMEMİŞ: düşen sayı sabite yazılmalı",
  bulgular.length >= TABAN,
  bulgular.length < TABAN ? `${bulgular.length} < ${TABAN} ⇒ TABAN'ı ${bulgular.length} yap` : "taban güncel");

if (bulgular.length > TABAN) {
  console.log("\n  Taban üstü (yeni eklenen literaller de bu listededir):");
  for (const b of bulgular.slice(0, 20)) console.log(`   · ${b.key} ${b.kod} ${b.yer}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
