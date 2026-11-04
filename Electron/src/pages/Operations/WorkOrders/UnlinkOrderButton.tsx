import { useState } from "react";
import { Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { UnlinkOrderDialog } from "./UnlinkOrderDialog";
import { canUnlinkOrder } from "./unlink-order";
import type { WorkOrder } from "./types";

/** "Sipariş Bağını Kopar" tuşu — başlık ve yan panelde AYNI yüklem (`canUnlinkOrder`). */
export function UnlinkOrderButton({
  wo,
  look,
  onSuggestColor,
}: {
  wo: WorkOrder;
  look: "header" | "sheet";
  onSuggestColor: (colorId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { permissions } = useRoleAccess();
  if (!canUnlinkOrder(wo, permissions)) return null;
  const label = <><Unlink className="h-3.5 w-3.5" /> Sipariş Bağını Kopar</>;
  return (
    <>
      {look === "header"
        ? <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>{label}</Button>
        : <button type="button" className="btn" onClick={() => setOpen(true)}>{label}</button>}
      <UnlinkOrderDialog open={open} onOpenChange={setOpen} wo={wo} onSuggestColor={onSuggestColor} />
    </>
  );
}
