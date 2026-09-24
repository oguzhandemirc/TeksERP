import { useEffect, useState } from "react";

/** Kurulu panel sürümü (`appInfo.version()`); tarayıcıda ya da okunamazsa `null`. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
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
