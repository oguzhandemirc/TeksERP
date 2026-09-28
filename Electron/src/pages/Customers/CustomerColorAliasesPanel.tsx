// Cari kartı "Müşterideki Renk Adları": genel ad (bütün kumaşlar) + isteğe bağlı kumaşa özel ad (yalnız o kumaşta).
// Kumaşa özel ad kumaş kartındaki sekmeyle AYNI uca yazar (`useItemColorAliasMutations`).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { customerAliasService, type CustomerItemColorAlias } from "./aliasService";
import { ColorAliasAddForm, type ColorAliasDraft } from "./ColorAliasAddForm";
import { ColorAliasGroupList } from "./ColorAliasGroupList";
import { generalAliasDeleteText, groupColorAliases, itemAliasDeleteText, type ColorAliasGroup } from "./colorAliasChain";
import { CUSTOMER_ITEM_COLOR_ALIASES_QUERY_KEY, useItemColorAliasMutations } from "./useItemColorAliasMutations";

interface Props {
  customerId: string;
}

type Deleting = { kind: "general"; colorId: string } | { kind: "item"; row: CustomerItemColorAlias } | null;

function deleteText(target: Deleting, groups: ColorAliasGroup[]): string {
  if (!target) return "";
  if (target.kind === "general") {
    const g = groups.find((x) => x.colorId === target.colorId);
    const colorName = g?.color?.name ?? "Bu renk";
    return generalAliasDeleteText(colorName, g?.general?.alias ?? "", (g?.items ?? []).map((r) => r.item?.name ?? "—"));
  }
  const g = groups.find((x) => x.colorId === target.row.colorId);
  return itemAliasDeleteText(
    { itemName: target.row.item?.name ?? "—", colorName: target.row.color?.name ?? "—", alias: target.row.alias },
    g?.general?.alias ?? null,
  );
}

function useGeneralColorAliasMutations(customerId: string, onDeleted: () => void) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["customer-color-aliases", customerId] });
    void qc.invalidateQueries({ queryKey: ["orders", "detail"] });
  };
  const upsert = useMutation({
    mutationFn: ({ colorId, alias }: { colorId: string; alias: string }) =>
      customerAliasService.upsertColorAlias(customerId, colorId, alias),
    onSuccess: () => {
      toast.success("Müşterideki renk adı kaydedildi.");
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (colorId: string) => customerAliasService.deleteColorAlias(customerId, colorId),
    onSuccess: () => {
      toast.success("Müşterideki renk adı silindi.");
      invalidate();
      onDeleted();
    },
  });
  return { upsert, remove };
}

export function CustomerColorAliasesPanel({ customerId }: Props) {
  const { hasPermission } = useRoleAccess();
  const canRead = hasPermission("customer-alias:read");
  const canWrite = hasPermission("customer-alias:write");
  const [deleting, setDeleting] = useState<Deleting>(null);
  const general = useGeneralColorAliasMutations(customerId, () => setDeleting(null));
  const itemMut = useItemColorAliasMutations({ onDeleted: () => setDeleting(null) });

  const generalQ = useQuery({
    queryKey: ["customer-color-aliases", customerId],
    queryFn: () => customerAliasService.listColorAliases(customerId),
    enabled: canRead,
  });
  const itemQ = useQuery({
    queryKey: [CUSTOMER_ITEM_COLOR_ALIASES_QUERY_KEY, customerId],
    queryFn: () => customerAliasService.listItemColorAliases(customerId),
    enabled: canRead,
  });
  const groups = groupColorAliases(generalQ.data?.data ?? [], itemQ.data?.data ?? []);

  if (!canRead) {
    return <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">Müşteri adlarını görme yetkiniz yok.</p>;
  }

  const add = (d: ColorAliasDraft) =>
    d.itemId
      ? itemMut.upsert.mutateAsync({ customerId, itemId: d.itemId, colorId: d.colorId, alias: d.alias })
      : general.upsert.mutateAsync({ colorId: d.colorId, alias: d.alias });

  return (
    <div className="space-y-3">
      <PermissionGate permission="customer-alias:write">
        <ColorAliasAddForm customerId={customerId} pending={general.upsert.isPending || itemMut.upsert.isPending} onAdd={add} />
      </PermissionGate>

      {generalQ.isLoading || itemQ.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <ColorAliasGroupList
          groups={groups}
          canWrite={canWrite}
          onSaveGeneral={(colorId, alias) => general.upsert.mutate({ colorId, alias })}
          onDeleteGeneral={(colorId) => setDeleting({ kind: "general", colorId })}
          onSaveItem={(r, alias) => itemMut.upsert.mutate({ customerId, itemId: r.itemId, colorId: r.colorId, alias })}
          onDeleteItem={(row) => setDeleting({ kind: "item", row })}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting?.kind === "item" ? "Kumaşa özel renk adı silinsin mi?" : "Müşterideki renk adı silinsin mi?"}
        description={deleteText(deleting, groups)}
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deleting?.kind === "general") general.remove.mutate(deleting.colorId);
          else if (deleting?.kind === "item") itemMut.remove.mutate({ customerId, itemId: deleting.row.itemId, colorId: deleting.row.colorId });
        }}
      />
    </div>
  );
}
