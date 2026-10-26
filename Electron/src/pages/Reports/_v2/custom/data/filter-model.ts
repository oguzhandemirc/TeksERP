// =============================================================================
// Oluşturucu süzgeci — `sorgu.suzgec` ağacı (plan §3.2) üzerinde saf işlemler (R2-VERI)
// =============================================================================
// İstemci süzgeci SQL'e ÇEVİRMEZ: yalnız `{combinator, rules[{field, operator, value}]}` JSON'unu kurar,
// sunucu `dogrula`/`onizle` ile yeniden derler. Günlük dil cümlesi de buradan (paket yok, K-SUZGEC).
// =============================================================================

/** Sunucunun derlediği işleçler (`semantik/tipler.ts` FILTER_OPERATORS; fikstür + backend bekçisi eşitliği ölçer). */
export const FILTER_OPERATORS = ["=", "!=", "in", "notIn", "contains", "between"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Türkçe işleç adları — her sunucu işlecinin adı DOLU olmalı (vitest ölçer; İngilizce sızmaz). */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  "=": "eşittir",
  "!=": "eşit değildir",
  in: "şunlardan biri",
  notIn: "şunların dışında",
  contains: "içerir",
  between: "arasında",
};

const SINGLE_VALUE = new Set<FilterOperator>(["=", "!=", "contains"]);
export const isSingleValue = (op: FilterOperator) => SINGLE_VALUE.has(op);
/** "arasında" iki sınır taşır [başlangıç, bitiş]; sıralı alanda sunucu açar (baş > son: sondan başa sarar). */
export const isRange = (op: FilterOperator) => op === "between";

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

export interface FilterGroup {
  combinator: "and" | "or";
  rules: Array<FilterRule | FilterGroup>;
}

/** Sunucu "ve"/"veya" kökü + BİR seviye iç grup derler (`rapor-tanimi.schema.ts` filterTreeSchema); toplam koşul tavanı. */
export const MAX_FILTER_RULES = 10;

export const isGroup = (r: FilterRule | FilterGroup): r is FilterGroup => "combinator" in r;

const valuesOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : typeof v === "string" && v ? [v] : []);

/** Kurucu satırı tamam mı: alan + işleç + en az bir değer (tek değerli işleçte tam bir). */
export function isCompleteRule(r: FilterRule): boolean {
  const vals = valuesOf(r.value);
  const count = isSingleValue(r.operator) ? vals.length === 1 : isRange(r.operator) ? vals.length === 2 : vals.length > 0;
  return Boolean(r.field) && FILTER_OPERATORS.includes(r.operator) && count;
}

function normalizeRule(r: FilterRule): FilterRule {
  const vals = valuesOf(r.value);
  return { field: r.field, operator: r.operator, value: isSingleValue(r.operator) ? vals[0]! : isRange(r.operator) ? vals.slice(0, 2) : vals };
}

/** Kurucu durumu → tanım JSON'u: yarım satır düşer, boş ağaç `undefined` (anahtar yazılmaz). */
export function toQueryFilter(group: FilterGroup | undefined): FilterGroup | undefined {
  if (!group) return undefined;
  const rules = group.rules.flatMap((r): Array<FilterRule | FilterGroup> => {
    if (isGroup(r)) {
      const inner = toQueryFilter(r);
      return inner ? [inner] : [];
    }
    return isCompleteRule(r) ? [normalizeRule(r)] : [];
  });
  return rules.length ? { combinator: group.combinator, rules } : undefined;
}

/** Kayıtlı gövdeden okuma — tanınmayan biçim boş ağaç olur (sunucu zaten reddederdi). */
export function fromQueryFilter(raw: unknown): FilterGroup {
  const g = raw as { combinator?: unknown; rules?: unknown } | null;
  if (!g || !Array.isArray(g.rules)) return { combinator: "and", rules: [] };
  const rules = g.rules.flatMap((r): Array<FilterRule | FilterGroup> => {
    const x = r as { combinator?: unknown; field?: unknown; operator?: unknown; value?: unknown };
    if (x && "combinator" in x) return [fromQueryFilter(x)];
    if (!x || typeof x.field !== "string" || !FILTER_OPERATORS.includes(x.operator as FilterOperator)) return [];
    return [{ field: x.field, operator: x.operator as FilterOperator, value: Array.isArray(x.value) ? valuesOf(x.value) : String(x.value ?? "") }];
  });
  return { combinator: g.combinator === "or" ? "or" : "and", rules };
}

/** Kurucunun düzenleyebileceği biçim mi: iç grupların içinde yalnız koşul (grup içinde grup yok). */
export function isEditable(group: FilterGroup): boolean {
  return group.rules.every((r) => !isGroup(r) || r.rules.every((x) => !isGroup(x)));
}

