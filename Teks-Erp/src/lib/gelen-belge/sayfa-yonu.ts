// Sayfa yönü (TEK KAYNAK): cihazın ML Kit kelime listesinden (`ClientOcr`) baskın OKUMA YÖNÜNÜ (0–360°) bulur ve kelime/satır
// dörtgenlerini dik çerçeveye döndürür; ters dönüş (dik çerçeve → fotoğraf/kare) de buradan (`rectToPhotoFrame` dahil).
// 90/180/270 herhangi bir açının özel hâlidir. Saf modül: DB/ağ yok.
import type { OcrRect } from "./motor";
import type { ClientOcr } from "./istemci-ocr";

type Pt = [number, number];
type Quad = Pt[];

/** Bundan küçük eğim döndürülmez: motor küçük eğimi zaten tolere eder (`rows-tilted`), kutular gereksiz oynamasın. */
export const MIN_SKEW_DEG = 2;
/** Yön kanıtı sayılan satırın asgari karakteri (kısa satır yön vermez — `yan_donuk_mu` ile aynı eşik). */
const MIN_LINE_CHARS = 3;
/** Baskın açı penceresi: tepe çevresindeki ±bu kadar derece ağırlıklı ortalamaya girer. */
const PEAK_WINDOW_DEG = 10;
/** Baskın yön, kanıt ağırlığının en az bu payını taşımalı (yoksa sayfa olduğu gibi bırakılır — fail-closed). */
const MIN_PEAK_SHARE = 0.5;

const norm360 = (d: number): number => ((d % 360) + 360) % 360;
/** −180..180 aralığına katlar. */
export const signedDeg = (d: number): number => {
  const n = norm360(d);
  return n > 180 ? n - 360 : n;
};
const angDiff = (a: number, b: number): number => Math.abs(signedDeg(a - b));
const vecDeg = (dx: number, dy: number): number => norm360((Math.atan2(dy, dx) * 180) / Math.PI);

