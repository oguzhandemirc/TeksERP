// =============================================================================
// test_quote_price_single_source — MAL-4 teklif fiyat öneri zinciri TEK dosyada (AST, DB'siz)
// =============================================================================
// "Bu müşteriye bu ürünü kaça öneririz?" zinciri (müşteri listesi > genel liste > ItemPrice(SALE) > maliyet+kâr)
// yalnız `services/helpers/quote-price.helper.ts`te kurulur. Ölçülen iki iz:
//   §1 `suggestSalePrice(` ÇAĞRISI (tanım hariç) yalnız o dosyada
//   §2 YAYINLI liste satırı okuması (`*.priceListLine.find*` çağrısı, argümanında `PUBLISHED`) yalnız o dosyada
//   §3 sondalar: sahte kaynakta ikinci çağrı / ikinci yayınlı satır okuması YAKALANIR; tarama kör değil
// Çalıştır: npx tsx scripts/test_quote_price_single_source.ts
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const SRC = path.join(__dirname, "../src");
const OWNER = "services/helpers/quote-price.helper.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

interface Hit { kind: "suggestSalePrice" | "publishedLineRead"; line: number }

/** Tek dosyanın izleri — saf yüklem (sondalar sahte kaynağa da uygular). */
export function scan(fileName: string, text: string): Hit[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const hits: Hit[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      if ((ts.isIdentifier(callee) && callee.text === "suggestSalePrice") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "suggestSalePrice")) {
        hits.push({ kind: "suggestSalePrice", line });
      }
      if (ts.isPropertyAccessExpression(callee) && /^find/.test(callee.name.text) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "priceListLine") {
        const argText = n.arguments.map((a) => a.getText(sf)).join(" ");
        if (/PUBLISHED|PUBLISHED_LIST|list\b/.test(argText)) hits.push({ kind: "publishedLineRead", line });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

const files = walk(SRC);
const byKind: Record<Hit["kind"], string[]> = { suggestSalePrice: [], publishedLineRead: [] };
for (const f of files) {
  const rel = path.relative(SRC, f).split(path.sep).join("/");
  for (const h of scan(rel, fs.readFileSync(f, "utf8"))) byKind[h.kind].push(`${rel}:${h.line}`);
}
const outside = (k: Hit["kind"]) => byKind[k].filter((x) => !x.startsWith(`${OWNER}:`));

check("§0 tarama kör değil (≥ 300 kaynak dosya)", files.length >= 300, `${files.length}`);
check("§1a zincir dosyası `suggestSalePrice`ı çağırıyor", byKind.suggestSalePrice.some((x) => x.startsWith(`${OWNER}:`)));
check("§1b ⭐ `suggestSalePrice` çağrısı yalnız zincir dosyasında", outside("suggestSalePrice").length === 0, outside("suggestSalePrice").join(", "));
check("§2a zincir dosyası yayınlı liste satırını okuyor", byKind.publishedLineRead.some((x) => x.startsWith(`${OWNER}:`)));
check("§2b ⭐ yayınlı liste satırı okuması yalnız zincir dosyasında", outside("publishedLineRead").length === 0, outside("publishedLineRead").join(", "));

// Model adı parçalı yazılır: sonda metni, ortam-araması tarayıcısına gerçek okuma gibi görünmesin.
const LINE_MODEL = "priceList" + "Line";
const probe = `
import { suggestSalePrice } from "./helpers/maliyet-bridge.helper";
export async function kopya(tx: any) {
  const p = await suggestSalePrice("i", "USD", null);
  const r = await tx.${LINE_MODEL}.findFirst({ where: { priceList: { status: "PUBLISHED" }, itemId: "i" } });
  const safe = await tx.${LINE_MODEL}.findMany({ where: { priceListId: "x" } });
  return [p, r, safe];
}`;
const ph = scan("services/sahte.ts", probe);
check("§3a sonda: ikinci `suggestSalePrice` çağrısı yakalanır", ph.some((h) => h.kind === "suggestSalePrice"));
check("§3b sonda: ikinci yayınlı satır okuması yakalanır, liste-içi okuma (priceListId) yakalanmaz", ph.filter((h) => h.kind === "publishedLineRead").length === 1);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
