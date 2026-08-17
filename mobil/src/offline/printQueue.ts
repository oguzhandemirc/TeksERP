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
import { normalizeScanCode } from '../utils/scanCode';
import { create } from 'zustand';
import { isAmbiguousFailure } from './entryAttempt';
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

/** SCAN-BACK (print & verify) bekleyeni — basıldı, henüz GERİ OKUTULMADI.
 *  Yalnız `kk1.labelScanVerifyEnabled` bayrağı açıkken doğar (ekleyen KK1);
 *  bayrak kapalıyken liste hep boştur ve ekranda hiçbir iz yoktur. */
export interface VerifyItem {
  rollId: string;
  barcode: string;
  /** Bant/liste satırında görünen ad (opsiyonel). */
  itemName?: string;
  printedAt: number;
}

/** Doğrulama listesi tavanı — kuyruktan küçük: okutulmamış 20 etiket zaten
 *  operasyonel bir sorunun işaretidir, listeyi büyütmek çözüm değil. */
export const VERIFY_MAX = 20;

interface PrintQueueState {
  jobs: PrintJob[];
  /** Scan-back bekleyenleri — persist edilir (restart okutma borcunu silmesin). */
  verifies: VerifyItem[];
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
   *  Dönüş ekran kararları için: {failed, wasAuto, printedRoll} — `printedRoll`
   *  yalnız GERÇEK başarıda dolu (iptalde değil); scan-back bayrağı açıksa
   *  ekran onu `addVerify`e verir (store bayrağı bilmez, karar ekranın). */
  resolveActive: (r: PrintResult) => {
    failed: boolean;
    wasAuto: boolean;
    printedRoll: Roll | null;
  };
  /** Scan-back: basılan top okutma listesine girer (rollId ile dedup;
   *  barkodsuz top eklenmez — okutulacak kod yok). */
  addVerify: (roll: Roll) => void;
  /** Okutulan kodu listeyle eşle: 'ok' → satır düşer; 'unknown' → listede yok. */
  confirmVerify: (code: string) => 'ok' | 'unknown';
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

function persist(jobs: PrintJob[], verifies: VerifyItem[]): void {
  // Fire-and-forget — baskı akışını disk yazımı geciktirmesin (failedOps emsali).
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs, verifies })).catch(
    () => {},
  );
}

/**
 * Kuyruk budaması — İKİ KORUMA taşır (2026-08-11 inceleme bulguları):
 *  • `protectId` (aktif iş) NE TTL NE TAVAN ile atılır — aktif iş budanırsa
 *    `activeId` öksüz kalır ve pompa KALICI kilitlenirdi (startNext
 *    `activeId !== null` görüp hiç başlamaz; hata yok, log yok).
 *  • Tavan aşımında önce en eski BEKLEYENLER düşer, BAŞARISIZLAR korunur:
 *    başarısız satır "bu top KAYITLI, yeniden girme" KANITIDIR — kanıtı atıp
 *    yeniden basılabilir bekleyeni tutmak, 07.08 hayalet-top senaryosunu
 *    tavanda yeniden üretirdi. (Başarısızlar tek başına tavanı aşarsa son
 *    çare olarak en eskileri düşer — 50 başarısız zaten operasyonel alarmdır.)
 */
export function prunePrintJobs(
  jobs: PrintJob[],
  now = Date.now(),
  protectId?: string,
): PrintJob[] {
  const cutoff = now - PRINT_JOB_TTL_MS;
  const alive = jobs.filter((j) => j.queuedAt >= cutoff || j.roll.id === protectId);
  if (alive.length <= PRINT_QUEUE_MAX) return alive;
  const mustKeep = new Set(
    alive.filter((j) => j.error || j.roll.id === protectId),
  );
  const pending = alive.filter((j) => !mustKeep.has(j));
  const room = PRINT_QUEUE_MAX - mustKeep.size;
  const keepPending = new Set(room > 0 ? pending.slice(-room) : []);
  const kept = alive.filter((j) => mustKeep.has(j) || keepPending.has(j));
  return kept.length <= PRINT_QUEUE_MAX ? kept : kept.slice(-PRINT_QUEUE_MAX);
}

/** YALNIZ hydrate emniyeti (bozuk/şişmiş disk verisi): TTL + tavan. CANLI borç
 *  listesi bununla KIRPILMAZ — bkz. `addVerify` (sessiz af garantiyi deler). */
export function pruneVerifies(items: VerifyItem[], now = Date.now()): VerifyItem[] {
  const cutoff = now - PRINT_JOB_TTL_MS;
  return items.filter((v) => v.printedAt >= cutoff).slice(-VERIFY_MAX);
}

