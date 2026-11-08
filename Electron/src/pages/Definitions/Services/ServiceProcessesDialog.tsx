// Hizmet kartının süreç türleri (fason F3): tek modal, onay kutulu liste; başka karta eşli tür seçilemez.
// Kayıt kart başına küme değişimidir (`PUT /:id/processes`); 409 toast'ı apiClient basar, harita tazelenir.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { loadAllForPicker } from "@/lib/picker-loader";
import { cn } from "@/lib/utils";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { SERVICE_PROCESS_MAP_QUERY_KEY, getServiceProcessMap, processOptions, processesOf, putServiceItemProcesses, type ProcessOption } from "./serviceProcesses";

interface Props {
  item: { id: string; code: string; name: string; isActive: boolean } | null;
  onClose: () => void;
}

export function ServiceProcessesDialog({ item, onClose }: Props) {
  const qc = useQueryClient();
  const open = item !== null;
  const mapQ = useQuery({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY, queryFn: getServiceProcessMap, enabled: open });
  // Pasif türler de çekilir: bu karta eşli pasif tür listede kalmalı (çıkarılabilsin).
  const catQ = useQuery({
    queryKey: ["subcontractor-categories", "picker", "all"],
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { filters: {} }),
    enabled: open,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const mapKey = (mapQ.data ?? []).map((r) => `${r.categoryId}:${r.serviceItemId}`).join(",");
  useEffect(() => {
    if (item && mapQ.data) setSelected(new Set(processesOf(item.id, mapQ.data).map((r) => r.categoryId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, mapKey]);

  const options = useMemo(
    () => (item ? processOptions(item.id, catQ.data?.data ?? [], mapQ.data ?? []) : []),
    [item, catQ.data, mapQ.data],
  );

  const save = useMutation({
    mutationFn: () => putServiceItemProcesses(item!.id, [...selected]),
    onSuccess: (res) => {
      toast.success(res.changed ? "Süreç türü eşlemesi kaydedildi." : "Değişiklik yok.");
      onClose();
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY }),
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Süreç türleri — {item?.name}</DialogTitle>
          <DialogDescription>
            Seçilen süreç türündeki (boya, apre…) adım işi bu hizmet kartıyla faturalanır. Bir tür yalnız bir karta
            eşlenir. Faturaya girmesi için Özellik Anahtarları › Hizmet faturası › "Boya, apre gibi adımları da faturala" açık olmalı.
          </DialogDescription>
        </DialogHeader>
        {item && !item.isActive && (
          <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Kart kullanımdan kalkmış: yeni tür eklenemez, yalnız çıkarılabilir.
          </p>
        )}
        <div className="max-h-80 space-y-1 overflow-auto" role="group" aria-label="Süreç türleri">
          {mapQ.isLoading || catQ.isLoading ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : options.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              Süreç türü yok. Tanımlar › Fason Kategorileri ekranından ekleyin.
            </p>
          ) : (
            options.map((o) => (
              <OptionRow key={o.id} option={o} on={selected.has(o.id)} cardActive={item?.isActive !== false} onToggle={toggle} />
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={save.isPending || mapQ.isLoading} onClick={() => save.mutate()}>
            {save.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({ option: o, on, cardActive, onToggle }: { option: ProcessOption; on: boolean; cardActive: boolean; onToggle: (id: string, on: boolean) => void }) {
  // Başka karta eşli tür seçilemez; pasif karta yalnız çıkarma yapılır.
  const blocked = o.takenBy !== null || (!on && !cardActive);
  return (
    <label className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", blocked ? "opacity-60" : "cursor-pointer hover:bg-muted/50", on && "border-primary bg-primary/5")}>
      <Checkbox checked={on} disabled={blocked} onCheckedChange={(v) => onToggle(o.id, Boolean(v))} aria-label={o.name} />
      <span className="min-w-0 flex-1 truncate">{o.name}</span>
      {o.inactive && <Badge variant="muted">Pasif</Badge>}
      {o.takenBy && <span className="truncate text-xs text-muted-foreground">{o.takenBy} kartına eşli</span>}
    </label>
  );
}
