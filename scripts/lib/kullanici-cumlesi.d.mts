// `kullanici-cumlesi.mjs`in tipleri — TypeScript tüketici (Teks-Erp/scripts/lib/ci-kokeni.ts) için.
export interface CumleHukmu {
  readonly gecerli: boolean;
  readonly cumle: string;
  readonly sebep: string | null;
}
export declare const CUMLE_ASGARI_KARAKTER: number;
export declare const CUMLE_ASGARI_KELIME: number;
export declare function cumleDenetle(ham: unknown): CumleHukmu;
export declare function kacisCumlesiDenetle(ham: unknown): CumleHukmu;
export declare function istanbulSaati(t?: Date): string;
