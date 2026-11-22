// Dönüş kabul belgesi (devere ek E2) — saf yardımcılar. Panel hesap YAPMAZ: sipariş başı satır taslakları →
// belge gövdesi, satır içi doğrulama (sipariş no önekli), belge düzeyi sınırlar ve gövde tekrarı. Dağıtım,
// tüketim, irsaliye tekrarı kararı sunucudan gelir.
import { buildReceiveBody, MAX_RECEIVE_BEAMS, receiveBodyKey, type ReceiveBeamDraft, type ReceiveWeighing } from "./receive-model";
import type { DeliveryNoteGroup, WarpingReceiveDoc, WarpingReceiveDocFields, WarpingReceiveDocOrderInput, WarpingReceiveDocPreview } from "./receive-doc-types";

/** Backend `WARPING_RECEIVE_DOC_MAX_ORDERS` / `WARPING_RECEIVE_MAX_BEAMS`. */
export const MAX_DOC_ORDERS = 20;
export const MAX_DOC_BEAMS = MAX_RECEIVE_BEAMS;

export interface DocOrderDraft { orderId: string; orderNo: string; drafts: ReceiveBeamDraft[] }

export type DocBuild =
  | { ok: true; body: WarpingReceiveDocFields; beamCount: number; totalM: number }
  | { ok: false; error: string | null };

/** Satırı olmayan sipariş belgeye girmez; bir sipariş hatalıysa belge kurulmaz (hep-ya-hiç). */
export function buildReceiveDocBody(orders: DocOrderDraft[], p: { subcontractorId: string | null; deliveryNoteNo: string; weighing: ReceiveWeighing }): DocBuild {
  const out: WarpingReceiveDocOrderInput[] = [];
  const seen = new Map<string, string>();
  let beamCount = 0;
  let totalM = 0;
  for (const o of orders) {
    const b = buildReceiveBody(o.drafts, "", p.weighing);
    if (!b.ok) {
      if (b.error) return { ok: false, error: `${o.orderNo}: ${b.error}` };
      continue;
    }
    for (const beam of b.body.beams) {
      const key = receiveBodyKey(beam);
      if (!key) continue;
      const other = seen.get(key);
      if (other && other !== o.orderNo) return { ok: false, error: `Aynı gövde iki siparişte okutulmuş (${other} ve ${o.orderNo}).` };
      seen.set(key, o.orderNo);
    }
    out.push({ warpingOrderId: o.orderId, beams: b.body.beams });
    beamCount += b.body.beams.length;
    totalM += b.totalM;
  }
  if (out.length === 0) return { ok: false, error: null };
  if (out.length > MAX_DOC_ORDERS) return { ok: false, error: `Bir kabul belgesinde en çok ${MAX_DOC_ORDERS} sipariş olabilir.` };
  if (beamCount > MAX_DOC_BEAMS) return { ok: false, error: `Bir kabul belgesinde en çok ${MAX_DOC_BEAMS} levent olabilir.` };
  return { ok: true, beamCount, totalM, body: { subcontractorId: p.subcontractorId, deliveryNoteNo: p.deliveryNoteNo.trim() || null, orders: out } };
}

/** Belge uyarılarından irsaliye düzeyindekiler (sunucu önce bunları, sonra sipariş uyarılarını sıralar). */
export function noteWarnings(p: WarpingReceiveDocPreview): string[] {
  const perOrder = p.orders.reduce((s, o) => s + o.preview.warnings.length, 0);
  return p.warnings.slice(0, Math.max(0, p.warnings.length - perOrder));
}

/** Levent kartı basılacak leventler: geri alınmamış ve reddedilmemiş olanlar, belgedeki sırayla. */
export function liveBeamsOfDoc(doc: Pick<WarpingReceiveDoc, "orders">): Array<{ id: string; beamNo: string }> {
  return doc.orders.flatMap((o) => o.receipt.beams.filter((b) => !b.cancelled && b.status !== "REJECTED").map((b) => ({ id: b.id, beamNo: b.beamNo })));
}

/** İrsaliye no ile önceki CANLI kabuller — belge no (yoksa "tek sipariş") ve sipariş no listesi. */
export function deliveryNoteUsesOf(g: DeliveryNoteGroup | undefined): string[] {
  if (!g) return [];
  const out: string[] = [];
  for (const d of g.docs) if (d.totals.liveBeamCount > 0) out.push(`${d.docNo} (${d.orders.map((o) => o.orderNo).join(", ")})`);
  for (const r of g.receipts) if (r.receipt.liveBeamCount > 0) out.push(`${r.orderNo} (belgesiz kabul)`);
  return out;
}
