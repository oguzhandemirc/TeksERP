// =============================================================================
// SATICI KAPILARI (statik, AST) — satıcı sunucusunun çekirdek kurallarının mekanik ölçümü.
//   §1 advisory kilit ENVANTERİ: `pg_advisory` yalnız `src/lib/locks.ts`te; `LOCK_NAMESPACES` ile
//      CLAUDE.md tablosu İKİ YÖNLÜ birebir (tanımsız uzay da, ölü tablo satırı da kırmızı)
//   §2 kilit tx'in İLK ifadesi: `prisma.$transaction` geri çağrısının ilk ifadesi `await lock*(…)`
//      (geri çağrı yerel bir fonksiyonu çağırıyorsa O fonksiyonun ilk ifadesi)
//   §3 `tx.*` `Promise.all` içine girmez (tx geri çağrısı içinde `Promise.all` yok)
//   §4 SERT SİLME yalnız telemetride: `.delete/.deleteMany` yalnız `PRUNED_MODELS` modellerinde;
//      ham SQL'de DELETE/TRUNCATE yok
//   §5 şema aynası: Prisma `LisansSinifi` = protokol `LICENSE_CLASSES`; `YaptirimTuru` ⊇ K0…K5
//   §8 hata kodu TEK KAYNAK: portal kodları (`PORTAL_ERROR_CODES`) protokol kodlarıyla (`VENDOR_ERROR_CODES` ∪
//      `PROTOCOL_ERROR_CODES`) kesişmez — ortak kod (BULUNAMADI, TEKRAR_DENEYIN…) yalnız protokolde yaşar
//   §7 kilit SIRASI: bir fonksiyon birden çok kilit alıyorsa sıra PORTAL_TOKEN → DEALER → CUSTOMER →
//      INSTALLATION → LICENSE_NUMBER (lib/locks.ts başlığı); ters sıra kilitlenme (40P01) doğurur
// Taban 0 — tarayıcı (cırcır değil): ihlal doğduğu an kırmızı.
// ⭐ KALICI SONDA ✓K6 (her koşumda): aynı çözümleyiciler sentetik ihlalli kaynakta ISIRIR —
//    kilitsiz tx · tx içinde Promise.all · defter modelinde deleteMany · tabloda olmayan uzay ·
//    kurulum kilidinden SONRA bayi kilidi · kod listesi kesişimi (§8c).
// Koşum: npx tsx scripts/test_satici_kapilari.ts   (DB GEREKMEZ)
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { LICENSE_CLASSES, PROTOCOL_ERROR_CODES, SANCTION_LEVELS, VENDOR_ERROR_CODES } from "../src/lisans-protokol";
import { PORTAL_ERROR_CODES } from "../src/lib/errors";
import { LOCK_NAMESPACES } from "../src/lib/locks";
import { PRUNED_MODELS } from "../src/services/maintenance";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

const SRC = path.join(SATICI_KOKU, "src");
/** Kilit fonksiyonları ve alınma sırası (küçük önce) — lib/locks.ts başlığındaki sıra. */
const LOCK_RANK: Readonly<Record<string, number>> = {
  lockPortalToken: 0,
  lockDealer: 1,
  lockCustomer: 2,
  lockInstallation: 3,
  lockInstallations: 3,
  lockLicenseNumber: 4,
};
const LOCK_FUNCS = new Set(Object.keys(LOCK_RANK));
const DB_CLIENTS = new Set(["prisma", "tx", "db"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "lisans-protokol") out.push(...tsFiles(p));
    } else if (n.endsWith(".ts")) out.push(p);
  }
  return out;
}

function parse(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

function isTransactionCall(n: ts.Node): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "$transaction";
}

/** Fonksiyon gövdesinin ilk ifadesi `await lock*(…)` mı? */
function firstIsLock(body: ts.ConciseBody, sf: ts.SourceFile): boolean | "delegates" {
  if (!ts.isBlock(body)) {
    // `(tx) => renewInTx(tx, …)` — çağrılan yerel fonksiyonun ilk ifadesine bakılır.
    const call = ts.isCallExpression(body) ? body : null;
    if (call && ts.isIdentifier(call.expression)) {
      const name = call.expression.text;
      let target: ts.FunctionDeclaration | undefined;
      walk(sf, (n) => {
        if (ts.isFunctionDeclaration(n) && n.name?.text === name) target = n;
      });
      return target?.body ? firstIsLock(target.body, sf) : false;
    }
    return false;
  }
  const first = body.statements[0];
  if (!first || !ts.isExpressionStatement(first) || !ts.isAwaitExpression(first.expression)) return false;
  const call = first.expression.expression;
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && LOCK_FUNCS.has(call.expression.text);
}

interface Findings {
  unlockedTx: string[];
  promiseAllInTx: string[];
  hardDeletes: string[];
  advisoryOutsideLocks: string[];
  lockOrder: string[];
}

function isFunctionLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
}

/** Fonksiyonun KENDİ gövdesindeki kilit çağrıları (iç içe fonksiyonlara inmeden), kaynak sırasıyla. */
function ownLockCalls(fn: ts.FunctionLikeDeclaration): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (n !== fn && isFunctionLike(n)) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && LOCK_FUNCS.has(n.expression.text)) out.push(n);
    n.forEachChild(visit);
  };
  if (fn.body) visit(fn.body);
  return out;
}

export function analyze(files: { name: string; text: string }[]): Findings {
  const f: Findings = { unlockedTx: [], promiseAllInTx: [], hardDeletes: [], advisoryOutsideLocks: [], lockOrder: [] };
  const allowed = new Set<string>(PRUNED_MODELS);
  for (const { name, text } of files) {
    const sf = parse(name, text);
    const where = (n: ts.Node) => `${name}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    if (!name.endsWith(path.join("lib", "locks.ts")) && /pg_advisory/.test(text)) f.advisoryOutsideLocks.push(name);
    walk(sf, (n) => {
      if (isFunctionLike(n)) {
        let highest = -1;
        for (const call of ownLockCalls(n)) {
          const rank = LOCK_RANK[(call.expression as ts.Identifier).text]!;
          if (rank < highest) f.lockOrder.push(`${where(call)} ${(call.expression as ts.Identifier).text}`);
          highest = Math.max(highest, rank);
        }
      }
      if (isTransactionCall(n)) {
        const cb = n.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          if (firstIsLock(cb.body, sf) !== true) f.unlockedTx.push(where(n));
          walk(cb.body, (m) => {
            if (ts.isCallExpression(m) && m.expression.getText(sf) === "Promise.all") f.promiseAllInTx.push(where(m));
          });
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const receiver = n.expression.expression;
        // Yalnız istemci zinciri: `prisma.<model>.delete*` / `tx.<model>.delete*` / `db.<model>.delete*`.
        if (
          (method === "delete" || method === "deleteMany") &&
          ts.isPropertyAccessExpression(receiver) &&
          ts.isIdentifier(receiver.expression) &&
          DB_CLIENTS.has(receiver.expression.text)
        ) {
          const model = receiver.name.text;
          if (!allowed.has(model)) f.hardDeletes.push(`${where(n)} ${model}.${method}`);
        }
      }
      if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n) || ts.isTemplateExpression(n)) {
        if (/\b(DELETE\s+FROM|TRUNCATE)\b/i.test(n.getText(sf))) f.hardDeletes.push(`${where(n)} ham SQL`);
      }
    });
  }
  return f;
}

/** İki kod listesinin kesişimi (tek kaynak ihlali). */
export function sharedCodes(a: readonly string[], b: readonly string[]): string[] {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

function enumValues(schema: string, name: string): string[] {
  const m = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(schema);
  if (!m) return [];
  return m[1]!
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z0-9_]+$/.test(l));
}

function main(): void {
  const files = tsFiles(SRC).map((p) => ({ name: path.relative(SATICI_KOKU, p), text: readFileSync(p, "utf8") }));
  kontrol("§0 tarama kümesi dolu (src/**/*.ts, protokol aynası hariç)", files.length >= 20, `${files.length} dosya`);
  const f = analyze(files);

  console.log("\n§1 advisory kilit envanteri");
  kontrol("§1a pg_advisory yalnız lib/locks.ts'te", f.advisoryOutsideLocks.length === 0, f.advisoryOutsideLocks.join(", "));
  const doc = readFileSync(path.join(SATICI_KOKU, "CLAUDE.md"), "utf8");
  const tablo = new Map<number, string>();
  for (const m of doc.matchAll(/^\| (\d{4}) \| `([A-Z_]+)` \|/gm)) tablo.set(Number(m[1]), m[2]!);
  const kod = new Map<number, string>(Object.entries(LOCK_NAMESPACES).map(([k, v]) => [v, k]));
  const eksik = [...kod].filter(([n, ad]) => tablo.get(n) !== ad).map(([n, ad]) => `${n}/${ad}`);
  const olu = [...tablo].filter(([n, ad]) => kod.get(n) !== ad).map(([n, ad]) => `${n}/${ad}`);
  kontrol("§1b her uzay CLAUDE.md tablosunda (adıyla)", eksik.length === 0 && kod.size > 0, eksik.join(", ") || `${kod.size} uzay`);
  kontrol("§1c tabloda ölü satır yok", olu.length === 0 && tablo.size > 0, olu.join(", ") || `${tablo.size} satır`);
  kontrol("§1d uzaylar tekil", new Set(Object.values(LOCK_NAMESPACES)).size === Object.values(LOCK_NAMESPACES).length);

  console.log("\n§2–§4 tx ve silme disiplini");
  kontrol("§2 her $transaction'ın ilk ifadesi kilit", f.unlockedTx.length === 0, f.unlockedTx.join(", "));
  kontrol("§3 tx içinde Promise.all yok", f.promiseAllInTx.length === 0, f.promiseAllInTx.join(", "));
  kontrol(`§4 sert silme yalnız telemetride (${PRUNED_MODELS.join(" · ")})`, f.hardDeletes.length === 0, f.hardDeletes.join(", "));
  kontrol("§7 çoklu kilit sırası PORTAL_TOKEN → DEALER → CUSTOMER → INSTALLATION → LICENSE_NUMBER", f.lockOrder.length === 0, f.lockOrder.join(", "));

  console.log("\n§5 şema aynası");
  const schema = readFileSync(path.join(SATICI_KOKU, "prisma", "schema.prisma"), "utf8");
  const siniflar = enumValues(schema, "LisansSinifi");
  kontrol("§5a LisansSinifi = LICENSE_CLASSES", JSON.stringify(siniflar) === JSON.stringify([...LICENSE_CLASSES]), siniflar.join(","));
  const turler = enumValues(schema, "YaptirimTuru");
  kontrol("§5b YaptirimTuru ⊇ K0…K5", SANCTION_LEVELS.every((k) => turler.includes(k)), turler.join(","));

  console.log("\n§8 hata kodu tek kaynak");
  const ortak = sharedCodes(PORTAL_ERROR_CODES, [...VENDOR_ERROR_CODES, ...PROTOCOL_ERROR_CODES]);
  kontrol("§8a portal kodları protokol kodlarıyla kesişmez", ortak.length === 0 && PORTAL_ERROR_CODES.length > 0, ortak.join(", "));
  kontrol("§8b protokolde TEKRAR_DENEYIN ve BULUNAMADI var", (["TEKRAR_DENEYIN", "BULUNAMADI"] as const).every((k) => (VENDOR_ERROR_CODES as readonly string[]).includes(k)));
  kontrol("§8c ✓K kesişim karşılaştırıcısı sentetik ortak kodu yakalar", sharedCodes(["A", "BULUNAMADI"], ["BULUNAMADI", "C"]).join() === "BULUNAMADI");

  console.log("\n§6 ✓K sondaları: çözümleyiciler sentetik ihlalde ısırır");
  const sonda = analyze([
    {
      name: "sonda/a.ts",
      text: `async function a(){ await prisma.$transaction(async (tx) => { const x = await tx.kurulum.findMany(); await lockInstallation(tx, "1"); }); }`,
    },
    {
      name: "sonda/b.ts",
      text: `async function b(){ await prisma.$transaction(async (tx) => { await lockInstallation(tx, "1"); await Promise.all([tx.kira.count(), tx.hak.count()]); }); }`,
    },
    { name: "sonda/c.ts", text: `async function c(){ await prisma.kira.deleteMany({ where: {} }); await tx.$executeRaw\`DELETE FROM kira\`; }` },
    { name: "sonda/d.ts", text: `const q = "SELECT pg_advisory_xact_lock(9999, 1)";` },
    { name: "sonda/e.ts", text: `async function e(tx){ await lockInstallation(tx, "1"); await lockDealer(tx, "2"); }` },
    { name: "sonda/f.ts", text: `async function f(tx){ await lockPortalToken(tx, "t"); await lockDealer(tx, "2"); await lockCustomer(tx, "c"); await lockInstallations(tx, ["1"]); await lockLicenseNumber(tx, 2026); }` },
  ]);
  kontrol("§6a kilitsiz tx yakalanır", sonda.unlockedTx.some((w) => w.startsWith("sonda/a.ts")));
  kontrol("§6b tx içinde Promise.all yakalanır", sonda.promiseAllInTx.some((w) => w.startsWith("sonda/b.ts")));
  const c = sonda.hardDeletes.filter((w) => w.startsWith("sonda/c.ts"));
  kontrol("§6c defter modelinde deleteMany + ham DELETE yakalanır", c.some((w) => w.endsWith("kira.deleteMany")) && c.some((w) => w.endsWith("ham SQL")), c.join(" · "));
  kontrol("§6d kilit dosyası dışında pg_advisory yakalanır", sonda.advisoryOutsideLocks.includes("sonda/d.ts"));
  kontrol("§6e kurulum kilidinden SONRA bayi kilidi yakalanır", sonda.lockOrder.some((w) => w.startsWith("sonda/e.ts") && w.endsWith("lockDealer")));
  kontrol("§6f doğru sıradaki beşli kilit zinciri SUSAR (kör reddetme yok)", !sonda.lockOrder.some((w) => w.startsWith("sonda/f.ts")));
  sonuc();
}

main();
