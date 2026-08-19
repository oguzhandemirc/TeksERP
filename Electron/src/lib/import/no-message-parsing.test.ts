import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// =============================================================================
// STATİK BEKÇİ — mesaj ayrıştırması yaratma yoluna geri SIZMASIN
// =============================================================================
// `issueValue()` Türkçe hata cümlesinden değeri regex'le çeker. Bu, GÖSTERİM
// katmanında meşru (aynı değerin tekrar eden hatalarını tek satırda toplamak).
// YARATMA yolunda ise sessiz bir arıza yoludur ve dördü de gerçek:
//
//   • gruplu adaptörde mesaj "7. satır: 'MAVI' …" — yanlış satır düzeltilir
//   • aynı sütun belirsiz-ad / PASİF kayıt hataları da üretir; onlarda
//     yaratmak mükerrer doğurur (`assertNameAvailable`'ın engellediği şey)
//   • çoklu sütunda hata HÜCRE değil ELEMAN düzeyinde
//   • cümle değişince regex sessizce boş döner — hata yok, düğme yok
//
// Bu yüzden sözleşme YAPISAL: değer yalnız sunucunun `issue.fix.value`
// alanından okunur. Bu test o kararı kilitler — kolay kaybedilen türden,
// çünkü `issueValue` zaten dosyanın yanında duruyor ve "hazır" görünüyor.

const IMPORT_DIRS = ["src/lib/import", "src/components/import"];

/** `issueValue`'yu import etmesi MEŞRU olan tek yer: kendi testi. */
const ALLOWED = new Set(["src/lib/import/group-issues.test.ts"]);

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? collect(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("mesaj ayrıştırması sınırı", () => {
  const files = IMPORT_DIRS.flatMap(collect).filter(
    // Tanımın kendi dosyası kapsam dışı (orada yaşıyor).
    (f) => !f.endsWith("group-issues.ts"),
  );

  it("körlük zemini: dosyalar gerçekten taranıyor", () => {
    // Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile
    // çıkardı. Bugün 15+ dosya var; eşik kasıtlı olarak düşük.
    expect(files.length).toBeGreaterThan(10);
  });

  it("issueValue YALNIZ kendi testinden import edilir", () => {
    // Ölçüm İMPORT'tadır, "anma"da değil: bu bekçinin kendisi sembolü adıyla
    // anmak ZORUNDA. `issueValue` modül dışına yalnız import ile çıkabilir.
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f)) return false;
      const src = readFileSync(f, "utf8");
      return /import\s*\{[^}]*\bissueValue\b[^}]*\}\s*from/s.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("yaratma bileşeni hata MESAJINA hiç bakmaz", () => {
    const src = readFileSync("src/components/import/QuickCreateLookup.tsx", "utf8");
    expect(src).not.toMatch(/\bissue\.message\b|\bmessage\.match\b/);
  });
});
