import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import type { DirectShipmentDetail } from "./types";
import { buildDirectRollListSheet, directRollListFileName } from "./directRollListExport";

/** Fasondan sevk detayı — "Top listesi (Excel)" (D4-KUC3a). Ekrandaki yanıtın aynısından üretilir; ek istek yok. */
export function DirectShipmentRollListButton({ detail }: { detail: DirectShipmentDetail }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const blob = await buildWorkbook([buildDirectRollListSheet(detail)]);
      await saveWorkbook(blob, directRollListFileName(detail.shipmentNo));
    } catch {
      toast.error("Top listesi oluşturulamadı");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" className="w-full gap-1.5" disabled={busy} onClick={() => void onClick()}>
      <FileSpreadsheet className="h-4 w-4" /> Top listesi (Excel)
    </Button>
  );
}
