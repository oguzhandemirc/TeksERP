// =============================================================================
// TeksERP - Ürün yaşam döngüsü TEK YAZAR bekçisi (URUN-YASAM-DONGUSU.md §3.1 D2, §10.6)
// =============================================================================
// `items.isActive` ve `items.lifecycleStatus` YALNIZ yaşam döngüsü yazıcısından
// (`helpers/item-lifecycle.helper.ts` + veri biçimi `item-lifecycle-data.helper.ts`)
// yazılır. DB CHECK iki kolonu birbirine bağlar ama "hangi yol yazdı"yı bilemez:
// yazıcıyı atlayan yol kapıyı (canlı referans sayımı, audit, kilit) da atlar.
//
// Ölçülen biçimler:
//   (a) `<x>.item.create|createMany|update|updateMany|upsert({ data: { isActive|lifecycleStatus … } })`
//   (b) ham SQL: aynı dizgede `"items"` + yazım + `"isActive"`/`"lifecycleStatus"`
//   (c) jenerik yazarlar: ItemService `create`/`update`/`softDelete`i EZER (BaseService'in
//       `isActive` yazan jenerik yolları Item'a ulaşmaz) ve gövdeden lifecycle kolonu geçmez
//   (d) birleştirme/geri alma (jenerik `del.updateMany` / ham SQL) ürün dalında yazıcının
//       veri biçimini çağırır
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OWNERS = new Set(["services/helpers/item-lifecycle.helper.ts", "services/helpers/item-lifecycle-data.helper.ts"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const GUARDED_KEYS = new Set(["isActive", "lifecycleStatus"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

const name = (n: ts.PropertyName): string => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : "");

function dataHasGuardedKey(arg: ts.Expression | undefined): boolean {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
  const objs: ts.Expression[] = [];
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p) && ["data", "create", "update"].includes(name(p.name))) objs.push(p.initializer);
  }
  return objs.some(
    (o) => ts.isObjectLiteralExpression(o) && o.properties.some((p) => p.name && GUARDED_KEYS.has(name(p.name as ts.PropertyName))),
  );
}

function scan(files: string[]): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    if (OWNERS.has(rel)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const at = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const m = node.expression;
        if (WRITE_METHODS.has(m.name.text) && ts.isPropertyAccessExpression(m.expression) && m.expression.name.text === "item" && dataHasGuardedKey(node.arguments[0])) {
          out.push(`${at(node)} [a:prisma]`);
        }
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const t = node.getText(sf);
        if (/"items"/.test(t) && /\b(UPDATE|INSERT)\b/i.test(t) && /"(isActive|lifecycleStatus)"/.test(t)) out.push(`${at(node)} [b:ham-sql]`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const FILES = walk(SRC);
console.log("=== 0) Körlük zemini ===");
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length}`);
check("yazıcı dosyası duruyor", fs.existsSync(path.join(SRC, "services/helpers/item-lifecycle.helper.ts")));

console.log("\n=== 1) Tarayıcı sondası ===");
{
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "item-writer-"));
  const f = path.join(tmp, "sonda.ts");
  fs.writeFileSync(
    f,
    [
      "async function a(){ await prisma.item.update({ where: { id }, data: { isActive: false } }); }",
      "async function b(){ await tx.item.updateMany({ where: { id }, data: { lifecycleStatus: 'ARCHIVED' } }); }",
      'const c = `UPDATE "items" SET "isActive" = false WHERE id = $1`;',
      "async function temiz(){ await prisma.item.update({ where: { id }, data: { name: 'x' } }); }",
    ].join("\n"),
  );
  // Sonda dosyası SRC dışında — göreli yol bozulmasın diye doğrudan ölç.
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile("sonda.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let n = 0;
  const v = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_METHODS.has(node.expression.name.text) && dataHasGuardedKey(node.arguments[0])) n++;
    if (ts.isNoSubstitutionTemplateLiteral(node) && /"items"/.test(node.text) && /"isActive"/.test(node.text)) n++;
    ts.forEachChild(node, v);
  };
  v(sf);
  fs.rmSync(tmp, { recursive: true, force: true });
  check("üç ihlal biçimi yakalanıyor, temiz yazım yakalanmıyor", n === 3, `yakalanan ${n}`);
}

console.log("\n=== 2) Yazıcı dışında items.isActive / lifecycleStatus yazımı yok ===");
const hits = scan(FILES);
for (const h of hits) console.log(`   · ${h}`);
check("yazıcı dışı yazım 0", hits.length === 0, `${hits.length}`);

console.log("\n=== 3) Jenerik yazarlar Item'a ulaşmıyor ===");
{
  const itemSvc = fs.readFileSync(path.join(SRC, "services/item.service.ts"), "utf8");
  const sf = ts.createSourceFile("item.service.ts", itemSvc, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const methods = new Set<string>();
  const v = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === "ItemService") {
      for (const m of node.members) if (ts.isMethodDeclaration(m) && m.name) methods.add(name(m.name as ts.PropertyName));
    }
    ts.forEachChild(node, v);
  };
  v(sf);
  for (const m of ["create", "update", "softDelete", "sanitizeWriteData"]) {
    check(`ItemService.${m} BaseService'i eziyor`, methods.has(m));
  }
  for (const col of ["lifecycleStatus", "lifecycleChangedAt", "lifecycleChangedById", "lifecycleReason"]) {
    check(`gövdeden yazılamaz: ${col}`, new RegExp(`LIFECYCLE_COLUMNS[^;]*"${col}"`).test(itemSvc));
  }
  check("update `isActive`i gövdeden ayırıp yazıcıya veriyor", /const \{ isActive, \.\.\.data \}/.test(itemSvc) && /transitionLifecycle\(/.test(itemSvc));
}

console.log("\n=== 4) Birleştirme / geri alma ürün dalı yazıcının veri biçimini kullanıyor ===");
{
  const merge = fs.readFileSync(path.join(SRC, "services/master-data-merge.service.ts"), "utf8");
  const unmerge = fs.readFileSync(path.join(SRC, "services/master-data-unmerge.service.ts"), "utf8");
  check("birleştirme: ürün mezar taşı itemLifecycleWriteData(ARCHIVED)", /entity === "item"[\s\S]{0,80}itemLifecycleWriteData\(ItemLifecycleStatus\.ARCHIVED/.test(merge));
  check("birleştirme: lifecycleBefore yazılıyor", /lifecycleBefore: entity === "item"/.test(merge));
  check("geri alma: ürün mezar taşı ayrı yoldan (liftItemTombstoneTx + itemLifecycleWriteData)", /table === "items"[\s\S]{0,120}liftItemTombstoneTx/.test(unmerge) && /itemLifecycleWriteData\(before/.test(unmerge));
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
