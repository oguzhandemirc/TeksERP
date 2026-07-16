import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
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
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { EditorTarget } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Çuval açıldıktan sonra editöre geç. */
  onCreated: (target: EditorTarget) => void;
}

/**
 * Yeni çuval aç — müşteri OPSİYONEL (varsayılan müşterisiz/genel stok). Müşteri picker'ı
 * ARAMALI (ReferenceSelect — sunucu-taraflı, debounce'lı). Müşteri seçilirse şube de
 * seçilebilir. Açılınca doğrudan editöre geçilir (top okutulur). Çözülmüş ad/kod backend
 * yanıtından gelir → editör hedefi fetch'siz kurulur.
 */
export function NewSackDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCustomerId(null);
      setBranchId(null);
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () => sackHubService.openSack({ customerId, branchId }),
    onSuccess: (res) => {
      invalidateSackHub(qc);
      toast.success(`Çuval açıldı: ${res.data.sackNo}`);
      onOpenChange(false);
      onCreated({
        sackId: res.data.id,
        sackNo: res.data.sackNo,
        customerId: res.data.customerId,
        customerName: res.data.customerName,
        branchId: res.data.branchId,
        branchName: res.data.branchName,
        branchCode: res.data.branchCode,
        isNew: true,
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4" /> Yeni Çuval Aç
          </DialogTitle>
          <DialogDescription>
            Müşteri opsiyonel — boş bırakırsan çuval genel stok (müşterisiz) açılır, sevkiyat kurarken atanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Müşteri (opsiyonel)</span>
            <ReferenceSelect
              value={customerId}
              onChange={(v) => {
                setCustomerId(v);
                setBranchId(null);
              }}
              service={customerService}
              queryKey="customers"
              getLabel={(c) => (c.code ? `${c.code} — ${c.name}` : c.name)}
              placeholder="Müşteri ara/seç…"
              nullable
              noneLabel="Müşterisiz (genel stok)"
            />
          </label>

          {customerId && (
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
            <PackagePlus className="h-4 w-4" /> {mut.isPending ? "Açılıyor…" : "Çuval Aç & Doldur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
