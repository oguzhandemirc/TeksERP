import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateDestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";
import { toast } from "sonner";
import { Plus, Pencil, Power, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { BranchFormDialog } from "./BranchFormDialog";
import { customerBranchService } from "./branchService";
import type { CustomerBranch, CustomerBranchPayload } from "./branch-types";
import { branchFormToPayload as toPayload, type BranchFormValues } from "./branch-schema";

interface Props {
  customerId: string;
  /** Carinin yönü — şube kendi yönünü taşımıyorsa ihracat kodu alanı buna göre görünür. */
  customerDestination?: "DOMESTIC" | "EXPORT" | null;
}

export function CustomerBranchesPanel({ customerId, customerDestination = null }: Props) {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerBranch | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const queryKey = ["customer-branches", customerId, showInactive] as const;
  const invalidate = () => {
    invalidateDestinationLock(qc);
    return qc.invalidateQueries({ queryKey: ["customer-branches", customerId] });
  };

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => customerBranchService.list(customerId, showInactive),
  });

  const createMutation = useMutation({
    mutationFn: (payload: Partial<CustomerBranchPayload>) =>
      customerBranchService.create(customerId, payload),
    onSuccess: () => {
      toast.success("Şube eklendi.");
      invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ branchId, data }: { branchId: string; data: Partial<CustomerBranchPayload> }) =>
      customerBranchService.update(customerId, branchId, data),
    onSuccess: () => {
      toast.success("Şube güncellendi.");
      invalidate();
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (branchId: string) => customerBranchService.deactivate(customerId, branchId),
    onSuccess: () => {
      toast.success("Şube pasife alındı.");
      invalidate();
    },
  });

  const handleSubmit = async (values: BranchFormValues) => {
    const payload = toPayload(values);
    if (editing) {
      await updateMutation.mutateAsync({ branchId: editing.id, data: payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const branches = data?.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Pasif şubeleri göster
        </label>
        <PermissionGate permission="customer:write">
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Yeni Şube
          </Button>
        </PermissionGate>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : branches.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz şube yok. Yeni şube eklemek için yukarıdaki butonu kullanın.
        </div>
      ) : (
        <ul className="space-y-2">
          {branches.map((b) => (
            <li
              key={b.id}
              className={`rounded-md border p-3 ${b.isActive ? "" : "opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    {b.code && (
                      <span className="text-xs text-muted-foreground">
                        İhracat Kodu:{" "}
                        <span className="font-mono">{b.code}</span>
                      </span>
                    )}
                    {!b.isActive && <Badge variant="muted">Pasif</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {(b.city || b.district || b.address) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {[b.address, b.district, b.city].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {b.contactName && <span>{b.contactName}</span>}
                    {b.contactPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {b.contactPhone}
                      </span>
                    )}
                  </div>
                </div>
                <PermissionGate permission="customer:write">
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {b.isActive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setDeactivatingId(b.id)}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </PermissionGate>
              </div>
            </li>
          ))}
        </ul>
      )}

      <BranchFormDialog
        customerDestination={customerDestination}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        initial={editing}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(deactivatingId)}
        onOpenChange={(open) => !open && setDeactivatingId(null)}
        title="Şubeyi pasife al"
        description="Şube pasife alınacak. Geçmiş sevkiyatlar etkilenmez, ancak ileride sipariş/sevkiyat seçiminde görünmez."
        confirmLabel="Pasife Al"
        destructive
        isPending={deactivateMutation.isPending}
        onConfirm={async () => {
          if (!deactivatingId) return;
          await deactivateMutation.mutateAsync(deactivatingId);
          setDeactivatingId(null);
        }}
      />
    </div>
  );
}
