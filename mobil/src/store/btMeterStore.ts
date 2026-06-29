import { create } from 'zustand';
import { storage } from '../utils/storage';
import type { BtMeterDevice } from '../services/btMeter.service';

// =============================================================================
// 2-kat / 4-kat makine metre okuyucuları — cihaz-bazlı kalıcı tercih (sunucudan
// bağımsız; HC-06 modülleri tablete eşleşir, operatöre değil). Tambur "Otomatik"
// kesim modunda foldType'a göre ilgili makineden metre okunur. Seçim yoksa veya
// donanım/derleme yoksa çağıran simülasyona düşer.
//
// İki cihaz + ortak sorgu komutu (İSTEK-CEVAP) tek JSON blob olarak saklanır.
// =============================================================================

const BT_METER_KEY = 'bt_meter_config';

export type FoldKey = '2-KAT' | '4-KAT';

interface BtMeterState {
  device2Kat: BtMeterDevice | null;
  device4Kat: BtMeterDevice | null;
  /** Makineye yollanacak ortak sorgu komutu (boş = sadece dinle). */
  pollCommand: string;
  /**
   * Simülasyon modu — AÇIKken makineye hiç bağlanmaz, sahte metre üretir (test /
   * donanımsız geliştirme). KAPALIyken (varsayılan) gerçek makineden okunur;
   * okunamazsa kesim yapılmaz (sessiz sahte değer YOK).
   */
  simulationEnabled: boolean;
  isLoaded: boolean;
  init: () => Promise<void>;
  setDevice: (kat: FoldKey, d: BtMeterDevice | null) => Promise<void>;
  setPollCommand: (cmd: string) => Promise<void>;
  setSimulationEnabled: (on: boolean) => Promise<void>;
}

/** foldType → ilgili makinenin cihazı (4-KAT dışındaki her şey 2-KAT sayılır). */
export function meterDeviceFor(
  state: Pick<BtMeterState, 'device2Kat' | 'device4Kat'>,
  foldType: string | null | undefined,
): BtMeterDevice | null {
  return foldType === '4-KAT' ? state.device4Kat : state.device2Kat;
}

function sanitize(raw: unknown): BtMeterDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<BtMeterDevice>;
  if (typeof p.address !== 'string' || !p.address) return null;
  return { address: p.address, name: typeof p.name === 'string' && p.name ? p.name : p.address };
}

export const useBtMeterStore = create<BtMeterState>((set, get) => {
  const persist = async () => {
    const { device2Kat, device4Kat, pollCommand, simulationEnabled } = get();
    await storage.setItem(
      BT_METER_KEY,
      JSON.stringify({ device2Kat, device4Kat, pollCommand, simulationEnabled }),
    );
  };

  return {
    device2Kat: null,
    device4Kat: null,
    pollCommand: '',
    simulationEnabled: false,
    isLoaded: false,

    init: async () => {
      const raw = await storage.getItem(BT_METER_KEY);
      let device2Kat: BtMeterDevice | null = null;
      let device4Kat: BtMeterDevice | null = null;
      let pollCommand = '';
      let simulationEnabled = false;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          device2Kat = sanitize(parsed.device2Kat);
          device4Kat = sanitize(parsed.device4Kat);
          pollCommand = typeof parsed.pollCommand === 'string' ? parsed.pollCommand : '';
          simulationEnabled = parsed.simulationEnabled === true;
        } catch {
          // bozuk kayıt → seçimsiz başla
        }
      }
      set({ device2Kat, device4Kat, pollCommand, simulationEnabled, isLoaded: true });
    },

    setDevice: async (kat, d) => {
      set(kat === '4-KAT' ? { device4Kat: d } : { device2Kat: d });
      await persist();
    },

    setPollCommand: async (cmd) => {
      set({ pollCommand: cmd });
      await persist();
    },

    setSimulationEnabled: async (on) => {
      set({ simulationEnabled: on });
      await persist();
    },
  };
});
