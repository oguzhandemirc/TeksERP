import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { licenseService } from "@/services/licenseService";
import type { LicenseHardwareReportResult } from "@/types/license";
import { useLicenseAction } from "./hooks";

const RESULT_TEXT: Record<LicenseHardwareReportResult["durum"], string> = {
  BEKLIYOR: "Bildirim iletildi; lisans sunucusu onaylayınca yeni donanım kendiliğinden tanınır.",
  ONAYLANDI: "Donanım değişikliği kabul edildi; lisans yenilendi.",
  REDDEDILDI: "Donanım değişikliği bildirimi reddedildi; destek talebi açın.",
};

/**
 * "Donanım değişikliğini bildir" (K8): disk/anakart değişiminden sonra yönetici bildirir; backend parmak izini
 * yeniden ölçer ve lisans sunucusuna gönderir. Güçlü etkenler tutuyorsa sunucu kendiliğinden kabul eder, tutmuyorsa
 * onay bekler.
 */
export function LicenseHardwareReport() {
  const [open, setOpen] = useState(false);
  const [gerekce, setGerekce] = useState("");
  const { busy, run } = useLicenseAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2">
      <Input
        value={gerekce}
        onChange={(e) => setGerekce(e.target.value)}
        placeholder="Ne değişti? (isteğe bağlı)"
        aria-label="Donanım değişikliği gerekçesi"
        maxLength={500}
        className="max-w-xs"
      />
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setOpen(true)}>
        Donanım değişikliğini bildir
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Donanım değişikliği bildirilsin mi?"
        description="Parmak izi yeniden ölçülür ve lisans sunucusuna gönderilir. Parçaların çoğu birden değiştiyse taşıma talebi gerekir."
        confirmLabel="Bildir"
        isPending={busy === "donanim"}
        onConfirm={() =>
          run("donanim", async () => {
            try {
              const r = await licenseService.reportHardwareChange(gerekce.trim() || null);
              setGerekce("");
              return RESULT_TEXT[r.durum];
            } finally {
              setOpen(false);
            }
          }).then(() => undefined)
        }
      />
    </div>
  );
}
