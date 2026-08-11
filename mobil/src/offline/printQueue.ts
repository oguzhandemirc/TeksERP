// =============================================================================
// printQueue — KALICI YAZICI KUYRUĞU (KK1 etiket baskı işleri)
// =============================================================================
// SORUN (2026-08-11 saha analizi, 07.08 vakası): yazıcı kuyruğu + başarısızlar
// listesi ekran state'indeydi (`useState`) — uygulama kapanınca/yeniden
// başlayınca liste SİLİNİYORDU. Kesintide biriken 4 etiketin izi böyle kayboldu;
// operatör topları sistemde yok sanıp YENİDEN girdi (stokta 4 hayalet top).
//
// TASARIM (failedOps emsali — zustand + AsyncStorage, fire-and-forget persist):
//   • Bekleyen + başarısız TEK listede yaşar; `error` alanı ayırır. İki ayrı
//     depo tutmak "aynı iş iki listede" sınıfı tutarsızlık üretirdi.
//   • `activeId` (şu an basılan) PERSIST EDİLMEZ: restart'ta yarıda kalan iş
//     bekleyene döner = AT-LEAST-ONCE. Bilinçli bedel: aynı barkodlu ikinci
//     kâğıt çıkabilir (kimlik aynı, operatör fazlasını atar); tersi — kâğıtsız
//     top — yeniden giriş refleksini tetikleyen asıl hatadır.
//   • Roll snapshot'ı yalnız KİMLİK + görünen ad için taşınır; etiket içeriği
//     her baskıda backend'den CANLI çekilir (bayat snapshot basılamaz).
//   • Pompa (LabelPrinter sürücüsü) YALNIZ KK1 ekranında mount'tur — kuyruk
//     başka ekranda basmaya kalkmaz; yazıcı oturumdan çözülür (fail-closed).
//
// OTOMATİK YENİDEN DENEME: yalnız `retryable` işaretli işler (içerik FETCH'i
// yanıtsız/timeout/5xx ile düşen). BT/eşleşme/dil-çözümü hataları ağla
// düzelmez — otomatik denemek sonsuz gürültü üretir, elle "Tekrar Dene" ister.
// Tavan `PRINT_AUTO_RETRY_MAX`: flap eden sunucuda (online↔offline osilasyonu)
// her kenarda bir deneme sonsuza dek sürerdi; 3'ten sonra iş elle bekler.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { Roll } from '../types/models';

const STORAGE_KEY = 'TEKSERP_PRINT_QUEUE_V1';
/** Kutu tavanı — dolup taşan kuyruk okunmaz hâle gelir (failedOps ile aynı). */
export const PRINT_QUEUE_MAX = 50;
/** Bu yaştan sonra baskı işi operasyonel olarak bayattır; kalıcı "basılmamış
 *  etiket" çetelesinin dayanıklı kaynağı kuyruk değil `Roll.labelPrintedAt`tır. */
export const PRINT_JOB_TTL_MS = 48 * 60 * 60 * 1000;
/** Ağ kaynaklı düşen iş en fazla bu kadar OTOMATİK yeniden denenir. */
export const PRINT_AUTO_RETRY_MAX = 3;

export interface PrintJob {
  /** Basılacak top — kimlik (id/barcode) + liste satırındaki görünen ad. */
  roll: Roll;
  queuedAt: number;
  /** Doluysa iş BAŞARISIZ (Türkçe hata metni); boşsa bekleyen/basılan. */
  error?: string;
  failedAt?: number;
  /** Ağ kaynaklı düşüş — online dönünce otomatik yeniden kuyruğa alınabilir. */
  retryable?: boolean;
  /** Kaç kez otomatik yeniden denendi (tavan: PRINT_AUTO_RETRY_MAX). */
  autoRetries: number;
  /** Son deneme OTOMATİK miydi — düşerse online-only modal'ı yeniden AÇILMAZ
   *  (operatör tetiklemedi, spam olur); elle denemenin düşüşü açar. */
  lastAuto: boolean;
}

