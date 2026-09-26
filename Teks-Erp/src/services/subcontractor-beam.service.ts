// =============================================================================
// FASON SEVKİNDE LEVENT KALEMİ (F1) — git · storno · dön · storno — kapalı çevrim
// =============================================================================
// Tasarım: DEVERE-LEVENT-TARAMASI §3.9 (akıbet ekseni) + "AYRI DİLİM" satırı; hüküm 1e 2026-09-14.
// Fiziksel çıkış belgesi `SubcontractorDispatch`tir (kalem `kind=WARP_BEAM`, `warpBeamId`); levent
// defteri dört türle yazılır ve HER satır kaleme bağlanır (`dispatchItemId`, CHECK iki yönlü):
//   SHIP_OUT           READY → SHIPPED_OUT   kalem doğarken, AYNI tx (sevk oluşturma)
//   SHIP_OUT_CANCEL    SHIPPED_OUT → READY   sevk iptali (`reversesEventId` = kalemin SHIP_OUT'u)
//   RETURNED_IN        SHIPPED_OUT → READY   fasondan dönüş, `lengthM` = dönen ≤ giden (haşıl verisi F2)
//   RETURNED_IN_CANCEL READY → SHIPPED_OUT   dönüş stornosu (`reversesEventId` = RETURNED_IN)
// Yazıcı TEK: `helpers/warp-beam-event.helper` `applyWarpBeamEventTx` (devere kapısı + atomik claim) — bu dosya
// `warp-beam-wind.service`/`warp-beam.service`i İTHAL ETMEZ: fason router'ı iplik modeline ulaşmamalı (iplik rejim kapısı). Kalem kabul MAKBUZUNA girmez —
// `SubcontractorReceiptItem` top metraj/kalite kabulüdür; levent kalemi OUTSTANDING kümesinin DIŞINDADIR
// (`OUTSTANDING_ITEM.roll` yüklemi null bağı dışlar — bekçi ölçer), sevkin "açık" sayısı topa bakar.
// LIFO: dönmüş kalemin sevki iptal edilemez (önce dönüş stornosu); yeniden sevk edilmiş leventin
// dönüşü storno edilemez (READY claim düşer). Levent-yalnız sevk MEŞRUDUR: parti boş doğar (K10 yapısal;
// `createBatchTx({rollIds: []})` emsali kabul/tambur yollarında).
// =============================================================================
import { Prisma, SubcontractorDispatchItemKind, WarpBeamStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "./helpers/warp-beam-event.helper";
import { remainingMTx } from "./helpers/warp-beam-ledger.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface BeamDispatchLine {
  itemId: string;
  warpBeamId: string;
  beamNo: string;
  lengthM: Prisma.Decimal;
}

