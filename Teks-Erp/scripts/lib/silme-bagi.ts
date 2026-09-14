// =============================================================================
// SİLME YÜKLEMİNİN BAĞI — "bu silme KİMLİĞE mi, ADA mı dayanıyor?"
// =============================================================================
// NEDEN: `scripts/` altındaki teardown'lar defter satırı siler ve bu MEŞRUDUR —
// fikstürünü toplayan bekçi kendi ürettiğini geri alır. Ama muafiyeti DOSYA
// düzeyinde vermek evreni yutar: `test_*.ts` blanket muaf olursa kapı "scripts/i
// yürüdüm" der ve hiçbir şey ölçmez.
//
// Ölçüt DOSYA değil YÜKLEMDİR: silme, dosyanın KENDİ ürettiği kimliklere bağlıysa
// muaftır; ada/öneke dayanıyorsa değildir — çünkü ad bazlı yüklem sınırını beyan
// etmez ve iki yönden de yanılır: komşunun satırını siler, ya da (ölçüldü
// `cb4c8ac8`) kendi ürettiğini bile bulamaz ve kalıntı bırakır.
// =============================================================================
import { relative } from "node:path";
import * as ts from "typescript";

/** Satır SİLEN delegate metotları. */
export const SILEN_METOD = new Set(["delete", "deleteMany"]);

/**
 * Yüklemi SINIRSIZ yapan Prisma dizge süzgeçleri. `not` BURADA DEĞİLDİR:
 * `{ reversesTxnId: { not: null } }` bir ad yüklemi değil, bir varlık yüklemidir.
 */
export const SINIRSIZ_ANAHTAR = new Set(["startsWith", "endsWith", "contains", "search", "mode"]);

/** Teardown sayılan fonksiyon adı önekleri — BEYAN; ölü ad kapıda kırmızı verir. */
export const TEARDOWN_ADLARI = ["temizle", "temizlik", "cleanup", "teardown"];

export type SilmeBagi = "KIMLIK" | "SINIRSIZ" | "BOS" | "OLCULEMEDI";

export interface SilmeYeri {
  model: string;
  dosya: string;
  satir: number;
  metod: string;
  bag: SilmeBagi;
  /** Sınıfın GEREKÇESİ — hangi yaprak sınırsız yaptı. */
  not: string;
  /** Teardown bağlamının adı; `null` ise teardown DIŞINDA. */
  teardown: string | null;
}

type YaprakSinifi = "YEREL_KIMLIK" | "YEREL_AD" | "DISARIDAN" | "COZULEMEDI";

/**
 * Destructure edilen bağın kaynağı ÇALIŞMA ANINDA mı üretiliyor?
 *
 * `const { rollIds } = await createFixture()` → evet (doğrudan).
 * `const fx = await createFixture(); const { rollIds } = fx;` → evet (BİR sıçrama).
 * `const { rollIds } = SABIT_LISTE;` → HAYIR — ölçülemedi kalır.
 *
 * Sıçrama BİR ile sınırlı ve yalnız AYNI dosyada: sınırsız zincir izlemek, kuralı
 * "her destructure kimliktir"e çevirirdi ve ad bazlı yüklem sızardı.
 */
function calismaAniKabiMi(be: ts.BindingElement, sf: ts.SourceFile, checker: ts.TypeChecker): boolean {
  let n: ts.Node = be;
  while (n.parent && !ts.isVariableDeclaration(n.parent)) n = n.parent;
  const vd = n.parent;
  if (!vd || !ts.isVariableDeclaration(vd)) return false;
  const init = vd.initializer;
  if (!init) return false;
  const uretim = (e: ts.Expression): boolean =>
    ts.isAwaitExpression(e) || ts.isCallExpression(e) || ts.isNewExpression(e);
  if (uretim(init)) return true;
  if (!ts.isIdentifier(init)) return false;
  // TEK SIÇRAMA: `fx` gibi bir ara değişken, aynı dosyada üretime bağlıysa.
  const d = checker.getSymbolAtLocation(init)?.declarations?.[0];
  if (!d || d.getSourceFile().fileName !== sf.fileName || !ts.isVariableDeclaration(d)) return false;
  return d.initializer !== undefined && uretim(d.initializer);
}