/** Baskı sonucunun eklere ayrılmış hâli (LabelPrinter.onResult ile aynı şekil). */
export interface PrintResult {
  ok: boolean;
  cancelled: boolean;
  retryable?: boolean;
  error?: string;
}

interface PrintQueueState {
  jobs: PrintJob[];
  /** Şu an LabelPrinter'a verilen işin roll.id'si — RAM'de, persist edilmez. */
  activeId: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Kuyruğa al. Aynı top zaten bekliyor/basılıyorsa NO-OP (çift dokunuş 2
   *  kâğıt basmasın); başarısızdaysa bekleyene DÖNER (elle yeniden basım niyeti). */
  enqueue: (roll: Roll) => void;
  /** Pompa: aktif iş yokken ilk bekleyeni aktif yapar (KK1 effect'i çağırır). */
  startNext: () => void;
  /** Aktif işin sonucu: ok/iptal → iş düşer; hata → başarısız işaretlenir.
   *  Dönüş, ekranın "modal açayım mı" kararı için: {failed, wasAuto}. */
  resolveActive: (r: PrintResult) => { failed: boolean; wasAuto: boolean };
  /** onDone güvenlik ağı — onResult ÇAĞRILMAYAN yol (barkodsuz top erken
   *  dönüşü) aktif işi askıda bırakmasın. onResult işini yaptıysa no-op. */
  finishActive: (rollId: string) => void;
  /** Elle tekrar dene (modal satırı) — sayaç sıfırlanır, elle deneme sayılır. */
  retryJob: (rollId: string) => void;
  /** Banttaki tek dokunuş: TÜM başarısızlar bekleyene döner. */
  retryAllFailed: () => void;
  /** Satırı kuyruktan/başarısızlardan çıkar (aktif iş çıkarılamaz). */
  removeJob: (rollId: string) => void;
  /** Online'a dönüşte: retryable + tavanı aşmamış işler bekleyene döner. */
  requeueRetryable: () => number;
}

function persist(jobs: PrintJob[]): void {
  // Fire-and-forget — baskı akışını disk yazımı geciktirmesin (failedOps emsali).
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs)).catch(() => {});
}

export function prunePrintJobs(jobs: PrintJob[], now = Date.now()): PrintJob[] {
  const cutoff = now - PRINT_JOB_TTL_MS;
  return jobs.filter((j) => j.queuedAt >= cutoff).slice(-PRINT_QUEUE_MAX);
}

