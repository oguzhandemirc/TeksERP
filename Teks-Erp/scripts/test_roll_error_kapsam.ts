// =============================================================================
// Test: RollError KARAR KAPSAMI — AST, DB'siz (K4P-KAPSAM, 2026-10-25)
// Çalıştır: npx tsx scripts/test_roll_error_kapsam.ts
// =============================================================================
// Korunan invariant: muayene hatası (`origin=INSPECTION`) karar yoluna girmez.
// `src/` altındaki her RollError okuma/güncelleme çağrısı, RollError ilişki
// okuması ve ham SQL `roll_errors` kullanımı ya `roll-error-scope.helper`
// ikizlerinden birine başvurur ya da `scripts/lib/roll-error-kapsam-beyan.ts`te
// beyanlıdır.
//
// Bölümler:
//   §1 Helper üçlüsü eşdeğer (sabit doğruluk tablosu, her köken için)
//   §2 ⭐ `rollError.<op>` çağrıları: where'de helper ya da beyan
//   §3 ⭐ RollError ilişki okumaları (`errors` · `detectedErrors` …): where'de helper ya da beyan
//   §4 ⭐ Ham SQL `roll_errors`: `ACTIONABLE_ROLL_ERROR_SQL` ya da beyan
//   §5 ⭐ Beyan iki yönlü: karşılığı kalmamış beyan kırmızı
//   §6 Zemin: en az N erişim görüldü (vakumen yeşil olmasın)
//
// SONDA TABLOSU (2026-10-25, geri alındı):
//   S1 `closeOrphanRollErrors`ten helper kaldırılır → §2 kırmızı
//   S2 beyana sahte dosya eklenir                   → §5 kırmızı
// =============================================================================
import * as tsc from "typescript";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { RollErrorOrigin } from "@prisma/client";
import {
  ACTIONABLE_ROLL_ERROR_WHERE,
  ACTIONABLE_ROLL_ERROR_SQL,
  isActionableRollError,
} from "../src/services/helpers/roll-error-scope.helper";
import { ROLL_ERROR_KAPSAM_BEYANI } from "./lib/roll-error-kapsam-beyan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const CHECKED_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "count", "groupBy", "aggregate",
  "updateMany", "update", "deleteMany", "delete",
]);
/** Şemada RollError'a giden ilişki alanları (Roll · WorkOrderStep · User · DefectType · RollInspection). */
const RELATION_FIELDS = new Set([
  "errors", "detectedErrors", "processedErrors", "detectedRollErrors", "processedRollErrors", "rollErrors",
]);
const HELPER_WHERE = "ACTIONABLE_ROLL_ERROR_WHERE";
const HELPER_SQL = "ACTIONABLE_ROLL_ERROR_SQL";
const HELPER_FILE = "services/helpers/roll-error-scope.helper.ts";

interface Access { dosya: string; sembol: string; erisim: string; satir: number; scoped: boolean }

function enclosingSymbol(node: tsc.Node): string {
  let n: tsc.Node | undefined = node.parent;
  while (n) {
    if ((tsc.isFunctionDeclaration(n) || tsc.isMethodDeclaration(n)) && n.name) return n.name.getText();
    if ((tsc.isArrowFunction(n) || tsc.isFunctionExpression(n)) && n.parent) {
      const p = n.parent;
      if (tsc.isVariableDeclaration(p) || tsc.isPropertyAssignment(p)) return p.name.getText();
    }
    n = n.parent;
  }
  return "<modül>";
}

function mentions(node: tsc.Node, ident: string): boolean {
  let found = false;
  const visit = (x: tsc.Node) => {
    if (found) return;
    if (tsc.isIdentifier(x) && x.text === ident) { found = true; return; }
    if (tsc.isPropertyAccessExpression(x) && x.name.text === ident) { found = true; return; }
    tsc.forEachChild(x, visit);
  };
  visit(node);
  return found;
}

