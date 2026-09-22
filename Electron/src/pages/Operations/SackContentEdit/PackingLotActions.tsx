import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Loader2, PackageOpen, Warehouse } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { BulkDistributeSacksDialog } from "./BulkDistributeSacksDialog";
import type { PackingGroup } from "./types";

/**
 * Parti satırından (⋮) başlatılan TOPLU eylemler: sevk et · çuvalları havuza çıkar ·
 * topları depoya çek. Üçünün kapsamı da PARTİNİN TAMAMIDIR — sevk/dağıt için depodaki
 * çuvallar sunucudan cursor sonuna kadar çekilir (`fetchLotWarehouseSacks`), havuza
 * çıkarma ise id'leri hiç taşımaz (`/release`, kapsam sunucuda).
 */
export type LotAction = { kind: "ship" | "release" | "distribute"; lot: PackingGroup };

/** Diyaloglar LİSTE düzeyinde TEK kez durur — satır başına dialog mount edilmez. */
export function LotActionDialogs({
  action,
  onClose,
  onDone,
}: {
  action: LotAction | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const needsSacks = action?.kind === "ship" || action?.kind === "distribute";
  const sacks = useQuery({
    queryKey: ["packing-groups", "lot-warehouse-sacks", action?.lot.id, action?.kind],
    queryFn: () => sackHubService.fetchLotWarehouseSacks(action!.lot.id),
    enabled: needsSacks,
    staleTime: 0,
  });
  // Boş partide diyalog açılmaz — sebep toast'la söylenir ve eylem kapanır.
  useEffect(() => {
    if (needsSacks && sacks.isSuccess && sacks.data.length === 0) {
      toast.info(`${action!.lot.name}: depoda çuval yok.`);
      onClose();
    }
  }, [needsSacks, sacks.isSuccess, sacks.data, action, onClose]);
  useEffect(() => {
    if (needsSacks && sacks.isError) {
      toast.error("Partinin çuvalları alınamadı — yenileyip tekrar deneyin.");
      onClose();
    }
  }, [needsSacks, sacks.isError, onClose]);

  const rows = needsSacks && sacks.data && sacks.data.length > 0 ? sacks.data : null;
  const finish = () => {
    onClose();
    onDone();
  };
  return (
    <>
      {needsSacks && sacks.isLoading && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {action!.lot.name} hazırlanıyor…
        </div>
      )}
      <CreateShipmentDialog
        sacks={action?.kind === "ship" ? rows : null}
        onOpenChange={(o) => !o && onClose()}
        onCreated={finish}
      />
      {/* "Topları depoya çek" = boşalt + çuval kaydını sil (önizleme zorunlu, engelli çuval sebebiyle listelenir). */}
      <BulkDistributeSacksDialog
        sackIds={action?.kind === "distribute" && rows ? rows.map((s) => s.id) : null}
        mod="sil"
        onOpenChange={(o) => !o && onClose()}
        onDone={onDone}
      />
      <ReleaseLotSacksDialog lot={action?.kind === "release" ? action.lot : null} onOpenChange={(o) => !o && onClose()} onDone={onDone} />
    </>
  );
}

type ReleaseTarget = "CUSTOMER" | "GENERAL";

/**
 * Partinin çuvallarını PARTİSİZ bırakır — iki hedef: carinin havuzu (çuval caride
 * kalır, yalnız parti bağı düşer) · genel havuz (cari de düşer, çuval sahipsiz stok).
 * Toplar çuvalda KALIR; çuval kaydı silinmez. Parti boşalır ama SİLİNMEZ.
 */
export function ReleaseLotSacksDialog({
  lot,
  onOpenChange,
  onDone,
}: {
  lot: PackingGroup | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<ReleaseTarget>("CUSTOMER");
  useEffect(() => {
    if (lot) setTarget("CUSTOMER");
  }, [lot]);
  const mut = useMutation({
    mutationFn: () => sackHubService.releasePackingGroupSacks(lot!.id, target),
    onSuccess: (res) => {
      if (res.data.skippedPlanned > 0) toast.warning(res.message ?? "Çuvallar çıkarıldı");
      else toast.success(res.message ?? "Çuvallar çıkarıldı");
      invalidateSackHub(qc);
      onOpenChange(false);
      onDone();
    },
  });
  const secenek = (v: ReleaseTarget, Icon: typeof Boxes, baslik: string, aciklama: string) => (
    <button
      type="button"
      onClick={() => setTarget(v)}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
        target === v ? "border-primary bg-primary/5" : "border-border",
      )}
      aria-pressed={target === v}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="block text-sm font-medium">{baslik}</span>
        <span className="block text-xs text-muted-foreground">{aciklama}</span>
      </span>
    </button>
  );
  return (
    <Dialog open={!!lot} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-5 w-5" /> {lot?.name}: çuvalları havuza çıkar
          </DialogTitle>
          <DialogDescription>
            Partideki <strong>depodaki tüm çuvallar</strong> partiden çıkar; toplar çuvalda kalır, çuval
            kaydı silinmez. Planlı sevkiyata girmiş çuval atlanır. Parti boşalır ama silinmez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {secenek("CUSTOMER", Boxes, "Carinin havuzuna", "Çuval bu caride kalır, yalnız parti bağı ve ambalaj no düşer.")}
          {secenek("GENERAL", Warehouse, "Genel havuza (carisiz)", "Cari bağı da düşer — çuval sahipsiz depo stoğu olur, sevkte cari yeniden seçilir.")}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Çıkar ({lot?.sackCount ?? 0} çuval)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
