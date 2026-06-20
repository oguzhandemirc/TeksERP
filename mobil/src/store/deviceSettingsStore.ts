import { create } from 'zustand';
import { storage } from '../utils/storage';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';
const LAST_ROUTE_KEY = 'device_quick_wo_last_route';
const LAST_TEMPLATE_KEY = 'device_quick_wo_last_template';

interface DeviceSettingsState {
  /** true → barkod ekranlarında manuel giriş input'ları görünür. Default false:
   *  operatör sadece kamerayı kullanır, ekran daha minimal. Kamera arızalıysa
   *  Ayarlar'dan açılır. */
  manualBarcodeEntry: boolean;
  /** Hızlı İş Emri'nde son kullanılan rota şablonu — yeni form açılışında otomatik
   *  seçili gelir (saha genelde aynı rotayı kullanır). null = yok. */
  lastRouteTemplateId: string | null;
  /** Hızlı İş Emri'nde son kullanılan iş emri şablonu (ProductRecipe). null = yok. */
  lastWoTemplateId: string | null;
  isLoaded: boolean;

  init: () => Promise<void>;
  setManualBarcodeEntry: (v: boolean) => Promise<void>;
  setLastRouteTemplateId: (v: string | null) => Promise<void>;
  setLastWoTemplateId: (v: string | null) => Promise<void>;
}

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  lastRouteTemplateId: null,
  lastWoTemplateId: null,
  isLoaded: false,

  init: async () => {
    const [stored, lastRoute, lastTemplate] = await Promise.all([
      storage.getItem(MANUAL_BARCODE_KEY),
      storage.getItem(LAST_ROUTE_KEY),
      storage.getItem(LAST_TEMPLATE_KEY),
    ]);
    set({
      manualBarcodeEntry: stored === 'true',
      lastRouteTemplateId: lastRoute || null,
      lastWoTemplateId: lastTemplate || null,
      isLoaded: true,
    });
  },

  setManualBarcodeEntry: async (v) => {
    await storage.setItem(MANUAL_BARCODE_KEY, v ? 'true' : 'false');
    set({ manualBarcodeEntry: v });
  },

  setLastRouteTemplateId: async (v) => {
    if (v) await storage.setItem(LAST_ROUTE_KEY, v);
    else await storage.deleteItem(LAST_ROUTE_KEY);
    set({ lastRouteTemplateId: v });
  },

  setLastWoTemplateId: async (v) => {
    if (v) await storage.setItem(LAST_TEMPLATE_KEY, v);
    else await storage.deleteItem(LAST_TEMPLATE_KEY);
    set({ lastWoTemplateId: v });
  },
}));
