/**
 * BEKÇİ — sabit `pageSize`'lı tek-atış katalog picker'ı UYARISIZ kalamaz.
 *
 * Tek atışla çekilen katalog, satır sayısı `pageSize`'ı aştığı gün listeyi
 * SESSİZCE kırpar: kayıt ne picker'da ne istemci-içi aramada görünür, hata da
 * çıkmaz — operatör "kumaşım/müşterim yok" der ve yanlış kayıt açar. Tek kapı
 * `useTruncationWarning` (kırpmayı görünür yapar). Ölçüm 2026-09-05: items 138 ·
 * colors 130 · customers 79; tavana en dar pay bu üç katalogda (2,2×–3,9×).
 *
 * Kapsam BİLİNÇLİ olarak dar: yalnız `itemService` / `colorService` /
 * `customerService`. Kalan kataloglar (fason firma 6, rota 2, özellik 11)
 * 18×–100× payda ve bu bekçinin konusu değil.
 *
 * MUAF: sunucu aramalı picker (`search:` parametresi olan çağrı) — orada kırpma
 * bir arama sonucudur, eksik liste değil.
 *
 * Ölçüt DOSYA BAZLIDIR: bir dosyadaki kapsamlı tek-atış sorgu sayısı, o
 * dosyadaki `useTruncationWarning` çağrısı sayısını AŞAMAZ. Körlük zemini
 * ayrıca ölçülür (tarama boş küme bulursa bekçi kırmızı verir).
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');

/** Tavana en dar payı olan üç katalog servisi (2026-09-05 ölçümü). */
const KAPSAMLI_SERVISLER = new Set(['itemService', 'colorService', 'customerService']);

/** En az bu kadar tek-atış sorgu bulunmalı — 0 bulgu "hiç bakılmadı" olabilir. */
const KORLUK_ZEMINI_SORGU = 8;
/** En az bu kadar dosya taranmalı. */
const KORLUK_ZEMINI_DOSYA = 150;

interface DosyaOlcumu {
  tekAtisSorgu: string[];
  uyariSayisi: number;
}

function tsDosyalari(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsDosyalari(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Çağrı argümanlarındaki nesne literalinde `pageSize: <sayı>` var mı, `search:` yok mu? */
function tekAtisMi(call: ts.CallExpression): boolean {
  for (const arg of call.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;
    let pageSize = false;
    let search = false;
    for (const prop of arg.properties) {
      const ad = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
      if (ad === 'pageSize' && ts.isPropertyAssignment(prop) && ts.isNumericLiteral(prop.initializer)) {
        pageSize = true;
      }
      if (ad === 'search') search = true;
    }
    if (pageSize && !search) return true;
  }
  return false;
}

function dosyayiOlc(file: string): DosyaOlcumu {
  const kaynak = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const olcum: DosyaOlcumu = { tekAtisSorgu: [], uyariSayisi: 0 };
  const gez = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const cal = node.expression;
      if (ts.isIdentifier(cal) && cal.text === 'useTruncationWarning') olcum.uyariSayisi += 1;
      if (
        ts.isPropertyAccessExpression(cal) &&
        ts.isIdentifier(cal.expression) &&
        KAPSAMLI_SERVISLER.has(cal.expression.text) &&
        tekAtisMi(node)
      ) {
        const { line } = kaynak.getLineAndCharacterOfPosition(node.getStart(kaynak));
        olcum.tekAtisSorgu.push(
          `${path.relative(SRC, file)}:${line + 1} → ${cal.expression.text}.${cal.name.text}`,
        );
      }
    }
    ts.forEachChild(node, gez);
  };
  gez(kaynak);
  return olcum;
}

describe('picker kırpma uyarısı bekçisi', () => {
  const dosyalar = tsDosyalari(SRC);
  const olcumler = dosyalar.map((f) => ({ file: f, ...dosyayiOlc(f) }));
  const sorguluDosyalar = olcumler.filter((o) => o.tekAtisSorgu.length > 0);
  const toplamSorgu = sorguluDosyalar.reduce((n, o) => n + o.tekAtisSorgu.length, 0);

  it('körlük zemini: tarama gerçekten sorgu buluyor', () => {
    expect(dosyalar.length).toBeGreaterThanOrEqual(KORLUK_ZEMINI_DOSYA);
    expect(toplamSorgu).toBeGreaterThanOrEqual(KORLUK_ZEMINI_SORGU);
  });

  it('her tek-atış katalog sorgusunun bir kırpma uyarısı var', () => {
    const eksik = sorguluDosyalar
      .filter((o) => o.uyariSayisi < o.tekAtisSorgu.length)
      .map(
        (o) =>
          `${path.relative(SRC, o.file)}: ${o.tekAtisSorgu.length} tek-atış sorgu, ` +
          `${o.uyariSayisi} useTruncationWarning\n    ${o.tekAtisSorgu.join('\n    ')}`,
      );
    expect(eksik).toEqual([]);
  });

  it('negatif sonda: uyarısız bir sorgu YAKALANIR', () => {
    const sahte = path.join(SRC, '__negatif_sonda__.tsx');
    fs.writeFileSync(
      sahte,
      `import { itemService } from './services/item.service';\n` +
        `export const q = () => itemService.getAll({ page: 1, pageSize: 500 });\n`,
      'utf8',
    );
    try {
      const o = dosyayiOlc(sahte);
      expect(o.tekAtisSorgu).toHaveLength(1);
      expect(o.uyariSayisi).toBe(0);
      expect(o.uyariSayisi < o.tekAtisSorgu.length).toBe(true);
    } finally {
      fs.unlinkSync(sahte);
    }
  });

  it('negatif sonda: sunucu aramalı picker MUAF', () => {
    const sahte = path.join(SRC, '__negatif_sonda_arama__.tsx');
    fs.writeFileSync(
      sahte,
      `import { customerService } from './services/customer.service';\n` +
        `export const q = (s: string) => customerService.getAll({ page: 1, pageSize: 50, search: s });\n`,
      'utf8',
    );
    try {
      expect(dosyayiOlc(sahte).tekAtisSorgu).toHaveLength(0);
    } finally {
      fs.unlinkSync(sahte);
    }
  });
});
