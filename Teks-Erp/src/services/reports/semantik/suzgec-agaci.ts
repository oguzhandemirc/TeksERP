// =============================================================================
// SÜZGEÇ AĞACI — kök "ve"/"veya" + BİR seviye iç grup + "arasında" (plan §3.2; rapor küçükler)
// =============================================================================
// İki tel biçimi tek yerde: tanım gövdesi `{combinator, rules}` (oluşturucu/kod modu) ve semantik
// sorgu `suzgec[] + suzgecBaglaci` (Türkçe anahtarlar). Derleyici her grubu SQL'de parantezler;
// değerler yine yalnız bağlı parametredir. Helper ölçü bellekte yalnız "ve" süzer.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { FILTER_OPERATORS, type CompiledFilter, type CompiledFilterGroup, type SemanticCube, type SemanticDimension } from "./tipler";

const filterRuleSchema = z
  .object({
    field: z.string().min(1).max(96),
    operator: z.enum(FILTER_OPERATORS),
    value: z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(500)]),
  })
  .strict();

export const MAX_FILTER_RULES = 10;
const FILTER_JOINS = ["and", "or"] as const;
/** Bir seviye iç grup (plan §3.2): grubun içinde yalnız koşul satırı. */
const filterInnerGroupSchema = z.object({ combinator: z.enum(FILTER_JOINS), rules: z.array(filterRuleSchema).min(1).max(MAX_FILTER_RULES) }).strict();
export const filterTreeSchema = z
  .object({ combinator: z.enum(FILTER_JOINS), rules: z.array(z.union([filterRuleSchema, filterInnerGroupSchema])).max(MAX_FILTER_RULES) })
  .strict();
/** Analiz bloğu iki küpü aynı süzgeçle okur — yalnız "ve" ile bağlı düz koşullar. */
export const andFilterSchema = z.object({ combinator: z.literal("and"), rules: z.array(filterRuleSchema).max(MAX_FILTER_RULES) }).strict();
export type FilterRuleDef = z.infer<typeof filterRuleSchema>;
export type FilterInnerGroupDef = z.infer<typeof filterInnerGroupSchema>;
export type FilterTreeDef = z.infer<typeof filterTreeSchema>;
export const isFilterRuleDef = (r: FilterRuleDef | FilterInnerGroupDef): r is FilterRuleDef => !("combinator" in r);

// ---- semantik sorgu biçimi (Türkçe anahtarlar)
const filterValue = z.string().min(1).max(200);

const filterLeafSchema = z
  .object({
    alan: z.string().min(1).max(64),
    islec: z.enum(FILTER_OPERATORS),
    deger: z.union([filterValue, z.array(filterValue).max(500)]),
  })
  .strict();
const JOINS = ["ve", "veya"] as const;
/** Bir seviye iç grup: grubun içinde yalnız koşul satırı (grup içinde grup yok). */
const filterGroupSchema = z.object({ baglac: z.enum(JOINS), kurallar: z.array(filterLeafSchema).min(1).max(MAX_FILTER_RULES) }).strict();
export type SemanticFilterLeaf = z.infer<typeof filterLeafSchema>;
export type SemanticFilterGroup = z.infer<typeof filterGroupSchema>;
export const isFilterGroup = (f: SemanticFilterLeaf | SemanticFilterGroup): f is SemanticFilterGroup => "kurallar" in f;
export const semanticJoinSchema = z.enum(JOINS);
/** Kök bağlacı `suzgecBaglaci`dadır (yoksa "ve" — eski düz liste aynı anlamı korur). */
export const semanticFilterSchema = z
  .array(z.union([filterLeafSchema, filterGroupSchema]))
  .max(MAX_FILTER_RULES)
  .default([])
  .refine((xs) => xs.reduce((n, f) => n + (isFilterGroup(f) ? f.kurallar.length : 1), 0) <= MAX_FILTER_RULES, `En çok ${MAX_FILTER_RULES} süzgeç koşulu.`);

/**
 * "arasında": sıralı boyutun değer listesinde [baş, son] dilimi; baş > son ise sondan başa sarar
 * (saat 22–2 → 22, 23, 0, 1, 2). IN listesine açılır — SQL'de karşılaştırma yok.
 */
export function expandBetween(dim: SemanticDimension, from: string, to: string): string[] {
  const all = dim.enumValues ?? [];
  const a = all.indexOf(from);
  const b = all.indexOf(to);
  return a <= b ? all.slice(a, b + 1) : [...all.slice(a), ...all.slice(0, b + 1)];
}

