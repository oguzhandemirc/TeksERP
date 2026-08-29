// Offline-first QueryClient yapılandırması.
// - NetInfo → TanStack Query onlineManager wire (RN'de browser event yok)
// - AsyncStorage persister: paused mutation'lar app restart'ı sonrası kalır
// - Mutation default: networkMode='online' → offline'da paused, online'da otomatik resume

import { MutationCache, QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import Toast from 'react-native-toast-message';
import { jitteredBackoff } from './backoff';
import { EKRANSIZ_META, revivePendingStationMutations } from './persistPolicy';
import { failureToastText, shouldAnnounceFailure } from './announceFailure';
// ⚠️ `stationLabels`ten — `mutations`tan DEĞİL: o dosya bu dosyayı import ediyor.
import { stationOpLabel } from './stationLabels';
import { installOnlineSignal } from './serverReachability';

// "Online" = AĞ LİNKİ **ve** SUNUCU ERİŞİLEBİLİR (B6). Eskiden burada düz bir
// `NetInfo.isConnected` vardı; "wifi var, sunucu ölü" durumu ONLINE sayılıyor ve
// offline kuyruğu hiç devreye girmiyordu. Sözleşmenin tamamı + neden bu
// değişikliğin ancak atomik guard + damga penceresiyle BİRLİKTE güvenli olduğu:
// offline/serverReachability.ts
installOnlineSignal();

/** Kalıcı düşüşü operatöre ANINDA söyle (karar `offline/announceFailure.ts`). */
function announceStationFailure(key: unknown, error: unknown, meta?: unknown): void {
  // Diskten diriltilen kaydın ekranı yoktur → çakışma 409'u da duyurulur
  // (BULGU-T3-001). Damgayı `persistPolicy.revivePendingStationMutations` yazar
  // ve `meta` dehydrate/hydrate turundan geçer (query-core hydration).
  const ekranYok = (meta as Record<string, unknown> | undefined)?.[EKRANSIZ_META] === true;
  if (!shouldAnnounceFailure(key, error, ekranYok)) return;
  const { text1, text2 } = failureToastText(error, stationOpLabel(key));
  // Uzun tut: operatör tabletin başında olmayabilir, mesajı kaçırmasın.
  Toast.show({ type: 'error', text1, text2, visibilityTime: 6000 });
}

export const queryClient = new QueryClient({
  // KALICI DÜŞÜŞ → OLDUĞU ANDA SÖYLE, HİÇBİR YERE YAZMA (2026-08-12).
  //
  // Neden BURASI, `setMutationDefaults` DEĞİL: key-bazlı `onError`, component
  // kendi `onError`'ını verdiğinde EZİLİR (query-core defaultMutationOptions
  // sırası: global < key defaults < component). Uyarı "bazen" basılırdı —
  // sessiz tuzak. MutationCache callback'i ise her zaman ve component'ten ÖNCE
  // koşar; ayrıca observer'sız (restore edilmiş) mutation'ları da kapsar ve
  // yalnız KALICI düşüşte tetiklenir (ara retry'lar `onFail`'e gider).
  //
  // ÖNCESİ: aynı olay kalıcı bir "ölü mektup kutusuna" yazılıyor, header'daki
  // rozet kırmızıya dönüyor ve operatör listeden karar veriyordu. Kaldırıldı —
  // gerekçe SyncStatusChip.tsx başlığında. Özeti: kutu "ulaşamadım" ile
  // "sunucu soru sordu"yu tek başlıkta topluyordu, ikincisi zaten ekranda
  // modalla soruluyordu ve karar verilmeyen satırlar günlerce çürüyordu.
  //
  // ⚠️ ÇAKIŞMA 409'LARI TOAST BASMAZ: onların TEK yüzeyi ekranın kendi
  // modalıdır (KK1 EntryConflictModal — "aynı top mu, ayrı top mu"). Toast
  // basmak aynı kararı ikinci kez, üstelik cevaplanamaz biçimde sordururdu.
  mutationCache: new MutationCache({
    onError: (error, _variables, _ctx, mutation) =>
      announceStationFailure(mutation.options.mutationKey, error, mutation.meta),
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      // Jitter'lı backoff: vardiya başında onlarca tabletin senkron retry
      // dalgası sunucuya aynı anda vurmasın (SAHA-AG-DAYANIKLILIK.md §S5).
      retryDelay: (attempt) => jitteredBackoff(attempt),
      staleTime: 30_000,
    },
    mutations: {
      // Default 'always': offline'da paused olmaz, hızlıca network hatasıyla
      // fail eder → loading sonsuza takılmaz. Offline-aware mutation'lar
      // setMutationDefaults ile 'online'a override eder (QC2 vs.).
      // KALIR — 'online' olsa registry-DIŞI mutasyonlar offline'da paused kalır ama
      // persist edilmediklerinden (persistPolicy yalnız istasyon kayıtları) zombi/
      // sonsuz loading üretirdi.
      networkMode: 'always',
      // retry: 0 (idempotency denetimi — eski 1) — registry-DIŞI, idempotency
      // anahtarı olmayan mutasyonlar (sipariş/iş emri/kartela-düşüm/sevkiyat) her ağ
      // hatasında (sunucunun COMMIT etmiş olabileceği timeout dahil) sessizce ikinci
      // POST atıyordu → sessiz çift kayıt. STATION_MUT registry'si kendi retry'ını
      // (stationRetry) OFFLINE_AWARE ile set ettiğinden bu değişimden ETKİLENMEZ.
      retry: 0,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'TEKSERP_RQ_CACHE_V1',
  throttleTime: 1000,
  // ZOMBİ ÖNLEME: pending persist edilen istasyon kaydı restore'da paused'a
  // çevrilir — aksi hâlde hiçbir resume yolu onu tetiklemez ve kayıt sessizce
  // kaybolur (bkz. persistPolicy.revivePendingStationMutations).
  deserialize: (cached) => revivePendingStationMutations(JSON.parse(cached)),
});

// Bump'lar persist cache'i invalidate eder: registry shape değiştiğinde veya
// eski persisted mutation'larla incompatible bir değişiklik yapıldığında bump'la.
// NOT (idempotency, retry 1→0): persist BUSTER bilinçli BUMP'LANMADI — persist
// edilen artefaktların (paused/pending istasyon mutasyonları) davranışı runtime
// setMutationDefaults'tan gelir; default retry değişimi persist şekliyle uyumlu.
// Bump etmek update anında kuyruktaki offline saha kayıtlarını SİLERDİ.
// v10: persist kapsamı daraltıldı (App.tsx dehydrateOptions — yalnız bootstrap
//      query'leri + paused/pending-istasyon mutation'ları; persistPolicy.ts).
// v9: QC2_FINISH_STEP registry'e eklendi (adımı kapat offline-aware).
// v8: QC2_REPORT_ERROR + QC2_DELETE_ERROR registry'e eklendi (leke offline-aware).
// v7: KK1_SCRAP registry'e eklendi (top iptali offline-aware).
// v6: FASON_SEVK_DISPATCH registry'e eklendi.
// v5: FASON_KABUL_RECEIVE registry'e eklendi.
// v4: KK1_CREATE_ENTRY registry'e eklendi (client-side barkod ile offline).
// v3: TAMBUR_FINALIZE_OPEN_FABRIC registry'e eklendi.
// v2: KURSUN_FINISH registry'e eklendi + default networkMode 'always'a çevrildi.
export const PERSIST_BUSTER = 'tekserp-v10';
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
