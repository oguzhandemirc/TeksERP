// =============================================================================
// GEÇİCİ BAYRAK — bir eylemle yanar, `ms` sonra kendiliğinden söner (sipariş formu ③, 2026-09-17)
// =============================================================================
// Kural: kalıcı "ön koşul" metni formda durmaz; kullanıcı eylemi (renk tıklama · özellik isteği · submit)
// uyarıyı tetikler, uyarı hedef alanı gösterir ve söner. Yeniden `fire` süreyi uzatır; unmount temizler.
// `prefers-reduced-motion` yalnız geçiş animasyonunu etkiler, süreyi değil (okuma süresi aynı).
// =============================================================================
import { useCallback, useEffect, useRef, useState } from "react";

export function useTransientFlag(ms = 3000): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fire = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setOn(false);
    }, ms);
  }, [ms]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [on, fire];
}
