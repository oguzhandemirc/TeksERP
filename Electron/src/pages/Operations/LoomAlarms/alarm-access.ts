// =============================================================================
// TEZGAH ALARMI — erişim kapısı (bayrak ∧ izin) + sunucu saatine hizalı "şimdi"
// =============================================================================
// FAIL-CLOSED: bayrak yüklenene dek, alanı tanımayan sunucuda ve izin yokken alarm yüzeyi
// (zil) HİÇ çizilmez. Sunucunun 403'ü (`LOOM_ALARM_DISABLED` · `MODULE_DISABLED`) de "kapalı"dır.
// =============================================================================
import { useEffect, useState } from "react";
import { useTezgahAlarmEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useServerStatusStore } from "@/store/serverStatus";

export interface LoomAlarmAccess {
  /** Bayrak açık ∧ `loom:alarm-view` — zil ve sayfa verisi. */
  canView: boolean;
  /** `loom:alarm-ack` — üstlen · bırak (kendi) · sustur · not. */
  canAct: boolean;
  /** `loom:alarm-escalation` — başkasının üstlenmesini bırakma. */
  canReleaseOthers: boolean;
  flagOn: boolean;
}

export function useLoomAlarmAccess(): LoomAlarmAccess {
  const flagOn = useTezgahAlarmEnabled();
  const { hasPermission } = useRoleAccess();
  const canView = flagOn && hasPermission("loom:alarm-view");
  return {
    canView,
    canAct: canView && hasPermission("loom:alarm-ack"),
    canReleaseOthers: canView && hasPermission("loom:alarm-escalation"),
    flagOn,
  };
}

const CLOSED_CODES = new Set(["LOOM_ALARM_DISABLED", "MODULE_DISABLED"]);

/** Hata kodu (`details.code`; `body.code` okunmaz). */
export function errorCodeOf(error: unknown): string | null {
  const e = error as { response?: { data?: { details?: { code?: unknown } } } } | null | undefined;
  const code = e?.response?.data?.details?.code;
  return typeof code === "string" ? code : null;
}

/** Sunucu alarmı bu kurulumda kapalı diyor mu (bayrak ya da modül). */
export function isAlarmClosedError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code !== null && CLOSED_CODES.has(code);
}

/** Sunucu saatine hizalı, `tickMs`de bir akan "şimdi" (istemci saati kaymışsa sayaç kaymaz). */
export function useServerNow(tickMs = 1_000): number {
  const offset = useServerStatusStore((s) => s.offsetMs);
  const [clientNow, setClientNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClientNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return clientNow + offset;
}
