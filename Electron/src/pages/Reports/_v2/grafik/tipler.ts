// GEÇİCİ YEREL TİP — R0-ANLATI'nin `sunum.types.ts` içindeki `GrafikBlok`un adları birebir.
// R0-SABLON `_v2/sunum.ts` aynasını getirince bu dosya silinir, import'lar oraya döner.

/** Ölçü birimi ("m", "kg", "%", "adet", "TL" …); aynada kapalı küme olabilir. */
export type Birim = string;

export type GrafikTuru = "cizgi" | "cubuk" | "yiginCubuk" | "pasta" | "isiHaritasi" | "sacilim" | "kutu" | "kucukCoklu";

export interface GrafikBlok {
  tur: GrafikTuru;
  eksen: { x: { ad: string; tur: "zaman" | "kategori" | "sayi" }; y: { ad: string; birim: Birim } };
  seriler: { ad: string; veri: (number | null)[]; soluk?: boolean }[];
  kategoriler: string[];
}
