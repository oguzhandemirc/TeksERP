// =============================================================================
// LEVENT ETİKETİ KUYRUĞU — kalıcı (zustand + AsyncStorage), KK1 `printQueue` emsali
// =============================================================================
// Sarım OK → levent etiketi işi kuyruğa düşer; pompa (`WarpBeamLabelPrinter`) sırayla basar.
// Basılamayan iş SİLİNMEZ, `error`la kalır ("etiketi çıkmadı" satırı + Tekrar bas) — kâğıtsız
// levent, operatörü leventi yeniden planlamaya iter (KK1 07.08 hayalet top dersi). Etiket içeriği
// her baskıda sunucudan CANLI çekilir; kuyruk yalnız kimlik + görünen no taşır. Bekleyen +
// başarısız TEK listede (iki depo = aynı iş iki yerde sınıfı). `activeId` RAM'de: restart'ta
// yarıda kalan iş bekleyene döner (at-least-once; fazla kâğıt atılır, eksik kâğıt asıl hata).
// =============================================================================
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'TEKSERP_BEAM_LABEL_QUEUE_V1';
export const BEAM_LABEL_QUEUE_MAX = 30;
export const BEAM_LABEL_TTL_MS = 48 * 60 * 60 * 1000;

export interface BeamLabelJob {
  beamId: string;
  beamNo: string;
  queuedAt: number;
  /** Doluysa iş BAŞARISIZ (Türkçe neden); boşsa bekleyen/basılan. */
  error?: string;
}

/** Aynı levent ikinci kez eklenirse tek iş kalır ve bekleyene döner (Tekrar bas = yeniden ekle). */
export function enqueueJob(jobs: readonly BeamLabelJob[], beamId: string, beamNo: string, now: number): BeamLabelJob[] {
  return pruneJobs([...jobs.filter((j) => j.beamId !== beamId), { beamId, beamNo, queuedAt: now }], now);
}

export function markJobDone(jobs: readonly BeamLabelJob[], beamId: string): BeamLabelJob[] {
  return jobs.filter((j) => j.beamId !== beamId);
}

export function markJobFailed(jobs: readonly BeamLabelJob[], beamId: string, error: string): BeamLabelJob[] {
  return jobs.map((j) => (j.beamId === beamId ? { ...j, error: error.trim() || 'Yazıcıya gönderilemedi' } : j));
}

/** Sıradaki bekleyen (en eski); başarısızlar elle Tekrar bekler. */
export function nextPending(jobs: readonly BeamLabelJob[]): BeamLabelJob | null {
  return jobs.find((j) => !j.error) ?? null;
}

/** Hydrate emniyeti: TTL + tavan (en yeniler kalır). */
export function pruneJobs(jobs: readonly BeamLabelJob[], now: number): BeamLabelJob[] {
  return jobs.filter((j) => now - j.queuedAt <= BEAM_LABEL_TTL_MS).slice(-BEAM_LABEL_QUEUE_MAX);
}

function persist(jobs: BeamLabelJob[], hydrated = true): void {
  // Hydrate'ten ÖNCE diske yazılmaz: okunmamış diskteki işleri ezerdi; hydrate birleşimi yazar.
  if (!hydrated) return;
  // Fire-and-forget — sarım akışını disk yazımı geciktirmesin.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs })).catch(() => {});
}

interface BeamLabelQueueState {
  jobs: BeamLabelJob[];
  activeId: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  enqueue: (beamId: string, beamNo: string) => void;
  setActive: (beamId: string | null) => void;
  done: (beamId: string) => void;
  fail: (beamId: string, error: string) => void;
  remove: (beamId: string) => void;
}

export const useBeamLabelQueue = create<BeamLabelQueueState>((set, get) => ({
  jobs: [],
  activeId: null,
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      const list = Array.isArray((parsed as { jobs?: unknown })?.jobs) ? (parsed as { jobs: unknown[] }).jobs : [];
      const loaded = list.filter((j): j is BeamLabelJob => !!j && typeof (j as BeamLabelJob).beamId === 'string' && typeof (j as BeamLabelJob).beamNo === 'string');
      // MERGE (printQueue dersi): hydrate'ten önce eklenen bellekteki iş YENİdir ve kazanır.
      set((s) => {
        const jobs = pruneJobs([...loaded.filter((l) => !s.jobs.some((j) => j.beamId === l.beamId)), ...s.jobs], Date.now());
        persist(jobs);
        return { jobs, hydrated: true };
      });
    } catch {
      set({ hydrated: true });
    }
  },
  enqueue: (beamId, beamNo) => {
    const jobs = enqueueJob(get().jobs, beamId, beamNo, Date.now());
    persist(jobs, get().hydrated);
    set({ jobs });
  },
  setActive: (beamId) => set({ activeId: beamId }),
  done: (beamId) => {
    const jobs = markJobDone(get().jobs, beamId);
    persist(jobs, get().hydrated);
    set({ jobs, activeId: null });
  },
  fail: (beamId, error) => {
    const jobs = markJobFailed(get().jobs, beamId, error);
    persist(jobs, get().hydrated);
    set({ jobs, activeId: null });
  },
  remove: (beamId) => {
    const jobs = markJobDone(get().jobs, beamId);
    persist(jobs, get().hydrated);
    set({ jobs });
  },
}));

/** Sarım yanıtı → etiket işleri: levent + raşel kardeşleri (TEK giriş: her iki SAR yolu `useBeamMutations` üstünden). */
export function enqueueWoundLabels(wound: { id: string; beamNo: string; siblings?: { id: string; beamNo: string }[] } | null | undefined): void {
  if (!wound) return;
  const q = useBeamLabelQueue.getState();
  q.enqueue(wound.id, wound.beamNo);
  for (const s of wound.siblings ?? []) q.enqueue(s.id, s.beamNo);
}
