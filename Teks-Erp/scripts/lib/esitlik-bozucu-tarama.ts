// =============================================================================
// "EN SON" OKUYUCUSU TARAMASI — `createdAt` ile sıralayıp `id` eşitlik bozucusu taşımayan tek satır okuması
// =============================================================================
// Okuyucu: `<delege>.findFirst(OrThrow)({ orderBy })` · `findMany({ orderBy, take: ±1 })` · iç içe ilişki
// okuması `include/select: { rel: { orderBy, take: ±1 } }`. `orderBy` literal değilse aynı dosyadaki ya da
// göreli import edilen `const` çözülür (`as const` / `satisfies` / parantez soyulur); çözülemeyen ifade
// ÖLÇÜLEMEDİ sayılır — sessizce uyumlu değil (üç sonuç). Ham SQL (`ORDER BY … LIMIT 1`) kapsam dışı.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as ts from "typescript";

export interface SemaModeli {
  guncellenen: boolean;
  /** Alan adı → hedef model (yalnız ilişki alanları). */
  iliski: Map<string, string>;
}
export type Sema = Map<string, SemaModeli>;

/** schema.prisma → model adı → (updatedAt var mı, ilişki alanları). */
export function semaOku(metin: string): Sema {
  const sema: Sema = new Map();
  let aktif: SemaModeli | null = null;
  const modelAdlari = new Set([...metin.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!));
  for (const satir of metin.split("\n")) {
    const bas = /^model\s+(\w+)\s*\{/.exec(satir);
    if (bas) { aktif = { guncellenen: false, iliski: new Map() }; sema.set(bas[1]!, aktif); continue; }
    if (/^\}/.test(satir)) { aktif = null; continue; }
    if (!aktif) continue;
    const alan = /^\s+(\w+)\s+(\w+)(\[\])?\??/.exec(satir);
    if (!alan) continue;
    if (alan[1] === "updatedAt") aktif.guncellenen = true;
    if (modelAdlari.has(alan[2]!)) aktif.iliski.set(alan[1]!, alan[2]!);
  }
  return sema;
}

export const delegeModeli = (sema: Sema, delege: string): string | null => {
  const ad = delege.charAt(0).toUpperCase() + delege.slice(1);
  return sema.has(ad) ? ad : null;
};

export type Sonuc = "UYUMLU" | "IHLAL" | "OLCULEMEDI";
export interface Okuyucu {
  dosya: string;
  satir: number;
  model: string;
  bicim: string;
  sonuc: Sonuc;
}


const soy = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression;
  return x;
};

type Okuyan = (dosya: string) => ts.SourceFile | null;

/** Göreli import'un kaynağı (`.ts` · `/index.ts`); paket import'u ya da bulunamayan dosya null. */
function importKaynagi(kaynakDosya: string, modul: string, oku: Okuyan): ts.SourceFile | null {
  if (!modul.startsWith(".")) return null;
  const taban = resolve(dirname(kaynakDosya), modul);
  return oku(`${taban}.ts`) ?? oku(join(taban, "index.ts"));
}

/** Adı `const` ilklendiricisine çözer — aynı dosya ya da göreli named import (derinlik sınırlı). */
function constCoz(ad: string, sf: ts.SourceFile, oku: Okuyan, derinlik: number): { ifade: ts.Expression; sf: ts.SourceFile } | null {
  if (derinlik > 4) return null;
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && st.declarationList.flags & ts.NodeFlags.Const) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === ad && d.initializer) return { ifade: d.initializer, sf };
      }
    }
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) {
        if (el.name.text !== ad) continue;
        const hedef = importKaynagi(sf.fileName, st.moduleSpecifier.text, oku);
        return hedef ? constCoz((el.propertyName ?? el.name).text, hedef, oku, derinlik + 1) : null;
      }
    }
  }
  return null;
}

