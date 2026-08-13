import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { ArrowRight, Ban, Plus, Printer } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import { cancelTransfer, getTransfer, listTransfers } from "./service";
import { TransferFormDialog } from "./TransferFormDialog";

/**
 * DEPO TRANSFERİ — depolar arası taşıma + irsaliye.
 *
 * ⚠️ Karo TEK DEPOLU kurulumda çizilmez (`visibleWhen: ctx.multiWarehouse`);
 * bu sayfa da orada anlamsızdır. Route açık kalır (adres çubuğundan girilirse
 * çalışır) — kural görünürlüktür, erişim engeli değil.
 */
export function WarehouseTransfersPage() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Baskı yerine ÖNİZLEME (saha isteği): ne basılacağı görülmeden kâğıt gitmesin.
  const [docOpen, setDocOpen] = useState(false);

  const listQ = useQuery({ queryKey: ["warehouse-transfers"], queryFn: () => listTransfers({ page: 1, pageSize: 100 }) });
  const detailQ = useQuery({
    queryKey: ["warehouse-transfer", detailId],
    queryFn: () => getTransfer(detailId!),
    enabled: Boolean(detailId),
  });
  const t = detailQ.data;

  const cancelM = useMutation({
    mutationFn: (reason: string) => cancelTransfer(detailId!, reason),
    onSuccess: (res) => {
      toast.success(res.message ?? "Transfer geri alındı.");
      void qc.invalidateQueries({ queryKey: ["warehouse-transfers"] });
      void qc.invalidateQueries({ queryKey: ["warehouse-transfer", detailId] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setConfirmCancel(false);
    },
  });

  const rows = listQ.data?.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Depo Transferi"
        description="Depolar arası taşıma. Toplar tek işlemde taşınır — biri uygun değilse hiçbiri taşınmaz."
        actions={
          <PermissionGate permission="warehouse:transfer">
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Yeni Transfer
            </Button>
          </PermissionGate>
        }
      />

      <PageBody className="p-6">
        {listQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Henüz transfer yok.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Belge No</th>
                  <th className="p-3 text-left">Tarih</th>
                  <th className="p-3 text-left">Güzergâh</th>
                  <th className="p-3 text-right">Top</th>
                  <th className="p-3 text-left">Durum</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setDetailId(r.id)}>
                    <td className="p-3 font-mono text-xs">{r.transferNo}</td>
                    <td className="p-3">{format(new Date(r.createdAt), "dd MMM yyyy HH:mm", { locale: tr })}</td>
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1">
                        {r.fromWarehouse.name}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {r.toWarehouse.name}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums">{r._count.movements}</td>
                    <td className="p-3">
                      {r.status === "CANCELLED" ? <Badge variant="outline">Geri alındı</Badge> : <Badge>Tamam</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      <TransferFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(id) => {
          setFormOpen(false);
          setDetailId(id);
        }}
      />

      <Sheet open={Boolean(detailId)} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent className="w-[640px] sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="font-mono">{t?.transferNo ?? "…"}</span>
              {t?.status === "CANCELLED" && <Badge variant="outline">Geri alındı</Badge>}
            </SheetTitle>
          </SheetHeader>

          {!t ? (
            <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <b>{t.fromWarehouse.name}</b>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <b>{t.toWarehouse.name}</b>
                <span className="ml-auto text-muted-foreground">
                  {t.totals.rollCount} top · {t.totals.totalQty} m
                </span>
              </div>

              <div className="max-h-[45vh] overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">Barkod</th>
                      <th className="p-2 text-left">Ürün / Renk</th>
                      <th className="p-2 text-right">Metre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.lines.map((l) => (
                      <tr key={l.roll.id} className="border-t">
                        <td className="p-2 font-mono text-xs">{l.roll.barcode ?? "—"}</td>
                        <td className="p-2">
                          {l.roll.item.name}
                          {l.roll.color ? ` · ${l.roll.color.name}` : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums">{String(l.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDocOpen(true)}>
                  <Printer className="mr-1 h-4 w-4" />
                  İrsaliyeyi Görüntüle / Bas
                </Button>
                {t.status === "COMPLETED" && (
                  <PermissionGate permission="warehouse:transfer">
                    <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
                      <Ban className="mr-1 h-4 w-4" />
                      Geri Al
                    </Button>
                  </PermissionGate>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <PrintedDocDialog
        docType="TRANSFER_DISPATCH"
        sourceId={detailId}
        open={docOpen}
        onOpenChange={setDocOpen}
        title={`Transfer İrsaliyesi — ${t?.transferNo ?? ""}`}
        writePermission="warehouse:transfer"
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Transfer geri alınsın mı?"
        description={
          `${t?.transferNo}: ${t?.totals.rollCount ?? 0} top "${t?.toWarehouse.name}" deposundan ` +
          `"${t?.fromWarehouse.name}" deposuna geri döner. Transferden sonra işlem görmüş (sevk edilmiş / ` +
          `başka depoya taşınmış) top varsa geri alma reddedilir. İrsaliye İPTAL filigranıyla saklanır.`
        }
        confirmLabel="Geri Al"
        onConfirm={() => cancelM.mutate("Transfer geri alındı")}
        isPending={cancelM.isPending}
        destructive
      />
    </PageShell>
  );
}
