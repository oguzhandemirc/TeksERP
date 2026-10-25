import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { linter, lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { codeTheme } from "./codeTheme";
import { issueOffset, issueRange, type ServerIssue } from "./issueDiagnostics";
import { liquidCompletions, type CompletionModel } from "./liquidCompletion";

export type CodeLanguage = "html" | "css" | "json";

export interface CodeEditorHandle {
  /** İmleci 1 tabanlı satır/sütuna taşır ve görünür kılar. */
  goto: (satir: number | null, sutun: number | null) => void;
}

interface Props {
  value: string;
  language: CodeLanguage;
  readOnly: boolean;
  onChange?: (value: string) => void;
  /** Yalnız HTML+Liquid sekmesinde: sözleşmeden tamamlama. */
  completion?: CompletionModel;
  /** Sunucunun konumlu hataları (yalnız HTML sekmesi). */
  issues?: readonly ServerIssue[];
  ariaLabel: string;
}

function languageOf(lang: CodeLanguage): Extension {
  if (lang === "css") return css();
  if (lang === "json") return [json(), linter(jsonParseLinter(), { delay: 300 })];
  return html({ autoCloseTags: true });
}

function readOnlyExt(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/** Dışarıdan (sürüm yükleme) yazılan içerik kullanıcı düzenlemesi değildir: onChange'e düşmez, taslağı kirletmez. */
const External = Annotation.define<boolean>();

interface ExtensionOpts {
  language: CodeLanguage;
  ariaLabel: string;
  readOnly: Extension;
  completion: () => CompletionModel | undefined;
  onChange: (text: string) => void;
}

/** Tamamlama kaynağı: yalnız `{{ }}` / `{% %}` içinde, sözleşme modelinden (istemci Liquid ÇALIŞTIRMAZ). */
function completionSource(model: () => CompletionModel | undefined) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = model();
    if (!m) return null;
    const r = liquidCompletions(ctx.state.doc.sliceString(0, ctx.pos), m);
    if (!r || (r.from === ctx.pos && !ctx.explicit && r.kind === "variable")) return null;
    return { from: r.from, options: r.options, validFor: /^[a-z0-9_.]*$/i };
  };
}

function editorExtensions(o: ExtensionOpts): Extension {
  return [
    lineNumbers(),
    foldGutter(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    lintGutter(),
    languageOf(o.language),
    autocompletion({ override: [completionSource(o.completion)], activateOnTyping: true }),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    o.readOnly,
    // Görsel kipten gelen HTML tek satırdır; kaydırmasız satır editörü genişletiyordu.
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": o.ariaLabel }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) o.onChange(u.state.doc.toString());
    }),
    codeTheme(),
  ];
}

/** CodeMirror 6 sarmalayıcısı: görünüm BİR kez kurulur; değer/salt-okunur/hata dışarıdan akar. */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, language, readOnly, onChange, completion, issues, ariaLabel },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyC = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const completionRef = useRef(completion);
  completionRef.current = completion;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions({
          language,
          ariaLabel,
          readOnly: readOnlyC.current.of(readOnlyExt(readOnly)),
          completion: () => completionRef.current,
          onChange: (text) => onChangeRef.current?.(text),
        }),
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Görünüm sekme ömrü boyunca bir kez kurulur; dil sabittir (sekme başına ayrı editör).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dışarıdan gelen değer (görsel kipte editör HTML'i, kip geçişi) — yazarken geri yankı yok.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: External.of(true) });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyC.current.reconfigure(readOnlyExt(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v || !issues) return;
    const text = v.state.doc.toString();
    const diags: Diagnostic[] = issues.map((i) => {
      const r = issueRange(text, i);
      return { from: r.from, to: r.to, severity: "error", message: r.message, source: "Önizleme" };
    });
    v.dispatch(setDiagnostics(v.state, diags));
  }, [issues, value]);

  useImperativeHandle(ref, () => ({
    goto: (satir, sutun) => {
      const v = view.current;
      if (!v) return;
      const pos = issueOffset(v.state.doc.toString(), satir, sutun);
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      v.focus();
    },
  }));

  return <div ref={host} className="tekserp-code-editor h-full min-h-0 overflow-hidden" data-language={language} />;
});
