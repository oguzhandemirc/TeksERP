// =============================================================================
// Z1 — KOŞUM AÇARKEN DOKUMA İŞİ ÖN-DOLGUSU (tablet bağlamı; sunucu OTOMATİK BAĞLAMAZ) (2026-09-18)
// =============================================================================
// Tezgahta takılı levent bir işe bağlıysa (Y2) koşum formu o işi ÖN-DOLDURUR; operatör onaylar ya da tek dokunuşla
// değiştirir (+0 dokunuş kabul ölçütü, spec §6). `POST /machine-runs` gövdesi `weavingOrderId` göndermezse sunucu
// UYDURMAZ — eski istemci bağsız koşum yazmaya devam eder (varsayılan = bugünkü davranış); zorunluluk yalnız
// `dokuma.runWeavingOrderRequired` kapısıyla (production-chain-gates).
// =============================================================================
import type { Prisma } from "@prisma/client";
import { WarpBeamStatus, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

export interface MachineRunTabletContextDto {
  suggestedWeavingOrderId: string | null;
  suggestedFrom: "MOUNTED_BEAM" | null;
  mountedBeam: { id: string; beamNo: string; weavingOrderId: string | null } | null;
  weavingOrders: Array<{
    id: string;
    weavingOrderNumber: string;
    status: WeavingOrderStatus;
    plannedM: number | null;
    item: { id: string; code: string; name: string };
    warpSpec: { id: string; code: string; name: string } | null;
  }>;
}

/** Takılı leventin işi — çok yuvalı tezgahta İŞİ OLAN ilk levent (yuva sırası); hiçbiri bağlı değilse null. */
export async function suggestWeavingOrderForMachineTx(db: Db, machineId: string): Promise<Pick<MachineRunTabletContextDto, "suggestedWeavingOrderId" | "suggestedFrom" | "mountedBeam">> {
  const beams = await db.warpBeam.findMany({
    where: { currentMachineId: machineId, status: WarpBeamStatus.MOUNTED },
    orderBy: [{ currentPosition: "asc" }, { beamNo: "asc" }],
    select: { id: true, beamNo: true, weavingOrderId: true, weavingOrder: { select: { status: true, executionKind: true } } },
  });
  const linked = beams.find((b) => b.weavingOrderId && b.weavingOrder && b.weavingOrder.executionKind === WeavingExecutionKind.IN_HOUSE && (b.weavingOrder.status === WeavingOrderStatus.PLANNED || b.weavingOrder.status === WeavingOrderStatus.IN_PROGRESS));
  const mounted = linked ?? beams[0] ?? null;
  return {
    suggestedWeavingOrderId: linked?.weavingOrderId ?? null,
    suggestedFrom: linked ? "MOUNTED_BEAM" : null,
    mountedBeam: mounted ? { id: mounted.id, beamNo: mounted.beamNo, weavingOrderId: mounted.weavingOrderId } : null,
  };
}

/** Koşuma bağlanabilir açık işler: PLANNED/IN_PROGRESS ∧ IN_HOUSE (kapı `assertWeavingOrderLinkableTx` ile aynı küme). */
export async function listOpenInHouseWeavingOrders(db: Db): Promise<MachineRunTabletContextDto["weavingOrders"]> {
  const rows = await db.weavingOrder.findMany({
    where: { executionKind: WeavingExecutionKind.IN_HOUSE, status: { in: [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS] } },
    orderBy: [{ status: "desc" }, { plannedStartDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: { id: true, weavingOrderNumber: true, status: true, plannedM: true, item: { select: { id: true, code: true, name: true } }, warpSpec: { select: { id: true, code: true, name: true } } },
  });
  return rows.map((r) => ({ ...r, plannedM: r.plannedM === null ? null : Number(r.plannedM) }));
}

export async function machineRunTabletContext(machineId: string, db: Db = prisma): Promise<MachineRunTabletContextDto> {
  const machine = await db.machine.findUnique({ where: { id: machineId }, select: { id: true } });
  if (!machine) throw AppError.notFound("Makine bulunamadı");
  const suggestion = await suggestWeavingOrderForMachineTx(db, machineId);
  return { ...suggestion, weavingOrders: await listOpenInHouseWeavingOrders(db) };
}
