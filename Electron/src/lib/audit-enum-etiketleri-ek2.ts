// =============================================================================
// AUDIT DEĞER ETİKETLERİ — ÜÇÜNCÜ PARÇA (devere ek B1, 2026-11-20)
// -----------------------------------------------------------------------------
// `audit-enum-etiketleri.ts`deki `ENUM_LABELS`in devamıdır (ilk iki parça dosya boyu tavanında;
// anlam tek harita). `Electron/src/lib/` altındaki aynı adlı dosya BAYT-EŞİT aynadır.
// =============================================================================

/** `ENUM_LABELS`in üçüncü parçası — tek başına kullanılmaz, ana haritaya yayılır. */
export const ENUM_LABELS_EK2: Record<string, string> = {
  // Levent gövdesi: BeamBodyStatus · BeamBodyOwnerRole · LabelKind — AT_SUBCONTRACTOR/MOUNTED/SCRAPPED ortak (paylaşım beyanı)
  EMPTY_STOCK: "Depoda boş",
  FULL_STOCK: "Dolu bekliyor",
  FULL_OUT: "Dolu dışarıda",
  MAINTENANCE: "Bakımda",
  RETURNED_TO_OWNER: "Sahibine iade edildi",
  WARPER: "Devereci",
  BEAM_BODY: "Levent gövdesi",
  // CostComponent (SY-C1): ek maliyet formülü satırı
  FORMULA: "Ek maliyet formülü",
  // PrintedDocType (devere S6): devereci gövde mutabakatı
  BEAM_BODY_STATEMENT: "Gövde mutabakatı",
  // WeaveShedMechanism (2026-11-25) — DOBBY/JACQUARD WeaveDesignKind ile ortak
  CAM: "Eksantrik",
  // WeaveStructure (2026-11-25) — PLAIN/LENO WeaveDesignKind ile, OTHER genel ile ortak
  TWILL: "Dimi",
  SATIN: "Saten",
  // FabricTechnique (2026-11-25) — WOVEN ortak (ITEM.fabricTechnique override'ı "Dokuma")
  KNITTED: "Örme",
};
