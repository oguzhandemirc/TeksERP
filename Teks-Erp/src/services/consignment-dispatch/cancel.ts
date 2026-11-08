// =============================================================================
// EMANET ÇIKIŞ BELGESİ — iptal önizlemesi + iptal (ters çiftler)
// =============================================================================
// İptal = DURUM GEÇİŞİ: başlık FOR UPDATE (İLK ifade) → denetçi → `updateMany WHERE {id, cancelledAt:null[, updatedAt]}`
// claim'i; kalem değişmez. Claim denetçiden ÖNCE gelirse `cancelledAt` engel zincirini gölgeler (fatura engeli atlanır). Ters çiftler: `SHIP_TO_OWNER_CANCEL` (SHIPPED_TO_OWNER→READY, `reversesEventId`) · `CONSIGNMENT_OUT_CANCEL`
// (aynı kalem/depo/lot/kg). F4 levent sarım bağı aynı tx'te damgalanır; DRAFT olmayan faturadaki bağ iptali keser.
// Önizleme ve iptal AYNI denetçiyi (`inspectCancel`) okur — "önizleme geçer, iptal 409" ayrışması yok.
// =============================================================================
import { Prisma, WarpBeamStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { applyWarpBeamEventTx, logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { applyYarnMovementTx } from "../yarn.service";
import { listWindingLinksForBeams, revokeWindingLinksForConsignmentTx } from "../helpers/service-winding-link.helper";
import { previewDb } from "./lines";
import { loadConsignmentDispatchDto, type ConsignmentDispatchDetail } from "./read";
import { CONSIGNMENT_DISPATCH_TABLE } from "./create";
import type { ConsignmentDispatchCancelInput, ConsignmentDispatchCancelPreview, ConsignmentDispatchErrorCode } from "./types";

type Db = Prisma.TransactionClient;

const ITEM_SELECT = {
  id: true, kind: true, warpBeamId: true, lengthM: true, yarnItemId: true, warehouseId: true, lotId: true, qtyKg: true,
  warpBeam: { select: { beamNo: true, status: true } },
  yarnItem: { select: { code: true, name: true } },
  warehouse: { select: { name: true } },
  lot: { select: { lotNo: true } },
  warpBeamEvents: { where: { kind: "SHIP_TO_OWNER" }, select: { id: true, lengthM: true } },
} satisfies Prisma.ConsignmentDispatchItemSelect;
type ItemRow = Prisma.ConsignmentDispatchItemGetPayload<{ select: typeof ITEM_SELECT }>;

interface CancelInspection {
  dispatch: { id: string; dispatchNo: string; cancelledAt: Date | null; updatedAt: Date };
  beamItems: Array<ItemRow & { shipEventId: string; shipLengthM: Prisma.Decimal }>;
  yarnItems: ItemRow[];
  affected: ConsignmentDispatchCancelPreview["affected"];
  billingLinks: ConsignmentDispatchCancelPreview["billingLinks"];
  /** Levent/fatura engeli — belgenin iptal durumundan BAĞIMSIZ hesaplanır. */
  obstacle: CancelBlock | null;
  /** Önizleme gerekçesi: zaten-iptal ?? engel. */
  blocked: CancelBlock | null;
}
type CancelBlock = { code: ConsignmentDispatchErrorCode; message: string; details: Record<string, unknown> };

/** İptalin etkilediği HER kayıt + ilk engel. `lock`: leventler id sırasıyla FOR UPDATE (iptal tx'i). */
async function inspectCancel(db: Db, id: string, opts: { lock: boolean }): Promise<CancelInspection> {
  const dispatch = await db.consignmentDispatch.findUnique({ where: { id }, select: { id: true, dispatchNo: true, cancelledAt: true, updatedAt: true } });
  if (!dispatch) throw AppError.notFound("Emanet çıkış belgesi bulunamadı.", { code: "CONSIGNMENT_DISPATCH_NOT_FOUND" });
  const items = await sequentialTx(db).consignmentDispatchItem.findMany({ where: { dispatchId: id }, select: ITEM_SELECT, orderBy: [{ warpBeamId: "asc" }, { yarnItemId: "asc" }, { warehouseId: "asc" }, { lotId: "asc" }] });
  const beamIds = items.filter((i) => i.kind === "WARP_BEAM").map((i) => i.warpBeamId!).sort();
  if (opts.lock && beamIds.length > 0) {
    await db.$queryRaw`SELECT id FROM warp_beams WHERE id IN (${Prisma.join(beamIds.map((b) => Prisma.sql`${b}::uuid`))}) ORDER BY id FOR UPDATE`;
  }
  let obstacle: CancelBlock | null = null;
  const beamItems: CancelInspection["beamItems"] = [];
  const yarnItems: ItemRow[] = [];
  const affected: CancelInspection["affected"] = [];
  // Son olay: belirlenimli sıra (createdAt + id eşitlik bozucu); levent başına tek satır (DISTINCT ON).
  const lastEvents = beamIds.length === 0 ? [] : await db.$queryRaw<Array<{ beamId: string; id: string; kind: string; consignmentItemId: string | null }>>`
    SELECT DISTINCT ON ("beamId") "beamId", id, kind, "consignmentItemId" FROM warp_beam_events
    WHERE "beamId" IN (${Prisma.join(beamIds.map((b) => Prisma.sql`${b}::uuid`))})
    ORDER BY "beamId", "createdAt" DESC, id DESC`;
  const lastByBeam = new Map(lastEvents.map((e) => [e.beamId, e]));
  for (const it of items) {
    if (it.kind === "WARP_BEAM") {
      const ship = it.warpBeamEvents[0];
      // Kalem SHIP_TO_OWNER'suz doğmaz (aynı tx); yoksa defter/durum ayrışmıştır — sessizce devam edilmez.
      if (!ship || !ship.lengthM) throw AppError.internal(`${it.warpBeam?.beamNo} çıkış kaleminin defter satırı yok — veri bütünlüğü bozuk.`);
      beamItems.push({ ...it, shipEventId: ship.id, shipLengthM: ship.lengthM });
      affected.push({ kind: "WARP_BEAM", refId: it.warpBeamId!, label: it.warpBeam?.beamNo ?? it.warpBeamId!, qty: ship.lengthM.toFixed(3), unit: "METER" });
      const last = lastByBeam.get(it.warpBeamId!);
      if (!obstacle && (it.warpBeam?.status !== WarpBeamStatus.SHIPPED_TO_OWNER || last?.id !== ship.id)) {
        obstacle = { code: "CONSIGNMENT_BEAM_MOVED_AFTER", message: `${it.warpBeam?.beamNo} çıkıştan sonra başka işlem almış (durum ${it.warpBeam?.status}) — önce o işlemi geri alın.`, details: { warpBeamId: it.warpBeamId, status: it.warpBeam?.status, lastEventKind: last?.kind ?? null } };
      }
    } else {
      yarnItems.push(it);
      // Etiket belge detayı ve formla aynı biçim (lot · iplik adı · depo) — iptal onayında aynı kalem tanınsın.
      affected.push({ kind: "YARN", refId: it.lotId ?? it.id, label: `Lot ${it.lot?.lotNo ?? "?"} · ${it.yarnItem?.name ?? it.yarnItem?.code ?? "?"} · ${it.warehouse?.name ?? "?"}`, qty: (it.qtyKg ?? new Prisma.Decimal(0)).toFixed(3), unit: "KG" });
    }
  }
  // F4 bağ okuyucusu TEK (`service-winding-link.helper`): önizleme ve iptal aynı listeyi görür.
  const billingLinks = await listWindingLinksForBeams(db, beamIds);
  const invoiced = billingLinks.find((l) => l.invoiceStatus !== "DRAFT");
  if (!obstacle && invoiced) {
    obstacle = { code: "CONSIGNMENT_BEAM_INVOICED", message: `Levent sarım işi ${invoiced.invoiceNo ?? invoiced.invoiceId} faturasında (${invoiced.invoiceStatus}) — önce faturayı iptal edin.`, details: { linkId: invoiced.linkId, invoiceId: invoiced.invoiceId, warpBeamId: invoiced.warpBeamId } };
  }
  const blocked: CancelBlock | null = dispatch.cancelledAt
    ? { code: "CONSIGNMENT_DISPATCH_CANCELLED", message: `${dispatch.dispatchNo} zaten iptal edilmiş.`, details: { dispatchId: id } }
    : obstacle;
  return { dispatch, beamItems, yarnItems, affected, billingLinks, obstacle, blocked };
}

export async function cancelPreviewConsignmentDispatch(id: string): Promise<ConsignmentDispatchCancelPreview> {
  const r = await inspectCancel(previewDb, id, { lock: false });
  return { id: r.dispatch.id, dispatchNo: r.dispatch.dispatchNo, canCancel: r.blocked === null, blockedReason: r.blocked?.code ?? null, affected: r.affected, billingLinks: r.billingLinks };
}

export async function cancelConsignmentDispatch(id: string, input: ConsignmentDispatchCancelInput, userId: string): Promise<ConsignmentDispatchDetail> {
  const reason = input.reason.trim();
  if (!reason) throw AppError.badRequest("İptal sebebi zorunlu.", { code: "CANCEL_REASON_REQUIRED" });
  const expected = input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : null;
  if (expected && Number.isNaN(expected.getTime())) throw AppError.badRequest("expectedUpdatedAt geçersiz tarih.", { code: "VALIDATION_ERROR" });
  const out = await prisma.$transaction(async (tx) => {
    const now = new Date();
    // Kilit sırası: başlık → leventler (id) → iplik stok satırları (yazar içinde). Oluştur yolu başlığı yeni doğurur;
    // başka yazar başlığı kilitlemez → döngü yok. Kilit, denetçi ile claim arasında başka iptali dışarıda tutar.
    const head = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM consignment_dispatches WHERE id = ${id}::uuid FOR UPDATE`;
    if (head.length === 0) throw AppError.notFound("Emanet çıkış belgesi bulunamadı.", { code: "CONSIGNMENT_DISPATCH_NOT_FOUND" });
    const r = await inspectCancel(tx, id, { lock: true });
    if (r.dispatch.cancelledAt) throw AppError.conflict(`${r.dispatch.dispatchNo} zaten iptal edilmiş.`, { code: "CONSIGNMENT_DISPATCH_CANCELLED", dispatchId: id });
    if (r.obstacle) throw AppError.conflict(r.obstacle.message, { code: r.obstacle.code, ...r.obstacle.details });
    const claim = await tx.consignmentDispatch.updateMany({
      where: { id, cancelledAt: null, ...(expected ? { updatedAt: expected } : {}) },
      data: { cancelledAt: now, cancelledById: userId, cancelReason: reason, updatedById: userId },
    });
    if (claim.count === 0) {
      throw AppError.conflict(`${r.dispatch.dispatchNo} önizlemeden sonra değişmiş — önizlemeyi yenileyin.`, { code: "CONSIGNMENT_DISPATCH_CHANGED", dispatchId: id });
    }
    // F4 TEK damga yolu: bağların faturası FOR UPDATE yeniden okunur (onay claim'iyle serileşir), DRAFT dışı → 409.
    await revokeWindingLinksForConsignmentTx(tx, { warpBeamIds: r.beamItems.map((b) => b.warpBeamId!), userId, at: now });
    const beamEvents: Array<{ eventId: string; beamId: string; beamNo: string; lengthM: string; itemId: string }> = [];
    for (const it of r.beamItems) {
      const ev = await applyWarpBeamEventTx(tx, {
        beamId: it.warpBeamId!, kind: "SHIP_TO_OWNER_CANCEL", from: WarpBeamStatus.SHIPPED_TO_OWNER, to: WarpBeamStatus.READY,
        data: { consignmentItemId: it.id, reversesEventId: it.shipEventId, lengthM: it.shipLengthM, reason, createdById: userId },
      });
      beamEvents.push({ eventId: ev.id, beamId: it.warpBeamId!, beamNo: it.warpBeam?.beamNo ?? "", lengthM: it.shipLengthM.toFixed(3), itemId: it.id });
    }
    for (const it of r.yarnItems) {
      await applyYarnMovementTx(tx, {
        itemId: it.yarnItemId!, warehouseId: it.warehouseId!, kind: YarnMovementKind.CONSIGNMENT_OUT_CANCEL, qtyKg: it.qtyKg!, lotId: it.lotId,
        consignmentItemId: it.id, reason: `Emanet çıkış iptali ${r.dispatch.dispatchNo}: ${reason}`, userId,
      });
    }
    return { dispatchNo: r.dispatch.dispatchNo, beamEvents, revokedLinkIds: r.billingLinks.map((l) => l.linkId), yarnCount: r.yarnItems.length };
  });
  await AuditService.log({
    userId, action: "UPDATE", tableName: CONSIGNMENT_DISPATCH_TABLE, recordId: id,
    newData: { op: "CANCEL", dispatchNo: out.dispatchNo, reason, beams: out.beamEvents.map((e) => ({ warpBeamId: e.beamId, beamNo: e.beamNo, lengthM: e.lengthM })), yarnLineCount: out.yarnCount, revokedBillingLinkIds: out.revokedLinkIds },
  });
  for (const e of out.beamEvents) {
    await logWarpBeamEventAudit({ userId, eventId: e.eventId, kind: "SHIP_TO_OWNER_CANCEL", data: { beamId: e.beamId, beamNo: e.beamNo, lengthM: e.lengthM, consignmentItemId: e.itemId, dispatchNo: out.dispatchNo } });
  }
  return loadConsignmentDispatchDto(prisma, id);
}
