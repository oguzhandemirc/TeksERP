// Belge Tara → onay kartı → iş emri (T2, P3'ün tablet karşılığı) — saf görünüm parçaları.
// Kural sunucudadır: kip sinyali detaydaki `perDocument` (yalnız PER_DOCUMENT iken gelir), engel `perDocument.code`;
// buradaki kapı yalnız düğmenin ne diyeceğini ve neden pasif olduğunu seçer — onay sunucuda yine ön kontrolden geçer.
import { TERIM } from '../../../lib/terim';
import type {
  ApproveNoteResult,
  BatchNoCandidate,
  InboundNoteDetail,
  InboundNotePatch,
  MeterCandidateValue,
} from '../../../services/inboundDoc.service';
import { fmtKursunMeters, KURSUN_SOURCE_TEXT } from './readResult';

const OPEN_STATUSES = new Set(['DRAFT', 'PARTIAL']);

/** Kart yalnız yeni backend + PER_DOCUMENT kipinde (`perDocument` var) ve belge hâlâ onaylanabilirken çıkar. */
export function showsApprovalCard(d: InboundNoteDetail | null | undefined): d is InboundNoteDetail {
  return !!d && d.perDocument !== undefined && OPEN_STATUSES.has(d.status);
}

export type ApprovalAction = 'APPROVE' | 'SAVE_DRAFT';

export interface MeterChoice {
  role: 'output' | 'total' | 'input' | 'lineSum';
  label: string;
  value: number;
  text: string;
}

export interface ApprovalCardView {
  action: ApprovalAction;
  label: string;
  blocked: boolean;
  reasons: string[];
  /** Sunucunun geçen ama haber verdiği kapı notları (WARN kipinde gözden geçirilmemiş metre). */
  warnings: string[];
  batch: { value: string | null; candidates: BatchNoCandidate[]; hint: string | null };
  meters: { text: string | null; review: boolean; choices: MeterChoice[] };
  /** "Doğrula" düğmesi: metre var ve gözden geçirme bekliyor. */
  canVerify: boolean;
}

const ROLE_LABEL: Record<MeterChoice['role'], string> = { output: 'Çıkış', total: 'Toplam', input: 'Giriş', lineSum: 'Satır toplamı' };

function meterNumber(v: MeterCandidateValue | undefined): number | null {
  const raw = v != null && typeof v === 'object' ? v.value : v;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Belgedeki metre kaynakları (dokunulunca o değer elle onaylanır). Aynı değer bir kez listelenir. */
export function meterChoices(d: InboundNoteDetail): MeterChoice[] {
  const out: MeterChoice[] = [];
  const c = d.kursunMeterCandidates ?? {};
  for (const role of ['output', 'total', 'input', 'lineSum'] as const) {
    const n = meterNumber(c[role]);
    if (n === null || out.some((x) => x.value === n)) continue;
    out.push({ role, label: ROLE_LABEL[role], value: n, text: `${fmtKursunMeters(n)} m` });
  }
  return out;
}

export function approvalCardView(d: InboundNoteDetail, opts: { canApprove: boolean }): ApprovalCardView {
  const m = d.kursunMeters != null && d.kursunMeters !== '' ? fmtKursunMeters(d.kursunMeters) : null;
  const src = d.kursunMetersSource ? KURSUN_SOURCE_TEXT[d.kursunMetersSource] : undefined;
  const review = m !== null && !!d.kursunMetersReview;
  const candidates = d.batchNoCandidates ?? [];
  const batchValue = d.ourBatchNo || null;
  const batchHint = batchValue
    ? null
    : candidates.length > 1
      ? `Parti no seçin (${candidates.length} aday)`
      : 'Belgede parti no yok — seriden verilecek';
  const base = {
    warnings: d.perDocument?.warnings ?? [],
    batch: { value: batchValue, candidates, hint: batchHint },
    meters: { text: m === null ? null : src ? `${m} m (${src})` : `${m} m`, review, choices: meterChoices(d) },
    canVerify: review,
  };
  if (!opts.canApprove) {
    return {
      ...base,
      action: 'SAVE_DRAFT',
      label: 'Taslak olarak bırak',
      blocked: false,
      reasons: [`Onay yetkiniz yok: belge taslak kalır, ${TERIM.terbiyeIsEmri.tekilKucuk} yetkili kişi panelden onaylayınca açılır.`],
    };
  }
  const reasons: string[] = [];
  if (!d.ownerCustomerId) reasons.push('Müşteriyi seçin.');
  if (d.perDocument?.code === 'KURSUN_METERS_REQUIRED') reasons.push('Kurşun metresi yok — metreyi girin.');
  if (d.perDocument?.code === 'KURSUN_METERS_REVIEW_PENDING') reasons.push('Kurşun metresini doğrulayın ya da düzeltin.');
  return { ...base, action: 'APPROVE', label: `Onayla ve ${TERIM.terbiyeIsEmri.tekilKucuk} aç`, blocked: reasons.length > 0, reasons };
}

/** Aday seçimi PATCH gövdesi: anahtarlı aday hatırlamaya girer; anahtarsız değer elle yazılmış sayılır. */
export function batchPatch(c: BatchNoCandidate): InboundNotePatch {
  const key = c.key ?? c.field ?? null;
  return key ? { ourBatchNo: c.value, ourBatchNoKey: key } : { ourBatchNo: c.value };
}

/** Elle girilen metre: virgül/nokta ondalık; ≤ 0 ya da sayı değilse null (mutasyon çağrılmaz). */
export function parseMeters(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  // "4.521" binlik, "4.521,5" binlik+ondalık, "198,1" / "198.1" ondalık.
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

export interface ApproveResultView {
  tone: 'ok' | 'warn';
  title: string;
  lines: string[];
}

/** Onay sonucu: açılan iş emirleri, elle açılacak gruplar, genel neden ve sunucu uyarıları — hepsi yanıttan. */
export function approveResultView(r: ApproveNoteResult): ApproveResultView {
  const auto = r.autoWorkOrders;
  const opened = (auto?.groups ?? []).filter((g) => g.outcome === 'OPENED' && g.workOrderNumber).map((g) => g.workOrderNumber!);
  const lines: string[] = [];
  if (r.note.status === 'PARTIAL') lines.push('Belge kısmen girildi; kalan kayıt panelde yeniden onaylanır.');
  for (const g of auto?.groups ?? []) {
    if (g.outcome !== 'OPENED') lines.push(`${g.itemName}: ${g.reason ?? 'elle açılmalı'}`);
  }
  if (auto?.reason) lines.push(auto.reason);
  if (!auto) lines.push(`${TERIM.terbiyeIsEmri.tekil} otomatik açılmadı; Hızlı ${TERIM.terbiyeIsEmri.tekil} ekranından açın.`);
  lines.push(...r.warnings);
  const title = opened.length
    ? `${TERIM.terbiyeIsEmri.tekil} açıldı: ${opened.join(', ')}`
    : `Belge ${r.note.noteNo} onaylandı`;
  return { tone: opened.length && r.note.status !== 'PARTIAL' && !(auto?.manual ?? 0) ? 'ok' : 'warn', title, lines };
}
