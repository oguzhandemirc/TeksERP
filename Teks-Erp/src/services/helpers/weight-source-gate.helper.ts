// =============================================================================
// KG KAYNAĞI KAPISI — çuval tartısı ve tambur kesimi için TEK boğaz (2026-11-10).
// =============================================================================
// Beyan (SCALE | MANUAL | SIMULATED) sunucuda ÇÖZÜLÜR: oturumun kantarı `simulate` ise beyan ne olursa
// olsun SIMULATED sayılır (istemci yalanına kapalı); SIMULATED + `shipping.simulatedWeightEnabled` kapalı
// → 400 `SIMULATED_WEIGHT_DISABLED`. MANUAL muaftır (kantarsız/arızalı durumun kaçış yolu). Kolona
// çözülmüş kaynak yazılır. `simulatedWeightEnabled` okuyan yazım yolu yalnız burası (AST bekçisi).
// =============================================================================
import { SackWeightSource } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import { readSimulatedWeightEnabled } from "../system-setting.service";

export interface WeightSourceStamp {
  machineId?: string | null;
  stationId?: string | null;
}

/** Beyan edilen kaynağı çözer; reddedilecekse 400 atar. Dönen değer kolona yazılır. */
export async function resolveWeightSource(
  declared: SackWeightSource,
  stamp?: WeightSourceStamp | null,
  manualHint = "kg'yi elle girin",
): Promise<SackWeightSource> {
  if (declared === SackWeightSource.MANUAL) return SackWeightSource.MANUAL;
  let simulated = declared === SackWeightSource.SIMULATED;
  if (!simulated && (stamp?.machineId || stamp?.stationId)) {
    const scale = await prisma.peripheralDevice.findFirst({
      where: {
        kind: "SCALE",
        isActive: true,
        deletedAt: null,
        ...(stamp.machineId ? { machineId: stamp.machineId } : { stationId: stamp.stationId!, machineId: null }),
      },
      orderBy: { createdAt: "asc" },
      select: { simulate: true },
    });
    if (scale?.simulate) simulated = true;
  }
  if (simulated && !(await readSimulatedWeightEnabled())) {
    throw AppError.badRequest(
      `Simüle kantarla tartı kaydedilemez — ${ekranYolu("donanim")} ekranındaki Cihaz Kaydı'ndan bu kantarın ` +
        `"simülasyon" bayrağını kapatın, ya da ${manualHint}.`,
      { code: "SIMULATED_WEIGHT_DISABLED" },
    );
  }
  return simulated ? SackWeightSource.SIMULATED : declared;
}
