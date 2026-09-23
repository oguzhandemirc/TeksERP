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

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
