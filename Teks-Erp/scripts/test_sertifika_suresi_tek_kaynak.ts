// =============================================================================
// BEKÇİ (AST, DB'siz): sertifika süre yüklemi TEK KAYNAK — `certificateExpiryWhere` (K4P-SERT)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_sertifika_suresi_tek_kaynak
// =============================================================================
// NEDEN: panel "süresi yaklaşan" süzgeci ile `kalite.sertifika-suresi-doluyor` bildirimi aynı soruyu
// sorar. Biri kendi `expiresOn` karşılaştırmasını yazarsa (ör. `lt` yerine `lte`, yenilenmiş sertifikayı
// unutmak) panel listesi ile bildirim AYRIŞIR: kullanıcı listede görmediği sertifika için bildirim alır.
//   §1 panel okuyucusu (`certificate-query.service.ts`) ve bildirim kaynağı (`notification-sources/kalite.ts`)
//      `certificateExpiryWhere`'i ÇAĞIRIR
//   §2 `expiresOn` karşılaştırması (Prisma `lt/lte/gt/gte` parçası ya da `<`/`>` ifadesi) helper DIŞINDA YOK
// Negatif sonda: kaynakta yüklem satır içi yazılınca (`expiresOn: { lte: … }`) §1 + §2 ❌.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");
const HELPER = "src/services/helpers/certificate-active.helper.ts";
const CALLERS = ["src/services/certificate-query.service.ts", "src/services/notification-sources/kalite.ts"];
const FIELD = "expiresOn";
const CMP_KEYS = new Set(["lt", "lte", "gt", "gte"]);
const CMP_OPS = new Set([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".d.ts") ? [p] : [];
  });
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

const nameOf = (n: ts.PropertyName): string => (ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : "");

/** `expiresOn` karşılaştırmaları: `{ expiresOn: { lte: … } }` ve `a.expiresOn < b`. */
function comparisons(sf: ts.SourceFile): string[] {
  const hits: string[] = [];
  const at = (n: ts.Node) => `${relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const mentions = (n: ts.Node): boolean => {
    let found = false;
    const walk = (x: ts.Node): void => {
      if (found) return;
      if ((ts.isPropertyAccessExpression(x) && x.name.text === FIELD) || (ts.isIdentifier(x) && x.text === FIELD)) found = true;
      else ts.forEachChild(x, walk);
    };
    walk(n);
    return found;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && nameOf(n.name) === FIELD && ts.isObjectLiteralExpression(n.initializer)) {
      if (n.initializer.properties.some((p) => p.name && CMP_KEYS.has(nameOf(p.name)))) hits.push(at(n));
    }
    if (ts.isBinaryExpression(n) && CMP_OPS.has(n.operatorToken.kind) && (mentions(n.left) || mentions(n.right))) hits.push(at(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** Dosyada `certificateExpiryWhere(...)` çağrısı var mı (yalnız import yetmez). */
function callsHelper(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "certificateExpiryWhere") found = true;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function main(): void {
  console.log("=== Sertifika süre yüklemi tek kaynak bekçisi ===\n");
  const all = files(SRC);
  check("§0 tarama kör değil (≥ 500 kaynak dosya, helper var)", all.length >= 500 && all.some((f) => relative(ROOT, f) === HELPER), `${all.length} dosya`);
  const helperHits = comparisons(parse(join(ROOT, HELPER)));
  check("§0b sonda zemini: helper'ın KENDİ karşılaştırması bulunuyor (tarayıcı kör değil)", helperHits.length >= 1, helperHits.join(", "));

  console.log("§1 çağıranlar helper'ı kullanır");
  for (const c of CALLERS) check(`§1 ${c} → certificateExpiryWhere(...) çağrısı`, callsHelper(parse(join(ROOT, c))));

  console.log("§2 helper dışında `expiresOn` karşılaştırması yok");
  const leaks = all.filter((f) => relative(ROOT, f) !== HELPER).flatMap((f) => comparisons(parse(f)));
  check("§2 ⭐ `expiresOn` karşılaştırması yalnız helper'da", leaks.length === 0, leaks.join(" · ") || "yok");

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main();
