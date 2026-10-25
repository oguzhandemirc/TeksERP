import type { Component, Editor } from "grapesjs";
import { PAGE_BREAK_CLASS } from "../binding/blockHtml";

/**
 * Yönergeli öğeler için özel bileşen tipleri. Amaç: GrapesJS'in tablo/satır
 * normalizasyonunda `tr[data-each]` ve `data-*` özniteliklerinin korunması, katman
 * panelinde Türkçe ad ve veri hücresinin "metin düzenleme" ile bozulmaması.
 */
export type PageRegionKind = "ust" | "alt" | "sayfa-no";
export const PAGE_REGION_ATTR = "data-sayfa-bolgesi";

const isEl = (el: unknown): el is HTMLElement => !!el && (el as Node).nodeType === 1;

function fieldName(el: HTMLElement): string {
  const f = el.getAttribute("data-filtre") ?? "";
  if (f.startsWith("barkod")) return "Barkod";
  if (f.startsWith("qr")) return "QR";
  return `Veri alanı · ${el.getAttribute("data-alan") ?? ""}`;
}

export function documentComponentsPlugin(editor: Editor): void {
  const dc = editor.Components;
  dc.addType("item-table", {
    extend: "table",
    isComponent: (el: HTMLElement) => isEl(el) && el.tagName === "TABLE" && el.hasAttribute("data-tablo"),
    model: { defaults: { name: "Kalem tablosu" } },
  });
  dc.addType("item-row", {
    extend: "row",
    isComponent: (el: HTMLElement) => isEl(el) && el.tagName === "TR" && el.hasAttribute("data-each"),
    model: { defaults: { name: "Kalem satırı (her satır için tekrar)", draggable: false } },
  });
  dc.addType("data-field", {
    isComponent: (el: HTMLElement) =>
      isEl(el) && el.hasAttribute("data-alan") && el.tagName !== "TD" && el.tagName !== "TH"
        ? { type: "data-field", name: fieldName(el) }
        : false,
    model: { defaults: { name: "Veri alanı", droppable: false, editable: false } },
  });
  dc.addType("logo", {
    extend: "image",
    isComponent: (el: HTMLElement) => isEl(el) && el.tagName === "IMG" && el.hasAttribute("data-bag-src"),
    model: { defaults: { name: "Logo", activate: false, editable: false } },
  });
  for (const [type, cls, name] of [
    ["page-break", PAGE_BREAK_CLASS, "Sayfa kesmesi"],
    ["signature-area", "imza-alani", "İmza alanı"],
    ["total-box", "toplam-kutusu", "Toplam kutusu"],
  ] as const) {
    dc.addType(type, {
      isComponent: (el: HTMLElement) => isEl(el) && el.classList.contains(cls),
      model: { defaults: { name, droppable: type !== "page-break" } },
    });
  }
}

/** Üst/Alt bilgi ve Sayfa no blokları kanvasta kalmaz: `pageSettings`e yönlenir. */
export function watchPageRegionDrops(editor: Editor, onRegion: (kind: PageRegionKind) => void): void {
  editor.on("block:drag:stop", (component?: Component) => {
    const kind = component?.getAttributes?.()[PAGE_REGION_ATTR] as PageRegionKind | undefined;
    if (!component || !kind) return;
    component.remove();
    onRegion(kind);
  });
}
