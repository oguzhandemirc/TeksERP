import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { sackStoreService } from "@/pages/Operations/SackStore/service";
import type { SackStoreShipment } from "@/pages/Operations/SackStore/types";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

interface Props {
  shipment: SackStoreShipment | null;
  onOpenChange: (open: boolean) => void;
  onDispatched: (id: string) => void;
}

/**
 * Sevk onayı — yıkıcı (stok düşer, terminal). CLAUDE.md kuralı gereği etkilenecek
 * her çuvalı somut listeler; soyut "N çuval" yetmez. İçerik `sack-contents`'ten
 * canlı çekilir; taşıma bilgileri (plaka/şoför) opsiyonel.
 */
export function DispatchConfirmDialog({ shipment, onOpenChange, onDispatched }: Props) {
  const qc = useQueryClient();
  const open = !!shipment;
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");

  const contentsQ = useQuery({
    queryKey: ["sack-store", "contents", shipment?.id],
    queryFn: () => sackStoreService.shipmentContents(shipment!.id),
    enabled: open,
    gcTime: 0,
  });
  const contents = contentsQ.data?.data;

  const dispatchMut = useMutation({
    mutationFn: () =>
      sackStoreService.dispatch(shipment!.id, {
        plateNumber: plateNumber.trim() || null,
        driverName: driverName.trim() || null,
      }),
    onSuccess: () => {
      toast.success(`Sevk edildi: ${shipment!.shipmentNo}`);
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      const id = shipment!.id;
      setPlateNumber("");
      setDriverName("");
      onDispatched(id);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPlateNumber("");
          setDriverName("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sevk Et — {shipment?.shipmentNo}</DialogTitle>
          <DialogDescription>
            {shipment?.customer.name}
            {shipment?.branch ? ` · ${shipment.branch.name}` : ""} — bu sevkiyat çıkış yapacak ve
            içindeki topların stoğu <strong>düşecek</strong>. Aşağıdaki çuvalların yüklendiğini
            doğrulayın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {contentsQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : contents ? (
            <div className="rounded-md border">
              <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                {contents.sackCount} çuval · {DEC.format(shipment?.totalQty ?? 0)} m ·{" "}
                {DEC.format(shipment?.totalKg ?? 0)} kg
              </div>
              <ul className="max-h-56 divide-y overflow-y-auto text-sm">
                {contents.sacks.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-3 py-1.5">
                    <span className="font-mono">
                      {s.sackNo}
                      {s.manualCode ? (
                        <span className="ml-1 text-xs text-muted-foreground">({s.manualCode})</span>
                      ) : null}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {s.rollCount} top · {DEC.format(s.totalQty)} m
                      {s.weightKg != null ? ` · ${DEC.format(s.weightKg)} kg` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              <span className="block text-muted-foreground">Plaka (opsiyonel)</span>
              <Input
                className="mt-1"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
              />
            </label>
            <label className="text-xs">
              <span className="block text-muted-foreground">Şoför (opsiyonel)</span>
              <Input
                className="mt-1"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
            </label>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            variant="destructive"
            disabled={dispatchMut.isPending || contentsQ.isLoading}
            onClick={() => dispatchMut.mutate()}
          >
            {dispatchMut.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <PackageCheck className="mr-1 h-4 w-4" />
            )}
            Sevk Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
