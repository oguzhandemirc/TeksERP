import { useCallback, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';

// =============================================================================
// useManualRefresh — ekran başlığındaki RefreshButton (ve liste pull-to-refresh)
// için tek tip "manuel yenileme" davranışı.
//
// Neden ayrı bir state (ham `query.isFetching` değil):
//   - RefreshButton, `refreshing` true→false geçişinde haptic + toast tetikler.
//     Ham isFetching'e bağlarsak mount ilk yüklemesinde veya bir mutation
//     listeyi invalidate ettiğinde de "güncellendi" toast'ı patlar (gürültü).
//   - Bu hook'taki flag YALNIZCA kullanıcı yenilemeyi tetiklediğinde (header
//     butonu veya pull-to-refresh) true olur → toast sadece gerçek yenilemede.
//   - Ham isFetching ayrıca OFFLINE'da hep false kalır (networkMode 'online'
//     query'leri "paused" olur, fetchStatus 'fetching' DEĞİL) → buton hiç
//     dönmez ("animasyon başlamıyor" bug'ı). Burada animasyonu biz sürüyoruz.
//
// OFFLINE davranışı (kritik):
//   - Query'ler networkMode 'online' (queryClient.ts) → cihaz offline iken
//     refetch() PAUSE olur: ne tamamlanır ne hata verir, promise ASILI kalır.
//     `await refetch()` sonsuza kadar bekler → spinner sonsuza döner.
//   - Bu yüzden önce onlineManager.isOnline() bakılır; offline ise anında net
//     "çevrimdışı" hatası verilir (paused promise beklenmez).
//   - REFRESH_TIMEOUT_MS: cihaz online ama sunucu erişilemez/yavaşsa (axios
//     timeout + retry uzayabilir) veya istek ortada paused olursa, spinner
//     bu süreden fazla dönmez → "zaman aşımı" hatası verir (alttaki refetch
//     arka planda tamamlanırsa cache yine güncellenir).
//
// MIN_SPIN_MS: RefreshButton bir tam turu 800ms'de döner; yanıt daha erken
// gelirse animasyon yarıda kesiliyordu. En az bir tam tur garanti edilir.
//
// Hata yakalama iki yolu da kapsar:
//   - react-query `.refetch()` reject ETMEZ, sonuç nesnesi döner → isError/status
//     denetlenir.
//   - axios tabanlı async fn'ler throw eder → try/catch yakalar.
// =============================================================================

const MIN_SPIN_MS = 800;
// Manuel yenilemenin üst sınırı. Axios timeout 10s + retry'ı kapsayacak kadar
// uzun, ama "sonsuza döner" hissini engelleyecek kadar kısa.
const REFRESH_TIMEOUT_MS = 12_000;

/** Yenileme fonksiyonu — react-query refetch sonucu (Promise<result>), void ya da
 *  throw döndürebilir. `() => q.refetch()` tip olarak void görünse de runtime'da
 *  promise döner; Promise.resolve ile sarılıp result.isError denetlenir. */
type Refetcher = () => unknown;

interface QueryLikeResult {
  isError?: boolean;
  status?: string;
  error?: unknown;
}

export interface ManualRefresh {
  /** Manuel yenileme sürerken true (header butonu + pull-to-refresh spinner). */
  refreshing: boolean;
  /** Son manuel yenileme başarısızsa true → RefreshButton error toast'ı. */
  isError: boolean;
  /** Hata mesajı (error toast'ta gösterilir). */
  errorMessage?: string;
  /** Başarı toast'ı başlığı — RefreshButton'a iletilir. Verilmezse başarıda
   *  toast çıkmaz (sadece haptic); error toast'ı her durumda çalışır. */
  successMessage?: string;
  /** Header butonu ve liste onRefresh'ine bağlanır. */
  onRefresh: () => void;
}

/**
 * @param refetch  Tek bir refetch fn ya da paralel çalışacak fn dizisi.
 * @param successMessage  Başarılı yenileme sonrası gösterilecek toast başlığı.
 */
export function useManualRefresh(
  refetch: Refetcher | Refetcher[],
  successMessage?: string,
): ManualRefresh {
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // Render arası taze referans — bağımlılık dizisini sabit tutar.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    setErrorMessage(undefined);
    const start = Date.now();
    try {
      // Offline guard — paused refetch'in asılı kalmasını beklemeden net hata.
      if (!onlineManager.isOnline()) {
        setErrorMessage('Çevrimdışı — internet bağlantısı yok');
        return;
      }

      const fns = Array.isArray(refetchRef.current) ? refetchRef.current : [refetchRef.current];
      // workSettled ASLA reject etmez: hata da, başarı da değere çevrilir. Böylece
      // timeout yarışı kazandıktan SONRA refetch geç reddederse "unhandled
      // rejection" oluşmaz (work arka planda sürse de sessizce yutulur).
      const workSettled = Promise.all(fns.map((fn) => Promise.resolve(fn()))).then(
        (results) => ({ kind: 'done' as const, results }),
        (error) => ({ kind: 'error' as const, error }),
      );
      // Zaman aşımı yarışı: refetch ortada paused olursa / retry uzarsa spinner
      // sonsuza dönmesin. Timeout kazanırsa altta refetch arka planda sürer.
      const raced = await Promise.race([
        workSettled,
        new Promise<{ kind: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' }), REFRESH_TIMEOUT_MS),
        ),
      ]);

      if (raced.kind === 'timeout') {
        setErrorMessage('Yenileme zaman aşımına uğradı — bağlantıyı kontrol et');
        return;
      }
      if (raced.kind === 'error') {
        setErrorMessage((raced.error as Error)?.message ?? 'Veri alınamadı');
        return;
      }

      const failed = raced.results.find(
        (r): r is QueryLikeResult =>
          !!r && typeof r === 'object' && ((r as QueryLikeResult).isError === true || (r as QueryLikeResult).status === 'error'),
      );
      if (failed) {
        setErrorMessage((failed.error as Error | undefined)?.message ?? 'Veri alınamadı');
      }
    } catch (err) {
      setErrorMessage((err as Error)?.message ?? 'Veri alınamadı');
    } finally {
      const remaining = MIN_SPIN_MS - (Date.now() - start);
      if (remaining > 0) await new Promise<void>((r) => setTimeout(r, remaining));
      setRefreshing(false);
      inFlight.current = false;
    }
  }, []);

  const onRefresh = useCallback(() => {
    void run();
  }, [run]);

  return {
    refreshing,
    isError: !!errorMessage,
    errorMessage,
    successMessage,
    onRefresh,
  };
}
