// =============================================================================
// Barkod türü sınıflandırıcı — prefix → varlık türü
// =============================================================================
// Sistem-üretimi kodlar farklı prefix taşır (backend `utils/barcode.ts` +
// shipping/kartela servisleri ile doğrulandı):
//   TEKSYYYYMMDDXXXXXXXX    → Roll (top) — ayraçsız (wedge-tarayıcı `-`→`*` fix)
//   RKYYMMXXXXXXC           → TravelerCard (refakat kartı) — ayraçsız (wedge fix)
//   SWYYMMXXXXXXC           → Swatch (kartela) — ayraçsız tarama barkodu (wedge fix)
//   CV-YYMMDD-NNN           → Sack (çuval, sackNo)         ← 6 haneli tarih!
//   SD/SR/KD/KR...          → fason/kartela sevk/kabul belge no — ayraçsız (wedge fix)
// Çuval `manualCode`'u serbest metin (çakışmaya açık) → UNKNOWN fallback.
//
// Sınıflandırma PREFIX-çapalı (gevşek) tutulur: checksum/format bozuk olsa da
// doğru türe yönlenir, kesin kararı backend lookup ucu (404) verir. Tam-format
// regex'leri (checksum'lu) ayrıca dışa açılır — ScanField opsiyonel istemci
// doğrulamasında kullanır.
// =============================================================================

export type BarcodeKind =
  | "ROLL"
  | "TRAVELER_CARD"
  | "SWATCH"
  | "SACK"
  | "DISPATCH_DOC"
  | "UNKNOWN";

/** Tam-format regex'leri (checksum dahil) — opsiyonel istemci doğrulaması için. */
export const BARCODE_FORMATS = {
  ROLL: /^TEKS\d{8}[0-9A-F]{8}$/,
  TRAVELER_CARD: /^RK\d{4}[0-9A-Z]{6}[0-9A-Z]$/,
  SWATCH: /^SW\d{4}[0-9A-Z]{6}[0-9A-Z]$/,
  SACK: /^CV-\d{6}-\d{3}$/,
} as const;

// Prefix-çapalı sınıflandırma — sıra önemli değil (prefix'ler ayrık).
const PREFIX_RULES: Array<{ re: RegExp; kind: BarcodeKind }> = [
  { re: /^TEKS/, kind: "ROLL" },
  { re: /^RK/, kind: "TRAVELER_CARD" },
  { re: /^SW/, kind: "SWATCH" },
  { re: /^CV-/, kind: "SACK" },
  { re: /^(SD|SR|KD|KR)/, kind: "DISPATCH_DOC" },
];

export interface ClassifiedBarcode {
  kind: BarcodeKind;
  /** Normalize edilmiş kod (trim + uppercase). */
  code: string;
}

/** Ham taranan string'i türe ayır. Bilinmeyen prefix → UNKNOWN (manualCode denenir). */
export function classifyBarcode(raw: string): ClassifiedBarcode {
  const code = raw.trim().toUpperCase();
  for (const rule of PREFIX_RULES) {
    if (rule.re.test(code)) return { kind: rule.kind, code };
  }
  return { kind: "UNKNOWN", code };
}
