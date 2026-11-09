// "Fason İş Emri" ibaresinin TEK ölçütü: tür `CUSTOMER_GOODS_SERVICE` (tabletteki `isCustomerGoodsWo` ile aynı).
// Liste hücresinde kısa "Fason", detay başlığında "Fason İş Emri"; ton turuncu (uyarı jetonu).
import { cn } from "@/lib/utils";
import { WorkOrderType } from "@/types/enums";
import { TERIM } from "@/lib/terim";

export const isCustomerGoodsWorkOrder = (type: string | null | undefined): boolean =>
  type === WorkOrderType.CUSTOMER_GOODS_SERVICE;

export function FasonTag({ type, long = false, className }: { type: string | null | undefined; long?: boolean; className?: string }) {
  if (!isCustomerGoodsWorkOrder(type)) return null;
  return (
    <span
      data-testid="wo-fason-tag"
      className={cn(
        "inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold text-warning",
        className,
      )}
    >
      {long ? `Fason ${TERIM.terbiyeIsEmri.tekil}` : "Fason"}
    </span>
  );
}
