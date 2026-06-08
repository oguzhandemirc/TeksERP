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
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { customerAliasService, type CustomerColorAlias } from "./aliasService";

interface Props {
  customerId: string;
}

export function CustomerColorAliasesPanel({ customerId }: Props) {
  const qc = useQueryClient();
  const [draftColorId, setDraftColorId] = useState<string | null>(null);
  const [draftAlias, setDraftAlias] = useState("");
  const [deletingColorId, setDeletingColorId] = useState<string | null>(null);

  const queryKey = ["customer-color-aliases", customerId];
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => customerAliasService.listColorAliases(customerId),
  });

  const upsertMut = useMutation({
    mutationFn: ({ colorId, alias }: { colorId: string; alias: string }) =>
      customerAliasService.upsertColorAlias(customerId, colorId, alias),
    onSuccess: () => {
      toast.success("Müşterideki renk adı kaydedildi.");
      invalidate();
      setDraftColorId(null);
      setDraftAlias("");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (colorId: string) =>
      customerAliasService.deleteColorAlias(customerId, colorId),
    onSuccess: () => {
      toast.success("Müşterideki renk adı silindi.");
      invalidate();
      setDeletingColorId(null);
    },
  });

  const handleAdd = () => {
    if (!draftColorId || !draftAlias.trim()) {
      toast.error("Renk ve müşterideki ad gerekli.");
      return;
    }
    upsertMut.mutate({ colorId: draftColorId, alias: draftAlias.trim() });
  };

  return (
    <div className="space-y-3">
      <PermissionGate permission="customer-alias:write">
        <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-2">
          <div className="flex-1">
            <ReferenceSelect<Color>
              value={draftColorId ?? undefined}
              onChange={(v) => setDraftColorId(v ?? null)}
              service={colorService}
              queryKey="colors"
              getLabel={(c) => c.name}
              placeholder="Renk seç..."
            />
          </div>
          <Input
            placeholder="Müşterideki ad (örn. MAVİ)"
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
          // Yalnızca özel ad verilmiş satırlar (atama-only null kayıtlar burada
          // gösterilmez; renk↔müşteri ataması renk formundan yönetilir).
          rows={(data?.data ?? []).filter((r) => r.alias && r.alias.trim())}
          onUpdate={(colorId, alias) => upsertMut.mutate({ colorId, alias })}
          onDelete={setDeletingColorId}
        />
      )}

      <ConfirmDialog
        open={Boolean(deletingColorId)}
        onOpenChange={(open) => !open && setDeletingColorId(null)}
        title="Müşterideki renk adı silinsin mi?"
        description="Bu renk için müşteriye özel ad silinecek; sipariş etiketlerinde standart ad kullanılır."
        confirmLabel="Sil"
        destructive
        onConfirm={() => {
          if (deletingColorId) deleteMut.mutate(deletingColorId);
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
  rows: CustomerColorAlias[];
  onUpdate: (colorId: string, alias: string) => void;
  onDelete: (colorId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        Tanımlı müşteriye özel renk adı yok.
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
  row: CustomerColorAlias;
  onUpdate: (colorId: string, alias: string) => void;
  onDelete: (colorId: string) => void;
}) {
  const [value, setValue] = useState(row.alias ?? "");
  const dirty = value.trim() !== (row.alias ?? "");

  return (
    <li className="flex items-center gap-2 p-2 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {row.color?.hex && (
          <span
            className="h-3 w-3 rounded-full border border-black/10"
            style={{ backgroundColor: row.color.hex }}
          />
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {row.color?.code}
        </span>
        <span className="font-medium">{row.color?.name}</span>
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
          onClick={() => onUpdate(row.colorId, value.trim())}
        >
          Kaydet
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => onDelete(row.colorId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </PermissionGate>
    </li>
  );
}
