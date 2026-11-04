// Tanıtma ekranının yerleşimi — saf: pencere ölçüsünden düzen + belge bölmesinin boyu. Yatay tablette belge solda, panel sağda;
// dikey tablette ve telefonda belge üstte, panel altta (telefon yatayda da üst-alt: kısa kenar paneli sığdırmaz).

/** Kısa kenarı bundan küçük pencere telefondur (Android sw600dp tablet eşiği). */
export const TABLET_MIN_SHORT_SIDE = 600;

export type TeachLayout =
  | { mode: 'side'; imageWidth: number }
  | { mode: 'stack'; imageHeight: number };

export function teachLayout(width: number, height: number): TeachLayout {
  const tablet = Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
  if (tablet && width > height) return { mode: 'side', imageWidth: Math.round(width * 0.6) };
  // Panel en az ~%55 kalsın: adım kartı + Kaydet çubuğu fotoğrafın altında görünür kalır.
  return { mode: 'stack', imageHeight: Math.round(height * (tablet ? 0.45 : 0.4)) };
}
