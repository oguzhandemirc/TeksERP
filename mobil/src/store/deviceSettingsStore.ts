import { create } from 'zustand';
import { storage } from '../utils/storage';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';
const QUICK_WO_MODE_KEY = 'device_quick_wo_mode';

/** Hızlı İş Emri formu arayüz modu — cihaza kayıtlı (operatör tercihi). */
export type QuickWoMode = 'simple' | 'advanced';

interface DeviceSettingsState {
  /** true → barkod ekranlarında manuel giriş input'ları görünür. Default false:
   *  operatör sadece kamerayı kullanır, ekran daha minimal. Kamera arızalıysa
   *  Ayarlar'dan açılır. */
  manualBarcodeEntry: boolean;
  /** Hızlı İş Emri "Yeni" formu: 'simple' (reçete/şablon odaklı, az alan) veya
   *  'advanced' (renk/en/metraj/sipariş bağlama vb. tüm alanlar). Cihazda kalıcı —
   *  operatör bir sonraki açılışta aynı arayüzü görür. Default 'simple'. */
  quickWoMode: QuickWoMode;
  isLoaded: boolean;

  init: () => Promise<void>;
  setManualBarcodeEntry: (v: boolean) => Promise<void>;
  setQuickWoMode: (v: QuickWoMode) => Promise<void>;
}

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  quickWoMode: 'simple',
  isLoaded: false,

  init: async () => {
    const [stored, quickMode] = await Promise.all([
      storage.getItem(MANUAL_BARCODE_KEY),
      storage.getItem(QUICK_WO_MODE_KEY),
    ]);
    set({
      manualBarcodeEntry: stored === 'true',
      quickWoMode: quickMode === 'advanced' ? 'advanced' : 'simple',
      isLoaded: true,
    });
  },

  setManualBarcodeEntry: async (v) => {
    await storage.setItem(MANUAL_BARCODE_KEY, v ? 'true' : 'false');
    set({ manualBarcodeEntry: v });
  },

  setQuickWoMode: async (v) => {
    await storage.setItem(QUICK_WO_MODE_KEY, v);
    set({ quickWoMode: v });
  },
}));
