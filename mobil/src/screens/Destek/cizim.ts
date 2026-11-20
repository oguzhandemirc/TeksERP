// =============================================================================
// Ekran görüntüsü üzerine çizim — saf durum + geometri
// =============================================================================
// Araçlar: serbest kalem · ok · dikdörtgen · karartma kutusu (hassas veriyi
// tamamen örter; yarı saydam DEĞİL). Geri al son şekli siler, temizle hepsini.
// Görünüm (`CizimTuvali.tsx`) yalnız bu durumu çizer; dokunma → eylem çevirisi
// de orada. Koordinatlar tuvalin dp cinsinden yerel koordinatlarıdır.
// =============================================================================

export type CizimAraci = 'kalem' | 'ok' | 'kutu' | 'karart';
export type CizimRengi = 'kirmizi' | 'sari' | 'yesil' | 'mavi';

export interface Nokta {
  x: number;
  y: number;
}

export interface Sekil {
  id: number;
  arac: CizimAraci;
  renk: CizimRengi;
  /** Kalem: iz; diğerleri: [başlangıç, bitiş]. */
  noktalar: Nokta[];
}

export interface DrawingState {
  sekiller: Sekil[];
  aktif: Sekil | null;
  sonId: number;
}

export const BOS_CIZIM: DrawingState = { sekiller: [], aktif: null, sonId: 0 };

export type CizimEylemi =
  | { tip: 'basla'; arac: CizimAraci; renk: CizimRengi; nokta: Nokta }
  | { tip: 'ilerle'; nokta: Nokta }
  | { tip: 'bitir' }
  | { tip: 'geriAl' }
  | { tip: 'temizle' };

/** Bu boyuttan küçük ok/kutu yanlışlıkla dokunmadır, eklenmez (dp). */
export const ASGARI_BOYUT = 6;
/** Kalem izine iki nokta arası en az bu kadar uzaklıkta nokta eklenir (dp). */
const KALEM_ADIM = 2;

function uzaklik(a: Nokta, b: Nokta): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bitmiş şekil anlamlı mı (tek dokunuş/çok küçük şekil atılır)? */
export function anlamliMi(s: Sekil): boolean {
  if (s.arac === 'kalem') return s.noktalar.length >= 2;
  const [a, b] = s.noktalar;
  if (!a || !b) return false;
  if (s.arac === 'ok') return uzaklik(a, b) >= ASGARI_BOYUT;
  return Math.abs(a.x - b.x) >= ASGARI_BOYUT && Math.abs(a.y - b.y) >= ASGARI_BOYUT;
}

function ilerlet(aktif: Sekil, p: Nokta): Sekil {
  if (aktif.arac === 'kalem') {
    const son = aktif.noktalar[aktif.noktalar.length - 1];
    if (son && uzaklik(son, p) < KALEM_ADIM) return aktif;
    return { ...aktif, noktalar: [...aktif.noktalar, p] };
  }
  return { ...aktif, noktalar: [aktif.noktalar[0], p] };
}

export function cizimReducer(d: DrawingState, e: CizimEylemi): DrawingState {
  switch (e.tip) {
    case 'basla': {
      const id = d.sonId + 1;
      return { ...d, sonId: id, aktif: { id, arac: e.arac, renk: e.renk, noktalar: [e.nokta] } };
    }
    case 'ilerle':
      return d.aktif ? { ...d, aktif: ilerlet(d.aktif, e.nokta) } : d;
    case 'bitir':
      if (!d.aktif) return d;
      return anlamliMi(d.aktif)
        ? { ...d, sekiller: [...d.sekiller, d.aktif], aktif: null }
        : { ...d, aktif: null };
    case 'geriAl':
      return { ...d, aktif: null, sekiller: d.sekiller.slice(0, -1) };
    case 'temizle':
      return { ...d, aktif: null, sekiller: [] };
    default:
      return d;
  }
}

const yuvarla = (n: number) => Math.round(n * 10) / 10;

/** Serbest kalem izi → SVG yol metni. */
export function kalemYolu(noktalar: readonly Nokta[]): string {
  return noktalar
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${yuvarla(p.x)} ${yuvarla(p.y)}`)
    .join(' ');
}

/** Ok: gövde çizgisi + uçtaki iki kanat (tek yol). */
export function okYolu(a: Nokta, b: Nokta, basBoyu = 22): string {
  const aci = Math.atan2(b.y - a.y, b.x - a.x);
  const kanat = Math.PI / 7;
  const k1 = { x: b.x - basBoyu * Math.cos(aci - kanat), y: b.y - basBoyu * Math.sin(aci - kanat) };
  const k2 = { x: b.x - basBoyu * Math.cos(aci + kanat), y: b.y - basBoyu * Math.sin(aci + kanat) };
  return `${kalemYolu([a, b])} ${kalemYolu([k1, b, k2])}`;
}

/** İki köşeden normalize dikdörtgen (sürükleme yönünden bağımsız). */
export function dikdortgen(a: Nokta, b: Nokta): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Uzun kenarı `azami` pikseli aşmayan çıktı boyutu (oran korunur, tam sayı). */
export function uzunKenaraSigdir(
  w: number,
  h: number,
  azami = 1920,
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const olcek = Math.min(1, azami / Math.max(w, h));
  return { width: Math.round(w * olcek), height: Math.round(h * olcek) };
}

/** Görüntüyü (gw×gh) kaba (kw×kh) oranı bozmadan sığdırır — tuval boyutu. */
export function sigdir(
  gw: number,
  gh: number,
  kw: number,
  kh: number,
): { width: number; height: number } {
  if (!(gw > 0) || !(gh > 0) || !(kw > 0) || !(kh > 0)) return { width: 0, height: 0 };
  const olcek = Math.min(kw / gw, kh / gh);
  return { width: Math.floor(gw * olcek), height: Math.floor(gh * olcek) };
}
