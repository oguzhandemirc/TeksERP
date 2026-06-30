import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { peripheralService } from "@/pages/PeripheralDevices/service";
import { peripheralKindLabels } from "@/pages/PeripheralDevices/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";

interface Props {
  device: DeviceListItem | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function ApproveAssignDialog({ device, onOpenChange, onDone }: Props) {
  const [machineId, setMachineId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Donanım listesi (Donanım sayfasındaki tüm cihazlar). Bu cihaza hangi
  // yazıcı/okuyucu atanacağını buradan seçeriz (tablet → donanım doğrudan).
  const { data: peripherals } = useQuery({
    queryKey: ["peripherals", "picker"],
    queryFn: () => loadAllForPicker(peripheralService),
    enabled: !!device,
  });

  useEffect(() => {
    setMachineId(device?.machineId ?? null);
    // Bu cihaza halihazırda atanmış donanımı (M:N join) ön-işaretle.
    setSelectedIds((device?.hardwareLinks ?? []).map((h) => h.peripheral.id));
  }, [device]);

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      await deviceService.approve(id, machineId);
      await deviceService.assignHardware(id, selectedIds);
    },
    onSuccess: () => {
      toast.success("Cihaz onaylandı + donanım atandı");
      onDone();
    },
  });

  const toggle = (id: string, on: boolean) =>
    setSelectedIds((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));

  const rows = (peripherals?.data ?? []).filter((p) => p.isActive);

  return (
    <Dialog open={!!device} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cihazı Onayla & Donanım Ata</DialogTitle>
          <DialogDescription>
            "{device?.name}" cihazını onayla ve kullandığı donanımı (yazıcı/okuyucu) seç.
            Makine = üretim atfı (bu tablet hangi makinede); boş bırakılabilir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="Donanım" hint="Bu cihazın kullandığı yazıcı/metre/kantar">
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
              {rows.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Donanım yok — "Donanım" sayfasından ekleyin.
                </div>
              )}
              {rows.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                  <span>
                    <span className="text-muted-foreground">[{peripheralKindLabels[p.kind]}]</span>{" "}
                    {p.code} — {p.name}
                  </span>
                </label>
              ))}
            </div>
          </FormField>

          <FormField label="Makine (üretim atfı)" hint="Boş → atfsız onayla">
            <ReferenceSelect<Machine>
              value={machineId}
              onChange={(v) => setMachineId(v ?? null)}
              service={machineService}
              queryKey="machines"
              getLabel={(m) => `${m.code} — ${m.name}`}
              placeholder="Makine seç..."
              nullable
              noneLabel="— (atfsız onayla)"
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              İptal
            </Button>
            <Button onClick={() => device && mutation.mutate(device.id)} disabled={mutation.isPending}>
              {mutation.isPending ? "Kaydediliyor..." : "Onayla & Ata"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
