// =============================================================================
// failedOps — ÖLÜ MEKTUP KUTUSU (kalıcı olarak düşen istasyon kayıtları)
// =============================================================================
// SORUN (2026-08-05 kod denetimi): kuyruktaki bir istasyon kaydı kalıcı olarak
// düştüğünde hata YALNIZ ilgili ekranın component-seviyesi `onError`'ına
// düşüyordu. Üç yol bunu tamamen sessizleştiriyordu:
//
//   1. Ekran mount değilse (kuyruk ana menüde / başka istasyonda flush oldu)
//      hiçbir callback yok — `setMutationDefaults` kayıtlarının hiçbirinde
//      `onError` tanımlı değil.
//   2. App restart sonrası restore edilen mutation'ın observer'ı YOKTUR
//      (hydration yalnız `mutationKey` + state taşır) → yine sessiz.
//   3. `persistPolicy` `error` durumunu persist ETMEZ → kayıt diskten de silinir.
//
// Sonuç: 409 alan bir ham giriş (mükerrer tuzağı ya da `WORK_SESSION_REQUIRED`)
// hiçbir yerde görünmeden kayboluyordu — kopyanın aynadaki ikizi.
//
// TASARIM: `MutationCache.onError` YAKALAR (bkz. queryClient.ts — observer olsun
// olmasın, restore edilmiş olsun olmasın, yalnız KALICI düşüşte ve component'ten
// ÖNCE koşar), bu depo SAKLAR.
//
// NEDEN AYRI DEPO, NEDEN `persistPolicy` GENİŞLETİLMEDİ:
//   • RQ persist kapsamına `error` durumunu almak, restore'da "bu kayıt yeniden
//     denenecek mi?" belirsizliği yaratır ve `revivePendingStationMutations`
//     mantığını bulandırır (aynı tuzağın ikinci kez tekrarı).
//   • Ayrı depo `PERSIST_BUSTER`'dan BAĞIMSIZDIR: buster bump'ı diskteki RQ
//     kuyruğunu siler ama ölü mektupları silmez.
//
// NEDEN `utils/storage` DEĞİL, doğrudan AsyncStorage: `storage.ts` native'de
// SecureStore kullanır ve SecureStore ~2 KB üstünde kırılır; payload'lar daha
// büyük olabilir. Ayrıca burada saklanan şey sır değil, kuyruk artığıdır.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'TEKSERP_FAILED_OPS_V1';
/** Kutu tavanı — dolup taşan bir kutu okunmaz hâle gelir. */
export const FAILED_OPS_MAX = 50;
/** Bu yaştan sonra kayıt operasyonel olarak anlamsızdır (vardiya çoktan kapandı). */
export const FAILED_OPS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FailedOp {
  /** `opIdFor(key, variables)` — DETERMİNİSTİK (bkz. aşağıdaki gerekçe). */
  id: string;
  /** `STATION_MUT` anahtarı — yeniden gönderim bununla kurulur. */
  key: readonly unknown[];
  /** Aynen yeniden gönderilecek payload (damga/token korunur). */
  variables: unknown;
  /** Türkçe hata metni (api.ts sarmalayıcısından). */
  message: string;
  status?: number;
  /** `details.code` — POSSIBLE_DUPLICATE / CLIENT_TOKEN_COLLISION / … */
  code?: string;
  /** 409'larda sunucunun işaret ettiği mevcut kaydın barkodu. */
  barcode?: string | null;
  failedAt: number;
}

interface FailedOpsState {
  rows: FailedOp[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (row: FailedOp) => void;
  clear: (id: string) => void;
  clearAll: () => void;
  /** Yeniden gönderim başladı: satırı yeni opId'ye taşı (payload değişmiş olabilir). */
  markRetrying: (id: string, nextId: string) => void;
}

function persist(rows: FailedOp[]): void {
  // Fire-and-forget: `MutationCache.onError` await edilir, disk yazımı ekranın
  // kendi `onError`'ını geciktirmemeli.
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows)).catch(() => {});
}

function prune(rows: FailedOp[]): FailedOp[] {
  const cutoff = Date.now() - FAILED_OPS_TTL_MS;
  return rows.filter((r) => r.failedAt >= cutoff).slice(-FAILED_OPS_MAX);
}

