import { useState } from "react";
import { toast } from "sonner";
import { DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { safeFormat } from "@/lib/format";
import { fmtBytes } from "../ServerStatus/serverHealth";
import { useBackups } from "../Backups/hooks";
import { useStartCopy } from "./hooks";
import type { DbCopyListing } from "./types";

/**
 * Kopya başlatma. Yıkıcı DEĞİL (canlı veriye dokunulmaz) → `TypeToConfirm`
 * gerekmez; yalnız "diski ve I/O'yu meşgul eder" uyarısıyla `ConfirmDialog`.
 */
export function StartCopyCard({
  listing,
  presetBackup,
}: {
  listing: DbCopyListing | undefined;
  presetBackup?: string | null;
}) {
  const backups = useBackups();
  const start = useStartCopy();
  const [selected, setSelected] = useState<string>(presetBackup ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const files = backups.data?.files ?? [];
  const blocked =
    !!listing?.capabilityError ||
    (listing?.capabilities && !listing.capabilities.enabled) ||
    (listing?.disk && !listing.disk.ok) ||
    !!listing?.job;

  const blockMessage =
    listing?.capabilityError ??
    (listing?.capabilities && !listing.capabilities.enabled ? listing.capabilities.reason : null) ??
    (listing?.disk && !listing.disk.ok ? listing.disk.blockReason : null) ??
    (listing?.job ? "Bir kopya işlemi sürüyor." : null);

  function submit() {
    start.mutate(selected, {
      onSuccess: (r) => {
        setConfirmOpen(false);
        if (r.success) toast.success(r.message);
        else toast.error(r.message);
      },
      onError: (e: unknown) => {
        setConfirmOpen(false);
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "Kopya başlatılamadı.";
        toast.error(msg);
      },
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-sm font-medium">Hangi yedekten kopya oluşturulsun?</p>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="h-9 w-full max-w-md">
                <SelectValue placeholder="Yedek seçin…" />
              </SelectTrigger>
              <SelectContent>
                {files.map((f) => (
                  <SelectItem key={f.name} value={f.name}>
                    {f.name} · {fmtBytes(f.sizeBytes)} ·{" "}
                    {safeFormat(f.time, "dd.MM.yyyy HH:mm")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!selected || !!blocked || start.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            <DatabaseZap className="mr-1.5 h-4 w-4" />
            Kopya oluştur
          </Button>
        </div>

        {blockMessage && <Callout tone="danger">{blockMessage}</Callout>}

        {listing?.disk?.warnings.map((w) => (
          <Callout key={w} tone="warning">
            {w}
          </Callout>
        ))}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Kopya oluşturulsun mu?"
          description={
            `Yedek yeni bir veritabanına geri yüklenecek. CANLI VERİTABANINA DOKUNULMAZ ` +
            `— beğenmezseniz kopyayı silersiniz.\n\n` +
            `İşlem veritabanı boyutu kadar disk kullanır ve sürerken diski/CPU'yu meşgul eder; ` +
            `mümkünse mesai dışında çalıştırın.`
          }
          confirmLabel="Kopyayı oluştur"
          onConfirm={submit}
          isPending={start.isPending}
        />
      </CardContent>
    </Card>
  );
}
