// `imaj-kokeni.mjs`in tipleri — TypeScript tüketiciler (scripts/imaj-kunye.ts, scripts/test_docker_hijyeni.ts) için.
export interface ImajKunyesi {
  readonly v: number;
  readonly commit: string;
  readonly runId: number;
  readonly runAttempt: number;
  readonly surum: string;
  readonly platform: string;
  readonly configOzeti: string;
  readonly diffIds: readonly string[];
  readonly native: { readonly dosya: string; readonly sha256: string };
  readonly arsiv: { readonly dosya: string; readonly sha256: string };
}
export interface TabanOlcumu {
  readonly kimlik: string;
  readonly platform: string;
  readonly diffIds: readonly string[];
  readonly revision: string | null;
}
export interface ImajKokeniHukmu {
  readonly sonuc: "uyumlu" | "ihlal" | "olculemedi";
  readonly satirlar: string[];
}
export declare const KUNYE_SURUMU: number;
export declare const KUNYE_DOSYASI: string;
export declare const KUNYE_YAPITI: string;
export declare const IMAJ_YAPITI: string;
export declare const IMAJ_ARSIVI: string;
export declare const PLATFORM: string;
export declare function kunyeDenetle(k: unknown): string[];
export declare function imajKokeniHukmu(o: { kosuId: unknown; kosuCommit: unknown; kunye: unknown; taban: unknown }): ImajKokeniHukmu;
