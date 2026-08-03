import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accountingDispatchService } from "./service";

/**
 * Dialog'un ihtiyaç duyduğu MİNİMUM satır şekli — `DispatchListItem` değil.
 *
 * Neden yapısal tip: aynı fatura işareti iki ekrandan veriliyor (Muhasebe Sevkiyat
 * ve Sevkiyatlar listesi) ve iki listenin satır tipi farklı (`DispatchListItem` /
 * `ShipmentListItem`). Dialog'u bunlardan birine bağlamak ikinci ekran için kopya
 * bir dialog doğururdu — fatura işaretini iki yerde bakımı gereken bir şey yapardı.
 * `kind` alanı hangi uca gidileceğini belirler (SHIPMENT vs DIRECT), bu yüzden
 * zorunlu.
 */
export interface InvoiceTarget {
  id: string;
  kind: "SHIPMENT" | "DIRECT";
  shipmentNo: string;
  invoiceNo: string | null;
  invoicedAt: string | null;
}

/** `yyyy-MM-dd` — <input type="date"> değeri (yerel gün, UTC kaymasız). */
function toDateInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  row: InvoiceTarget | null;
  onClose: () => void;
  queryKey: string;
}

/**
 * "Faturalandı işaretle" — ERP fatura KESMEZ; dış muhasebe programındaki belgenin
 * no + tarihini sevkiyata iliştirir (mali alan yok, muhasebe yüzeyi miktar-odaklı).
 * Numara boş bırakılıp kaydedilirse işaret kaldırılır ("Kaldır" butonu ile aynı).
 */
export function InvoiceDialog({ row, onClose, queryKey }: Props): React.ReactElement {
  const qc = useQueryClient();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoicedAt, setInvoicedAt] = useState("");

  // Satır değişince formu o satırın mevcut değerleriyle doldur (düzenleme akışı).
  useEffect(() => {
    if (!row) return;
    setInvoiceNo(row.invoiceNo ?? "");
    setInvoicedAt(toDateInput(row.invoicedAt));
  }, [row]);

  const mut = useMutation({
    mutationFn: (body: { invoiceNo: string | null; invoicedAt?: string | null }) =>
      accountingDispatchService.setInvoice(row!, body),
    onSuccess: (_res, body) => {
      void qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success(body.invoiceNo ? "Fatura bilgisi kaydedildi." : "Fatura işareti kaldırıldı.");
      onClose();
    },
    // onError YOK — apiClient interceptor backend mesajını zaten toast'lar (duplicate olurdu).
  });

  const save = (): void => {
    const no = invoiceNo.trim();
    if (!no) {
      mut.mutate({ invoiceNo: null });
      return;
    }
    // <input type="date"> yerel günü verir; günün başlangıcı yerel olarak gönderilir.
    mut.mutate({ invoiceNo: no, invoicedAt: invoicedAt ? new Date(`${invoicedAt}T00:00:00`).toISOString() : null });
  };

  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fatura Bilgisi — {row?.shipmentNo}</DialogTitle>
          <DialogDescription>
            Muhasebe programında kesilen faturanın numarası ve tarihi. Sevkiyat rakamlarına
            dokunmaz; yalnız "bu sevk faturalandı mı" sorusunu yanıtlar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceNo">Fatura No</Label>
            <Input
              id="invoiceNo"
              value={invoiceNo}
              maxLength={64}
              autoFocus
              placeholder="örn. FTR2026000118"
              onChange={(e) => setInvoiceNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoicedAt">Fatura Tarihi</Label>
            <Input
              id="invoicedAt"
              type="date"
              value={invoicedAt}
              onChange={(e) => setInvoicedAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {row?.invoiceNo ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={mut.isPending}
              onClick={() => mut.mutate({ invoiceNo: null })}
            >
              İşareti Kaldır
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={mut.isPending} onClick={onClose}>
              İptal
            </Button>
            <Button size="sm" disabled={mut.isPending} onClick={save}>
              {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
