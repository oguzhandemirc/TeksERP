// =============================================================================
// MALİYET FORMÜLÜ İFADE DEĞERLENDİRİCİSİ — paketsiz, Decimal, beyaz liste (SY-C1)
// =============================================================================
// Kullanıcı tanımlı ek maliyet satırı (`CostFormula.expression`) BURADA ayrıştırılır ve hesaplanır.
// `eval`/`Function` YOK: özyinelemeli iniş ayrıştırıcısı yalnız sayı, izinli değişken, + − × ÷ * /,
// parantez ve min/max/round tanır; başka her ad 400 (fail-closed). Hesap tam `Prisma.Decimal`.
// Kayıtta ayrıştırılır (`parseCostFormula`), motorda donmuş metinden yeniden hesaplanır.
// =============================================================================
import { Prisma } from "@prisma/client";

type Dec = Prisma.Decimal;

export const COST_FORMULA_MAX_LENGTH = 500;
export const COST_FORMULA_MAX_DEPTH = 32;
const FUNCTIONS = { min: 2, max: 2, round: 2 } as const;
type FnName = keyof typeof FUNCTIONS;

export type FormulaNode =
  | { k: "num"; v: Dec }
  | { k: "var"; name: string }
  | { k: "neg"; a: FormulaNode }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; a: FormulaNode; b: FormulaNode }
  | { k: "fn"; name: FnName; args: FormulaNode[] };

/** Ayrıştırma/hesap hatası — `code` HTTP katmanında `details.code` olur. */
export class CostFormulaError extends Error {
  constructor(
    message: string,
    readonly code: "COST_FORMULA_INVALID" | "COST_FORMULA_UNKNOWN_VARIABLE" | "COST_FORMULA_EVAL_FAILED",
    readonly detail: { position?: number; name?: string } = {},
  ) {
    super(message);
  }
}

type Tok = { t: "num"; v: Dec; p: number } | { t: "id"; v: string; p: number } | { t: "op"; v: string; p: number };

// Türkçe ondalık virgülü kabul edilir ("0,05"); fonksiyon argümanı `;` ile ayrılır (Excel TR alışkanlığı).
const OP_ALIAS: Record<string, string> = { "×": "*", "÷": "/", "−": "-", "·": "*" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(?:[.,][0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: new Prisma.Decimal(m[0].replace(",", ".")), p: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const op = OP_ALIAS[ch] ?? ch;
    if ("+-*/();".includes(op)) {
      out.push({ t: "op", v: op, p: i });
      i++;
      continue;
    }
    throw new CostFormulaError(`Formülde tanınmayan karakter "${ch}" (konum ${i + 1}).`, "COST_FORMULA_INVALID", { position: i + 1 });
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[], private readonly allowed: ReadonlySet<string>) {}

  parse(): FormulaNode {
    if (!this.toks.length) throw new CostFormulaError("Formül boş olamaz.", "COST_FORMULA_INVALID");
    const n = this.expr(0);
    const rest = this.toks[this.i];
    if (rest) throw this.unexpected(rest);
    return n;
  }

  private unexpected(t: Tok | undefined): CostFormulaError {
    if (!t) return new CostFormulaError("Formül yarım kaldı (sonda işlenen bekleniyor).", "COST_FORMULA_INVALID");
    return new CostFormulaError(`Formülde beklenmeyen "${t.t === "num" ? t.v.toString() : t.v}" (konum ${t.p + 1}).`, "COST_FORMULA_INVALID", { position: t.p + 1 });
  }
  private peekOp(v: string): boolean {
    const t = this.toks[this.i];
    return t?.t === "op" && t.v === v;
  }
  private guard(depth: number): void {
    if (depth > COST_FORMULA_MAX_DEPTH) throw new CostFormulaError(`Formül çok derin (en çok ${COST_FORMULA_MAX_DEPTH} iç içe düzey).`, "COST_FORMULA_INVALID");
  }

  private expr(d: number): FormulaNode {
    this.guard(d);
    let a = this.term(d + 1);
    while (this.peekOp("+") || this.peekOp("-")) {
      const op = (this.toks[this.i++] as Tok).v as "+" | "-";
      a = { k: "bin", op, a, b: this.term(d + 1) };
    }
    return a;
  }
  private term(d: number): FormulaNode {
    this.guard(d);
    let a = this.unary(d + 1);
    while (this.peekOp("*") || this.peekOp("/")) {
      const op = (this.toks[this.i++] as Tok).v as "*" | "/";
      a = { k: "bin", op, a, b: this.unary(d + 1) };
    }
    return a;
  }
  private unary(d: number): FormulaNode {
    this.guard(d);
    if (this.peekOp("-")) { this.i++; return { k: "neg", a: this.unary(d + 1) }; }
    if (this.peekOp("+")) { this.i++; return this.unary(d + 1); }
    return this.atom(d + 1);
  }
  private atom(d: number): FormulaNode {
    this.guard(d);
    const t = this.toks[this.i];
    if (!t) throw this.unexpected(t);
    if (t.t === "num") { this.i++; return { k: "num", v: t.v }; }
    if (t.t === "op" && t.v === "(") {
      this.i++;
      const n = this.expr(d + 1);
      if (!this.peekOp(")")) throw this.unexpected(this.toks[this.i]);
      this.i++;
      return n;
    }
    if (t.t === "id") {
      this.i++;
      if (this.peekOp("(")) {
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, t.v)) {
          throw new CostFormulaError(`Tanınmayan işlev "${t.v}" — yalnız min, max, round kullanılabilir.`, "COST_FORMULA_INVALID", { position: t.p + 1, name: t.v });
        }
        const name = t.v as FnName;
        this.i++;
        const args: FormulaNode[] = [this.expr(d + 1)];
        while (this.peekOp(";")) { this.i++; args.push(this.expr(d + 1)); }
        if (!this.peekOp(")")) throw this.unexpected(this.toks[this.i]);
        this.i++;
        if (args.length !== FUNCTIONS[name]) throw new CostFormulaError(`"${name}" ${FUNCTIONS[name]} değer ister (ayırıcı ";").`, "COST_FORMULA_INVALID", { position: t.p + 1, name });
        return { k: "fn", name, args };
      }
      if (!this.allowed.has(t.v)) {
        throw new CostFormulaError(`Tanınmayan değişken "${t.v}" (konum ${t.p + 1}).`, "COST_FORMULA_UNKNOWN_VARIABLE", { position: t.p + 1, name: t.v });
      }
      return { k: "var", name: t.v };
    }
    throw this.unexpected(t);
  }
}

