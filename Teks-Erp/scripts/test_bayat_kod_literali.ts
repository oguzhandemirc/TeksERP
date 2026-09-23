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
// ⛔ ÖLÇMEDİĞİ ① — YORUMLAR (2026-09-24, 1e kararı): tarayıcı eşleştirmeden ÖNCE yorumları
// soyar. Yorumdaki bayat örnek yalan söyler ama kimseye kod ÜRETMEZ; üstelik bu depoda
// ölçüm anlatısı yorumda yaşar ("IE0808260001 bu hatayı üretmişti"), yani yorumları saymak
// kapıyı BELGE DİSİPLİNİNİN karşısına koyardı. Ölçüldü 2026-09-24: 594 ham eşleşmenin
// 442'si yorumdaydı, 152'si kodda.
//
// ⛔ ÖLÇMEDİĞİ ② — AYIRT EDİCİ OLMAYAN SERİLER (ÜÇÜNCÜ SONUÇ, ölçüldü 2026-09-24):
// bir serinin deseni `ön ek + ayraç + tarih` SABİT parçasıyla ayırt edilir; bu parça
// kısaldıkça desen sıradan metinle çakışır. `batchShort` (`P` + en az iki rakam, tarihsiz)
// 479 eşleşme üretti ve en kalabalık dosyası `error.middleware.ts`ti — 63 eşleşmenin
// hepsi PRİSMA HATA KODU (`P2002`, `P2010`…). Böyle bir seri "0 bulgu" da vermez,
// "479 bulgu" da: ÖLÇÜLEMEZ, ve ölçülemediği ADIYLA BASILIR. Eşik ölçülerek seçildi
// (`item` = `STK` + `-` = 4 ile TAM SINIRDA ve gerçek bir literali var: `STK-000001`).
// ⚠️ Küme DONDURULUR (`OLCULEMEZ`): yarın tarihsiz tek harfli bir seri daha doğarsa
// kapı onu sessizce yutmaz, kırmızı verir ve kapsam yeniden sorulur.
//
// ⛔ ÖLÇMEDİĞİ ③: geçmişte GERÇEKTEN yaşanmış saha vakaları (`inventory.service.ts`
// içindeki `T050826H0033` gibi) — onlar örnek değil KANIT. (2026-09-24'e kadar gerekçe
// "zaten kilitli seridendir"di; YAPISAL kilitli seri KALMADI, gerekçe artık yorum soymadır.)
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
 *
 * ⚠️ TEK YÜKSELME GEREKÇESİ KAPSAM DEĞİŞİMİDİR, BORÇ DEĞİL (2026-09-23, 68 → 86):
 * bu cırcırın kapsamı "YAPISAL kilidi OLMAYAN seriler"dir ve `workOrder` o gün
 * YAPISAL kümeden çıktı (kilidin gerekçesi "Faz B inmeden açılmaz"dı, Faz B indi
 * — `returnDoc` emsali). Yani tek satırlık bir sınıflandırma düzeltmesi, ZATEN
 * VAR OLAN 24 `IE…` literalini (ölçüm 2026-09-23, bu bekçinin kendi koşumu) ölçüm
 * alanına soktu; yeni literal YAZILMADI.
 * Aynı turda 6'sı türetildi (`sample-data` ×3 · `traveler-card.service` ×2 ·
 * `label-rawcode` ×1) ⇒ 92 ölçüldü (2026-09-23), 86'ya indirildi.
 *
 * Kalan 18'in sınıfı ÖLÇÜLDÜ (2026-09-23): 12'si YORUM içinde geçen vaka anlatısı
 * (tambur · inventory · roll ve fason yardımcıları: "IE0808260001 bu hatayı üretmişti"), 6'sı
 * refakat kartı alan kataloğunun `sample` değerleri (backend ×3 + Electron
 * aynası ×3 — tek taraflı türetme AYNAYI BOZAR). Bunları düşürmek ayrı bir
 * karardır: yorumdaki örnek bayatlarsa yalan söyler ama kimseye kod üretmez.
 */
const TABAN = 49;

