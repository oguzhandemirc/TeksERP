// =============================================================================
// Kod modu — [Görsel | Kod] geçişi; görsel ↔ kod aynı taslağı paylaşır
// =============================================================================
// Görsel → kod: taslak şema sırasıyla biçimlenir. Kod → taslak: yalnız yerel parse + TAZE ve TEMİZ `dogrula`
// hükmünde yazılır (Kaydet her iki kipte aynı uç, aynı sürüm kuralı). Kilitliyken görsele dönülmez.
// =============================================================================
import { useEffect, useRef, useState } from "react";
import { normalizedBody, type DefinitionBody } from "../layout/layout-model";
import { formatDefinition, sameDefinition } from "./definition-text";
import { codeLock, useCodeCheck } from "./useCodeCheck";

export type EditorMode = "visual" | "code";
type Apply = (fn: (b: DefinitionBody) => DefinitionBody | null) => boolean;

export function useCodeMode(draft: DefinitionBody | null, apply: Apply, editable: boolean) {
  const [mode, setMode] = useState<EditorMode>("visual");
  const [text, setText] = useState("");
  // Taslağın şu anki metin karşılığı: metin buna eşitse değişiklik yok, kilit yok.
  const synced = useRef("");
  const active = mode === "code" && editable;
  const { parsed, verdict } = useCodeCheck(text, active);
  const unchanged = text === synced.current;
  const lock = active ? codeLock(parsed, verdict, unchanged) : null;

  useEffect(() => {
    if (!active || lock || unchanged || !parsed.ok || !draft) return;
    synced.current = text;
    if (!sameDefinition(parsed.value, draft)) apply(() => normalizedBody(parsed.value as DefinitionBody));
  });

  const showCode = () => {
    if (mode === "code" || !draft) return;
    const t = formatDefinition(draft);
    synced.current = t;
    setText(t);
    setMode("code");
  };
  const showVisual = () => {
    if (lock) return;
    setMode("visual");
  };

  return { mode, text, setText, lock, issues: verdict.issues, showCode, showVisual };
}
