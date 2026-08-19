import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PanelRight, Award, Receipt } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { RowOpenItems, CopyMenuItem } from "@/components/data-table/row-menu-items";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
// Fatura dialog'u Muhasebe Sevkiyat klasöründe yaşıyor ama yapısal tip alır
// (`InvoiceTarget`) — iki ekran TEK dialog + TEK uç kullansın diye kopyalanmadı.
import { InvoiceDialog } from "@/pages/Operations/AccountingDispatch/InvoiceDialog";
import { BulkInvoiceAction } from "@/pages/Operations/AccountingDispatch/BulkInvoiceAction";
import { downloadDocsPdf, downloadDocsExcel, type DocTarget } from "./shipmentDocExport";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import type { PrintedDocType } from "@/services/printedDocumentService";
import { useDataTable } from "@/hooks/useDataTable";
import { useHideCancelled } from "@/hooks/useHideCancelled";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { customerService } from "@/pages/Customers/service";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { shipmentColumns } from "./columns";
import { shipmentService, branchLookupService } from "./service";
import { shipmentStatusLabels, type ShipmentListItem, type BranchLookupItem } from "./types";
import { ShipmentDetailSheet } from "./ShipmentDetailSheet";
import { DirectShipmentDetailSheet } from "./DirectShipmentDetailSheet";

const QUERY_KEY = "shipments";

// Tüm filtreler FilterBar'da (durum dahil — sekme yok). Durum çoklu-seçim (Sipariş
// paritesi). Şube SEÇİLEN MÜŞTERİYE bağlı (dependent-lookup): müşteri seçilmeden
// pasif, seçilince yalnız o müşterinin şubeleri (global endpoint filter[customerId]
// ile daraltılır). Tarih varsayılanı createdAt (indexli); Sevk opsiyonel.
const FILTERS: FilterDef[] = [
  {
    kind: "multi-select",
    key: "status",
    label: "Durum",
    options: [
      { value: "PLANNED", label: shipmentStatusLabels.PLANNED },
      { value: "DISPATCHED", label: shipmentStatusLabels.DISPATCHED },
      { value: "CANCELLED", label: shipmentStatusLabels.CANCELLED },
    ],
  },
  {
    // Muhasebenin asıl sorusu: "hangi sevkin faturası kesilmedi?" Backend
    // `filter[invoiced]` ile invoicedAt NULL/NOT NULL ayırır (listShipments).
    kind: "select",
    key: "invoiced",
    label: "Fatura",
    options: [
      { value: "true", label: "Kesildi" },
      { value: "false", label: "Kesilmedi" },
    ],
  },
  {
    // ÇOKLU: `SHIPMENT_FILTER_FIELDS` allowlist'inden geçip `buildWhereClause`'a
    // gidiyor → CSV zaten `in` oluyor (ek backend işi gerekmedi).
    kind: "multi-lookup",
    key: "customerId",
    label: "Müşteri",
    service: customerService,
    queryKey: "customers",
  },
  {
    kind: "dependent-lookup",
    key: "branchId",
    label: "Şube",
    dependsOn: "customerId",
    queryKey: "branch-lookup",
    placeholderNoParent: "Şube (önce müşteri)",
    fetchOptions: (customerId) =>
      branchLookupService
        .getAll({
          page: 1,
          pageSize: 200,
          sortBy: "name",
          sortOrder: "asc",
          filters: { isActive: "true", customerId },
        })
        .then((r) => r.data),
    getLabel: (it) => {
      const b = it as Partial<BranchLookupItem> & { id: string };
      if (!b.name) return b.id;
      return b.city ? `${b.name} (${b.city})` : b.name;
    },
  },
  // İçerik filtreleri — KUMAŞ + RENK BİRLİKTE = TEK TOP eşleşmesi ("mavi patos" =
  // aynı topun hem kumaşta hem renkte olduğu sevkiyatlar). Aktifken satırda "eşleşen:
  // N top" rozeti çıkar ve detaya matchItem/matchColor bağlamı taşınır.
  { kind: "multi-lookup", key: "itemId", label: "Kumaş", service: itemService, queryKey: "items" },
  { kind: "multi-lookup", key: "colorId", label: "Renk", service: colorService, queryKey: "colors" },
  {
    kind: "select",
    key: "hasReturns",
    label: "İade",
    options: [{ value: "true", label: "Yalnız iade içerenler" }],
  },
  {
    // TEKİL KALIR (bilinçli). `destination` NOT NULL + iki değerli: ikisini de
    // seçmek "filtre yok" ile aynı şeydir, yani çoklu seçim hiçbir şey
    // kazandırmaz. Üstelik zararlı olurdu: `listShipments` "destination filtresi
    // aktif mi" sorusuna `!= null` ile bakıyor ve aktifse DirectShipment'ları
    // union'dan DÜŞÜRÜYOR (o tabloda bu kolon yok) → "ikisini de seç" diyen
    // kullanıcı fasondan doğrudan sevkleri sessizce kaybederdi.
    kind: "select",
    key: "destination",
    label: "Hedef",
    options: [
      { value: "DOMESTIC", label: "Yurt İçi" },
      { value: "EXPORT", label: "İhracat" },
    ],
  },
  {
    kind: "dateRange",
    label: "Tarih",
    defaultField: "createdAt",
    fieldOptions: [
      { value: "createdAt", label: "Oluşturma" },
      { value: "dispatchedAt", label: "Sevk" },
    ],
  },
];

