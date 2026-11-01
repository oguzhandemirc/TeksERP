// Belge Tara — gönderilen taslağın okuma sonucunu izler: 2 sn aralık, üst sınır `READ_POLL_TIMEOUT_MS`.
// İstek üst üste binmez (yanıt gelince sıradaki kurulur); ekran kapanınca / taslak değişince zamanlayıcı düşer.
import { useEffect, useState } from 'react';
import { inboundDocService, type ReadSummary } from '../../../services/inboundDoc.service';
import { READ_POLL_INTERVAL_MS, onPollError, onSummary, shouldPoll, startWatch, type ReadWatch } from './readResult';

type Fetcher = (noteId: string) => Promise<ReadSummary>;

/** `runKey` değişince (aynı taslağa yeni sayfa gönderildi) izleme baştan başlar. */
export function useReadResult(noteId: string | null, runKey: number, fetcher: Fetcher = inboundDocService.readSummary) {
  const [watch, setWatch] = useState<ReadWatch | null>(null);
  const [restart, setRestart] = useState(0);

  useEffect(() => {
    if (!noteId) {
      setWatch(null);
      return undefined;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let w = startWatch(Date.now());
    setWatch(w);
    const tick = async () => {
      try {
        const s = await fetcher(noteId);
        if (!alive) return;
        w = onSummary(w, s, Date.now());
      } catch (e) {
        if (!alive) return;
        w = onPollError(w, e, Date.now());
      }
      setWatch(w);
      if (shouldPoll(w)) timer = setTimeout(() => void tick(), READ_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [noteId, runKey, restart, fetcher]);

  return { watch, recheck: () => setRestart((n) => n + 1) };
}
