// `guncelleyici-fikstur.mjs`in tipleri — TypeScript bekçileri için.
export interface FiksturKunyesi {
  readonly surum: string | null;
  readonly boyut: number;
  readonly sha256: string;
}
export declare const FIKSTUR_GUNCELLEYICI_SURUMU: string;
export declare function sahteWindowsGuncelleyici(etiket?: string): Buffer;
export declare function sahteLinuxGuncelleyici(): Buffer;
export declare function sha256Hex(b: Buffer): string;
export declare function fiksturGuncelleyiciYaz(kok: string, s?: { surum?: string | null; ikili?: Buffer }): Record<string, FiksturKunyesi>;
