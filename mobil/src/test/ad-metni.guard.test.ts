/**
 * BEKÇİ (cırcır) — ad metni ortak bileşenden: `components/TruncatedText`.
 *
 * Kullanıcı kararı (2026-10-12): uzun tezgah/ürün/müşteri/iş emri/cari adı tek
 * satırda "…" ile kısalır, basılı tutunca tam ad balonda. Çıplak `<Text>` ile
 * basılan ad ya sarar/taşar (numberOfLines yok) ya da tam adı gösteren yol
 * olmadan keser (numberOfLines var). İkisi de bu bekçiye sayılır.
 *
 * Tarama TS AST ile: `<Text>` elemanının doğrudan `{…}` çocuklarından biri ad
 * alanı okuyorsa (`.name`, `.fullName`, `…Name`) sayılır. Dosya başına taban
 * EŞİTLİKLE tutulur: artış → kırmızı ("TruncatedText kullan"), düşüş → kırmızı
 * ("tabanı düşür" — düşürülemeyen cırcır kapısızlıktan kötüdür).
 * Taban yenileme (yalnız düşüşte): AD_METNI_TABAN_YAZ=1 npx jest ad-metni.guard
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');
const TABAN = path.join(__dirname, 'ad-metni-taban.json');
export const AD_ALANI = /\.(?:name|fullName)\b|[a-z]Name\b/;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (e.isFile() && p.endsWith('.tsx') && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

export function countBareNameTexts(source: string, fileName = 'x.tsx'): number {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'Text') {
      const hit = node.children.some(
        (c) => ts.isJsxExpression(c) && c.expression !== undefined && AD_ALANI.test(c.expression.getText(sf)),
      );
      if (hit) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

function measure(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walkTsx(SRC).sort()) {
    const n = countBareNameTexts(fs.readFileSync(f, 'utf8'), f);
    if (n > 0) out[path.relative(SRC, f).split(path.sep).join('/')] = n;
  }
  return out;
}

describe('ad metni — TruncatedText cırcırı', () => {
  it('sayaç ad alanını yakalar, TruncatedText ve etiket/kod metnini saymaz', () => {
    expect(countBareNameTexts('const a = <Text style={s.x}>{roll.item?.name ?? "—"}</Text>;')).toBe(1);
    expect(countBareNameTexts('const a = <Text numberOfLines={1}>{`${l.itemName} · x`}</Text>;')).toBe(1);
    expect(countBareNameTexts('const a = <TruncatedText>{c.customer.name}</TruncatedText>;')).toBe(0);
    expect(countBareNameTexts('const a = <Text>{opt.label}{row.code}</Text>;')).toBe(0);
  });

  it('dosya başına taban eşit', () => {
    const now = measure();
    if (process.env.AD_METNI_TABAN_YAZ === '1') {
      fs.writeFileSync(TABAN, `${JSON.stringify(now, null, 2)}\n`);
      return;
    }
    const base = JSON.parse(fs.readFileSync(TABAN, 'utf8')) as Record<string, number>;
    const artan: string[] = [];
    const dusen: string[] = [];
    for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
      const a = now[f] ?? 0;
      const b = base[f] ?? 0;
      if (a > b) artan.push(`${f}: ${b} → ${a}`);
      if (a < b) dusen.push(`${f}: ${b} → ${a}`);
    }
    if (artan.length) {
      throw new Error(`Çıplak <Text> ile ad basıldı — components/TruncatedText kullan:\n  ${artan.join('\n  ')}`);
    }
    if (dusen.length) {
      throw new Error(`Taban düştü — ad-metni-taban.json'u düşür (AD_METNI_TABAN_YAZ=1):\n  ${dusen.join('\n  ')}`);
    }
  });
});
