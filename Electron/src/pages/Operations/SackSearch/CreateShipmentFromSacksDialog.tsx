import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sackSearchService } from "./service";
import type { ShipmentDestination } from "./types";

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

interface Props {
  sackIds: string[] | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: (shipmentId: string) => void;
}

/**
 * Seçilen mühürlü havuz çuvallarından sevkiyat kur — önizleme (içerik + donacak sipariş
 * tahsisleri) + yurtiçi/yurtdışı + prosedür kodu, sonra POST /shipments {sackIds}.
 */
export function CreateShipmentFromSacksDialog({ sackIds, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [destination, setDestination] = useState<ShipmentDestination>("DOMESTIC");
  const [procedureCode, setProcedureCode] = useState("");
  const open = sackIds !== null && sackIds.length > 0;

  const preview = useQuery({
    queryKey: ["create-shipment-preview", sackIds],
    queryFn: () => sackSearchService.previewShipment(sackIds ?? []),
    enabled: open,
    staleTime: 5_000,
  });
  const data = preview.data?.data;

  const createMut = useMutation({
    mutationFn: () =>
      sackSearchService.createShipment(sackIds ?? [], destination, procedureCode.trim() || null),
    onSuccess: (res) => {
      toast.success(`Sevkiyat kuruldu: ${res.data.shipmentNo}`);
      void qc.invalidateQueries({ queryKey: ["sack-search"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["sack-store"] });
      onOpenChange(false);
      onCreated?.(res.data.id);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Seçili Çuvallardan Sevkiyat Oluştur</DialogTitle>
          <DialogDescription>
            {sackIds?.length ?? 0} mühürlü çuval → tek müşteri/şube. Aşağıdaki sipariş tahsisleri sevkiyata
            atanınca donar; kalan çuvallar havuzda kalır.
          </DialogDescription>
        </DialogHeader>

        {preview.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Önizleme yükleniyor…
          </div>
        ) : data ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 font-medium">
                {data.totals.sackCount} çuval · {fmtM(data.totals.totalMeters)}
              </div>
              <ul className="max-h-28 space-y-0.5 overflow-auto text-xs text-muted-foreground">
                {data.sacks.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <span className="font-mono">{s.manualCode ?? s.sackNo}</span>
                    <span>
                      {s.rollCount} top · {fmtM(s.totalMeters)}
                      {s.weightKg != null ? ` · ${s.weightKg} kg` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 font-medium">Sipariş karşılanması (donacak)</div>
              {data.orders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Bu çuvallar herhangi bir açık siparişe sayılmıyor (fazla mal / stok sevki).
                </p>
              ) : (
                <ul className="space-y-0.5 text-xs">
                  {data.orders.map((o) => (
                    <li key={o.orderNumber} className="flex justify-between gap-2">
                      <span className="font-mono">{o.orderNumber}</span>
                      <span className="font-medium text-primary">{fmtM(o.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Select value={destination} onValueChange={(v) => setDestination(v as ShipmentDestination)}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DOMESTIC">Yurtiçi</SelectItem>
                  <SelectItem value="EXPORT">Yurtdışı</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={procedureCode}
                onChange={(e) => setProcedureCode(e.target.value)}
                placeholder="Prosedür / ihracat kodu (opsiyonel)"
                className="h-9 flex-1"
              />
            </div>
            {destination === "EXPORT" && (
              <p className="text-xs text-amber-600">
                Yurtdışı sevkte tüm çuvallar tartılı olmalı — tartısız çuval varsa backend reddeder.
              </p>
            )}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Önizleme alınamadı.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!data || createMut.isPending} onClick={() => createMut.mutate()}>
            <Truck className="mr-1 h-4 w-4" /> Sevkiyat Kur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
