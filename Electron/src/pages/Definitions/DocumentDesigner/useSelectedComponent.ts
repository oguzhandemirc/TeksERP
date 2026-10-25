import { useEffect, useState } from "react";
import type { Component, Editor } from "grapesjs";

/**
 * Seçili GrapesJS bileşeni + öznitelik değişiminde artan sürüm (React yeniden çizsin).
 * Bağlama paneli öznitelikleri doğrudan bileşenden okur; ayrı kopya tutmaz.
 */
export function useSelectedComponent(editor: Editor | null): { component: Component | null; version: number } {
  const [component, setComponent] = useState<Component | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onSelect = () => {
      setComponent(editor.getSelected() ?? null);
      setVersion((v) => v + 1);
    };
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on("component:toggled", onSelect);
    editor.on("component:update:attributes component:update:components", onUpdate);
    return () => {
      editor.off("component:toggled", onSelect);
      editor.off("component:update:attributes component:update:components", onUpdate);
    };
  }, [editor]);
  return { component, version };
}

/** Bileşenin en yakın `tr[data-each]` atası (kendisi dahil) — hücre bağlamında döngü değişkeni. */
export function closestLoop(component: Component | null): Component | null {
  let c: Component | undefined | null = component;
  while (c) {
    if (c.getAttributes()["data-each"]) return c;
    c = c.parent();
  }
  return null;
}

/** En yakın `table[data-tablo]` (kendisi dahil). */
export function closestItemTable(component: Component | null): Component | null {
  let c: Component | undefined | null = component;
  while (c) {
    if (c.get("tagName") === "table" && c.getAttributes()["data-tablo"] !== undefined) return c;
    c = c.parent();
  }
  return null;
}

/** En yakın toplam kutusu — alan seçici kapsamı `toplamlar.*`a daralır. */
export function insideTotalBox(component: Component | null): boolean {
  let c: Component | undefined | null = component;
  while (c) {
    if (c.getClasses().includes("toplam-kutusu")) return true;
    c = c.parent();
  }
  return false;
}
