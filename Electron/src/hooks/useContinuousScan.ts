import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { beepOk, beepError } from "@/lib/scan-feedback";

interface UseContinuousScanOptions<T> {
  /** Kodu çöz (örn. çuvalı sevkiyatına eşle). null → eşleşme yok. */
  resolve: (code: string) => Promise<T | null>;
  /** Çözülen öğeyle çağrılır (listeye ekle). */
  onResolved: (item: T, code: string) => void;
  /** Kod zaten listede mi? (tekrarı engelle.) */
  alreadyInList: (code: string) => boolean;
  /** Aynı kodun tek tetikte çift-ateşini engelleyen soğuma (ms). */
  rearmMs?: number;
}

/**
 * "Okutarak liste oluştur" akışı (mobil FasonSevk/CuvalDuzelt aynası). Aynı
 * hızlı çift-okutmayı (uçuştaki Set) ve tek-tetik çift-ateşini (rearm soğuma)
 * eler; çözülemeyen/eşleşmeyen kodu `lastError`'a, başarılıyı `lastSuccess`'e
 * yazar. Her sonuç sesli bip'lenir (başarı=yüksek tek, red=düşük çift) —
 * operatör ekrana bakmadan okutabilsin.
 */
export function useContinuousScan<T>({
  resolve,
  onResolved,
  alreadyInList,
  rearmMs = 1400,
}: UseContinuousScanOptions<T>) {
  const [resolving, setResolving] = useState<string[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const inflightRef = useRef<Set<string>>(new Set());
  const lastRef = useRef<{ code: string; ts: number } | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const alreadyRef = useRef(alreadyInList);
  alreadyRef.current = alreadyInList;

  const push = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      // Aynı kod soğuma — tabanca tek tetikte iki kez ateşlerse ikinciyi yut.
      if (lastRef.current && lastRef.current.code === code && now - lastRef.current.ts < rearmMs) {
        return;
      }
      lastRef.current = { code, ts: now };
      if (inflightRef.current.has(code)) return; // uçuştaki çözüm — bekle
      if (alreadyRef.current(code)) {
        toast.info("Bu kod zaten listede.");
        return;
      }
      inflightRef.current.add(code);
      setResolving((r) => [...r, code]);
      setLastError(null);
      void resolveRef.current(code)
        .then((item) => {
          if (item) {
            onResolvedRef.current(item, code);
            setLastSuccess(code);
            beepOk();
          } else {
            setLastError(`Eşleşme yok: ${code}`);
            setLastSuccess(null);
            beepError();
          }
        })
        .catch(() => {
          setLastError(`Çözümlenemedi: ${code}`);
          setLastSuccess(null);
          beepError();
        })
        .finally(() => {
          inflightRef.current.delete(code);
          setResolving((r) => r.filter((c) => c !== code));
        });
    },
    [rearmMs],
  );

  return { push, resolving, lastError, lastSuccess };
}
