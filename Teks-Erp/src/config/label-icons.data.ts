// =============================================================================
// TeksERP - Etiket Bakım Sembolü Tanımları (ISO 3758 stili — veri dosyası)
// =============================================================================
// Kanvas "icon" elemanının çizim verisi: her sembol 0..100 × 0..100 birim
// uzayında (y aşağı artar) küçük bir primitif listesi olarak tanımlanır.
// SVG üretimi (label-icons.ts) ve 1bpp rasterize (raster-icon.ts) AYNI
// primitiflerden beslenir — önizleme = baskı. Varsayılan çizgi kalınlığı 6
// birim, uçlar yuvarlak. Yasak çarpısı DAİMA son primitiftir (üstte basılır).
// =============================================================================

/** Tek çizim primitifi — koordinatlar 0..100 viewBox birimi, y aşağı. */
export type IconPrimitive =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; w?: number }
  | { t: "pline"; pts: [number, number][]; w?: number; closed?: boolean } // konturlu polyline
  | { t: "poly"; pts: [number, number][] } // dolu poligon (even-odd)
  | { t: "circle"; cx: number; cy: number; r: number; w?: number; fill?: boolean }
  | { t: "arc"; cx: number; cy: number; r: number; a1: number; a2: number; w?: number } // derece, 0°=saat 3, saat-yönü-tersi pozitif
  | { t: "text"; x: number; y: number; h: number; s: string }; // x,y = metin bloğu MERKEZİ, h = büyük-harf yüksekliği

export interface LabelIconDef {
  key: string;
  label: string;
  category: string;
  prims: IconPrimitive[];
}

// -----------------------------------------------------------------------------
// Ortak parça üreticileri (tanım tekrarını önler)
// -----------------------------------------------------------------------------

/** Yıkama leğeni: üstü açık trapez + üst ağızda dalgalı su çizgisi. */
function tub(): IconPrimitive[] {
  return [
    { t: "pline", pts: [[14, 34], [24, 84], [76, 84], [86, 34]] },
    { t: "pline", pts: [[10, 31], [23, 26], [37, 32], [50, 28], [63, 32], [77, 26], [90, 31]], w: 5 },
  ];
}

/** Yasak çarpısı — iki kalın diyagonal, sembolün ÜSTÜNE basılır (listede son). */
function cross(): IconPrimitive[] {
  return [
    { t: "line", x1: 12, y1: 12, x2: 88, y2: 88, w: 7 },
    { t: "line", x1: 88, y1: 12, x2: 12, y2: 88, w: 7 },
  ];
}

/** Ağartma üçgeni (kontur, kapalı). */
function triangle(): IconPrimitive {
  return { t: "pline", pts: [[50, 14], [12, 84], [88, 84]], closed: true };
}

/** Makinede kurutma: kare çerçeve + içine çizili daire. */
function squareCircle(): IconPrimitive[] {
  return [
    { t: "pline", pts: [[16, 16], [84, 16], [84, 84], [16, 84]], closed: true },
    { t: "circle", cx: 50, cy: 50, r: 26 },
  ];
}

/** Isı noktası (dolu daire). */
function dot(cx: number, cy: number, r: number): IconPrimitive {
  return { t: "circle", cx, cy, r, fill: true };
}

/** Ütü silueti — düz taban + üstten kavisli sırt (kapalı kontur). */
function ironBody(): IconPrimitive {
  return {
    t: "pline",
    pts: [[12, 76], [16, 58], [34, 44], [62, 40], [82, 46], [88, 62], [88, 76]],
    closed: true,
  };
}

/** Kuru temizleme dairesi. */
function dcCircle(): IconPrimitive {
  return { t: "circle", cx: 50, cy: 50, r: 34 };
}

/** Yıkama sıcaklık sembolü (leğen + derece metni). */
function wash(key: string, label: string, deg: string): LabelIconDef {
  return { key, label, category: "yikama", prims: [...tub(), { t: "text", x: 50, y: 60, h: 22, s: deg }] };
}

/** Kuru/ıslak temizleme harf sembolü (daire + merkez harf). */
function dc(key: string, label: string, letter: string): LabelIconDef {
  return { key, label, category: "kuru-temizleme", prims: [dcCircle(), { t: "text", x: 50, y: 50, h: 26, s: letter }] };
}

