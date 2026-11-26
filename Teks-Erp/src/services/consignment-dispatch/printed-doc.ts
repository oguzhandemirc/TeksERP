// =============================================================================
// EMANET ÇIKIŞ BELGESİ — basılı belge kaynağı (denetim 6; transfer/fason sevk emsali)
// =============================================================================
// Çıkış tx'inde v1 donar (`create.ts`), iptal tx'inde VOIDED (`cancel.ts`); belgesiz eski kayıt ilk açılışta
// lazy-init olur, iptal edilmişse VOIDED doğar. Payload müşteri alanlarıdır: depo adı SEÇİLMEZ, not iç alan
// (renderer opt-in). Belge no = çıkış no (doğuşta materyalize).
// =============================================================================
import { PrintedDocType, type Prisma } from "@prisma/client";
import { renderConsignmentDispatchHtml, renderConsignmentDispatchTables, type ConsignmentDispatchDoc } from "../document-render/consignment-dispatch.html";
import { printedDocumentService, registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "../printed-document.service";

const DOC_SELECT = {
  dispatchNo: true, dispatchedAt: true, plateNumber: true, driverName: true, notes: true, cancelledAt: true, cancelReason: true,
  ownerCustomer: { select: { name: true, code: true } },
  items: {
    orderBy: [{ kind: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      kind: true, lengthM: true, qtyKg: true,
      warpBeam: { select: { beamNo: true, warpSpec: { select: { name: true } } } },
      yarnItem: { select: { code: true, name: true } },
      lot: { select: { lotNo: true } },
    },
  },
} satisfies Prisma.ConsignmentDispatchSelect;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

async function consignmentFresh(db: PrintedDocDb, id: string): Promise<BuiltDocContent | null> {
  const d = await db.consignmentDispatch.findUnique({ where: { id }, select: DOC_SELECT });
  if (!d) return null;
  let beamCount = 0;
  let beamLengthM = 0;
  let yarnKg = 0;
  const lines: ConsignmentDispatchDoc["lines"] = d.items.map((it, i) => {
    if (it.kind === "WARP_BEAM") {
      const qty = Number(it.lengthM ?? 0);
      beamCount += 1;
      beamLengthM += qty;
      return { seq: i + 1, kind: "WARP_BEAM", itemText: it.warpBeam?.warpSpec?.name ?? "—", refNo: it.warpBeam?.beamNo ?? "—", qty, unit: "m" };
    }
    const qty = Number(it.qtyKg ?? 0);
    yarnKg += qty;
    return { seq: i + 1, kind: "YARN", itemText: it.yarnItem ? `${it.yarnItem.code} — ${it.yarnItem.name}` : "—", refNo: it.lot?.lotNo ?? "—", qty, unit: "kg" };
  });
  const doc: ConsignmentDispatchDoc = {
    header: {
      documentNo: d.dispatchNo, dispatchedAt: d.dispatchedAt.toISOString(), ownerName: d.ownerCustomer.name, ownerCode: d.ownerCustomer.code ?? null,
      plateNumber: d.plateNumber, driverName: d.driverName, notes: d.notes,
    },
    lines,
    totals: { beamCount, beamLengthM: round3(beamLengthM), yarnKg: round3(yarnKg) },
  };
  const content: BuiltDocContent = { documentNo: d.dispatchNo, doc: doc as unknown as Record<string, unknown> };
  // Lazy-init yolunda iptal edilmiş çıkışın belgesi doğrudan VOIDED doğar (İPTAL filigranı).
  return d.cancelledAt ? { ...content, voidInfo: { reason: d.cancelReason ?? "Emanet çıkışı iptal edildi", at: d.cancelledAt } } : content;
}

registerPrintedDocBuilder(PrintedDocType.CONSIGNMENT_DISPATCH, {
  fresh: consignmentFresh,
  renderHtml: renderConsignmentDispatchHtml,
  renderTables: renderConsignmentDispatchTables,
  resolveProfileId: async (db, id) =>
    (await db.consignmentDispatch.findUnique({ where: { id }, select: { ownerCustomer: { select: { documentProfileId: true } } } }))?.ownerCustomer.documentProfileId ?? null,
});

/** Çıkış oluşturma tx'inde v1'i dondurur — çıkış ile belge birlikte ya da hiç. */
export function freezeConsignmentDispatchDocTx(tx: Prisma.TransactionClient, id: string, userId: string): Promise<void> {
  return printedDocumentService.freezeForSource(tx, PrintedDocType.CONSIGNMENT_DISPATCH, id, userId);
}

/** İptal claim'inin tx'inde ACTIVE belgeyi VOIDED'e çeker (silinmez: kâğıt sahada dolaşmış olabilir). */
export function voidConsignmentDispatchDocTx(tx: Prisma.TransactionClient, id: string, reason: string): Promise<number> {
  return printedDocumentService.voidForSource(tx, PrintedDocType.CONSIGNMENT_DISPATCH, id, reason);
}