const COMBINATOR = { ve: "and", veya: "or" } as const;

export function buildFilterTree(
  items: ReadonlyArray<SemanticFilterLeaf | SemanticFilterGroup>,
  join: "ve" | "veya" | undefined,
  leaf: (r: SemanticFilterLeaf) => CompiledFilter,
): CompiledFilterGroup {
  return {
    combinator: COMBINATOR[join ?? "ve"],
    items: items.map((f): CompiledFilter | CompiledFilterGroup => (isFilterGroup(f) ? { combinator: COMBINATOR[f.baglac], items: f.kurallar.map(leaf) } : leaf(f))),
  };
}

const isCompiledGroup = (f: CompiledFilter | CompiledFilterGroup): f is CompiledFilterGroup => "items" in f;

/** Ağaçtaki bütün koşullar (JOIN toplamak için). */
export function filterLeaves(g: CompiledFilterGroup): CompiledFilter[] {
  return g.items.flatMap((f) => (isCompiledGroup(f) ? filterLeaves(f) : [f]));
}

/**
 * Helper ölçü bellekte yalnız "hepsi birlikte" süzer: ağaç saf "ve" değilse null.
 * Tek koşullu grup bağlacından bağımsızdır.
 */
export function andOnlyLeaves(g: CompiledFilterGroup): CompiledFilter[] | null {
  const out: CompiledFilter[] = [];
  if (g.combinator === "or" && g.items.length > 1) return null;
  for (const f of g.items) {
    if (!isCompiledGroup(f)) out.push(f);
    else {
      const inner = andOnlyLeaves(f);
      if (!inner) return null;
      out.push(...inner);
    }
  }
  return out;
}

/** Her grup parantezde: `a AND (b OR c)` — iç grup bağlacı dış bağlaçla karışmaz. */
export function compileTreeSql(g: CompiledFilterGroup, leaf: (f: CompiledFilter) => Prisma.Sql): Prisma.Sql | null {
  const parts = g.items.map((f) => (isCompiledGroup(f) ? compileTreeSql(f, leaf) : leaf(f))).filter((x): x is Prisma.Sql => x !== null);
  if (!parts.length) return null;
  return Prisma.sql`(${Prisma.join(parts, g.combinator === "or" ? " OR " : " AND ")})`;
}

export interface FilterCheckSink {
  issue: (i: { yol: string; mesaj: string; oneri?: string }) => void;
  suggest: (input: string, candidates: Iterable<string>) => string | undefined;
  /** `$ad` değeri: parametre bağlama + boyut uyumu tanım şemasında. */
  ref: (value: string, path: string, field: string) => void;
}

/** Tanım süzgecinin alan/işleç/değer denetimi; yollar `…suzgec.rules[i](.rules[j])`. */
export function checkFilterTree(tree: FilterTreeDef | z.infer<typeof andFilterSchema>, cube: SemanticCube, path: string, sink: FilterCheckSink): void {
  const checkRule = (r: FilterRuleDef, rp: string): void => {
    const dim = cube.dimensions.find((d) => d.id === r.field);
    if (!dim) sink.issue({ yol: `${rp}.field`, mesaj: `"${cube.name}" küpünde "${r.field}" boyutu yok.`, oneri: sink.suggest(r.field, cube.dimensions.map((x) => x.id)) });
    if (r.operator === "between") {
      if (dim && !dim.ordered) sink.issue({ yol: `${rp}.operator`, mesaj: `"${dim.name}" sıralı bir alan değil; "arasında" kullanılamaz.` });
      if (!Array.isArray(r.value) || r.value.length !== 2 || r.value.some((v) => v.startsWith("$"))) sink.issue({ yol: `${rp}.value`, mesaj: `"arasında" iki sınır değeri ister (başlangıç ve bitiş).` });
      return;
    }
    if (typeof r.value === "string" && r.value.startsWith("$")) sink.ref(r.value, `${rp}.value`, r.field);
  };
  let count = 0;
  tree.rules.forEach((r, i) => {
    const rp = `${path}.rules[${i}]`;
    if (isFilterRuleDef(r)) {
      count++;
      checkRule(r, rp);
    } else {
      count += r.rules.length;
      r.rules.forEach((x, j) => checkRule(x, `${rp}.rules[${j}]`));
    }
  });
  if (count > MAX_FILTER_RULES) sink.issue({ yol: path, mesaj: `En çok ${MAX_FILTER_RULES} süzgeç koşulu kullanılabilir.` });
}
