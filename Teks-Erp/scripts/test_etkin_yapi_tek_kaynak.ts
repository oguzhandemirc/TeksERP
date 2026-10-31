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

// ── §2 SY-A4: dokuma iş emri ön dolgusu kartı ürün kartından DOĞRUDAN okumaz ──────────────
// İş emri yüzeyinde (servis + `weaving-order*` helper'ları) `item` sorgusunun/ilişkisinin içinde atkı/desen
// kartı anahtarı geçerse ikinci cevap demektir; ön dolgu `resolveEffectiveConstruction`dan gelir.
const CARD_KEYS = new Set(["weftSpecId", "weaveDesignId", "weftSpec", "weaveDesign"]);
const PREFILL_HELPER = "src/services/helpers/weaving-order-construction.helper.ts";

function insideItemRead(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "item") return true;
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const target = p.expression.expression;
      if (ts.isPropertyAccessExpression(target) && target.name.text === "item") return true;
    }
  }
  return false;
}

function scanPrefill(rel: string, text: string): string[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ts.isIdentifier(n.name) && CARD_KEYS.has(n.name.text) && insideItemRead(n)) {
      out.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} item.${n.name.text}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

console.log("§2 dokuma iş emri ön dolgusu etkin yapıdan (SY-A4)");
const synth = scanPrefill("src/services/weaving-order.service.ts", "await prisma.item.findUnique({ where: { id }, select: { weftSpecId: true, weaveDesignId: true } });\nconst s = { item: { select: { weaveDesign: { select: { id: true } } } } };\nconst ok = { weftSpec: { select: { id: true } } };\n");
check("§2a sentetik: item sorgusunda/ilişkisinde atkı/desen kartı okuması yakalanır, iş emrinin kendi alanı serbest", synth.length === 3, synth.join(" | "));
const prefillFiles = files(path.join(KOK, "src/services"))
  .map((f) => path.relative(KOK, f).split(path.sep).join("/"))
  .filter((rel) => /^src\/services\/(weaving-order\.service|helpers\/weaving-order[^/]*)\.ts$/.test(rel));
check("§2b iş emri yüzeyi bulundu (servis + helper'lar)", prefillFiles.includes("src/services/weaving-order.service.ts") && prefillFiles.includes(PREFILL_HELPER), `n=${prefillFiles.length}`);
const direct = prefillFiles.flatMap((rel) => scanPrefill(rel, fs.readFileSync(path.join(KOK, rel), "utf8")));
check("§2c iş emri yüzeyinde ürün kartından doğrudan atkı/desen okuması yok", direct.length === 0, direct.join(" | "));
const prefillSrc = fs.existsSync(path.join(KOK, PREFILL_HELPER)) ? fs.readFileSync(path.join(KOK, PREFILL_HELPER), "utf8") : "";
check("§2d ön dolgu `resolveEffectiveConstruction`ı çağırır", /resolveEffectiveConstruction\(/.test(prefillSrc));
const svcSrc = fs.readFileSync(path.join(KOK, "src/services/weaving-order.service.ts"), "utf8");
check("§2e iş emri servisi ön dolgu helper'ını çağırır", /resolveWeavingConstructionChoice\(/.test(svcSrc));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
