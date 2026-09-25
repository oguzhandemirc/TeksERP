// =============================================================================
// TeksERP - Ürün kartı KULLANIM kuralının tek kaynak cırcırı
// =============================================================================
// Kural: bir kartın yeni işte kullanılıp kullanılamayacağına YALNIZ
// `helpers/item-usage.helper.ts` (`assertItemUsable`) karar verir
// (docs/design/URUN-YASAM-DONGUSU.md §4, §10.2). Tek boolean (`isActive`) iki anlam
// taşıdığı için 20+ dağınık kontrol birbirinden farklı cevap veriyordu: aynı top bir
// adımda akıyor, bir sonrakinde duruyordu (2026-09-25 olayı).
//
// Tarama (src/, AST) — Item üzerinde `isActive` okuyan DÖRT biçim:
//   (a) `<x>.item.find*/count({ where|select: { isActive … } })` — doğrudan sorgu
//   (b) `<itemİlişkisi>: { isActive … }` ya da `{ select|where|include: { isActive … } }`
//       — başka modelin sorgusunda iç içe Item süzgeci/seçimi (kontrol oraya saklanır)
//   (c) `<x>.<itemİlişkisi>.isActive` — seçilmiş ilişkinin bellekte okunması
//   (d) aynı dizge içinde `"items"` + `"isActive"` — ham SQL
// Item ilişki adları şema METNİNDEN türer (elle liste yok).
//
// CIRCIR: taban ölçülen sayıya EŞİT olmalı (iki yönlü). Taşıma öncesi taban
// `ITEM_USAGE_SCAN_ROOT=<eski src>` ile ölçüldü; bu sürümde 0'a indi.
// ⚠️ İhlal bulununca doğru tepki muafa eklemek DEĞİL, `assertItemUsable`a taşımaktır.
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

/** Bu sürümde 0 — yeni çıplak kontrol tabanı ARTIRIR (kırmızı), taşıma DÜŞÜRÜR. */
const TABAN = 0;

const ROOT = path.resolve(__dirname, "..");
const SRC = process.env.ITEM_USAGE_SCAN_ROOT ? path.resolve(process.env.ITEM_USAGE_SCAN_ROOT) : path.join(ROOT, "src");
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");

/** Kuralın SAHİBİ dosyalar — kontrol burada yaşar. */
const OWNERS = new Set([
  "services/helpers/item-usage.helper.ts",
  "services/helpers/item-lifecycle.helper.ts",
  "services/helpers/item-lifecycle-data.helper.ts",
]);

/**
 * GEREKÇELİ MUAFLAR — `dosya::kapsayan fonksiyon` → gerekçe. Yalnız KONTROL olmayan okumalar.
 * İki yönlü: eşleşmeyen muaf da kırmızıdır (ölü muaf gerçek bir ihlali sessizce örtebilir).
 */
const EXEMPT: Record<string, string> = {
  "services/import/adapters/item.adapter.ts::findExisting":
    "içe aktarım önizlemesi kartın MEVCUT alanlarını diff için okur — karar değil, alan taşıma",
  "services/import/adapters/item.adapter.ts::exportRows":
    "dışa aktarım Excel'e kolon yazar — karar değil; geri yükleme `itemService.update` → yazıcıdan geçer",
};

/** Düğümü kapsayan en yakın adlı fonksiyon/metot (muaf anahtarı). */
function enclosingFn(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return propName(n.name as ts.PropertyName);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.text;
  }
  return "";
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts") && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

/** Şemadan Item'a işaret eden ilişki alan adları (`targetItem Item? @relation…`, `item Item` …). */
function itemRelationNames(): Set<string> {
  const names = new Set<string>();
  for (const m of fs.readFileSync(SCHEMA, "utf8").matchAll(/^\s+(\w+)\s+Item(\?|\[\])?\s/gm)) names.add(m[1]!);
  return names;
}

const READ_METHODS = new Set(["findUnique", "findFirst", "findMany", "count", "findUniqueOrThrow", "findFirstOrThrow"]);

const propName = (n: ts.PropertyName | ts.MemberName): string =>
  ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n) ? n.text : "";

