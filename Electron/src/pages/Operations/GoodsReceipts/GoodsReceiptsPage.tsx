import { useMemo, useState } from "react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useDeepLinkParam } from "@/hooks/useDeepLinkParam";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PermissionGate } from "@/components/PermissionGate";
import { GOODS_RECEIPT_COLUMNS } from "./GoodsReceiptTable";
import { listGoodsReceipts } from "./service";
import { GoodsReceiptFormDialog } from "./GoodsReceiptFormDialog";
import { GoodsReceiptDetailSheet } from "./GoodsReceiptDetailSheet";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";

/**
 * MAL KABUL — satın alınan malın depo girişi.
 *
 * ⚠️ Bu ekran ALIM-SATIM kurulumu içindir; üretici fabrikada mal KK1'den ham
 * olarak girer ve rotaya sokulur. Fabrikada görünmemesini sağlayan şey
 * `goods-receipt:read` izninin hiçbir varsayılan rol şablonunda OLMAMASIDIR
 * (karoya `multiWarehouse` şartı KONMAZ — tek depolu ticaret firması da kullanır).
 */
export function GoodsReceiptsPage() {
  const { hasPermission } = useRoleAccess();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Oluşturma yanıtındaki sipariş senkronu — SUNUCUDA SAKLANMAZ, `GET` ile geri
  // alınamaz. Fişin id'siyle birlikte tutulur ki listeden BAŞKA bir fiş açıldığında
  // o fişe aitmiş gibi görünmesin (yanlış fişe yazılan uyarı, hiç uyarmamaktan
  // kötüdür — depocu doğru fişi doğru sanır).
  const [createdSync, setCreatedSync] = useState<{ id: string; sync: ReceiptPurchaseOrderSync } | null>(null);
  // Pano derin bağlantıları: hızlı işlem `?action=new` formu, son hareket `?focus=<id>` fiş detayını açar.
  useDeepLinkParam("action", (v) => { if (v === "new" && hasPermission("goods-receipt:write")) setFormOpen(true); });
  useDeepLinkParam("focus", setDetailId);

  const q = useQuery({
    queryKey: ["goods-receipts", search],
    queryFn: () => listGoodsReceipts({ page: 1, pageSize: 100, search: search || undefined }),
  });

  const rows = useMemo(() => q.data?.data ?? [], [q.data]);
  const table = useLocalTable({ tableKey: "goods-receipt:list", data: rows, columns: GOODS_RECEIPT_COLUMNS });
  const total = q.data?.pagination?.total ?? 0;

  return (
    <PageShell>
      <PageHeader
        title="Mal Kabul"
        description="Satın alınan malın depo girişi — fiş açılır, toplar girilir, barkod + etiket üretilir."
        actions={
          <div className="flex flex-wrap gap-2">
            <RefreshButton queryKey="goods-receipts" />
            <PermissionGate permission="goods-receipt:write">
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni Mal Kabul
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Fiş no veya tedarikçi irsaliye no ara" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Mal kabul fişleri" />
        </div>
      </ListToolbar>

      {/* ⚠️ HATA, "HENÜZ FİŞ YOK"UN ÖNÜNDE (DataTable sırası): boş-durum cümlesi "Yeni Mal Kabul" davetidir; hata
          anında basılırsa depocu kaydettiği fişi yok sanıp AYNI MALI ikinci kez girer. */}
      <DataTable
        table={table}
        markEntity="goodsReceipt"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Mal kabul listesi yüklenemedi. Yeni fiş açmadan önce tekrar deneyin; kaydettiğiniz fiş duruyor olabilir."
        onRetry={() => void q.refetch()}
        onRowClick={(r) => setDetailId(r.id)}
        exportName="Mal kabul fişleri"
        emptyText={search ? "Aramaya uyan fiş yok." : "Henüz mal kabul fişi yok."}
        emptyDescription={search ? undefined : "“Yeni Mal Kabul” ile tedarikçiden gelen malı depoya alın."}
      />
      <ListFooter
        loaded={rows.length}
        total={total}
        label={
          // KIRPMA SESSİZ DEĞİL (norm: CashTransactionsPage): ilk 100 fiş gösterilir, aramayla daraltılır.
          total > rows.length ? (
            <span className="text-amber-700 dark:text-amber-500" title="En yeniden geriye; aradığınızı fiş no / irsaliye no aramasıyla bulun.">
              {total} fişin ilk {rows.length} tanesi gösteriliyor
            </span>
          ) : undefined
        }
      >
        {rows.length > 0 && (
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Fişi açmak için satıra tıklayın
          </span>
        )}
      </ListFooter>

      <GoodsReceiptFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(id, sync) => {
          setFormOpen(false);
          setCreatedSync(sync ? { id, sync } : null);
          setDetailId(id);
        }}
      />
      {/* Uyarı bandı DETAY PANELİNDE basılır, formda değil: form kaydettiği anda
          kapanıyor (yukarıdaki `onCreated`) — orada basmak toast'ın ikizi olurdu.
          Panel ise operatörün kayıttan hemen sonra düştüğü yerdir ve KAPATANA
          KADAR durur. Listeden açılan fişlerde `sync` null → bant çizilmez. */}
      <GoodsReceiptDetailSheet
        id={detailId}
        sync={createdSync?.id === detailId ? createdSync.sync : null}
        onOpenChange={(o) => {
          if (o) return;
          setDetailId(null);
          setCreatedSync(null);
        }}
      />
    </PageShell>
  );
}