// Sevkiyat-türevli belgeler — hepsi sourceId = Shipment.id, generic görüntüleyicide açılır.
const SHIPMENT_DOCS: { docType: PrintedDocType; label: string; title: string; icon: typeof Award }[] = [
  { docType: "QUALITY_CERTIFICATE", label: "Kalite Sertifikası", title: "Kalite Sertifikası", icon: Award },
];

export function ShipmentsPage() {
  const [selected, setSelected] = useState<ShipmentListItem | null>(null);
  const [docView, setDocView] = useState<{ docType: PrintedDocType; sourceId: string; title: string } | null>(null);
  const [invoiceRow, setInvoiceRow] = useState<ShipmentListItem | null>(null);
  const [searchParams] = useSearchParams();

  // Liste→detay bağlam taşıma: aktif kumaş/renk (içerik) filtresi VARSA detay path'ine
  // matchItem/matchColor (csv) query ekle → detay sayfası eşleşen topları vurgular +
  // "yalnız eşleşenler" süzgeci sunar. Filtre yoksa sade path (regresyon yok).
  const matchItem = searchParams.get("filter[itemId]") ?? "";
  const matchColor = searchParams.get("filter[colorId]") ?? "";
  const detailPath = (s: ShipmentListItem): string => {
    const base =
      s.kind === "DIRECT"
        ? `/operations/shipments/direct/${s.id}`
        : `/operations/shipments/${s.id}`;
    const qp = new URLSearchParams();
    if (matchItem) qp.set("matchItem", matchItem);
    if (matchColor) qp.set("matchColor", matchColor);
    const qs = qp.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const { showCancelled, setShowCancelled, forceFilters } = useHideCancelled();

  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<ShipmentListItem>({
    queryKey: QUERY_KEY,
    fetchFn: shipmentService.listCursor,
    columns: shipmentColumns,
    defaultPageSize: 50,
    enableSelection: true,
    forceFilters,
  });

  // Belge (irsaliye/fiş) YALNIZ sevk edilmiş (DISPATCHED) sevkiyatta var — donmuş.
  const docTargets = (rows: ShipmentListItem[]): DocTarget[] =>
    rows
      .filter((r) => r.status === "DISPATCHED")
      .map((r) => ({ id: r.id, shipmentNo: r.shipmentNo, isDirect: r.kind === "DIRECT" }));

  const handleDocs = async (fmt: "pdf" | "excel", rows: ShipmentListItem[]) => {
    const targets = docTargets(rows);
    const skipped = rows.length - targets.length;
    if (targets.length === 0) {
      toast.error("Belge yok — yalnız sevk edilmiş (DISPATCHED) sevkiyatların irsaliyesi/fişi vardır.");
      return;
    }
    const res = fmt === "pdf" ? await downloadDocsPdf(targets) : await downloadDocsExcel(targets);
    if (res.ok) {
      toast.success(
        `${res.count ?? targets.length} belge indirildi${skipped ? ` — ${skipped} sevk-dışı satır atlandı` : ""}.`,
      );
    } else if (res.error) {
      toast.error(res.error);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Sevkiyatlar"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        placeholder="Sevkiyat no, firma, plaka, sürücü ara..."
        table={table}
        exportName="Sevkiyatlar"
        actions={
          <ToolbarToggle
            checked={showCancelled}
            onCheckedChange={setShowCancelled}
            label="İptalleri göster"
            title="İptal edilmiş sevkiyatlar varsayılan olarak gizlidir."
          />
        }
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
      <DataTable<ShipmentListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sevkiyat bulunamadı."
        onRowClick={setSelected}
        exportName="Sevkiyatlar"
        selectionHint={null}
        bulkActions={(rows) => {
          // Bu liste PLANNED/CANCELLED satır da içerir; backend faturalamayı
          // DISPATCHED'a kilitler (planlı sevkiyatın malı çıkmadı → ona kesilen
          // fatura sahte olurdu). Uygun olmayanları ÖNCEDEN süz: aksi halde
          // kullanıcı 5 satır seçip "2 başarısız" uyarısı alır ve sebebini
          // ekranda göremez. Belge dışa aktarımı da aynı statüyle sınırlı.
          const dispatched = rows.filter((r) => r.status === "DISPATCHED");
          return (
            <>
              <BulkInvoiceAction
                rows={dispatched}
                queryKey={QUERY_KEY}
                onDone={() => table.resetRowSelection()}
              />
              <ExportMenu
                label={`Belgeler (${dispatched.length})`}
                align="start"
                disabled={dispatched.length === 0}
                onPdf={() => handleDocs("pdf", rows)}
                onExcel={() => handleDocs("excel", rows)}
              />
            </>
          );
        }}
        rowContextMenu={(s) => {
          const path = detailPath(s);
          return (
            <>
              <ContextMenuItem onSelect={() => setSelected(s)}>
                <PanelRight /> Paneli Aç
              </ContextMenuItem>
              <RowOpenItems path={path} openLabel="Tam sayfa aç" />
              {s.kind !== "DIRECT" && (
                <>
                  <ContextMenuSeparator />
                  {SHIPMENT_DOCS.map((d) => (
                    <ContextMenuItem
                      key={d.docType}
                      onSelect={() => setDocView({ docType: d.docType, sourceId: s.id, title: d.title })}
                    >
                      <d.icon /> {d.label}
                    </ContextMenuItem>
                  ))}
                </>
              )}
              {/* Fatura işareti — yalnız ÇIKMIŞ sevkiyatta anlamlı (sevk edilmemiş
                  mal faturalanmaz). Aynı işaret Muhasebe Sevkiyat ekranından da
                  verilebilir; ikisi de tek dialog + tek ucu kullanır. */}
              {s.status === "DISPATCHED" && (
                <PermissionGate permission="shipping:invoice">
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setInvoiceRow(s)}>
                    <Receipt /> {s.invoiceNo ? "Fatura bilgisini düzenle" : "Faturalandı işaretle"}
                  </ContextMenuItem>
                </PermissionGate>
              )}
              <ContextMenuSeparator />
              <CopyMenuItem label="Sevkiyat No" value={s.shipmentNo} />
            </>
          );
        }}
      />

      <InvoiceDialog row={invoiceRow} onClose={() => setInvoiceRow(null)} queryKey={QUERY_KEY} />
      <PrintedDocDialog
        docType={docView?.docType ?? "QUALITY_CERTIFICATE"}
        sourceId={docView?.sourceId ?? null}
        open={Boolean(docView)}
        onOpenChange={(o) => !o && setDocView(null)}
        title={docView?.title ?? ""}
        description="Sevkiyat kaynaklı belge — ilk açılışta güncel veriden donar."
        writePermission="shipping:write"
      />
      <ShipmentDetailSheet
        shipmentId={selected && selected.kind !== "DIRECT" ? selected.id : null}
        open={Boolean(selected) && selected?.kind !== "DIRECT"}
        onOpenChange={(o) => !o && setSelected(null)}
        matchItem={matchItem || undefined}
        matchColor={matchColor || undefined}
      />
      <DirectShipmentDetailSheet
        directShipmentId={selected?.kind === "DIRECT" ? selected.id : null}
        open={Boolean(selected) && selected?.kind === "DIRECT"}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </PageShell>
  );
}