/** `orderBy` ifadesinin üst düzey anahtarları; çözülemezse null. Koşullu ifadede iki kolun birleşimi değil, EN KÖTÜSÜ. */
function siraAnahtarlari(e: ts.Expression, sf: ts.SourceFile, oku: Okuyan, derinlik = 0): Set<string>[] | null {
  const x = soy(e);
  if (ts.isObjectLiteralExpression(x)) {
    const k = new Set<string>();
    for (const p of x.properties) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) k.add(p.name.text);
      else return null;
    }
    return [k];
  }
  if (ts.isArrayLiteralExpression(x)) {
    const k = new Set<string>();
    for (const el of x.elements) {
      const alt = siraAnahtarlari(ts.isSpreadElement(el) ? el.expression : el, sf, oku, derinlik + 1);
      if (!alt || alt.length !== 1) return null;
      for (const a of alt[0]!) k.add(a);
    }
    return [k];
  }
  if (ts.isConditionalExpression(x)) {
    const a = siraAnahtarlari(x.whenTrue, sf, oku, derinlik + 1);
    const b = siraAnahtarlari(x.whenFalse, sf, oku, derinlik + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(x)) {
    const c = constCoz(x.text, sf, oku, derinlik);
    return c ? siraAnahtarlari(c.ifade, c.sf, oku, derinlik + 1) : null;
  }
  return null;
}

const ozellik = (o: ts.ObjectLiteralExpression, ad: string): ts.Expression | null => {
  for (const p of o.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === ad) return p.initializer;
  return null;
};
const tekSatir = (e: ts.Expression | null): boolean => {
  if (!e) return false;
  const x = soy(e);
  if (ts.isNumericLiteral(x)) return x.text === "1";
  return ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(x.operand) && x.operand.text === "1";
};

/** Kaynak metinden tek satır okuyucuları, üç sonuçla. SAF: dosya okuma `oku` ile enjekte. */
export function okuyuculariTara(dosya: string, metin: string, sema: Sema, oku: Okuyan): Okuyucu[] {
  const sf = ts.createSourceFile(dosya, metin, ts.ScriptTarget.Latest, true);
  const out: Okuyucu[] = [];
  const degerlendir = (arg: ts.ObjectLiteralExpression, model: string, bicim: string, tekMi: boolean, dugum: ts.Node) => {
    const sira = ozellik(arg, "orderBy");
    if (sira && tekMi) {
      const anahtar = siraAnahtarlari(sira, sf, oku);
      const satir = sf.getLineAndCharacterOfPosition(dugum.getStart()).line + 1;
      if (!anahtar) out.push({ dosya, satir, model, bicim, sonuc: "OLCULEMEDI" });
      else if (anahtar.some((k) => k.has("createdAt"))) {
        out.push({ dosya, satir, model, bicim, sonuc: anahtar.some((k) => k.has("createdAt") && !k.has("id")) ? "IHLAL" : "UYUMLU" });
      }
    }
    for (const kap of ["include", "select"]) {
      const ic = ozellik(arg, kap);
      if (!ic || !ts.isObjectLiteralExpression(soy(ic))) continue;
      for (const p of (soy(ic) as ts.ObjectLiteralExpression).properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        const hedef = sema.get(model)?.iliski.get(p.name.text);
        const v = soy(p.initializer);
        if (hedef && ts.isObjectLiteralExpression(v)) degerlendir(v, hedef, `${bicim}.${p.name.text}`, tekSatir(ozellik(v, "take")), p);
      }
    }
  };
  const gez = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const yontem = n.expression.name.text;
      const model = delegeModeli(sema, n.expression.expression.name.text);
      const arg = n.arguments[0] ? soy(n.arguments[0]) : null;
      if (model && arg && ts.isObjectLiteralExpression(arg) && ["findFirst", "findFirstOrThrow", "findMany"].includes(yontem)) {
        degerlendir(arg, model, yontem, yontem !== "findMany" || tekSatir(ozellik(arg, "take")), n);
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/** Diskten okuyan önbellekli `oku`. */
export function diskOkuyucu(): Okuyan {
  const onbellek = new Map<string, ts.SourceFile | null>();
  return (dosya) => {
    if (!onbellek.has(dosya)) {
      onbellek.set(dosya, existsSync(dosya) ? ts.createSourceFile(dosya, readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true) : null);
    }
    return onbellek.get(dosya)!;
  };
}
