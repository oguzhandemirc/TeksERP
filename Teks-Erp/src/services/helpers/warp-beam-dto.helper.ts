// =============================================================================
// TeksERP — Levent DTO'ları ve eşleyicileri (liste/detay/Faz 3 uçları ortak)
// =============================================================================
import { Prisma, WarpBeamStatus, type WarpBeamMountMethod, type WarpBeamOrigin, type WarpKgSource, type WarpLengthSource } from "@prisma/client";
import { warpBeamRemainingM, type WarpBeamEventRow, type WarpBeamRow } from "./warp-beam.helper";

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));

export interface WarpBeamEventDto {
  id: string;
  kind: string;
  reversesEventId: string | null;
  fromStatus: WarpBeamStatus;
  toStatus: WarpBeamStatus;
  lengthM: number | null;
  machine: { id: string; code: string; name: string } | null;
  endsCount: number | null;
  denier: number | null;
  theoreticalKg: number | null;
  kgSource: WarpKgSource | null;
  sectionCount: number | null;
  endsPerSection: number | null;
  breakCount: number | null;
  startedAt: Date | null;
  reasonCode: string | null;
  reason: string | null;
  createdAt: Date;
  /** Faz 3 — tezgah bağı ve ölçüm izi (mount ailesi / tüketim / bitiş). */
  mountPosition: number | null;
  beamRole: string | null;
  mountMethod: WarpBeamMountMethod | null;
  setupStartedAt: Date | null;
  setupMinutes: number | null;
  machineCounter: number | null;
  lengthSource: WarpLengthSource | null;
  grossKg: number | null;
  tareKg: number | null;
  fabricLengthM: number | null;
  /** Faz 4: otomatik tüketim hangi toptan (CONSUMED.rollId) — elle tüketimde null. */
  roll: { id: string; barcode: string | null } | null;
}

export interface WarpBeamDto {
  id: string;
  beamNo: string;
  warpSpecId: string;
  status: WarpBeamStatus;
  plannedLengthM: number;
  physicalBeamNo: string | null;
  notes: string | null;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  createdAt: Date;
  updatedAt: Date;
  warpSpec: { id: string; code: string; name: string; endsCount: number; yarnItem: { id: string; code: string; name: string; linearDensityDen: number | null } };
  subcontractor: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  /** WOUND satırı (bir levent bir kez doğar); PLANNED/CANCELLED'da null olabilir. */
  wound: WarpBeamEventDto | null;
  /** Σ işaret × lengthM — Faz 1b'de WOUND − WOUND_CANCEL. */
  remainingM: number;
  /** Faz 2: bu levente yüklenen iplik lotları (lotNo, tekil, sıralı) — lotsuz sarılan levent boş dizi. */
  lots: string[];
  /** Faz 3: "şu an ne" — yalnız MOUNTED'da dolu (CHECK `warp_beams_mounted_ck`). */
  currentMachineId: string | null;
  currentPosition: number | null;
  currentMachine: { id: string; code: string; name: string } | null;
  /** Raşel takımı (#23): birlikte doğan leventlerin ortak anahtarı; tek levent null. */
  setKey: string | null;
}

export function toWarpBeamEventDto(e: WarpBeamEventRow): WarpBeamEventDto {
  return {
    id: e.id,
    kind: e.kind,
    reversesEventId: e.reversesEventId,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    lengthM: num(e.lengthM),
    machine: e.machine,
    endsCount: e.endsCount,
    denier: num(e.denier),
    theoreticalKg: num(e.theoreticalKg),
    kgSource: e.kgSource,
    sectionCount: e.sectionCount,
    endsPerSection: e.endsPerSection,
    breakCount: e.breakCount,
    startedAt: e.startedAt,
    reasonCode: e.reasonCode,
    reason: e.reason,
    createdAt: e.createdAt,
    mountPosition: e.mountPosition,
    beamRole: e.beamRole,
    mountMethod: e.mountMethod,
    setupStartedAt: e.setupStartedAt,
    setupMinutes: e.setupMinutes,
    machineCounter: num(e.machineCounter),
    lengthSource: e.lengthSource,
    grossKg: num(e.grossKg),
    tareKg: num(e.tareKg),
    fabricLengthM: num(e.fabricLengthM),
    roll: e.roll,
  };
}

export function toWarpBeamDto(r: WarpBeamRow, remainingM?: number): WarpBeamDto {
  const wound = r.events[0] ?? null;
  return {
    id: r.id,
    beamNo: r.beamNo,
    warpSpecId: r.warpSpecId,
    status: r.status,
    plannedLengthM: Number(r.plannedLengthM),
    physicalBeamNo: r.physicalBeamNo,
    notes: r.notes,
    originKind: r.originKind,
    subcontractorId: r.subcontractorId,
    supplierId: r.supplierId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    warpSpec: { ...r.warpSpec, yarnItem: { ...r.warpSpec.yarnItem, linearDensityDen: num(r.warpSpec.yarnItem.linearDensityDen) } },
    subcontractor: r.subcontractor,
    supplier: r.supplier,
    wound: wound ? toWarpBeamEventDto(wound) : null,
    // Listede WOUND tek satırdır; iptalde CANCELLED durumu kalanı 0 yapar (WOUND_CANCEL listeye çekilmez).
    remainingM: remainingM ?? (r.status === WarpBeamStatus.READY && wound?.lengthM ? Number(wound.lengthM) : 0),
    lots: [...new Set(r.yarnMovements.map((m) => m.lot?.lotNo).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "tr")),
    currentMachineId: r.currentMachineId,
    currentPosition: r.currentPosition,
    currentMachine: r.currentMachine,
    setKey: r.setKey,
  };
}
