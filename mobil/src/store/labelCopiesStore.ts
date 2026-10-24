import { create } from 'zustand';

// Operatörün seçicide değiştirdiği adet — yalnız BİR baskı için yaşar (take() sıfırlar).
// İstasyon kimliğiyle saklanır: başka istasyona geçilince eski seçim uygulanmaz.
interface LabelCopiesState {
  override: { stationId: string | null; value: number } | null;
  setOverride: (stationId: string | null, value: number) => void;
  reset: () => void;
}

export const useLabelCopiesStore = create<LabelCopiesState>((set) => ({
  override: null,
  setOverride: (stationId, value) => set({ override: { stationId, value } }),
  reset: () => set({ override: null }),
}));
