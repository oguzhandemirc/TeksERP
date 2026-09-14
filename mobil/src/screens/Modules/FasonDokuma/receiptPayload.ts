// =============================================================================
// FASON DOKUMA KABUL YÜKÜ — form → backend `receiptSchema` (birebir) · saf, jest ölçer
// =============================================================================
// Satır: metre ZORUNLU pozitif; en/kg boş = null ("0" ≠ girilmedi); kalite ≤ 16;
// renk boş = işin rengi (null). Sunucu `failed[]` döndürürse o satırlar FORMDA
// KALIR (kısmi kabul: doğan toplar kabul edildi, düşen satırlar yeniden gönderilir).
// =============================================================================
import type { FasonReceiptRequest, FasonReceiptResult, FasonReceiptRollPayload } from '../../../services/fasonDokuma.service';

export interface ReceiptRowForm {
  initialQty: string;
  width: string;
  weightKg: string;
  qualityGrade: string;
  colorId: string | null;
}

export const EMPTY_RECEIPT_ROW: ReceiptRowForm = { initialQty: '', width: '', weightKg: '', qualityGrade: '', colorId: null };

export type RowValidation = { ok: true } | { ok: false; message: string };

export function validateReceiptRow(r: ReceiptRowForm): RowValidation {
  const m = Number(r.initialQty);
  if (r.initialQty.trim() === '' || !Number.isFinite(m) || m <= 0) return { ok: false, message: 'Metre pozitif olmalı' };
  for (const [ad, v] of [
    ['En', r.width],
    ['Kg', r.weightKg],
  ] as const) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { ok: false, message: `${ad} negatif olamaz` };
  }
  if (r.qualityGrade.trim().length > 16) return { ok: false, message: 'Kalite en fazla 16 karakter' };
  return { ok: true };
}

export function rowToPayload(r: ReceiptRowForm): FasonReceiptRollPayload {
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v));
  return { initialQty: Number(r.initialQty), width: num(r.width), weightKg: num(r.weightKg), qualityGrade: r.qualityGrade.trim() || null, colorId: r.colorId };
}

export function buildReceiptRequest(
  rows: ReceiptRowForm[],
  ctx: { weavingOrderId: string; manifestNo: string; notes: string; clientToken: string }
): FasonReceiptRequest {
  return {
    weavingOrderId: ctx.weavingOrderId,
    manifestNo: ctx.manifestNo.trim() || null,
    notes: ctx.notes.trim() || null,
    clientToken: ctx.clientToken,
    rolls: rows.map(rowToPayload),
  };
}

/** Sunucu cevabı → formda KALACAK satırlar (düşenler, mesajıyla). Hepsi doğduysa boş. */
export function rowsAfterReceipt(rows: ReceiptRowForm[], res: FasonReceiptResult): { rows: ReceiptRowForm[]; messages: string[] } {
  const failedIdx = new Set(res.failed.map((f) => f.index));
  return {
    rows: rows.filter((_, i) => failedIdx.has(i)),
    messages: res.failed.map((f) => `Satır ${f.index + 1}: ${f.message}`),
  };
}

/** Parmak izi: iş + satır sayısı + toplam metre — aynı deneme aynı token alsın. */
export function receiptFingerprint(weavingOrderId: string, rows: ReceiptRowForm[]): string {
  const total = rows.reduce((s, r) => s + (Number(r.initialQty) || 0), 0);
  return [weavingOrderId, String(rows.length), total.toFixed(2)].join('|');
}

export function validateReturn(lengthM: string, sentM: number): RowValidation {
  const n = Number(lengthM);
  if (lengthM.trim() === '' || !Number.isFinite(n) || n < 0) return { ok: false, message: 'Dönen metre negatif olamaz' };
  if (n > sentM) return { ok: false, message: `Dönen metre gideni (${sentM} m) aşamaz` };
  return { ok: true };
}
