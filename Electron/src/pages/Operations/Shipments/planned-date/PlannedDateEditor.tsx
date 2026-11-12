import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGate } from "@/components/PermissionGate";
import { apiErrorMessage } from "@/services/apiClient";
import { fmtDayKey } from "@/lib/factory-time";
import { shipmentService } from "../service";
import type { ShipmentDetail } from "../types";
import { PlannedDateField } from "./PlannedDateField";

/**
 * Sevkiyat detayında planlanan sevk günü satırı. Tarih yoksa ve sevkiyat sevk edilmişse HİÇ
 * çizilmez; PLANNED'de eklenir/değişir/kaldırılır (sevkten sonra yalnız okunur).
 */
export function PlannedDateEditor({ d }: { d: ShipmentDetail }) {
  const planned = d.status === "PLANNED";
  const value = d.plannedDate ?? null;
  const [open, setOpen] = useState(false);
  if (!value && !planned) return null;
  return (
    <div className="flex items-center gap-2 border-t px-4 py-2.5 text-xs" data-testid="planned-date-row">
      <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">Planlanan sevk tarihi:</span>
      <span className={value ? "font-medium tabular-nums" : "italic text-muted-foreground"}>{value ? fmtDayKey(value) : "verilmedi"}</span>
      {planned && (
        <PermissionGate permission="shipping:write">
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> {value ? "Düzenle" : "Tarih ekle"}
          </Button>
        </PermissionGate>
      )}
      {open && <PlannedDateDialog d={d} onClose={() => setOpen(false)} />}
    </div>
  );
}

function PlannedDateDialog({ d, onClose }: { d: ShipmentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(d.plannedDate ?? "");
  const mut = useMutation({
    mutationFn: (v: string | null) => shipmentService.setPlannedDate(d.id, v),
    onSuccess: (res) => {
      toast.success(res.message ?? "Planlanan sevk tarihi güncellendi");
      void qc.invalidateQueries({ queryKey: ["shipment-detail", d.id] });
      onClose();
    },
    // 409: sevkiyat bu arada sevk edildi — detay tazelenir ki satır gerçek durumu göstersin.
    onError: (e) => {
      if ((e as { response?: { status?: number } }).response?.status === 409) void qc.invalidateQueries({ queryKey: ["shipment-detail", d.id] });
    },
  });
  const failure = mut.isError ? apiErrorMessage(mut.error, "Planlanan sevk tarihi kaydedilemedi.") : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Planlanan sevk tarihi — {d.shipmentNo}</DialogTitle>
          <DialogDescription>Yalnız sevk edilmemiş sevkiyatta değişir; panodaki ajandada bu güne yerleşir.</DialogDescription>
        </DialogHeader>
        <PlannedDateField value={value} onChange={setValue} disabled={mut.isPending} id="planned-date-edit" />
        {failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}
        <DialogFooter>
          {d.plannedDate && <Button variant="ghost" className="mr-auto" onClick={() => mut.mutate(null)} disabled={mut.isPending}>Tarihi kaldır</Button>}
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Vazgeç</Button>
          <Button onClick={() => mut.mutate(value || null)} disabled={mut.isPending || value === (d.plannedDate ?? "")}>{mut.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
