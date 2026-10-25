/**
 * Muayene Raporu örnek belgesi (renderInspectionReportHtml) — geçen, kalan ve
 * muayenesiz top. `sample-data.ts` satır tavanı yüzünden ayrı dosyada; an onunla aynı.
 */
const ISO = "2026-06-07T10:30:00.000Z";

export const SAMPLE_INSPECTION_REPORT: Record<string, unknown> = {
  header: { shipmentId: "00000000-0000-4000-8000-000000000042", shipmentNo: "SVK-2026-0042", customerId: "00000000-0000-4000-8000-000000000001", customerName: "Örnek Tekstil A.Ş.", customerCode: "M001", date: ISO, orderNos: "SIP-2026-0107" },
  rules: [
    { key: "kural-1", name: "Örnek Tekstil — genel", scope: "CUSTOMER", unit: "M2", runningCap: "METER", bands: [{ maxScore: 20, label: "A", accepted: true }, { maxScore: 28, label: "B", accepted: true }, { maxScore: null, label: "RET", accepted: false }] },
  ],
  rows: [
    { sequence: 1, rollId: "r1", barcode: "TR-260607-R0200", itemName: "Pamuklu Astar", colorName: "Bej", meters: 160, inspectionId: "i1", phase: "FINAL", inspectedAt: ISO, widthCm: 150, widthSource: "ITEM_CARD", inspectedLengthM: 160, defectCount: 6, unplacedDefectCount: 0, totalPoints: 14, pointsPer100M2: 5.83, score: 5.83, scoreUnit: "M2", label: "A", accepted: true, result: "PASS", factoryGrade: "1.KALİTE", ruleKey: "kural-1", inspectorName: "Ayşe Yılmaz", stationName: "Kalite Kontrol 1", deviceName: "KK1 Tablet" },
    { sequence: 2, rollId: "r2", barcode: "TR-260607-R0201", itemName: "Pamuklu Astar", colorName: "Bej", meters: 98.5, inspectionId: "i2", phase: "RAW", inspectedAt: ISO, widthCm: 150, widthSource: "ROLL_MEASURED", inspectedLengthM: 98.5, defectCount: 15, unplacedDefectCount: 1, totalPoints: 44, pointsPer100M2: 29.78, score: 29.78, scoreUnit: "M2", label: "RET", accepted: false, result: "FAIL", factoryGrade: "FİRE", ruleKey: "kural-1", inspectorName: "Ayşe Yılmaz", stationName: "Kalite Kontrol 1", deviceName: null },
    { sequence: 3, rollId: "r3", barcode: "TR-260607-R0202", itemName: "Süet Kumaş", colorName: "Antrasit", meters: 60, inspectionId: null, phase: null, inspectedAt: null, widthCm: null, widthSource: null, inspectedLengthM: null, defectCount: null, unplacedDefectCount: null, totalPoints: null, pointsPer100M2: null, score: null, scoreUnit: null, label: null, accepted: null, result: "NONE", factoryGrade: null, ruleKey: null, inspectorName: null, stationName: null, deviceName: null },
  ],
  totals: { rollCount: 3, inspectedCount: 2, uninspectedCount: 1, passCount: 1, failCount: 1, noScoreCount: 0, totalMeters: 318.5, defectCount: 21, totalPoints: 58, unplacedDefectCount: 1, avgPointsPer100M2: 17.81 },
  notes: { unplacedRollCount: 1, widthSources: { ITEM_CARD: 1, ROLL_MEASURED: 1 } },
};
