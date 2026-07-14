// =============================================================================
// Barkod türü sınıflandırıcı — prefix → varlık türü
// =============================================================================
// Tek tip kod kalıbı: PREFIX + GGAAYY + NNNN (ayraçsız, checksum YOK — insan-okur
// kod = tarama barkodu). Backend `utils/code-format.ts` ile doğrulandı:
//   T{GGAAYY}{H|F}NNNN  → Roll (top; H=ham/F=final)     örn T120726H0001
//   İE{GGAAYY}NNNN      → TravelerCard = iş emri kartı (tek kod, WO'yu açar) örn IE1207260001
//   RK{GGAAYY}NNNN      → TravelerCard (eski/legacy kart)  örn RK1207260001
//   KRT{GGAAYY}NNNN     → Swatch (kartela/numune)        örn KRT1207260001
//   CV{GGAAYY}NNNN      → Sack (çuval, sackNo)           örn CV1207260001
//   FS/FK/KS/KK...      → fason/kartela sevk/kabul belge no
//
// Sınıflandırma PREFIX-çapalı (gevşek) tutulur: format bozuk olsa da doğru türe
// yönlenir, kesin kararı backend lookup ucu (404) verir. Tam-format regex'leri
// ayrıca dışa açılır — ScanField opsiyonel istemci doğrulamasında kullanır.
// =============================================================================

export type BarcodeKind =
  | "ROLL"
  | "TRAVELER_CARD"
  | "SWATCH"
  | "SACK"
  | "DISPATCH_DOC"
  | "UNKNOWN";

/** Tam-format regex'leri — opsiyonel istemci doğrulaması için (checksum yok). */
export const BARCODE_FORMATS = {
  ROLL: /^T\d{6}[HF]\d{4}$/,
  // Kart = iş emri no (İE); eski kartlar RK. Tek-kod, karekod versiyonlar arası sabit.
  TRAVELER_CARD: /^(?:IE|RK)\d{6}\d{4}$/,
  SWATCH: /^KRT\d{6}\d{4}$/,
  SACK: /^CV\d{6}\d{4}$/,
} as const;

// Prefix-çapalı sınıflandırma. Sıra: daha uzun/özgül prefix'ler önce (KRT, KS/KK
// karışmasın). T→ROLL yalnız T+rakam (KRT/diğerleri K/başka harfle başlar).
const PREFIX_RULES: Array<{ re: RegExp; kind: BarcodeKind }> = [
  { re: /^KRT/, kind: "SWATCH" },
  { re: /^IE\d/, kind: "TRAVELER_CARD" }, // iş emri kartı (tek kod) — WO'yu açar
  { re: /^RK/, kind: "TRAVELER_CARD" }, // eski/legacy kart
  { re: /^CV/, kind: "SACK" },
  { re: /^(FS|FK|KS|KK)/, kind: "DISPATCH_DOC" },
  { re: /^T\d/, kind: "ROLL" },
];

export interface ClassifiedBarcode {
  kind: BarcodeKind;
  /** Normalize edilmiş kod (trim + uppercase). */
  code: string;
}

/** Ham taranan string'i türe ayır. Bilinmeyen prefix → UNKNOWN. */
export function classifyBarcode(raw: string): ClassifiedBarcode {
  const code = raw.trim().toUpperCase();
  for (const rule of PREFIX_RULES) {
    if (rule.re.test(code)) return { kind: rule.kind, code };
  }
  return { kind: "UNKNOWN", code };
}
