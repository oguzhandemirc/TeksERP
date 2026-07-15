import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  DirectShipmentDetailContent,
  useDirectShipmentDetail,
} from "./DirectShipmentDetailContent";

interface Props {
  directShipmentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fasondan sevk (DirectShipment) detayı — MODAL. Parti Geçmişi'ndeki "Fasondan Sevkler"
 * satırından açılır. Gövde Sheet ile aynı (DirectShipmentDetailContent); başlık aynı
 * query'yi okur (dedupe).
 */
export function DirectShipmentDetailModal({ directShipmentId, open, onOpenChange }: Props) {
  const q = useDirectShipmentDetail(directShipmentId, open);
  const d = q.data?.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.shipmentNo ?? "Fasondan Sevk"}</span>
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {d ? `${d.customer.name}${d.branch ? " · " + d.branch.name : ""}` : "Yükleniyor…"}
          </DialogDescription>
        </DialogHeader>

        <DirectShipmentDetailContent directShipmentId={directShipmentId} enabled={open} />
      </DialogContent>
    </Dialog>
  );
}
