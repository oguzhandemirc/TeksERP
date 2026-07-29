import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserRoundCog } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { useCustomerBranchesEnabled } from "@/hooks/usePricingEnabled";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { EditorTarget } from "./types";

/** Editör hedefine yansıtılacak yeni müşteri/şube alanları. */
export type ReassignPatch = Pick<
  EditorTarget,
  "customerId" | "customerName" | "branchId" | "branchName" | "branchCode"
>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sackId: string;
  initialCustomerId: string | null;
  initialBranchId: string | null;
  /** Başarılı değişimden sonra editör başlığını güncelle. */
  onReassigned: (patch: ReassignPatch) => void;
}

/**
 * Depodaki çuvalın müşterisini (ve şubesini) değiştir. Müşteri picker'ı ARAMALI
 * (ReferenceSelect — sunucu-taraflı, debounce'lı). Müşteri OPSİYONEL (müşterisiz genel
 * stoğa da çekilebilir). Yalnız sevkiyata girmemiş çuvalda çağrılır (editör butonu
 * `!locked` iken gösterir); backend de `shipmentId=null` guard'ı uygular. Çözülmüş
 * ad/kod backend yanıtından gelir → rozet fetch'siz güncellenir.
 */
export function ReassignCustomerDialog({
  open,
  onOpenChange,
  sackId,
  initialCustomerId,
  initialBranchId,
  onReassigned,
}: Props) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(initialCustomerId);
  const [branchId, setBranchId] = useState<string | null>(initialBranchId);
  const branchesEnabled = useCustomerBranchesEnabled();

  // Açılışta mevcut müşteri/şube ile başlat (farklı çuvala geçince tazelensin).
  useEffect(() => {
    if (open) {
      setCustomerId(initialCustomerId);
      setBranchId(initialBranchId);
    }
  }, [open, initialCustomerId, initialBranchId]);

  const mut = useMutation({
    mutationFn: () => sackHubService.reassignCustomer(sackId, { customerId, branchId }),
    onSuccess: (res) => {
      invalidateSackHub(qc);
      onReassigned({
        customerId: res.data.customerId,
        customerName: res.data.customerName,
        branchId: res.data.branchId,
        branchName: res.data.branchName,
        branchCode: res.data.branchCode,
      });
      toast.success("Çuval müşterisi güncellendi");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundCog className="h-4 w-4" /> Çuval Müşterisini Değiştir
          </DialogTitle>
          <DialogDescription>
            Yalnız sevkiyata girmemiş (depodaki) çuvalda değiştirilebilir. Boş bırakırsan çuval
            müşterisiz (genel stok) olur, sevkiyat kurarken atanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Müşteri (opsiyonel)</span>
            <ReferenceSelect
              value={customerId}
              onChange={(v) => {
                setCustomerId(v);
                setBranchId(null); // müşteri değişince eski şube geçersiz
              }}
              service={customerService}
              queryKey="customers"
              getLabel={(c) => (c.code ? `${c.code} — ${c.name}` : c.name)}
              placeholder="Müşteri ara/seç…"
              nullable
              noneLabel="Müşterisiz (genel stok)"
            />
          </label>

          {customerId && branchesEnabled && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Şube (opsiyonel)</span>
              <BranchSelect customerId={customerId} value={branchId} onChange={setBranchId} />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} className="gap-1">
            <UserRoundCog className="h-4 w-4" /> {mut.isPending ? "Güncelleniyor…" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
