import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";

interface Props {
  device: DeviceListItem | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function ApproveAssignDialog({ device, onOpenChange, onDone }: Props) {
  const [machineId, setMachineId] = useState<string | null>(null);

  useEffect(() => {
    setMachineId(device?.machineId ?? null);
  }, [device]);

  const mutation = useMutation({
    mutationFn: (id: string) => deviceService.approve(id, machineId),
    onSuccess: () => {
      toast.success(machineId ? "Cihaz onaylandı ve makineye atandı" : "Cihaz onaylandı (atamasız)");
      onDone();
    },
  });

  return (
    <Dialog open={!!device} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cihazı Onayla & Ata</DialogTitle>
          <DialogDescription>
            "{device?.name}" tabletini onayla ve bir makineye ata. Makine boş bırakılırsa cihaz
            onaylanır ama makine ataması olmaz (üretim atfı null).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="Makine" hint="Boş → atamasız onayla">
            <ReferenceSelect<Machine>
              value={machineId}
              onChange={(v) => setMachineId(v ?? null)}
              service={machineService}
              queryKey="machines"
              getLabel={(m) => `${m.code} — ${m.name}`}
              placeholder="Makine seç..."
              nullable
              noneLabel="— (atamasız onayla)"
            />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
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
