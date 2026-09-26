// =============================================================================
// clientToken YAZIM SİTESİ TARAMASI (bekçi altyapısı — test DEĞİL) — `test_token_replay_bogaz`
// =============================================================================
// Yazım sitesi: `clientToken` anahtarı bir YAZIM bağlamındaki nesne literalinde — `data: {…}` değeri (Prisma
// create/upsert ve `data` alan yazar helper'ları) · adı `Tx` ile biten bir fonksiyona verilen nesne argümanı
// (tek yazar helper'ları: `applyCashTxTx`…) · `x.clientToken = …` ataması. Site EN DIŞ fonksiyon birimine yazılır
// ($transaction geri çağrısı sarmalayan servisin içindedir). Okuma bağlamları (`where` · `select` · audit yükü) hariç.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { walkTs } from "./ts-tarama";

export interface TokenBirimi {
  /** `src/…/dosya.ts::birim` */
  anahtar: string;
  dugum: ts.Node;
  yazimSatirlari: number[];
  /** Birimdeki çağrı adları (kip doğrulaması için). */
  cagrilar: Array<{ ad: string; satir: number; alici: string | null }>;
  /** `where: { clientToken … }` okuma satırları. */
  okumalar: number[];
}

const fonksiyonMu = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

function birimAdi(n: ts.Node): string {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
  if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  if (ts.isPropertyAssignment(n.parent)) return n.parent.name.getText();
  return `<anonim:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}>`;
}

const anahtarAdi = (p: ts.ObjectLiteralElementLike): string | null =>
  (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;

/** Nesne literali bir YAZIM bağlamında mı? */
function yazimBaglami(obj: ts.ObjectLiteralExpression): boolean {
  let n: ts.Node = obj;
  // `data: { … }` — literal doğrudan `data` değeri (iç içe spread/koşul içinden de).
  for (let p: ts.Node | undefined = obj.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p)) {
      const ad = anahtarAdi(p);
      if (ad === "data") return true;
      if (ad && ["where", "select", "include", "newData", "oldData", "details", "meta", "orderBy"].includes(ad)) return false;
      break;
    }
    if (ts.isObjectLiteralExpression(p) || ts.isCallExpression(p) || fonksiyonMu(p)) break;
    n = p;
  }
  // `fooTx(tx, { … clientToken })` — tek yazar helper'ı.
  const ata = obj.parent;
  if (ts.isCallExpression(ata) && ata.arguments.includes(obj as ts.Expression)) {
    const c = ata.expression;
    const ad = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
    return /Tx$/.test(ad);
  }
  return false;
}

export interface TokenTaramasi {
  /** Token yazan ya da `where: { clientToken }` ile okuyan birimler. */
  token: TokenBirimi[];
  /** Bütün fonksiyon birimleri (kip doğrulaması giriş birimini buradan bulur). */
  hepsi: Map<string, TokenBirimi>;
  /** `tokenReplay(` politika literalleri (dosya::satır → nesne literali). */
  politikalar: Array<{ yer: string; literal: ts.ObjectLiteralExpression | null }>;
}

export function tokenBirimleri(kok: string): TokenTaramasi {
  const src = path.join(kok, "src");
  const out: TokenBirimi[] = [];
  const hepsi = new Map<string, TokenBirimi>();
  const politikalar: TokenTaramasi["politikalar"] = [];
  for (const dosya of walkTs(src)) {
    const rel = path.relative(kok, dosya).split(path.sep).join("/");
    const sf = ts.createSourceFile(dosya, fs.readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
    const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const birimler = new Map<ts.Node, TokenBirimi>();
    const birimOf = (b: ts.Node) => {
      if (!birimler.has(b)) birimler.set(b, { anahtar: `${rel}::${birimAdi(b)}`, dugum: b, yazimSatirlari: [], cagrilar: [], okumalar: [] });
      return birimler.get(b)!;
    };
    const ziyaret = (n: ts.Node, dis: ts.Node | null) => {
      const b = dis ?? (fonksiyonMu(n) ? n : null);
      if (b) {
        if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && anahtarAdi(n) === "clientToken" && ts.isObjectLiteralExpression(n.parent)) {
          // `clientToken: null` token YAZMAZ (telafide token'ı bırakmak) — site değil.
          const bos = ts.isPropertyAssignment(n) && n.initializer.kind === ts.SyntaxKind.NullKeyword;
          if (!bos && yazimBaglami(n.parent)) birimOf(b).yazimSatirlari.push(satir(n));
          const ust = n.parent.parent;
          if (ts.isPropertyAssignment(ust) && anahtarAdi(ust) === "where") birimOf(b).okumalar.push(satir(n));
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && n.left.name.text === "clientToken" && n.right.kind !== ts.SyntaxKind.NullKeyword) {
          birimOf(b).yazimSatirlari.push(satir(n));
        }
        if (ts.isCallExpression(n)) {
          const c = n.expression;
          const ad = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
          const alici = ts.isPropertyAccessExpression(c) ? c.expression.getText(sf) : null;
          if (ad) birimOf(b).cagrilar.push({ ad, satir: satir(n), alici });
        }
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "tokenReplay" && !rel.endsWith("token-replay.helper.ts")) {
        const a0 = n.arguments[0];
        politikalar.push({ yer: `${rel}:${satir(n)}`, literal: a0 && ts.isObjectLiteralExpression(a0) ? a0 : null });
      }
      ts.forEachChild(n, (k) => ziyaret(k, b));
    };
    ziyaret(sf, null);
    for (const b of birimler.values()) hepsi.set(b.anahtar, b);
    out.push(...[...birimler.values()].filter((b) => b.yazimSatirlari.length > 0 || b.okumalar.length > 0));
  }
  return { token: out, hepsi, politikalar };
}
