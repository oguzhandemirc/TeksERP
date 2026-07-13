// Minimal type declaration for bwip-js — paket conditional exports kullanıyor
// (browser/node/react-native sub-bundle'ları), classic TS resolution otomatik
// çözemiyor. Sadece kullandığımız yüzey burada.

declare module "bwip-js" {
  interface BwipOptions {
    bcid: string;
    text: string;
    scale?: number;
    scaleX?: number;
    scaleY?: number;
    width?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: "offleft" | "left" | "center" | "right" | "offright" | "justify";
    backgroundcolor?: string;
    barcolor?: string;
    textcolor?: string;
    padding?: number;
    paddingwidth?: number;
    paddingheight?: number;
    rotate?: "N" | "R" | "L" | "I";
  }

  export function toSVG(opts: BwipOptions): string;
  export function toBuffer(
    opts: BwipOptions,
    cb?: (err: Error | string | null, png: Buffer) => void
  ): Promise<Buffer>;

  // raw() — çizim yapmadan düşük seviye geometri döner (raster boru hattı bunu blit eder).
  // Linear (code128): sbs = modül genişlik dizisi (çift index = bar, tek = boşluk).
  // 2D (qrcode): pixs = satır-major 0/1 modül matrisi (pixx×pixy), sessiz bölge yok.
  interface RawLinear {
    sbs: number[];
    bhs: number[];
    bbs: number[];
  }
  interface RawMatrix {
    pixs: ArrayLike<number>;
    pixx: number;
    pixy: number;
    height: number;
    width: number;
  }
  export function raw(opts: BwipOptions): Array<RawLinear | RawMatrix>;

  const bwipjs: {
    toSVG: typeof toSVG;
    toBuffer: typeof toBuffer;
    raw: typeof raw;
  };
  export default bwipjs;
}
