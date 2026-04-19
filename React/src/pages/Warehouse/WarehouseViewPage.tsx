import { useCallback, useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Eye, type LucideIcon } from "lucide-react";
import type { QueryParams } from "@/types/api";
import { useDataTable } from "@/hooks/useDataTable";
import {
  DataTable,
  DataTableToolbar,
  DataTablePagination,
  DataTableSkeleton,
  DataTableExport,
  getSelectionColumn,
} from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { rollService } from "@/services/rollService";
import type { Roll } from "@/types/models";
import {
  RollStatus,
  rollStatusLabels,
  itemTypeLabels,
  type ItemType,
} from "@/types/enums";
import RollDetailPanel from "../Rolls/RollDetailPanel";

export interface WarehouseCategoryConfig {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Prisma `filter[status]` değeri — virgüllü listeye izin verir (ör: "STOCK,RETURNED_FROM_SUBCONTRACTOR"). */
  statusFilter: string;
  /** UI'da rozet rengi. */
  badgeClass: string;
}

interface WarehouseViewPageProps {
  config: WarehouseCategoryConfig;
  /** Aynı bileşen birden fazla route'da kullanıldığı için cache bucket ayırır. */
  queryKey: string;
}

export default function WarehouseViewPage({
  config,
  queryKey,
}: WarehouseViewPageProps) {
  const [detailRollId, setDetailRollId] = useState<string | null>(null);

  const fetchRolls = useCallback(
    (params: QueryParams) => {
      const p: QueryParams = {
        ...params,
        filters: { ...params.filters, status: config.statusFilter },
      };
      return rollService.getAll(p);
    },
    [config.statusFilter],
  );

  const columns = useMemo<ColumnDef<Roll, unknown>[]>(
    () => [
      getSelectionColumn<Roll>(),
      {
        accessorKey: "barcode",
        header: "Barkod",
        size: 210,
        cell: ({ getValue }) => (
          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
            {getValue<string>()}
          </code>
        ),
      },
      {
        id: "itemCode",
        header: "Ürün Kodu",
        size: 130,
        cell: ({ row }) => row.original.item?.code ?? "—",
      },
      {
        id: "itemName",
        header: "Ürün",
        size: 220,
        cell: ({ row }) => row.original.item?.name ?? "—",
      },
      {
        id: "design",
        header: "Desen",
        size: 140,
        cell: ({ row }) =>
          row.original.variant?.code ||
          row.original.design || (
            <span className="text-muted-foreground italic text-xs">—</span>
          ),
      },
      {
        id: "itemType",
        header: "Tür",
        size: 120,
        cell: ({ row }) => {
          const type = row.original.item?.itemType;
          return type ? itemTypeLabels[type as ItemType] ?? type : "—";
        },
      },
      {
        accessorKey: "currentQty",
        header: "Miktar (mt)",
        size: 110,
        cell: ({ row }) => row.original.currentQty,
      },
      {
        accessorKey: "weightKg",
        header: "Ağırlık (kg)",
        size: 110,
        cell: ({ getValue }) => getValue<number | null>() ?? "—",
      },
      {
        accessorKey: "qualityGrade",
        header: "Kalite",
        size: 100,
      },
      {
        accessorKey: "status",
        header: "Durum",
        size: 130,
        cell: ({ getValue }) => {
          const val = getValue<string>();
          return (
            <Badge className={config.badgeClass} variant="secondary">
              {rollStatusLabels[val as keyof typeof rollStatusLabels] ?? val}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 60,
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              setDetailRollId(row.original.id);
            }}
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [config.badgeClass],
  );

  const dt = useDataTable({
    queryKey,
    fetchFn: fetchRolls,
    columns,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
  });

  const Icon = config.icon;
  const totalQty = dt.data.reduce((s, r) => s + (r.currentQty ?? 0), 0);
  const totalWeight = dt.data.reduce((s, r) => s + (r.weightKg ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">{config.title}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            {dt.pagination.total} top
          </Badge>
          <span>·</span>
          <span>{totalQty.toFixed(1)} m</span>
          <span>·</span>
          <span>{totalWeight.toFixed(1)} kg</span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{config.description}</p>

      <DataTableToolbar
        search={dt.search}
        onSearchChange={dt.setSearch}
        searchPlaceholder="Barkod ile ara..."
        activeFilters={dt.activeFilters}
        onFilterChange={dt.setFilter}
        onFilterClear={dt.clearFilter}
        onClearAll={dt.clearAllFilters}
      >
        <DataTableExport
          data={dt.data}
          selectedData={dt.selectedRows}
          filename={queryKey}
          columns={[
            { header: "Barkod", accessor: "barcode" },
            {
              header: "Ürün Kodu",
              accessor: (r: Roll) => r.item?.code ?? "",
            },
            {
              header: "Ürün",
              accessor: (r: Roll) => r.item?.name ?? "",
            },
            { header: "Miktar (mt)", accessor: "currentQty" },
            { header: "Ağırlık (kg)", accessor: "weightKg" },
            { header: "Kalite", accessor: "qualityGrade" },
            {
              header: "Durum",
              accessor: (r: Roll) =>
                rollStatusLabels[r.status as keyof typeof rollStatusLabels] ??
                r.status,
            },
          ]}
        />
      </DataTableToolbar>

      {dt.isLoading ? (
        <DataTableSkeleton columnCount={9} rowCount={10} />
      ) : (
        <DataTable
          table={dt.table}
          columnCount={9}
          isFetching={dt.isFetching}
        />
      )}

      <DataTablePagination
        page={dt.pagination.page}
        pageSize={dt.pagination.pageSize}
        total={dt.pagination.total}
        totalPages={dt.pagination.totalPages}
        onPageChange={dt.setPage}
        onPageSizeChange={dt.setPageSize}
        selectedCount={dt.selectedCount}
      />

      <RollDetailPanel
        rollId={detailRollId}
        isOpen={!!detailRollId}
        onClose={() => setDetailRollId(null)}
      />
    </div>
  );
}

// ---- Ready-made pages ---------------------------------------------------

import { Boxes, Package, Sparkles, Trash2 } from "lucide-react";

export function HamDepoPage() {
  return (
    <WarehouseViewPage
      queryKey="warehouse-ham"
      config={{
        title: "Ham Depo",
        description:
          "Üretime girmemiş ham kumaş/iplik stoğu (Mal Kabul ile oluşturulan toplar).",
        icon: Boxes,
        statusFilter: RollStatus.STOCK,
        badgeClass:
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
      }}
    />
  );
}

export function MamulDepoPage() {
  return (
    <WarehouseViewPage
      queryKey="warehouse-mamul"
      config={{
        title: "Mamul Depo",
        description:
          "Üretimden çıkmış, paketlenmiş ve sevk için bekleyen mamul toplar.",
        icon: Package,
        statusFilter: `${RollStatus.WAREHOUSE},${RollStatus.PRODUCED},${RollStatus.READY_FOR_SHIP}`,
        badgeClass:
          "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
      }}
    />
  );
}

export function A1DepoPage() {
  return (
    <WarehouseViewPage
      queryKey="warehouse-a1"
      config={{
        title: "A1 / 2. Kalite Deposu",
        description:
          "Tambur kararıyla A1/2. kalite olarak ayrılmış toplar (satışa hazır ama alt kalite).",
        icon: Sparkles,
        statusFilter: RollStatus.A1_STOCK,
        badgeClass:
          "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
      }}
    />
  );
}

export function FireDepoPage() {
  return (
    <WarehouseViewPage
      queryKey="warehouse-fire"
      config={{
        title: "Fire Deposu",
        description:
          "Tambur'da kesilip hurdaya ayrılmış toplar (SCRAP). Satışa/üretime konu olmaz.",
        icon: Trash2,
        statusFilter: RollStatus.SCRAP,
        badgeClass:
          "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      }}
    />
  );
}
