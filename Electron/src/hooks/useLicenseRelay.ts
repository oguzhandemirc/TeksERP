import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { licenseService } from "@/services/licenseService";
import { LICENSE_RELAY_INTERVAL_MS, canRelay, relayViaPanel, shouldAutoRelay } from "@/lib/license/relay";
import { LICENSE_DETAIL_KEY, LICENSE_STATUS_KEY } from "@/hooks/useLicenseStatus";

/** Açılışta kısa bir gecikme: giriş anındaki istek yağmuruna eklenmesin. */
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Otomatik PANEL AKTARMASI: backend satıcıya çıkamıyorsa (`shouldAutoRelay`)
 * 15 dakikada bir imzalı yoklama isteğini bu bilgisayarın ağından satıcıya
 * taşır. Yalnız masaüstünde ve `license:manage` taşıyan oturumda koşar (aktarma
 * uçları o izni ister). Sessizdir: arka plan işi toast basmaz.
 */
export function useLicenseRelay(): void {
  const { hasPermission } = useRoleAccess();
  const enabled = canRelay() && hasPermission("license:manage");
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const detail = await licenseService.detail();
        if (!shouldAutoRelay(detail)) return;
        const r = await relayViaPanel("yokla");
        if (r.ok) {
          void qc.invalidateQueries({ queryKey: LICENSE_DETAIL_KEY });
          void qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY });
        }
      } catch {
        // Arka plan: bir sonraki turda yeniden denenir; ekran kendi hatasını gösterir.
      } finally {
        running = false;
      }
    };
    const first = setTimeout(() => void tick(), FIRST_RUN_DELAY_MS);
    const every = setInterval(() => void tick(), LICENSE_RELAY_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [enabled, qc]);
}
