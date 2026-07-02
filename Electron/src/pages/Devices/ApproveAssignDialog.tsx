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
import { deviceService } from "./service";
import type { DeviceListItem } from "./types";

interface Props {
  device: DeviceListItem | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Cihaz onayı — SADECE kimlik: onay + tür. Çalışma oturumu modeliyle makine ve
 * donanım ataması bu diyalogdan KALKTI: tablet makinesine oturum açarak bağlanır
 * (yer onayı / makine QR'ı), donanım makineye/istasyona Donanım sayfasından
 * bağlanır. Tür akışı belirler: TABLET/PHONE = sahada oturum ister (yer onayı),
 * DESKTOP = panel (oturum zorunluluğundan muaf).
 */
export function ApproveAssignDialog({ device, onOpenChange, onDone }: Props) {
  const [kind, setKind] = useState<string>("TABLET");

  useEffect(() => {
    setKind(device?.kind ?? "TABLET");
  }, [device]);

  const mutation = useMutation({
    mutationFn: (id: string) => deviceService.approve(id, null, kind),
    onSuccess: () => {
      toast.success("Cihaz onaylandı");
      onDone();
    },
  });

  return (
    <Dialog open={!!device} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cihazı Onayla</DialogTitle>
          <DialogDescription>
            "{device?.name}" cihazı sisteme kabul edilecek. Makine/donanım ataması
            gerekmez — saha cihazı (tablet/telefon) çalışacağı yeri oturum açarken
            seçer (yer onayı / makine QR'ı); donanım makineye ya da istasyona
            "Donanım" sayfasından bağlanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField
            label="Tür"
            hint="TABLET/PHONE = sahada yer onayıyla çalışır; DESKTOP = yönetim paneli (oturum istemez)"
          >
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="TABLET">Tablet</option>
              <option value="PHONE">Telefon</option>
              <option value="DESKTOP">PC / Yönetici</option>
            </select>
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
              {mutation.isPending ? "Kaydediliyor..." : "Onayla"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
