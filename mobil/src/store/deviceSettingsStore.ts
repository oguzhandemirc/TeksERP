import { create } from 'zustand';
import { storage } from '../utils/storage';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';
const LAST_ROUTE_KEY = 'device_quick_wo_last_route';
const KK1_MANUAL_METER_KEY = 'device_kk1_manual_meter';
const TAMBUR_CUT_MODE_KEY = 'device_tambur_cut_mode';

/** Metraj kaynağı: makineden oku (auto) ya da operatör elle girsin (manual). */
export type MeterEntryMode = 'manual' | 'auto';

interface DeviceSettingsState {
  /** true → barkod ekranlarında manuel giriş input'ları görünür. Default false:
   *  operatör sadece kamerayı kullanır, ekran daha minimal. Kamera arızalıysa
   *  Ayarlar'dan açılır. (Hızlı İş Emri bunu "bu cihazda kamera kullanılamıyor"
   *  sinyali sayar ve "Listeden Ekle" butonunu görünür kılar.) */
  manualBarcodeEntry: boolean;
  /** Hızlı İş Emri'nde son kullanılan rota şablonu — yeni form açılışında otomatik
   *  seçili gelir (saha genelde aynı rotayı kullanır). null = yok. */
  lastRouteTemplateId: string | null;
  /** KK1 "Manuel Giriş": true → mt/kg elle girilir, false → makineden okunur.
   *  CİHAZDA kalıcı — operatör her girişte tercihini yeniden yapmasın (metre
   *  makinesi arızalı bir istasyonda vardiya boyunca manuel kalır). */
  kk1ManualEntry: boolean;
  /** Tambur kesim metrajı: elle mi, makineden mi. Ana kesim ve "Top Kesme"
   *  AYNI tercihi paylaşır (bilinçli): seçim aslında "bu istasyonda metre
   *  makinesi çalışıyor mu" gerçeğini yansıtır, o da tek bir gerçektir. */
  tamburCutMode: MeterEntryMode;
  isLoaded: boolean;

  init: () => Promise<void>;
  setManualBarcodeEntry: (v: boolean) => Promise<void>;
  setLastRouteTemplateId: (v: string | null) => Promise<void>;
  setKk1ManualEntry: (v: boolean) => Promise<void>;
  setTamburCutMode: (v: MeterEntryMode) => Promise<void>;
}

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  lastRouteTemplateId: null,
  kk1ManualEntry: false,
  tamburCutMode: 'manual',
  isLoaded: false,

  init: async () => {
    const [stored, lastRoute, kk1Manual, tamburMode] = await Promise.all([
      storage.getItem(MANUAL_BARCODE_KEY),
      storage.getItem(LAST_ROUTE_KEY),
      storage.getItem(KK1_MANUAL_METER_KEY),
      storage.getItem(TAMBUR_CUT_MODE_KEY),
    ]);
    set({
      manualBarcodeEntry: stored === 'true',
      lastRouteTemplateId: lastRoute || null,
      kk1ManualEntry: kk1Manual === 'true',
      // Bilinmeyen/bozuk değer → varsayılan 'manual' (kayıt yoksa da öyle).
      tamburCutMode: tamburMode === 'auto' ? 'auto' : 'manual',
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

  // Ekrandaki anahtar ANINDA dönsün diye önce state, sonra disk (yazma hatası
  // arayüzü kilitlemez; en kötü ihtimalle tercih o cihazda kalıcı olmaz).
  setKk1ManualEntry: async (v) => {
    set({ kk1ManualEntry: v });
    await storage.setItem(KK1_MANUAL_METER_KEY, v ? 'true' : 'false');
  },

  setTamburCutMode: async (v) => {
    set({ tamburCutMode: v });
    await storage.setItem(TAMBUR_CUT_MODE_KEY, v);
  },
}));
