// Y4: "kayıt kaybolmaz" sözü YALNIZ istasyon kuyruğu için doğrudur (429/backend 503'te süresiz
// yeniden dener). Kuyruğa girmeyen istek o hatada düşer; ona bu toast gösterilmez — çağıranın
// kendi hata mesajı görünür. Bu yüzden toast api.ts interceptor'ında değil, kuyruk sarmalayıcısındadır.
import Toast from 'react-native-toast-message';

const DEDUP_MS = 10_000;
let lastShownAt = 0;

export function notifyQueuedBusy(error: unknown): void {
  const e = error as { transient?: string; details?: { code?: string } } | null;
  const busy = e?.transient === 'busy' || (e?.transient === 'rate-limit' && e.details?.code !== 'LOGIN_LOCKED');
  if (!busy) return;
  const now = Date.now();
  if (now - lastShownAt <= DEDUP_MS) return;
  lastShownAt = now;
  Toast.show({
    type: 'info',
    text1: 'Sunucu şu an meşgul',
    text2: 'Bekleyen kayıtlar kaybolmaz, otomatik yeniden gönderilir.',
    visibilityTime: 5000,
  });
}

/** Yalnız testler için: tekilleştirme saatini sıfırlar. */
export function resetBusyToastForTests(): void {
  lastShownAt = 0;
}
