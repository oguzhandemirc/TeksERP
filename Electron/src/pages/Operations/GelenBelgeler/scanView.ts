// Tarama görüntüleyicisinin saf görünüm matematiği (DOM yok; birim testli).
// Görüntü pikseli → ekran: önce döndür (saat yönü, 90° adım), sonra ölçekle, sonra kaydır.
// Vurgu kutuları görüntüyle AYNI kapta çizildiği için aynı matrisle birlikte dönüşür.

export type Rotation = 0 | 90 | 180 | 270;
export interface Size {
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Görüntünün doğal boyutu + görünüm (viewport) boyutu. */
export interface Geo {
  nat: Size;
  vp: Size;
}
/** scale: ekran pikseli / görüntü pikseli; tx,ty: döndürülmüş görüntünün sol üstünün ekran konumu. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
  rot: Rotation;
}

/** Sığdır'a göre alt/üst sınır: yarısına kadar uzaklaş, 12 katına (ya da en az gerçek boyutun 4 katına) kadar yaklaş. */
export const MIN_REL = 0.5;
export const MAX_REL = 12;
export const MIN_MAX_ABS = 4;

export function rotatedSize(nat: Size, rot: Rotation): Size {
  return rot === 90 || rot === 270 ? { w: nat.h, h: nat.w } : nat;
}

/** Görüntü pikselini döndürülmüş görüntünün (ölçeksiz) koordinatına çevirir. */
export function rotatePoint(p: Pt, nat: Size, rot: Rotation): Pt {
  if (rot === 90) return { x: nat.h - p.y, y: p.x };
  if (rot === 180) return { x: nat.w - p.x, y: nat.h - p.y };
  if (rot === 270) return { x: p.y, y: nat.w - p.x };
  return p;
}

export function toScreen(view: View, nat: Size, p: Pt): Pt {
  const r = rotatePoint(p, nat, view.rot);
  return { x: r.x * view.scale + view.tx, y: r.y * view.scale + view.ty };
}

/** CSS `matrix(a,b,c,d,e,f)` (transform-origin 0 0): toScreen ile birebir aynı eşleme. */
export function viewMatrix(view: View, nat: Size): [number, number, number, number, number, number] {
  const { scale: s, tx, ty } = view;
  if (view.rot === 90) return [0, s, -s, 0, s * nat.h + tx, ty];
  if (view.rot === 180) return [-s, 0, 0, -s, s * nat.w + tx, s * nat.h + ty];
  if (view.rot === 270) return [0, -s, s, 0, tx, s * nat.w + ty];
  return [s, 0, 0, s, tx, ty];
}

export function fitScale(nat: Size, vp: Size, rot: Rotation): number {
  const r = rotatedSize(nat, rot);
  if (vp.w <= 0 || vp.h <= 0 || r.w <= 0 || r.h <= 0) return 1;
  return Math.min(vp.w / r.w, vp.h / r.h);
}

export function scaleLimits(nat: Size, vp: Size, rot: Rotation): { min: number; max: number } {
  const fit = fitScale(nat, vp, rot);
  return { min: fit * MIN_REL, max: Math.max(fit * MAX_REL, MIN_MAX_ABS) };
}

/** Görüntü görünümden kaçmasın: görünümden küçükse ortalanır, büyükse kenar boşluk bırakmaz. */
export function clampPan(view: View, nat: Size, vp: Size): View {
  const r = rotatedSize(nat, view.rot);
  const axis = (t: number, content: number, port: number) =>
    content <= port ? (port - content) / 2 : Math.min(0, Math.max(port - content, t));
  return { ...view, tx: axis(view.tx, r.w * view.scale, vp.w), ty: axis(view.ty, r.h * view.scale, vp.h) };
}

export function fitView(nat: Size, vp: Size, rot: Rotation = 0): View {
  return clampPan({ scale: fitScale(nat, vp, rot), tx: 0, ty: 0, rot }, nat, vp);
}

/** `at` (ekran noktası) yerinde sabit kalacak biçimde ölçeği `factor` ile çarpar. */
export function zoomAt(view: View, factor: number, at: Pt, { nat, vp }: Geo): View {
  const { min, max } = scaleLimits(nat, vp, view.rot);
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const k = scale / view.scale;
  return clampPan(
    { ...view, scale, tx: at.x - (at.x - view.tx) * k, ty: at.y - (at.y - view.ty) * k },
    nat,
    vp,
  );
}

export function panBy(view: View, d: Pt, { nat, vp }: Geo): View {
  return clampPan({ ...view, tx: view.tx + d.x, ty: view.ty + d.y }, nat, vp);
}

/** 90° saat yönünde döndürür ve yeni yönelime sığdırır. */
export function rotateView(view: View, nat: Size, vp: Size): View {
  return fitView(nat, vp, ((view.rot + 90) % 360) as Rotation);
}

/** Görüntü kutusunun ekrandaki sınır kutusu (dönüşümden sonra). */
export function boxOnScreen(view: View, nat: Size, b: Box): Box {
  const ps = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ].map((p) => toScreen(view, nat, p));
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function isBoxVisible(view: View, nat: Size, vp: Size, b: Box): boolean {
  const s = boxOnScreen(view, nat, b);
  return s.x >= 0 && s.y >= 0 && s.x + s.width <= vp.w && s.y + s.height <= vp.h;
}

/** Kutuyu görünümün ortasına getirir; `zoom` ise kutu görünüm genişliğinin ~%90'ını (yüksekliğin en çok %40'ını) doldurur. */
export function focusBox(view: View, { nat, vp }: Geo, b: Box, zoom: boolean): View {
  const { min, max } = scaleLimits(nat, vp, view.rot);
  let scale = view.scale;
  if (zoom) {
    const unit = boxOnScreen({ ...view, scale: 1, tx: 0, ty: 0 }, nat, b);
    const want = Math.min((vp.w * 0.9) / Math.max(1, unit.width), (vp.h * 0.4) / Math.max(1, unit.height));
    scale = Math.min(max, Math.max(min, want));
  }
  const c = boxOnScreen({ ...view, scale, tx: 0, ty: 0 }, nat, b);
  return clampPan(
    { ...view, scale, tx: vp.w / 2 - (c.x + c.width / 2), ty: vp.h / 2 - (c.y + c.height / 2) },
    nat,
    vp,
  );
}

/** Sığdır'a göre yüzde (100 = sığdır). */
export function zoomPercent(view: View, nat: Size, vp: Size): number {
  return Math.round((view.scale / fitScale(nat, vp, view.rot)) * 100);
}

/** Tekerlek/pinch deltasından çarpan; ctrl (izleme dörtgeni pinch'i) küçük delta üretir, daha hassastır. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrl: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const k = ctrl ? 0.01 : 0.0015;
  return Math.exp(-Math.max(-300, Math.min(300, px)) * k);
}
