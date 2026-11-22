// =============================================================================
// Levent kartı BASILI BELGESİ — kaynak çözücü (devere S5, A6 kılıflı bilet)
// =============================================================================
// Kart sarım (WOUND, ters kaydı olmayan) gerçeklerinden doğar: kırılım WOUND KOPYASIDIR
// (`WarpBeamEventYarn`), çözgü kartı sonradan değişse de kart değişmez. Ücret/fiyat seçilmez
// (select = sızıntı sınırı; bekçi `test_levent_karti`). İptal edilmiş ya da sarılmamış levent
// kartı basılmaz (409); basılmış kart sarım iptalinde `applyWarpBeamEventTx` içinde VOIDED olur.
// =============================================================================
import { PrintedDocType, WarpBeamStatus, YarnMovementKind, type Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { renderWarpBeamCardHtml, renderWarpBeamCardTables, type WarpBeamCardDoc, type WarpBeamCardYarn } from "./document-render/warp-beam-card.html";
import { printedDocumentService, registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "./printed-document.service";

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));

const BEAM_CARD_SELECT = {
  beamNo: true, status: true, physicalBeamNo: true,
  warpSpec: { select: { code: true, name: true } },
  weavingOrder: { select: { weavingOrderNumber: true, item: { select: { name: true } } } },
  beamBody: { select: { bodyNo: true } },
  ownerCustomer: { select: { name: true } },
  subcontractor: { select: { name: true } },
  warpingOrder: { select: { orderNo: true } },
  warpingReceiveDoc: { select: { docNo: true, deliveryNoteNo: true } },
  yarnMovements: {
    where: { kind: YarnMovementKind.WARP_ISSUE, lotId: { not: null } },
    select: { itemId: true, lot: { select: { lotNo: true } } },
  },
  events: {
    where: { kind: "WOUND", reversal: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      createdAt: true, lengthM: true, endsCount: true, theoreticalKg: true, grossKg: true, tareKg: true, deliveryNoteNo: true,
      yarns: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          yarnItemId: true, endsCount: true, denier: true, theoreticalKg: true,
          yarnItem: { select: { code: true, name: true } },
          allocations: { select: { dispatchItem: { select: { lot: { select: { lotNo: true } } } } } },
        },
      },
    },
  },
} satisfies Prisma.WarpBeamSelect;

/** İplik → lot no'ları (içeride sarımın çıkış hareketleri; ilişki üstünden SALT OKUMA, kg defterine yazmaz). */
function issueLotsByYarn(moves: ReadonlyArray<{ itemId: string; lot: { lotNo: string } | null }>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const mv of moves) if (mv.lot) m.set(mv.itemId, (m.get(mv.itemId) ?? new Set()).add(mv.lot.lotNo));
  return m;
}

async function collectBeam(db: PrintedDocDb, beamId: string): Promise<BuiltDocContent> {
  const b = await db.warpBeam.findUnique({ where: { id: beamId }, select: BEAM_CARD_SELECT });
  if (!b) throw AppError.notFound("Levent bulunamadı", { code: "WARP_BEAM_NOT_FOUND" });
  if (b.status === WarpBeamStatus.CANCELLED) {
    throw AppError.conflict(`${b.beamNo} iptal edilmiş — levent kartı basılmaz.`, { code: "WARP_BEAM_CARD_CANCELLED" });
  }
  const w = b.events[0];
  if (!w) throw AppError.conflict(`${b.beamNo} henüz sarılmadı — kart sarımdan sonra basılır.`, { code: "WARP_BEAM_CARD_NOT_WOUND" });
  const issueLots = issueLotsByYarn(b.yarnMovements);
  const yarns: WarpBeamCardYarn[] = w.yarns.map((y, i) => {
    const lots = new Set(issueLots.get(y.yarnItemId) ?? []);
    for (const a of y.allocations) if (a.dispatchItem.lot) lots.add(a.dispatchItem.lot.lotNo);
    return {
      seq: i + 1, yarnCode: y.yarnItem.code, yarnName: y.yarnItem.name, endsCount: y.endsCount,
      denier: Number(y.denier), kg: Number(y.theoreticalKg), lots: lots.size ? [...lots].sort().join(", ") : null,
    };
  });
  const net = w.grossKg != null && w.tareKg != null ? Number(w.grossKg.minus(w.tareKg)) : null;
  const doc: WarpBeamCardDoc = {
    header: {
      documentNo: b.beamNo, beamNo: b.beamNo, bodyNo: b.beamBody?.bodyNo ?? b.physicalBeamNo ?? null,
      warpSpecCode: b.warpSpec.code, warpSpecName: b.warpSpec.name,
      itemName: b.weavingOrder?.item.name ?? null, weavingOrderNumber: b.weavingOrder?.weavingOrderNumber ?? null,
      woundAt: w.createdAt.toISOString(), lengthM: num(w.lengthM), endsCount: w.endsCount, theoreticalKg: num(w.theoreticalKg), weighedNetKg: net,
      ownerName: b.ownerCustomer?.name ?? null, subcontractorName: b.subcontractor?.name ?? null,
      deliveryNoteNo: b.warpingReceiveDoc?.deliveryNoteNo ?? w.deliveryNoteNo ?? null,
      receiveDocNo: b.warpingReceiveDoc?.docNo ?? null, warpingOrderNo: b.warpingOrder?.orderNo ?? null,
    },
    yarns,
    totals: {
      endsCount: yarns.reduce((s, y) => s + y.endsCount, 0),
      kg: Math.round(yarns.reduce((s, y) => s + y.kg, 0) * 1000) / 1000,
    },
  };
  return { documentNo: b.beamNo, doc: doc as unknown as Record<string, unknown> };
}

registerPrintedDocBuilder(PrintedDocType.WARP_BEAM_CARD, {
  fresh: collectBeam,
  freeze: collectBeam,
  buildPreview: collectBeam,
  renderHtml: renderWarpBeamCardHtml,
  renderTables: renderWarpBeamCardTables,
});

/** Levent CANCELLED'a geçerken basılmış kartı VOIDED'e çeker — geçişin tx'i İÇİNDE (birlikte ya da hiç). */
export function voidWarpBeamCardTx(tx: Prisma.TransactionClient, beamId: string, reason: string): Promise<number> {
  return printedDocumentService.voidForSource(tx, PrintedDocType.WARP_BEAM_CARD, beamId, reason);
}
