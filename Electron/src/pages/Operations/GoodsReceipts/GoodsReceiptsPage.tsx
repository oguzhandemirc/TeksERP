import { useMemo, useState } from "react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useDeepLinkParam } from "@/hooks/useDeepLinkParam";
import { useQuery } from "@tanstack/react-query";
import { Plus, FileText } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Input } from "@/components/ui/input";
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

      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ara…" title="Fiş no veya tedarikçi irsaliye no ara" aria-label="Fiş no veya tedarikçi irsaliye no ara"
          className="max-w-sm"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Mal kabul fişleri" />
        </div>
      </div>

      {!q.isLoading && rows.length > 0 ? (
        <>
          <DataTable table={table} markEntity="goodsReceipt" isError={q.isError} onRetry={() => void q.refetch()} onRowClick={(r) => setDetailId(r.id)} exportName="Mal kabul fişleri" />
          {/* KIRPMA SESSİZ DEĞİL (norm: CashTransactionsPage). */}
          {total > rows.length && (
            <p className="shrink-0 border-t px-4 py-2 text-xs text-amber-700 dark:text-amber-500">
              {total} fişin ilk {rows.length} tanesi gösteriliyor (en yeniden geriye).
              Aradığınızı bulmak için fiş no / irsaliye no aramasını kullanın.
            </p>
          )}
        </>
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError && rows.length === 0 ? (
          /* ⚠️ HATA, "HENÜZ FİŞ YOK"UN ÖNÜNDE: boş-durum cümlesi doğrudan
             "Yeni Mal Kabul" davetidir. Hata anında basılırsa depocu az önce
             kaydettiği fişi yok sanıp AYNI MALI ikinci kez girer — stok iki
             katına çıkar ve iki fişin de barkodları basılmış olur. */
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Mal kabul listesi yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">
                Bu bir “fiş yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
                Yeni fiş açmadan önce tekrar deneyin; kaydettiğiniz fiş duruyor olabilir.
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz mal kabul fişi yok. “Yeni Mal Kabul” ile tedarikçiden gelen malı depoya alın.
            </div>
          </ListMessage>
        ) : null}
      </ListBody>
      )}
      {rows.length > 0 && (
        <ListFooter loaded={rows.length} total={total}>
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            Satıra tıklayarak fişi açın; oradan fiş belgesini basabilir veya fişi iptal edebilirsiniz.
          </span>
        </ListFooter>
      )}

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
