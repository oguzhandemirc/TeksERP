// =============================================================================
// Çalışma oturumu store'u — aktif oturum + son yer (tek kaynak: backend)
// =============================================================================
// `active` = bu cihazın açık WorkSession'ı. SessionGate ekran/oturum eşleşmesini
// buradan denetler; useMachinePeripherals queryKey'ine `active.id` girer (yer
// değişince donanım tazelenir). `lastPlace` server-side hafızadır (GET current) —
// cihaz storage'ı silinse de "Sarım-2'desiniz, doğru mu?" önerisi kaybolmaz.
//
// init() YALNIZ login sonrası ve kullanıcının oturumlu ekranı varsa çağrılır
// (MainNavigator) — auth'suz çağrı 401 toast'ı üretirdi. Ağ hatasında isLoaded
// yine true olur (gate onay akışına düşer, kilitlenme yok).
// =============================================================================

import { create } from 'zustand';
import {
  workSessionService,
  type ActiveWorkSession,
  type LastPlace,
} from '../services/workSession.service';
import { useSessionEntriesStore } from './sessionEntriesStore';

interface SessionState {
  active: ActiveWorkSession | null;
  lastPlace: LastPlace | null;
  isLoaded: boolean;
  /** GET current — login sonrası bir kez + gerektiğinde refresh. */
  init: () => Promise<void>;
  /** Oturum aç (PlaceConfirm onayı). MACHINE_OCCUPIED hatasını ÇAĞIRANA fırlatır. */
  openSession: (input: {
    machineId?: string;
    stationId?: string;
    confirmTakeover?: boolean;
  }) => Promise<ActiveWorkSession>;
  /** Oturumu kapat (logout / manuel). Best-effort — offline'da yerel state yine temizlenir. */
  closeSession: () => Promise<void>;
  /** 409 WORK_SESSION_REQUIRED (idle/devralındı/zorla kapatıldı) → yerel oturumu
   *  düşür; SessionGate yeniden yer onayı ister. Sunucuya istek ATMAZ. */
  clearActive: () => void;
  /** Logout'ta store'u sıfırla (kullanıcıya bağlı kalıntı kalmasın). */
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  active: null,
  lastPlace: null,
  isLoaded: false,

  init: async () => {
    try {
      const { active, lastPlace } = await workSessionService.current();
      set({ active, lastPlace, isLoaded: true });
    } catch {
      // Ağ/izin hatası — gate onay akışına düşer; öneri (lastPlace) sadece kaybolur.
      set({ isLoaded: true });
    }
  },

  openSession: async (input) => {
    const session = await workSessionService.open(input);
    set({
      active: session,
      lastPlace: {
        machine: session.machine ? { ...session.machine, isActive: true } : null,
        station: { ...session.station, isActive: true },
      },
    });
    return session;
  },

  closeSession: async () => {
    // isLoaded=false ŞART: yalnız active=null bırakılırsa, logout API çağrısı
    // sürerken hâlâ mount olan SessionGate "oturum yok" görüp PlaceConfirmView'i
    // açar → autoOpen ÇIKIŞ SIRASINDA yeni oturum yaratırdı (loglarda close'un
    // hemen ardından POST /work-sessions 201 — hayalet oturum). isLoaded=false
    // gate'i spinner'da tutar; sonraki girişte init() yeniden yükler.
    set({ active: null, isLoaded: false });
    try {
      await workSessionService.close();
    } catch {
      // Offline logout'u bloklamaz — sunucudaki oturum bir sonraki girişte
      // NEW_LOGIN ile, o da olmazsa idle zaman aşımıyla kapanır.
    }
  },

  clearActive: () => {
    if (get().active) set({ active: null });
  },

  reset: () => {
    // "Bu oturumda girilenler" listeleri de oturumla ölür (çıkış/operatör değişimi).
    useSessionEntriesStore.getState().clearAll();
    set({ active: null, lastPlace: null, isLoaded: false });
  },
}));
