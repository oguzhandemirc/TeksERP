// =============================================================================
// DEFTER OKUYUCULARININ TEK SIRA TANIMI — AST tarayıcısı (depo · cari bekçilerinin ortak aracı)
// =============================================================================
// Bir defterin okuyucuları sırayı yalnız o defterin sıra sabitlerinden alır (an, eşitlikte id). Tarayıcı
// `<x>.<model>.find*(…)` çağrılarını okur ve ÜÇ sonuç verir: uyumlu · ihlal · ÖLÇÜLEMEDİ. Ölçülemeyen
// (literal olmayan argüman · kısaltılmış `orderBy` · argümanda spread) uyumlu SAYILMAZ: bekçi onu kırmızı
// basar — göremediği sırayı onaylayan kapı, sessizce korumayı bırakan kapıdır (06 denetimi, 2026-09-26).
// Yön: tek satır okuyan `findFirst` "en son" sabitini kullanır; artan (en eski) okuma yalnız beyanla.
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

export interface TekSiraKurali {
  /** Prisma delegesi: `warehouseMovement` · `cariTransaction`. */
  model: string;
  /** İzinli sıra sabitleri. */
  sabitler: ReadonlySet<string>;
  /** `findFirst`in kullanacağı "en son" sabitleri. */
  enSon: ReadonlySet<string>;
  /** Artan sıralı `findFirst` beyanı — "dosya#fonksiyon" → gerekçe. İki yönlü: eşleşmeyen beyan ölüdür. */
  artanBeyan: Readonly<Record<string, string>>;
}

export interface TekSiraSonucu {
  /** `orderBy` taşıyan (ya da taşıyıp taşımadığı görülemeyen) çağrı sayısı — körlük zemini. */
  sirali: number;
  ihlal: string[];
  olculemedi: string[];
  /** Beyanla geçen artan `findFirst` yerleri. */
  beyanli: string[];
  oluBeyan: string[];
}

/** Düğümü saran en yakın adlı fonksiyon/metot. */
function sarmalayan(n: ts.Node): string {
  for (let c: ts.Node | undefined = n.parent; c; c = c.parent) {
    if ((ts.isMethodDeclaration(c) || ts.isFunctionDeclaration(c)) && c.name && ts.isIdentifier(c.name)) return c.name.text;
    if (ts.isVariableDeclaration(c) && ts.isIdentifier(c.name) && c.initializer && (ts.isArrowFunction(c.initializer) || ts.isFunctionExpression(c.initializer))) return c.name.text;
  }
  return "(modül)";
}

/** Tek kaynak dosyayı tarar (saf sondalar da bunu çağırır). */
export function tekSiraKaynak(rel: string, metin: string, kural: TekSiraKurali, sonuc: TekSiraSonucu, gorulen: Set<string>): void {
  const sf = ts.createSourceFile(rel, metin, ts.ScriptTarget.Latest, true);
  const git = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^find/.test(n.expression.name.text)
      && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === kural.model) {
      const fn = n.expression.name.text;
      const tekSatir = fn.startsWith("findFirst");
      const yer = `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} (${sarmalayan(n)} · ${fn})`;
      const arg = n.arguments[0];
      if (!arg) {
        if (tekSatir) { sonuc.sirali++; sonuc.olculemedi.push(`${yer} argümansız`); }
      } else if (!ts.isObjectLiteralExpression(arg)) {
        sonuc.sirali++;
        sonuc.olculemedi.push(`${yer} argüman literal değil`);
      } else if (arg.properties.some(ts.isSpreadAssignment)) {
        sonuc.sirali++;
        sonuc.olculemedi.push(`${yer} argümanda spread`);
      } else {
        const kisa = arg.properties.find((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === "orderBy");
        const ob = arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "orderBy");
        if (kisa) {
          sonuc.sirali++;
          sonuc.olculemedi.push(`${yer} kısaltılmış orderBy`);
        } else if (ob) {
          sonuc.sirali++;
          const ini = ob.initializer;
          let sabit: string | null = null;
          if (ts.isIdentifier(ini) && kural.sabitler.has(ini.text)) sabit = ini.text;
          else if (ts.isArrayLiteralExpression(ini)) {
            const son = ini.elements[ini.elements.length - 1];
            const onek = ini.elements.slice(0, -1).every((e) => !/createdAt|\bid\b/.test(e.getText()));
            if (son && ts.isSpreadElement(son) && ts.isIdentifier(son.expression) && kural.sabitler.has(son.expression.text) && onek) sabit = son.expression.text;
          }
          if (sabit === null) sonuc.ihlal.push(`${yer} elle sıralama: ${ini.getText().replace(/\s+/g, " ")}`);
          else if (tekSatir && !kural.enSon.has(sabit)) {
            const anahtar = `${rel}#${sarmalayan(n)}`;
            if (anahtar in kural.artanBeyan) { sonuc.beyanli.push(yer); gorulen.add(anahtar); }
            else sonuc.ihlal.push(`${yer} tek satır okuyucu "en son" değil: ${sabit}`);
          }
        }
      }
    }
    ts.forEachChild(n, git);
  };
  git(sf);
}

export function bosSonuc(): TekSiraSonucu {
  return { sirali: 0, ihlal: [], olculemedi: [], beyanli: [], oluBeyan: [] };
}

/** Dosya kümesini tarar; beyanın iki yönünü kapatır. */
export function tekSiraTara(root: string, dosyalar: string[], kural: TekSiraKurali): TekSiraSonucu {
  const sonuc = bosSonuc();
  const gorulen = new Set<string>();
  for (const abs of dosyalar) tekSiraKaynak(relative(root, abs), readFileSync(join(abs), "utf8"), kural, sonuc, gorulen);
  sonuc.oluBeyan = Object.keys(kural.artanBeyan).filter((k) => !gorulen.has(k));
  return sonuc;
}
