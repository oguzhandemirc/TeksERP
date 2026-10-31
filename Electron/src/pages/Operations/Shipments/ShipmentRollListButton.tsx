import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { shipmentService } from "./service";
import { buildRollListSheet, rollListFileName } from "./rollListExport";

/** Sevkiyat detayı — "Top listesi (Excel)" (D4-J6). Uç sevkiyat okuma izniyle açılır. */
export function ShipmentRollListButton({ shipmentId }: { shipmentId: string }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const res = await shipmentService.getRollList(shipmentId);
      if (!res.data) throw new Error("liste yok");
      const blob = await buildWorkbook([buildRollListSheet(res.data)]);
      await saveWorkbook(blob, rollListFileName(res.data.shipmentNo, res.data.frozen, res.data.voided === true));
    } catch {
      toast.error("Top listesi oluşturulamadı");
    } finally {
      setBusy(false);
    }
  };
  return (
    <PermissionGate anyOf={["shipping:read", "shipping:write"]}>
      <Button type="button" size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => void onClick()}>
        <FileSpreadsheet className="h-3.5 w-3.5" /> Top listesi (Excel)
      </Button>
    </PermissionGate>
  );
}
