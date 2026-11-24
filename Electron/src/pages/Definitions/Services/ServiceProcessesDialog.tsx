// Hizmet kartının süreç türleri (fason F3): tek modal, onay kutulu liste; başka karta eşli tür seçilemez.
// Kayıt kart başına küme değişimidir (`PUT /:id/processes`); 409 toast'ı apiClient basar, harita tazelenir.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SERVICE_PROCESS_MAP_QUERY_KEY, putServiceItemProcesses } from "./serviceProcesses";
import { ServiceProcessPicker, useServiceProcessSelection } from "./ServiceProcessPicker";

interface Props {
  item: { id: string; code: string; name: string; isActive: boolean } | null;
  onClose: () => void;
}

/** Süreç eşlemesinin ne işe yaradığı — modal ve form aynı metni gösterir. */
export const SERVICE_PROCESS_HELP =
  "Seçilen süreç türündeki (boya, apre…) adım işi bu hizmet kartıyla faturalanır. Bir tür yalnız bir karta eşlenir. Faturaya girmesi için Özellik Anahtarları › Hizmet faturası › \"Boya, apre gibi adımları da faturala\" açık olmalı.";

export function ServiceProcessesDialog({ item, onClose }: Props) {
  const qc = useQueryClient();
  const open = item !== null;
  const sel = useServiceProcessSelection(item?.id ?? null, open);

  const save = useMutation({
    mutationFn: () => putServiceItemProcesses(item!.id, sel.ids),
    onSuccess: (res) => {
      toast.success(res.changed ? "Süreç türü eşlemesi kaydedildi." : "Değişiklik yok.");
      onClose();
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Süreç türleri — {item?.name}</DialogTitle>
          <DialogDescription>{SERVICE_PROCESS_HELP}</DialogDescription>
        </DialogHeader>
        {item && !item.isActive && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Kart kullanımdan kalkmış: yeni tür eklenemez, yalnız çıkarılabilir.
          </p>
        )}
        <ServiceProcessPicker options={sel.options} selected={sel.selected} onToggle={sel.toggle} loading={sel.loading} cardActive={item?.isActive !== false} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={save.isPending || sel.loading} onClick={() => save.mutate()}>
            {save.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
