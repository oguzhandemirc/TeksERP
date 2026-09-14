// =============================================================================
// GÜN ANAHTARI TEK KAYNAKTAN — süreç saat dilimi bir gün sınırı kararı DEĞİLDİR
// =============================================================================
// NEDEN VAR (ölçüldü 2026-09-14): `test_latency_persist` CI'da 11/16 kırmızı
// verdi ve "aralıklı" sanıldı. Değildi — **her gün 21:00–24:00 UTC arasında**
// (00:00–03:00 Europe/Istanbul) kırmızıydı, dışında yeşil. Sebep: servis gün
// anahtarını `factoryDayKeyUtcMidnight` ile FABRİKA gününden türetiyordu, bekçi
// ise `n.getFullYear()/getMonth()/getDate()` ile SÜREÇ saat diliminden. CI'da
// `TZ` hiç set edilmemiş ⇒ runner UTC, fabrika UTC+3 ⇒ ikisi günde üç saat
// ayrışıyor. Ürün doğruydu, ölçüm yanlıştı.
//
// ⚠️ VE BU BİR TEST KUSURU DEĞİL, BİR SINIFTIR. `src/utils/code-format.ts`
// `ddmmyy()` tam bu sebeple düzeltilmişti ve docstring'i şunu yazıyor:
// *"Eski hâli süreç saat dilimine yaslanıyordu ve bunu hiçbir yerde
// YAZMIYORDU. Sahadaki Windows sunucu Europe/Istanbul olduğu için sonuç
// DOĞRUYDU — ama UTC kurulan/konteynere alınan bir sunucuda her gece
// 00:00–03:00 arasında üretilen belge numaraları BİR ÖNCEKİ günün GGAAYY'sini
// taşır ve o günün sayacına eklenirdi."*
// ⇒ Kusur SAHADA GÖRÜNMEZ çünkü host tesadüfen doğru saat diliminde. Ve
// `Dockerfile`da `TZ` AYARLI DEĞİL (ölçüldü 2026-09-14) — yani konteynere alınan
// her kurulum bu sınıfın içine doğar.
//
// TEK KAYNAK: `src/constants/time.ts` — `factoryYmd` (YYYY-MM-DD anahtarı) ·
// `factoryDayKeyUtcMidnight` (@db.Date kolonuna yazılacak gün) · `ddmmyy`
// (GGAAYY, `src/utils/code-format.ts`).
//
// ⚠️ İKİ SINIF, İKİ SERTLİK — ölçüt SÖZDİZİMSELDİR ve beyan edilir:
//   ANAHTAR : aynı ifadede ÇOK erişimci, aralarında AYRAÇ YOK
//             (`${yıl}${ay}${gün}` → `20260914`, `IADE-140926-…`) ⇒ bu bir
//             KİMLİK/ANAHTARDIR: saklanır, sorgulanır, sayaç anahtarı olur.
//             Yanlış gün = yanlış kayıt. Taban DOSYA DOSYA beyanlı, iki yönlü.
//   DİĞER   : ayraçlı çok erişimci (`14.09.2026`) ve tek erişimci ⇒ çoğunlukla
//             GÖSTERİM. Yanlışsa belge yanlış saat basar — ciddi ama kimlik
//             bozmaz. Tek sayılı CIRCIR.
// ⛔ Ayırt edici SÖZDİZİMSELDİR, anlamsal değil: "bu satır anahtar mı gösterim
//    mi" sorusunu ayraç cevaplar. Anlamı okuyan bir kapı, okuyanın niyetini
//    ölçer; ayracı okuyan kapı METNİ ölçer.
//
// Koşum: npx tsx scripts/test_gun_anahtari_kaynagi.ts   (DB GEREKMEZ)
// =============================================================================
import { execFileSync } from "node:child_process";
import { atlamaDefteri } from "./lib/atlama";
import { curumeKolu } from "./lib/circir-kolu";
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

// Çürüme kolu commit kapısında uyarıya düşünce defterde ADLI görünür (strict → kırmızı).
const ATLAMA = atlamaDefteri((mesaj) => check(mesaj, false));

