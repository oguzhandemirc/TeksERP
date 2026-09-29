// Derleme FİLİGRANI — korumalı derlemede esbuild `define` ile bayt koduna gömülen sabit (müşteri
// kodu · kurulum kimliği · paket kimliği · derleme anı; kişisel veri yok). Aynı değerler imzalı
// dosya listesinde de durur; bütünlük denetimi ikisinin uyuştuğunu ölçer (başka müşterinin listesi
// bu pakete taşınamaz). Geliştirmede sabit tanımsızdır → filigran yok.
declare const __TEKSERP_FILIGRAN__: string | undefined;

export interface BuildWatermark {
  readonly musteri: string | null;
  readonly kurulumId: string | null;
  readonly paketId: string | null;
  readonly derlemeTarihi: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null);

export function parseWatermark(text: string | null): BuildWatermark | null {
  if (text === null) return null;
  try {
    const o: unknown = JSON.parse(text);
    if (typeof o !== "object" || o === null) return null;
    const get = (k: string): unknown => Reflect.get(o, k);
    return { musteri: str(get("musteri")), kurulumId: str(get("kurulumId")), paketId: str(get("paketId")), derlemeTarihi: str(get("derlemeTarihi")) };
  } catch {
    return null;
  }
}

/** Bu derlemenin filigranı; geliştirmede null. */
export const BUILD_WATERMARK: BuildWatermark | null = parseWatermark(typeof __TEKSERP_FILIGRAN__ === "string" ? __TEKSERP_FILIGRAN__ : null);

/**
 * İmzalı künye ile bayt kodu filigranı uyuşuyor mu. Filigran yoksa (geliştirme ya da eski paket)
 * karar verilmez (`true`); varsa paket kimliği ve müşteri kodu birebir aynı olmalı.
 */
export function watermarkMatches(
  mark: BuildWatermark | null,
  signed: { readonly paketId: string; readonly musteri: string | null },
): boolean {
  if (mark === null) return true;
  return mark.paketId === signed.paketId && mark.musteri === signed.musteri;
}
