import { useEffect, useState } from "react";
import type { Editor } from "grapesjs";
import type { EditMode } from "./editMode";

export interface DesignerSource {
  html: string;
  css: string;
}

/** GrapesJS'in dışa aktarımı — sunucuya giden ve kod sekmesinde görünen metin AYNIDIR (hata satırı eşleşsin). */
export function exportVisual(editor: Editor): DesignerSource {
  return { html: editor.getHtml(), css: editor.getCss({ avoidProtected: true }) ?? "" };
}

/**
 * Şablonun o anki kaynağı: kod kipinde taslaktaki metin, görsel kipte editörün dışa
 * aktarımı (her değişiklikte, 150 ms kümelenerek — sürüklemede her karede dışa aktarım pahalı).
 */
export function useDesignerSource(editor: Editor | null, mode: EditMode, code: DesignerSource): DesignerSource {
  const [visual, setVisual] = useState<DesignerSource>({ html: "", css: "" });
  useEffect(() => {
    if (!editor || mode !== "VISUAL") return;
    let t: number | undefined;
    const pull = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setVisual(exportVisual(editor)), 150);
    };
    setVisual(exportVisual(editor));
    editor.on("update", pull);
    return () => {
      window.clearTimeout(t);
      editor.off("update", pull);
    };
  }, [editor, mode]);
  return mode === "CODE" ? code : visual;
}
