// =============================================================================
// LEVENT İHTİYACI — "Bu kumaş için hangi çözgüden kaç metre gerekir?" (TEK KAYNAK; SY-M2, tasarım §14.5-5)
// =============================================================================
// Gerekli çözgü m = kumaş m ÷ (1 − take-up). Zemin take-up'ı zemin + SHARED_BEAM gruplarının EN HIZLI
// tükeneninden (`fastestGroupTakeUpPct`); SEPARATE_BEAM katmanı kendi leventini ister; CREEL'de levent yok.
// Eksik kalan çözgü için PLANNED levent önerisi levent boyuna YUKARI yuvarlanır. Üretim önerisi ve tezgâh
// önerisi kipi ve metreyi YALNIZ buradan alır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { EffectiveConstruction } from "./effective-construction.helper";
import { fastestGroupTakeUpPct, layerHasOwnBeam, type WarpBeamModeCode } from "./warp-layer-beam.helper";
import type { StockBeam } from "./warp-beam-stock.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface GroundWarpRef {
  id: string;
  code: string;
  takeUpPct: Prisma.Decimal | null;
}

export interface WarpRequirement {
  role: "GROUND" | "LENO" | "SECONDARY";
  /** Zeminde "GROUND"; ek katmanda ürün kartındaki sarım kipi. */
  beamMode: "GROUND" | WarpBeamModeCode;
  warpSpecId: string;
  warpSpecCode: string;
  /** Hesaba giren take-up (%); zeminde en hızlı tükenen grup. Bilinmiyorsa null (çözgü = kumaş sayılır). */
  takeUpPct: number | null;
  /** Kendi leventi var mı (zemin ve SEPARATE_BEAM). SHARED_BEAM zemin leventinde, CREEL'de levent yok. */
  ownBeam: boolean;
  /** Gerekli çözgü metresi; kumaş metresi bilinmiyorsa ya da levent yoksa null. */
  requiredM: number | null;
}

export interface BeamNeed extends WarpRequirement {
  /** READY + MOUNTED leventlerin kalanı (yalnız kendi leventi olan katmanda). */
  availableM: number | null;
  shortfallM: number | null;
  /** Eksik için PLANNED levent önerisi (levent boyuna yukarı yuvarlı); yetiyorsa null. */
  proposedBeams: { count: number; lengthM: number } | null;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Kumaş metresinden çözgü metresi; take-up bilinmiyor/geçersizse kumaş metresi. */
export function warpNeedM(fabricM: number | null, takeUpPct: number | null): number | null {
  if (fabricM == null) return null;
  if (takeUpPct == null || takeUpPct <= 0 || takeUpPct >= 100) return round3(fabricM);
  return round3(fabricM / (1 - takeUpPct / 100));
}

/** Çözgü metresinden dokunabilecek kumaş metresi (`warpNeedM`in tersi, aşağı yuvarlı). */
export function fabricFromWarpM(warpM: number, takeUpPct: number | null): number {
  const k = takeUpPct == null || takeUpPct <= 0 || takeUpPct >= 100 ? 1 : 1 - takeUpPct / 100;
  return Math.floor(warpM * k * 1000) / 1000;
}

const num = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

/**
 * Etkin yapıdan çözgü gereksinimleri: önce zemin, sonra katmanlar kart sırasıyla. Zemin yoksa boş liste.
 * `ground` verilirse (dokuma işinin kendi çözgüsü) yapının zemini yerine o okunur.
 */
export function warpRequirements(c: EffectiveConstruction, ground: GroundWarpRef | null, fabricM: number | null): WarpRequirement[] {
  const g = ground ?? c.groundWarp;
  if (!g) return [];
  const groundTakeUp = num(fastestGroupTakeUpPct(g.takeUpPct, c.warpLayers.map((l) => ({ beamMode: l.beamMode, takeUpPct: l.warpSpec.takeUpPct }))));
  const out: WarpRequirement[] = [{
    role: "GROUND", beamMode: "GROUND", warpSpecId: g.id, warpSpecCode: g.code, takeUpPct: groundTakeUp, ownBeam: true, requiredM: warpNeedM(fabricM, groundTakeUp),
  }];
  for (const l of c.warpLayers) {
    const own = layerHasOwnBeam(l.beamMode);
    const tu = num(l.warpSpec.takeUpPct);
    out.push({
      role: l.role === "LENO" ? "LENO" : "SECONDARY", beamMode: l.beamMode as WarpBeamModeCode, warpSpecId: l.warpSpec.id, warpSpecCode: l.warpSpec.code,
      takeUpPct: tu, ownBeam: own, requiredM: own ? warpNeedM(fabricM, tu) : null,
    });
  }
  return out;
}

/** Çözgü kartı başına READY + MOUNTED kalan toplamı. */
export function availableBySpec(stock: Map<string, StockBeam[]>): Map<string, number> {
  return new Map([...stock].map(([id, beams]) => [id, round3(beams.reduce((s, b) => s + b.remainingM, 0))]));
}

/**
 * Gereksinim + kullanılabilir çözgü → levent ihtiyacı. `available` TAHSİS edilir (aynı kartı isteyen sonraki
 * grup kalanı görür — stok çift sayılmaz). Levent boyu bilinmiyorsa tek levent, eksik metreye yukarı yuvarlı.
 */
export function beamNeeds(reqs: WarpRequirement[], available: Map<string, number>, beamLengthM: number | null): BeamNeed[] {
  return reqs.map((r) => {
    if (!r.ownBeam) return { ...r, availableM: null, shortfallM: null, proposedBeams: null };
    const availableM = available.get(r.warpSpecId) ?? 0;
    if (r.requiredM != null) available.set(r.warpSpecId, round3(Math.max(0, availableM - r.requiredM)));
    const shortfallM = r.requiredM == null ? null : round3(Math.max(0, r.requiredM - availableM));
    let proposedBeams: BeamNeed["proposedBeams"] = null;
    if (shortfallM != null && shortfallM > 0) {
      proposedBeams = beamLengthM && beamLengthM > 0
        ? { count: Math.ceil(shortfallM / beamLengthM), lengthM: beamLengthM }
        : { count: 1, lengthM: Math.ceil(shortfallM) };
    }
    return { ...r, availableM, shortfallM, proposedBeams };
  });
}

/** Ürün başına levent boyu: ürün yapısı → etkin maliyet parametresi (maliyet derleyicisiyle aynı sıra). */
export async function readBeamLengthsM(db: Db, itemIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!itemIds.length) return out;
  const rows = await db.costStructure.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, beamLengthM: true } });
  const param = await db.costParameterSet.findFirst({ where: { status: "ACTIVE" }, select: { defaultBeamLengthM: true } });
  const byItem = new Map(rows.map((r) => [r.itemId, r.beamLengthM]));
  for (const id of itemIds) out.set(id, num(byItem.get(id) ?? param?.defaultBeamLengthM ?? null));
  return out;
}
