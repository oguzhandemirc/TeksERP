import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LICENSE_STATUS_KEY } from "@/hooks/useLicenseStatus";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { canRelay, relayViaPanel } from "@/lib/license/relay";
import { licenseService } from "@/services/licenseService";
import { apiErrorText } from "@/lib/api-error";

/**
 * Satıcı yaptırımı kaldırdıysa kilidin hemen açılması için: şimdi yokla / bu
 * bilgisayar üzerinden yenile. Kısıtlı kip kilidi ve K5 sayfası aynı düğmeleri
 * taşır; ikisi de yalnız `/api/license/*` uçlarına gider (her kademede açık).
 */
export function LicenseLockActions() {
  const { hasPermission } = useRoleAccess();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!hasPermission("license:manage")) return null;
  const refresh = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.info(await fn());
      await qc.invalidateQueries({ queryKey: LICENSE_STATUS_KEY });
    } catch (err) {
      toast.error(apiErrorText(err, "Lisans yenilenemedi."));
    } finally {
      setBusy(false);
    }
  };
  const poll = () =>
    refresh(async () => {
      const r = await licenseService.pollNow();
      return r.outcome === "BASARILI" ? "Lisans yenilendi." : `Yoklama sonucu: ${r.code ?? r.outcome}`;
    });
  const relay = () =>
    refresh(async () => {
      const r = await relayViaPanel("yokla");
      return r.ok ? "Lisans bu bilgisayar üzerinden yenilendi." : r.message;
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void poll()}>
        <RefreshCw className={`mr-1.5 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Lisansı şimdi yokla
      </Button>
      {canRelay() && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void relay()}>
          Bu bilgisayar üzerinden yenile
        </Button>
      )}
    </div>
  );
}