/** Ayrıştır + beyaz liste denetimi; hata `CostFormulaError`. */
export function parseCostFormula(expression: string, allowedVariables: ReadonlySet<string>): FormulaNode {
  if (expression.length > COST_FORMULA_MAX_LENGTH) throw new CostFormulaError(`Formül en çok ${COST_FORMULA_MAX_LENGTH} karakter olabilir.`, "COST_FORMULA_INVALID");
  return new Parser(tokenize(expression), allowedVariables).parse();
}

/** Formülde geçen değişken adları (tekil, sıralı) — eksik girdi ve yer tutucu denetimi için. */
export function formulaVariables(node: FormulaNode): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaNode): void => {
    if (n.k === "var") out.add(n.name);
    else if (n.k === "neg") walk(n.a);
    else if (n.k === "bin") { walk(n.a); walk(n.b); }
    else if (n.k === "fn") n.args.forEach(walk);
  };
  walk(node);
  return [...out].sort();
}

/** Hesap; değişken değeri yoksa ya da sıfıra bölme → `COST_FORMULA_EVAL_FAILED`. */
export function evaluateCostFormula(node: FormulaNode, vars: ReadonlyMap<string, Dec>): Dec {
  switch (node.k) {
    case "num":
      return node.v;
    case "var": {
      const v = vars.get(node.name);
      if (!v) throw new CostFormulaError(`"${node.name}" değeri bu hesapta yok.`, "COST_FORMULA_EVAL_FAILED", { name: node.name });
      return v;
    }
    case "neg":
      return evaluateCostFormula(node.a, vars).neg();
    case "bin": {
      const a = evaluateCostFormula(node.a, vars);
      const b = evaluateCostFormula(node.b, vars);
      if (node.op === "+") return a.plus(b);
      if (node.op === "-") return a.minus(b);
      if (node.op === "*") return a.mul(b);
      if (b.isZero()) throw new CostFormulaError("Formülde sıfıra bölme.", "COST_FORMULA_EVAL_FAILED");
      return a.div(b);
    }
    case "fn": {
      const [a, b] = node.args.map((x) => evaluateCostFormula(x, vars)) as [Dec, Dec];
      if (node.name === "min") return Prisma.Decimal.min(a, b);
      if (node.name === "max") return Prisma.Decimal.max(a, b);
      if (!b.isInteger() || b.lt(0) || b.gt(10)) throw new CostFormulaError("round hane sayısı 0–10 arası tam sayı olmalı.", "COST_FORMULA_EVAL_FAILED");
      return a.toDecimalPlaces(b.toNumber(), Prisma.Decimal.ROUND_HALF_UP);
    }
  }
}
