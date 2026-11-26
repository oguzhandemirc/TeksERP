// Emanet çıkış belgesi örnek payload'ı — Belge Şablonları önizlemesi. İç not örnekte dolu: opt-in kapalıyken
// basılmadığı önizlemede de görülsün. Numaralar seriden ERİŞİMDE türer (literal yazılmaz, D7).
import { previewSeriesCode, resolveSeriesFormat } from "../number-series.service";

const DAY = "2026-06-07T00:00:00.000Z";
const ornekNo = (key: string, seq: number): string => previewSeriesCode(resolveSeriesFormat(key), seq, new Date(DAY));

export const SAMPLE_CONSIGNMENT_DISPATCH: Record<string, unknown> = {
  header: {
    get documentNo() { return ornekNo("consignmentDispatch", 3); },
    dispatchedAt: "2026-06-07T09:30:00.000Z",
    ownerName: "Örnek Tekstil A.Ş.",
    ownerCode: "MUS-014",
    plateNumber: "34 ABC 123",
    driverName: "Ali Veli",
    notes: "Kalan iki levent hafta içi",
  },
  get lines() {
    return [
      { seq: 1, kind: "WARP_BEAM", itemText: "Tül 300 çözgü", get refNo() { return ornekNo("warpBeam", 12); }, qty: 1850.5, unit: "m" },
      { seq: 2, kind: "WARP_BEAM", itemText: "Tül 300 çözgü", get refNo() { return ornekNo("warpBeam", 13); }, qty: 1720, unit: "m" },
      { seq: 3, kind: "YARN", itemText: "IP-075 — 75 den polyester", refNo: "L-2406-07", qty: 412.35, unit: "kg" },
    ];
  },
  totals: { beamCount: 2, beamLengthM: 3570.5, yarnKg: 412.35 },
};