function objHasKey(o: ts.Expression | undefined, key: string): boolean {
  return !!o && ts.isObjectLiteralExpression(o) && o.properties.some((p) => p.name && propName(p.name) === key);
}
function objGet(o: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
  for (const p of o.properties) if (ts.isPropertyAssignment(p) && propName(p.name) === key) return p.initializer;
  return undefined;
}

interface Hit { file: string; line: number; kind: string; text: string; fn: string }

function scan(files: string[], rels: Set<string>): Hit[] {
  const hits: Hit[] = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    if (OWNERS.has(rel)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const add = (node: ts.Node, kind: string) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      hits.push({ file: rel, line: line + 1, kind, text: src.split("\n")[line]!.trim(), fn: enclosingFn(node) });
    };
    const visit = (node: ts.Node): void => {
      // (a) doğrudan Item sorgusu
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const m = node.expression;
        if (READ_METHODS.has(m.name.text) && ts.isPropertyAccessExpression(m.expression) && m.expression.name.text === "item") {
          const arg = node.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg) && (objHasKey(objGet(arg, "where"), "isActive") || objHasKey(objGet(arg, "select"), "isActive"))) {
            add(node, "a:sorgu");
          }
        }
      }
      // (b) iç içe Item ilişkisi süzgeci/seçimi
      if (ts.isPropertyAssignment(node) && rels.has(propName(node.name)) && ts.isObjectLiteralExpression(node.initializer)) {
        const o = node.initializer;
        if (objHasKey(o, "isActive") || ["select", "where", "include", "is"].some((k) => objHasKey(objGet(o, k), "isActive"))) {
          add(node, "b:ilişki");
        }
      }
      // (c) bellekte ilişki okuması: x.item.isActive / x.targetItem?.isActive
      if (ts.isPropertyAccessExpression(node) && node.name.text === "isActive" && ts.isPropertyAccessExpression(node.expression) && rels.has(node.expression.name.text)) {
        add(node, "c:okuma");
      }
      // (d) ham SQL
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
        const t = node.getText(sf);
        if (/"items"/.test(t) && /"isActive"/.test(t)) add(node, "d:ham-sql");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

const FILES = walk(SRC);
const RELS = itemRelationNames();

console.log(`=== 0) Körlük zemini (kök: ${path.relative(ROOT, SRC) || SRC}) ===`);
check("kaynak ağacı tarandı (>200 dosya)", FILES.length > 200, `${FILES.length}`);
check("şemadan Item ilişki adları türedi (≥8)", RELS.size >= 8, [...RELS].join(","));
check("'item' ve 'targetItem' ilişki kümesinde", RELS.has("item") && RELS.has("targetItem"));
if (!process.env.ITEM_USAGE_SCAN_ROOT) {
  const helper = path.join(SRC, "services/helpers/item-usage.helper.ts");
  check("tek kaynak dosyası duruyor", fs.existsSync(helper));
  const importers = FILES.filter((f) => /from "[^"]*item-usage\.helper"/.test(fs.readFileSync(f, "utf8")));
  check("assertItemUsable GERÇEKTEN kullanılıyor (≥15 dosya)", importers.length >= 15, `${importers.length}`);
}

// Tarayıcının kendisi: dört biçimin her biri bilinen bir sondada yakalanmalı (araç körse yeşil yalan olur).
console.log("\n=== 1) Tarayıcı sondası (dört biçim) ===");
{
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "item-usage-"));
  const f = path.join(tmp, "sonda.ts");
  fs.writeFileSync(
    f,
    [
      "async function a(){ await prisma.item.findFirst({ where: { id, isActive: true } }); }",
      "async function b(){ await prisma.roll.findMany({ include: { item: { select: { isActive: true } } } }); }",
      "function c(r: any){ return r.targetItem?.isActive; }",
      'const d = `UPDATE "items" SET "isActive" = false`;',
    ].join("\n"),
  );
  const saved = { SRC };
  const kinds = scan([f], RELS).map((h) => h.kind.split(":")[0]);
  fs.rmSync(tmp, { recursive: true, force: true });
  void saved;
  for (const k of ["a", "b", "c", "d"]) check(`biçim (${k}) yakalanıyor`, kinds.includes(k), kinds.join(","));
}

