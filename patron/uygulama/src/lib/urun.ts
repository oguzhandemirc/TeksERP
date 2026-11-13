// Ürün kartı (V5c, ERP) yardımcıları: tür etiketi ve türden türeyen birim (panel `Electron/src/types/enums.ts` aynası).
export type UrunTuru = "FABRIC" | "YARN" | "CONSUMABLE";

export const URUN_TURLERI: readonly { readonly key: UrunTuru; readonly label: string; readonly birim: string }[] = [
  { key: "FABRIC", label: "Kumaş", birim: "MT" },
  { key: "YARN", label: "İplik", birim: "KG" },
  { key: "CONSUMABLE", label: "Sarf", birim: "ADET" },
];

export const urunTuruEtiketi = (tur: string | null | undefined): string => URUN_TURLERI.find((x) => x.key === tur)?.label ?? "";
