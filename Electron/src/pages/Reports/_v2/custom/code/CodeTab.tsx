import { useEffect, useMemo, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { forceLinting, linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { codeTheme } from "@/pages/Definitions/DocumentDesigner/code/codeTheme";
import type { CatalogCube, DefinitionIssue } from "../custom-api";
import { issueText, lineColumnOf, serverDiagnostics } from "./code-diagnostics";
import { completionAt } from "./completion";

interface Props {
  value: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  /** Yalnız bu metne ait (taze) sunucu hataları. */
  issues: readonly DefinitionIssue[];
  cubes: readonly CatalogCube[];
}

const readOnlyExt = (ro: boolean): Extension => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];

function idCompletion(cubes: () => readonly CatalogCube[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const at = completionAt(ctx.state, ctx.pos, cubes());
    if (!at || at.options.length === 0) return null;
    return { from: at.from, to: at.to, options: at.options.map((o) => ({ ...o, type: "constant" })), validFor: /^[\w.]*$/ };
  };
}

/** Rapor tanımı JSON düzenleyicisi (CodeMirror 6; tema belge tasarımcısıyla ortak, panel paletinden). */
export default function CodeTab({ value, readOnly, onChange, issues, cubes }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const roC = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const cubesRef = useRef(cubes);
  cubesRef.current = cubes;

  useEffect(() => {
    if (!host.current) return;
    // Yerel sözdizimi + sunucu hükmü TEK linter'da: ayrı setDiagnostics linter turunda ezilirdi.
    const lint = linter((v): Diagnostic[] => [...jsonParseLinter()(v), ...serverDiagnostics(v.state, issuesRef.current)], { delay: 300 });
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), foldGutter(), highlightActiveLine(), highlightActiveLineGutter(), history(), indentOnInput(), bracketMatching(), closeBrackets(), lintGutter(),
          json(), lint,
          autocompletion({ override: [idCompletion(() => cubesRef.current)], activateOnTyping: true }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          roC.current.of(readOnlyExt(readOnly)),
          EditorView.contentAttributes.of({ "aria-label": "Rapor tanımı (JSON)" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          codeTheme(),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Görünüm sekme ömrü boyunca bir kez kurulur; değer/salt-okunur/hata aşağıdaki etkilerle akar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: roC.current.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    if (view.current) forceLinting(view.current);
  }, [issues]);

  const located = useMemo(() => {
    const state = EditorState.create({ doc: value, extensions: [json()] });
    return issues.map((i) => ({ issue: i, at: lineColumnOf(state, i) }));
  }, [issues, value]);

  const goto = (from: number) => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    v.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div ref={host} className="tekserp-code-editor h-[60vh] min-h-[320px] overflow-hidden rounded-md border" data-language="json" />
      {located.length ? (
        <ul aria-label="Tanım hataları" className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
          {located.map(({ issue, at }) => (
            <li key={`${issue.yol}:${issue.mesaj}`}>
              <button type="button" className="text-left hover:underline" onClick={() => goto(at.from)}>
                <span className="font-mono text-xs">satır {at.line}, sütun {at.column}</span> — {issueText(issue)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
