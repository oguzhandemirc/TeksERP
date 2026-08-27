import { create } from "zustand";

/**
 * Sürüm notları penceresinin açılış durumu.
 *
 * Neden store: aynı pencereyi ÜÇ ayrı yer açıyor — açılıştaki otomatik tetik
 * (AppShell), Ayarlar sayfasındaki kart ve sidebar'daki sürüm yazısı. Üçü de
 * aynı bileşene basmalı ki pencere tek bir yerde yaşasın.
 */
export type SurumNotuKip =
  /** Açılışta otomatik: yalnız bu makinede HENÜZ GÖRÜLMEMİŞ yayınlar. */
  | "yeni"
  /** Ayarlar'dan elle: bu ürünü ilgilendiren TÜM geçmiş. */
  | "tumu";

interface SurumNotuStore {
  acik: boolean;
  kip: SurumNotuKip;
  ac: (kip: SurumNotuKip) => void;
  kapat: () => void;
}

export const useSurumNotuStore = create<SurumNotuStore>((set) => ({
  acik: false,
  kip: "tumu",
  ac: (kip) => set({ acik: true, kip }),
  kapat: () => set({ acik: false }),
}));