console.log("\n=== 2) Çıplak Item isActive kontrolü (cırcır) ===");
const all = scan(FILES, RELS);
const exemptUsed = new Set<string>();
const violations = all.filter((h) => {
  const key = Object.keys(EXEMPT).find((k) => k === `${h.file}::${h.fn}`);
  if (key) exemptUsed.add(key);
  return !key;
});
for (const v of violations) console.log(`   · ${v.file}:${v.line} (${v.fn || "—"}) [${v.kind}] ${v.text.slice(0, 100)}`);
check(`ihlal sayısı tabana EŞİT (taban ${TABAN})`, violations.length === TABAN, `ölçülen ${violations.length}${violations.length < TABAN ? " — tabanı düşür" : ""}`);
if (!process.env.ITEM_USAGE_SCAN_ROOT) {
  for (const k of Object.keys(EXEMPT)) check(`muaf hâlâ canlı: ${k.split("::")[0]}`, exemptUsed.has(k), "ölü muaf — sil");
}

console.log("\n=== 3) Dirilme yolları kart kapısından geçiyor (S5) ===");
// Ölü statüyü BEKLEYİP canlı (ya da hesaplanan) statü YAZAN her `roll.update*` bir dirilmedir;
// kapsayan fonksiyon `assertRollsRevivable` çağırmalı (DB seddi ikinci hat, çıkış yolunu bu söyler).
const DEAD = ["SUBCONTRACTOR_CONSUMED", "TAMBUR_CONSUMED", "KARTELA_CONSUMED", "CANCELLED", "SHIPPED", "SCRAP"];
const hasDead = (t: string) => DEAD.some((d) => new RegExp(`\\b${d}\\b`).test(t));
function reviveSites(files: string[]): Array<{ at: string; fn: string; ok: boolean }> {
  const out: Array<{ at: string; fn: string; ok: boolean }> = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs).split(path.sep).join("/");
    const src = fs.readFileSync(abs, "utf8");
    if (!/\.roll\.update/.test(src)) continue;
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^update(Many)?$/.test(node.expression.name.text)
        && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "roll") {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const where = objGet(arg, "where");
          const data = objGet(arg, "data");
          const whereStatus = where && ts.isObjectLiteralExpression(where) ? objGet(where, "status") : undefined;
          const dataStatus = data && ts.isObjectLiteralExpression(data) ? objGet(data, "status") : undefined;
          const dataDead = dataStatus && /^RollStatus\.[A-Z_]+$/.test(dataStatus.getText(sf)) && hasDead(dataStatus.getText(sf));
          if (whereStatus && dataStatus && hasDead(whereStatus.getText(sf)) && !dataDead) {
            let fnNode: ts.Node | undefined = node.parent;
            while (fnNode && !(ts.isFunctionDeclaration(fnNode) || ts.isMethodDeclaration(fnNode) || ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode))) fnNode = fnNode.parent;
            // Kapsayan EN DIŞ fonksiyon (tx ok fonksiyonu içindeyse servis metoduna kadar çık).
            let outer: ts.Node | undefined = fnNode;
            for (let n = fnNode?.parent; n; n = n.parent) if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) outer = n;
            const body = outer ? outer.getText(sf) : "";
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            out.push({ at: `${rel}:${line + 1}`, fn: enclosingFn(node), ok: /assertRollsRevivable\(/.test(body) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}
if (!process.env.ITEM_USAGE_SCAN_ROOT) {
  const sites = reviveSites(FILES);
  for (const s2 of sites.filter((x) => !x.ok)) console.log(`   · KAPISIZ dirilme: ${s2.at} (${s2.fn})`);
  check(`körlük zemini: dirilme yolu bulundu — ${sites.length} (≥ 11, 2026-09-25 ölçümü)`, sites.length >= 11);
  check("⭐ her dirilme yolu assertRollsRevivable çağırıyor", sites.every((x) => x.ok), `${sites.filter((x) => !x.ok).length} kapısız`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
