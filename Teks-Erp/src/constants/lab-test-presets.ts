// =============================================================================
// K4P-LAB — "Hazır listeden ekle" lab test türleri (plan §6.1)
// =============================================================================
// Panel önizlemeli, satır seçimli ekler; katalogda aynı `code` varsa satır atlanır (mevcut
// tür ezilmez). Sınırlar BOŞ gelir: müşteri/ürün spesifikasyonu fabrikaya özgüdür, varsayılan
// sınır uydurmak yanlış "geçti" üretir.
// =============================================================================
import type { LabResultKind } from "@prisma/client";

export interface LabTestPreset {
  code: string;
  name: string;
  method: string | null;
  resultKind: LabResultKind;
  scaleMax: number | null;
  unit: string | null;
  sortOrder: number;
}

export const LAB_TEST_PRESETS: readonly LabTestPreset[] = [
  { code: "GSM", name: "Gramaj", method: "ISO 3801", resultKind: "NUMERIC", scaleMax: null, unit: "g/m²", sortOrder: 10 },
  { code: "WIDTH", name: "En", method: "ISO 22198", resultKind: "NUMERIC", scaleMax: null, unit: "cm", sortOrder: 20 },
  { code: "WASH_FAST", name: "Yıkama haslığı", method: "ISO 105-C06", resultKind: "SCALE", scaleMax: 5, unit: null, sortOrder: 30 },
  { code: "RUB_DRY", name: "Sürtme haslığı (kuru)", method: "ISO 105-X12", resultKind: "SCALE", scaleMax: 5, unit: null, sortOrder: 40 },
  { code: "RUB_WET", name: "Sürtme haslığı (yaş)", method: "ISO 105-X12", resultKind: "SCALE", scaleMax: 5, unit: null, sortOrder: 50 },
  { code: "LIGHT_FAST", name: "Işık haslığı", method: "ISO 105-B02", resultKind: "SCALE", scaleMax: 8, unit: null, sortOrder: 60 },
  { code: "TENSILE", name: "Kopma mukavemeti", method: "ISO 13934-1", resultKind: "NUMERIC", scaleMax: null, unit: "N", sortOrder: 70 },
  { code: "DIM_CHANGE", name: "Boyutsal değişim", method: "ISO 5077", resultKind: "NUMERIC", scaleMax: null, unit: "%", sortOrder: 80 },
  { code: "PILLING", name: "Boncuklanma", method: "ISO 12945-2", resultKind: "SCALE", scaleMax: 5, unit: null, sortOrder: 90 },
  { code: "FLAME", name: "Yanmazlık", method: "EN 13773 / NFPA 701", resultKind: "PASS_FAIL", scaleMax: null, unit: null, sortOrder: 100 },
];
