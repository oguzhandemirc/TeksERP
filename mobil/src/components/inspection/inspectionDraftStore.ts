// =============================================================================
// Muayene taslak deposu (K4P-TABLET, plan §4.1 md. 3) — anahtar = konak kimliği + top ref'i
// =============================================================================
// Taslak cihazdadır, sunucuya yazılmaz. Anahtar konak + top ayırır: başka konağın ya da başka
// topun taslağı burada görünmez (KK1'de top doğmadığı için ref = konağın doğuş anahtarı).
// =============================================================================
import { create } from 'zustand';
import { EMPTY_DRAFT, inspectionDraftReducer, type DraftAction, type InspectionDraft } from './inspectionDraft';

/** Taslak anahtarı — iki parça da zorunlu; ayraç parçalarda geçemez (çakışma olmasın). */
export function inspectionDraftKey(hostId: string, rollRef: string): string {
  return `${hostId.replace(/\|/g, '/')}|${rollRef.replace(/\|/g, '/')}`;
}

interface DraftStoreState {
  drafts: Record<string, InspectionDraft>;
  dispatch: (key: string, action: DraftAction) => void;
  /** Hata geri yüklemesi (kayıt reddedildi): taslak aynen döner. */
  restore: (key: string, draft: InspectionDraft) => void;
}

export const useInspectionDraftStore = create<DraftStoreState>((set) => ({
  drafts: {},
  dispatch: (key, action) =>
    set((s) => {
      const next = inspectionDraftReducer(s.drafts[key] ?? EMPTY_DRAFT, action);
      const drafts = { ...s.drafts };
      if (next === EMPTY_DRAFT) delete drafts[key];
      else drafts[key] = next;
      return { drafts };
    }),
  restore: (key, draft) => set((s) => ({ drafts: { ...s.drafts, [key]: draft } })),
}));

export function useInspectionDraft(key: string): InspectionDraft {
  return useInspectionDraftStore((s) => s.drafts[key] ?? EMPTY_DRAFT);
}
