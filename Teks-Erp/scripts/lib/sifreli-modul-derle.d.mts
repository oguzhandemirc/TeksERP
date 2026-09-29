// `sifreli-modul-derle.mjs` tür beyanı (bekçi TS'ten içe aktarır).
export declare const HOST_ONEKI: string;
export interface KatalogPaketi {
  readonly paket: string;
  readonly modul: string;
  readonly ad: string;
  readonly giris: string;
  readonly dosyalar: readonly string[];
  readonly yol: string;
}
export type EvSahibiParcasi = { readonly tur: "src"; readonly yol: string } | { readonly tur: "npm"; readonly ad: string };
export declare function katalogOku(proj: string): KatalogPaketi[];
export declare function modulPaketiDerle(g: {
  esbuild: unknown;
  proj: string;
  giris: string;
  dosyalar: readonly string[];
  outfile: string;
  disarida: readonly string[];
  minify?: boolean;
  target?: string;
}): Promise<{ ev: Map<string, EvSahibiParcasi> }>;
export declare function cekirdekEklentisi(g: { proj: string; paketler: readonly KatalogPaketi[]; ev: Map<string, EvSahibiParcasi> }): unknown;
