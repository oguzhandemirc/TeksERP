import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
 * Fasondan sevk (DirectShipment) detayı — birleşik Sevkiyatlar listesinden "Fasondan
 * Sevk" satırı açılınca (slide-over). Gövde DirectShipmentDetailContent'te (Modal ile
 * paylaşılır); başlık aynı query'yi okur (dedupe).
 */
export function DirectShipmentDetailSheet({ directShipmentId, open, onOpenChange }: Props) {
  const q = useDirectShipmentDetail(directShipmentId, open);
  const d = q.data?.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.shipmentNo ?? "Fasondan Sevk"}</span>
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          </SheetTitle>
          <SheetDescription>
            {d
              ? `${d.customer.name}${d.branch ? " · " + d.branch.name + (d.branch.code ? ` (${d.branch.code})` : "") : ""}`
              : "Yükleniyor…"}
          </SheetDescription>
        </SheetHeader>

        <DirectShipmentDetailContent directShipmentId={directShipmentId} enabled={open} />
      </SheetContent>
    </Sheet>
  );
}
