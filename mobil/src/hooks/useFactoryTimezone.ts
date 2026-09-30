import { useEffect, useSyncExternalStore } from 'react';
import { applyServerFactoryTimezone, getFactoryTimezone, onFactoryTimezoneChange } from '../lib/factory-time';
import { useFeatureFlags } from './useFeatureFlags';

/**
 * Fabrika saat dilimi dönemlerini bayraklardan (kalıcı önbellek dahil) uygular ve ŞU ANKİ dilimi döner; dilim
 * değişince (bekleyen değişiklik yürürlüğe girdiği an dahil) çağıran yeniden çizilir. Her an kendi dönemindeki
 * dilimle basılır — tabletin saat diliminden DEĞİL.
 */
export function useFactoryTimezone(): string {
  const flags = useFeatureFlags().data;
  useEffect(() => {
    applyServerFactoryTimezone(flags);
  }, [flags]);
  return useSyncExternalStore(onFactoryTimezoneChange, getFactoryTimezone, getFactoryTimezone);
}
