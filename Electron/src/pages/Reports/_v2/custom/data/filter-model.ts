// =============================================================================
// Oluşturucu süzgeci — `sorgu.suzgec` ağacı (plan §3.2) üzerinde saf işlemler (R2-VERI)
// =============================================================================
// İstemci süzgeci SQL'e ÇEVİRMEZ: yalnız `{combinator, rules[{field, operator, value}]}` JSON'unu kurar,
// sunucu `dogrula`/`onizle` ile yeniden derler. Günlük dil cümlesi de buradan (paket yok, K-SUZGEC).
// =============================================================================

/** Sunucunun derlediği işleçler (`semantik/tipler.ts` FILTER_OPERATORS; fikstür + backend bekçisi eşitliği ölçer). */
export const FILTER_OPERATORS = ["=", "!=", "in", "notIn", "contains"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Türkçe işleç adları — her sunucu işlecinin adı DOLU olmalı (vitest ölçer; İngilizce sızmaz). */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  "=": "eşittir",
  "!=": "eşit değildir",
  in: "şunlardan biri",
  notIn: "şunların dışında",
  contains: "içerir",
};

const SINGLE_VALUE = new Set<FilterOperator>(["=", "!=", "contains"]);
export const isSingleValue = (op: FilterOperator) => SINGLE_VALUE.has(op);

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

export interface FilterGroup {
  combinator: "and" | "or";
  rules: Array<FilterRule | FilterGroup>;
}

/**
 * Sunucu bugün `combinator:"and"` düz listeyi derler (`rapor-tanimi.schema.ts`). "veya" ve iç grup
 * modelde ve cümlede hazır; arayüz yalnız sunucu derleyebildiğinde açar (açık karar, PR notu).
 */
export const FILTER_CAPABILITIES = { or: false, nestedGroups: false } as const;
export const MAX_FILTER_RULES = 10;

export const isGroup = (r: FilterRule | FilterGroup): r is FilterGroup => "combinator" in r;

const valuesOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : typeof v === "string" && v ? [v] : []);

/** Kurucu satırı tamam mı: alan + işleç + en az bir değer (tek değerli işleçte tam bir). */
export function isCompleteRule(r: FilterRule): boolean {
  const vals = valuesOf(r.value);
  return Boolean(r.field) && FILTER_OPERATORS.includes(r.operator) && (isSingleValue(r.operator) ? vals.length === 1 : vals.length > 0);
}

function normalizeRule(r: FilterRule): FilterRule {
  const vals = valuesOf(r.value);
  return { field: r.field, operator: r.operator, value: isSingleValue(r.operator) ? vals[0]! : vals };
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

/** Kurucunun düz satır listesiyle düzenleyebileceği biçim mi (iç grup yok, "veya" yalnız yetenek açıkken). */
export function isEditableFlat(group: FilterGroup): boolean {
  return group.rules.every((r) => !isGroup(r)) && (group.combinator === "and" || FILTER_CAPABILITIES.or);
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
  }
}

/** Ağacın günlük dil cümlesi; "ve" ` · ` ile, "veya" sözcükle bağlanır, iç grup parantezde. */
export function describeFilter(group: FilterGroup | undefined, labels: SentenceLabels): string {
  if (!group || group.rules.length === 0) return "";
  const parts = group.rules.map((r) => (isGroup(r) ? (r.rules.length > 1 ? `(${describeFilter(r, labels)})` : describeFilter(r, labels)) : describeRule(r, labels)));
  return parts.filter(Boolean).join(group.combinator === "or" ? " veya " : " · ");
}
