import { AlertTriangle, Loader2, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RepairableShipment } from "./service";

/**
 * ONARIM ÖNİZLEMESİ — düğmeye basmadan ÖNCE ne olacağını söyler.
 *
 * ⚠️ Kök CLAUDE.md: yıkıcı/geri alınamaz işlemde arayüz etkilenen kaydı gösterir.
 * Onarım veriyi silmez ama İRSALİYENİN YENİ SÜRÜMÜNÜ doğurur ve sipariş
 * toplamlarını değiştirir — o yüzden onaydan önce üç sayı ve bir uyarı gösterilir.
 */
export function RepairPreviewDialog({
  satir,
  calisiyor,
  onOpenChange,
  onOnar,
}: {
  satir: RepairableShipment | null;
  calisiyor: boolean;
  onOpenChange: (open: boolean) => void;
  onOnar: (shipmentId: string) => void;
}) {
  const open = !!satir;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" /> {satir?.shipmentNo} — defteri onar
          </DialogTitle>
          <DialogDescription>
            Bu sevkiyattaki mal, bağlı olduğu sipariş satırlarına yeniden yazılır.
          </DialogDescription>
        </DialogHeader>

        {satir && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Kutu baslik="Çıkan mal" deger={satir.icerikMetraj} />
              <Kutu baslik="Şu an yazılı" deger={satir.yazilanMetraj} />
              <Kutu baslik="Yazılacak" deger={satir.onarilabilirMetraj} vurgu />
            </div>

            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Müşteri:</span> {satir.customer?.name ?? "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Sipariş:</span>{" "}
                {satir.orderNumbers.join(", ") || "—"}
              </div>
            </div>

            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4" /> Ne değişecek
              </div>
              <ul className="list-inside list-disc space-y-0.5 text-xs">
                <li>Siparişin “Sevk edilen” miktarı artar, “Açık” miktarı düşer.</li>
                <li>
                  İrsaliye <strong>yeni bir sürüm</strong> olarak yeniden basılır; eski sürüm
                  tarihsel kayıt olarak kalır.
                </li>
                <li>Sevkiyata bağlı sipariş kümesi <strong>değişmez</strong> — yeni sipariş eklenmez.</li>
                <li>Mal, çuval ve metraj <strong>değişmez</strong>; değişen yalnız deftere yazılan rakamdır.</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={calisiyor}>
            Vazgeç
          </Button>
          <Button
            onClick={() => satir && onOnar(satir.shipmentId)}
            disabled={calisiyor || !satir}
            className="gap-1.5"
          >
            {calisiyor && <Loader2 className="h-4 w-4 animate-spin" />}
            Defteri onar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kutu({ baslik, deger, vurgu }: { baslik: string; deger: number; vurgu?: boolean }) {
  return (
    <div className={`rounded-md border px-2 py-2 ${vurgu ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "bg-muted/40"}`}>
      <div className="text-xs text-muted-foreground">{baslik}</div>
      <div className="text-lg font-semibold">{Math.round(deger).toLocaleString("tr-TR")} m</div>
    </div>
  );
}
