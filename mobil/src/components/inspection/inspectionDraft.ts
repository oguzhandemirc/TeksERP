// =============================================================================
// Muayene TASLAĞI — saf reducer (K4P-TABLET, plan §4.1 md. 2–4)
// =============================================================================
// Taslak cihazda kalır, sunucuya yazılmaz; kaydı konak yapar. Yerel özet yalnız SAYIMdır
// (hata sayısı, puan toplamı): puan/100 m² ve derece sunucunun önizleme ucundan gelir —
// formül aynası yazılmaz. Payload içi (metre, tür) tekrarı burada UX için reddedilir; karar sunucuda.
// =============================================================================
import type { InspectionSizeClass } from './inspectionModel';

export interface DraftDefect {
  id: string;
  defectTypeId: string;
  /** null = sabit puanlı tür (boyut sorulmadı). */
  sizeClass: InspectionSizeClass | null;
  /** null = konumsuz kayıt (metre girilmedi). */
  meter: number | null;
  points: number;
}

export interface InspectionDraft {
  defects: DraftDefect[];
  note: string;
  inspectedLengthM: number | null;
}

export const EMPTY_DRAFT: InspectionDraft = { defects: [], note: '', inspectedLengthM: null };

export type DraftAction =
  | { type: 'add'; id: string; defectTypeId: string; meter: number | null; sizeClass?: InspectionSizeClass; fixedPoints?: number | null }
  | { type: 'remove'; id: string }
  | { type: 'undoLast' }
  | { type: 'clear' }
  | { type: 'setNote'; note: string }
  | { type: 'setInspectedLength'; value: number | null };

const SIZE_POINTS: Record<InspectionSizeClass, number> = { S1: 1, S2: 2, S3: 3, S4: 4 };

/** Kaydın puanı: sabit puanlı tür boyuttan bağımsızdır; değilse boyut sınıfı (1–4). null = boyut eksik. */
export function draftPointsOf(sizeClass: InspectionSizeClass | null | undefined, fixedPoints: number | null | undefined): number | null {
  if (fixedPoints != null) return fixedPoints;
  return sizeClass ? SIZE_POINTS[sizeClass] : null;
}

/** Aynı metrede aynı tür ikinci kez mi? (konumsuz kayıtlar tekrar sayılmaz — sunucu da saymaz). */
export function isDuplicateInDraft(draft: InspectionDraft, defectTypeId: string, meter: number | null): boolean {
  if (meter == null) return false;
  return draft.defects.some((d) => d.defectTypeId === defectTypeId && d.meter != null && Math.abs(d.meter - meter) < 0.0005);
}

export function inspectionDraftReducer(draft: InspectionDraft, action: DraftAction): InspectionDraft {
  switch (action.type) {
    case 'add': {
      const points = draftPointsOf(action.sizeClass, action.fixedPoints);
      if (points == null || isDuplicateInDraft(draft, action.defectTypeId, action.meter)) return draft;
      const sizeClass = action.fixedPoints != null ? null : (action.sizeClass ?? null);
      const row: DraftDefect = { id: action.id, defectTypeId: action.defectTypeId, sizeClass, meter: action.meter, points };
      return { ...draft, defects: [...draft.defects, row] };
    }
    case 'remove':
      return { ...draft, defects: draft.defects.filter((d) => d.id !== action.id) };
    case 'undoLast':
      return draft.defects.length === 0 ? draft : { ...draft, defects: draft.defects.slice(0, -1) };
    case 'clear':
      return EMPTY_DRAFT;
    case 'setNote':
      return { ...draft, note: action.note };
    case 'setInspectedLength':
      return { ...draft, inspectedLengthM: action.value != null && action.value > 0 ? action.value : null };
    default:
      return draft;
  }
}

/** Yerel özet — yalnız SAYIM (karar değil). */
export function draftCounts(draft: InspectionDraft): { defectCount: number; totalPoints: number } {
  return { defectCount: draft.defects.length, totalPoints: draft.defects.reduce((n, d) => n + d.points, 0) };
}

export function isDraftEmpty(draft: InspectionDraft): boolean {
  return draft.defects.length === 0 && draft.note.trim() === '' && draft.inspectedLengthM == null;
}
