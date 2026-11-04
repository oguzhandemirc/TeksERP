import { useState } from "react";
import { Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { UnlinkOrderLinksDialog } from "./UnlinkOrderLinksDialog";
import { canShowUnlinkOrders } from "./unlink-order-links";
import type { WorkOrder } from "./types";

/**
 * "Sipariş Bağını Kopar" tuşu + diyaloğu — tam sayfa başlık ve yan panel AYNI
 * bileşeni kullanır (iki yüzey ayrışmasın). Görünürlük `canShowUnlinkOrders`.
 */
export function UnlinkOrdersButton({
  wo,
  look,
  onSuggestColor,
}: {
  wo: WorkOrder;
  look: "header" | "sheet";
  onSuggestColor: (colorId: string) => void;
}) {
  const { hasAnyPermission } = useRoleAccess();
  const [open, setOpen] = useState(false);
  if (!canShowUnlinkOrders(wo, hasAnyPermission)) return null;
  const label = (
    <>
      <Unlink className="h-3.5 w-3.5" /> Sipariş Bağını Kopar
    </>
  );
  return (
    <>
      {look === "header" ? (
        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      <UnlinkOrderLinksDialog open={open} onOpenChange={setOpen} workOrder={wo} onSuggestColor={onSuggestColor} />
    </>
  );
}
