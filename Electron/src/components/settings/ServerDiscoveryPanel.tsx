import { useState } from "react";
import { Radar, Server, Loader2, AlertTriangle, Network } from "lucide-react";
import type { DiscoveredServer, DiscoveryState } from "@shared/ipc-contract";
import { groupByInstallation, bySourceRank } from "@shared/discovery";
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
 *
 * ⚠️ BİR SATIR = BİR SUNUCU, bir adres DEĞİL. Çok ağ arayüzlü sunucu aynı tek
 * süreci birden çok adresten cevaplar (ölçüm: Wi-Fi + hotspot + Hyper-V sanal
 * anahtarı + Tailscale = 7 IPv4, tek dinleyen süreç). Satır en iyi adresi
 * kendiliğinden seçer; diğerleri "N adres" düğmesiyle açılır ve kullanıcı
 * isterse ELLE seçebilir — otomatik seçim bir tercih sırasıdır, ELEME değil.
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
  const [openKey, setOpenKey] = useState<string | null>(null);
  const running = state?.status === "running" || busy;
  // `groups` ana kaynaktır; eski/kısmi bir durum nesnesi taşımıyorsa aday
  // listesinden AYNI yüklemle türetilir (iki yerde iki kural olmasın).
  const groups =
    state?.groups && state.groups.length > 0
      ? state.groups
      : groupByInstallation(state?.candidates ?? [], bySourceRank);

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

      {running && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Ağdaki sunucular aranıyor…</p>
      )}

      {!running && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">Ağda sunucu bulunamadı.</p>
      )}

      <ul className="space-y-1.5">
        {groups.map((g) => {
          const c = g.primary;
          const mismatch = c.matchesPinned === "mismatch";
          const others = g.addresses.filter((a) => a !== c);
          const open = openKey === g.key;
          return (
            <li key={g.key} className="space-y-1">
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

              {others.length > 0 && (
                <div className="pl-7">
                  <button
                    type="button"
                    onClick={() => setOpenKey(open ? null : g.key)}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Network className="h-3 w-3" />
                    {open
                      ? "adresleri gizle"
                      : `bu sunucunun ${g.addresses.length} adresi var — başka adres seç`}
                  </button>
                  {open && (
                    <ul className="mt-1 space-y-1">
                      {others.map((a) => (
                        <li key={`${a.host}:${a.port}`}>
                          <button
                            type="button"
                            onClick={() => onPick(a)}
                            className="flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-left text-xs transition hover:bg-accent"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {a.host}:{a.port}
                              {` · ${a.rttMs} ms`}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {sourceLabel(a.via)}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
