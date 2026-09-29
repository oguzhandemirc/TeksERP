// =============================================================================
// Lisans kapısı sinyalleri — api interceptor'ı yazar, kök katman okur
// =============================================================================
// Interceptor bir 403 LICENSE_* gördüğünde buraya not düşer: `suspended` K5 tam
// ekranını açar, `blockSeq` durum sorgusunu tazeler (bant/kademe beklemeden yenilensin).
// Store `services/api`yi import etmez → döngü yok (authStore emsali).
// =============================================================================

import { create } from 'zustand';

interface LicenseSignalState {
  /** Bu oturumda sunucu K5 (LICENSE_SUSPENDED) ile reddetti mi? */
  suspended: boolean;
  /** Her lisans reddinde artar — durum sorgusunun tazeleme tetiği. */
  blockSeq: number;
  noteBlock: (suspended: boolean) => void;
  clearSuspended: () => void;
}

export const useLicenseStore = create<LicenseSignalState>((set) => ({
  suspended: false,
  blockSeq: 0,
  noteBlock: (suspended) =>
    set((s) => ({ blockSeq: s.blockSeq + 1, suspended: s.suspended || suspended })),
  clearSuspended: () => set({ suspended: false }),
}));