// -----------------------------------------------------------------------------
// Sembol kayıtları — kategori sırası: yıkama, ağartma, kurutma, ütü, kuru temizleme
// -----------------------------------------------------------------------------

export const LABEL_ICONS_DATA: LabelIconDef[] = [
  // --- Yıkama ---
  wash("wash-30", "Yıkama 30°", "30"),
  wash("wash-40", "Yıkama 40°", "40"),
  wash("wash-60", "Yıkama 60°", "60"),
  wash("wash-95", "Yıkama 95°", "95"),
  {
    key: "wash-hand",
    label: "Elde Yıkama",
    category: "yikama",
    prims: [
      ...tub(),
      // Sağ üstten leğene giren el/ön kol + küçük başparmak vuruşu.
      { t: "pline", pts: [[90, 8], [72, 26], [64, 42]] },
      { t: "line", x1: 72, y1: 26, x2: 80, y2: 36 },
    ],
  },
  { key: "wash-no", label: "Yıkanmaz", category: "yikama", prims: [...tub(), ...cross()] },

  // --- Ağartma ---
  { key: "bleach-ok", label: "Ağartılabilir", category: "agartma", prims: [triangle()] },
  {
    key: "bleach-non-chlorine",
    label: "Klorsuz Ağartıcı",
    category: "agartma",
    prims: [
      triangle(),
      // Üçgen içinde iki paralel diyagonal tarama çizgisi.
      { t: "line", x1: 34, y1: 72, x2: 54, y2: 42, w: 5 },
      { t: "line", x1: 48, y1: 72, x2: 64, y2: 48, w: 5 },
    ],
  },
  { key: "bleach-no", label: "Ağartıcı Kullanılmaz", category: "agartma", prims: [triangle(), ...cross()] },

  // --- Kurutma ---
  { key: "tumble-ok", label: "Makinede Kurutma", category: "kurutma", prims: [...squareCircle()] },
  { key: "tumble-low", label: "Kurutma Düşük Isı", category: "kurutma", prims: [...squareCircle(), dot(50, 50, 5)] },
  {
    key: "tumble-med",
    label: "Kurutma Orta Isı",
    category: "kurutma",
    prims: [...squareCircle(), dot(41, 50, 5), dot(59, 50, 5)],
  },
  { key: "tumble-no", label: "Makinede Kurutulmaz", category: "kurutma", prims: [...squareCircle(), ...cross()] },
  {
    key: "line-dry",
    label: "Askıda Kurutma",
    category: "kurutma",
    prims: [
      { t: "pline", pts: [[16, 16], [84, 16], [84, 84], [16, 84]], closed: true },
      // Üst iki köşeden sarkan ip — (16,16)-(84,16) kirişi, ortada y≈45'e sarkar.
      { t: "arc", cx: 50, cy: 10.6, r: 34.4, a1: -171, a2: -9 },
    ],
  },

  // --- Ütü ---
  { key: "iron-low", label: "Ütü Düşük Isı", category: "utu", prims: [ironBody(), dot(50, 60, 4.5)] },
  {
    key: "iron-med",
    label: "Ütü Orta Isı",
    category: "utu",
    prims: [ironBody(), dot(41, 60, 4.5), dot(59, 60, 4.5)],
  },
  {
    key: "iron-high",
    label: "Ütü Yüksek Isı",
    category: "utu",
    prims: [ironBody(), dot(38, 60, 4.5), dot(50, 60, 4.5), dot(62, 60, 4.5)],
  },
  { key: "iron-no", label: "Ütülenmez", category: "utu", prims: [ironBody(), ...cross()] },

  // --- Kuru Temizleme ---
  dc("dc-p", "Kuru Temizleme (P)", "P"),
  dc("dc-f", "Kuru Temizleme (F)", "F"),
  dc("dc-w", "Islak Temizleme (W)", "W"),
  { key: "dc-no", label: "Kuru Temizleme Yapılmaz", category: "kuru-temizleme", prims: [dcCircle(), ...cross()] },
];
