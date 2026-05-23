import { create } from 'zustand';
import { storage } from '../utils/storage';
import { getOrCreateDeviceId } from '../utils/deviceId';

interface PairedMachine {
  id: string;
  code: string;
  name: string;
  stationId: string;
  stationName: string;
}

interface DeviceState {
  deviceId: string | null;
  paired: PairedMachine | null;
  isLoading: boolean;

  init: () => Promise<void>;
  setPaired: (machine: PairedMachine) => Promise<void>;
  clearPairing: () => Promise<void>;
}

const PAIRING_KEY = 'device_paired_machine';

export const useDeviceStore = create<DeviceState>((set) => ({
  deviceId: null,
  paired: null,
  isLoading: true,

  init: async () => {
    try {
      const deviceId = await getOrCreateDeviceId();
      const raw = await storage.getItem(PAIRING_KEY);
      const paired = raw ? (JSON.parse(raw) as PairedMachine) : null;
      set({ deviceId, paired });
    } finally {
      set({ isLoading: false });
    }
  },

  setPaired: async (machine) => {
    await storage.setItem(PAIRING_KEY, JSON.stringify(machine));
    set({ paired: machine });
  },

  clearPairing: async () => {
    await storage.deleteItem(PAIRING_KEY);
    set({ paired: null });
  },
}));
