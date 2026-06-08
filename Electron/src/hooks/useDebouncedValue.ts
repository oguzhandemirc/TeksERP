import { useEffect, useState } from "react";

/**
 * Bir değeri belirtilen gecikmeyle debounce eder. Kullanıcı yazmayı bıraktıktan
 * `delayMs` sonra güncel değeri döndürür — arama input'larını sunucuya her tuş
 * vuruşunda göndermemek için. (Tek kaynak: `ReferenceSelect`'teki inline debounce
 * bu hook'a çıkarıldı.)
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