/** Ağaçtaki bütün koşulların alanları (değer etiketleri bunlar için yüklenir). */
export function leafFields(group: FilterGroup): string[] {
  return group.rules.flatMap((r) => (isGroup(r) ? leafFields(r) : r.field ? [r.field] : []));
}

/** Koşulun yeri: kökte `[i]`, iç grupta `[i, j]`. */
export type RulePath = [number] | [number, number];
export const EMPTY_RULE: FilterRule = { field: "", operator: "in", value: [] };

function mapRules(group: FilterGroup, gi: number | null, fn: (rules: FilterGroup["rules"]) => FilterGroup["rules"]): FilterGroup {
  if (gi === null) return { ...group, rules: fn(group.rules) };
  return { ...group, rules: group.rules.map((r, i) => (i === gi && isGroup(r) ? { ...r, rules: fn(r.rules) } : r)) };
}

export function patchRuleAt(group: FilterGroup, path: RulePath, patch: Partial<FilterRule>): FilterGroup {
  const at = path[path.length - 1]!;
  return mapRules(group, path.length === 2 ? path[0] : null, (rules) => rules.map((r, i) => (i === at && !isGroup(r) ? { ...r, ...patch } : r)));
}

/** Koşulu siler; boşalan iç grup da düşer. */
export function removeRuleAt(group: FilterGroup, path: RulePath): FilterGroup {
  const at = path[path.length - 1]!;
  const next = mapRules(group, path.length === 2 ? path[0] : null, (rules) => rules.filter((_, i) => i !== at));
  return { ...next, rules: next.rules.filter((r) => !isGroup(r) || r.rules.length > 0) };
}

/** Köke (gi null) ya da iç gruba boş koşul ekler — toplam tavan aşılmaz. */
export function addRule(group: FilterGroup, gi: number | null): FilterGroup {
  if (countRules(group) >= MAX_FILTER_RULES) return group;
  return mapRules(group, gi, (rules) => [...rules, { ...EMPTY_RULE }]);
}

/** Yeni iç grup: dış bağlacın tersiyle açılır (ör. "ve" kökte "veya" grubu — parantezin tipik kullanımı). */
export function addGroup(group: FilterGroup): FilterGroup {
  if (countRules(group) >= MAX_FILTER_RULES) return group;
  return { ...group, rules: [...group.rules, { combinator: group.combinator === "and" ? "or" : "and", rules: [{ ...EMPTY_RULE }] }] };
}

export function toggleJoin(group: FilterGroup, gi: number | null): FilterGroup {
  const flip = (c: FilterGroup["combinator"]) => (c === "and" ? "or" : "and");
  if (gi === null) return { ...group, combinator: flip(group.combinator) };
  return { ...group, rules: group.rules.map((r, i) => (i === gi && isGroup(r) ? { ...r, combinator: flip(r.combinator) } : r)) };
}

export function countRules(group: FilterGroup): number {
  return group.rules.reduce((n, r) => n + (isGroup(r) ? countRules(r) : 1), 0);
}

export interface SentenceLabels {
  field: (id: string) => string;
  value: (field: string, value: string) => string;
}

const MAX_SHOWN_VALUES = 3;

function listText(field: string, values: string[], labels: SentenceLabels): string {
  const shown = values.slice(0, MAX_SHOWN_VALUES).map((v) => labels.value(field, v));
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} ve ${rest} değer daha` : shown.join(", ");
}

/** Tek koşulun günlük dil hâli: "Hata grubu: Çözgü", "Müşteri: A, B dışında", "Ürün: “pamuk” geçen". */
export function describeRule(r: FilterRule, labels: SentenceLabels): string {
  const name = labels.field(r.field);
  const vals = valuesOf(r.value);
  if (vals.length === 1 && vals[0]!.startsWith("$")) return `${name}: rapordaki seçime göre`;
  if (vals.length === 0) return `${name}: değer seçilmedi`;
  switch (r.operator) {
    case "=":
    case "in":
      return `${name}: ${listText(r.field, vals, labels)}`;
    case "!=":
    case "notIn":
      return `${name}: ${listText(r.field, vals, labels)} dışında`;
    case "contains":
      return `${name}: “${vals[0]}” geçen`;
    case "between":
      return vals.length === 2 ? `${name}: ${labels.value(r.field, vals[0]!)} ile ${labels.value(r.field, vals[1]!)} arası` : `${name}: aralık seçilmedi`;
  }
}

/** Ağacın günlük dil cümlesi; "ve" ` · ` ile, "veya" sözcükle bağlanır, iç grup parantezde. */
export function describeFilter(group: FilterGroup | undefined, labels: SentenceLabels): string {
  if (!group || group.rules.length === 0) return "";
  const parts = group.rules.map((r) => (isGroup(r) ? (r.rules.length > 1 ? `(${describeFilter(r, labels)})` : describeFilter(r, labels)) : describeRule(r, labels)));
  return parts.filter(Boolean).join(group.combinator === "or" ? " veya " : " · ");
}
