// =============================================================================
// TeksERP — Levent TEZGAH BAĞI (devere Faz 3): TAK (MOUNTED) · SÖK (DISMOUNTED) · durum olayı geri al (LIFO)
// =============================================================================
// Tasarım: DEVERE-LEVENT-TARAMASI §4.7 · §7.3 · §9.6. Tek yazar `applyWarpBeamEventTx` (durum
// kolonları `place` ile AYNI claim ifadesinde). Bayrak `devere.mountTracking` KAPALI → 409
// `WARP_MOUNT_TRACKING_OFF` (durum, yetki değil; devere modülü kapalıysa 403 önce).
// Yuva seddi `warp_beams_machine_position_uq` (ikinci hat) + Türkçe ön kontrol. Söküm/bitiş
// açık koşum kapısı `assertDismountAllowedTx` (tezgah yüklemi paylaşılır).
// =============================================================================
import { Prisma, WarpBeamStatus, type WarpBeamMountMethod, type WarpLengthSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { assertWarpBeamEventReplayAlive, tokenReplay } from "./helpers/token-replay.helper";
import { AppError } from "../utils/app-error";
import { p2002Mentions } from "../utils/p2002";
import { ApiResponse } from "../types/api.types";
import { readDevereMountTrackingRequired } from "./system-setting.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "./helpers/warp-beam-event.helper";
import { WARP_BEAM_SELECT } from "./helpers/warp-beam.helper";
import { toWarpBeamDto, type WarpBeamDto } from "./warp-beam.service";
import { WARP_BEAM_CANCEL_OF, type WarpBeamEventKind } from "../constants/warp-beam";
import {
  activeForwardStatusEventTx,
  assertDismountAllowedTx,
  assertMountTrackingOnTx,
  assertSlotFreeTx,
  isStatusEventKind,
  loadLoomMachineTx,
  mountedBeamsOnMachineTx,
} from "./helpers/warp-beam-mount.helper";
import { closeToMeasuredTx, loadBeamTx, readRemainingM, remainingMTx } from "./helpers/warp-beam-ledger.helper";

export interface MountBeamInput {
  machineId: string;
  position: number;
  mountMethod?: WarpBeamMountMethod | null;
  beamRole?: string | null;
  setupStartedAt?: Date | null;
  setupMinutes?: number | null;
  machineCounter?: number | string | null;
  clientToken?: string | null;
}
export interface DismountBeamInput {
  /** Ölçülen kalan (opsiyonel): verilirse fark ÖNCE CONSUMED/ADJUST_IN ile kapanır. */
  remainingM?: number | string | null;
  lengthSource?: WarpLengthSource | null;
  machineCounter?: number | string | null;
  reason?: string | null;
}

export async function freshBeamDto(id: string): Promise<WarpBeamDto> {
  const row = await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: WARP_BEAM_SELECT });
  return toWarpBeamDto(row, Number(await readRemainingM(prisma, id)));
}
const freshDto = freshBeamDto;

/** P2002 yuva seddi yarışı → 409 (Türkçe); başka P2002 aynen. */
function slotRaceTo409(e: unknown, machineCode: string, position: number): never {
  // F61 deseni: constraint adı üç meta kaynağından birinde gelir (`p2002Mentions`), elle `meta.target` okunmaz.
  if (p2002Mentions(e, /machine_position|currentPosition/)) {
    throw AppError.conflict(`${machineCode} makinesinin ${position}. yuvası bu sırada başka bir leventle doldu — listeyi yenileyin.`, { code: "WARP_SLOT_BUSY" });
  }
  throw e;
}

