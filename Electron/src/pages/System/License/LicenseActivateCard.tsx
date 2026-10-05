import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AcceptanceGate } from "@/lib/license/acceptance";
import { refreshSummary } from "@/lib/license/refresh-summary";
import { canRelay, relayViaPanel } from "@/lib/license/relay";
import { licenseService } from "@/services/licenseService";
import type { LicenseDetail, OfflinePurpose } from "@/types/license";
import { LicenseCard } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

const POLL_TEXT: Record<string, string> = {
  YAPILANDIRILMAMIS: "Lisans sunucusu adresi tanımlı değil.",
  HAZIR_DEGIL: "Kurulum kimliği ya da lisans klasörü hazır değil.",
  ETKIN_DEGIL: "Kurulum etkinleşmemiş; önce etkinleştirme kodu girin.",
};

/**
 * Etkinleştirme ve yenileme. Backend satıcıya çıkabiliyorsa doğrudan; çıkamıyorsa
 * "bu bilgisayar üzerinden" — panel imzalı isteği taşır (sır görmez). Etkinleştirme
 * sözleşme kabulünü ister (Ek-7): kapı kapalıyken iki düğme de pasif.
 */
export function LicenseActivateCard({ d, gate }: { d: LicenseDetail; gate: AcceptanceGate }) {
  const [kod, setKod] = useState("");
  const { busy, run } = useLicenseAction();
  const active = d.kurulum.etkin;
  const canActivate = busy === null && kod.trim().length > 0 && gate.ready;
  const relay = (amac: OfflinePurpose) =>
    run(`aktar-${amac}`, async () => {
      if (amac === "etkinlestir") {
        const r = await relayViaPanel(amac, kod.trim());
        if (!r.ok) throw new Error(r.message);
        return "Kurulum bu bilgisayar üzerinden etkinleştirildi.";
      }
      return refreshSummary(async () => {
        const r = await relayViaPanel(amac);
        if (!r.ok) throw new Error(r.message);
        return r.detail;
      });
    });
  return (
    <LicenseCard title={active ? "Yenileme" : "Etkinleştirme"}>
      {!active && (
        <div className="flex flex-wrap gap-2">
          <Input
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            placeholder="TKS-XXXX-XXXX-XXXX-XXXX"
            maxLength={32}
            className="max-w-xs font-mono uppercase"
            aria-label="Etkinleştirme kodu"
          />
          <Button
            disabled={!canActivate}
            onClick={() => void run("etkinlestir", () => licenseService.activate(kod.trim()).then(() => "Kurulum etkinleştirildi."))}
          >
            Etkinleştir
          </Button>
          {canRelay() && (
            <Button variant="outline" disabled={!canActivate} onClick={() => void relay("etkinlestir")}>
              Bu bilgisayar üzerinden etkinleştir
            </Button>
          )}
        </div>
      )}
      {!active && !gate.ready && gate.reason && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="lisans-kabul-kapisi">
          {gate.reason}
        </p>
      )}
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run("yokla", async () => {
                const fail: { text: string | null } = { text: null };
                const summary = await refreshSummary(async () => {
                  const r = await licenseService.pollNow();
                  if (r.outcome !== "BASARILI") fail.text = POLL_TEXT[r.outcome] ?? `Yoklama başarısız: ${r.code ?? r.outcome}`;
                });
                return fail.text ?? summary;
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
