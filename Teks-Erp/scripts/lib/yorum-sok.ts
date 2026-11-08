// =============================================================================
// YORUM SÖKÜCÜ — TS sözdizimiyle (bekçi altyapısı, test DEĞİL)
// =============================================================================
// Regex sökücü satır yorumundaki `/*`yi (`// services/*.ts`) blok başı sanıp sonraki `*/`ye kadar KODU
// yutuyordu; dize/regex/şablon içindeki `//` da yorum sanılıyordu. Yorum aralıkları TS AST'den toplanır:
// her yaprak belirtecin öncü/izleyen yorum aralığı (dize ve şablon içi hiçbir zaman yorum değildir).
// Satır yapısı korunur (yorum boşlukla değil, satır sonları korunarak silinir) — satır no basan bekçiler için.
// =============================================================================
import ts from "typescript";

/** Ayrıştırma türü uzantıdan: `.ts`i TSX sanmak `<any>x` / `<T>() =>` sonrasını JSX yapıp yorumları kaçırır. */
function betikTuru(dosyaAdi: string): ts.ScriptKind {
  if (dosyaAdi.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (dosyaAdi.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(dosyaAdi)) return ts.ScriptKind.JS;
  if (/\.[cm]?ts$/.test(dosyaAdi)) return ts.ScriptKind.TS;
  throw new Error(`yorumlariSokTs: tanınmayan uzantı — ${dosyaAdi}`);
}

/** `src`deki bütün yorumları söker; satır sonlarını korur. `dosyaAdi` ZORUNLU (ayrıştırma türünü belirler). */
export function yorumlariSokTs(src: string, dosyaAdi: string): string {
  const sf = ts.createSourceFile(dosyaAdi, src, ts.ScriptTarget.Latest, false, betikTuru(dosyaAdi));
  const araliklar = new Map<number, number>();
  const topla = (r: ts.CommentRange[] | undefined): void => {
    for (const c of r ?? []) araliklar.set(c.pos, c.end);
  };
  // Her yorum bir yaprak BELİRTECİN öncü (sonraki satırlarda) ya da izleyen (aynı satırda) trivia'sıdır.
  const gez = (n: ts.Node): void => {
    const cocuklar = n.getChildren(sf);
    if (cocuklar.length === 0) {
      topla(ts.getLeadingCommentRanges(src, n.getFullStart()));
      topla(ts.getTrailingCommentRanges(src, n.getEnd()));
    }
    for (const c of cocuklar) gez(c);
  };
  gez(sf);
  let cikti = "";
  let i = 0;
  for (const pos of [...araliklar.keys()].sort((a, b) => a - b)) {
    if (pos < i) continue;
    cikti += src.slice(i, pos) + src.slice(pos, araliklar.get(pos)).replace(/[^\n]/g, "");
    i = araliklar.get(pos)!;
  }
  return cikti + src.slice(i);
}