/** Bağlama replay'i (tabletten çift basış): aynı levent + MOUNTED + aynı makine/yuva; geri alınmış bağlama 409. */
const mountReplay = (id: string, input: MountBeamInput) =>
  tokenReplay<{ beamId: string; kind: string; machineId: string | null; mountPosition: number | null; reversal: { id: string } | null }, ApiResponse<WarpBeamDto>>({
    find: (db, clientToken) =>
      db.warpBeamEvent.findUnique({ where: { clientToken }, select: { beamId: true, kind: true, machineId: true, mountPosition: true, reversal: { select: { id: true } } } }),
    alive: (p) => assertWarpBeamEventReplayAlive(p, "bağlama"),
    identity: (p) => [
      { ad: "beamId", mevcut: p.beamId, gelen: id },
      { ad: "kind", mevcut: p.kind, gelen: "MOUNTED" },
      { ad: "machineId", mevcut: p.machineId, gelen: input.machineId },
      { ad: "mountPosition", mevcut: p.mountPosition, gelen: input.position },
    ],
    collision: "Bu form daha önce başka bir bağlama olarak kaydedilmiş (farklı levent, makine ya da yuva) — yeni bağlama için formu kapatıp yeniden açın.",
    respond: async () => ({ success: true, data: await freshDto(id), message: "Bağlama zaten kayıtlı (yeniden gönderim)" }),
  });

/** Levent bağlama (R): token her kuraldan önce okunur, bağlama hangi hatayla düşerse düşsün yeniden okunur. */
export async function mountBeam(id: string, input: MountBeamInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  return mountReplay(id, input).run(input.clientToken, () => mountBeamFresh(id, input, userId));
}

async function mountBeamFresh(id: string, input: MountBeamInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const warnings: string[] = [];
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    if (beam.status !== WarpBeamStatus.READY) throw AppError.conflict(`${beam.beamNo} durumu ${beam.status} — yalnız hazır (READY) levent bağlanır`, { code: "WARP_BEAM_STATE", status: beam.status });
    const machine = await loadLoomMachineTx(tx, input.machineId, input.position);
    if (await readDevereMountTrackingRequired(tx)) {
      if (!input.mountMethod || !input.setupStartedAt) throw AppError.badRequest('Bağlama yöntemi ve başlangıç saati zorunlu (ayar: "Devere — bağlama bilgisi zorunlu").', { code: "WARP_MOUNT_METHOD_REQUIRED" });
    }
    await assertSlotFreeTx(tx, machine.id, input.position, machine.code);
    // Yarım levent (daha önce tüketim görmüş) başka makineye — UYARI, red değil (§4.7).
    const remaining = await remainingMTx(tx, beam.id);
    const wound = await tx.warpBeamEvent.findFirst({ where: { beamId: beam.id, kind: "WOUND", reversal: null }, select: { lengthM: true } });
    if (wound?.lengthM && remaining.lt(wound.lengthM)) warnings.push(`${beam.beamNo} yarım levent (kalan ${remaining} / ${wound.lengthM} m) — başka bir sarımın devamı; uyum (model/en/takım) operatörün sorumluluğunda.`);
    // Yöntem ÖNERİSİ (veri, zorlama değil): bu yuvadan son sökülen levent aynı çözgü kartıysa düğüm.
    const last = await tx.warpBeamEvent.findFirst({ where: { kind: "DISMOUNTED", machineId: machine.id, mountPosition: input.position, reversal: null }, orderBy: { createdAt: "desc" }, select: { beam: { select: { warpSpecId: true } } } });
    if (last && last.beam.warpSpecId === beam.warpSpecId && !input.mountMethod) warnings.push("Bu yuvadan son sökülen levent aynı çözgü kartından — düğüm (tying-in) yöntemi uygun olabilir; beyan sizin.");
    let ev;
    try {
      ev = await applyWarpBeamEventTx(tx, {
        beamId: beam.id,
        kind: "MOUNTED",
        from: WarpBeamStatus.READY,
        to: WarpBeamStatus.MOUNTED,
        place: { currentMachineId: machine.id, currentPosition: input.position },
        data: {
          clientToken: input.clientToken ?? null,
          machineId: machine.id,
          mountPosition: input.position,
          mountMethod: input.mountMethod ?? null,
          beamRole: input.beamRole?.trim() || null,
          setupStartedAt: input.setupStartedAt ?? null,
          setupMinutes: input.setupMinutes ?? null,
          machineCounter: input.machineCounter == null ? null : new Prisma.Decimal(input.machineCounter),
          createdById: userId ?? null,
        },
      });
    } catch (e) {
      slotRaceTo409(e, machine.code, input.position);
    }
    return { ev, machine, beamNo: beam.beamNo };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "MOUNTED", data: { beamId: id, machineId: result.machine.id, position: input.position, mountMethod: input.mountMethod ?? null } });
  return { success: true, data: await freshDto(id), message: `${result.beamNo} → ${result.machine.name} ${input.position}. yuvaya bağlandı`, ...(warnings.length ? { warnings } : {}) };
}

