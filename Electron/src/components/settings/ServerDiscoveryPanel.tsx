import { Radar, Server, Loader2, AlertTriangle } from "lucide-react";
import type { DiscoveredServer, DiscoveryState } from "@shared/ipc-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Ağda bulunan sunucuların listesi. İki yerde kullanılır: sunucu adresi
 * diyaloğu ve "sunucuya ulaşılamadı" ekranı.
 *
 * ⚠️ SATIRIN EN BÜYÜK YAZISI FİRMA ADIDIR, IP değil. Ağda ikinci bir TeksERP
 * çıkmasının en olası sebebi saldırgan değil, unutulmuş bir demo/test
 * kurulumudur; operatörün "hangisi bizimki" sorusunu IP'ye bakarak
 * cevaplaması beklenemez.
 */
export interface ServerDiscoveryPanelProps {
  state: DiscoveryState | null;
  onPick: (server: DiscoveredServer) => void;
  onRescan?: () => void;
  busy?: boolean;
}

function sourceLabel(via: DiscoveredServer["via"]): string {
  switch (via) {
    case "mdns":
      return "ağ ilanı";
    case "scan":
      return "ağ taraması";
    case "stored":
      return "kayıtlı adres";
    case "recent":
      return "son kullanılan";
    case "localhost":
      return "bu bilgisayar";
  }
}

export function ServerDiscoveryPanel({
  state,
  onPick,
  onRescan,
  busy,
}: ServerDiscoveryPanelProps) {
  const running = state?.status === "running" || busy;
  const candidates = state?.candidates ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Ağda bulunanlar</span>
        {onRescan && (
          <Button type="button" variant="ghost" size="sm" onClick={onRescan} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Radar className="mr-2 h-3.5 w-3.5" />
            )}
            {running ? "Aranıyor…" : "Yeniden ara"}
          </Button>
        )}
      </div>

      {running && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">Ağdaki sunucular aranıyor…</p>
      )}

      {!running && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">Ağda sunucu bulunamadı.</p>
      )}

      <ul className="space-y-1.5">
        {candidates.map((c) => {
          const mismatch = c.matchesPinned === "mismatch";
          return (
            <li key={`${c.host}:${c.port}`}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition hover:bg-accent ${
                  mismatch ? "opacity-60" : ""
                }`}
              >
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  {/* Firma adı ana satır — yukarıdaki nota bak. */}
                  <span className="block truncate font-medium">
                    {c.identity?.companyName || c.identity?.serverName || `${c.host}`}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.identity?.serverName ? `${c.identity.serverName} · ` : ""}
                    {c.host}:{c.port}
                    {c.identity?.version ? ` · v${c.identity.version}` : ""}
                    {` · ${c.rttMs} ms`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {sourceLabel(c.via)}
                  </Badge>
                  {mismatch && (
                    <Badge variant="destructive" className="text-[10px]">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      farklı kurulum
                    </Badge>
                  )}
                  {/* Kimlik YOKLUĞU uyuşmazlık DEĞİLDİR — eski sürüm olabilir. */}
                  {!c.identity && (
                    <Badge variant="secondary" className="text-[10px]">
                      kimlik bilgisi yok
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {state && (state.scan.ran || state.mdns.error) && (
        <p className="text-[11px] text-muted-foreground">
          {state.scan.ran
            ? `${state.scan.targets} adres tarandı, ${state.scan.open} yanıt.`
            : ""}
          {state.mdns.error ? ` Ağ ilanı dinlenemedi (${state.mdns.error}).` : ""}
        </p>
      )}
    </div>
  );
}
