// =============================================================================
// TARİH SEGMENTİ AYNASI — sunucu `DATE_SEGMENTS` ↔ istemcilerin `DATE_LEN`
//
// NEDEN VAR (ölçüldü 2026-09-23, D5①): bir tarih segmentinin KAÇ HANE olduğu
// bilgisi ÜÇ projede ayrı ayrı yazılıydı (backend `series-format.helper.ts`,
// `Electron/src/lib/scanner/barcode-kind.ts`, `mobil/src/services/
// scanSeries.service.ts`) ve bunları karşılaştıran HİÇBİR bekçi yoktu. Sapma
// sessizdir: istemci kodu yanlış uzunlukla parçalar, sayaç kuyruğunu tarih
// hanesi sanar ve barkodu YANLIŞ türe çözer — hata mesajı çıkmaz.
//
// ⚠️ DÖRDÜNCÜ AYNA PANELDİR (§5): segment bir enum değeri, panelin seçenek
// listesi ise ELLE yazılmış bir allowlist. Yeni segment enum'a, tabloya ve iki
// istemciye girip panelde SEÇİLEMEZ kalabilir — hiçbir şey kırmızı vermez,
// çünkü liste kendi içinde tutarlıdır. Reçetenin "sabit allowlist arama"
// maddesinin (§ enum, 10b) bu ekrandaki karşılığı.
//
// ⚠️ SUNUCU TARAFI METİNDEN DEĞİL ÇALIŞMA ZAMANINDAN okunur (gerçek `import`).
// İstemci tarafı metinden okunur çünkü o projelerin derleyicisi burada yok;
// ama ayrıştırıcı YORUMLARI SOYAR — bir tarayıcı, kuralı ANLATAN yorumu değil
// KODU ölçmelidir.
//
// ⚠️ ÜÇÜNCÜ SONUÇ: dosya yoksa ya da harita ayrıştırılamıyorsa sonuç "uyumlu"
// DEĞİL "ÖLÇÜLEMEDİ"dir ve kırmızı verir. "Araç yok" ile "araç uyumlu" aynı
// sayılırsa kapı, çözdüğünden büyük bir arıza üretir.
//
// NEGATİF SONDALAR (ölçüldü 2026-09-23; her biri bozuldu → KIRMIZI → geri
// yüklendi → `cmp` ile birebirlik doğrulandı):
//   ① Electron `YYMM: 4 → 5`      → §1a kırmızı (eksik YYMM=4 · fazla YYMM=5)
//   ② mobil `YYYYMM` satırı silindi → §1b kırmızı (eksik YYYYMM=6)
//   ③ Electron `filter(isRow)` → `every(isRow)` → §2a kırmızı
//   ④ mobil `DATE_LEN` → `DATE_UZUNLUK` → §1b "ÖLÇÜLEMEDİ" kırmızısı
//   ⑤ sunucuda `MMYY.len: 4 → 6`     → §3 kırmızı (beyan 6, üretilen 4) + §1 ×2
//   ⑥ Electron `fullFormat`tan `separator2` tamamen çıkarıldı → §4a kırmızı ×2
//   ⑦ panelden `MMYY` seçeneği silindi → §5 kırmızı (panelde eksik: MMYY)
//   ⑧ `SEGMENTLER` → `SEGMENT_LISTESI` → §5 "ÖLÇÜLEMEDİ" kırmızısı
//
// ⚠️ ⑥ İLK YAZIMDA ISIRMADI ve sebebi bir YÜKLEM SINIRI hatasıydı: `separator2`yi
// DOSYANIN TAMAMINDA arıyordum, `ScanSeriesRow` arayüzü onu hâlâ beyan ettiği
// için iddia yeşil kaldı. Yüklem `fullFormat` GÖVDESİNE daraltıldı — soru
// "dosya bu alanı tanıyor mu" değil, "REGEX'İ KURAN YOL onu okuyor mu".
//
// Koşum: npx tsx scripts/test_tarih_segmenti_aynasi.ts
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DATE_SEGMENTS } from "../src/services/helpers/series-format.helper";

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

