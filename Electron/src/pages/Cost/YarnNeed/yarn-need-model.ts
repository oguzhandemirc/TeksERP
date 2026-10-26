// İplik ihtiyaç planı (MAL-7) — sunucu zarfının istemci tipi + SAF görünüm yardımcıları.
// İstemci HESAP YAPMAZ: sayı, tablo ve "bilinmiyor" hücresi sunucudan (`yarn-need.sunum.ts`); burada yalnız etiket.
import type { RaporSunumu } from "@/pages/Reports/_v2/sunum";

export const YARN_NEED_KEY = "maliyet/iplik-ihtiyaci";

export interface YarnNeedMeta {
  netle: boolean;
  leventDus: boolean;
  yapisiEksik: Array<{ urunId: string; urunKodu: string; urun: string; kalemSayisi: number; metre: string; eksikler: string[] }>;
  olculemeyen: Array<{ urunId: string; urunKodu: string; urun: string; birim: string; kalemSayisi: number; miktar: string }>;
  kaynaklar: { stok: boolean; emanet: boolean; acikAlis: boolean; leventDusumu: boolean };
  hesapZamani: string;
}

export type YarnNeedPresentation = RaporSunumu & { detay?: { meta: YarnNeedMeta } };

/** Hesaba giren / girmeyen kaynak rozetleri — modül kapalıysa "bilinmiyor" diye AÇIKÇA söylenir. */
export function sourceBadges(k: YarnNeedMeta["kaynaklar"]): Array<{ key: string; label: string; on: boolean }> {
  return [
    { key: "stok", label: k.stok ? "Serbest stok düşüldü" : "Stok bilinmiyor (iplik modülü kapalı)", on: k.stok },
    { key: "emanet", label: k.emanet ? "Emanet ayrı gösterildi" : "Emanet takibi kapalı", on: k.emanet },
    { key: "acikAlis", label: k.acikAlis ? "Açık alış düşüldü" : "Açık alış bilinmiyor (ticaret modülü kapalı)", on: k.acikAlis },
    { key: "levent", label: k.leventDusumu ? "Hazır levent düşüldü" : "Hazır levent düşülmedi", on: k.leventDusumu },
  ];
}

/** Hesaba GİREMEYEN ürünlerin şerit metni; ikisi de boşsa null (şerit çizilmez). */
export function excludedText(m: Pick<YarnNeedMeta, "yapisiEksik" | "olculemeyen">): string | null {
  const parts: string[] = [];
  if (m.yapisiEksik.length > 0) parts.push(`${m.yapisiEksik.length} ürünün kumaş yapısı eksik`);
  if (m.olculemeyen.length > 0) parts.push(`${m.olculemeyen.length} ürün metre dışı birimde`);
  return parts.length ? `${parts.join(" · ")} — bu ürünler ihtiyaca girmedi.` : null;
}
