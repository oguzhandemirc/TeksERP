import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { canRelay, relayViaPanel } from "@/lib/license/relay";
import { licenseService } from "@/services/licenseService";
import type { LicenseDetail, OfflinePurpose } from "@/types/license";
import { LicenseCard } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

const POLL_TEXT: Record<string, string> = {
  BASARILI: "Lisans yenilendi.",
  YAPILANDIRILMAMIS: "Lisans sunucusu adresi tanımlı değil.",
  HAZIR_DEGIL: "Kurulum kimliği ya da lisans klasörü hazır değil.",
  ETKIN_DEGIL: "Kurulum etkinleşmemiş; önce etkinleştirme kodu girin.",
};

/**
 * Etkinleştirme ve yenileme. Backend satıcıya çıkabiliyorsa doğrudan; çıkamıyorsa
 * "bu bilgisayar üzerinden" — panel imzalı isteği taşır (sır görmez).
 */
export function LicenseActivateCard({ d }: { d: LicenseDetail }) {
  const [kod, setKod] = useState("");
  const { busy, run } = useLicenseAction();
  const active = d.kurulum.etkin;
  const relay = (amac: OfflinePurpose) =>
    run(`aktar-${amac}`, async () => {
      const r = await relayViaPanel(amac, amac === "etkinlestir" ? kod.trim() : undefined);
      if (!r.ok) throw new Error(r.message);
      return amac === "etkinlestir" ? "Kurulum bu bilgisayar üzerinden etkinleştirildi." : "Lisans bu bilgisayar üzerinden yenilendi.";
    });
  return (
    <LicenseCard title={active ? "Yenileme" : "Etkinleştirme"}>
      {!active && (
        <div className="flex flex-wrap gap-2">
          <Input
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            placeholder="TKS-XXXX-XXXX-XXXX-XXXX"
            className="max-w-xs font-mono uppercase"
            aria-label="Etkinleştirme kodu"
          />
          <Button
            disabled={busy !== null || !kod.trim()}
            onClick={() => void run("etkinlestir", () => licenseService.activate(kod.trim()).then(() => "Kurulum etkinleştirildi."))}
          >
            Etkinleştir
          </Button>
          {canRelay() && (
            <Button variant="outline" disabled={busy !== null || !kod.trim()} onClick={() => void relay("etkinlestir")}>
              Bu bilgisayar üzerinden etkinleştir
            </Button>
          )}
        </div>
      )}
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run("yokla", async () => {
                const r = await licenseService.pollNow();
                return POLL_TEXT[r.outcome] ?? `Yoklama başarısız: ${r.code ?? r.outcome}`;
              })
            }
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${busy === "yokla" ? "animate-spin" : ""}`} /> Şimdi yokla
          </Button>
          {canRelay() && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void relay("yokla")}>
              Bu bilgisayar üzerinden yenile
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Sunucu internete çıkamıyorsa panel, sunucunun imzaladığı isteği bu bilgisayarın ağından
        taşır; ayrıca 15 dakikada bir kendiliğinden dener.
      </p>
    </LicenseCard>
  );
}
