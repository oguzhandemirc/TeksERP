import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { licenseService } from "@/services/licenseService";
import type { LicenseDetail } from "@/types/license";
import { InfoRow, LicenseCard, when } from "./LicenseParts";
import { useLicenseAction } from "./hooks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSFER_TEXT = {
  BEKLIYOR: "Taşıma talebi iletildi; satıcı onaylayınca lisans kendiliğinden gelir.",
  ONAYLANDI: "Taşıma onaylandı; lisans bu sunucuya geçti.",
  REDDEDILDI: "Taşıma talebi reddedildi.",
} as const;

/**
 * Taşıma (yeni sunucu) ve DR devralımı. Taşıma satıcının ONAYINI bekler; DR
 * self-servistir ve ana sunucuyu bir sonraki yoklamasında kısıtlı kipe düşürür —
 * bu yüzden ikinci onay ister.
 */
export function LicenseTransferCard({ d }: { d: LicenseDetail }) {
  const [gerekce, setGerekce] = useState("");
  const [anaKurulumId, setAnaKurulumId] = useState("");
  const [drGerekce, setDrGerekce] = useState("");
  const [confirmDr, setConfirmDr] = useState(false);
  const { busy, run } = useLicenseAction();
  const drReady = UUID_RE.test(anaKurulumId.trim()) && drGerekce.trim().length >= 3;
  return (
    <LicenseCard title="Taşıma ve felaket kurtarma">
      {d.tasima && (
        <InfoRow label={d.tasima.durum === "ONAYLANDI" ? "Taşıma onaylandı" : "Bekleyen taşıma"}>
          {when(d.tasima.istendi)} · {d.tasima.talepId}
          {d.tasima.durum === "ONAYLANDI" && " · taşıma kodunu portaldan alıp etkinleştirme alanına girin"}
        </InfoRow>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="lisans-tasima-gerekce">Taşıma gerekçesi (isteğe bağlı)</Label>
        <div className="flex flex-wrap gap-2">
          <Input id="lisans-tasima-gerekce" value={gerekce} onChange={(e) => setGerekce(e.target.value)} className="max-w-sm" />
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run("tasima", async () => TRANSFER_TEXT[(await licenseService.requestTransfer(gerekce.trim() || null)).durum])
            }
          >
            Taşıma talebi gönder
          </Button>
        </div>
      </div>
      <div className="space-y-1.5 border-t pt-2">
        <Label htmlFor="lisans-dr-ana">DR devral — ana sunucunun kurulum kimliği</Label>
        <Input id="lisans-dr-ana" value={anaKurulumId} onChange={(e) => setAnaKurulumId(e.target.value)} className="font-mono text-xs" />
        <Input value={drGerekce} onChange={(e) => setDrGerekce(e.target.value)} placeholder="Gerekçe (zorunlu)" aria-label="DR gerekçesi" />
        <div className="flex justify-end">
          <Button variant="destructive" disabled={busy !== null || !drReady} onClick={() => setConfirmDr(true)}>
            Üretimi bu sunucuya devral
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDr}
        onOpenChange={setConfirmDr}
        title="Üretim bu DR sunucusuna devredilsin mi?"
        description="Ana sunucu bir sonraki yoklamasında kısıtlı kipe geçer (iki veritabanının ayrışmasını önlemek için). Satıcıya anında bildirilir."
        confirmLabel="Devral"
        destructive
        isPending={busy === "dr"}
        onConfirm={() =>
          run("dr", async () => {
            await licenseService.drTakeover(anaKurulumId.trim(), drGerekce.trim());
            setConfirmDr(false);
            return "Üretim bu sunucuya devredildi.";
          }).then(() => undefined)
        }
      />
    </LicenseCard>
  );
}
