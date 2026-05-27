import { create } from 'zustand';
import { storage } from '../utils/storage';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';

interface DeviceSettingsState {
  /** true → barkod ekranlarında manuel giriş input'ları görünür. Default false:
   *  operatör sadece kamerayı kullanır, ekran daha minimal. Kamera arızalıysa
   *  Ayarlar'dan açılır. */
  manualBarcodeEntry: boolean;
  isLoaded: boolean;

  init: () => Promise<void>;
  setManualBarcodeEntry: (v: boolean) => Promise<void>;
}

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  isLoaded: false,

  init: async () => {
    const stored = await storage.getItem(MANUAL_BARCODE_KEY);
    set({
      manualBarcodeEntry: stored === 'true',
      isLoaded: true,
    });
  },

  setManualBarcodeEntry: async (v) => {
    await storage.setItem(MANUAL_BARCODE_KEY, v ? 'true' : 'false');
    set({ manualBarcodeEntry: v });
  },
}));