export const usePrintQueue = create<PrintQueueState>((set, get) => ({
  jobs: [],
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // Bozuk/eski JSON uygulamayı ÇÖKERTMEZ — kuyruk boş açılır.
      const jobs = Array.isArray(parsed)
        ? prunePrintJobs(
            parsed
              .filter(
                (j): j is PrintJob =>
                  !!j && typeof (j as PrintJob).roll?.id === 'string',
              )
              .map((j) => ({ ...j, autoRetries: j.autoRetries ?? 0, lastAuto: false })),
          )
        : [];
      set({ jobs, hydrated: true });
    } catch {
      set({ jobs: [], hydrated: true });
    }
  },

  enqueue: (roll) => {
    const { jobs } = get();
    const existing = jobs.find((j) => j.roll.id === roll.id);
    let next: PrintJob[];
    if (existing && !existing.error) return; // zaten bekliyor/basılıyor
    if (existing) {
      // Başarısız iş yeniden istendi → bekleyene dön (elle niyet, sayaç sıfır).
      next = jobs.map((j) =>
        j.roll.id === roll.id
          ? { ...j, roll, error: undefined, failedAt: undefined, autoRetries: 0, lastAuto: false }
          : j,
      );
    } else {
      next = prunePrintJobs([
        ...jobs,
        { roll, queuedAt: Date.now(), autoRetries: 0, lastAuto: false },
      ]);
    }
    set({ jobs: next });
    persist(next);
  },

  startNext: () => {
    const { jobs, activeId } = get();
    if (activeId !== null) return;
    const first = jobs.find((j) => !j.error);
    if (first) set({ activeId: first.roll.id });
  },

  resolveActive: (r) => {
    const { jobs, activeId } = get();
    const job = jobs.find((j) => j.roll.id === activeId);
    if (!job) return { failed: false, wasAuto: false };
    if (r.ok || r.cancelled) {
      // İptal de işi DÜŞÜRÜR (bugünkü davranış): operatör diyaloğu bilerek
      // kapattı — başarısız sayıp bantta "çıkmadı" demek yanlış alarm olur.
      const next = jobs.filter((j) => j.roll.id !== job.roll.id);
      set({ jobs: next, activeId: null });
      persist(next);
      return { failed: false, wasAuto: false };
    }
    const wasAuto = job.lastAuto;
    const next = jobs.map((j) =>
      j.roll.id === job.roll.id
        ? {
            ...j,
            error: r.error || 'Yazdırma hatası',
            failedAt: Date.now(),
            retryable: !!r.retryable,
          }
        : j,
    );
    set({ jobs: next, activeId: null });
    persist(next);
    return { failed: true, wasAuto };
  },

  finishActive: (rollId) => {
    const { jobs, activeId } = get();
    if (activeId !== rollId) return; // onResult zaten çözdü
    const next = jobs.filter((j) => j.roll.id !== rollId);
    set({ jobs: next, activeId: null });
    persist(next);
  },

  retryJob: (rollId) => {
    const { jobs } = get();
    const next = jobs.map((j) =>
      j.roll.id === rollId && j.error
        ? { ...j, error: undefined, failedAt: undefined, autoRetries: 0, lastAuto: false }
        : j,
    );
    set({ jobs: next });
    persist(next);
  },

  retryAllFailed: () => {
    const { jobs } = get();
    const next = jobs.map((j) =>
      j.error
        ? { ...j, error: undefined, failedAt: undefined, autoRetries: 0, lastAuto: false }
        : j,
    );
    set({ jobs: next });
    persist(next);
  },

  removeJob: (rollId) => {
    const { jobs, activeId } = get();
    if (activeId === rollId) return; // basılmakta olan çıkarılamaz (modal da listelemez)
    const next = jobs.filter((j) => j.roll.id !== rollId);
    set({ jobs: next });
    persist(next);
  },

  requeueRetryable: () => {
    const { jobs } = get();
    let count = 0;
    const next = jobs.map((j) => {
      if (!j.error || !j.retryable || j.autoRetries >= PRINT_AUTO_RETRY_MAX) return j;
      count += 1;
      return {
        ...j,
        error: undefined,
        failedAt: undefined,
        autoRetries: j.autoRetries + 1,
        lastAuto: true,
      };
    });
    if (count > 0) {
      set({ jobs: next });
      persist(next);
    }
    return count;
  },
}));

// -----------------------------------------------------------------------------
// Hata sınıflandırma — LabelPrinter'ın faz takibiyle birlikte kullanılır
// -----------------------------------------------------------------------------

/** Baskı akışının hangi aşamasında hata oluştu:
 *  'fetch'  = etiket içeriği backend'den çekilirken (ağ/sunucu yolu)
 *  'output' = fiziksel çıkış (BT soketi / eşleşme / expo-print)
 *  'prep'   = doğrulama/hazırlık (dil çözülemedi, boş HTML vb.) */
export type PrintPhase = 'prep' | 'fetch' | 'output';

/**
 * Otomatik yeniden denemeye UYGUN mu? Yalnız FETCH aşamasında yanıtsız
 * (timeout/ağ — status yok) ya da 5xx ile düşen hata: bunlar ağ/sunucu
 * düzelince kendiliğinden geçer. 4xx (top silinmiş, yetki) tekrarla
 * DÜZELMEZ; 'output'/'prep' hataları ağla ilgisizdir — otomatik denenmez.
 */
export function classifyPrintRetry(phase: PrintPhase, error: unknown): boolean {
  if (phase !== 'fetch') return false;
  const status = (error as { status?: number } | null)?.status;
  return status == null || status >= 500;
}
