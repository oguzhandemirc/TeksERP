import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { itemTypeLabels } from "@/types/enums";
import { itemCarriesAllowedLists } from "./itemPayload.helper";
import { ItemLifecycleBadge, itemLifecycleExportText } from "./ItemLifecycleBadge";

/** İplik/sarf satırında renk/özellik hücresi BOŞ — "Tümü" yazmak iplikte anlamsız (yalnız kumaş liste taşır). */
const NOT_APPLICABLE = <span className="text-xs text-muted-foreground">—</span>;
import { itemService } from "./service";
import type { Item } from "./types";

/**
 * Saha (KK1) oluşturulmuş "onay bekliyor" deseni için rozet + inline Onayla.
 * Onayla → itemService.update(id, { pendingReview:false }) + ["items"] invalidate.
 * (Alternatif onay yolu: deseni düzenleyip kaydetmek de işareti temizler —
 * bkz. itemPayload.helper.ts.)
 */
function ReviewBadgeCell({ item }: { item: Item }) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: () =>
      itemService.update(item.id, { pendingReview: false } as Partial<Item>),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["items"] });
      toast.success(`Desen onaylandı: ${item.name}`);
    },
  });

  if (!item.pendingReview) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className="border-amber-500 text-amber-600 dark:text-amber-400"
      >
        Onay Bekliyor
      </Badge>
      <PermissionGate permission="item:write">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-xs text-emerald-600 dark:text-emerald-400"
          disabled={approve.isPending}
          onClick={(e) => {
            e.stopPropagation();
            approve.mutate();
          }}
        >
          <Check className="h-3 w-3" /> Onayla
        </Button>
      </PermissionGate>
    </div>
  );
}

export const itemColumns: ColumnDef<Item>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Ad" />,
  },
  {
    accessorKey: "itemType",
    header: () => <SortableHeader field="itemType" label="Tip" />,
    cell: ({ row }) => <Badge variant="muted">{itemTypeLabels[row.original.itemType]}</Badge>,
  },
  {
    accessorKey: "unit",
    header: () => <SortableHeader field="unit" label="Birim" />,
  },
  {
    id: "allowedColors",
    header: "İzinli Renkler",
    cell: ({ row }) => {
      if (!itemCarriesAllowedLists(row.original.itemType)) return NOT_APPLICABLE;
      const colors = row.original.allowedColors ?? [];
      if (colors.length === 0) {
        return <span className="text-xs text-muted-foreground italic">Tümü</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {colors.slice(0, 3).map((c) => (
            <Badge key={c.colorId} variant="muted" className="gap-1 text-[10px]">
              {c.color.hex && (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color.hex }}
                />
              )}
              {c.color.name}
            </Badge>
          ))}
          {colors.length > 3 && (
            <Badge variant="muted" className="text-[10px]">
              +{colors.length - 3}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "allowedProperties",
    header: "İzinli Özellikler",
    cell: ({ row }) => {
      if (!itemCarriesAllowedLists(row.original.itemType)) return NOT_APPLICABLE;
      const props = row.original.allowedProperties ?? [];
      if (props.length === 0) {
        return <span className="text-xs text-muted-foreground italic">Tümü</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {props.slice(0, 3).map((p) => (
            <Badge key={p.propertyId} variant="muted" className="text-[10px]">
              {p.property.name}
            </Badge>
          ))}
          {props.length > 3 && (
            <Badge variant="muted" className="text-[10px]">
              +{props.length - 3}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "pendingReview",
    header: "Onay",
    // Excel/PDF: ham boolean yerine yerelleştirilmiş değer (accessorKey yok →
    // aksi halde toText(boolean) 'true'/'false' yazardı).
    meta: { exportValue: (row: Item) => (row.pendingReview ? "Onay Bekliyor" : "") },
    cell: ({ row }) => <ReviewBadgeCell item={row.original} />,
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    meta: { exportValue: itemLifecycleExportText },
    cell: ({ row }) => <ItemLifecycleBadge item={row.original} />,
  },
];
