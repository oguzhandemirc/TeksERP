import { useEffect, useState } from "react";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { WEB_VERSION } from "@/lib/client-info";

/** Kurulu panel sürümü (`appInfo.version()`); webde derlemeye gömülü sürüm; okunamazsa `null`. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(IS_ELECTRON ? null : WEB_VERSION);
  useEffect(() => {
    let active = true;
    const p = window.api?.appInfo?.version?.();
    if (p) void p.then((v) => active && setVersion(v)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return version;
}
