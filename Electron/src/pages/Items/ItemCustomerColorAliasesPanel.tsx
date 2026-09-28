// Kumaş kartı "Müşteri Renk Adları": bu kumaşta her müşterinin kumaşa özel renk adı. Cari kartıyla AYNI uca yazar.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ITEM_LIFECYCLE_LABEL, type ItemLifecycleStatus } from "@/lib/item-lifecycle";
import { customerAliasService, type CustomerItemColorAlias } from "@/pages/Customers/aliasService";
import { AliasEditRow, ColorLabel } from "@/pages/Customers/AliasEditRow";
import { itemAliasDeleteText } from "@/pages/Customers/colorAliasChain";
import { ITEM_CUSTOMER_COLOR_ALIASES_QUERY_KEY, useItemColorAliasMutations } from "@/pages/Customers/useItemColorAliasMutations";

interface Props {
  item: { id: string; name: string; lifecycle: ItemLifecycleStatus; allowedColorIds: string[] };
}

/** Satırları müşteriye göre gruplar (sunucu sırası `createdAt desc`; grup içinde renk adı). */
export function groupByCustomer(rows: readonly CustomerItemColorAlias[]) {
  const groups = new Map<string, { customer: CustomerItemColorAlias["customer"]; rows: CustomerItemColorAlias[] }>();
  for (const r of rows) {
    const g = groups.get(r.customerId) ?? { customer: r.customer, rows: [] };
    g.rows.push(r);
    groups.set(r.customerId, g);
  }
  for (const g of groups.values()) g.rows.sort((a, b) => (a.color?.name ?? "").localeCompare(b.color?.name ?? "", "tr"));
  return [...groups.entries()].map(([customerId, g]) => ({ customerId, ...g }));
}

function AddRow({ item, pending, onAdd }: Props & { pending: boolean; onAdd: (c: string, col: string, a: string) => Promise<unknown> }) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const canAdd = Boolean(customerId && colorId && alias.trim()) && !pending;
  const submit = () => {
    if (!customerId || !colorId || !alias.trim()) return;
    onAdd(customerId, colorId, alias.trim())
      .then(() => {
        setColorId(null);
        setAlias("");
      })
      .catch(() => undefined);
  };
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 rounded-md border bg-muted/30 p-2">
      <CustomerPickerField value={customerId} onChange={setCustomerId} triggerClassName="h-9" />
      <ColorPickerModal
        value={colorId}
        onChange={setColorId}
        customerId={customerId}
        allowedColorIds={item.allowedColorIds}
        allowNone={false}
        triggerClassName="h-9"
      />
      <Input
        aria-label="Müşterideki ad"
        placeholder="Müşterideki ad (örn. ABC)"
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

function CustomerGroupList({ groups, canWrite, itemOpen, onSave, onDelete }: {
  groups: ReturnType<typeof groupByCustomer>;
  canWrite: boolean;
  itemOpen: boolean;
  onSave: (row: CustomerItemColorAlias, alias: string) => void;
  onDelete: (row: CustomerItemColorAlias) => void;
}) {
  return (
    <ul className="divide-y rounded-md border">
      {groups.map((g) => (
        <li key={g.customerId}>
          <div className="bg-muted/40 px-2 py-1 text-xs font-semibold">
            {g.customer?.name ?? "—"} <span className="font-mono font-normal text-muted-foreground">{g.customer?.code}</span>
          </div>
          <ul className="divide-y">
            {g.rows.map((r) => (
              <AliasEditRow
                key={r.id}
                label={<ColorLabel color={r.color ?? null} />}
                alias={r.alias}
                // Pasif müşteri / kullanımdan kalkmış kumaş: sunucu yazımı reddeder — ad salt okunur, silinebilir.
                onSave={canWrite && itemOpen && g.customer?.isActive !== false ? (a) => onSave(r, a) : undefined}
                onDelete={canWrite ? () => onDelete(r) : undefined}
                lockedHint={canWrite ? "Kumaş ya da müşteri kullanımda değil — ad değiştirilemez, yalnız silinebilir." : undefined}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function ItemCustomerColorAliasesPanel({ item }: Props) {
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("customer-alias:write");
  const itemOpen = item.lifecycle === "ACTIVE";
  const [deleting, setDeleting] = useState<CustomerItemColorAlias | null>(null);
  const mut = useItemColorAliasMutations({ onDeleted: () => setDeleting(null) });
  const q = useQuery({
    queryKey: [ITEM_CUSTOMER_COLOR_ALIASES_QUERY_KEY, item.id],
    queryFn: () => customerAliasService.listItemColorAliasesByItem(item.id),
  });
  // Silme metni müşterinin genel adını söyler; cari kartıyla aynı önbellek anahtarı.
  const generalQ = useQuery({
    queryKey: ["customer-color-aliases", deleting?.customerId],
    queryFn: () => customerAliasService.listColorAliases(deleting!.customerId),
    enabled: Boolean(deleting),
  });
  const generalAlias = generalQ.data ? (generalQ.data.data?.find((g) => g.colorId === deleting?.colorId)?.alias ?? null) : undefined;
  const groups = groupByCustomer(q.data?.data ?? []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Müşterinin bu kumaşta kullandığı renk adı. Burada verilen ad, o müşterinin genel renk adının önüne geçer.
      </p>
      {canWrite && itemOpen && (
        <AddRow item={item} pending={mut.upsert.isPending} onAdd={(customerId, colorId, alias) => mut.upsert.mutateAsync({ customerId, itemId: item.id, colorId, alias })} />
      )}
      {canWrite && !itemOpen && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Kumaş “{ITEM_LIFECYCLE_LABEL[item.lifecycle]}” durumunda: yeni ad eklenemez, mevcut adlar değiştirilemez, silinebilir.
        </p>
      )}
      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : groups.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">Bu kumaşta müşteriye özel renk adı yok.</div>
      ) : (
        <CustomerGroupList
          groups={groups}
          canWrite={canWrite}
          itemOpen={itemOpen}
          onSave={(r, alias) => mut.upsert.mutate({ customerId: r.customerId, itemId: item.id, colorId: r.colorId, alias })}
          onDelete={setDeleting}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Kumaşa özel renk adı silinsin mi?"
        description={deleting ? itemAliasDeleteText({ itemName: item.name, colorName: deleting.color?.name ?? "—", alias: deleting.alias }, generalAlias) : ""}
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deleting) mut.remove.mutate({ customerId: deleting.customerId, itemId: item.id, colorId: deleting.colorId });
        }}
      />
    </div>
  );
}
