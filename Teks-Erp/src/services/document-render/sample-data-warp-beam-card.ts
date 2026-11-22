// Levent kartı (devere S5) örnek payload'ı — Belge Şablonları önizlemesi + tasarımcı senaryoları.
// Levent no seriden türer (getter: istek anında), literal yazılmaz (D7).
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";

const DAY = "2026-06-07T00:00:00.000Z";
const ornekNo = (key: string, seq: number): string => previewSeriesCode(resolveSeriesFormat(key), seq, new Date(DAY));

export const SAMPLE_WARP_BEAM_CARD: Record<string, unknown> = {
  header: {
    get documentNo() { return ornekNo("warpBeam", 12); },
    get beamNo() { return ornekNo("warpBeam", 12); },
    bodyNo: "G-27",
    warpSpecCode: "CZ-TUL-01",
    warpSpecName: "Tül 300 cm çözgü",
    itemName: "Tül Perde 300",
    weavingOrderNumber: "DIE-0042",
    woundAt: "2026-06-07T10:30:00.000Z",
    lengthM: 4200,
    endsCount: 9600,
    theoreticalKg: 74.7,
    weighedNetKg: 75.2,
    ownerName: null,
    subcontractorName: "Örnek Devere Ltd.",
    deliveryNoteNo: "IRS-5521",
    receiveDocNo: "DDK-0007",
    warpingOrderNo: "DS-0019",
    drawingInNote: "1-2-3-4 düz, kenar 2'li, döner 1-2",
  },
  yarns: [
    { seq: 1, yarnCode: "PES-50D/24F", yarnName: "Polyester 50 denye 24 filament", endsCount: 7200, denier: 50, kg: 46.7, lots: "L2406-1, L2406-2" },
    { seq: 2, yarnCode: "PES-30D/12F", yarnName: "Polyester 30 denye 12 filament", endsCount: 2400, denier: 30, kg: 28, lots: null },
  ],
  totals: { endsCount: 9600, kg: 74.7 },
};
