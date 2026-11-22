// Gövde mutabakatı (devere S6) örnek payload'ı — Belge Şablonları önizlemesi. İç not örnekte dolu: opt-in kapalıyken
// basılmadığı önizlemede de görülsün. Numaralar seriden ERİŞİMDE türer (literal yazılmaz, D7).
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";

const DAY = "2026-06-07T00:00:00.000Z";
const ornekNo = (key: string, seq: number): string => previewSeriesCode(resolveSeriesFormat(key), seq, new Date(DAY));

export const SAMPLE_BEAM_BODY_STATEMENT: Record<string, unknown> = {
  header: {
    documentNo: "DEV-01",
    subcontractorName: "Örnek Devere Ltd.",
    subcontractorCode: "DEV-01",
    asOf: DAY,
    periodFrom: "2026-05-09T00:00:00.000Z",
    periodDays: 30,
  },
  get bodies() {
    return [
      { seq: 1, get bodyNo() { return ornekNo("beamBody", 3); }, stateText: "Boş", ownerText: "Bizim", sinceAt: "2026-05-20T08:00:00.000Z", ageDays: 18, notes: "Flanş çizik" },
      { seq: 2, get bodyNo() { return ornekNo("beamBody", 7); }, stateText: "Boş", ownerText: "Örnek Devere Ltd.", sinceAt: "2026-06-01T08:00:00.000Z", ageDays: 6, notes: null },
      { seq: 3, get bodyNo() { return ornekNo("beamBody", 9); }, get stateText() { return `Dolu — ${ornekNo("warpBeam", 12)}`; }, ownerText: "Bizim", sinceAt: "2026-06-05T08:00:00.000Z", ageDays: 2, notes: null },
    ];
  },
  get moves() {
    return [
      { seq: 1, at: "2026-05-20T08:00:00.000Z", get bodyNo() { return ornekNo("beamBody", 3); }, direction: "SENT", kindLabel: "Boş gönderildi", get documentNo() { return ornekNo("subcontractorDispatch", 41); } },
      { seq: 2, at: "2026-05-28T08:00:00.000Z", get bodyNo() { return ornekNo("beamBody", 5); }, direction: "RETURNED", kindLabel: "Dolu döndü", get documentNo() { return ornekNo("warpBeam", 11); } },
      { seq: 3, at: "2026-06-05T08:00:00.000Z", get bodyNo() { return ornekNo("beamBody", 9); }, direction: "SENT", kindLabel: "Dolu gönderildi", get documentNo() { return ornekNo("warpBeam", 12); } },
    ];
  },
  totals: { bodies: 3, ours: 2, others: 1, full: 1, sent: 2, returned: 1 },
};
