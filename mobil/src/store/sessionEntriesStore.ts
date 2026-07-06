// =============================================================================
// sessionEntriesStore — "Bu oturumda girilenler" (bölüm-başına, GİRİŞ OTURUMU ömürlü)
// =============================================================================
// Liste EKRANA değil GİRİŞ OTURUMUNA bağlıdır: Bölüm Değiş ile ana menüye çıkıp
// AYNI bölüme dönmek, makine/istasyon değiştirmek, araya başka bölüme bakmak
// listeyi SIFIRLAMAZ (ekran unmount olsa da store yaşar). Yalnız çıkış /
// operatör değişimi temizler (sessionStore.reset → clearAll) — "oturum" = login.
//
// Model: bölüm (StationKind) başına kova { rolls, pending }.
//  - addPending: kayıt GÖNDERİLDİ (optimistik; çevrimdışı kuyruk dahil) → sayaç.
//  - confirmRoll: sunucu onayladı → pending düşer, top listeye girer (tavan 200).
//  - failPending: kayıt reddedildi → pending geri alınır (sayaç şişmez).
// Görünen sayaç = rolls.length + pending; modal "N çevrimdışı bekliyor" farkını
// pending'den türetir.
// =============================================================================

import { create } from 'zustand';
import type { Roll } from '../types/models';

interface Bucket {
  rolls: Roll[];
  pending: number;
}

interface SessionEntriesState {
  /** key = StationKind ('RAW_QC' | 'PROCESS_QC' | 'TAMBUR' | …) */
  buckets: Record<string, Bucket>;
  addPending: (kind: string) => void;
  confirmRoll: (kind: string, roll: Roll) => void;
  failPending: (kind: string) => void;
  /** Çıkış / operatör değişimi — tüm kovalar boşalır. */
  clearAll: () => void;
}

const MAX_ROLLS = 200;
const EMPTY: Bucket = { rolls: [], pending: 0 };

export const useSessionEntriesStore = create<SessionEntriesState>((set) => ({
  buckets: {},

  addPending: (kind) =>
    set((s) => {
      const b = s.buckets[kind] ?? EMPTY;
      return { buckets: { ...s.buckets, [kind]: { ...b, pending: b.pending + 1 } } };
    }),

  confirmRoll: (kind, roll) =>
    set((s) => {
      const b = s.buckets[kind] ?? EMPTY;
      return {
        buckets: {
          ...s.buckets,
          [kind]: {
            pending: Math.max(0, b.pending - 1),
            // Aynı top iki kez onaylanırsa (retry) tekrar etmesin; en yeni başa.
            rolls: [roll, ...b.rolls.filter((r) => r.id !== roll.id)].slice(0, MAX_ROLLS),
          },
        },
      };
    }),

  failPending: (kind) =>
    set((s) => {
      const b = s.buckets[kind] ?? EMPTY;
      return {
        buckets: { ...s.buckets, [kind]: { ...b, pending: Math.max(0, b.pending - 1) } },
      };
    }),

  clearAll: () => set({ buckets: {} }),
}));
