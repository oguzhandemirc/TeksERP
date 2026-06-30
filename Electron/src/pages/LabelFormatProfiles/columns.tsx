import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Star, StarOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { labelFormatProfileService } from "./service";
import type { LabelFormatProfile } from "./types";

const n = (v: string | number) => Number(v);

/** TOP etiketi varsayılanı: bayraklıysa rozet, değilse "Varsayılan Yap" (station:write). */
function RollDefaultCell({ profile }: { profile: LabelFormatProfile }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => labelFormatProfileService.setRollDefault(profile.id),
    onSuccess: () => {
      toast.success(`${profile.name} artık TOP etiketi varsayılanı.`);
      void qc.invalidateQueries({ queryKey: ["label-format-profiles"] });
    },
  });
  if (profile.isRollDefault) {
    return (
      <Badge className="gap-1">
        <Star className="h-3 w-3" /> Top varsayılanı
      </Badge>
    );
  }
  return (
    <PermissionGate permission="station:write">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-xs"
        disabled={mut.isPending || !profile.isActive}
        onClick={(e) => {
          e.stopPropagation();
          mut.mutate();
        }}
      >
        <StarOff className="h-3.5 w-3.5" /> Varsayılan Yap
      </Button>
    </PermissionGate>
  );
}

export const labelFormatProfileColumns: ColumnDef<LabelFormatProfile>[] = [
  {
    id: "code",
    header: "Kod / Ad",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-mono text-xs">{row.original.code}</div>
        <div className="truncate text-[11px] text-muted-foreground">{row.original.name}</div>
      </div>
    ),
  },
  {
    id: "media",
    header: "Medya (mm)",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {n(row.original.widthMm)} × {n(row.original.heightMm)}
      </span>
    ),
  },
  {
    id: "margin",
    header: "Pay",
    cell: ({ row }) => <span className="tabular-nums">{n(row.original.marginMm)} mm</span>,
  },
  {
    id: "content",
    header: "İçerik (mm)",
    cell: ({ row }) => {
      const w = n(row.original.widthMm) - n(row.original.marginMm) * 2;
      const h = n(row.original.heightMm) - n(row.original.marginMm) * 2;
      return (
        <span className="tabular-nums text-muted-foreground">
          {w} × {h}
        </span>
      );
    },
  },
  { accessorKey: "dpi", header: "DPI", cell: ({ row }) => <span className="tabular-nums">{row.original.dpi}</span> },
  {
    accessorKey: "orientation",
    header: "Yön",
    cell: ({ row }) => (
      <Badge variant="muted">{row.original.orientation === "PORTRAIT" ? "Dikey" : "Yatay"}</Badge>
    ),
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="muted">Pasif</Badge>),
  },
  {
    id: "rollDefault",
    header: "Top Etiketi Varsayılanı",
    cell: ({ row }) => <RollDefaultCell profile={row.original} />,
  },
];
