// =============================================================================
// Yönerge dilbilgisi — data-if koşulu ve data-filtre zinciri → Liquid (plan §5 sonu)
// =============================================================================
// Dar dilbilgisi bilerek: parantez yok, değer yalnız "metin"/sayı/sabit; filtre adı
// izin listesinden. Daha fazlası kod kipinin işidir.

import { ALLOWED_FILTER_NAMES } from "./filtreler";
import { WS } from "./yonerge-belirtec";

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/;
export const LOOP_VAR = /^[a-z_][a-z0-9_]*$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const STRING = /^"[^"{}%]*"$/;
const LITERALS = new Set(["true", "false", "nil", "blank"]);
const OPERATORS = new Set(["==", "!=", ">", "<", ">=", "<=", "contains"]);

export function isPath(x: string): boolean {
  return PATH.test(x);
}

/** `"…"` dizelerini tek parça tutarak boşlukla böler. */
function splitWords(expr: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (WS.has(expr[i]!)) {
      i++;
      continue;
    }
    if (expr[i] === '"') {
      const k = expr.indexOf('"', i + 1);
      if (k < 0) return null;
      out.push(expr.slice(i, k + 1));
      i = k + 1;
      continue;
    }
    let j = i;
    while (j < expr.length && !WS.has(expr[j]!) && expr[j] !== '"') j++;
    out.push(expr.slice(i, j));
    i = j;
  }
  return out;
}

/** data-if: `yol (op değer)? ((and|or) yol (op değer)?)*` → Liquid koşulu; hata Türkçe mesaj. */
export function compileCondition(raw: string): { liquid: string } | { error: string } {
  const p = splitWords(raw.trim());
  if (!p || p.length === 0) return { error: "koşul boş ya da kapanmamış tırnak var" };
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const path = p[i];
    if (path === undefined || !isPath(path)) return { error: `alan yolu bekleniyordu: '${path ?? ""}'` };
    out.push(path);
    i++;
    if (p[i] !== undefined && OPERATORS.has(p[i]!)) {
      const op = p[i]!;
      const value = p[i + 1];
      if (value === undefined || !(STRING.test(value) || NUMBER.test(value) || LITERALS.has(value))) {
        return { error: `'${op}' sonrasında değer bekleniyordu ("metin", sayı, true, false, nil, blank)` };
      }
      out.push(op, value);
      i += 2;
    }
    if (i >= p.length) break;
    if (p[i] !== "and" && p[i] !== "or") return { error: `'and' ya da 'or' bekleniyordu: '${p[i]}'` };
    out.push(p[i]!);
    i++;
  }
  return { liquid: out.join(" ") };
}

/** data-filtre: `ad(: arg(, arg)*)? (| ad …)*` → ` | ad: arg` zinciri. */
export function compileFilterChain(raw: string): { liquid: string } | { error: string } {
  const out: string[] = [];
  for (const piece of raw.split("|")) {
    const t = piece.trim();
    const m = /^([a-z_][a-z0-9_]*)\s*(?::\s*(.+))?$/.exec(t);
    if (!m) return { error: `filtre biçimi tanınmadı: '${t}'` };
    const name = m[1]!;
    if (!ALLOWED_FILTER_NAMES.has(name)) return { error: `izinsiz filtre: '${name}'` };
    if (m[2] === undefined) {
      out.push(` | ${name}`);
      continue;
    }
    const args = m[2].split(",").map((a) => a.trim());
    for (const a of args) {
      if (!(NUMBER.test(a) || STRING.test(a) || LITERALS.has(a))) return { error: `'${name}' filtresinin argümanı geçersiz: '${a}'` };
    }
    out.push(` | ${name}: ${args.join(", ")}`);
  }
  return { liquid: out.join("") };
}
