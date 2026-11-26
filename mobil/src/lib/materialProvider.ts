// Fason F7b — "Ana hammaddeyi kim verdi?" (bu fabrikanın bakışı; backend `enum MaterialProvider`). Tabletteki TEK kaynak:
// seçenekler ve gövde parçası. Alan her iş emri türünde sorulur (panel emsali); null = "Bilinmiyor" = bugünkü davranış.
export type MaterialProvider = 'CUSTOMER' | 'US' | 'MIXED';

export const MATERIAL_PROVIDER_OPTIONS: readonly { value: MaterialProvider | null; label: string }[] = [
  { value: null, label: 'Bilinmiyor' },
  { value: 'CUSTOMER', label: 'Müşteri' },
  { value: 'US', label: 'Bu fabrika' },
  { value: 'MIXED', label: 'Karışık' },
];

const VALUES: readonly string[] = ['CUSTOMER', 'US', 'MIXED'];

/** Seçim bileşeninden gelen ham değer → tanınan değer; tanınmayan/boş = null (Bilinmiyor). */
export function parseMaterialProvider(v: string | null | undefined): MaterialProvider | null {
  return v != null && VALUES.includes(v) ? (v as MaterialProvider) : null;
}

/** Gövde parçası: yalnız seçildiyse anahtar gider (gelen belge ucu katı gövdeli; eski sunucu tanımadığı anahtarı 400'ler). */
export function materialProvidedByBody(v: MaterialProvider | null | undefined): { materialProvidedBy?: MaterialProvider } {
  return v ? { materialProvidedBy: v } : {};
}