function yaprakSinifi(id: ts.Identifier, sf: ts.SourceFile, checker: ts.TypeChecker): YaprakSinifi {
  // ⚠️ SHORTHAND (`where: { itemId }`) ayrı bir sembol sorusudur: `getSymbolAtLocation`
  // burada PROPERTY sembolünü döndürür (bildirimi kısayolun kendisi), değişkeninkini
  // değil ⇒ her shorthand "çözülemedi"ye düşerdi. Değer sembolü ayrı API ile alınır.
  const sembol = ts.isShorthandPropertyAssignment(id.parent)
    ? checker.getShorthandAssignmentValueSymbol(id.parent)
    : checker.getSymbolAtLocation(id);
  const bildirim = sembol?.declarations?.[0];
  if (!bildirim) return "COZULEMEDI";
  if (bildirim.getSourceFile().fileName !== sf.fileName) return "DISARIDAN";
  if (ts.isImportSpecifier(bildirim) || ts.isImportClause(bildirim)) return "DISARIDAN";
  if (ts.isParameter(bildirim)) return "YEREL_KIMLIK";
  // ⚠️ DESTRUCTURE bir KAP'tır, ad değil: `const { rollIds } = await fikstürKur()`.
  // Kaynağı ÇALIŞMA ANINDA üretiliyorsa (await/çağrı) içindeki değerler bu dosyanın
  // kendi ürettiği kimliklerdir. Kural DAR: kaynak literal ya da ad sabitiyse yine
  // ÖLÇÜLEMEDİ — sızmasın diye en fazla BİR sıçrama izlenir.
  if (ts.isBindingElement(bildirim)) return calismaAniKabiMi(bildirim, sf, checker) ? "YEREL_KIMLIK" : "COZULEMEDI";
  if (!ts.isVariableDeclaration(bildirim)) return "COZULEMEDI";
  // ⚠️ `let woId = ""` bir AD DEĞİLDİR — sonradan gerçek id atanan bir KAPtır.
  // Yalnız `const X = "…"` (boş olmayan literal) ad bazlı yüklemdir.
  const sabit = ts.isVariableDeclarationList(bildirim.parent) && (bildirim.parent.flags & ts.NodeFlags.Const) !== 0;
  const init = bildirim.initializer;
  const literal =
    init !== undefined &&
    (ts.isStringLiteral(init) || ts.isTemplateExpression(init) || ts.isNoSubstitutionTemplateLiteral(init));
  if (!sabit || !literal) return "YEREL_KIMLIK";
  const govde = init.getText(bildirim.getSourceFile()).replace(/[`'"]/g, "");
  return govde.length > 0 ? "YEREL_AD" : "YEREL_KIMLIK";
}

/** `where` ifadesinin BAĞ sınıfı. SAF: girdi AST + checker, çıktı karar. */
export function bagSinifi(
  where: ts.Expression | undefined,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): { bag: SilmeBagi; not: string } {
  if (!where) return { bag: "BOS", not: "`where` YOK — tüm tabloyu hedefler" };
  if (!ts.isObjectLiteralExpression(where)) {
    return { bag: "OLCULEMEDI", not: "`where` nesne literali değil (değişken/çağrı) — içeriği AST'den çözülmedi" };
  }
  if (where.properties.length === 0) return { bag: "BOS", not: "`where: {}` — tüm tabloyu hedefler" };

  let sinirsiz = false;
  let kimlik = false;
  let cozulemedi = false;
  const notlar: string[] = [];
  const gez = (n: ts.Node, yol: string): void => {
    if (ts.isPropertyAssignment(n)) {
      const ad = ts.isIdentifier(n.name) ? n.name.text : n.name.getText(sf);
      if (SINIRSIZ_ANAHTAR.has(ad)) { sinirsiz = true; notlar.push(`${yol}.${ad}`); }
      gez(n.initializer, ad);
      return;
    }
    if (ts.isShorthandPropertyAssignment(n)) { gez(n.name, n.name.text); return; }
    if (ts.isObjectLiteralExpression(n)) { n.properties.forEach((p) => gez(p, yol)); return; }
    if (ts.isArrayLiteralExpression(n)) { n.elements.forEach((e) => gez(e, yol)); return; }
    if (ts.isStringLiteral(n) || ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      sinirsiz = true; notlar.push(`${yol}=<literal>`); return;
    }
    if (ts.isIdentifier(n)) {
      const s = yaprakSinifi(n, sf, checker);
      if (s === "YEREL_KIMLIK") kimlik = true;
      else if (s === "YEREL_AD") { sinirsiz = true; notlar.push(`${yol}=${n.text}(ad sabiti)`); }
      else cozulemedi = true;
      return;
    }
    n.forEachChild((c) => gez(c, yol));
  };
  where.properties.forEach((p) => gez(p, "where"));

  if (sinirsiz) return { bag: "SINIRSIZ", not: notlar.slice(0, 3).join(" · ") };
  if (kimlik) return { bag: "KIMLIK", not: "" };
  if (cozulemedi) return { bag: "OLCULEMEDI", not: "yaprak dosya DIŞINA çözüldü ya da hiç çözülemedi" };
  return { bag: "OLCULEMEDI", not: "yaprak sınıflanamadı" };
}

/**
 * DOSYA DÜZEYİ TEMİZLİK BEYANI — işaretin kendisi, merkezî bir liste DEĞİL.
 *
 * Bazı script'lerin TAMAMI temizliktir: artık süpürücü (`clean_test_residue`), ve
 * önceki kesilmiş koşumunun kendi damgasını silip senaryoyu yeniden kuran denetim
 * repro'ları. Bunlarda silme "testin sonunda" değil BAŞINDA ya da turlar arasında
 * durur; `finally`/`cleanup` kalıbı bu dosyalara YANLIŞ oturur.
 *
 * ⚠️ BEYAN MUAFİYET DEĞİLDİR ve kapsamı DAR: yalnız "teardown bağlamı mı" sorusunu
 * cevaplar. Yüklem sorusu (§10b1 — ada/öneke dayanan silme) beyanla DEĞİŞMEZ; işaretli
 * bir dosyada sınırsız yüklem yine kırmızıdır. Beyan sayısı kapıda GÖRÜNÜR basılır ve
 * kendi cırcırını taşır, yani "işaret koyup sus" sessizce ucuzlamaz.
 *
 * İşaret dosyanın İLK 30 satırında olmalı: aşağıya gömülmüş bir beyan, okuyanın
 * görmediği bir beyandır.
 */
export const TEMIZLIK_SCRIPTI_ISARETI = "@temizlik-scripti";
const TEMIZLIK_ISARET_SATIR_SINIRI = 30;

/** Dosya başında temizlik beyanı var mı? SAF — girdi kaynak metni. */
export function temizlikScriptiMi(kaynak: string): boolean {
  return kaynak.split("\n", TEMIZLIK_ISARET_SATIR_SINIRI).some((l) => l.includes(TEMIZLIK_SCRIPTI_ISARETI));
}

/** Silme bir teardown bağlamında mı? Bağlamın ADINI verir, yoksa `null`. */
export function teardownBaglami(n: ts.Node): string | null {
  const kalip = new RegExp(`^(${TEARDOWN_ADLARI.join("|")})`, "i");
  for (let p: ts.Node | undefined = n; p; p = p.parent) {
    const ust: ts.Node | undefined = p.parent;
    if (ust && ts.isTryStatement(ust) && ust.finallyBlock === p) return "finally";
    if (ust && ts.isCallExpression(ust) && ts.isPropertyAccessExpression(ust.expression) &&
        ust.expression.name.text === "finally" && ust.arguments[0] === p) {
      return ".finally()";
    }
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) {
      const ad = ts.isFunctionDeclaration(p) && p.name ? p.name.text
        : ust && ts.isVariableDeclaration(ust) && ts.isIdentifier(ust.name) ? ust.name.text
        : ust && ts.isPropertyAssignment(ust) && ts.isIdentifier(ust.name) ? ust.name.text
        : "";
      if (kalip.test(ad)) return ad;
    }
  }
  return null;
}

/** Verilen programda, süzgeçten geçen dosyalardaki DEFTER silmelerini sınıflar. */
export function silmeleriTara(
  program: ts.Program,
  checker: ts.TypeChecker,
  kok: string,
  dosyaSuzgeci: (rel: string) => boolean,
  delegeModel: Map<string, string>,
): SilmeYeri[] {
  const out: SilmeYeri[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = relative(kok, sf.fileName);
    if (!dosyaSuzgeci(rel)) continue;
    const dosyaTemizlik = temizlikScriptiMi(sf.getFullText());
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && SILEN_METOD.has(n.expression.name.text)) {
        const ic = n.expression.expression;
        if (ts.isPropertyAccessExpression(ic)) {
          const model = delegeModel.get(ic.name.text);
          if (model) {
            const arg = n.arguments[0];
            let where: ts.Expression | undefined;
            if (arg && ts.isObjectLiteralExpression(arg)) {
              const w = arg.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "where");
              if (w && ts.isPropertyAssignment(w)) where = w.initializer;
            }
            const { bag, not } = bagSinifi(where, sf, checker);
            out.push({
              model, dosya: rel, metod: n.expression.name.text,
              satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
              bag, not, teardown: teardownBaglami(n) ?? (dosyaTemizlik ? TEMIZLIK_SCRIPTI_ISARETI : null),
            });
          }
        }
      }
      n.forEachChild(gez);
    };
    gez(sf);
  }
  return out;
}

/**
 * SONDA YÜZEYİ — sentetik kaynak metnini kendi başına derleyip sınıflar.
 * Kapının kendi kontrol grubu: gerçek repo taranmadan, kural sentetik vakalarla
 * ısırtılır. Depoya dokunmaz, dosya yazmaz.
 */
export function sondaSinifla(kaynak: string): Array<{ satir: number; bag: SilmeBagi; teardown: string | null; not: string }> {
  const ad = "/sonda-silme.ts";
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === ad ? sf : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => undefined,
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f === ad,
    readFile: (f) => (f === ad ? kaynak : undefined),
  };
  const program = ts.createProgram([ad], { noResolve: true, noLib: true, allowJs: false }, host);
  const checker = program.getTypeChecker();
  const out: Array<{ satir: number; bag: SilmeBagi; teardown: string | null; not: string }> = [];
  const gez = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && SILEN_METOD.has(n.expression.name.text)) {
      const arg = n.arguments[0];
      let where: ts.Expression | undefined;
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const w = arg.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "where");
        if (w && ts.isPropertyAssignment(w)) where = w.initializer;
      }
      const { bag, not } = bagSinifi(where, sf, checker);
      out.push({ satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, bag, not, teardown: teardownBaglami(n) });
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return out;
}
