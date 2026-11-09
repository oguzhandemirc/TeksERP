// =============================================================================
// "Kalite Kontrol" ekranının yeri var mı — yer listesinden (work-session/places)
// =============================================================================
// Ekran yalnız kurşunsuz muayeneli PROCESS_QC istasyonu (`isQualityOnlyStation`)
// varsa görünür. Yer listesini MainNavigator çeker ve buraya yazar; görünür ekran
// hesabı (useVisibleScreens) sorgu sağlayıcısı istemeden buradan okur.
// =============================================================================

import { create } from 'zustand';
import { isQualityOnlyStation, type ScreenStation } from '../constants/stationScreens';

interface QualityStationState {
  /** Yer listesinde Kalite Kontrol istasyonu var mı (liste gelene dek false = bugünkü düzen). */
  hasQualityStation: boolean;
  setFromPlaces: (places: readonly ScreenStation[]) => void;
}

export const useQualityStationStore = create<QualityStationState>((set) => ({
  hasQualityStation: false,
  setFromPlaces: (places) => set({ hasQualityStation: places.some((p) => isQualityOnlyStation(p)) }),
}));
