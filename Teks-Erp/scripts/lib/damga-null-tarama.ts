// =============================================================================
// DAMGA NULL'LAMA TARAMASI — ileri kaydın damgasına yerinde null yazan siteler
// =============================================================================
// Geri alma ileri kaydı değiştirmez; damgayı null'lamak ters kayıt değildir. Tarayıcı
// YAZIM bağlamını arar: Prisma `data:`/`update:` nesnesinde `<damga>: null` ve ham
// SQL'in SET bölümünde `"<damga>" = NULL`. `where:` süzgeci ve SQL WHERE'i yazım değildir.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import * as ts from "typescript";
import { walkTs } from "./ts-tarama";

export interface DamgaNullIsabeti {
  dosya: string;
  fonksiyon: string;
  alan: string;
  satir: number;
}

const YAZIM_ANAHTARI = new Set(["data", "update"]);
const DURAK_ANAHTARI = new Set(["where", "select", "include", "orderBy", "create", "data", "update"]);

function fonksiyonAdi(n: ts.Node): string {
  for (let p: ts.Node | undefined = n; p; p = p.parent) {
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) return p.name.getText();
    const ok = (i: ts.Expression | undefined): boolean => !!i && (ts.isArrowFunction(i) || ts.isFunctionExpression(i));
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && ok(p.initializer)) return p.name.text;
    if (ts.isPropertyAssignment(p) && ok(p.initializer)) return p.name.getText();
  }
  return "(dosya düzeyi)";
}

/** Tek kaynak metninde isabetler — saf; sondalar bununla sentetik girdi besler. */
export function damgaNullTaraKaynak(kaynak: string, dosya: string, alanlar: readonly string[]): DamgaNullIsabeti[] {
  const kume = new Set(alanlar);
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const out: DamgaNullIsabeti[] = [];
  const satir = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const gez = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && n.initializer.kind === ts.SyntaxKind.NullKeyword && kume.has(n.name.getText())) {
      let baglam = "";
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isPropertyAssignment(p) && DURAK_ANAHTARI.has(p.name.getText())) { baglam = p.name.getText(); break; }
      }
      if (YAZIM_ANAHTARI.has(baglam)) out.push({ dosya, fonksiyon: fonksiyonAdi(n), alan: n.name.getText(), satir: satir(n) });
    }
    if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) {
      const metin = n.getText();
      for (const m of metin.matchAll(/\bSET\b([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|\bFROM\b|$)/gi)) {
        for (const alan of kume) {
          if (new RegExp(`"${alan}"\\s*=\\s*NULL\\b`, "i").test(m[1] ?? "")) {
            out.push({ dosya, fonksiyon: fonksiyonAdi(n), alan, satir: satir(n) });
          }
        }
      }
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}

/** `src/` altındaki bütün isabetler (dosya yolları köke göreli). */
export function damgaNullTaraDizin(kok: string, dizin: string, alanlar: readonly string[]): DamgaNullIsabeti[] {
  return walkTs(dizin).flatMap((f) => damgaNullTaraKaynak(readFileSync(f, "utf8"), relative(kok, f), alanlar));
}
