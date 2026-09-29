// Yazma kancası: çevrimdışıyken kapalı; işlem kimliği mantıksal deneme başına bir kez üretilir,
// yalnız belirsiz hatada (ağ/5xx) yapışır — "Tekrar dene" aynı kimlikle gider (sunucu tekrarı tanır).
// Gövde değiştiyse yeni mantıksal denemedir: kimlik yenilenir (aynı kimlik + farklı gövde = 409).
import { useCallback, useRef, useState } from "react";
import { errorMessage } from "../api/client";
import { createAttempt, runAttempt } from "../api/attempt";
import { useSession } from "../state/session";

export function useWrite<T>(fn: (id: string) => Promise<T>) {
  const { offline } = useSession();
  const attempt = useRef(createAttempt());
  const lastBody = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (bodyKey = ""): Promise<T | null> => {
    if (offline) {
      setError("Çevrimdışısınız; değişiklik yapılamaz");
      return null;
    }
    if (lastBody.current !== bodyKey) attempt.current = createAttempt();
    lastBody.current = bodyKey;
    setBusy(true);
    setError(null);
    try {
      return await runAttempt(attempt.current, fn);
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, [fn, offline]);
  return { run, busy, error, disabled: offline, setError };
}