const ELECTRON = path.resolve(__dirname, "../../Electron/src/lib/scanner/barcode-kind.ts");
const MOBIL = path.resolve(__dirname, "../../mobil/src/services/scanSeries.service.ts");
const PANEL_ALANLAR = path.resolve(
  __dirname,
  "../../Electron/src/pages/GeneralSettings/Numbering/NumberingFields.tsx",
);

/**
 * Yorumlar soyulur — bir tarayıcı, kuralı ANLATAN metni değil KODU ölçmelidir.
 *
 * ⚠️ BLOK yorum da soyulur, yalnız satır yorumu değil: ilk yazımda yalnız `//`
 * soyuyordum ve §2'nin kendi açıklaması (`rows.every(isRow)` idi …) bir JSDoc
 * bloğunda geçtiği için iki iddia KIRMIZI verdi. Aynı sınıf dördüncü kez
 * yakalandı; ayrıştırıcı, ölçtüğü dilin yorum kurallarının HEPSİNİ bilmeli.
 */
function kodSatirlari(kaynak: string): string {
  return kaynak
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * `const DATE_LEN: Record<ScanDateSegment, number> = { … };` gövdesini okur.
 * Bulamazsa `null` döner — ÖLÇÜLEMEDİ, boş harita DEĞİL.
 */
export function istemciHaritasi(kaynak: string): Map<string, number> | null {
  const m = kodSatirlari(kaynak).match(/const DATE_LEN[^=]*=\s*\{([^}]*)\}/m);
  if (!m) return null;
  const out = new Map<string, number>();
  for (const satir of m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) out.set(satir[1], Number(satir[2]));
  return out.size > 0 ? out : null;
}

