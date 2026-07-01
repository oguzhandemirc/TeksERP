import { create } from 'zustand';
import { storage } from '../utils/storage';
import type { BtPrinter } from '../services/btPrinter.service';
import { peripheralService } from '../services/peripheral.service';

// =============================================================================
// Seçili Bluetooth etiket yazıcısı — cihaz-bazlı kalıcı tercih (sunucudan
// bağımsız; yazıcı tablete bağlı, operatöre değil). Seçili yazıcı varsa
// LabelPrinter native→BT yolunu kullanır; yoksa HTML+expo-print'e düşer.
// `language` = bu yazıcının konuştuğu dil; backend'e languageOverride olarak
// senkronlanır → o cihazın etiketleri bu dilde render edilir (global'a düşmez).
// =============================================================================

const BT_PRINTER_KEY = 'bt_label_printer';

export type PrinterLang = 'PPLA' | 'PPLB' | 'ZPL';
export const BT_PRINTER_LANGS: PrinterLang[] = ['PPLB', 'PPLA', 'ZPL'];

interface BtPrinterState {
  printer: BtPrinter | null;
  language: PrinterLang;
  isLoaded: boolean;
  init: () => Promise<void>;
  setPrinter: (p: BtPrinter | null) => Promise<void>;
  setLanguage: (lang: PrinterLang) => Promise<void>;
}

async function persist(printer: BtPrinter | null, language: PrinterLang): Promise<void> {
  if (printer) {
    await storage.setItem(BT_PRINTER_KEY, JSON.stringify({ address: printer.address, name: printer.name, language }));
  } else {
    await storage.deleteItem(BT_PRINTER_KEY);
  }
}

// Merkezî cihaz kaydına senkronla (LAN-only, fire-and-forget). languageOverride ile
// backend bu cihazın etiketlerini seçilen dilde render eder (resolver: override > model > global).
function syncBackend(printer: BtPrinter | null, language: PrinterLang): void {
  if (printer) {
    void peripheralService
      .registerBtPrinter({ address: printer.address, name: printer.name, languageOverride: language })
      .catch(() => undefined);
  }
}

export const useBtPrinterStore = create<BtPrinterState>((set, get) => ({
  printer: null,
  language: 'PPLB',
  isLoaded: false,

  init: async () => {
    const raw = await storage.getItem(BT_PRINTER_KEY);
    let printer: BtPrinter | null = null;
    let language: PrinterLang = 'PPLB';
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { address?: string; name?: string; language?: string };
        if (parsed && typeof parsed.address === 'string') {
          printer = {
            address: parsed.address,
            name: typeof parsed.name === 'string' && parsed.name ? parsed.name : parsed.address,
          };
          if (parsed.language && BT_PRINTER_LANGS.includes(parsed.language as PrinterLang)) {
            language = parsed.language as PrinterLang;
          }
        }
      } catch {
        printer = null; // bozuk kayıt → seçimsiz başla
      }
    }
    set({ printer, language, isLoaded: true });
  },

  setPrinter: async (p) => {
    const language = get().language;
    await persist(p, language);
    set({ printer: p });
    syncBackend(p, language);
  },

  setLanguage: async (lang) => {
    const printer = get().printer;
    await persist(printer, lang);
    set({ language: lang });
    syncBackend(printer, lang); // dil değişince (yazıcı seçiliyse) yeniden kaydet
  },
}));
