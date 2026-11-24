// Kumaş kartı "Müşteri Kumaş Adları" (B13): müşterinin bu kumaşa verdiği ad — cari kartındaki "Müşterideki Kumaş
// Adları"nın ters görünümü. Okuma `/api/items/:id/customer-item-aliases`, yazma cari kartıyla AYNI uç.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ITEM_LIFECYCLE_LABEL, type ItemLifecycleStatus } from "@/lib/item-lifecycle";
import { customerAliasService, type CustomerItemAlias } from "@/pages/Customers/aliasService";
import { AliasEditRow } from "@/pages/Customers/AliasEditRow";

export const ITEM_CUSTOMER_ITEM_ALIASES_QUERY_KEY = "item-customer-item-aliases";

interface Props {
  item: { id: string; name: string; lifecycle: ItemLifecycleStatus };
}

function AddRow({ pending, onAdd }: { pending: boolean; onAdd: (customerId: string, alias: string) => Promise<unknown> }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const canAdd = Boolean(customerId && alias.trim()) && !pending;
  const submit = () => {
    if (!customerId || !alias.trim()) return;
    onAdd(customerId, alias.trim())
      .then(() => {
        setCustomerId(null);
        setAlias("");
      })
      .catch(() => undefined);
  };
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-md border bg-muted/30 p-2">
      <CustomerPickerField value={customerId} onChange={setCustomerId} triggerClassName="h-9" />
      <Input
        aria-label="Müşterideki kumaş adı"
        placeholder="Müşterideki ad (örn. AKTOS)"
        value={alias}
        onChange={(e) => setAlias(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canAdd && submit()}
      />
      <Button type="button" size="sm" onClick={submit} disabled={!canAdd} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Ekle
      </Button>
    </div>
  );
}

export function ItemCustomerItemAliasesPanel({ item }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("customer-alias:write");
  const itemOpen = item.lifecycle === "ACTIVE";
  const [deleting, setDeleting] = useState<CustomerItemAlias | null>(null);
  const queryKey = [ITEM_CUSTOMER_ITEM_ALIASES_QUERY_KEY, item.id];
  const q = useQuery({ queryKey, queryFn: () => customerAliasService.listItemAliasesByItem(item.id) });
  // Cari kartındaki liste de aynı satırı gösterir → iki önbellek birlikte tazelenir.
  const refresh = (customerId: string) => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: ["customer-item-aliases", customerId] });
  };
  const upsert = useMutation({
    mutationFn: (v: { customerId: string; alias: string }) => customerAliasService.upsertItemAlias(v.customerId, item.id, v.alias),
    onSuccess: (_r, v) => {
      toast.success("Müşterideki kumaş adı kaydedildi.");
      refresh(v.customerId);
    },
  });
  const remove = useMutation({
    mutationFn: (customerId: string) => customerAliasService.deleteItemAlias(customerId, item.id),
    onSuccess: (_r, customerId) => {
      toast.success("Müşterideki kumaş adı silindi.");
      setDeleting(null);
      refresh(customerId);
    },
  });
  const rows = [...(q.data?.data ?? [])].sort((a, b) => (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "", "tr"));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Müşterinin bu kumaşa verdiği ad. Sipariş satırına öneri olarak gelir, etiket ve irsaliyede bizim adımızın yerine basılır.
      </p>
      {canWrite && itemOpen && <AddRow pending={upsert.isPending} onAdd={(customerId, alias) => upsert.mutateAsync({ customerId, alias })} />}
      {canWrite && !itemOpen && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Kumaş “{ITEM_LIFECYCLE_LABEL[item.lifecycle]}” durumunda: yeni ad eklenemez, mevcut adlar değiştirilemez, silinebilir.
        </p>
      )}
      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">Bu kumaşa müşteriye özel ad verilmemiş.</div>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Müşteri kumaş adları">
          {rows.map((r) => (
            <AliasEditRow
              key={r.id}
              label={
                <>
                  <span className="truncate font-medium">{r.customer?.name ?? "—"}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.customer?.code}</span>
                </>
              }
              alias={r.alias}
              // Pasif müşteri / kullanımdan kalkmış kumaş: sunucu yazımı reddeder — ad salt okunur, silinebilir.
              onSave={canWrite && itemOpen && r.customer?.isActive !== false ? (a) => upsert.mutate({ customerId: r.customerId, alias: a }) : undefined}
              onDelete={canWrite ? () => setDeleting(r) : undefined}
              lockedHint={canWrite ? "Kumaş ya da müşteri kullanımda değil — ad değiştirilemez, yalnız silinebilir." : undefined}
              saving={upsert.isPending}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Müşterideki kumaş adı silinsin mi?"
        description={deleting ? `${deleting.customer?.name ?? "Müşteri"} için “${deleting.alias}” adı silinecek; etiket ve irsaliyede “${item.name}” basılır.` : ""}
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.customerId);
        }}
      />
    </div>
  );
}
