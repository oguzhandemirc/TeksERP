// =============================================================================
// Liquid tamamlaması — veri sözleşmesinden (`GET /contracts/:docType`) üretilir
// =============================================================================
// Saf model: CodeMirror'a bağlanmadan test edilir. Öneri kümesi sunucunun izin
// listesinin ALT KÜMESİDİR (filtre `FILTER_NAMES`, etiket `LIQUID_TAGS`); reddedilen
// ad (ör. `date`, `include`) hiç önerilmez — `liquidCompletion.test.ts` backend'den ölçer.

import { FIELD_TYPE_LABELS, isFieldLocked, type ContractView } from "../binding/contract";
import { FILTER_NAMES } from "../binding/directives";

/** Backend `ALLOWED_TAGS` alt kümesi (yorum kısaltması `#` hariç). */
export const LIQUID_TAGS: readonly string[] = [
  "if", "elsif", "else", "endif", "unless", "endunless", "case", "when", "endcase",
  "for", "endfor", "break", "continue", "cycle", "assign", "capture", "endcapture",
  "comment", "endcomment", "raw", "endraw", "echo", "liquid",
];

export interface CompletionItem {
  label: string;
  detail?: string;
  type: "variable" | "property" | "function" | "keyword";
}

export interface CompletionModel {
  variables: CompletionItem[];
  /** tablo anahtarı → kolon yolları (döngü değişkeni altında önerilir). */
  columns: Map<string, CompletionItem[]>;
}

export function buildCompletionModel(contract: ContractView | null, internalFields: readonly string[]): CompletionModel {
  if (!contract) return { variables: [], columns: new Map() };
  const variables: CompletionItem[] = [];
  for (const f of contract.kokler) {
    if (isFieldLocked(f, internalFields)) continue;
    variables.push({ label: f.yol, detail: `${f.etiket} · ${FIELD_TYPE_LABELS[f.tur] ?? f.tur}`, type: "variable" });
  }
  const columns = new Map<string, CompletionItem[]>();
  for (const t of contract.tablolar) {
    variables.push({ label: `tablolar.${t.anahtar}`, detail: `${t.etiket} · tablo`, type: "property" });
    columns.set(
      t.anahtar,
      t.kolonlar.filter((k) => !isFieldLocked(k, internalFields)).map((k) => ({ label: k.yol, detail: `${k.etiket} · ${FIELD_TYPE_LABELS[k.tur] ?? k.tur}`, type: "property" as const })),
    );
  }
  return { variables, columns };
}

export interface LiquidCompletionResult {
  /** Değiştirilecek sözcüğün başlangıcı (metin içi ofset). */
  from: number;
  kind: "filter" | "tag" | "variable";
  options: CompletionItem[];
}

const OPEN = /\{\{-?|\{%-?/g;

/** İmlecin içinde bulunduğu kapanmamış `{{` / `{%` açılışı. */
function openBlock(before: string): { index: number; tag: boolean } | null {
  let last: RegExpExecArray | null = null;
  OPEN.lastIndex = 0;
  for (let m = OPEN.exec(before); m; m = OPEN.exec(before)) last = m;
  if (!last) return null;
  const inner = before.slice(last.index + last[0].length);
  if (/[}%]\}/.test(inner)) return null;
  return { index: last.index + last[0].length, tag: last[0].startsWith("{%") };
}

/** İmlece kadar açık kalan `{% for x in tablolar.T %}` döngüleri: değişken → tablo. */
export function openLoops(before: string): Map<string, string> {
  const loops: Array<[string, string]> = [];
  const re = /\{%-?\s*(for\s+([a-z_][a-z0-9_]*)\s+in\s+tablolar\.([a-z0-9_]+)|endfor)\b[\s\S]*?-?%\}/g;
  for (let m = re.exec(before); m; m = re.exec(before)) {
    if (m[1] === "endfor") loops.pop();
    else loops.push([m[2]!, m[3]!]);
  }
  return new Map(loops);
}

/** Saf tamamlama kararı: imlecin solundaki metinden bağlam + öneriler. */
export function liquidCompletions(before: string, model: CompletionModel): LiquidCompletionResult | null {
  const block = openBlock(before);
  if (!block) return null;
  const inner = before.slice(block.index);
  const pipe = inner.lastIndexOf("|");
  if (pipe !== -1) {
    const after = inner.slice(pipe + 1);
    const m = /^\s*([a-z_]*)$/.exec(after);
    if (m) {
      return {
        from: before.length - m[1]!.length,
        kind: "filter",
        options: FILTER_NAMES.map((f) => ({ label: f, type: "function" as const, detail: "filtre" })),
      };
    }
  }
  if (block.tag) {
    const m = /^\s*([a-z]*)$/.exec(inner);
    if (m) return { from: before.length - m[1]!.length, kind: "tag", options: LIQUID_TAGS.map((t) => ({ label: t, type: "keyword" as const })) };
  }
  const word = /([a-z_][a-z0-9_.]*)?$/i.exec(inner)?.[1] ?? "";
  const from = before.length - word.length;
  const loopOptions: CompletionItem[] = [];
  for (const [variable, table] of openLoops(before)) {
    for (const c of model.columns.get(table) ?? []) loopOptions.push({ ...c, label: `${variable}.${c.label}` });
    loopOptions.push({ label: "forloop.index", detail: "döngü sırası (1'den)", type: "variable" });
  }
  return { from, kind: "variable", options: [...loopOptions, ...model.variables] };
}
