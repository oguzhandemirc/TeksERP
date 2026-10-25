// =============================================================================
// Kod editörü teması — panelin açık/koyu paletinden (CSS değişkenleri)
// =============================================================================
// Renkler sabit yazılmaz: `hsl(var(--…))` panel temasıyla birlikte döner, `.dark`
// sınıfı değişince editör yeniden kurulmadan uyar. `theme-one-dark` bilerek YOK.

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

const v = (name: string, alpha?: number) => (alpha === undefined ? `hsl(var(--${name}))` : `hsl(var(--${name}) / ${alpha})`);

export const CODE_THEME_COLORS = {
  tag: v("primary"),
  attribute: v("station-process"),
  string: v("success"),
  number: v("warning"),
  comment: v("muted-foreground"),
  property: v("info"),
  keyword: v("chart-5"),
} as const;

const chrome = EditorView.theme({
  "&": { color: v("foreground"), backgroundColor: v("background"), fontSize: "12.5px", height: "100%" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
  ".cm-content": { caretColor: v("primary") },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: v("primary") },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: v("primary", 0.22) },
  ".cm-activeLine": { backgroundColor: v("muted", 0.55) },
  ".cm-gutters": { backgroundColor: v("card"), color: v("muted-foreground"), borderRight: `1px solid ${v("border")}` },
  ".cm-activeLineGutter": { backgroundColor: v("muted"), color: v("foreground") },
  ".cm-tooltip": { backgroundColor: v("popover"), color: v("popover-foreground"), border: `1px solid ${v("border")}`, borderRadius: "6px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: v("primary"), color: v("primary-foreground") },
  ".cm-completionDetail": { color: v("muted-foreground"), fontStyle: "normal", marginLeft: "0.75em" },
  ".cm-tooltip-lint": { padding: "2px 0" },
  ".cm-diagnostic-error": { borderLeftColor: v("destructive") },
  ".cm-diagnostic-warning": { borderLeftColor: v("warning") },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: `underline wavy ${v("destructive")}`, textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: `underline wavy ${v("warning")}`, textUnderlineOffset: "3px" },
  ".cm-panels": { backgroundColor: v("card"), color: v("foreground") },
  ".cm-matchingBracket": { backgroundColor: v("primary", 0.18), outline: "none" },
});

const highlight = HighlightStyle.define([
  { tag: [t.tagName, t.angleBracket], color: CODE_THEME_COLORS.tag },
  { tag: t.attributeName, color: CODE_THEME_COLORS.attribute },
  { tag: [t.string, t.attributeValue], color: CODE_THEME_COLORS.string },
  { tag: [t.number, t.unit, t.color], color: CODE_THEME_COLORS.number },
  { tag: [t.comment, t.meta], color: CODE_THEME_COLORS.comment, fontStyle: "italic" },
  { tag: [t.propertyName, t.className], color: CODE_THEME_COLORS.property },
  { tag: [t.keyword, t.atom, t.bool, t.null], color: CODE_THEME_COLORS.keyword },
  { tag: t.invalid, color: v("destructive") },
]);

/** Tek tema uzantısı: kabuk + sözdizimi renkleri (ikisi de panel değişkenlerinden). */
export function codeTheme(): Extension {
  return [chrome, syntaxHighlighting(highlight)];
}
