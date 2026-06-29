import { create } from 'zustand';
import { storage } from '../utils/storage';
import type { BtPrinter } from '../services/btPrinter.service';
import { peripheralService } from '../services/peripheral.service';

// =============================================================================
// Seçili Bluetooth etiket yazıcısı — cihaz-bazlı kalıcı tercih (sunucudan
// bağımsız; yazıcı tablete bağlı, operatöre değil). Seçili yazıcı varsa
// LabelPrinter PPLA→BT yolunu kullanır; yoksa HTML+expo-print'e düşer.
// =============================================================================

const BT_PRINTER_KEY = 'bt_label_printer';

interface BtPrinterState {
  printer: BtPrinter | null;
  isLoaded: boolean;
  init: () => Promise<void>;
  setPrinter: (p: BtPrinter | null) => Promise<void>;
}

export const useBtPrinterStore = create<BtPrinterState>((set) => ({
  printer: null,
  isLoaded: false,

  init: async () => {
    const raw = await storage.getItem(BT_PRINTER_KEY);
    let printer: BtPrinter | null = null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<BtPrinter>;
        if (parsed && typeof parsed.address === 'string') {
          printer = {
            address: parsed.address,
            name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.address,
          };
        }
      } catch {
        printer = null; // bozuk kayıt → seçimsiz başla
      }
    }
    set({ printer, isLoaded: true });
  },

  setPrinter: async (p) => {
    if (p) await storage.setItem(BT_PRINTER_KEY, JSON.stringify(p));
    else await storage.deleteItem(BT_PRINTER_KEY);
    set({ printer: p });
    // Merkezî cihaz kaydına senkronla — admin görsün + yönlendirme merkezîleşsin.
    // LAN-only, fire-and-forget: UX'i bloklamaz, başarısızlık yerel seçimi bozmaz.
    if (p) {
      void peripheralService
        .registerBtPrinter({ address: p.address, name: p.name })
        .catch(() => undefined);
    }
  },
}));