/** Kalem + olayları — iptal/dönüş yolları "bu kalemin SHIP_OUT'u / açık RETURNED_IN'i" sorusunu buradan cevaplar. */
const BEAM_ITEM_SELECT = {
  id: true,
  warpBeamId: true,
  dispatchedQty: true,
  dispatch: { select: { id: true, dispatchNo: true, cancelledAt: true } },
  warpBeam: { select: { beamNo: true, status: true } },
  warpBeamEvents: {
    select: { id: true, kind: true, lengthM: true, reversal: { select: { id: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.SubcontractorDispatchItemSelect;
type BeamItemRow = Prisma.SubcontractorDispatchItemGetPayload<{ select: typeof BEAM_ITEM_SELECT }>;

function shipOutOf(item: BeamItemRow) {
  const ev = item.warpBeamEvents.find((e) => e.kind === "SHIP_OUT");
  // Kalem SHIP_OUT'suz doğmaz (aynı tx); yoksa defter/durum ayrışmış demektir — sessizce devam edilmez.
  if (!ev) throw AppError.conflict(`${item.warpBeam?.beamNo ?? item.id} kaleminin çıkış satırı yok — defter tutarsız, elle inceleme gerekir`, { code: "WARP_BEAM_LEDGER_GAP" });
  return ev;
}
function openReturnOf(item: BeamItemRow) {
  return item.warpBeamEvents.find((e) => e.kind === "RETURNED_IN" && !e.reversal) ?? null;
}

function metre(v: number | string, ad: string): Prisma.Decimal {
  const d = D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
  if (!d.isFinite() || d.lte(0)) throw AppError.badRequest(`${ad} sıfırdan büyük olmalı`);
  return d;
}

/**
 * Levent kalemlerini yeni sevke yazar + SHIP_OUT aynı tx'te. Sıra: satır kilidi (touch; `touchWorkOrderTx`
 * emsali) → taze durum (READY değilse 409 `WARP_BEAM_NOT_READY`) → kalan metre olaylardan → kalem → SHIP_OUT
 * (claim tek yazıcıda). Kilit metreyi dondurur: READY→…→READY çevrimi kilit altında koşamaz, bayat metre yazılmaz.
 */
export async function dispatchWarpBeamItemsTx(
  tx: Prisma.TransactionClient,
  input: { dispatchId: string; warpBeamIds: string[]; userId?: string },
): Promise<{ lines: BeamDispatchLine[]; totalM: Prisma.Decimal }> {
  const lines: BeamDispatchLine[] = [];
  let totalM = D(0);
  for (const beamId of input.warpBeamIds) {
    await tx.warpBeam.updateMany({ where: { id: beamId }, data: { updatedAt: new Date() } });
    const beam = await tx.warpBeam.findUnique({
      where: { id: beamId },
      select: { id: true, beamNo: true, status: true },
    });
    if (!beam) throw AppError.notFound(`Levent bulunamadı: ${beamId}`);
    if (beam.status !== WarpBeamStatus.READY) {
      throw AppError.conflict(`${beam.beamNo} durumu ${beam.status} — yalnız HAZIR levent fasona verilir`, { code: "WARP_BEAM_NOT_READY", status: beam.status, beamNo: beam.beamNo });
    }
    const remaining = await remainingMTx(tx, beamId);
    if (remaining.lte(0)) throw AppError.conflict(`${beam.beamNo} kalan metresi 0 — fasona verilecek çözgü yok`, { code: "WARP_BEAM_EMPTY", beamNo: beam.beamNo });
    const item = await tx.subcontractorDispatchItem.create({
      data: { dispatchId: input.dispatchId, kind: SubcontractorDispatchItemKind.WARP_BEAM, warpBeamId: beamId, dispatchedQty: remaining, dispatchedWeight: null },
      select: { id: true },
    });
    await applyWarpBeamEventTx(tx, {
      beamId,
      kind: "SHIP_OUT",
      from: WarpBeamStatus.READY,
      to: WarpBeamStatus.SHIPPED_OUT,
      data: { dispatchItemId: item.id, lengthM: remaining, createdById: input.userId ?? null },
    });
    lines.push({ itemId: item.id, warpBeamId: beamId, beamNo: beam.beamNo, lengthM: remaining });
    totalM = totalM.plus(remaining);
  }
  return { lines, totalM };
}

/** Sevk iptali ÖNCESİ engel sinyali: bu sevkten DÖNMÜŞ (açık RETURNED_IN) levent sayısı — önizleme ile aynı kaynak. */
export async function countReturnedBeamItems(client: Pick<typeof prisma, "subcontractorDispatchItem">, dispatchId: string): Promise<number> {
  const items = await client.subcontractorDispatchItem.findMany({ where: { dispatchId, kind: SubcontractorDispatchItemKind.WARP_BEAM }, select: BEAM_ITEM_SELECT });
  return items.filter((i) => openReturnOf(i) !== null).length;
}

/**
 * Sevk iptalinde levent kalemleri: SHIP_OUT_CANCEL (SHIPPED_OUT → READY), `reversesEventId` = kalemin SHIP_OUT'u.
 * Dönmüş kalem varsa 409 `WARP_BEAM_RETURNED` (LIFO: önce dönüş stornosu). Sevk claim'inden SONRA çağrılır.
 */
export async function cancelWarpBeamItemsTx(
  tx: Prisma.TransactionClient,
  input: { dispatchId: string; reason: string; userId?: string },
): Promise<number> {
  const items = await tx.subcontractorDispatchItem.findMany({ where: { dispatchId: input.dispatchId, kind: SubcontractorDispatchItemKind.WARP_BEAM }, select: BEAM_ITEM_SELECT });
  for (const it of items) {
    const shipOut = shipOutOf(it);
    if (openReturnOf(it)) {
      throw AppError.conflict(`${it.warpBeam?.beamNo} bu sevkten dönmüş — sevk iptal edilemez, önce dönüşü iptal edin`, { code: "WARP_BEAM_RETURNED", beamNo: it.warpBeam?.beamNo });
    }
    await applyWarpBeamEventTx(tx, {
      beamId: it.warpBeamId!,
      kind: "SHIP_OUT_CANCEL",
      from: WarpBeamStatus.SHIPPED_OUT,
      to: WarpBeamStatus.READY,
      data: { dispatchItemId: it.id, reversesEventId: shipOut.id, lengthM: shipOut.lengthM, reason: input.reason, createdById: input.userId ?? null },
    });
  }
  return items.length;
}

async function loadBeamItem(tx: Prisma.TransactionClient, dispatchId: string, warpBeamId: string): Promise<BeamItemRow> {
  const item = await tx.subcontractorDispatchItem.findUnique({ where: { dispatchId_warpBeamId: { dispatchId, warpBeamId } }, select: BEAM_ITEM_SELECT });
  if (!item) throw AppError.notFound("Bu sevkte böyle bir levent kalemi yok");
  if (item.dispatch.cancelledAt) throw AppError.conflict(`${item.dispatch.dispatchNo} iptal edilmiş — levent işlemi yapılamaz`, { code: "DISPATCH_CANCELLED" });
  return item;
}

export interface ReturnWarpBeamInput {
  warpBeamId: string;
  /** Dönen metre — giden (`SHIP_OUT.lengthM`) aşılamaz; haşıl alma/fire verisi F2. */
  lengthM: number | string;
  clientToken?: string | null;
}
export interface WarpBeamReturnDto {
  eventId: string;
  beamNo: string;
  dispatchNo: string;
  lengthM: number;
  status: WarpBeamStatus;
}

/** Fasondan DÖNÜŞ — RETURNED_IN (SHIPPED_OUT → READY). Replay `clientToken`la (kimlik: kalem + tür). */
export async function returnWarpBeam(dispatchId: string, input: ReturnWarpBeamInput, userId?: string): Promise<ApiResponse<WarpBeamReturnDto>> {
  const lengthM = metre(input.lengthM, "Dönen metre");
  const result = await prisma.$transaction(async (tx) => {
    const item = await loadBeamItem(tx, dispatchId, input.warpBeamId);
    if (input.clientToken) {
      const replay = await tx.warpBeamEvent.findUnique({ where: { clientToken: input.clientToken }, select: { id: true, kind: true, dispatchItemId: true, lengthM: true, reversesEventId: true } });
      if (replay) {
        assertReplayPayloadMatches(
          [{ ad: "dispatchItemId", mevcut: replay.dispatchItemId, gelen: item.id }, { ad: "kind", mevcut: replay.kind, gelen: "RETURNED_IN" }],
          "Bu istemci anahtarı BAŞKA bir levent işlemiyle kullanılmış — formu yenileyip yeniden deneyin.",
        );
        return { ev: replay, item, replayed: true };
      }
    }
    const shipOut = shipOutOf(item);
    if (openReturnOf(item)) throw AppError.conflict(`${item.warpBeam?.beamNo} bu sevkten zaten dönmüş`, { code: "WARP_BEAM_ALREADY_RETURNED" });
    if (shipOut.lengthM && lengthM.gt(shipOut.lengthM)) {
      throw AppError.badRequest(`Dönen metre gideni aşamaz (giden ${Number(shipOut.lengthM)} m)`, { code: "WARP_BEAM_RETURN_EXCEEDS", shippedM: Number(shipOut.lengthM) });
    }
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: input.warpBeamId,
      kind: "RETURNED_IN",
      from: WarpBeamStatus.SHIPPED_OUT,
      to: WarpBeamStatus.READY,
      data: { dispatchItemId: item.id, lengthM, clientToken: input.clientToken ?? null, createdById: userId ?? null },
    });
    return { ev, item, replayed: false };
  });
  if (!result.replayed) {
    await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "RETURNED_IN", data: { dispatchId, warpBeamId: input.warpBeamId, lengthM: Number(lengthM) } });
    // Sevk belgesinin kendi izinde de görünür (panel denetim ekranı sevk kaydını okur; `cancel()` emsali).
    await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { warpBeamReturned: result.item.warpBeam?.beamNo ?? input.warpBeamId, lengthM: Number(lengthM), eventId: result.ev.id } });
  }
  const beamNo = result.item.warpBeam?.beamNo ?? "";
  return {
    success: true,
    data: { eventId: result.ev.id, beamNo, dispatchNo: result.item.dispatch.dispatchNo, lengthM: Number(result.ev.lengthM ?? lengthM), status: WarpBeamStatus.READY },
    message: result.replayed ? `${beamNo} dönüşü zaten kaydedilmiş (yeniden gönderim)` : `${beamNo} fasondan döndü — ${Number(lengthM)} m`,
  };
}