function prop(obj: tsc.ObjectLiteralExpression, name: string): tsc.Expression | undefined {
  for (const p of obj.properties) {
    if (tsc.isPropertyAssignment(p) && p.name.getText().replace(/["']/g, "") === name) return p.initializer;
  }
  return undefined;
}

/** `X.<model>.<op>(...)` — `rollError` dışındaki model çağrıları ilişki taraması için. */
function prismaModelCall(call: tsc.CallExpression): { model: string; op: string } | null {
  const callee = call.expression;
  if (!tsc.isPropertyAccessExpression(callee)) return null;
  const inner = callee.expression;
  if (!tsc.isPropertyAccessExpression(inner)) return null;
  return { model: inner.name.text, op: callee.name.text };
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function collect(): Promise<Access[]> {
  const srcRoot = path.join(__dirname, "..", "src");
  const accesses: Access[] = [];
  for (const abs of await listFiles(srcRoot)) {
    const dosya = path.relative(srcRoot, abs).split(path.sep).join("/");
    if (dosya === HELPER_FILE) continue;
    const text = await fs.readFile(abs, "utf8");
    if (!/rollError|roll_errors|Errors\b|errors/.test(text)) continue;
    const sf = tsc.createSourceFile(abs, text, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TS);
    const line = (n: tsc.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

    const visit = (node: tsc.Node, inPrismaArgs: boolean) => {
      let nextIn = inPrismaArgs;
      if (tsc.isCallExpression(node)) {
        const mc = prismaModelCall(node);
        if (mc && mc.model === "rollError" && CHECKED_OPS.has(mc.op)) {
          const arg = node.arguments[0];
          const where = arg && tsc.isObjectLiteralExpression(arg) ? prop(arg, "where") : undefined;
          accesses.push({
            dosya, sembol: enclosingSymbol(node), erisim: `rollError.${mc.op}`, satir: line(node),
            scoped: !!where && mentions(where, HELPER_WHERE),
          });
        }
        if (mc && mc.model !== "rollError") nextIn = true;
      }
      if (inPrismaArgs && tsc.isPropertyAssignment(node) && RELATION_FIELDS.has(node.name.getText())) {
        const v = node.initializer;
        const isRelationRead = v.kind === tsc.SyntaxKind.TrueKeyword || tsc.isObjectLiteralExpression(v);
        if (isRelationRead) {
          const where = tsc.isObjectLiteralExpression(v) ? prop(v, "where") : undefined;
          accesses.push({
            dosya, sembol: enclosingSymbol(node), erisim: `iliski.${node.name.getText()}`, satir: line(node),
            scoped: !!where && mentions(where, HELPER_WHERE),
          });
        }
      }
      if (tsc.isTaggedTemplateExpression(node) || tsc.isTemplateExpression(node) || tsc.isNoSubstitutionTemplateLiteral(node)) {
        const raw = node.getText();
        if (/\broll_errors\b/.test(raw) && !tsc.isTemplateExpression(node.parent) ) {
          accesses.push({
            dosya, sembol: enclosingSymbol(node), erisim: "sql", satir: line(node),
            scoped: mentions(node, HELPER_SQL),
          });
        }
        return; // iç içe şablonlar dıştakiyle birlikte sayıldı
      }
      tsc.forEachChild(node, (c) => visit(c, nextIn));
    };
    visit(sf, false);
  }
  return accesses;
}

async function main() {
  // §1 Helper üçlüsü eşdeğer — sabit tablo: yalnız PROCESS karar yolundadır.
  console.log("\n§1 Helper üçlüsü eşdeğerliği");
  const EXPECTED: Record<RollErrorOrigin, boolean> = { PROCESS: true, INSPECTION: false };
  const sqlText = ACTIONABLE_ROLL_ERROR_SQL.sql;
  for (const o of Object.values(RollErrorOrigin)) {
    const viaWhere = ACTIONABLE_ROLL_ERROR_WHERE.origin === o;
    const viaPred = isActionableRollError({ origin: o });
    const viaSql = sqlText.includes(`'${o}'`);
    check(`§1 ${o}: where=${viaWhere} yüklem=${viaPred} sql=${viaSql} beklenen=${EXPECTED[o]}`,
      viaWhere === EXPECTED[o] && viaPred === EXPECTED[o] && viaSql === EXPECTED[o]);
  }
  check("§1 SQL parçası tek eşitlik, takma ad `re`, enum tipine çevrimli",
    sqlText === `re."origin" = 'PROCESS'::"RollErrorOrigin"`, sqlText);
  check("§1 tablo şemadaki bütün kökenleri kapsar", Object.keys(EXPECTED).length === Object.values(RollErrorOrigin).length);

  const accesses = await collect();
  const key = (d: { dosya: string; sembol: string; erisim: string }) => `${d.dosya}::${d.sembol}::${d.erisim}`;
  const beyanKeys = new Set(ROLL_ERROR_KAPSAM_BEYANI.map(key));

  const section = (title: string, filter: (a: Access) => boolean) => {
    console.log(`\n${title}`);
    const list = accesses.filter(filter);
    const bad = list.filter((a) => !a.scoped && !beyanKeys.has(key(a)));
    for (const a of bad) console.log(`   ✗ ${a.dosya}:${a.satir} ${a.sembol} ${a.erisim}`);
    return { list, bad };
  };

  const s2 = section("§2 rollError.<op> çağrıları", (a) => a.erisim.startsWith("rollError."));
  check(`§2 ${s2.list.length} çağrı: helper'lı ya da beyanlı`, s2.bad.length === 0, `${s2.bad.length} beyansız`);
  const s3 = section("§3 RollError ilişki okumaları", (a) => a.erisim.startsWith("iliski."));
  check(`§3 ${s3.list.length} ilişki okuması: helper'lı ya da beyanlı`, s3.bad.length === 0, `${s3.bad.length} beyansız`);
  const s4 = section("§4 Ham SQL roll_errors", (a) => a.erisim === "sql");
  check(`§4 ${s4.list.length} ham SQL: ACTIONABLE_ROLL_ERROR_SQL ya da beyanlı`, s4.bad.length === 0, `${s4.bad.length} beyansız`);

  console.log("\n§5 Beyan iki yönlü");
  const unscopedKeys = new Set(accesses.filter((a) => !a.scoped).map(key));
  const dead = ROLL_ERROR_KAPSAM_BEYANI.filter((b) => !unscopedKeys.has(key(b)));
  for (const b of dead) console.log(`   ✗ ölü beyan: ${key(b)}`);
  check(`§5 ${ROLL_ERROR_KAPSAM_BEYANI.length} beyanın hepsi helper'sız canlı bir erişime karşılık gelir`, dead.length === 0, `${dead.length} ölü`);
  const dupBeyan = ROLL_ERROR_KAPSAM_BEYANI.length !== beyanKeys.size;
  check("§5 beyanda tekrar yok", !dupBeyan);
  check("§5 her beyanın gerekçesi var", ROLL_ERROR_KAPSAM_BEYANI.every((b) => b.gerekce.trim().length >= 20));

  // §6 Zemin: ölçülmüş envanter 2026-10-25 — çağrı ≥ 24, ilişki ≥ 8, SQL ≥ 2.
  // KQ-D7: üç yazarın kopya mükerrer okumaları tek boğazda birleşti → çağrı zemini 23.
  console.log("\n§6 Zemin");
  check("§6 rollError çağrısı ≥ 23", s2.list.length >= 23, String(s2.list.length));
  check("§6 ilişki okuması ≥ 8", s3.list.length >= 8, String(s3.list.length));
  check("§6 ham SQL ≥ 2", s4.list.length >= 2, String(s4.list.length));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
