// =============================================================================
// LEVENT YARDIMCILARI — DTO seçimi · levent numarası (8029 kod-kapsam kilidi) · köken XOR kapısı
// =============================================================================
import { Prisma, WarpBeamOrigin } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { formatSeriesCode, resolveSeriesFormat, seriesPrefix, seriesSeqFrom } from "../number-series.service";
import { lockCodeScopeTx } from "./code-unique.helper";
import { warpBeamLengthSign, type WarpBeamEventKind } from "../../constants/warp-beam";

export const WARP_BEAM_PREFIX = "LV";
const WARP_BEAM_CODE_SCOPE = "warpBeam";

export const WARP_BEAM_EVENT_SELECT = {
  id: true,
  kind: true,
  reversesEventId: true,
  fromStatus: true,
  toStatus: true,
  lengthM: true,
  machineId: true,
  endsCount: true,
  denier: true,
  theoreticalKg: true,
  kgSource: true,
  sectionCount: true,
  endsPerSection: true,
  breakCount: true,
  startedAt: true,
  reasonCode: true,
  reason: true,
  createdById: true,
  createdAt: true,
  // Faz 3 (tezgah bağı / tüketim)
  mountPosition: true,
  beamRole: true,
  mountMethod: true,
  setupStartedAt: true,
  setupMinutes: true,
  machineCounter: true,
  lengthSource: true,
  grossKg: true,
  tareKg: true,
  fabricLengthM: true,
  clientToken: true,
  rollId: true,
  roll: { select: { id: true, barcode: true } },
  machine: { select: { id: true, code: true, name: true } },
} satisfies Prisma.WarpBeamEventSelect;

export const WARP_BEAM_SELECT = {
  id: true,
  beamNo: true,
  warpSpecId: true,
  status: true,
  plannedLengthM: true,
  physicalBeamNo: true,
  notes: true,
  originKind: true,
  subcontractorId: true,
  supplierId: true,
  ownerCustomerId: true,
  ownerCustomer: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
  warpSpec: { select: { id: true, code: true, name: true, endsCount: true, yarnItem: { select: { id: true, code: true, name: true, linearDensityDen: true } } } },
  subcontractor: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  // Z1 (Y2): bu levent hangi dokuma işi için — opsiyonel.
  weavingOrderId: true,
  weavingOrder: { select: { id: true, weavingOrderNumber: true } },
  // Faz 3: "şu an nerede" — yalnız MOUNTED'da dolu.
  currentMachineId: true,
  currentPosition: true,
  setKey: true,
  currentMachine: { select: { id: true, code: true, name: true } },
  // Listede "gerçek metre / kg" WOUND satırından okunur (bir levent bir kez doğar — partial unique).
  events: { where: { kind: "WOUND" }, select: WARP_BEAM_EVENT_SELECT, take: 1 },
  // Faz 2 (lot): liste satırındaki lot özeti — yalnız lotlu çıkış satırlarının lotNo'su (allowlist: id/lotNo dışı gitmez).
  yarnMovements: { where: { kind: "WARP_ISSUE", lotId: { not: null } }, select: { lot: { select: { id: true, lotNo: true } } } },
} satisfies Prisma.WarpBeamSelect;

export type WarpBeamRow = Prisma.WarpBeamGetPayload<{ select: typeof WARP_BEAM_SELECT }>;
export type WarpBeamEventRow = Prisma.WarpBeamEventGetPayload<{ select: typeof WARP_BEAM_EVENT_SELECT }>;

/** Sıradaki levent numarası — 8029 kilidi bu fonksiyonun İLK ifadesidir (`nextDoffCodeTx` emsali). */
export async function nextBeamNoTx(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const fmt = resolveSeriesFormat("warpBeam");
  const prefix = seriesPrefix(fmt, date);
  await lockCodeScopeTx(tx, WARP_BEAM_CODE_SCOPE, prefix);
  const codes = await tx.warpBeam.findMany({ where: { beamNo: { gte: prefix, startsWith: prefix } }, select: { beamNo: true } });
  return formatSeriesCode(fmt, seriesSeqFrom(fmt, codes.map((c) => c.beamNo), prefix), date);
}

export interface OriginParty {
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  /** G3 emanet: MÜLKİYET ekseni — CONSIGNED'da ZORUNLU, öteki kökenlerde serbest (kalıtımla da dolabilir). */
  ownerCustomerId?: string | null;
}

