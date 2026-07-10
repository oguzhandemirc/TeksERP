import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { safeFormat } from "@/lib/format";
import type { WorkOrder } from "./types";

// İlerleme = üretimden ÇIKAN ÷ üretime GİREN (detay sağlık şeridiyle birebir aynı).
// Hedef metraj %99 girilmediğinden hedef-bazlı oran kullanılmaz. Tamamlanan-adım
// sayımı da ÇOKLU-DALDA yanıltıcıydı (adımlar yeniden açıldığı için hep ACTIVE → 0/N);
// çıkan/giren gerçek "ne kadar bitti"yi verir.
function progressOf(wo: WorkOrder): { input: number; output: number; pct: number; hasFlow: boolean } {
  const input = wo.inputMeters ?? 0;
  const output = wo.producedMeters ?? 0;
  const hasFlow = input > 0;
  const pct = hasFlow ? Math.min(100, Math.round((output / input) * 100)) : 0;
  return { input, output, pct, hasFlow };
}

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

export const workOrderColumns: ColumnDef<WorkOrder>[] = [
  {
    accessorKey: "batchNumber",
    header: "Parti Kodu",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.batchNumber}</span>,
  },
  {
    accessorKey: "type",
    header: "Tip",
    cell: ({ row }) => (
      <Badge variant="muted" className="text-[10px]">
        {workOrderTypeLabels[row.original.type] ?? row.original.type}
      </Badge>
    ),
  },
  {
    id: "product",
    header: "Kumaş / Renk",
    cell: ({ row }) => {
      const wo = row.original;
      if (!wo.targetItem && !wo.targetColor)
        return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="max-w-[10rem] truncate font-medium" title={wo.targetItem?.name}>
            {wo.targetItem?.name ?? "—"}
          </span>
          {wo.targetColor && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full border"
                style={{ background: wo.targetColor.hex ?? "#fff" }}
              />
              {wo.targetColor.name}
            </span>
          )}
        </div>
      );
    },
  },
  {
    id: "progress",
    header: "İlerleme",
    cell: ({ row }) => {
      const p = progressOf(row.original);
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/60 transition-all" style={{ width: `${p.pct}%` }} />
          </div>
          {p.hasFlow ? (
            <span className="text-xs tabular-nums">
              <span className="font-medium">%{p.pct}</span>
              <span className="ml-1 text-muted-foreground">
                ({fmtM(p.output)} / {fmtM(p.input)} m)
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      );
    },
  },
  {
    id: "ordered",
    header: "Sipariş",
    // Bağlı sipariş satırlarının toplam talep metrajı — çıkan/giren ile kıyas.
    // Stok üretiminde (siparişe bağlı değil) değer yok → "—".
    cell: ({ row }) => {
      const m = row.original.orderedMeters ?? 0;
      return m > 0 ? (
        <span className="tabular-nums text-xs">{fmtM(m)} m</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  },
  {
    accessorKey: "targetQuantity",
    header: () => <SortableHeader field="targetQuantity" label="Hedef" />,
    meta: { label: "Hedef" },
    cell: ({ row }) =>
      row.original.targetQuantity != null ? (
        <span className="tabular-nums text-xs">
          {row.original.targetQuantity.toLocaleString("tr-TR", { useGrouping: false })} m
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "plannedEndDate",
    header: () => <SortableHeader field="plannedEndDate" label="Termin" />,
    meta: { label: "Termin" },
    cell: ({ row }) => <DeadlineBadge deadline={row.original.plannedEndDate} />,
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Oluşturma" />,
    meta: { label: "Oluşturma" },
    cell: ({ row }) => <span className="text-xs">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => {
      const fason = row.original.currentFasonStations ?? [];
      return (
        // Yan yana (2. satıra taşıp satır yüksekliğini bozmasın); amber rozet + tooltip
        // zaten "fasonda" olduğunu belli ediyor → "Fasonda:" öneki gereksiz.
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={row.original.status}
            labels={workOrderStatusLabels}
            tones={workOrderStatusTones}
          />
          {fason.length > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
              title="Şu an mal bu fason istasyon(lar)ında"
            >
              {fason.join(", ")}
            </Badge>
          )}
        </div>
      );
    },
  },
];