export const usePrintQueue = create<PrintQueueState>((set, get) => ({
  jobs: [],
  verifies: [],
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      // Bozuk JSON uygulamayı ÇÖKERTMEZ — kuyruk boş açılır.
      const rawJobs = Array.isArray((parsed as { jobs?: unknown })?.jobs)
        ? ((parsed as { jobs: unknown[] }).jobs)
        : [];
      const rawVerifies = Array.isArray((parsed as { verifies?: unknown })?.verifies)
        ? ((parsed as { verifies: unknown[] }).verifies)
        : [];
      const loadedJobs = rawJobs
        .filter(
          (j): j is PrintJob => !!j && typeof (j as PrintJob).roll?.id === 'string',
        )
        .map((j) => ({ ...j, autoRetries: j.autoRetries ?? 0, lastAuto: false }));
      const loadedVerifies = rawVerifies.filter(
        (v): v is VerifyItem =>
          !!v &&
          typeof (v as VerifyItem).rollId === 'string' &&
          typeof (v as VerifyItem).barcode === 'string',
      );
      // ⚠️ MERGE — tam-değiştirme DEĞİL (2026-08-11 inceleme bulgusu): hydrate
      // async'tir; yavaş diskte ilk kayıt/borç okuma bitmeden düşebilir. Tam
      // set() o kaydı bellekte EZER, öncesindeki persist() ise diskteki eski
      // defteri silmiş olur — iki yönde de sessiz kayıp. Bellekteki taraf
      // YENİdir ve kazanır; diskten yalnız bellekte olmayanlar eklenir.
      set((s) => {
        const jobs = prunePrintJobs(
          [
            ...loadedJobs.filter(
              (lj) => !s.jobs.some((j) => j.roll.id === lj.roll.id),
            ),
            ...s.jobs,
          ],
          Date.now(),
          s.activeId ?? undefined,
        );
        const verifies = pruneVerifies([
          ...loadedVerifies.filter(
            (lv) => !s.verifies.some((v) => v.rollId === lv.rollId),
          ),
          ...s.verifies,
        ]);
        persist(jobs, verifies);
        return { jobs, verifies, hydrated: true };
      });
    } catch {
      // Okuma düştü → bellekteki durum korunur (silme YOK), kutu açık kalır.
      set({ hydrated: true });
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
      // Aktif iş budamaya karşı KORUNUR (protectId) — atılırsa pompa kilitlenir.
      next = prunePrintJobs(
        [...jobs, { roll, queuedAt: Date.now(), autoRetries: 0, lastAuto: false }],
        Date.now(),
        get().activeId ?? undefined,
      );
    }
    set({ jobs: next });
    persist(next, get().verifies);
  },

  startNext: () => {
    const { jobs, activeId } = get();
    // ÖKSÜZ activeId onarımı (savunma hattı): aktif işin satırı bir şekilde
    // kaybolduysa (budama/dış temizlik) kilidi çöz — yoksa pompa sonsuza dek
    // "meşgulüm" der ve kuyruk sessizce donar.
    if (activeId !== null && jobs.some((j) => j.roll.id === activeId)) return;
    const first = jobs.find((j) => !j.error);
    set({ activeId: first ? first.roll.id : null });
  },

  resolveActive: (r) => {
    const { jobs, activeId } = get();
    const job = jobs.find((j) => j.roll.id === activeId);
    if (!job) {
      // Öksüz aktif kilit burada da çözülür (satır kaybolmuş olabilir).
      if (activeId !== null) set({ activeId: null });
      return { failed: false, wasAuto: false, printedRoll: null };
    }
    if (r.ok || r.cancelled) {
      // İptal de işi DÜŞÜRÜR (bugünkü davranış): operatör diyaloğu bilerek
      // kapattı — başarısız sayıp bantta "çıkmadı" demek yanlış alarm olur.
      const next = jobs.filter((j) => j.roll.id !== job.roll.id);
      set({ jobs: next, activeId: null });
      persist(next, get().verifies);
      // `printedRoll` yalnız GERÇEK baskıda döner — iptal edilen iş scan-back
      // borcu doğurmaz (kâğıt çıkmadı, okutulacak şey yok).
      return { failed: false, wasAuto: false, printedRoll: r.ok ? job.roll : null };
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
    persist(next, get().verifies);
    return { failed: true, wasAuto, printedRoll: null };
  },

  addVerify: (roll) => {
    if (!roll.barcode) return; // okutulacak kod yok (açık kumaş) — borç doğmaz
    const { jobs, verifies } = get();
    if (verifies.some((v) => v.rollId === roll.id)) return; // dedup (yeniden basım)
    // ⚠️ CANLI LİSTE TAVANLA KIRPILMAZ (2026-08-11 inceleme bulgusu): tavan
    // burada uygulansaydı 21. borç en eskisini SESSİZCE affederdi — o etiket
    // doğrulamadan kalıcı muaf olur ve bayrağın "basılan her etiket okutulur"
    // sözü kimse görmeden delinirdi. Yalnız TTL süzülür; tavan hydrate'te
    // (bozuk disk verisi emniyeti). 20+ borç birikmesi zaten alarm durumudur
    // ve bant sayacı bunu açıkça gösterir.
    const cutoff = Date.now() - PRINT_JOB_TTL_MS;
    const next = [
      ...verifies.filter((v) => v.printedAt >= cutoff),
      {
        rollId: roll.id,
        barcode: roll.barcode,
        itemName: roll.item?.name,
        printedAt: Date.now(),
      },
    ];
    set({ verifies: next });
    persist(jobs, next);
  },

  confirmVerify: (code) => {
    // Geri-okutma doğrulaması: kuyruktaki barkod sunucudan gelir (BÜYÜK harf).
    // Ham metinle karşılaştırılırsa tabancadan küçük harf gelen kod "bilinmeyen"
    // sayılır ve basılan etiket asla doğrulanmaz.
    const norm = normalizeScanCode(code);
    if (!norm) return 'unknown';
    const { jobs, verifies } = get();
    const hit = verifies.find((v) => v.barcode === norm);
    if (!hit) return 'unknown';
    const next = verifies.filter((v) => v.rollId !== hit.rollId);
    set({ verifies: next });
    persist(jobs, next);
    return 'ok';
  },

  finishActive: (rollId) => {
    const { jobs, activeId } = get();
    if (activeId !== rollId) return; // onResult zaten çözdü
    const next = jobs.filter((j) => j.roll.id !== rollId);
    set({ jobs: next, activeId: null });
    persist(next, get().verifies);
  },

  retryJob: (rollId) => {
    const { jobs } = get();
    const next = jobs.map((j) =>
      j.roll.id === rollId && j.error
        ? { ...j, error: undefined, failedAt: undefined, autoRetries: 0, lastAuto: false }
        : j,
    );
    set({ jobs: next });
    persist(next, get().verifies);
  },

  retryAllFailed: () => {
    const { jobs } = get();
    const next = jobs.map((j) =>
      j.error
        ? { ...j, error: undefined, failedAt: undefined, autoRetries: 0, lastAuto: false }
        : j,
    );
    set({ jobs: next });
    persist(next, get().verifies);
  },

  removeJob: (rollId) => {
    const { jobs, activeId } = get();
    if (activeId === rollId) return; // basılmakta olan çıkarılamaz (modal da listelemez)
    const next = jobs.filter((j) => j.roll.id !== rollId);
    set({ jobs: next });
    persist(next, get().verifies);
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
      persist(next, get().verifies);
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
 * Otomatik yeniden denemeye UYGUN mu? Yalnız FETCH aşamasında BELİRSİZ sonuçla
 * (yanıtsız/timeout/5xx) düşen hata: bunlar ağ/sunucu düzelince kendiliğinden
 * geçer. 4xx (top silinmiş, yetki) tekrarla DÜZELMEZ; 'output'/'prep' hataları
 * ağla ilgisizdir — otomatik denenmez.
 *
 * "Belirsiz sonuç" taksonomisinin TEK KAYNAĞI `entryAttempt.isAmbiguousFailure`
 * — üçüncü bir el yazması kopya, api.ts hata şekli değişince yalnız bir yolun
 * güncellenmesi demekti (inceleme bulgusu).
 */
export function classifyPrintRetry(phase: PrintPhase, error: unknown): boolean {
  return phase === 'fetch' && isAmbiguousFailure(error);
}

// -----------------------------------------------------------------------------
// Ağ dönüşü otomatik yeniden basım — KENAR tetikli, mount tetikli DEĞİL
// -----------------------------------------------------------------------------
// ⚠️ KK1 effect'i doğrudan `requeueRetryable()` çağırsaydı her ekran ziyareti
// (mount + online) bir otomatik deneme HAKKI yakardı: kalıcı 5xx'te operatör
// ekrana 3 kez girip çıkınca hak biter ve "ağ gelince kendiliğinden basılır"
// sözü sessizce düşerdi (inceleme bulgusu). Kurma bayrağı MODÜL ömürlüdür:
// uygulama oturumu başına bir kez + her offline→online geçişinde yeniden kurulur.
let requeueArmed = true;

export function requeueOnReconnect(online: boolean, hydrated: boolean): number {
  if (!online) {
    requeueArmed = true; // offline görüldü → sıradaki online geçişi yeni hak
    return 0;
  }
  if (!hydrated || !requeueArmed) return 0;
  requeueArmed = false;
  return usePrintQueue.getState().requeueRetryable();
}

/** Test kancası — modül-ömürlü kurma bayrağını sıfırlar. */
export function __resetRequeueArmForTests(): void {
  requeueArmed = true;
}
