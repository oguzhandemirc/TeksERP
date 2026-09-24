import { create } from "zustand";

/**
 * "Bu güncellemede neler değişti" penceresinin açılış durumu. Açılıştaki
 * otomatik tetik (`useSurumNotuAcilis`) açar, pencere (`SurumNotlariDialog`)
 * kapatır. Geçmişin tamamı pencerede değil Sürüm Notları SAYFASINDA okunur.
 */
interface SurumNotuStore {
  acik: boolean;
  ac: () => void;
  kapat: () => void;
}

export const useSurumNotuStore = create<SurumNotuStore>((set) => ({
  acik: false,
  ac: () => set({ acik: true }),
  kapat: () => set({ acik: false }),
}));
