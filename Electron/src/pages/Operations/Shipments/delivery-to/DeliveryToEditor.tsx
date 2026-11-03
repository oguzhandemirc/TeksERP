import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorMessage } from "@/services/apiClient";
import { shipmentService } from "../service";
import type { ShipmentDetail } from "../types";
import { DeliveryToFields } from "./DeliveryToFields";
import { deliveryToError, deliveryToLine, type DeliveryToState } from "./deliveryTo";

/**
 * Sevkiyat detayında teslim yeri satırı (K18). Teslim yeri yoksa ve sevkiyat sevk
 * edilmişse HİÇ çizilmez; PLANNED'de "Teslim yeri ekle/düzenle" (sevkten sonra değişmez).
 */
export function DeliveryToEditor({ d }: { d: ShipmentDetail }) {
  const line = deliveryToLine(d);
  const planned = d.status === "PLANNED";
  const [open, setOpen] = useState(false);
  if (!line && !planned) return null;
  return (
    <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs" data-testid="delivery-to-row">
      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Teslim yeri:</span>
      <span className={line ? "font-medium" : "italic text-muted-foreground"}>{line ?? "carinin adresi (başka adrese teslim yok)"}</span>
      {planned && (
        <PermissionGate permission="shipping:write">
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> {line ? "Düzenle" : "Teslim yeri ekle"}
          </Button>
        </PermissionGate>
      )}
      {open && <DeliveryToDialog d={d} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeliveryToDialog({ d, onClose }: { d: ShipmentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<DeliveryToState>({ customerId: d.deliveryCustomer?.id ?? null, address: d.deliveryAddress ?? "" });
  const error = deliveryToError(value, d.customer.id);
  const mut = useMutation({
    mutationFn: () => shipmentService.setDeliveryTo(d.id, value),
    onSuccess: (res) => {
      toast.success(res.message ?? "Teslim yeri güncellendi");
      void qc.invalidateQueries({ queryKey: ["shipment-detail", d.id] });
      onClose();
    },
    // 409: sevkiyat bu arada sevk edildi/değişti — detay tazelenir ki satır gerçek durumu göstersin.
    onError: (e) => {
      if ((e as { response?: { status?: number } }).response?.status === 409) void qc.invalidateQueries({ queryKey: ["shipment-detail", d.id] });
    },
  });
  // Ret sebebi diyalogda kalır (toast kaybolur, diyalog açık kalıp neden kaydolmadığını söylemezdi).
  const failure = mut.isError ? apiErrorMessage(mut.error, "Teslim yeri kaydedilemedi.") : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Teslim yeri — {d.shipmentNo}</DialogTitle>
          <DialogDescription>Yalnız sevk edilmemiş sevkiyatta değişir; sevk anında irsaliyeye donar.</DialogDescription>
        </DialogHeader>
        <DeliveryToFields value={value} onChange={setValue} ownerCustomerId={d.customer.id} disabled={mut.isPending} defaultOpen />
        {failure && (
          <p role="alert" className="text-xs text-destructive" data-testid="delivery-to-failure">
            {failure}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Vazgeç</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !!error}>{mut.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
