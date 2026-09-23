// =============================================================================
// NUMARA SERİSİ ÇAĞRISI MODÜL YÜKLENİRKEN KOŞMAZ (2026-09-23)
// =============================================================================
// ⭐ SAHA BULGUSU: `traveler-card.service.ts` örnek barkodu modül düzeyinde
//    türetiyordu (`const X = previewSeriesCode(resolveSeriesFormat("workOrder"), 1)`).
//    İKİ ayrı zarar verdi ve ikisi de SESSİZDİ:
//      ① Önbellek o anda BOŞ: senkron okuma katalog TOHUMUNA düşer (beyanlı
//         fail-safe) ⇒ örnek, fabrikanın GERÇEK ön ekini hiç göstermez ve bir
//         daha da değişmez. Yani "literal yazma, seriden türet" kuralı biçimsel
//         olarak sağlanır ama AMACINA ULAŞMAZ — en kötü tür yeşil.
//      ② Boş önbellek modül yüklenirken arka planda 52 seriyi tazeler (~55
//         SELECT) ⇒ sorgu bütçesi bekçisinin penceresine taşar (d3 ölçtü:
//         beklenen 64, ölçülen 72-95) ve arıza BAŞKA bir bekçide görünür.
//
// SORU: bu çağrılar bir FONKSİYON GÖVDESİNİN içinde mi (istek anı), yoksa modül
// yüklenirken mi koşuyor? Getter (`get x() { … }`) de fonksiyondur — erteleme
// için meşru ve bu depoda kullanılan yol.
//
// KAPSAM: `Teks-Erp/src` altındaki tüm `.ts`. Tanım satırları (fonksiyonun
// KENDİSİ) doğal olarak kapsam dışıdır: aranan şey ÇAĞRIDIR.
// Koşum: npx tsx scripts/run-all-tests.ts seri_modul_yuklemesi
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SRC = join(__dirname, "..", "src");

/** Önbelleğe/seri tablosuna uzanan ve yüklemede koşmaması gereken çağrılar. */
const ERTELENMELI = new Set([
  "resolveSeriesFormat",
  "previewSeriesCode",
  "seriesPrefix",
  "buildSeriesCode",
  "seriesSeqFrom",
  "nextSeriesNo",
  "seriesClassifierTable",
  "classifyScannedCode",
]);

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) out.push(...tsDosyalari(tam));
    else if (ad.endsWith(".ts") && !ad.endsWith(".d.ts")) out.push(tam);
  }
  return out;
}

/** Düğüm bir FONKSİYON gövdesinin içinde mi? (getter ve metot dahil) */
function fonksiyonIcinde(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isConstructorDeclaration(p)
    ) {
      return true;
    }
  }
  return false;
}

export interface Bulgu {
  dosya: string;
  satir: number;
  ad: string;
}

export function yuklemedeKosanlar(dosyalar: string[]): Bulgu[] {
  const out: Bulgu[] = [];
  for (const yol of dosyalar) {
    const metin = readFileSync(yol, "utf-8");
    // Ucuz ön eleme: dosyada bu adlardan biri geçmiyorsa AST kurma.
    if (![...ERTELENMELI].some((ad) => metin.includes(ad))) continue;
    const sf = ts.createSourceFile(yol, metin, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const gez = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const ad = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "";
        if (ERTELENMELI.has(ad) && !fonksiyonIcinde(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({ dosya: relative(join(__dirname, ".."), yol), satir: line + 1, ad });
        }
      }
      ts.forEachChild(node, gez);
    };
    gez(sf);
  }
  return out;
}

function main(): void {
  console.log("=== Numara serisi çağrısı modül yüklenirken koşmaz ===\n");
  const dosyalar = tsDosyalari(SRC);
  check("körlük zemini: kaynak dosyalar tarandı", dosyalar.length > 100, `${dosyalar.length} dosya`);

  // ⚠️ GÖMÜLÜ SONDA: tarayıcı bozulursa "0 bulgu" ile "hiç bakılmadı" aynı
  // görünür. İki sentetik dosya, aracın kendi içinde ölçülür.
  let sondaGecti = false;
  {
    const kotu = ts.createSourceFile(
      "kotu.ts",
      'const X = previewSeriesCode(resolveSeriesFormat("workOrder"), 1);\n',
      ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
    );
    const iyi = ts.createSourceFile(
      "iyi.ts",
      'function f() { return previewSeriesCode(resolveSeriesFormat("workOrder"), 1); }\n' +
        'const O = { get x() { return resolveSeriesFormat("sack"); } };\n',
      ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS,
    );
    const say = (sf: ts.SourceFile): number => {
      let n = 0;
      const gez = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const ad = ts.isIdentifier(node.expression) ? node.expression.text : "";
          if (ERTELENMELI.has(ad) && !fonksiyonIcinde(node)) n++;
        }
        ts.forEachChild(node, gez);
      };
      gez(sf);
      return n;
    };
    sondaGecti = say(kotu) === 2 && say(iyi) === 0;
  }
  check("⭐ gömülü sonda: tarayıcı modül düzeyini fonksiyondan AYIRT EDİYOR", sondaGecti);

  const bulgular = yuklemedeKosanlar(dosyalar);
  check(
    "⭐ numara serisi çağrısı modül yüklenirken KOŞMUYOR (önbellek boşken tohuma donar + gizli SELECT)",
    bulgular.length === 0,
    bulgular.map((b) => `${b.dosya}:${b.satir} ${b.ad}`).join(" · ") || `${dosyalar.length} dosya temiz`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: çağrıyı bir fonksiyonun içine al (getter de olur). Modül düzeyinde\n" +
        "türetilen bir örnek, önbellek boşken KATALOG TOHUMUNA donar ve fabrikanın\n" +
        "gerçek ön ekini bir daha hiç göstermez — üstelik yükleme anında DB'ye gider.",
    );
  }
  process.exit(fail > 0 ? 1 : 0);
}

main();