/**
 * AYIRT EDİCİLİK EŞİĞİ — desenin SABİT parçasının en az bu kadar karakter olması.
 * Altında kalan seri ölçülemez (bkz. başlık, ÖLÇMEDİĞİ ②).
 */
const AYIRT_EDICI_ESIK = 4;

/**
 * ÖLÇÜLEMEYEN seriler — ADIYLA dondurulur ki küme sessizce büyümesin.
 * İkisi de kullanıcının istediği KISA, tarihsiz numaralardır (`P-1`), yani
 * kusur serilerde değil: bu tarayıcı onları ayırt edemez ve bunu söyler.
 */
const OLCULEMEZ = new Set(["batchShort", "packingLotName"]);

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

/**
 * Yorumları BOŞLUĞA çevirir (silmez) — satır/sütun kayması olmasın diye.
 * Blok yorumun içindeki satır sonları korunur.
 */
function yorumlariSoy(metin: string): string {
  return metin
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((satir) => {
      const i = satir.indexOf("//");
      return i >= 0 ? satir.slice(0, i) : satir;
    })
    .join("\n");
}

/** Desenin SABİT (rakam olmayan) parçasının uzunluğu — ayırt ediciliğin ölçüsü. */
export function sabitParcaUzunlugu(key: string): number {
  const f = resolveSeriesFormat(key);
  const len = DATE_SEGMENTS[f.dateSegment].len;
  const ikinci = f.separator2 ?? f.separator;
  return (
    f.prefix.length +
    (f.separator === "" ? 0 : f.separator.length) +
    len +
    (len > 0 && ikinci !== "" ? ikinci.length : 0)
  );
}

/** Bugün ölçülebilen seriler — eşiğin altındakiler ÜÇÜNCÜ SONUÇ olarak ayrılır. */
export function olculebilirSeriler(): { olculen: string[]; olculemeyen: string[] } {
  const olculen: string[] = [];
  const olculemeyen: string[] = [];
  for (const e of NUMBER_SERIES_CATALOG.filter((x) => !x.lockedReason)) {
    (sabitParcaUzunlugu(e.key) >= AYIRT_EDICI_ESIK ? olculen : olculemeyen).push(e.key);
  }
  return { olculen, olculemeyen };
}

export function bulgulariTopla(): Array<{ key: string; kod: string; yer: string }> {
  const out: Array<{ key: string; kod: string; yer: string }> = [];
  for (const key of olculebilirSeriler().olculen) {
    const re = seriDeseni(key);
    for (const dir of TARANAN) {
      for (const dosya of kaynakDosyalari(join(KOK, dir))) {
        // ⚠️ YORUM SOYMA EŞLEŞMEDEN ÖNCE: sonra süzmek "hangi satırdaydı" sorusunu
        // yeniden sormak olurdu ve çok satırlı blok yorumda yanlış cevap verirdi.
        for (const m of yorumlariSoy(readFileSync(dosya, "utf-8")).matchAll(re)) {
          out.push({ key, kod: m[0], yer: relative(KOK, dosya) });
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

// ── ÜÇÜNCÜ SONUÇ: ölçülemeyen seriler ADIYLA basılır ve KÜMESİ donar ────────
const { olculen, olculemeyen } = olculebilirSeriler();
console.log(
  `\nℹ️  ÖLÇÜLEMEDİ (${olculemeyen.length}): ${olculemeyen.map((k) => `${k} (sabit parça ${sabitParcaUzunlugu(k)} < ${AYIRT_EDICI_ESIK})`).join(" · ") || "yok"}`,
);
check("§0c ⭐ ölçülemeyen seri kümesi BEYAN EDİLENLE aynı (sessizce büyümedi)",
  olculemeyen.length === OLCULEMEZ.size && olculemeyen.every((k) => OLCULEMEZ.has(k)),
  `ölçülemeyen: ${olculemeyen.join(", ") || "yok"} · beyan: ${[...OLCULEMEZ].join(", ")}`);
check("§0d körlük zemini: ölçüm alanı BOŞALMADI (eşik her şeyi elemedi)",
  olculen.length >= 40, `${olculen.length} seri ölçülüyor`);

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
