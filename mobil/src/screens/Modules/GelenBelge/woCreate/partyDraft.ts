// Çok partili belge (S1, fabrika cevabı 16/17) — saf parçalar: sunucunun parti özeti (`GET /irsaliyeler/:id/partiler`) →
// satırın düzenlenebilir parti listesi + kip; kayıt kapısı ve gövde parçası. Kural sunucudadır (uyarılar oradan gelir).
import { TERIM } from '../../../../lib/terim';
import type { CreateWorkOrderFromNoteBody, CreateWorkOrderFromNoteResult, MultiPartyMode, NoteParty, NotePartiesView } from '../../../../services/inboundDoc.service';

export interface PartyRow {
  blockNo: number;
  batchNo: string;
  meters: number | null;
  /** Belge masası: parti başına plan makinesi / gramaj (yok = gövdedeki ortak değer). */
  machineId?: string | null;
  gramajValueId?: string | null;
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

export interface OpenedWo {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string | null;
  /** Önceki denemede açılmıştı (PER_PARTY yeniden gönderim): yeniden basılmaz. */
  existing?: boolean;
  blockNos?: number[];
}

/** Açılan iş emirleri: çok partide sunucu listeyi verir; eski sunucu / tek parti → tek kayıt. */
export function openedWorkOrders(r: CreateWorkOrderFromNoteResult): OpenedWo[] {
  if (r.workOrders && r.workOrders.length > 0) {
    return r.workOrders.map((w) => ({ workOrderId: w.workOrderId, workOrderNo: w.workOrderNo, batchNumber: w.batchNumber, existing: w.existing === true, blockNos: w.blockNos }));
  }
  return [{ workOrderId: r.workOrderId, workOrderNo: r.workOrderNo, batchNumber: r.batchNumber }];
}

/** Parti kartı başlığı: belgeden okunan künye (eski sunucuda işlem / müşteri İE no yok → yazılmaz). */
export function partyHeading(blockNo: number, p: NoteParty | undefined): string {
  if (!p) return `${blockNo}. parti`;
  const parts = [
    `${blockNo}. parti`,
    `${p.lineCount} satır${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ''}`,
    p.orderNo ? `Sipariş ${p.orderNo}` : null,
    p.processText ? `İşlem: ${p.processText}` : null,
    p.senderWorkOrderNo ? `Müşteri İE ${p.senderWorkOrderNo}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Kaydın parti başına sonucu: açıldı (İE no) | açılamadı (neden) | henüz yok. */
export type PartyOutcome = { kind: 'OPENED'; workOrderNo: string } | { kind: 'FAILED'; message: string } | null;

export function partyOutcome(
  result: { workOrders: OpenedWo[]; failed?: { blockNo: number; message: string }[] } | null,
  blockNo: number,
): PartyOutcome {
  if (!result) return null;
  const fail = result.failed?.find((f) => f.blockNo === blockNo);
  if (fail) return { kind: 'FAILED', message: fail.message };
  const wo = result.workOrders.find((w) => w.blockNos?.includes(blockNo));
  return wo ? { kind: 'OPENED', workOrderNo: wo.workOrderNo } : null;
}

/** K1 (2026-11-06): fabrika varsayılanı "her parti ayrı" ise kip seçimi gösterilmez — kaç parti o kadar İE. */
export const showModeChoice = (view: NotePartiesView): boolean => view.defaultMode !== 'PER_PARTY';

export const MODE_LABELS: Record<MultiPartyMode, string> = {
  PER_PARTY: `Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk}`,
  SINGLE: `Tek ${TERIM.terbiyeIsEmri.tekilKucuk} (partiler ayrı top)`,
};