export async function dismountBeam(id: string, input: DismountBeamInput, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    if (beam.status !== WarpBeamStatus.MOUNTED || !beam.currentMachineId) throw AppError.conflict(`${beam.beamNo} tezgahta değil (${beam.status})`, { code: "WARP_BEAM_STATE", status: beam.status });
    const machine = await tx.machine.findUniqueOrThrow({ where: { id: beam.currentMachineId }, select: { id: true, code: true, warpBeamSlots: true } });
    const warnings = await assertDismountAllowedTx(tx, machine, beam.beamNo);
    let closed: { kind: string | null; deltaM: Prisma.Decimal } = { kind: null, deltaM: new Prisma.Decimal(0) };
    if (input.remainingM != null) {
      const measured = new Prisma.Decimal(input.remainingM).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
      if (measured.lt(0)) throw AppError.badRequest("Ölçülen kalan negatif olamaz");
      closed = await closeToMeasuredTx(tx, beam, measured, { lengthSource: input.lengthSource ?? "ESTIMATED", machineCounter: input.machineCounter ?? null, userId, reason: input.reason ?? null });
    }
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: beam.id,
      kind: "DISMOUNTED",
      from: WarpBeamStatus.MOUNTED,
      to: WarpBeamStatus.READY,
      whereMachineId: beam.currentMachineId,
      place: { currentMachineId: null, currentPosition: null },
      // Söküm satırı makine + yuvayı KOPYALAR (DISMOUNT_CANCEL yuvaya geri koyar; rapor penceresi kapanır).
      data: { machineId: beam.currentMachineId, mountPosition: beam.currentPosition, lengthSource: input.lengthSource ?? null, machineCounter: input.machineCounter == null ? null : new Prisma.Decimal(input.machineCounter), reason: input.reason?.trim() || null, createdById: userId ?? null },
    });
    return { ev, beamNo: beam.beamNo, warnings, closed, machineCode: machine.code };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "DISMOUNTED", data: { beamId: id, closed: result.closed.kind, deltaM: Number(result.closed.deltaM) } });
  const kapatma = result.closed.kind ? ` (ölçülen kalana kapatıldı: ${result.closed.kind} ${result.closed.deltaM.abs()} m)` : "";
  return { success: true, data: await freshDto(id), message: `${result.beamNo} ${result.machineCode} makinesinden söküldü — hazır stoğa döndü${kapatma}`, ...(result.warnings.length ? { warnings: result.warnings } : {}) };
}

/**
 * DURUM OLAYI GERİ ALMA (LIFO): yalnız leventin en yeni aktif durum olayı geri alınır; durum
 * `fromStatus`una döner, konum olaydan geri kurulur (DISMOUNT_CANCEL yuvaya geri koyar — yuva
 * doluysa 409). WOUND_CANCEL ve fason çiftleri kendi servislerinde (iplik/kalem etkileri var).
 */
