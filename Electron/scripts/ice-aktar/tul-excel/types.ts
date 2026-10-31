// Tül Excel dönüştürücüsünün ortak tipleri (tasarım §9.5). Betik yalnız dosya okur.

export const ERROR_CLASSES = [
  "BIRIM_1000",
  "BIRIM_8000",
  "EN_TUTARSIZ",
  "SIKLIK_RAPOR_TUTMUYOR",
  "METIN_SAYI",
  "SISIRME_FARKLI",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** Hata raporunun bir satırı: sayfa + hücre, Excel değeri, önerilen değer. */
export interface ReportRow {
  errorClass: ErrorClass;
  file: string;
  sheet: string;
  cell: string;
  excelValue: string;
  suggested: string;
  note: string;
  /** Satır gerçekten kullanılıyor mu (miktar > 0); boş şablon satırı da raporlanır. */
  inUse: boolean;
}

/** `(E*3.3)*80/9000` ya da `C4*3.5*330/9000` gramaj formülünün çözümü. */
export interface GramFormula {
  width: number | null;
  denier: number;
  divisor: number;
}

/** Bir iplik satırı (desen atkısı ya da maliyet sayfası satırı). */
export interface YarnRow {
  file: string;
  sheet: string;
  row: number;
  yarnName: string;
  gramCell: string;
  formula: GramFormula | null;
  inUse: boolean;
}

export interface WeftLine extends YarnRow {
  order: number;
  repeatCount: number | null;
  picksPerMeter: number | null;
  picksCell: string;
  gramExcel: number | null;
}

export interface Variant {
  code: string;
  metallic: string;
  dyeProcess: string;
  metallicYarnCode: string;
}

export interface DesignSheet {
  sheet: string;
  designNo: string;
  designType: string;
  repeatCm: number | null;
  repeatCell: string;
  density: number | null;
  densityCell: string;
  averageDensity: number | null;
  weftNo: string;
  dobbyNo: string;
  costUsd: number | null;
  costNote: string;
  weftMap: Record<string, string>;
  weftSequence: string;
  liftPlan: string;
  wefts: WeftLine[];
  variants: Variant[];
}

export interface CostYarnLine extends YarnRow {
  warpEnds: number | null;
  picksPerMeter: number | null;
  priceUsdKg: number | null;
  gramExcel: number | null;
  totalExcel: number | null;
}

export interface CostSheet {
  sheet: string;
  lines: CostYarnLine[];
  /** Özet satırları: etiket → G sütunu değeri (İPLİK MALİYETİ, DOKUMA, APRE-BOYA …). */
  summary: Record<string, number | null>;
  weavingRateCent: number | null;
}

export interface ConversionResult {
  designs: DesignSheet[];
  costSheets: CostSheet[];
  report: ReportRow[];
}
