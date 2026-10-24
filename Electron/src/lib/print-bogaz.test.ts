import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// =============================================================================
// BASIM BOĞAZI (izlenebilirlik A2) — paneldeki her basım `lib/print.ts` boğazından geçer
// (printTracked / trackPdfSave / reportLabelSend), sonucu yazdırma geçmişine düşer.
// İddia: `print.ts` dışında `printHtmlString` / `printDocumentArea` çağrısı ve doğrudan
// `.print()` (iframe `contentWindow.print()`, `window.print()`) YOK. AST taraması.
// Sonda (2026-10-24, ölçüldü): son üç etiket diyaloğu + TravelerCardPreview taşınmadan önce
// 4 ihlal (kırmızı) — taşındı → yeşil. Biçim sondası kalıcı (son test).
// =============================================================================

const SRC = resolve(__dirname, "..");
const CHOKE = "lib/print.ts";
const PRIVATE_PRINTERS = new Set(["printHtmlString", "printDocumentArea"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) && !d.name.endsWith(".d.ts") ? [p] : [];
  });
}

/** Bir kaynak metindeki boğaz dışı basım çağrıları (`dosya:satır ifade`). */
function directPrintCalls(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const hit =
        (ts.isIdentifier(callee) && PRIVATE_PRINTERS.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          // Argümansız `.print()` = tarayıcı basımı (pencere/iframe/frames[i]); IPC basımı argüman taşır.
          (PRIVATE_PRINTERS.has(callee.name.text) || (callee.name.text === "print" && n.arguments.length === 0)));
      if (hit) out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf).slice(0, 80)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("basım boğazı — print.ts dışında doğrudan basım yok", () => {
  const files = walk(SRC).map((p) => relative(SRC, p).split("\\").join("/"));

  it("tarama kör değil (≥ 100 dosya, boğaz dosyası dahil)", () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
    expect(files).toContain(CHOKE);
  });

  it("boğazın kendisi tarayıcıya görünüyor (özel basıcılar print.ts içinde çağrılıyor)", () => {
    expect(directPrintCalls(CHOKE, readFileSync(join(SRC, CHOKE), "utf8")).length).toBeGreaterThan(0);
  });

  it("print.ts dışında printHtmlString / printDocumentArea / contentWindow.print() / window.print() yok", () => {
    // Ucuz ön süzgeç: ".print" ya da özel basıcı adı geçmeyen dosyanın AST'si çıkarılmaz.
    const violations = files
      .filter((f) => f !== CHOKE)
      .flatMap((f) => {
        const src = readFileSync(join(SRC, f), "utf8");
        return /print(\s*\(|\?\.\(|HtmlString|DocumentArea)/.test(src) ? directPrintCalls(f, src) : [];
      });
    expect(violations).toEqual([]);
  }, 60_000);

  it("kalıcı sonda: tarayıcı her biçimi görür", () => {
    const probe = [
      "iframeRef.current?.contentWindow?.print();",
      "window.print();",
      "printHtmlString(html);",
      "x.printDocumentArea(root);",
      "window.frames[0]?.print?.();",
      "api.docPrint.print({ html });", // argümanlı IPC çağrısı ihlal DEĞİL
    ].join("\n");
    expect(directPrintCalls("probe.ts", probe)).toHaveLength(5);
  });
});