export async function cancelStatusEvent(id: string, eventId: string, reason: string, userId?: string): Promise<ApiResponse<WarpBeamDto>> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("Gerekçe en az 3 karakter");
  const result = await prisma.$transaction(async (tx) => {
    await assertMountTrackingOnTx(tx);
    const beam = await loadBeamTx(tx, id);
    const active = await activeForwardStatusEventTx(tx, beam.id);
    if (!active || active.id !== eventId) throw AppError.conflict(`${beam.beamNo}: yalnız en son durum olayı geri alınabilir (LIFO)${active ? ` — sıradaki: ${active.kind}` : ""}`, { code: "WARP_BEAM_CANCEL_NOT_LAST", activeEventId: active?.id ?? null });
    const kind = active.kind as WarpBeamEventKind;
    if (!isStatusEventKind(kind) || kind === "WOUND" || kind === "SHIP_OUT" || kind === "RETURNED_IN") {
      throw AppError.badRequest(`${kind} bu uçtan geri alınmaz — sarım iptali / fason yolları kendi ucundan`, { code: "WARP_BEAM_CANCEL_KIND" });
    }
    const cancelKind = WARP_BEAM_CANCEL_OF[kind];
    if (!cancelKind) throw AppError.badRequest("Bu olayın ters türü yok");
    const backTo = active.fromStatus;
    // Konum: MOUNTED geri alınırsa yuva boşalır; DISMOUNTED/EXHAUSTED/SCRAPPED geri alınırsa levent olaydan okunan yuvaya DÖNER (fromStatus MOUNTED ise).
    const place = backTo === WarpBeamStatus.MOUNTED ? { currentMachineId: active.machineId, currentPosition: active.mountPosition } : { currentMachineId: null, currentPosition: null };
    if (backTo === WarpBeamStatus.MOUNTED && active.machineId && active.mountPosition) {
      const m = await tx.machine.findUniqueOrThrow({ where: { id: active.machineId }, select: { code: true } });
      await assertSlotFreeTx(tx, active.machineId, active.mountPosition, m.code);
    }
    if (kind === "MOUNTED") {
      // Bağlamayı geri almak = sökümle aynı kapı (açık koşum).
      const m = await tx.machine.findUniqueOrThrow({ where: { id: active.machineId! }, select: { id: true, code: true, warpBeamSlots: true } });
      await assertDismountAllowedTx(tx, m, beam.beamNo);
    }
    let ev;
    try {
      ev = await applyWarpBeamEventTx(tx, {
        beamId: beam.id,
        kind: cancelKind,
        from: active.toStatus,
        to: backTo,
        place,
        data: { reversesEventId: active.id, lengthM: active.lengthM, machineId: active.machineId, mountPosition: active.mountPosition, reason: why, createdById: userId ?? null },
      });
    } catch (e) {
      slotRaceTo409(e, "makine", active.mountPosition ?? 0);
    }
    return { ev, beamNo: beam.beamNo, cancelKind, backTo };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: result.cancelKind, data: { beamId: id, reversesEventId: eventId, reason: why } });
  return { success: true, data: await freshDto(id), message: `${result.beamNo}: ${result.cancelKind} — durum ${result.backTo}` };
}

/** Makinedeki bağlı leventler (tablet Dokuma paneli + panel). */
export async function listMountedOnMachine(machineId: string): Promise<ApiResponse<Array<{ id: string; beamNo: string; position: number | null; warpSpecCode: string; remainingM: number }>>> {
  const rows = await mountedBeamsOnMachineTx(prisma, machineId);
  const out = [];
  for (const r of rows) {
    const spec = await prisma.warpSpec.findUniqueOrThrow({ where: { id: r.warpSpecId }, select: { code: true } });
    out.push({ id: r.id, beamNo: r.beamNo, position: r.currentPosition, warpSpecCode: spec.code, remainingM: Number(await readRemainingM(prisma, r.id)) });
  }
  return { success: true, data: out };
}
