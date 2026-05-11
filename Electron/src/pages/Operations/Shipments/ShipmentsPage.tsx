import { useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { useDataTable } from "@/hooks/useDataTable";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { shipmentColumns } from "./columns";
import { shipmentService } from "./service";
import { ShipmentDetailSheet } from "./ShipmentDetailSheet";
import { CreateShipmentDialog } from "./CreateShipmentDialog";
import { ReadyOrdersTab } from "./ReadyOrdersTab";
import { OpenSacksTab } from "./OpenSacksTab";
import { customerService } from "@/pages/Customers/service";
import type { Shipment } from "./types";

const QUERY_KEY = "shipments";

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PREPARING", label: "Hazırlanıyor" },
      { value: "SHIPPED", label: "Sevk Edildi" },
      { value: "CANCELLED", label: "İptal" },
    ],
  },
  { kind: "lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Oluşturulma" },
      { value: "shippedAt", label: "Sevk Tarihi" },
      { value: "plannedDate", label: "Planlı Sevk" },
    ],
  },
];

type Tab = "ready" | "sacks" | "list";

export function ShipmentsPage() {
  const [tab, setTab] = useState<Tab>("ready");
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { table, query, search, setSearch, pagination } = useDataTable<Shipment>({
    queryKey: QUERY_KEY,
    fetchFn: shipmentService.listCursor,
    columns: shipmentColumns,
    defaultPageSize: 50,
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevkiyat"
        description="Sevk edilebilir siparişleri buradan tek tıkla gönder; geçmiş ve hazırlanan sevkiyatlar Sevkiyatlar sekmesinde."
        actions={
          <RefreshButton
            queryKey={
              tab === "ready"
                ? "ready-orders"
                : tab === "sacks"
                  ? ["sacks", "open"]
                  : QUERY_KEY
            }
            successMessage="Liste yenilendi"
          />
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <TabsList>
            <TabsTrigger value="ready">Hazır Siparişler</TabsTrigger>
            <TabsTrigger value="sacks">Açık Çuvallar</TabsTrigger>
            <TabsTrigger value="list">Sevkiyatlar</TabsTrigger>
          </TabsList>
          {tab === "list" && (
            <PermissionGate permission="shipment:write">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Stoktan Sevkiyat
              </Button>
            </PermissionGate>
          )}
        </div>

        <TabsContent value="ready" className="m-0 flex-1 overflow-auto p-4">
          <ReadyOrdersTab />
        </TabsContent>

        <TabsContent value="sacks" className="m-0 flex-1 overflow-auto p-4">
          <OpenSacksTab />
        </TabsContent>

        <TabsContent value="list" className="m-0 flex flex-1 flex-col">
          <DataTableToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Sevk numarası ara..."
          />
          <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
          <DataTable<Shipment>
            table={table}
            isLoading={query.isLoading}
            pagination={pagination}
            emptyText="Sevkiyat bulunamadı."
            onRowClick={setSelected}
          />
        </TabsContent>
      </Tabs>

      <ShipmentDetailSheet
        shipment={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
      <CreateShipmentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
