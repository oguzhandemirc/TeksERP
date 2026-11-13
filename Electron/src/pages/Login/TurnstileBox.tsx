import { useEffect, useRef } from "react";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { mountTurnstile, unmountTurnstile } from "@/lib/turnstile";
import { useLoginTurnstileSiteKey } from "./useServerCompanyName";

/** Tarayıcı girişinde robot doğrulaması kutusu — yalnız web derlemesinde ve sunucu korumayı açtıysa. */
export function TurnstileBox() {
  const siteKey = useLoginTurnstileSiteKey();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (IS_ELECTRON || !siteKey || !ref.current) return;
    void mountTurnstile(ref.current, siteKey, () => undefined).catch(() => undefined);
    return unmountTurnstile;
  }, [siteKey]);
  if (IS_ELECTRON || !siteKey) return null;
  return <div ref={ref} data-testid="turnstile-kutusu" className="absolute bottom-14 left-1/2 -translate-x-1/2" />;
}
