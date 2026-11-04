// Toplar ayrı geldi (Gülkesim fason) — saf parçalar: belgenin top satırları (`docRolls`) → düzenlenebilir top listesi;
// kayıt kapısı ve gövde parçası. Tek iş emri açılır, her satır ayrı top doğar; kural sunucudadır.
import type { CreateWorkOrderFromNoteBody, DocRoll } from '../../../../services/inboundDoc.service';

export interface RollRow {
  /** Satır kimliği (React anahtarı + düzenleme); sunucuya gitmez. */
  key: string;
  meters: number | null;
  weightKg: number | null;
  senderRollNo: string;
}

/** Sunucu sözleşmesi: 1–200 top. */
export const ROLLS_MAX = 200;

let seq = 0;
export const newRollKey = (): string => `top-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function emptyRoll(): RollRow {
  return { key: newRollKey(), meters: null, weightKg: null, senderRollNo: '' };
}

/** Belgede top satırları okunduysa onlardan dolu; yoksa 1 boş satır (operatör top top girer). */
export function initialRolls(docRolls: readonly DocRoll[] | null | undefined): RollRow[] {
  const rows = (docRolls ?? []).slice(0, ROLLS_MAX).map((r) => ({
    key: newRollKey(),
    meters: r.meters > 0 ? r.meters : null,
    weightKg: r.weightKg !== null && r.weightKg > 0 ? r.weightKg : null,
    senderRollNo: r.senderRollNo ?? '',
  }));
  return rows.length > 0 ? rows : [emptyRoll()];
}

export function rollIssues(rows: readonly RollRow[]): string[] {
  if (rows.length === 0) return ['En az bir top girin.'];
  const out: string[] = [];
  if (rows.length > ROLLS_MAX) out.push(`En fazla ${ROLLS_MAX} top girilebilir.`);
  const missing = rows.map((r, i) => (r.meters === null || !(r.meters > 0) ? `${i + 1}. top` : null)).filter((x): x is string => !!x);
  if (missing.length) out.push(`Top metresi eksik: ${missing.join(', ')}.`);
  return out;
}

export const rollsTotal = (rows: readonly RollRow[]): number => Math.round(rows.reduce((s, r) => s + (r.meters ?? 0), 0) * 1000) / 1000;

/** Gövdeye top listesi eklenir; kurşun metresi top toplamıdır (tek iş emri, her top ayrı). */
export function withRolls(body: CreateWorkOrderFromNoteBody, rows: readonly RollRow[]): CreateWorkOrderFromNoteBody {
  return {
    ...body,
    kursunMeters: String(rollsTotal(rows)),
    rollMode: 'SEPARATE',
    rolls: rows.map((r) => ({
      meters: r.meters ?? 0,
      weightKg: r.weightKg !== null && r.weightKg > 0 ? r.weightKg : null,
      senderRollNo: r.senderRollNo.trim() || null,
    })),
  };
}
