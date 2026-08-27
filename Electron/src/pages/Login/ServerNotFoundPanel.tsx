import { useState } from "react";
import { Loader2, Radar, ServerCrash, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { DiscoveredServer } from "@shared/ipc-contract";
import { Button } from "@/components/ui/button";
import { ServerDiscoveryPanel } from "@/components/settings/ServerDiscoveryPanel";
import { useServerDiscovery } from "@/hooks/useServerDiscovery";
import { applyApiBaseUrl, setStoredApiBaseUrl, pushRecentApiBaseUrl } from "@/lib/api-config";

/**
 * Giriş formunun YERİNE çizilen "sunucuya ulaşılamadı" yüzeyi.
 *
 * NEDEN AYRI BİR YÜZEY: sunucusu bulunamayan bir kurulumda kullanıcıya boş bir
 * giriş formu göstermek, onu adı-şifreyi yanlış yazmakla suçlar. Gerçek sorun
 * bambaşka ve çözümü de kullanıcı adında değil. Bu ekran sebebi söyler ve
 * eylemi önüne koyar.
 *
 * ⚠️ "Ayrıntılar" bloğu süs değil: destek telefonunda ilk sorulan üç şey
 * (hangi ağ tarandı, kaç adres denendi, ağ ilanı dinlenebildi mi) burada yazılı.
 * Onsuz teşhis "bilmiyorum"la başlar.
 */
export interface ServerNotFoundPanelProps {
  /** Aday seçilip uygulandığında — çağıran yeniden prob edip forma dönmeli. */
  onResolved: () => void;
  onOpenAddressDialog: () => void;
  /** Kimlik uyuşmazlığı olan aday seçilirse üst katmana bildirilir. */
  onMismatch: (candidate: DiscoveredServer) => void;
}

export function ServerNotFoundPanel({
  onResolved,
  onOpenAddressDialog,
  onMismatch,
}: ServerNotFoundPanelProps) {
  const discovery = useServerDiscovery();
  const [showDetails, setShowDetails] = useState(false);
  const state = discovery.state;
  const searching = state?.status === "running";

  const apply = async (c: DiscoveredServer): Promise<void> => {
    if (c.matchesPinned === "mismatch") {
      onMismatch(c);
      return;
    }
    applyApiBaseUrl(c.baseUrl);
    await setStoredApiBaseUrl(c.baseUrl);
    await pushRecentApiBaseUrl(c.baseUrl);
    toast.success("Sunucuya bağlanıldı.", { description: c.baseUrl });
    onResolved();
  };

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center space-y-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
          <ServerCrash className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Sunucuya ulaşılamadı</h2>
          <p className="text-sm text-muted-foreground">
            Giriş yapabilmek için önce sunucuya bağlanmak gerekiyor.
          </p>
        </div>
      </div>

      {(state?.candidates.length ?? 0) > 0 ? (
        <ServerDiscoveryPanel
          state={state}
          onPick={(c) => void apply(c)}
          onRescan={() => void discovery.start(12000)}
        />
      ) : (
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li>• Sunucu bilgisayarı kapalı olabilir.</li>
          <li>• Bu bilgisayar farklı bir ağda olabilir (Wi-Fi / kablo).</li>
          <li>• Sunucunun güvenlik duvarı bağlantıyı engelliyor olabilir.</li>
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Button onClick={() => void discovery.start(12000)} disabled={searching}>
          {searching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Aranıyor…
            </>
          ) : (
            <>
              <Radar className="mr-2 h-4 w-4" />
              Sunucuyu Ara
            </>
          )}
        </Button>
        <Button variant="outline" onClick={onOpenAddressDialog}>
          <Settings2 className="mr-2 h-4 w-4" />
          Adresi Elle Gir
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Ayrıntıları gizle" : "Ayrıntılar"}
        </Button>
      </div>

      {showDetails && (
        <div className="space-y-1 rounded-md bg-muted p-3 text-xs text-muted-foreground">
          <div>
            Ağ ilanı:{" "}
            {state?.mdns.available
              ? `dinlendi (${state.mdns.hits} yanıt)`
              : `dinlenemedi${state?.mdns.error ? ` — ${state.mdns.error}` : ""}`}
          </div>
          <div>
            Ağ taraması:{" "}
            {state?.scan.ran
              ? `${state.scan.targets} adres denendi, ${state.scan.open} yanıt`
              : `koşmadı${state?.scan.skippedReason ? ` (${state.scan.skippedReason})` : ""}`}
          </div>
          <div>
            Son arama:{" "}
            {state?.finishedAt ? new Date(state.finishedAt).toLocaleTimeString("tr-TR") : "—"}
          </div>
        </div>
      )}
    </div>
  );
}
