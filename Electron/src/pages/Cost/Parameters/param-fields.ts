// Parametre seti alanları — etiket + birim + zorunluluk; backend `cost-parameter.service.ts` NUMERIC_FIELDS aynası.
export const PARAM_FIELDS = [
  { key: "loomHourRateTry", label: "Tezgah saat maliyeti", unit: "TL/sa", required: true, group: "Dokuma" },
  { key: "laborHourRateTry", label: "Operatör saat ücreti", unit: "TL/sa", required: true, group: "Dokuma" },
  { key: "loomsPerOperator", label: "Operatör başına tezgah", unit: "tezgah", required: true, group: "Dokuma" },
  { key: "energyKwhPerLoomHour", label: "Enerji tüketimi", unit: "kWh/tezgah-sa", required: true, group: "Dokuma" },
  { key: "energyPriceTryPerKwh", label: "Elektrik birim fiyatı", unit: "TL/kWh", required: true, group: "Dokuma" },
  { key: "defaultLoomRpm", label: "Varsayılan tezgah devri", unit: "devir/dk", required: false, group: "Dokuma" },
  { key: "defaultEfficiencyPct", label: "Varsayılan randıman", unit: "%", required: true, group: "Dokuma" },
  { key: "defaultTakeUpPct", label: "Varsayılan çözgü çekmesi", unit: "%", required: false, group: "Fire ve çekme" },
  { key: "defaultWarpWastePct", label: "Varsayılan çözgü firesi", unit: "%", required: true, group: "Fire ve çekme" },
  { key: "defaultWeftWastePct", label: "Varsayılan atkı firesi", unit: "%", required: true, group: "Fire ve çekme" },
  { key: "defaultFabricWastePct", label: "Varsayılan kalite firesi", unit: "%", required: true, group: "Fire ve çekme" },
  { key: "weftSelvedgeAllowanceCm", label: "Atkı kenar payı", unit: "cm", required: true, group: "Fire ve çekme" },
  { key: "beamPrepCostTry", label: "Levent hazırlık maliyeti", unit: "TL/levent", required: true, group: "Levent" },
  { key: "defaultBeamLengthM", label: "Varsayılan levent çözgü boyu", unit: "m", required: true, group: "Levent" },
  { key: "overheadPct", label: "Genel gider", unit: "%", required: true, group: "Genel gider ve kâr" },
  { key: "defaultMarkupPct", label: "Varsayılan kâr (maliyet üstü)", unit: "%", required: true, group: "Genel gider ve kâr" },
  { key: "monthlyFinanceRatePct", label: "Aylık vade farkı", unit: "%", required: false, group: "Genel gider ve kâr" },
] as const;

export type ParamKey = (typeof PARAM_FIELDS)[number]["key"];
export const ACTIVATE_CONFIRM_TEXT =
  "Yürürlükteki set SUPERSEDED olur; mevcut standart maliyet sürümleri ve teklifler DEĞİŞMEZ. Kartlarda 'Girdi değişti' rozeti görünecek.";

/** İki setin alan değeri farklı mı — sunucu metinleri sayısal eşitlikle değil METİN olarak normalize edilip karşılaştırılır. */
export function paramDiffers(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : String(v).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));
  return norm(a) !== norm(b);
}
