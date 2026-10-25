/**
 * Belge tasarımcısının SAYFA KANVASI — kâğıt boyu, yön, mm → px dönüşümü,
 * cetvel ve kılavuz çizgileri. Saf modül: GrapesJS'e yalnız `deviceManager`
 * tanımı ve kanvas iframe'ine eklenen kılavuz CSS'i olarak dokunur.
 *
 * Kılavuz CSS'i şablonun parçası DEĞİLDİR: CssComposer'a değil, kanvas
 * iframe'inin <head>'ine ayrı bir <style> olarak girer (getCss() onu görmez).
 */

export type PaperSize = "A4" | "A5" | "LETTER";
export type Orientation = "portrait" | "landscape";

export interface PaperSpec {
  readonly label: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

export const PAPER_SIZES: Record<PaperSize, PaperSpec> = {
  A4: { label: "A4", widthMm: 210, heightMm: 297 },
  A5: { label: "A5", widthMm: 148, heightMm: 210 },
  LETTER: { label: "Letter", widthMm: 215.9, heightMm: 279.4 },
};

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  portrait: "Dikey",
  landscape: "Yatay",
};

/** CSS mm'si: 96 dpi'da 1 in = 25.4 mm. Chromium baskıda da bu oranı kullanır. */
export const PX_PER_MM = 96 / 25.4;
export const DEFAULT_MARGIN_MM = 15;

export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

export interface PageDimensions {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export function pageDimensions(size: PaperSize, orientation: Orientation): PageDimensions {
  const spec = PAPER_SIZES[size];
  const [w, h] = orientation === "portrait" ? [spec.widthMm, spec.heightMm] : [spec.heightMm, spec.widthMm];
  return { widthMm: w, heightMm: h, widthPx: mmToPx(w), heightPx: mmToPx(h) };
}

export function deviceId(size: PaperSize, orientation: Orientation): string {
  return `${size.toLowerCase()}-${orientation}`;
}

export interface PageDevice {
  readonly id: string;
  readonly name: string;
  readonly width: string;
  readonly height: string;
}

/** Altı cihaz: üç kâğıt × iki yön. `widthMedia` yok — belge tek genişlikte çizilir. */
export function pageDevices(): PageDevice[] {
  return (Object.keys(PAPER_SIZES) as PaperSize[]).flatMap((size) =>
    (["portrait", "landscape"] as Orientation[]).map((o) => {
      const d = pageDimensions(size, o);
      return {
        id: deviceId(size, o),
        name: `${PAPER_SIZES[size].label} ${ORIENTATION_LABELS[o].toLowerCase()}`,
        width: `${d.widthPx}px`,
        height: `${d.heightPx}px`,
      };
    }),
  );
}

export const GUIDE_STYLE_ID = "tekserp-page-guides";

/**
 * Kenar boşluğu kılavuzu (kesikli çerçeve) + her sayfa yüksekliğinde sayfa
 * kesmesi çizgisi. `html` arka planına çizilir; gövde içeriği ve dışa aktarılan
 * CSS etkilenmez. Kenar boşluğu gövde dolgusu olarak taklit edilir.
 */
export function guideCss(dim: PageDimensions, marginMm: number = DEFAULT_MARGIN_MM): string {
  const m = mmToPx(marginMm);
  const pageH = dim.heightPx;
  return [
    `html{background:#fff;min-height:100%;}`,
    `body{margin:0;padding:${m}px;box-sizing:border-box;min-height:${pageH}px;position:relative;`,
    `background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${pageH - 1}px,rgba(220,38,38,.55) ${pageH - 1}px,rgba(220,38,38,.55) ${pageH}px);}`,
    `body::before{content:"";position:absolute;pointer-events:none;left:${m}px;right:${m}px;top:${m}px;height:${pageH - 2 * m}px;`,
    `outline:1px dashed rgba(59,130,246,.55);}`,
  ].join("");
}

/** Cetvel çentikleri: her cm bir çentik, her 2 cm'de etiket (0, 2, 4…). */
export function rulerTicks(widthMm: number): Array<{ cm: number; labeled: boolean }> {
  const count = Math.floor(widthMm / 10);
  return Array.from({ length: count + 1 }, (_, cm) => ({ cm, labeled: cm % 2 === 0 }));
}
