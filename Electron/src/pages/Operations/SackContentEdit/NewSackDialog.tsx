import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { customerBranchService } from "@/pages/Customers/branchService";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { EditorTarget } from "./types";

const NO_CUSTOMER = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Çuval açıldıktan sonra editöre geç. */
  onCreated: (target: EditorTarget) => void;
}

/**
 * Yeni çuval aç — müşteri OPSİYONEL (varsayılan müşterisiz/genel stok). Müşteri
 * seçilirse şube de seçilebilir. Açılınca doğrudan editöre geçilir (top okutulur).
 */
export function NewSackDialog({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [branchId, setBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCustomerId(undefined);
      setBranchId(null);
    }
  }, [open]);

  const customersQ = useQuery({
    queryKey: ["customers", "picker"],
    queryFn: () => loadAllForPicker(customerService),
    staleTime: 60_000,
    enabled: open,
  });
  const customers = (customersQ.data?.data ?? []) as Array<{ id: string; name?: string; code?: string }>;

  // Şube adını çözmek için (BranchSelect ile aynı query key → dedupe).
  const branchesQ = useQuery({
    queryKey: ["customer-branches", customerId, "select"],
    queryFn: () => customerBranchService.list(customerId as string, false),
    enabled: open && !!customerId,
    staleTime: 60_000,
  });

  const mut = useMutation({
    mutationFn: () => sackHubService.openSack({ customerId: customerId ?? null, branchId }),
    onSuccess: (res) => {
      invalidateSackHub(qc);
      const customerName = customers.find((c) => c.id === res.data.customerId)?.name ?? null;
      const branchName = branchesQ.data?.data.find((b) => b.id === res.data.branchId)?.name ?? null;
      toast.success(`Çuval açıldı: ${res.data.sackNo}`);
      onOpenChange(false);
      onCreated({
        sackId: res.data.id,
        sackNo: res.data.sackNo,
        customerId: res.data.customerId,
        customerName,
        branchId: res.data.branchId,
        branchName,
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
            <Select
              value={customerId ?? NO_CUSTOMER}
              onValueChange={(v) => {
                setCustomerId(v === NO_CUSTOMER ? undefined : v);
                setBranchId(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Müşteri seç…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CUSTOMER} className="text-muted-foreground">
                  Müşterisiz (genel stok)
                </SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name ?? c.code ?? c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
