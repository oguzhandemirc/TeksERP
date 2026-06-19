import { useCallback, useEffect, useRef, useState } from "react";

interface UseScanDrainerOptions {
  /** Tek kodu işle (örn. aktif çuvala okut). Sıralı çağrılır — biri bitmeden öteki başlamaz. */
  onScan: (code: string) => Promise<void>;
  /** İşlendikten sonra bir sonrakine geçmeden önceki soğuma (ms) — tetik sıçramasını yutar. */
  rearmMs?: number;
}

/**
 * Aktif-çuval seri okutma sürücüsü (mobil PaketlemeScreen `drainScans` aynası).
 * Tabanca arka arkaya kod basınca her biri SIRAYLA tek POST'a dönüşür (yarış yok);
 * aynı kod işlenirken/kuyruktayken yok sayılır (dedup), her işlemden sonra `rearmMs`
 * soğuma tek-tetik çift-ateşi eler. Saf kuyruk → birim test edilebilir.
 */
export function useScanDrainer({ onScan, rearmMs = 600 }: UseScanDrainerOptions) {
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [busy, setBusy] = useState(false);
  const [queueLength, setQueueLength] = useState(0);

  const syncCounters = useCallback(() => {
    setBusy(busyRef.current);
    setQueueLength(queueRef.current.length);
  }, []);

  const drain = useCallback(() => {
    if (busyRef.current) return;
    const code = queueRef.current.shift();
    if (!code) {
      syncCounters();
      return;
    }
    busyRef.current = true;
    processingRef.current = code;
    syncCounters();
    void onScanRef.current(code).finally(() => {
      timerRef.current = setTimeout(() => {
        busyRef.current = false;
        processingRef.current = null;
        syncCounters();
        drain();
      }, rearmMs);
    });
  }, [rearmMs, syncCounters]);

  const push = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      // Dedup: işlenmekte olan ya da kuyrukta bekleyen aynı kodu ekleme.
      if (processingRef.current === code || queueRef.current.includes(code)) return;
      queueRef.current.push(code);
      syncCounters();
      drain();
    },
    [drain, syncCounters],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { push, busy, queueLength };
}
