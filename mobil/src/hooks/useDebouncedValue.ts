import { useEffect, useState } from 'react';

/**
 * Bir değeri geciktirir — hızlı değişen input'larda (arama kutusu) her tuşta
 * sorgu atmamak için. `value` `delayMs` boyunca sabit kalırsa debounced değer
 * güncellenir; bu süre içinde tekrar değişirse sayaç sıfırlanır.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
