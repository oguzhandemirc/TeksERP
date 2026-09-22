import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  FALLBACK_SCAN_SERIES,
  classifyWithTable,
  matchesFullFormatWithTable,
  scanSeriesService,
  type ScanClassification,
  type ScanKind,
  type ScanSeriesRow,
} from '../services/scanSeries.service';
import { useAuthStore } from '../store/authStore';

// Anahtar BOOTSTRAP listesindedir (`offline/persistPolicy.ts`): tablo
// kullanıcıya özel değil BİÇİM meta verisidir, bu yüzden hem diske yazılır hem
// logout'ta korunur — ağsız açılışta son bilinen tablo kullanılır.
export const SCAN_SERIES_KEY = ['scan-series'] as const;

export function useScanSeries(): readonly ScanSeriesRow[] {
  // Uç auth'lu: token yokken (login ekranı) istek atma — `useFeatureFlags` ile
  // aynı gerekçe. Cache'teki son değer disabled'ken de okunur.
  const hasToken = useAuthStore((s) => !!s.token);
  const q = useQuery({
    queryKey: SCAN_SERIES_KEY,
    queryFn: scanSeriesService.get,
    staleTime: 30 * 60 * 1000,
    enabled: hasToken,
  });
  // ⚠️ FAIL-SAFE: tablo yoksa YEDEK. Okutmayı kesmek sahayı durdururdu ve
  // kesin kararı zaten backend 404'ü verir.
  return q.data ?? FALLBACK_SCAN_SERIES;
}

export interface ScanClassifier {
  classify: (code: string) => ScanClassification;
  matchesFullFormat: (kind: ScanKind, code: string) => boolean;
  /** Tablo tanımadığında sunucuya sor (async son adım). */
  resolveOnServer: (code: string) => Promise<ScanClassification>;
}

export function useScanClassifier(): ScanClassifier {
  const rows = useScanSeries();
  return useMemo(
    () => ({
      classify: (code: string) => classifyWithTable(rows, code),
      matchesFullFormat: (kind: ScanKind, code: string) => matchesFullFormatWithTable(rows, kind, code),
      resolveOnServer: scanSeriesService.resolve,
    }),
    [rows],
  );
}
