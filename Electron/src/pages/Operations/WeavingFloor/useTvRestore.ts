// Ana pencerede (menü kabuğu) TV kipini HATIRLAR: uygulama kapanırken TV açıksa, oturum açılınca
// aynı kip geri gelir (aynı pencere → TV yolu; ayrı pencere → son ekranda yeniden açılır). Yalnız
// Electron'da ve süreç başına bir kez; ayrı pencereyi kullanıcı kapatınca işaret silinir.
import { useEffect } from "react";
import { TEZGAH_TV_PATH } from "./tv-entry";
import { clearTvOpen, readTvOpen, readTvPref, tvWindowApi } from "./tv-prefs";

let restored = false;

/** Test: süreç-başı bayrağı sıfırlar. */
export function resetTvRestoreForTest(): void {
  restored = false;
}

export function useTvRestore(): void {
  useEffect(() => {
    const api = tvWindowApi();
    if (!api) return;
    const off = api.onClosed(({ byUser }) => {
      if (byUser && readTvOpen() === "ayri") clearTvOpen();
    });
    if (!restored) {
      restored = true;
      const open = readTvOpen();
      if (open === "ayni") window.location.hash = `#${TEZGAH_TV_PATH}`;
      else if (open === "ayri") void api.open({ displayId: readTvPref().ekranId }).catch(() => undefined);
    }
    return off;
  }, []);
}