/**
 * KÖKEN XOR'u — TEK KAPI (Türkçe mesaj burada; DB CHECK `warp_beams_origin_party_ck` ikinci hat):
 *   IN_HOUSE → taraf yok · SUBCONTRACT → yalnız fasoncu · PURCHASED → tedarikçi XOR fasoncu, TAM BİRİ ·
 *   CONSIGNED (G3) → yalnız `ownerCustomerId` (müşterinin emanet leventi; mal bizim değil, alış değil).
 *   Mülkiyet köken ekseninden bağımsızdır: öteki kökenlerde `ownerCustomerId` AYNEN geçer (dolu ya da boş).
 */
export function resolveOriginParty(p: OriginParty): Required<OriginParty> {
  const sub = p.subcontractorId || null;
  const sup = p.supplierId || null;
  const owner = p.ownerCustomerId || null;
  switch (p.originKind) {
    case WarpBeamOrigin.CONSIGNED:
      if (!owner) throw AppError.badRequest("Emanet (müşterinin) leventi için sahibi olan müşteri zorunludur.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      if (sub || sup) throw AppError.badRequest("Emanet levente fasoncu/tedarikçi yazılmaz — taraf malın sahibi olan müşteridir.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      return { originKind: p.originKind, subcontractorId: null, supplierId: null, ownerCustomerId: owner };
    case WarpBeamOrigin.IN_HOUSE:
      if (sub || sup) throw AppError.badRequest("İçeride sarılan levente karşı taraf yazılmaz (fasoncu/tedarikçi boş kalır).", { code: "WARP_BEAM_ORIGIN_PARTY" });
      return { originKind: p.originKind, subcontractorId: null, supplierId: null, ownerCustomerId: owner };
    case WarpBeamOrigin.SUBCONTRACT:
      if (!sub) throw AppError.badRequest("Fasona sardırılan levent için fasoncu zorunludur.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      if (sup) throw AppError.badRequest("Fasona sardırılan levente tedarikçi yazılmaz — taraf fasoncudur.", { code: "WARP_BEAM_ORIGIN_PARTY" });
      return { originKind: p.originKind, subcontractorId: sub, supplierId: null, ownerCustomerId: owner };
    case WarpBeamOrigin.PURCHASED:
      if ((sub === null) === (sup === null)) {
        throw AppError.badRequest("Hazır alınan levent için TAM BİR taraf seçilir: tedarikçi (cari) YA DA fasoncu (kendi ipliğiyle saran devereci).", { code: "WARP_BEAM_ORIGIN_PARTY" });
      }
      return { originKind: p.originKind, subcontractorId: sub, supplierId: sup, ownerCustomerId: owner };
  }
}

/** Kalan metre — tek kaynak işaret tablosu (`warpBeamLengthSign`); iptal edilmiş leventte 0, fasondayken 0. */
export function warpBeamRemainingM(events: Array<{ kind: string; lengthM: Prisma.Decimal | null }>): number {
  let acc = new Prisma.Decimal(0);
  for (const e of events) {
    if (!e.lengthM) continue;
    acc = acc.plus(new Prisma.Decimal(e.lengthM).mul(warpBeamLengthSign(e.kind as WarpBeamEventKind)));
  }
  return Number(acc);
}

/**
 * Sayfadaki leventlerin kalan metresi TÜM olaylardan (F1: fasona giden/dönen levent WOUND metresini
 * taşımaz — `SHIP_OUT` düşer, `RETURNED_IN` ekler). Tek sorgu, sayfa başına.
 */
export async function remainingByBeam(client: Prisma.TransactionClient | { warpBeamEvent: Prisma.TransactionClient["warpBeamEvent"] }, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const events = await client.warpBeamEvent.findMany({ where: { beamId: { in: ids } }, select: { beamId: true, kind: true, lengthM: true } });
  const byBeam = new Map<string, Array<{ kind: string; lengthM: Prisma.Decimal | null }>>();
  for (const e of events) {
    const arr = byBeam.get(e.beamId) ?? [];
    arr.push(e);
    byBeam.set(e.beamId, arr);
  }
  for (const id of ids) out.set(id, warpBeamRemainingM(byBeam.get(id) ?? []));
  return out;
}
