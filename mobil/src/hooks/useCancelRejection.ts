import { useCallback, useMemo, useRef, useState } from 'react';
import { cancelReasonRejection, type CancelRejection } from '../components/rollCancelRules';

/**
 * Sunucu "sebep zorunlu" reddi (400 CANCEL_REASON_REQUIRED) → iptal modalı AYNI top için yeniden açılır ve
 * reddi satır olarak gösterir. Modal onayda hemen kapanır (tek dokunuş; çevrimdışı kuyruk aynı yol), bu yüzden
 * hedef burada tutulur. Mesaj o topa bağlıdır: yeni onay ya da vazgeç siler — bayat mesaj kalmaz.
 */
export function useCancelRejection<T extends { id: string }>() {
  const lastRef = useRef<T | null>(null);
  const [rejection, setRejection] = useState<CancelRejection | null>(null);

  const arm = useCallback((roll: T) => {
    lastRef.current = roll;
    setRejection(null);
  }, []);
  const clear = useCallback(() => setRejection(null), []);
  /** onError içinde: yeniden açılacak hedefi döner; başka hatada ya da hedef değiştiyse null (toast yolu). */
  const catchRejection = useCallback((err: unknown, rollId: string): T | null => {
    const r = cancelReasonRejection(err, rollId);
    const last = lastRef.current;
    if (!r || !last || last.id !== rollId) return null;
    setRejection(r);
    return last;
  }, []);
  const messageFor = useCallback(
    (rollId: string | null | undefined): string | null =>
      rollId && rejection?.rollId === rollId ? rejection.message : null,
    [rejection],
  );

  return useMemo(() => ({ arm, clear, catchRejection, messageFor }), [arm, clear, catchRejection, messageFor]);
}
