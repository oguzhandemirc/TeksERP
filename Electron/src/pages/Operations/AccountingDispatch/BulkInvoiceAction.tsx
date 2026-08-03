import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/PermissionGate";
import { accountingDispatchService } from "./service";
import type { InvoiceTarget } from "./InvoiceDialog";

/**
 * TOPLU fatura işareti — bir fatura genelde BİRDEN ÇOK sevkiyatı kapsar; bunları
 * tek tek işaretlemek muhasebecinin en sık tekrarladığı işti.
 *
 * ⚠️ FATURA NO ZORUNLU — "numarasız ama faturalı" ara durum bilinçli olarak YOK
 * (`shipping.service.setShipmentInvoice`: `invoiceNo: null` işareti KALDIRIR).
 * Bu yüzden toplu akış tek bir numara sorar ve hepsine onu yazar; sözleşmeyi
 * gevşetmek "faturalı ama hangi fatura belli değil" kayıtları doğururdu ve
 * muhasebe mutabakatında izlenemezdi.
 *
 * TARİH SORULMAZ — bugüne damgalanır. Belirli bir tarih gereken kayıt satır
 * bazında düzenlenir (kullanıcı isteği: "tarih girmek istersem tek tek girerim").
 *
 * Uçlar per-kayıt olduğu için istekler SIRAYLA gider (paralel değil): her kayıt
 * kendi audit satırını yazar ve bir hata diğerlerini düşürmez — kısmi sonuç
 * kullanıcıya açıkça raporlanır ("N işaretlendi, M başarısız").
 */
interface Props {
  /** Seçili satırlar — yalnız faturalanabilir olanlar (çağıran süzer). */
  rows: InvoiceTarget[];
  /** İşlem sonrası tazelenecek liste anahtarı. */
  queryKey: string;
  /** Seçimi temizle (işlem başarıyla bittiğinde). */
  onDone?: () => void;
}

export function BulkInvoiceAction({ rows, queryKey, onDone }: Props): React.ReactElement | null {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [busy, setBusy] = useState(false);

  if (rows.length === 0) return null;

  const run = async (): Promise<void> => {
    const no = invoiceNo.trim();
    if (!no) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const r of rows) {
      try {
        // invoicedAt gönderilmez → backend `new Date()` damgalar (bugün).
        await accountingDispatchService.setInvoice(r, { invoiceNo: no });
        ok++;
      } catch {
        // apiClient interceptor backend mesajını zaten toast'ladı; burada yalnız
        // hangi sevkiyatın düştüğünü topluyoruz (özet mesajı için).
        failed.push(r.shipmentNo);
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: [queryKey] });
    if (failed.length === 0) {
      toast.success(`${ok} sevkiyat "${no}" faturasına işaretlendi.`);
    } else {
      toast.warning(
        `${ok} işaretlendi, ${failed.length} başarısız: ${failed.slice(0, 3).join(", ")}` +
          (failed.length > 3 ? " …" : ""),
      );
    }
    setOpen(false);
    setInvoiceNo("");
    if (failed.length === 0) onDone?.();
  };

  return (
    <PermissionGate permission="shipping:invoice">
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        title="Seçili sevkiyatları tek fatura numarasıyla işaretle"
      >
        <Receipt className="h-4 w-4" />
        Faturalandı ({rows.length})
      </Button>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Toplu Fatura İşareti</DialogTitle>
            <DialogDescription>
              Seçili {rows.length} sevkiyat aynı fatura numarasıyla işaretlenir. Tarih
              bugüne damgalanır — farklı bir tarih gerekiyorsa o sevkiyatı tek tek
              düzenleyin. ERP fatura kesmez; bu yalnız dış muhasebedeki belgenin izidir.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="bulkInvoiceNo">Fatura No</Label>
            <Input
              id="bulkInvoiceNo"
              value={invoiceNo}
              maxLength={64}
              autoFocus
              placeholder="örn. FTR2026000123"
              onChange={(e) => setInvoiceNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && invoiceNo.trim() && !busy) void run();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              Numara zorunlu: "faturalı ama numarası yok" kaydı mutabakatta izlenemez.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="button" disabled={busy || !invoiceNo.trim()} onClick={() => void run()}>
              {busy ? "İşaretleniyor…" : `${rows.length} sevkiyatı işaretle`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
