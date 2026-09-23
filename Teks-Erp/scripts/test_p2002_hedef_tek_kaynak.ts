// =============================================================================
// MANDAL — P2002 HEDEFİ (`meta.target`) YALNIZ TEK YARDIMCIDA OKUNUR
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts p2002_hedef_tek_kaynak   (DB'siz)
//
// ⭐ NEDEN (2026-09-23): Prisma 7 + pg adaptörü P2002'de `meta.target` VERMEZ; hedef
//    `meta.driverAdapterError.cause` altındadır. `target`i doğrudan okuyan yüklem adaptör altında HİÇ
//    eşleşmez: çeki listesi yarışı beş kez retry edilip 409'la bitti (ölçüldü 2026-09-23); levent ve
//    dokuma işi numara çakışması hiç retry edilmiyordu, tedarikçi profili ve etiket şablonu çakışmaları
//    anlamlı 409'a çevrilmiyordu. Tek yardımcı: `src/utils/p2002.ts` (`p2002MetaTargetParts` ailesi).
//
// NE ÖLÇER (AST — yorumdaki bahisler SAYILMAZ, KOD ölçülür):
//   §1 `src/` altında yardımcı dışında `.target` okuması YOK: ifadesi `meta` geçen erişim
//      (`err.meta.target`, `(e.meta as X)?.target`, `meta["target"]`) · `meta`dan türetilmiş takma ada
//      erişim (`const m = err.meta; m.target`) · yapı çözme (`const { target } = err.meta`)
//   §2 KALICI SONDALAR (sentetik kaynak, her koşumda): beş ihlal biçimi yakalanır, yorum ve alakasız
//      `.target` (DOM olayı) yakalanmaz — tarayıcının kendisi ölçülür (sessiz kapı olmasın)
//   §3 körlük zemini: taranan dosya > 100 ve yardımcı dosya tarandı
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const KOK = path.join(__dirname, "..");
const SRC = path.join(KOK, "src");
const YARDIMCI = "src/utils/p2002.ts";

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of fs.readdirSync(dizin, { withFileTypes: true })) {
    const p = path.join(dizin, ad.name);
    if (ad.isDirectory()) out.push(...tsDosyalari(p));
    else if (ad.name.endsWith(".ts") && !ad.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Kabuk ifadelerini soy: parantez · `as` · `!` · `satisfies`. */
function soy(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
  return x;
}

/** İfade bir `meta` mı: `meta` adlı tanımlayıcı, `.meta` erişimi ya da meta takma adı; `??`/`||` sol yanı da. */
function metaMi(e: ts.Expression, takma: Set<string>): boolean {
  const x = soy(e);
  if (ts.isIdentifier(x)) return x.text === "meta" || takma.has(x.text);
  if (ts.isPropertyAccessExpression(x)) return x.name.text === "meta";
  if (ts.isElementAccessExpression(x)) return ts.isStringLiteral(x.argumentExpression) && x.argumentExpression.text === "meta";
  if (ts.isBinaryExpression(x) && (x.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || x.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return metaMi(x.left, takma);
  return false;
}

/** Bir kaynaktaki `meta.target` okumaları (satır no + kısa metin). */
export function hedefOkumalari(dosyaAdi: string, metin: string): string[] {
  const sf = ts.createSourceFile(dosyaAdi, metin, ts.ScriptTarget.Latest, true);
  const takma = new Set<string>();
  const bulgu: string[] = [];
  const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // 1. tur: meta'dan türetilmiş takma adlar (`const m = err.meta ...`)
  const topla = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && metaMi(n.initializer, takma)) takma.add(n.name.text);
    ts.forEachChild(n, topla);
  };
  topla(sf);
  // 2. tur: okumalar
  const gez = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "target" && metaMi(n.expression, takma)) bulgu.push(`${dosyaAdi}:${satir(n)} ${n.getText(sf).slice(0, 80)}`);
    if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "target" && metaMi(n.expression, takma)) bulgu.push(`${dosyaAdi}:${satir(n)} ${n.getText(sf).slice(0, 80)}`);
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && metaMi(n.initializer, takma)) {
      for (const el of n.name.elements) {
        const ad = el.propertyName ?? el.name;
        if (ts.isIdentifier(ad) && ad.text === "target") bulgu.push(`${dosyaAdi}:${satir(n)} { target } = …meta`);
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return bulgu;
}

function main(): void {
  // §1 gerçek tarama
  const dosyalar = tsDosyalari(SRC);
  const ihlal: string[] = [];
  let yardimciTarandi = false;
  for (const abs of dosyalar) {
    const rel = path.relative(KOK, abs).split(path.sep).join("/");
    if (rel === YARDIMCI) { yardimciTarandi = true; continue; }
    ihlal.push(...hedefOkumalari(rel, fs.readFileSync(abs, "utf8")));
  }
  check("§1 ⭐ `meta.target` yardımcı dışında OKUNMUYOR (src/)", ihlal.length === 0, ihlal.length ? ihlal.join(" | ") : `${dosyalar.length} dosya`);

  // §2 kalıcı sondalar — tarayıcının kendisi
  const sonda = (ad: string, kod: string) => hedefOkumalari(`sonda-${ad}.ts`, kod).length;
  check("§2a doğrudan `err.meta?.target` yakalanır (levent/dokuma işi biçimi)", sonda("a", `const f = (err: any) => Array.isArray(err.meta?.target) && err.meta.target.includes("beamNo");`) >= 1);
  check("§2b döküm içinde `(e.meta as {target?:unknown})?.target` yakalanır", sonda("b", `const x = JSON.stringify((e.meta as { target?: unknown } | undefined)?.target ?? "");`) === 1);
  check("§2c takma ad `const m = err.meta; m.target` yakalanır", sonda("c", `const m = (err.meta ?? {}) as Record<string, unknown>; const t = m.target;`) === 1);
  check("§2d köşeli `meta[\"target\"]` yakalanır", sonda("d", `function f(meta: any) { return meta["target"]; }`) === 1);
  check("§2e yapı çözme `const { target } = err.meta` yakalanır", sonda("e", `const { target } = err.meta as any;`) === 1);
  check("§2f yorumdaki bahis SAYILMAZ", sonda("f", `// meta.target boş gelir\n/* err.meta.target */ const a = 1;`) === 0);
  check("§2g alakasız `.target` (DOM olayı) SAYILMAZ", sonda("g", `el.addEventListener("x", (ev) => ev.target);`) === 0);

  // §3 körlük zemini
  check("§3 körlük zemini: >100 dosya tarandı ve yardımcı dosya ağaçta", dosyalar.length > 100 && yardimciTarandi, `${dosyalar.length} dosya · yardımcı ${yardimciTarandi ? "var" : "YOK"}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
