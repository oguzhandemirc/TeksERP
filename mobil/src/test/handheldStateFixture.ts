// Test yardımcısı: sözleşme A2 biçiminde `HandheldLoadState` üretir (başka testler içe aktarır).
import type { HandheldLoadState, HandheldRoll, HandheldSack } from '../services/handheldShipment.service';

export function roll(id: string, over: Partial<HandheldRoll> = {}): HandheldRoll {
  return { id, barcode: `T-${id}`, itemName: 'Poplin', colorName: 'Beyaz', meters: 50, weightKg: 10, readinessClass: 'READY', status: 'READY', ...over };
}

export function sack(id: string, rolls: HandheldRoll[], over: Partial<HandheldSack> = {}): HandheldSack {
  return {
    id,
    sackNo: `ÇV-${id}`,
    seq: null,
    seqLabel: null,
    weightKg: null,
    weightSource: null,
    rollKgSum: rolls.length ? rolls.reduce((t, r) => t + (r.weightKg ?? 0), 0) : null,
    rollKgMissing: 0,
    meters: rolls.reduce((t, r) => t + r.meters, 0),
    labelDirty: false,
    rolls,
    ...over,
  };
}

export function loadState(p: { sacks?: HandheldSack[]; loose?: HandheldRoll[]; status?: 'PLANNED' | 'DISPATCHED'; documentNo?: string | null } = {}): HandheldLoadState {
  const sacks = p.sacks ?? [];
  const loose = p.loose ?? [];
  const all = [...sacks.flatMap((s) => s.rolls), ...loose];
  return {
    shipment: {
      id: 'sh1',
      shipmentNo: 'SVK-1',
      status: p.status ?? 'PLANNED',
      customer: { id: 'c1', name: 'HH Tekstil' },
      branch: null,
      createdAt: '2026-11-11T08:00:00.000Z',
      dispatchedAt: p.status === 'DISPATCHED' ? '2026-11-11T09:00:00.000Z' : null,
      plateNumber: null,
      driverName: null,
      documentNo: p.documentNo ?? null,
    },
    sacks,
    loose: { unitId: loose.length ? 'bulk1' : null, rolls: loose },
    summary: {
      sackCount: sacks.length,
      nonEmptySackCount: sacks.filter((s) => s.rolls.length > 0).length,
      rollCount: all.length,
      looseRollCount: loose.length,
      meters: all.reduce((t, r) => t + r.meters, 0),
      kg: all.length ? all.reduce((t, r) => t + (r.weightKg ?? 0), 0) : null,
      kgMissing: 0,
    },
  };
}

