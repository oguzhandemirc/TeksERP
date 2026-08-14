import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { Plus, FileText } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
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
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Oluşturma yanıtındaki sipariş senkronu — SUNUCUDA SAKLANMAZ, `GET` ile geri
  // alınamaz. Fişin id'siyle birlikte tutulur ki listeden BAŞKA bir fiş açıldığında
  // o fişe aitmiş gibi görünmesin (yanlış fişe yazılan uyarı, hiç uyarmamaktan
  // kötüdür — depocu doğru fişi doğru sanır).
  const [createdSync, setCreatedSync] = useState<{ id: string; sync: ReceiptPurchaseOrderSync } | null>(null);

  const q = useQuery({
    queryKey: ["goods-receipts", search],
    queryFn: () => listGoodsReceipts({ page: 1, pageSize: 100, search: search || undefined }),
  });

  const rows = q.data?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Mal Kabul"
        description="Satın alınan malın depo girişi — fiş açılır, toplar girilir, barkod + etiket üretilir."
        actions={
          <PermissionGate permission="goods-receipt:write">
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Yeni Mal Kabul
            </Button>
          </PermissionGate>
        }
      />

      <div className="shrink-0 border-b px-6 py-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Fiş no veya tedarikçi irsaliye no ara..."
          className="max-w-sm"
        />
      </div>

      <PageBody className="p-6">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Henüz mal kabul fişi yok. “Yeni Mal Kabul” ile tedarikçiden gelen malı depoya alın.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Fiş No</th>
                  <th className="p-3 text-left">Tarih</th>
                  <th className="p-3 text-left">Depo</th>
                  <th className="p-3 text-left">Tedarikçi</th>
                  <th className="p-3 text-left">Tedarikçi İrs.</th>
                  {/* "Top" değil "İçerik": fiş iplik de taşıyabilir (Sınıf 5) —
                      yalnız-iplik fiş "0 top" görünürse depocu "kaydedilmemiş"
                      sanıp ikinci kez girer (backend loadDetail uyarısının ikizi). */}
                  <th className="p-3 text-right">İçerik</th>
                  <th className="p-3 text-left">Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => setDetailId(r.id)}
                  >
                    <td className="p-3 font-mono text-xs">{r.receiptNo}</td>
                    <td className="p-3">{format(new Date(r.createdAt), "dd MMM yyyy HH:mm", { locale: tr })}</td>
                    <td className="p-3">{r.warehouse?.name ?? "—"}</td>
                    <td className="p-3">{r.supplier?.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.deliveryNoteNo ?? "—"}</td>
                    {/* Sayaç backend `_count`undan (yarnMovements eski backend'de
                        yok → ?? 0 kumaş sayacına düşer). ⚠️ İki sayaç da "ne
                        oldu"yu sayar (iptalli fişte satırlar da sayılır) —
                        "ne kaldı" detaydaki `totals`tadır; ayrışan tek durum
                        İptal rozetli satırdır (backend listReceipts yorumu). */}
                    <td className="p-3 text-right tabular-nums">
                      {[
                        ...(r._count.rolls > 0 || (r._count.yarnMovements ?? 0) === 0
                          ? [`${r._count.rolls} top`]
                          : []),
                        ...((r._count.yarnMovements ?? 0) > 0
                          ? [`${r._count.yarnMovements} iplik`]
                          : []),
                      ].join(" + ")}
                    </td>
                    <td className="p-3">
                      {r.status === "CANCELLED" ? (
                        <Badge variant="outline">İptal</Badge>
                      ) : (
                        <Badge variant="default">Aktif</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" />
            Satıra tıklayarak fişi açın; oradan fiş belgesini basabilir veya fişi iptal edebilirsiniz.
          </p>
        )}
      </PageBody>

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
