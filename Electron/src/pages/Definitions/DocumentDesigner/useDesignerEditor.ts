import { useEffect, useRef, useState, type RefObject } from "react";
import grapesjs, { type Editor } from "grapesjs";
import { toast } from "sonner";
import { applyPageGuides, createEditor, type EditorTargets } from "./editor/createEditor";
import { watchPageRegionDrops, type PageRegionKind } from "./editor/documentComponents";
import { deviceId, type GuideRegions, type Orientation, type PageMargins, type PaperSize } from "./editor/pageCanvas";

export interface DesignerRefs {
  container: RefObject<HTMLDivElement | null>;
  area: RefObject<HTMLDivElement | null>;
  blocks: RefObject<HTMLDivElement | null>;
  styles: RefObject<HTMLDivElement | null>;
  selectors: RefObject<HTMLDivElement | null>;
  layers: RefObject<HTMLDivElement | null>;
  traits: RefObject<HTMLDivElement | null>;
}

export interface PageFrame {
  left: number;
  width: number;
}

function targetsOf(refs: DesignerRefs): EditorTargets | null {
  const { container, blocks, styles, selectors, layers, traits } = refs;
  if (!container.current || !blocks.current || !styles.current || !selectors.current || !layers.current || !traits.current) {
    return null;
  }
  return {
    container: container.current, blocks: blocks.current, styles: styles.current,
    selectors: selectors.current, layers: layers.current, traits: traits.current,
  };
}

const PAGE_TOP_GAP = 24;

/** Sayfa kanvas alanına sığsın: %100'ü aşmaz, %40'ın altına inmez. */
function fitZoom(editor: Editor, area: HTMLElement | null, pageWidthPx: number): void {
  if (!area) return;
  const pct = Math.floor(((area.clientWidth - 48) / pageWidthPx) * 100);
  const zoom = Math.max(40, Math.min(100, pct));
  editor.Canvas.setZoom(zoom);
  centerPage(editor, pageWidthPx, zoom / 100);
}

/**
 * Sayfa kanvastan genişken paket çerçeveyi `left:0`a koyar, ölçek alanın merkezinden alınınca
 * sayfa sağa kayıp kırpılır (e2e BT2 ölçtü). Kayma hesapla geri alınır: ölçek ortasına göre
 * sol kenar Wa(1-z)/2'de durur, hedef (Wa - Wp·z)/2; üst kenar hedefi PAGE_TOP_GAP.
 */
function centerPage(editor: Editor, pageWidthPx: number, z: number): void {
  const cv = editor.Canvas.getElement();
  if (!cv) return;
  const { clientWidth: wa, clientHeight: ha } = cv;
  // Sayfa sığıyorsa paket zaten ortalar (margin:auto) → yatay düzeltme yalnız taşmada.
  editor.Canvas.setCoords(z * Math.min(0, (wa - pageWidthPx) / 2), PAGE_TOP_GAP - (ha * (1 - z)) / 2);
}

/**
 * GrapesJS örneğinin yaşam döngüsü: kur, kâğıt değişince cihazı/kılavuzu
 * güncelle, sayfanın ekrandaki konumunu cetvel için ölç, sökülünce yık.
 */
export interface PageView {
  paper: PaperSize;
  orientation: Orientation;
  pageWidthPx: number;
  margins: PageMargins;
  regions: GuideRegions;
}

export function useDesignerEditor(refs: DesignerRefs, view: PageView, onPageRegion: (kind: PageRegionKind) => void) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [frame, setFrame] = useState<PageFrame>({ left: 0, width: 0 });
  const page = useRef(view);
  page.current = view;
  const regionCb = useRef(onPageRegion);
  regionCb.current = onPageRegion;
  const { paper, orientation, pageWidthPx, margins, regions } = view;
  const guideKey = JSON.stringify([margins, regions]);

  useEffect(() => {
    const targets = targetsOf(refs);
    if (!targets) return;
    const ed = createEditor(grapesjs, targets, { notify: (m) => toast.error(m), onFatal: setFatal });
    const measure = () => {
      const f = ed.Canvas.getFrameEl();
      const a = refs.area.current;
      if (!f || !a) return;
      const fr = f.getBoundingClientRect();
      setFrame({ left: fr.left - a.getBoundingClientRect().left, width: fr.width });
    };
    const relayout = () => {
      fitZoom(ed, refs.area.current, page.current.pageWidthPx);
      requestAnimationFrame(measure);
    };
    watchPageRegionDrops(ed, (k) => regionCb.current(k));
    ed.on("canvas:frame:load:body", () => {
      const p = page.current;
      applyPageGuides(ed, p.paper, p.orientation, p);
      relayout();
    });
    ed.on("canvas:zoom", () => requestAnimationFrame(measure));
    const ro = new ResizeObserver(relayout);
    if (refs.area.current) ro.observe(refs.area.current);
    setEditor(ed);
    return () => {
      ro.disconnect();
      ed.destroy();
      setEditor(null);
    };
    // Editör sayfa ömrü boyunca BİR kez kurulur; kâğıt değişimi aşağıdaki etkide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editor) return;
    editor.setDevice(deviceId(paper, orientation));
    applyPageGuides(editor, paper, orientation, page.current);
    // Cihaz değişimi çerçeveyi bir sonraki karede boyutlar; ölçüm ondan sonra.
    const t = window.setTimeout(() => {
      fitZoom(editor, refs.area.current, pageWidthPx);
      const f = editor.Canvas.getFrameEl();
      const a = refs.area.current;
      if (f && a) setFrame({ left: f.getBoundingClientRect().left - a.getBoundingClientRect().left, width: f.getBoundingClientRect().width });
    }, 60);
    return () => window.clearTimeout(t);
  }, [editor, paper, orientation, pageWidthPx, refs.area]);

  // Kenar ve üst/alt bilgi değişimi yalnız kılavuz stilini tazeler (yakınlaştırma değişmez).
  useEffect(() => {
    if (!editor) return;
    const p = page.current;
    applyPageGuides(editor, p.paper, p.orientation, p);
  }, [editor, guideKey]);

  return { editor, fatal, frame };
}
