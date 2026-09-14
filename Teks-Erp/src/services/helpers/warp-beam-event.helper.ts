// =============================================================================
// LEVENT DEFTERİ TEK YAZICISI — olay satırı + durum kolonu AYNI tx'te (devere 1b · fason F1)
// =============================================================================
// Ayrı dosya, çünkü çağıranların import zinciri ayrışır: sarım (`warp-beam-wind.service`) iplik
// defterine de yazar; fason dörtlüsü (`subcontractor-beam.service`) yazmaz ve fason router'ı iplik
// modeline ulaşmamalıdır (`test_iplik_regime_gate §2` geçişli import zincirini ölçer).
// İlk ifade devere kapısı (`applyYarnMovementTx`in iplik kapısı emsali); claim `updateMany WHERE status=from`.
// Audit'in EVİ de burası: satırı yazan her eylem (sarım · sarım iptali · fason çıkış/dönüş/stornolar) tx DIŞINDA
// `logWarpBeamEventAudit` çağırır — tablo adı ve yük şekli tek yerde, dört yazım noktası kopya taşımaz.
// =============================================================================
import { Prisma, WarpBeamStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { readDevereEnabled } from "../system-setting.service";
import type { WarpBeamEventKind } from "../../constants/warp-beam";
import { WARP_BEAM_EVENT_SELECT, type WarpBeamEventRow } from "./warp-beam.helper";

export const WARP_BEAM_EVENT_TABLE = "WARP_BEAM_EVENT";

/** Levent defteri audit'i — best-effort, tx DIŞINDA çağrılır (kök kuralı); ileri satır CREATE, ters satır UPDATE. */
export async function logWarpBeamEventAudit(input: { userId?: string; eventId: string; kind: WarpBeamEventKind; data: Record<string, unknown> }): Promise<void> {
  await AuditService.log({
    userId: input.userId,
    action: input.kind.endsWith("_CANCEL") ? "UPDATE" : "CREATE",
    tableName: WARP_BEAM_EVENT_TABLE,
    recordId: input.eventId,
    newData: { kind: input.kind, ...input.data },
  });
}

export async function applyWarpBeamEventTx(
  tx: Prisma.TransactionClient,
  input: {
    beamId: string;
    kind: WarpBeamEventKind;
    from: WarpBeamStatus;
    to: WarpBeamStatus;
    data: Omit<Prisma.WarpBeamEventUncheckedCreateInput, "beamId" | "kind" | "fromStatus" | "toStatus">;
    /** Faz 3: durum kolonları OLAYLA AYNI claim ifadesinde yazılır/temizlenir (§9.6). Verilmezse dokunulmaz. */
    place?: { currentMachineId: string | null; currentPosition: number | null };
    /** Faz 3: claim yalnız `from` değil, bağlı makineyi de kilitler (söküm/tüketim yanlış makineden yazılmasın). */
    whereMachineId?: string | null;
  },
): Promise<WarpBeamEventRow> {
  if (!(await readDevereEnabled(tx))) {
    throw AppError.forbidden("Devere modülü bu kurulumda kapalı — levent defterine yazılamaz. Sistem → Modüller bölümünden açılabilir.", { code: "MODULE_DISABLED", modul: "devere" });
  }
  const claim = await tx.warpBeam.updateMany({
    where: { id: input.beamId, status: input.from, ...(input.whereMachineId !== undefined ? { currentMachineId: input.whereMachineId } : {}) },
    data: { status: input.to, ...(input.place ?? {}) },
  });
  if (claim.count === 0) {
    const fresh = await tx.warpBeam.findUnique({ where: { id: input.beamId }, select: { status: true, beamNo: true } });
    if (!fresh) throw AppError.notFound("Levent bulunamadı");
    throw AppError.conflict(`${fresh.beamNo} durumu ${fresh.status} — bu işlem yalnız ${input.from} durumunda yapılır`, { code: "WARP_BEAM_STATE", status: fresh.status });
  }
  return tx.warpBeamEvent.create({ data: { beamId: input.beamId, kind: input.kind, fromStatus: input.from, toStatus: input.to, ...input.data }, select: WARP_BEAM_EVENT_SELECT });
}
