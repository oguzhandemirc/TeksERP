// =============================================================================
// DEVERE SAR FORMU ÖN-DOLGU — çözgü kartı başına SON IN_HOUSE sarım (Z5/E6) — yalnız ÖNERİ
// =============================================================================
// Ayrı dosya: iplik defterine (`yarnMovement`) dokunur; yalnız `warp-beam-tablet.service` (devere + iplik rejim kapısı
// arkasında) okur. `tablet-prefill.helper`a konsaydı doff/koşum route'ları kapısız iplik dokunuşu sayılırdı.
// =============================================================================
import { WarpBeamOrigin, YarnMovementKind, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export interface LastWindDefault {
  warpSpecId: string;
  machineId: string | null;
  yarnIssues: Array<{ warehouseId: string; lotId: string | null; qtyKg: number }>;
  yarnReturns: Array<{ warehouseId: string; lotId: string | null; qtyKg: number; reasonCode: string }>;
}

/** Çözgü kartı başına son IN_HOUSE sarımın satırları — iki sorgu (WOUND olayları, sonra iplik hareketleri), N+1 yok.
 *  Makine WOUND olayındadır (`WarpBeam`de makine kolonu yok — IN_HOUSE'da `WOUND.machineId` dolu, şema notu). */
export async function lastWindDefaults(db: Db, warpSpecIds: readonly string[]): Promise<LastWindDefault[]> {
  if (warpSpecIds.length === 0) return [];
  const wounds = await db.warpBeamEvent.findMany({
    where: { kind: "WOUND", beam: { warpSpecId: { in: [...warpSpecIds] }, originKind: WarpBeamOrigin.IN_HOUSE, status: { notIn: ["PLANNED", "CANCELLED"] } } },
    orderBy: { createdAt: "desc" },
    select: { beamId: true, machineId: true, beam: { select: { warpSpecId: true } } },
    take: warpSpecIds.length * 4,
  });
  const lastBySpec = new Map<string, { warpBeamId: string; machineId: string | null; warpSpecId: string }>();
  for (const w of wounds) {
    const spec = w.beam.warpSpecId;
    if (!lastBySpec.has(spec)) lastBySpec.set(spec, { warpBeamId: w.beamId, machineId: w.machineId, warpSpecId: spec });
  }
  const picked = [...lastBySpec.values()];
  if (picked.length === 0) return [];
  const moves = await db.yarnMovement.findMany({
    where: { warpBeamId: { in: picked.map((b) => b.warpBeamId) }, kind: { in: [YarnMovementKind.WARP_ISSUE, YarnMovementKind.WARP_RETURN] } },
    orderBy: { createdAt: "asc" },
    select: { warpBeamId: true, kind: true, warehouseId: true, lotId: true, qtyKg: true, reasonCode: true },
  });
  return picked.map((b) => {
    const mine = moves.filter((m) => m.warpBeamId === b.warpBeamId);
    return {
      warpSpecId: b.warpSpecId,
      machineId: b.machineId,
      yarnIssues: mine.filter((m) => m.kind === YarnMovementKind.WARP_ISSUE).map((m) => ({ warehouseId: m.warehouseId, lotId: m.lotId, qtyKg: Number(m.qtyKg) })),
      yarnReturns: mine.filter((m) => m.kind === YarnMovementKind.WARP_RETURN).map((m) => ({ warehouseId: m.warehouseId, lotId: m.lotId, qtyKg: Number(m.qtyKg), reasonCode: m.reasonCode ?? "" })),
    };
  });
}

