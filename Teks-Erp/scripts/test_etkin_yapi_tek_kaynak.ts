// =============================================================================
// test_etkin_yapi_tek_kaynak — etkin yapı TEK KAYNAK (Seyitoğlu SY-A2, tasarım K3 / §15.3)
// =============================================================================
// Varyant atkı değişimi (`productRecipeWeftYarn` / ilişki `weftYarnOverrides`) ve ek çözgü katmanı
// (`itemWarpLayer` / ilişki `warpLayers`) YALNIZ `helpers/effective-construction.helper.ts`te
// OKUNUR; yazıcı servis (`item-construction.service.ts`) yalnız `deleteMany`/`createMany` çağırır.
// İkinci okuyucu "bu ürün nasıl dokunur" sorusuna ikinci cevap demektir → kırmızı.
// AST (TypeScript derleyicisi); DB yok. §0 sentetik kaynakla tarayıcının kendisi ölçülür.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const KOK = path.resolve(__dirname, "..");
const HELPER = "src/services/helpers/effective-construction.helper.ts";
const WRITER = "src/services/item-construction.service.ts";
const DELEGATES = new Set(["productRecipeWeftYarn", "itemWarpLayer"]);
const RELATIONS = new Set(["weftYarnOverrides", "warpLayers"]);
const QUERY_KEYS = new Set(["select", "include", "where", "orderBy", "some", "every", "none"]);
const WRITER_METHODS = new Set(["deleteMany", "createMany"]);

/** Bir kaynaktaki ihlaller (`dosya:satır ne`). `rel` beyanlı dosya yoluyla karşılaştırılır. */
function scanSource(rel: string, text: string): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (n: ts.Node): string => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && DELEGATES.has(n.name.text) && rel !== HELPER) {
      const parent = n.parent;
      const method = ts.isPropertyAccessExpression(parent) && parent.expression === n ? parent.name.text : null;
      if (!(rel === WRITER && method !== null && WRITER_METHODS.has(method))) out.push(`${at(n)} ${n.name.text}.${method ?? "?"}`);
    }
    if (ts.isPropertyAssignment(n) && rel !== HELPER) {
      const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null;
      const obj = n.parent;
      const holder = obj.parent;
      if (key && RELATIONS.has(key) && ts.isObjectLiteralExpression(obj) && ts.isPropertyAssignment(holder)) {
        const hk = ts.isIdentifier(holder.name) || ts.isStringLiteral(holder.name) ? holder.name.text : "";
        if (QUERY_KEYS.has(hk)) out.push(`${at(n)} ${hk}.${key}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

console.log("§0 tarayıcı kendini ölçer (sentetik kaynak)");
const bad = scanSource("src/services/x.service.ts", "const a = await prisma.productRecipeWeftYarn.findMany({});\nconst b = await tx.item.findUnique({ where: { id }, select: { warpLayers: true } });\n");
check("§0a başka dosyada productRecipeWeftYarn okuması yakalanır", bad.some((v) => v.includes("productRecipeWeftYarn.findMany")), bad.join(" | "));
check("§0b başka dosyada select.warpLayers yakalanır", bad.some((v) => v.includes("select.warpLayers")));
const writerRead = scanSource(WRITER, "await tx.itemWarpLayer.findMany({});\nawait tx.itemWarpLayer.deleteMany({});\n");
check("§0c yazıcıda findMany yakalanır, deleteMany serbest", writerRead.length === 1 && writerRead[0]!.includes("findMany"), writerRead.join(" | "));
check("§0d helper serbest", scanSource(HELPER, "await db.productRecipeWeftYarn.findMany({ select: { weftYarnOverrides: true } });").length === 0);
check("§0e veri nesnesindeki warpLayers anahtarı (audit yükü) sayılmaz", scanSource("src/a.ts", "log({ newData: { warpLayers: x } });").length === 0);

console.log("§1 gerçek ağaç: helper dışında okuyucu yok");
const violations: string[] = [];
let helperHits = 0;
for (const f of files(path.join(KOK, "src"))) {
  const rel = path.relative(KOK, f).split(path.sep).join("/");
  const text = fs.readFileSync(f, "utf8");
  violations.push(...scanSource(rel, text));
  if (rel === HELPER) helperHits = (text.match(/productRecipeWeftYarn|itemWarpLayer/g) ?? []).length;
}
check("§1a helper okuyucuyu taşıyor (tarayıcı kör değil)", helperHits >= 2, `isabet=${helperHits}`);
check("§1b helper/yazıcı dışında okuma yok", violations.length === 0, violations.join(" | "));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