const KOK = path.resolve(__dirname, "..");

/** Süreç saat dilimine yaslanan tarih-parçası erişimcileri (UTC'li olanlar HARİÇ). */
const YEREL_ERISIMCI = /\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)\(\)/g;

export type Sinif = "anahtar" | "diger";

/**
 * Bir satırın sınıfı. `null` = bu satırda süreç-TZ erişimcisi YOK.
 *
 * ⚠️ `getUTCFullYear()` ELENİR ve bu eleme load-bearing: ilk taramamda
 * `getFullYear()` deseni `getUTCFullYear()`ı da sayıyordu (alt dizgi!) ve iki
 * ZIT sınıfı — bilinçli UTC ile örtük süreç-TZ — aynı kovaya atıyordu.
 * ⇒ *Sınırsız eşleşme bir tarayıcının kendi içinde de olur.*
 */
export function satirSinifi(satir: string): Sinif | null {
  if (/^\s*\*/.test(satir)) return null; // blok yorumu gövdesi
  const kod = satir.replace(/\/\/.*$/, "");
  const bulunan = [...kod.matchAll(YEREL_ERISIMCI)].filter(
    (m) => !kod.slice(Math.max(0, m.index - 3), m.index + 4).includes("UTC"),
  );
  if (bulunan.length === 0) return null;
  if (bulunan.length === 1) return "diger";
  // Erişimciler ARASINDA bir ayraç literali var mı? Yoksa birleştirilen şey bir
  // ANAHTARDIR (`20260914`), varsa bir GÖSTERİMDİR (`14.09.2026`).
  const arasi = kod.slice(bulunan[0].index, bulunan[bulunan.length - 1].index);
  const ayracli = /[.\-/: ]["`]|["`][.\-/: ]|\}[.\-/: ]\$\{/.test(arasi);
  return ayracli ? "diger" : "anahtar";
}

/** Taranan dosyalar — ENVANTER ÖLÇÜLÜR (`git ls-files`), elle yazılmaz. */
export function taranacakDosyalar(kok: string): string[] {
  // ⚠️ `src`/`scripts` DİZİN olarak verilir. İlk ölçümümde pathspec
  // `scripts/**/*.ts` yazmıştım ve `scripts/` KÖKÜNDEKİ dosyaları HİÇ almadı
  // (`**/` bir dizin düzeyi ister) ⇒ 113 eşleşmenin 37'si görünmedi.
  // *Bir tarayıcının kapsamı, ölçtüğü sayının ilk eksenidir.*
  // ⚠️ `--others --exclude-standard`: İZLENMEYEN dosyalar da taranır. Çıplak
  // `ls-files` yalnız index'i verir ⇒ HENÜZ `git add` EDİLMEMİŞ yeni bir
  // dosyanın ihlali GÖRÜNMEZ, ve bir kapının en çok görmesi gereken an yeni
  // dosyanın yazıldığı andır. (Bunu kendi negatif sondamı kurarken ölçtüm:
  // sonda dosyası untracked olduğu için kapı onu HİÇ görmedi.)
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts"], {
    cwd: kok,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".ts"))
    // ⚠️ ARAÇ, GÖZLEDİĞİ KÜMENİN İÇİNDE OLAMAZ. Bu dosyanın §3 sondaları
    // deseni ÖRNEK OLARAK taşımak zorundadır (yoksa sınıflandırıcı ölçülemez)
    // ⇒ kendini tarasa kendi sondalarını ihlal sayar. İlk koşumda tam bunu
    // yaptı: §1'de "BEYANSIZ" ve §2'de 48 → 51. Muafiyet kapsam DARALTMASI
    // değil, ÖLÇÜM KOŞULUDUR.
    .filter((f) => f !== "scripts/test_gun_anahtari_kaynagi.ts");
}

export type BeyanKarar = {
  /** Gerçekte var, beyanda YOK ⇒ yeni ihlal. */
  beyansiz: string[];
  /** Beyanda var, gerçekte YOK ⇒ borç kapandı, beyan bayat. */
  bayat: string[];
  /** İkisinde de var ama ADET ayrışıyor ⇒ beyanı tazele. */
  adetSapan: string[];
};

/**
 * Beyanlı tabanın İKİ YÖNLÜ kararı — SAF, ve bu saflık bir SINIF kararıdır:
 * karar bir fonksiyonda yaşadığı sürece sondası DOSYA İÇİNDE koşar (kalıcı, "K"
 * sınıfı). Kollar `if` içinde gömülü kalsaydı doğruluğu yalnız dosya DIŞINDA
 * koşulup GERİ ALINMIŞ bir mutasyon zinciriyle gösterilebilirdi ("B" sınıfı) ve
 * kanıt bir daha koşmazdı — yalnız commit mesajında bir cümle olarak kalırdı.
 *
 * ⚠️ Sayı değil ADRES döner: "43 → 44" bir teşhis değildir.
 */
export function beyanKarari(
  gercek: Record<string, number>,
  taban: Record<string, number>,
): BeyanKarar {
  const beyansiz: string[] = [];
  const adetSapan: string[] = [];
  for (const [ad, n] of Object.entries(gercek)) {
    if (taban[ad] === undefined) beyansiz.push(ad);
    else if (taban[ad] !== n) adetSapan.push(`${ad} (${n} ↔ beyan ${taban[ad]})`);
  }
  return {
    beyansiz: beyansiz.sort(),
    bayat: Object.keys(taban).filter((ad) => gercek[ad] === undefined).sort(),
    adetSapan: adetSapan.sort(),
  };
}

export function tara(kok: string): { anahtar: Record<string, number>; digerSatir: number; dosya: number } {
  const anahtar: Record<string, number> = {};
  let digerSatir = 0;
  const dosyalar = taranacakDosyalar(kok);
  for (const f of dosyalar) {
    for (const l of readFileSync(path.join(kok, f), "utf8").split("\n")) {
      const s = satirSinifi(l);
      if (s === "anahtar") anahtar[f] = (anahtar[f] ?? 0) + 1;
      else if (s === "diger") digerSatir++;
    }
  }
  return { anahtar, digerSatir, dosya: dosyalar.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANAHTAR SINIFI TABANI — dosya → satır. Her satır bir KABUL ve gerekçesi yanında.
// ⛔ Yeni dosya eklemek KIRMIZIDIR; bir dosya düşerse de KIRMIZI ("taban düş").
// ⛔ Bu sabite yalnız yönetici oturum dokunur (kadro kuralı 2026-09-13).
// ─────────────────────────────────────────────────────────────────────────────
const ANAHTAR_TABAN: Record<string, { adet: number; gerekce: string }> = {
  "src/services/helpers/backup-naming.helper.ts": {
    adet: 2,
    gerekce:
      "MEŞRU/BEYANLI: `stamp()` docstring'i 'SUNUCUNUN YEREL saatiyle' diyor ve " +
      "`rebuildStamp` aynı dosyada YEREL kurucunun (`new Date(y,mo-1,d,…)`) " +
      "gidiş-dönüşünü doğruluyor — orada yerel erişimci DOĞRU olandır. " +
      "⚠️ Beyan fabrika-günü doktrininden ÖNCE yazıldı; yedek dosya adının " +
      "fabrika gününü mü sunucu saatini mi taşıyacağı AYRI bir karar (sahibi: yedek alanı)",
  },
  // `src/services/return.service.ts` (IADE-GGAAYY borcu) 2026-09-14'te `ddmmyy` ile
  // kapandı (ea `935076bb`) ve aynı trende ANAHTAR listesinden düştü — entegratör 1e.
  "scripts/audit_repro_E-2-01.ts": {
    adet: 1,
    gerekce:
      "MEŞRU: tek seferlik denetim yeniden-üretim script'i, ürün yolu değil; " +
      "ürettiği damga hiçbir yere yazılmaz (2026-09-14)",
  },
};

/**
 * DİĞER sınıfının cırcır tabanı (ölçüldü 2026-09-14: 48 satır / 26 dosya).
 * ⚠️ Bunların 22'si `document-render/` altında ONBİR dosyada KOPYALANMIŞ aynı
 * `fmtDate` üç satırıdır — yani bu sayı bir kusur sayısı değil, bir KOPYA
 * sayısıdır ve tek bir paylaşılan yardımcıyla toptan düşer.
 */
// 48 → 39 (2026-09-14, entegratör 1e): document-render `fmtDate` kopyaları tek
// yardımcıya taşındı (ea `58c019ba`); aynı trende ölçüldü.
const DIGER_TABAN = 39;

function main(): void {
  console.log("\n=== Gün anahtarı TEK KAYNAKTAN mı? (süreç saat dilimi taraması) ===\n");
  const { anahtar, digerSatir, dosya } = tara(KOK);

  // ── §0 KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────
  // Boş bir kapsam ya da hiç eşleşmeyen bir desen, her şeyi yeşil geçirirdi.
  console.log("§0 — körlük zemini");
  check("§0a taranan dosya sayısı makul", dosya > 500, `${dosya} .ts`);
  check(
    "§0b desen GERÇEKTEN eşleşiyor (tarayıcı ölü değil)",
    Object.keys(anahtar).length + digerSatir > 0,
    `${Object.keys(anahtar).length} anahtar dosyası · ${digerSatir} diğer satır`,
  );
  console.log("");

  // ── §1 ANAHTAR SINIFI — iki yönlü, dosya dosya, SAF KARARLA ───────────────
  console.log("§1 — ANAHTAR sınıfı (ayraçsız gün anahtarı) beyanlı mı");
  const tabanAdet: Record<string, number> = Object.fromEntries(
    Object.entries(ANAHTAR_TABAN).map(([f, v]) => [f, v.adet]),
  );
  const k = beyanKarari(anahtar, tabanAdet);
  check(
    "§1a ⭐ BEYANSIZ anahtar dosyası yok",
    k.beyansiz.length === 0,
    k.beyansiz.length === 0
      ? `${Object.keys(anahtar).length} dosya, hepsi beyanlı`
      : `${k.beyansiz.join(", ")} ⇒ gün anahtarını ${"`factoryYmd`/`ddmmyy`"} ile kur, ya da ` +
          "ANAHTAR_TABAN'a GEREKÇESİYLE yaz (sabiti yönetici oturum yazar)",
  );
  check(
    "§1b ⭐ beyan BAYAT değil (borç kapandıysa girdi de kapanır)",
    k.bayat.length === 0,
    k.bayat.length === 0 ? "beyan taze" : `${k.bayat.join(", ")} ⇒ sınıftan ÇIKTI, ANAHTAR_TABAN'dan SİL`,
  );
  check(
    "§1c beyan ADEDİ gerçekle aynı",
    k.adetSapan.length === 0,
    k.adetSapan.length === 0 ? "adetler eşit" : `${k.adetSapan.join(" · ")} ⇒ beyanı tazele`,
  );
  for (const [f, v] of Object.entries(ANAHTAR_TABAN).sort()) {
    if (anahtar[f] !== undefined) console.log(`   ↳ ${f} (${v.adet}): ${v.gerekce}`);
  }
  console.log("");

  // ── §2 DİĞER SINIFI — CIRCIR ──────────────────────────────────────────────
  console.log("§2 — DİĞER sınıfı (gösterim) cırcırı");
  check(
    "§2a ARTMADI",
    digerSatir <= DIGER_TABAN,
    digerSatir <= DIGER_TABAN ? `${digerSatir} ≤ ${DIGER_TABAN}` : `${digerSatir} > ${DIGER_TABAN} ⇒ YENİ ihlal eklendi`,
  );
  curumeKolu(check, ATLAMA.atla, "§2b ⭐ taban ÇÜRÜMEDİ (düştüyse sabiti yönetici indirir)", digerSatir, DIGER_TABAN);
  console.log("");

  // ── §3 SONDALAR — sınıflandırıcının kendisi ───────────────────────────────
  console.log("§3 — sondalar (sınıflandırıcı)");
  check(
    "§3a ⭐ ayraçsız birleştirme ANAHTAR",
    satirSinifi("const s = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;") === "anahtar",
  );
  check(
    "§3b ⭐ noktalı birleştirme GÖSTERİM",
    satirSinifi("return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;") === "diger",
  );
  check("§3c tek erişimci GÖSTERİM", satirSinifi("const yy = d.getFullYear();") === "diger");
  check(
    "§3d ⭐ getUTC* SAYILMAZ (zıt sınıf, bilinçli UTC)",
    satirSinifi("Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() + 1)") === null,
    "ilk taramamda alt dizgi olarak sayılıyordu",
  );
  check("§3e satır-içi yorum sayılmaz", satirSinifi("const x = 1; // d.getFullYear() eski hâli") === null);
  check("§3f blok yorumu gövdesi sayılmaz", satirSinifi(" * Eski hâli `date.getFullYear()` idi") === null);
  check("§3g tarih olmayan satır null", satirSinifi("const a = b.getTotal();") === null);
  // ⭐ CIRCIR KOLLARI (K) SINIFINA ÇEVRİLDİ (1e hükmü 2026-09-14): karar saf
  // fonksiyonda olduğu için üç yönü SENTETİK girdiyle burada, HER KOŞUMDA
  // ölçülür. Eskiden yalnız dosya dışında koşulup GERİ ALINMIŞ bir mutasyon
  // zinciriyle gösterilebiliyordu — o kanıt bir daha koşmaz.
  check(
    "§3j ⭐ ARTIŞ kolu: beyansız dosya KIRMIZI verir",
    beyanKarari({ "yeni.ts": 1 }, {}).beyansiz.join() === "yeni.ts",
  );
  check(
    "§3k ⭐ DÜŞÜŞ kolu: kapanan borç BAYAT beyan olur",
    beyanKarari({}, { "kapandi.ts": 1 }).bayat.join() === "kapandi.ts",
  );
  check(
    "§3l ⭐ ADET sapması yakalanır (aynı dosya, farklı sayı)",
    beyanKarari({ "a.ts": 2 }, { "a.ts": 1 }).adetSapan[0]?.startsWith("a.ts (2 ↔ beyan 1)") === true,
  );
  check(
    "§3m beyanlı + eşit ⇒ üç liste de BOŞ (yanlış pozitif yok)",
    (() => {
      const r = beyanKarari({ "a.ts": 1 }, { "a.ts": 1 });
      return r.beyansiz.length === 0 && r.bayat.length === 0 && r.adetSapan.length === 0;
    })(),
  );
  // ⭐ ÇÜRÜME KOLUNUN KİP DALI — `curumeKolu` enjekte edilmiş `check`/`atla` ile
  // ölçülür: kapı kipinde ATLAR (çıkış 0), bayraksız SERT kalır.
  {
    const izKapi: string[] = [];
    const izCI: string[] = [];
    const eski = process.env.TEKSERP_KAPI_ADIMI;
    process.env.TEKSERP_KAPI_ADIMI = "commit";
    curumeKolu(() => izKapi.push("check"), () => izKapi.push("atla"), "sonda", 5, 9);
    delete process.env.TEKSERP_KAPI_ADIMI;
    curumeKolu((_l, ok) => izCI.push(ok ? "yeşil" : "kırmızı"), () => izCI.push("atla"), "sonda", 5, 9);
    if (eski === undefined) delete process.env.TEKSERP_KAPI_ADIMI;
    else process.env.TEKSERP_KAPI_ADIMI = eski;
    check("§3n ⭐ çürüme: kapı kipinde ATLAR (uyarı)", izKapi.join() === "atla", izKapi.join() || "-");
    check("§3o ⭐ çürüme: bayraksız SERT (kırmızı)", izCI.join() === "kırmızı", izCI.join() || "-");
  }
  check(
    "§3h ⭐ tek kaynak çağrısı TEMİZ sayılır",
    satirSinifi("const ymd = factoryYmd(date);") === null,
    "çare, kapının kendisinden geçmeli",
  );
  console.log("");

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
