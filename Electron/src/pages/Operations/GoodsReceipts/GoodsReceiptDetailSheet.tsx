import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Ban } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { printHtmlString } from "@/lib/print";
import apiClient from "@/services/apiClient";
import { cancelGoodsReceipt, getGoodsReceipt } from "./service";

interface Props {
  id: string | null;
  onOpenChange: (open: boolean) => void;
}

export function GoodsReceiptDetailSheet({ id, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const q = useQuery({
    queryKey: ["goods-receipt", id],
    queryFn: () => getGoodsReceipt(id!),
    enabled: Boolean(id),
  });
  const r = q.data;

  const printM = useMutation({
    mutationFn: async () => {
      // Belge İLK BASKIDA donar (lazy-init) — fiş bir kaptır, satırlar sonradan
      // eklenebildiği için açılışta dondurmak boş belge üretirdi.
      const res = await apiClient.get(`/api/printed-documents/GOODS_RECEIPT/${id}/html`);
      return res.data.data.html as string;
    },
    onSuccess: (html) => printHtmlString(html),
  });

  const cancelM = useMutation({
    mutationFn: (reason: string) => cancelGoodsReceipt(id!, reason),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fiş iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      void qc.invalidateQueries({ queryKey: ["goods-receipt", id] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      setConfirmCancel(false);
    },
  });

  return (
    <>
      <Sheet open={Boolean(id)} onOpenChange={onOpenChange}>
        <SheetContent className="w-[640px] sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="font-mono">{r?.receiptNo ?? "…"}</span>
              {r?.status === "CANCELLED" && <Badge variant="outline">İptal</Badge>}
            </SheetTitle>
          </SheetHeader>

          {q.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : !r ? null : (
            <div className="mt-4 space-y-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Depo</dt>
                  <dd>{r.warehouse.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tedarikçi</dt>
                  <dd>{r.supplier?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tedarikçi İrsaliyesi</dt>
                  <dd>{r.deliveryNoteNo ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Toplam</dt>
                  <dd>
                    {r.totals.rollCount} top · {r.totals.totalQty} m
                  </dd>
                </div>
              </dl>

              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="p-2 text-left">Barkod</th>
                      <th className="p-2 text-left">Ürün / Renk</th>
                      <th className="p-2 text-right">Metre</th>
                      <th className="p-2 text-left">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rolls.map((roll) => (
                      <tr key={roll.id} className="border-t">
                        <td className="p-2 font-mono text-xs">{roll.barcode ?? "—"}</td>
                        <td className="p-2">
                          {roll.item.name}
                          {roll.color ? ` · ${roll.color.name}` : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums">{String(roll.currentQty)}</td>
                        <td className="p-2 text-xs text-muted-foreground">{roll.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => printM.mutate()} disabled={printM.isPending}>
                  <Printer className="mr-1 h-4 w-4" />
                  Fişi Bas
                </Button>
                {r.status === "ACTIVE" && (
                  <PermissionGate permission="goods-receipt:write">
                    <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
                      <Ban className="mr-1 h-4 w-4" />
                      Fişi İptal Et
                    </Button>
                  </PermissionGate>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Mal kabul fişi iptal edilsin mi?"
        description={
          `${r?.receiptNo}: fişteki ${r?.totals.rollCount ?? 0} top da İPTAL edilecek ("mal hiç girmedi" kaydı). ` +
          `İşlem görmüş (üretime girmiş / sevk edilmiş) top varsa iptal reddedilir.`
        }
        confirmLabel="Fişi İptal Et"
        onConfirm={() => cancelM.mutate("Mal kabul fişi iptali")}
        isPending={cancelM.isPending}
        destructive
      />
    </>
  );
}