function karsilastir(ad: string, dosya: string): void {
  if (!existsSync(dosya)) {
    check(`${ad} ⭐ ÖLÇÜLEMEDİ: dosya yok (${path.basename(dosya)}) — "uyumlu" DEĞİL`, false);
    return;
  }
  const harita = istemciHaritasi(readFileSync(dosya, "utf-8"));
  if (!harita) {
    check(`${ad} ⭐ ÖLÇÜLEMEDİ: \`DATE_LEN\` haritası ayrıştırılamadı — "uyumlu" DEĞİL`, false);
    return;
  }
  const sunucu = Object.entries(DATE_SEGMENTS).map(([k, v]) => `${k}=${v.len}`).sort();
  const istemci = [...harita.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const eksik = sunucu.filter((s) => !istemci.includes(s));
  const fazla = istemci.filter((s) => !sunucu.includes(s));
  check(`${ad} ⭐ segment uzunlukları sunucuyla BİREBİR`,
    eksik.length === 0 && fazla.length === 0,
    eksik.length + fazla.length === 0
      ? `${istemci.length} segment`
      : `istemcide eksik: ${eksik.join(",") || "-"} · fazla: ${fazla.join(",") || "-"}`);
  // ⚠️ KÖRLÜK ZEMİNİ: iki taraf da boşsa "birebir" değil, ölçülemedi demektir.
  check(`${ad} körlük zemini: harita gerçekten dolu (vakumen yeşil değil)`,
    harita.size >= 5, `${harita.size} satır`);
}

/**
 * Sunucu tablosu HEP-YA-HİÇ reddedilmemeli (D5① kararı).
 *
 * Ölçüm 2026-09-23: iki istemci de `rows.every(isRow)` kullanıyordu; tanımadığı
 * TEK bir satır (ör. yeni bir `dateSegment`) tablonun TAMAMINI reddettiriyor ve
 * istemci anladığı serileri de kaybedip bayat yedeğe düşüyordu. Artık satır
 * bazında elenir. Bu bekçi eski kalıbın geri gelmesini engeller.
 */
function satirBazindaEleme(ad: string, dosya: string): void {
  if (!existsSync(dosya)) {
    check(`${ad} ⭐ ÖLÇÜLEMEDİ: dosya yok`, false);
    return;
  }
  const kod = kodSatirlari(readFileSync(dosya, "utf-8"));
  check(`${ad} ⭐ tanınmayan satır TABLOYU düşürmüyor (\`every(isRow)\` yok)`,
    !kod.includes("every(isRow)"));
  check(`${ad} körlük zemini: eleme gerçekten yapılıyor (\`filter(isRow)\` var)`,
    kod.includes("filter(isRow)"));
}

console.log("=== TARİH SEGMENTİ AYNASI ===\n");
console.log(`sunucu: ${Object.entries(DATE_SEGMENTS).map(([k, v]) => `${k}=${v.len}`).join(" ")}\n`);

console.log("── §1 AYNA: uzunluk haritaları ──");
karsilastir("§1a Electron", ELECTRON);
karsilastir("§1b mobil", MOBIL);

console.log("\n── §2 HEP-YA-HİÇ DEĞİL: satır bazında eleme ──");
satirBazindaEleme("§2a Electron", ELECTRON);
satirBazindaEleme("§2b mobil", MOBIL);

/**
 * Beyan edilen uzunluk ile ÜRETİLEN metin aynı mı?
 *
 * ⚠️ `len` ile `render` aynı kararın iki yüzü ama AYRI yazılıyor; biri yanlış
 * girilirse üretici doğru kodu yazar, eşleştirici YANLIŞ uzunluk arar ve
 * sonuç "ürettiğim kod kendi serime uymuyor" olur — sessiz, çünkü iki yol da
 * kendi içinde tutarlı. Bu iddia yeni bir segmentin hatalı `len` ile
 * doğmasını ilk koşumda yakalar.
 */
function uzunlukTutarliligi(): void {
  // Ay ≠ gün ≠ yıl olan bir gün seçilir: 23 Eylül 2026. Hepsi aynı olsaydı
  // (ör. 01.01.2001) yanlış SIRA yazılmış bir render da doğru görünürdü.
  const gun = new Date("2026-09-23T10:00:00+03:00");
  const sapan = Object.entries(DATE_SEGMENTS)
    .filter(([, v]) => v.render(gun).length !== v.len)
    .map(([k, v]) => `${k}: beyan ${v.len}, üretilen ${v.render(gun).length}`);
  check("§3 ⭐ her segmentin ÜRETTİĞİ metin beyan ettiği uzunlukta",
    sapan.length === 0, sapan.join(" · ") || `${Object.keys(DATE_SEGMENTS).length} segment`);
}

/**
 * İkinci eklem (tarih|sayaç) istemcilerde de OKUNUYOR mu? (D5②)
 *
 * ⚠️ Bu iddia `separator2`nin DEĞERİNİ değil, istemcinin o alanı hiç GÖRÜP
 * görmediğini ölçer — sunucu ayrı bir ayraçla kod üretirken istemcinin iki
 * eklemde de `separator` kurması sessiz bir yanlış sınıflandırmadır ve
 * bugünkü verilerde (hepsi null) HİÇ görünmez. Kapının bakması gereken an,
 * alanın ilk kez kullanıldığı an değil, ŞİMDİ.
 */
function ikinciEklem(ad: string, dosya: string): void {
  if (!existsSync(dosya)) {
    check(`${ad} ⭐ ÖLÇÜLEMEDİ: dosya yok`, false);
    return;
  }
  const kod = kodSatirlari(readFileSync(dosya, "utf-8"));
  // ⚠️ YÜKLEM SINIRI BEYANLI — dosyanın TAMAMINDA `separator2` aramak SAHTE
  // YEŞİL veriyordu (ölçüldü: `fullFormat`tan alanı tamamen çıkardım, iddia
  // yine yeşil kaldı çünkü `ScanSeriesRow` ARAYÜZÜ onu hâlâ beyan ediyor).
  // Soru "dosya bu alanı tanıyor mu" değil, "REGEX'İ KURAN YOL onu okuyor mu".
  const govde = kod.match(/function fullFormat\([\s\S]*?\n\}/)?.[0] ?? null;
  if (govde === null) {
    check(`${ad} ⭐ ÖLÇÜLEMEDİ: \`fullFormat\` gövdesi bulunamadı`, false);
    return;
  }
  check(`${ad} ⭐ tam-format regex'i \`separator2\`yi okuyor`, govde.includes("separator2"));
  // ⚠️ İDDİA DEĞİŞTİ ve sebebi bir SONDA BULGUSU: önce "tarih yokken tek eklemi
  // `separator` kurar" diye ayrı bir dal arıyordum. O dal hem sunucuda hem
  // istemcide ÖLÜ KODDU — kaldırınca hiçbir iddia kırmızı vermedi, çünkü
  // `head` tarih boşken ikinci eklemi zaten hiç kurmuyor. Ölçülebilir olan
  // gerçek kural bu: `separator2` yoksa `separator`a DÜŞÜLÜR (fail-safe).
  check(`${ad} ⭐ \`separator2\` yokken \`separator\`a düşüyor (sunucudaki \`seriesJoints\` kuralı)`,
    /row\.separator2\s*\?\?\s*row\.separator(?![\w])/.test(govde));
}

console.log("\n── §3 BEYAN ↔ ÜRETİM ──");
uzunlukTutarliligi();

console.log("\n── §4 İKİNCİ EKLEM (separator2) ──");
ikinciEklem("§4a Electron", ELECTRON);
ikinciEklem("§4b mobil", MOBIL);

/**
 * Panelin segment SEÇENEKLERİ eksiksiz mi? (Reçete § enum, 10b maddesi)
 *
 * ⚠️ `SEGMENTLER` elle yazılmış bir ALLOWLIST'tir: yeni bir segment enum'a
 * girer, `DATE_SEGMENTS`e girer, istemci haritalarına girer — ve panelde
 * SEÇİLEMEZ kalır. Hiçbir şey kırmızı vermez, çünkü liste kendi içinde
 * tutarlıdır. Yalnız kullanıcı "yeni biçim geldi ama ben seçemiyorum" der.
 * Bu, "kaydedilen ama görünmeyen kayıt" sınıfının seçenek tarafıdır.
 */
function panelSecenekleri(): void {
  if (!existsSync(PANEL_ALANLAR)) {
    check("§5 ⭐ ÖLÇÜLEMEDİ: panel alan dosyası yok", false);
    return;
  }
  const kod = kodSatirlari(readFileSync(PANEL_ALANLAR, "utf-8"));
  const govde = kod.match(/const SEGMENTLER[\s\S]*?\n\];/)?.[0] ?? null;
  if (govde === null) {
    check("§5 ⭐ ÖLÇÜLEMEDİ: `SEGMENTLER` listesi ayrıştırılamadı", false);
    return;
  }
  const panelde = new Set([...govde.matchAll(/value:\s*"(\w+)"/g)].map((m) => m[1]));
  const sunucuda = Object.keys(DATE_SEGMENTS);
  const eksik = sunucuda.filter((s) => !panelde.has(s));
  const fazla = [...panelde].filter((s) => !sunucuda.includes(s));
  check("§5 ⭐ panelde HER segment seçilebiliyor (elle allowlist bayatlamamış)",
    eksik.length === 0 && fazla.length === 0,
    eksik.length + fazla.length === 0
      ? `${panelde.size} seçenek`
      : `panelde eksik: ${eksik.join(",") || "-"} · fazla: ${fazla.join(",") || "-"}`);
  check("§5 körlük zemini: seçenek listesi gerçekten dolu", panelde.size >= 5, `${panelde.size} seçenek`);
}

console.log("\n── §5 PANEL SEÇENEKLERİ ──");
panelSecenekleri();

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