/** Çeyrek açılarda kesin (kayan nokta artığı yok) cos/sin. */
function cosSin(deg: number): [number, number] {
  const n = norm360(deg);
  if (n === 0) return [1, 0];
  if (n === 90) return [0, 1];
  if (n === 180) return [-1, 0];
  if (n === 270) return [0, -1];
  const r = (n * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/**
 * Dönüşüm: kaynak çerçevedeki (W×H, y aşağı) noktayı `turnDeg` kadar SAAT YÖNÜNDE döndürüp dik çerçeveye taşır.
 * `turnDeg` = −(okuma yönü açısı); okuma servisi `rotation` değeriyle aynı anlam (90 = girdi saat yönünde 90° döndü).
 */
export interface OrientationTransform {
  turnDeg: number;
  /** Dik çerçevenin boyutu. */
  width: number;
  height: number;
  toUpright(p: Pt): Pt;
  toSource(p: Pt): Pt;
}

export function orientationTransform(turnDeg: number, srcW: number, srcH: number): OrientationTransform {
  const [c, s] = cosSin(turnDeg);
  const rot = ([x, y]: Pt): Pt => [x * c - y * s, x * s + y * c];
  const corners = ([[0, 0], [srcW, 0], [srcW, srcH], [0, srcH]] as Pt[]).map(rot);
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const width = Math.max(...corners.map((p) => p[0])) - minX;
  const height = Math.max(...corners.map((p) => p[1])) - minY;
  return {
    turnDeg: norm360(turnDeg),
    width,
    height,
    toUpright: (p) => {
      const [x, y] = rot(p);
      return [x - minX, y - minY];
    },
    toSource: ([ux, uy]) => {
      const x = ux + minX, y = uy + minY;
      return [x * c + y * s, -x * s + y * c];
    },
  };
}

/** Kutunun dört köşesini çevirip eksen hizalı kapsayan kutuyu döndürür. */
function mapRect(r: OcrRect, f: (p: Pt) => Pt): OcrRect {
  const ps = ([[r.x, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height], [r.x, r.y + r.height]] as Pt[]).map(f);
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Dik çerçevedeki kutu → kaynak (fotoğraf/kare) çerçevesi. */
export function rectToSource(r: OcrRect, t: OrientationTransform): OcrRect {
  return mapRect(r, t.toSource);
}

/**
 * Okuma servisi/cihaz `rotation`ı (çeyrek) ile dikleştirilmiş kutuyu saklanan FOTOĞRAFIN çerçevesine çevirir.
 * Fotoğraf boyutu dik boyuttan türetilir (90/270'te en-boy takası).
 */
export function rectToPhotoFrame(r: OcrRect, rotation: number | undefined, uprightW: number, uprightH: number): OcrRect {
  if (rotation !== 90 && rotation !== 180 && rotation !== 270) return r;
  const { width, height } = photoFrameSize(rotation, uprightW, uprightH);
  return rectToSource(r, orientationTransform(rotation, width, height));
}

/** Dik (OCR) çerçevenin saklanan fotoğraf yönündeki boyutu: yan dönükte (90/270) en ve boy takas olur. */
export function photoFrameSize(rotation: number | undefined, uprightW: number, uprightH: number): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: uprightH, height: uprightW } : { width: uprightW, height: uprightH };
}

const center = (q: Quad): Pt => [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4];
const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

interface Evidence { deg: number; weight: number }

/**
 * Satır başına okuma yönü kanıtı. İnce açı satır dörtgeninin ÜST kenarından (ML Kit köşeleri metnin sol-üstünden saat
 * yönünde verir); yön işareti çok kelimeli satırda kelime SIRASINDAN (ilk → son kelime merkezi) doğrulanır. Dörtgen eksen
 * hizalı yedekse (köşe yoksa) ve kelime sırası ile 45°'ten fazla ayrışıyorsa kelime sırası açısı esas alınır.
 */
export function lineDirections(c: ClientOcr): Evidence[] {
  const byLine = new Map<number, { t: string; q: Quad }[]>();
  c.words.forEach((w) => {
    if (w.l === undefined) return;
    byLine.set(w.l, [...(byLine.get(w.l) ?? []), { t: w.t, q: w.c }]);
  });
  const out: Evidence[] = [];
  for (const [l, ws] of byLine) {
    const text = ws.map((w) => w.t).join(" ").trim();
    if (text.length < MIN_LINE_CHARS) continue;
    const q = (c.lines?.[l]?.c ?? null) as Quad | null;
    let edgeDeg: number | null = null;
    if (q) {
      const top = dist(q[0]!, q[1]!), side = dist(q[1]!, q[2]!);
      if (top > 0 && top >= side * 0.8) edgeDeg = vecDeg(q[1]![0] - q[0]![0], q[1]![1] - q[0]![1]);
    }
    let orderDeg: number | null = null;
    if (ws.length >= 2) {
      const a = center(ws[0]!.q), b = center(ws[ws.length - 1]!.q);
      if (dist(a, b) > 0) orderDeg = vecDeg(b[0] - a[0], b[1] - a[1]);
    }
    let deg: number | null;
    if (edgeDeg === null) deg = orderDeg;
    else if (orderDeg === null) deg = edgeDeg;
    else {
      const d = angDiff(edgeDeg, orderDeg);
      deg = d <= 45 ? edgeDeg : d >= 135 ? norm360(edgeDeg + 180) : orderDeg;
    }
    if (deg !== null) out.push({ deg, weight: text.length });
  }
  return out;
}

/** Baskın okuma yönü (0–360°, 0 = soldan sağa dik): 1° kovalı ağırlıklı histogramın tepesi, ±10° içinde ağırlıklı ortalama. Kanıt yetersizse null. */
export function dominantReadingDeg(ev: readonly Evidence[]): number | null {
  const total = ev.reduce((a, e) => a + e.weight, 0);
  if (ev.length < 2 || total <= 0) return null;
  let best = { deg: 0, w: -1 };
  for (let d = 0; d < 360; d++) {
    const w = ev.reduce((a, e) => (angDiff(e.deg, d) <= PEAK_WINDOW_DEG ? a + e.weight : a), 0);
    if (w > best.w) best = { deg: d, w };
  }
  if (best.w < total * MIN_PEAK_SHARE) return null;
  let sx = 0, sy = 0;
  for (const e of ev) {
    if (angDiff(e.deg, best.deg) > PEAK_WINDOW_DEG) continue;
    const [c, s] = cosSin(e.deg);
    sx += c * e.weight;
    sy += s * e.weight;
  }
  return norm360((Math.atan2(sy, sx) * 180) / Math.PI);
}

export type UprightMode = "ANY" | "QUARTER";

export interface UprightResult {
  ocr: ClientOcr;
  /** Uygulanan saat yönü dönüşü; 0 = dokunulmadı. */
  turnDeg: number;
  transform: OrientationTransform | null;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Kareyi dik çerçeveye çevirir. `ANY` (canlı okuma): baskın açının tamamı · `QUARTER` (fotoğraf yüklemesi): en yakın
 * çeyreğe yuvarlanır (saklanan fotoğraf/kutu sözleşmesi yalnız 0/90/180/270 taşır; artık eğimi motor tolere eder).
 * Cihaz zaten dikleştirdiyse (`rotation` ≠ 0) ya da kanıt yetersizse kare AYNEN döner.
 */
export function uprightClientOcr(c: ClientOcr, mode: UprightMode): UprightResult {
  const same: UprightResult = { ocr: c, turnDeg: 0, transform: null };
  if ((c.rotation ?? 0) !== 0) return same;
  const reading = dominantReadingDeg(lineDirections(c));
  if (reading === null) return same;
  let turn = norm360(-reading);
  if (mode === "QUARTER") turn = norm360(Math.round(turn / 90) * 90);
  if (Math.abs(signedDeg(turn)) < MIN_SKEW_DEG) return same;
  const t = orientationTransform(turn, c.width, c.height);
  const mq = (q: Quad): Quad => q.map((p) => t.toUpright(p).map(r1) as Pt);
  const quarter = norm360(Math.round(turn / 90) * 90) as 0 | 90 | 180 | 270;
  const ocr: ClientOcr = {
    ...c,
    width: Math.max(1, Math.ceil(t.width)),
    height: Math.max(1, Math.ceil(t.height)),
    rotation: quarter,
    words: c.words.map((w) => ({ ...w, c: mq(w.c) })),
    ...(c.lines ? { lines: c.lines.map((l) => ({ ...l, c: mq(l.c) })) } : {}),
  };
  return { ocr, turnDeg: turn, transform: t };
}
