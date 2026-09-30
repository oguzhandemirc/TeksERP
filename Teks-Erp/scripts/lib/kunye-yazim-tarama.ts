// Künye (createdById) YAZIM taraması — `PROVENANCE_MODELS` üyelerinin src'deki her yaratma çağrısı
// oluşturanı yazıyor mu? Yazmayan çağrı ya düzeltilir ya da aşağıdaki borç listesine AÇIK ADLA girer.
// Borç listesi cırcır DEĞİLDİR: düzeltilen kayıt listeden düşürülmek ZORUNDADIR (bayat beyan = kırmızı).
import fs from "fs";
import path from "path";
import ts from "typescript";

/** Oluşturanı yazmayan, bilinen ve beyanlı yaratma çağrıları. Anahtar: `<src'ye göre yol>::<model>.<metot>`. */
export const KUNYE_BORCLARI: Readonly<Record<string, string>> = {};

const CREATE_METHODS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

export interface KunyeSite {
  key: string;
  file: string;
  line: number;
  model: string;
  writes: boolean;
}

/** `withActor(...)` çağrısı mı (ve 4. argümanı bu modeli ya da dinamik model adını mı veriyor)? */
function isWithActorFor(node: ts.Node, model: string): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "withActor") return false;
  const arg = node.arguments[3];
  if (!arg) return false;
  return ts.isStringLiteral(arg) ? arg.text === model : true;
}

function containsWithActor(root: ts.Node, model: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isWithActorFor(n, model)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function containsCreatedById(root: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if ((ts.isIdentifier(n) || ts.isStringLiteral(n)) && n.text === "createdById") { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function enclosingFunction(n: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = n.parent;
  while (cur && !ts.isFunctionLike(cur)) cur = cur.parent;
  return cur;
}

/**
 * Bir kaynağın yaratma çağrılarını bulur. Çağrı "yazıyor" sayılır: argümanında `createdById` ya da bu model için
 * `withActor(` varsa, YA DA çevreleyen fonksiyonda bu model için `withActor(` çağrısı varsa (gövde önce kurulur).
 * `this.delegate.create` BaseService'in genel yoludur; modeli dinamiktir (`this.config.modelName`).
 */
export function scanSource(relPath: string, text: string, models: ReadonlySet<string>): KunyeSite[] {
  const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
  const out: KunyeSite[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      const recv = n.expression.expression;
      if (CREATE_METHODS.has(method) && ts.isPropertyAccessExpression(recv)) {
        const owner = recv.name.text;
        const model = models.has(owner) ? owner : owner === "delegate" ? "*" : null;
        if (model) {
          const fn = enclosingFunction(n);
          const writes =
            n.arguments.some((a) => containsCreatedById(a) || containsWithActor(a, model)) ||
            (fn !== undefined && containsWithActor(fn, model));
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          out.push({ key: `${relPath}::${owner}.${method}`, file: relPath, line, model, writes });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** src altındaki (test dışı) bütün .ts dosyalarını tarar. */
export function scanSrc(srcDir: string, models: ReadonlySet<string>): { files: number; sites: KunyeSite[] } {
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) files.push(fp);
    }
  })(srcDir);
  const sites: KunyeSite[] = [];
  for (const f of files) {
    const rel = path.relative(srcDir, f).split(path.sep).join("/");
    sites.push(...scanSource(rel, fs.readFileSync(f, "utf8"), models));
  }
  return { files: files.length, sites };
}

/** Karar: beyansız yazmayan çağrı · bayat beyan (çağrı yok) · kapanmış borç (artık yazıyor). */
export function judge(sites: KunyeSite[], debts: Readonly<Record<string, string>>): {
  undeclared: KunyeSite[]; staleMissing: string[]; staleFixed: string[];
} {
  const byKey = new Map<string, KunyeSite[]>();
  for (const s of sites) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const undeclared = sites.filter((s) => !s.writes && !(s.key in debts));
  const staleMissing = Object.keys(debts).filter((k) => !byKey.has(k));
  const staleFixed = Object.keys(debts).filter((k) => byKey.has(k) && byKey.get(k)!.every((s) => s.writes));
  return { undeclared, staleMissing, staleFixed };
}