export const useFailedOps = create<FailedOpsState>((set, get) => ({
  rows: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // Bozuk/eski JSON uygulamayı ÇÖKERTMEZ — kutu boş açılır.
      const rows = Array.isArray(parsed)
        ? prune(parsed.filter((r): r is FailedOp => !!r && typeof (r as FailedOp).id === 'string'))
        : [];
      set({ rows, hydrated: true });
    } catch {
      set({ rows: [], hydrated: true });
    }
  },
  record: (row) => {
    // Aynı payload iki kez düşerse TEK satır kalır (retry zinciri gürültüsü).
    const rows = prune([...get().rows.filter((r) => r.id !== row.id), row]);
    set({ rows });
    persist(rows);
  },
  clear: (id) => {
    const rows = get().rows.filter((r) => r.id !== id);
    set({ rows });
    persist(rows);
  },
  clearAll: () => {
    set({ rows: [] });
    persist([]);
  },
  markRetrying: (id, nextId) => {
    const rows = get().rows.map((r) => (r.id === id ? { ...r, id: nextId } : r));
    set({ rows });
    persist(rows);
  },
}));

/**
 * DETERMİNİSTİK kimlik: (mutationKey + payload) → id.
 *
 * Bu determinizm tasarımın bel kemiğidir: "Tekrar Gönder" aynı `variables`'ı
 * gönderdiği için başarı geldiğinde `MutationCache.onSuccess` AYNI id'yi hesaplar
 * ve satırı kendiliğinden siler. Ek eşleştirme koduna gerek kalmaz.
 *
 * Anahtar SIRASINDAN bağımsız olmalı — JSON.stringify nesne alan sırasını korur,
 * o yüzden kendi sıralamamızı uyguluyoruz.
 */
export function opIdFor(key: readonly unknown[] | undefined, variables: unknown): string {
  return `${JSON.stringify(key ?? [])}::${stableStringify(variables)}`;
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Bu mutationKey bir istasyon kaydı mı (kutuya yalnız onlar girer). */
export function isStationMutationKey(key: unknown): key is readonly unknown[] {
  return Array.isArray(key) && key[0] === 'station';
}

// -----------------------------------------------------------------------------
// Cache köprüsü — queryClient.ts bunları çağırır
// -----------------------------------------------------------------------------
//
// ⚠️ BURADAN TOAST BASILMAZ — bilinçli. Kalıcı düşüşün görünür sinyali
// `SyncStatusChip`'in KIRMIZIYA dönmesidir; operatör hangi ekranda olursa olsun
// onu header'ında görür. Ayrıca toast basmak iki sorun üretirdi: (a) KK1 mount
// iken kendi 409 modalıyla ÇELİŞİRDİ, (b) operatörün bakmadığı bir ekranda
// gürültü olurdu. "Sahiplik" (odaktaki ekran toast'ı bastırsın) makinesi bu
// yüzden YAZILMADI — çözdüğü sorun yok.

/**
 * Kalıcı düşüş → kutuya yaz. İstasyon-DIŞI mutation'lar ve `NoAuthError`
 * (kalıcı düşmez, süresiz bekler) kapsam dışı.
 *
 * ⚠️ MUAFİYET LİSTESİ KASITLI OLARAK BOŞ. Özellikle 409 `WORK_SESSION_REQUIRED`
 * de buraya düşer: `stationRetry` tüm 4xx'i fail-fast düşürdüğü için oturum
 * devralınmışken flush olan bir KK1 girişi bugüne kadar TAM SESSİZ kayboluyordu.
 */
export function recordStationFailure(
  key: unknown,
  variables: unknown,
  error: unknown,
): void {
  if (!isStationMutationKey(key)) return;
  const e = error as
    | (Error & { status?: number; noAuth?: boolean; details?: Record<string, unknown> })
    | null;
  if (e?.noAuth) return; // HTTP'ye hiç çıkmadı; kuyrukta süresiz bekliyor
  useFailedOps.getState().record({
    id: opIdFor(key, variables),
    key,
    variables,
    message: e?.message ?? 'Bilinmeyen hata',
    status: e?.status,
    code: typeof e?.details?.code === 'string' ? e.details.code : undefined,
    barcode: typeof e?.details?.barcode === 'string' ? e.details.barcode : null,
    failedAt: Date.now(),
  });
}

/** Aynı payload sonradan (retry / resume / elle gönderim) başarılı oldu → satır düşer. */
export function clearStationFailure(key: unknown, variables: unknown): void {
  if (!isStationMutationKey(key)) return;
  useFailedOps.getState().clear(opIdFor(key, variables));
}
