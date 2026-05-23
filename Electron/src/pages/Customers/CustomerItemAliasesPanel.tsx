import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { customerAliasService, type CustomerItemAlias } from "./aliasService";

interface Props {
  customerId: string;
}

export function CustomerItemAliasesPanel({ customerId }: Props) {
  const qc = useQueryClient();
  const [draftItemId, setDraftItemId] = useState<string | null>(null);
  const [draftAlias, setDraftAlias] = useState("");
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  const queryKey = ["customer-item-aliases", customerId];
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => customerAliasService.listItemAliases(customerId),
  });

  const upsertMut = useMutation({
    mutationFn: ({ itemId, alias }: { itemId: string; alias: string }) =>
      customerAliasService.upsertItemAlias(customerId, itemId, alias),
    onSuccess: () => {
      toast.success("Müşterideki ürün adı kaydedildi.");
      invalidate();
      setDraftItemId(null);
      setDraftAlias("");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (itemId: string) =>
      customerAliasService.deleteItemAlias(customerId, itemId),
    onSuccess: () => {
      toast.success("Müşterideki ürün adı silindi.");
      invalidate();
      setDeletingItemId(null);
    },
  });

  const handleAdd = () => {
    if (!draftItemId || !draftAlias.trim()) {
      toast.error("Ürün ve müşterideki ad gerekli.");
      return;
    }
    upsertMut.mutate({ itemId: draftItemId, alias: draftAlias.trim() });
  };

  return (
    <div className="space-y-3">
      <PermissionGate permission="customer-alias:write">
        <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-2">
          <div className="flex-1">
            <ReferenceSelect<Item>
              value={draftItemId ?? undefined}
              onChange={(v) => setDraftItemId(v ?? null)}
              service={itemService}
              queryKey="items"
              getLabel={(i) => `${i.code} — ${i.name}`}
              placeholder="Ürün seç..."
            />
          </div>
          <Input
            placeholder="Müşterideki ad (örn. AKTOS)"
            value={draftAlias}
            onChange={(e) => setDraftAlias(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={upsertMut.isPending}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Ekle
          </Button>
        </div>
      </PermissionGate>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <AliasList
          rows={data?.data ?? []}
          onUpdate={(itemId, alias) => upsertMut.mutate({ itemId, alias })}
          onDelete={setDeletingItemId}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletingItemId)}
        onOpenChange={(open) => !open && setDeletingItemId(null)}
        title="Müşterideki ürün adı silinsin mi?"
        description="Bu ürün için müşteriye özel ad silinecek; sipariş etiketlerinde standart ad kullanılır."
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deletingItemId) deleteMut.mutate(deletingItemId);
        }}
      />
    </div>
  );
}

function AliasList({
  rows,
  onUpdate,
  onDelete,
}: {
  rows: CustomerItemAlias[];
  onUpdate: (itemId: string, alias: string) => void;
  onDelete: (itemId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        Tanımlı müşteriye özel ürün adı yok.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((row) => (
        <AliasRow key={row.id} row={row} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
    </ul>
  );
}

function AliasRow({
  row,
  onUpdate,
  onDelete,
}: {
  row: CustomerItemAlias;
  onUpdate: (itemId: string, alias: string) => void;
  onDelete: (itemId: string) => void;
}) {
  const [value, setValue] = useState(row.alias);
  const dirty = value.trim() !== row.alias;

  return (
    <li className="flex items-center gap-2 p-2 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-mono text-xs text-muted-foreground">
          {row.item?.code}
        </span>
        <span className="ml-1.5 font-medium">{row.item?.name}</span>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-48 text-sm"
      />
      <PermissionGate permission="customer-alias:write">
        <Button
          type="button"
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || !value.trim()}
          onClick={() => onUpdate(row.itemId, value.trim())}
        >
          Kaydet
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => onDelete(row.itemId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </PermissionGate>
    </li>
  );
}
