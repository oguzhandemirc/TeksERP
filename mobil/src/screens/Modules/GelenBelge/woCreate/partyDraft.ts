// Çok partili belge (S1, fabrika cevabı 16/17) — saf parçalar: sunucunun parti özeti (`GET /irsaliyeler/:id/partiler`) →
// satırın düzenlenebilir parti listesi + kip; kayıt kapısı ve gövde parçası. Kural sunucudadır (uyarılar oradan gelir).
import { TERIM } from '../../../../lib/terim';
import { fmtMeters } from '../../../../utils/meters';
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

/**
 * Forma ilk metre: onaylı partide KAYITLI metre (elle düzeltme dahil), yoksa sunucunun önerisi (beyan ara toplamı önce),
 * eski sunucuda Σ satır; seçim kuralı istemcide kurulmaz.
 */
const partyMeters = (p: NoteParty): number | null => {
  const m = p.recordedMeters ?? p.suggestedMeters ?? p.meters;
  return m > 0 ? m : null;
};

/** Çok parti (≥2) ise satırlar + fabrika varsayılan kipi; tek/bölümsüz belgede (ya da eski sunucuda) null = bugünkü form. */
export function initialMultiParty(view: NotePartiesView | null | undefined): MultiPartyDraft | null {
  if (!view?.multi || view.parties.length < 2) return null;
  return {
    rows: view.parties.map((p) => ({ blockNo: p.blockNo, batchNo: p.batchNo ?? '', meters: partyMeters(p) })),
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

/** Parti künyesinin parçaları (kartta ayrı ayrı kırılır, kelime ortasında bölünmez); eski sunucu alanları yoksa yazılmaz. */
export function partyFacts(p: NoteParty | undefined): string[] {
  if (!p) return [];
  return [
    `${p.lineCount} satır${p.declaredTopCount !== null ? ` / ${p.declaredTopCount} TOP` : ''}`,
    p.orderNo ? `Sipariş ${p.orderNo}` : null,
    p.processText ? `İşlem: ${p.processText}` : null,
    p.senderWorkOrderNo ? `Müşteri İE ${p.senderWorkOrderNo}` : null,
    // Onaylı partide kayıtlı metre ≠ okunan Σ satır → ayrı bilgi olarak (panel Partiler kartıyla aynı).
    p.recordedMeters != null && Math.abs(p.recordedMeters - p.meters) > 0.0005 ? `Satır toplamı ${fmtMeters(p.meters)} m` : null,
  ].filter((x): x is string => !!x);
}

/** Parti kartı başlığı tek satırda (ekran okuyucu etiketi): "1. parti · künye…". */
export function partyHeading(blockNo: number, p: NoteParty | undefined): string {
  return [`${blockNo}. parti`, ...partyFacts(p)].join(' · ');
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

/**
 * Kısmi sonuç özeti (kartın en üstü): "2/3 parti açıldı · 1 parti açılamadı — nedeni kartında; düzeltip yeniden kaydedin".
 * Sonuç yoksa ya da hepsi açıldıysa null (tam başarıda satır zaten kapanır).
 */
export function partyResultSummary(
  result: { workOrders: OpenedWo[]; failed?: { blockNo: number; message: string }[] } | null,
  blockNos: number[],
): string | null {
  if (!result) return null;
  const failed = blockNos.filter((b) => partyOutcome(result, b)?.kind === 'FAILED').length;
  if (failed === 0) return null;
  const opened = blockNos.filter((b) => partyOutcome(result, b)?.kind === 'OPENED').length;
  return `${opened}/${blockNos.length} parti açıldı · ${failed} parti açılamadı — nedeni kartında; düzeltip yeniden kaydedin`;
}
