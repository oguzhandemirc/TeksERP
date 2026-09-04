import { useCallback, useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/ipc-contract";

/**
 * Otomatik güncelleme durumunu main process'ten okur ve değiştikçe günceller.
 *
 * `window.api.updater` YOKSA (tarayıcı derlemesi, birim testi) hook sessizce
 * `null` döner — çağıran yerlerin ayrıca ortam kontrolü yapması gerekmez.
 */
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const api = window.api?.updater;
    if (!api) return;
    let active = true;
    void api
      .status()
      .then((s) => active && setStatus(s))
      .catch(() => {});
    const off = api.onStatus((s) => setStatus(s));
    return () => {
      active = false;
      off();
    };
  }, []);

  /**
   * Elle denetleme. Sonucu DÖNDÜRÜR: çağıran, bu tıkın sonucunu yayınlanan
   * ortak durumdan ayırt edebilsin diye (topbar düğmesi baloncuğu buradan
   * yazar). Yayın kanalı "kim sordu"yu taşımaz — o bilgi çağrı yerinde yaşar.
   */
  const check = useCallback(async (): Promise<UpdateStatus | null> => {
    const api = window.api?.updater;
    if (!api) return null;
    const s = await api.check();
    setStatus(s);
    return s;
  }, []);

  const install = useCallback(() => {
    window.api?.updater?.install();
  }, []);

  const setFeedUrl = useCallback(async (url: string | null) => {
    const api = window.api?.updater;
    if (!api) return;
    const s = await api.setFeedUrl(url);
    setStatus(s);
  }, []);

  return { status, check, install, setFeedUrl };
}
