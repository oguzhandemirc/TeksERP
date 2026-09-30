import { useEffect, useSyncExternalStore } from 'react';
import { getFactoryTimezone, onFactoryTimezoneChange, setFactoryTimezone } from '../lib/factory-time';
import { useFeatureFlags } from './useFeatureFlags';

/**
 * Fabrika saat dilimini bayraklardan (kalıcı önbellek dahil) uygular ve etkin dilimi döner; dilim değişince
 * çağıran yeniden çizilir. Gösterim tabletin saat diliminden DEĞİL, fabrikanınkinden yapılır.
 */
export function useFactoryTimezone(): string {
  const timeZone = useFeatureFlags().data?.factoryTimezone;
  useEffect(() => {
    setFactoryTimezone(timeZone);
  }, [timeZone]);
  return useSyncExternalStore(onFactoryTimezoneChange, getFactoryTimezone, getFactoryTimezone);
}
