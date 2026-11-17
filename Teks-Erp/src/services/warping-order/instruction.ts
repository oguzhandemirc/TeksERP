// =============================================================================
// ÇÖZGÜ TALİMATI — devereciye irsaliyeyle giden blok verisi (D4b; basım panelde D6)
// =============================================================================
// Müşteri belgesinde iç kolon OPT-IN: fire, maliyet, ücret, plan kg'ı BASILMAZ — devereci yalnız ne saracağını görür:
// kart(lar), iplik başına harf + tel + denye, dizilim notu, tarak, levent adedi × boy, termin, not.
// =============================================================================
import type { WarpingOrderDto } from "./read";

export interface WarpingInstruction {
  orderNo: string;
  subcontractor: { code: string; name: string };
  warpSpec: { code: string; name: string };
  /** Aynı levente sarılan ek tel grubu kartları. */
  extraSpecs: Array<{ code: string; name: string }>;
  totalEnds: number;
  yarns: Array<{ letter: string; code: string; name: string; endsCount: number; denier: string }>;
  sequenceNote: string | null;
  reed: { reedNo: string | null; reedWidthCm: string | null; endsPerDent: number | null } | null;
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  beamCount: number;
  targetLengthM: string;
  expectedReturnAt: string | null;
  notes: string | null;
}

/** Saf: sipariş DTO'sundan talimat bloğu (tek yer — sevk yanıtı ve talimat ucu aynı fonksiyon). */
export function buildWarpingInstruction(o: WarpingOrderDto): WarpingInstruction {
  const r = o.warpSpec;
  const hasReed = r.reedNo !== null || r.reedWidthCm !== null || r.endsPerDent !== null;
  return {
    orderNo: o.orderNo,
    subcontractor: { code: o.subcontractor.code, name: o.subcontractor.name },
    warpSpec: { code: r.code, name: r.name },
    extraSpecs: o.extraSpecs.map((e) => ({ code: e.code, name: e.name })),
    totalEnds: o.totals.endsCount,
    yarns: o.yarns.map((y) => ({ letter: y.letter, code: y.code, name: y.name, endsCount: y.endsCount, denier: y.denier })),
    sequenceNote: r.sequenceNote,
    reed: hasReed ? { reedNo: r.reedNo, reedWidthCm: r.reedWidthCm, endsPerDent: r.endsPerDent } : null,
    beamLines: o.beamLines,
    beamCount: o.beamCount,
    targetLengthM: o.targetLengthM,
    expectedReturnAt: o.expectedReturnAt,
    notes: o.notes,
  };
}
