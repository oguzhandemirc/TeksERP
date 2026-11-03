// Çok partili belge (S1, fabrika cevabı 16/17) — saf parçalar: sunucunun parti özeti (`GET /irsaliyeler/:id/partiler`) →
// satırın düzenlenebilir parti listesi + kip; kayıt kapısı ve gövde parçası. Kural sunucudadır (uyarılar oradan gelir).
import { TERIM } from '../../../../lib/terim';
import type { CreateWorkOrderFromNoteBody, CreateWorkOrderFromNoteResult, MultiPartyMode, NotePartiesView } from '../../../../services/inboundDoc.service';

export interface PartyRow {
  blockNo: number;
  batchNo: string;
  meters: number | null;
}

export interface MultiPartyDraft {
  rows: PartyRow[];
  mode: MultiPartyMode;
}

/** Çok parti (≥2) ise satırlar + fabrika varsayılan kipi; tek/bölümsüz belgede (ya da eski sunucuda) null = bugünkü form. */
export function initialMultiParty(view: NotePartiesView | null | undefined): MultiPartyDraft | null {
  if (!view?.multi || view.parties.length < 2) return null;
  return {
    rows: view.parties.map((p) => ({ blockNo: p.blockNo, batchNo: p.batchNo ?? '', meters: p.meters > 0 ? p.meters : null })),
    mode: view.defaultMode === 'PER_PARTY' ? 'PER_PARTY' : 'SINGLE',
  };
}

export function multiPartyIssues(m: MultiPartyDraft): string[] {
  const missing = m.rows.filter((r) => r.meters === null || !(r.meters > 0)).map((r) => `${r.blockNo}. parti`);
  return missing.length ? [`Parti metresi eksik: ${missing.join(', ')}.`] : [];
}

export const multiPartyTotal = (m: MultiPartyDraft): number => Math.round(m.rows.reduce((s, r) => s + (r.meters ?? 0), 0) * 1000) / 1000;

/** Tek partili gövdeye parti listesi + kip eklenir; kurşun metresi parti toplamıdır. */
export function withParties(body: CreateWorkOrderFromNoteBody, m: MultiPartyDraft): CreateWorkOrderFromNoteBody {
  return {
    ...body,
    kursunMeters: String(multiPartyTotal(m)),
    parties: m.rows.map((r) => ({ blockNo: r.blockNo, batchNo: r.batchNo.trim() || null, meters: r.meters ?? 0 })),
    mode: m.mode,
  };
}

/** Açılan iş emirleri: çok partide sunucu listeyi verir; eski sunucu / tek parti → tek kayıt. */
export function openedWorkOrders(r: CreateWorkOrderFromNoteResult): { workOrderId: string; workOrderNo: string; batchNumber: string | null }[] {
  if (r.workOrders && r.workOrders.length > 0) return r.workOrders.map((w) => ({ workOrderId: w.workOrderId, workOrderNo: w.workOrderNo, batchNumber: w.batchNumber }));
  return [{ workOrderId: r.workOrderId, workOrderNo: r.workOrderNo, batchNumber: r.batchNumber }];
}

export const MODE_LABELS: Record<MultiPartyMode, string> = {
  PER_PARTY: `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk}`,
  SINGLE: `Tek ${TERIM.terbiyeIsEmri.tekilKucuk} (partiler ayrı top)`,
};
