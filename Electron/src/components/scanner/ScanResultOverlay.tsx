import { useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScannerStore } from "@/store/scanner";
import { useTabsStore } from "@/store/tabs";
import { resolveScan } from "@/lib/scanner/scan-resolvers";
import type { BarcodeKind } from "@/lib/scanner/barcode-kind";

const KIND_LABEL: Record<BarcodeKind, string> = {
  ROLL: "Top",
  TRAVELER_CARD: "Refakat Kartı",
  SWATCH: "Kartela",
  SACK: "Çuval",
  SHIPMENT: "Sevkiyat",
  DISPATCH_DOC: "Belge",
  UNKNOWN: "Kod",
};

/**
 * "Her yerde okut" sonuç paneli — global wedge bir kod yakalayınca açılır:
 * kodu sınıflar, doğru ucu vurar, varlık özetini + gidilebilecek sekme
 * aksiyonlarını gösterir. AppShell'de bir kez render edilir.
 */
export function ScanResultOverlay() {
  const pending = useScannerStore((s) => s.pending);
  const clear = useScannerStore((s) => s.clear);
  const openTab = useTabsStore((s) => s.openTab);

  const q = useQuery({
    queryKey: ["scan-resolve", pending?.kind, pending?.code, pending?.nonce],
    queryFn: () => resolveScan(pending!.kind, pending!.code),
    enabled: !!pending,
    gcTime: 0,
    staleTime: 0,
  });

  const res = q.data;

  const go = (to: string, state?: unknown) => {
    openTab(to, state !== undefined ? { state } : undefined);
    clear();
  };

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) clear();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" /> Okutuldu
            {pending && <Badge variant="secondary">{KIND_LABEL[pending.kind]}</Badge>}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{pending?.code}</DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Çözümleniyor…
          </div>
        ) : res ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">{res.title}</p>
              {res.subtitle && <p className="text-xs text-muted-foreground">{res.subtitle}</p>}
              {!res.found && (
                <p className="mt-1 text-xs text-destructive">{res.note ?? "Bulunamadı."}</p>
              )}
              {res.found && res.note && (
                <p className="mt-1 text-xs text-muted-foreground">{res.note}</p>
              )}
            </div>
            {res.actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {res.actions.map((a) => (
                  <Button
                    key={a.to + a.label}
                    size="sm"
                    variant={a.primary ? "default" : "outline"}
                    onClick={() => go(a.to, a.state)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
