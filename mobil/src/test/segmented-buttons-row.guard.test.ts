/**
 * BEKÇİ — `SegmentedButtons` bir SATIRIN içine konmaz.
 *
 * Saha vakası (2026-08-25, Fason Kabul): "Fasonda kalan var mı?" başlığı ile
 * Hayır/Evet düğmeleri aynı `flexDirection: 'row'` kabındaydı. Tablette ölçüldü
 * (uiautomator): düğmeler satırın TAMAMINI kaplıyor, başlık HİÇ çizilmiyor ve
 * altta ~380 px boşluk var. Mekanizma:
 *   • RN Paper SegmentedButtons'ın her düğmesi `flex: 1`dir.
 *   • Yoga, flex-grow çocuğu olan bir kabı "at-most" ölçümünde mevcut genişliğin
 *     TAMAMINA açar (non-legacy stretch) → SegmentedButtons = satır genişliği.
 *   • Yanındaki `flex: 1` kutu SIFIR genişlik alır → içindeki metin karakter
 *     karakter alt alta sarılır → görünmez ama YÜKSEK bir boşluk.
 * Sonuç: soru ekrana hiç çıkmadı; operatör "neyin evet/hayır'ı" diye sordu.
 *
 * Kural: SegmentedButtons kendi satırında, tam genişlikte durur. Yanına bir şey
 * koymak gerekiyorsa ona AÇIK bir `width` verilir (minWidth YETMEZ).
 *
 * Tarama TS AST ile: her `<SegmentedButtons>` için en yakın sarmalayan JSX
 * elemanının `style`ı çözülür (aynı dosyadaki `StyleSheet.create` anahtarı ya da
 * satır içi nesne); `flexDirection: 'row'` ise KIRMIZI — meğerki SegmentedButtons
 * `width` taşısın.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '..');

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (e.isFile() && p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** `StyleSheet.create({...})` içindeki `key → { prop: value }` düz haritası. */
function collectStyles(sf: ts.SourceFile): Map<string, Map<string, string>> {
  const styles = new Map<string, Map<string, string>>();
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'create' &&
      n.arguments[0] &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      for (const p of n.arguments[0].properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) continue;
        styles.set(p.name.getText(sf), objToMap(p.initializer, sf));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return styles;
}

function objToMap(o: ts.ObjectLiteralExpression, sf: ts.SourceFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of o.properties) {
    if (ts.isPropertyAssignment(p)) m.set(p.name.getText(sf), p.initializer.getText(sf).replace(/['"]/g, ''));
  }
  return m;
}

/** `style={...}` ifadesinden flexDirection değerini çıkar (styles.X / satır içi / dizi). */
function flexDirectionOf(
  expr: ts.Expression | undefined,
  styles: Map<string, Map<string, string>>,
  sf: ts.SourceFile,
): string | null {
  if (!expr) return null;
  if (ts.isJsxExpression(expr as unknown as ts.Node)) {
    return flexDirectionOf((expr as unknown as ts.JsxExpression).expression, styles, sf);
  }
  if (ts.isObjectLiteralExpression(expr)) return objToMap(expr, sf).get('flexDirection') ?? null;
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      const v = flexDirectionOf(el, styles, sf);
      if (v) return v;
    }
    return null;
  }
  if (ts.isPropertyAccessExpression(expr) && expr.expression.getText(sf).endsWith('tyles')) {
    return styles.get(expr.name.text)?.get('flexDirection') ?? null;
  }
  return null;
}

function attr(el: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  for (const a of el.attributes.properties) {
    if (ts.isJsxAttribute(a) && a.name.getText() === name) {
      const init = a.initializer;
      if (init && ts.isJsxExpression(init)) return init.expression;
    }
  }
  return undefined;
}

describe('SegmentedButtons satır içine konmaz (yanındaki kutuyu sıfırlar)', () => {
  const files = walkTsx(SRC);
  const offenders: string[] = [];
  let seen = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('<SegmentedButtons')) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const styles = collectStyles(sf);

    const visit = (n: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
        n.tagName.getText(sf) === 'SegmentedButtons'
      ) {
        seen++;
        // Açık width taşıyorsa kural dışı — Yoga o zaman içeriğe göre değil verilen
        // genişliğe göre yerleştirir.
        const ownStyle = attr(n, 'style');
        const ownWidth =
          ownStyle && ts.isPropertyAccessExpression(ownStyle)
            ? styles.get(ownStyle.name.text)?.get('width')
            : ownStyle && ts.isObjectLiteralExpression(ownStyle)
              ? objToMap(ownStyle, sf).get('width')
              : undefined;
        // En yakın sarmalayan JSX elemanı
        let p: ts.Node | undefined = n.parent;
        while (p && !ts.isJsxElement(p)) p = p.parent;
        if (p && ts.isJsxElement(p)) {
          const dir = flexDirectionOf(attr(p.openingElement, 'style'), styles, sf);
          if (dir === 'row' && !ownWidth) {
            const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
            offenders.push(`${path.relative(SRC, file)}:${line + 1}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  it('körlük zemini: en az 3 SegmentedButtons tarandı', () => {
    // Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile
    // çıkmasın (bekçi konvansiyonu).
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it("hiçbir SegmentedButtons flexDirection:'row' bir kabın DOĞRUDAN çocuğu değil", () => {
    expect(offenders).toEqual([]);
  });
});
