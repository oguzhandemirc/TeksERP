// =============================================================================
// Kod modu — sunucu hataları → CodeMirror tanılamaları (Türkçe mesaj AYNEN; öneri eklenir)
// =============================================================================
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type { DefinitionIssue } from "../custom-api";
import { parseDefinitionText } from "./definition-text";
import { fullTree } from "./json-tree";
import { pathToRange } from "./pathToPosition";

export function issueText(issue: DefinitionIssue): string {
  return issue.oneri ? `${issue.mesaj} Şunu mu demek istediniz: "${issue.oneri}"?` : issue.mesaj;
}

/** Her sunucu hatası tam olarak bir tanılama olur (bulunamayan yol da — ataya/başa bağlı). */
export function serverDiagnostics(state: EditorState, issues: readonly DefinitionIssue[]): Diagnostic[] {
  return issues.map((issue) => {
    const r = pathToRange(state, issue.yol);
    const where = r.exact ? "" : ` (konum: ${issue.yol})`;
    return { from: r.from, to: r.to, severity: "error", source: "Sunucu doğrulaması", message: `${issueText(issue)}${where}` };
  });
}

/** Satır/sütun (1 tabanlı) — hata listesinde "satır 12" bağlantısı için. */
export function lineColumnOf(state: EditorState, issue: DefinitionIssue): { line: number; column: number; from: number } {
  const r = pathToRange(state, issue.yol);
  const line = state.doc.lineAt(r.from);
  return { line: line.number, column: r.from - line.from + 1, from: r.from };
}

/**
 * Yerel sözdizimi tanılaması: konum Lezer ağacındaki ilk hata düğümünden (Chromium'un JSON.parse
 * mesajı konum taşımıyor, `jsonParseLinter` satır 1'e düşüyordu); mesaj Türkçe.
 */
export function syntaxDiagnostics(state: EditorState): Diagnostic[] {
  const text = state.doc.toString();
  const parsed = parseDefinitionText(text);
  if (parsed.ok) return [];
  let at = -1;
  fullTree(state).iterate({
    enter: (n) => {
      if (at >= 0) return false;
      if (n.type.isError) at = n.from;
      return undefined;
    },
  });
  if (at < 0) at = text.trim() === "" ? 0 : state.doc.length;
  const len = state.doc.length;
  const from = len === 0 ? 0 : Math.min(at, len - 1);
  return [{ from, to: Math.min(from + 1, len), severity: "error", source: "JSON", message: "JSON sözdizimi hatalı: bu noktada beklenmeyen karakter ya da eksik ayraç/virgül." }];
}
