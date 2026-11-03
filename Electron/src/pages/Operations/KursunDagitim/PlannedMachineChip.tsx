import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { kursunDagitimService } from "./service";
import { DISTRIBUTION_QUERY_KEY, distributionQueryFn } from "./useKursunDistribution";
import type { KursunDistributionRowBase } from "./types";

/** Uç kapısıyla aynı küme (`PATCH /work-orders/:id/steps/:stepId/planned-machine`). */
export const PLANNED_MACHINE_PERMISSIONS = ["workorder:write", "workorder:distribute", "mobile:kursun-dagitim"];

/**
 * Plan makinesi (Gülkesim 2026-11-02) — yalnız ÖNERİ: rozet + değiştir. Dağıtımı engellemez,
 * uyarı üretmez; fiilî makine dağıtımdan / tablet oturumundan gelir.
 */
export function PlannedMachineChip({ row }: { row: KursunDistributionRowBase }) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const [open, setOpen] = useState(false);
  // Makine listesi ekranın TEK payload'ından (önbellekte; ayrı istek yok).
  const { data } = useQuery({ queryKey: DISTRIBUTION_QUERY_KEY, queryFn: distributionQueryFn, enabled: false });
  const machines = data?.data?.machines ?? [];
  const mut = useMutation({
    mutationFn: (machineId: string | null) =>
      kursunDagitimService.setPlannedMachine(row.workOrderId, row.workOrderStepId, machineId),
    onSuccess: (res) => {
      toast.success(res.message ?? "Makine önerisi kaydedildi");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
    },
  });
  const canEdit = hasAnyPermission(PLANNED_MACHINE_PERMISSIONS) && machines.length > 0;
  const label = row.plannedMachineName ? `Plan: ${row.plannedMachineName}` : "Plan makinesi —";
  if (!canEdit) {
    return row.plannedMachineName ? (
      <Badge variant="outline" className="gap-1 text-[10px]" data-testid="planned-machine-chip">
        <Cpu className="h-3 w-3" /> {label}
      </Badge>
    ) : null;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="planned-machine-chip" title="Önerilen makine — değiştirmek için tıkla">
          <Badge variant="outline" className="gap-1 text-[10px]">
            <Cpu className="h-3 w-3" /> {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-2">
        <p className="text-[11px] text-muted-foreground">Önerilen makine (yalnız öneri)</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={row.plannedMachineId ? "outline" : "default"} disabled={mut.isPending} onClick={() => mut.mutate(null)}>
            Öneri yok
          </Button>
          {machines.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={row.plannedMachineId === m.id ? "default" : "outline"}
              disabled={mut.isPending}
              onClick={() => mut.mutate(m.id)}
            >
              {m.name}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