/** Dönüş STORNOSU — RETURNED_IN_CANCEL (READY → SHIPPED_OUT); yeniden sevk edilmiş levent READY claim'inde düşer (LIFO). */
export async function cancelWarpBeamReturn(dispatchId: string, input: { warpBeamId: string; reason: string }, userId?: string): Promise<ApiResponse<WarpBeamReturnDto>> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
  const result = await prisma.$transaction(async (tx) => {
    const item = await loadBeamItem(tx, dispatchId, input.warpBeamId);
    const ret = openReturnOf(item);
    if (!ret) throw AppError.conflict(`${item.warpBeam?.beamNo} bu sevkten dönmüş görünmüyor — iptal edilecek dönüş yok`, { code: "WARP_BEAM_NOT_RETURNED" });
    const ev = await applyWarpBeamEventTx(tx, {
      beamId: input.warpBeamId,
      kind: "RETURNED_IN_CANCEL",
      from: WarpBeamStatus.READY,
      to: WarpBeamStatus.SHIPPED_OUT,
      data: { dispatchItemId: item.id, reversesEventId: ret.id, lengthM: ret.lengthM, reason, createdById: userId ?? null },
    });
    return { ev, item };
  });
  await logWarpBeamEventAudit({ userId, eventId: result.ev.id, kind: "RETURNED_IN_CANCEL", data: { dispatchId, warpBeamId: input.warpBeamId, reversesEventId: result.ev.reversesEventId, reason } });
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { warpBeamReturnCancelled: result.item.warpBeam?.beamNo ?? input.warpBeamId, reason, eventId: result.ev.id } });
  const beamNo = result.item.warpBeam?.beamNo ?? "";
  return {
    success: true,
    data: { eventId: result.ev.id, beamNo, dispatchNo: result.item.dispatch.dispatchNo, lengthM: Number(result.ev.lengthM ?? 0), status: WarpBeamStatus.SHIPPED_OUT },
    message: `${beamNo} dönüşü iptal edildi — levent yeniden fasonda`,
  };
}
