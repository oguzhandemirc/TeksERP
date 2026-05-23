import { create } from 'zustand';

// =============================================================================
// Sevkiyat oturumu — operatörün aktif sipariş + havuz state'i
// =============================================================================
// Pool (havuz): operatör taradı ama henüz çuvala koymadığı toplar. Tamamen
// local state — server'a yansımaz. Roll çuvala atılınca server çağrısı yapılır
// ve pool'dan çıkar.
// =============================================================================

export interface PoolRoll {
  rollId: string;
  barcode: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  colorHex: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
}

interface State {
  activeQueueId: string | null;
  activeOrderId: string | null;
  activeCustomerId: string | null;
  pool: PoolRoll[];
}

interface Actions {
  startSession: (data: {
    queueId: string;
    orderId: string;
    customerId: string;
  }) => void;
  endSession: () => void;
  addToPool: (roll: PoolRoll) => void;
  removeFromPool: (rollId: string) => void;
  clearPool: () => void;
}

export const useShippingSessionStore = create<State & Actions>((set, get) => ({
  activeQueueId: null,
  activeOrderId: null,
  activeCustomerId: null,
  pool: [],

  startSession: ({ queueId, orderId, customerId }) =>
    set({
      activeQueueId: queueId,
      activeOrderId: orderId,
      activeCustomerId: customerId,
      pool: [],
    }),

  endSession: () =>
    set({
      activeQueueId: null,
      activeOrderId: null,
      activeCustomerId: null,
      pool: [],
    }),

  addToPool: (roll) => {
    const exists = get().pool.find((r) => r.rollId === roll.rollId);
    if (exists) return;
    set((s) => ({ pool: [...s.pool, roll] }));
  },

  removeFromPool: (rollId) =>
    set((s) => ({ pool: s.pool.filter((r) => r.rollId !== rollId) })),

  clearPool: () => set({ pool: [] }),
}));
