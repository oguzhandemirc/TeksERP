import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Table2 } from "lucide-react";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { unitLabel } from "@/lib/item-unit";
import { ItemLifecycleBadge, itemLifecycleExportText } from "@/pages/Items/ItemLifecycleBadge";
import { serviceItemLifecycleApi } from "./service";
import { ServiceProcessesCell } from "./ServiceProcessesCell";
import { lastServiceProcessMap, processesOf } from "./serviceProcesses";
import type { ServiceItem } from "./types";

/** Satırdan fiyat tablosuna geçiş (`?item=` ile hizmet seçili açılır). */
export const servicePricesHref = (id: string) => `/definitions/service-prices?item=${encodeURIComponent(id)}`;

export const serviceColumns: ColumnDef<ServiceItem>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  { accessorKey: "name", header: () => <SortableHeader field="name" label="Ad" /> },
  {
    accessorKey: "unit",
    header: () => <SortableHeader field="unit" label="Birim" />,
    cell: ({ row }) => unitLabel(row.original.unit),
  },
  {
    accessorKey: "isActive",
    header: () => <SortableHeader field="isActive" label="Durum" />,
    meta: { exportValue: itemLifecycleExportText },
    cell: ({ row }) => <ItemLifecycleBadge item={row.original} api={serviceItemLifecycleApi} />,
  },
  {
    // Fason F3: kartın eşlendiği süreç türleri; tık eşleme modalını açar (item:write).
    id: "processes",
    header: "Süreç türleri",
    meta: { exportValue: (r: ServiceItem) => processesOf(r.id, lastServiceProcessMap()).map((p) => p.categoryName).join(", ") },
    cell: ({ row }) => <ServiceProcessesCell item={row.original} />,
  },
  {
    id: "prices",
    header: "Fiyatlar",
    meta: { exportValue: () => "" },
    cell: ({ row }) => (
      <Link
        to={servicePricesHref(row.original.id)}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        <Table2 className="h-3.5 w-3.5" /> Fiyat tablosu
      </Link>
    ),
  },
];
