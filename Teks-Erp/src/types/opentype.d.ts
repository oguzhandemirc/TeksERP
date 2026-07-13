// Minimal type declaration for opentype.js — paket kendi .d.ts'ini getirmiyor,
// @types/opentype.js kurulu değil. Sadece raster metin motorunun (raster-font/
// raster-text) kullandığı yüzey. v2.0.0: loadSync deprecate → parse(Buffer).

declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  export interface Path {
    commands: PathCommand[];
    getBoundingBox(): BoundingBox;
  }
  export interface Glyph {
    index: number;
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): Path;
    getBoundingBox(): BoundingBox;
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    charToGlyph(ch: string): Glyph;
    getAdvanceWidth(text: string, fontSize: number): number;
  }
  export function parse(data: ArrayBuffer | Buffer | Uint8Array, opt?: unknown): Font;

  const opentype: {
    parse: typeof parse;
  };
  export default opentype;
}
