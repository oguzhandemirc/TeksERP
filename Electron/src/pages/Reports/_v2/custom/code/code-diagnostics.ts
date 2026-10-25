// =============================================================================
// Kod modu — sunucu hataları → CodeMirror tanılamaları (Türkçe mesaj AYNEN; öneri eklenir)
// =============================================================================
import type { Diagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import type { DefinitionIssue } from "../custom-api";
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
