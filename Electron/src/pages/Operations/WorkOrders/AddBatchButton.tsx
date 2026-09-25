import { useState } from "react";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { AddBatchDialog } from "./AddBatchDialog";
import type { WorkOrder } from "./types";

/** "Parti Ekle" tuşu — başlık ve yan panelde AYNI kural: `workorder:write` + açık iş emri (Planlandı/Üretimde). */
export function AddBatchButton({ wo, look }: { wo: WorkOrder; look: "header" | "sheet" }) {
  const [open, setOpen] = useState(false);
  if (wo.status !== "PLANNED" && wo.status !== "IN_PROGRESS") return null;
  const label = <><PackagePlus className="h-3.5 w-3.5" /> Parti Ekle</>;
  return (
    <PermissionGate permission="workorder:write">
      {look === "header"
        ? <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>{label}</Button>
        : <button type="button" className="btn" onClick={() => setOpen(true)}>{label}</button>}
      <AddBatchDialog open={open} onOpenChange={setOpen} wo={wo} />
    </PermissionGate>
  );
}
