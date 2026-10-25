// =============================================================================
// Muayene taslak deposu (K4P-TABLET, plan §4.1 md. 3) — anahtar = konak kimliği + top ref'i
// =============================================================================
// Taslak cihazda kalıcıdır (AsyncStorage; uygulama çökse de döner), sunucuya yazılmaz. Anahtar
// konak + top ayırır: başka konağın/topun taslağı görünmez (KK1'de ref = konağın doğuş anahtarı).
// Hydrate'ten önce diske yazılmaz ve bellekteki (daha yeni) taslak diskteki ile birleşince kazanır.
// =============================================================================
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { EMPTY_DRAFT, inspectionDraftReducer, isDraftEmpty, type DraftAction, type InspectionDraft } from './inspectionDraft';

const STORAGE_KEY = 'TEKSERP_INSPECTION_DRAFTS_V1';
/** Yarım kalmış taslak tavanı (en yeniler kalır) — terk edilmiş toplar diski şişirmesin. */
export const INSPECTION_DRAFT_MAX = 20;

/** Taslak anahtarı — iki parça da zorunlu; ayraç parçalarda geçemez (çakışma olmasın). */
export function inspectionDraftKey(hostId: string, rollRef: string): string {
  return `${hostId.replace(/\|/g, '/')}|${rollRef.replace(/\|/g, '/')}`;
}

/** Diskten okunan değerin biçim süzgeci — bozuk kayıt taslağı kirletmez. */
export function sanitizeDrafts(raw: unknown): Record<string, InspectionDraft> {
  const out: Record<string, InspectionDraft> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<InspectionDraft> | null;
    if (!d || !Array.isArray(d.defects)) continue;
    const defects = d.defects.filter((x) => !!x && typeof x.id === 'string' && typeof x.defectTypeId === 'string' && typeof x.points === 'number');
    const draft = { defects, note: typeof d.note === 'string' ? d.note : '', inspectedLengthM: typeof d.inspectedLengthM === 'number' ? d.inspectedLengthM : null };
    if (!isDraftEmpty(draft)) out[k] = draft;
  }
  return out;
}

function capDrafts(drafts: Record<string, InspectionDraft>): Record<string, InspectionDraft> {
  const keys = Object.keys(drafts);
  if (keys.length <= INSPECTION_DRAFT_MAX) return drafts;
  return Object.fromEntries(keys.slice(-INSPECTION_DRAFT_MAX).map((k) => [k, drafts[k]!]));
}

function persist(drafts: Record<string, InspectionDraft>, hydrated: boolean): void {
  if (!hydrated) return;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)).catch(() => {});
}

interface DraftStoreState {
  drafts: Record<string, InspectionDraft>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  dispatch: (key: string, action: DraftAction) => void;
  /** Hata geri yüklemesi (kayıt reddedildi): taslak yalnız ekrandaki boşsa döner. */
  restore: (key: string, draft: InspectionDraft) => void;
}

export const useInspectionDraftStore = create<DraftStoreState>((set, get) => ({
  drafts: {},
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const loaded = sanitizeDrafts(raw ? JSON.parse(raw) : {});
      set((s) => {
        const drafts = capDrafts({ ...loaded, ...s.drafts });
        persist(drafts, true);
        return { drafts, hydrated: true };
      });
    } catch {
      set({ hydrated: true });
    }
  },
  dispatch: (key, action) =>
    set((s) => {
      const next = inspectionDraftReducer(s.drafts[key] ?? EMPTY_DRAFT, action);
      const drafts = { ...s.drafts };
      delete drafts[key];
      // Dokunulan anahtar sona taşınır: tavan en eski dokunulanı düşürür.
      if (!isDraftEmpty(next)) drafts[key] = next;
      const capped = capDrafts(drafts);
      persist(capped, s.hydrated);
      return { drafts: capped };
    }),
  restore: (key, draft) =>
    set((s) => {
      if (isDraftEmpty(draft) || (s.drafts[key] && !isDraftEmpty(s.drafts[key]!))) return s;
      const drafts = capDrafts({ ...s.drafts, [key]: draft });
      persist(drafts, s.hydrated);
      return { drafts };
    }),
}));

export function useInspectionDraft(key: string): InspectionDraft {
  useEffect(() => {
    void useInspectionDraftStore.getState().hydrate();
  }, []);
  return useInspectionDraftStore((s) => s.drafts[key] ?? EMPTY_DRAFT);
}
