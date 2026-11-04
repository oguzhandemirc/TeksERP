import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportRowsToXlsx } from "@/lib/list-export";
import { exportListName } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";
import { flattenOrderLines, orderLineExportColumns } from "./order-lines-export";
import type { Order } from "./types";

/**
 * "Kalem bazında Excel": süzgece uyan TÜM siparişler (`fetchAll`, liste ucuyla aynı where)
 * kaleme açılır — her kalem bir satır. Liste Excel'i sipariş başına tek satırdır.
 */
export function OrderLinesExportButton(props: {
  fetchAll: (onProgress?: (loaded: number, total?: number) => void) => Promise<Order[]>;
  pricingEnabled: boolean;
  productionEnabled: boolean;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const range = useExportRange();

  const run = async () => {
    if (progress !== null) return;
    setProgress("Hazırlanıyor…");
    try {
      const orders = await props.fetchAll((loaded, total) =>
        setProgress(
          `${loaded.toLocaleString("tr-TR")}${total ? ` / ~${total.toLocaleString("tr-TR")}` : ""} sipariş…`,
        ),
      );
      const rows = flattenOrderLines(orders);
      if (rows.length === 0) {
        toast.info("İndirilecek kalem yok.");
        return;
      }
      const cols = orderLineExportColumns(rows, props);
      await exportRowsToXlsx(cols, rows, exportListName("Sipariş Kalemleri", { range }));
    } catch {
      toast.error("İndirme hazırlanamadı.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      disabled={progress !== null}
      onClick={() => void run()}
      title="Süzgece uyan tüm siparişlerin her kalemi bir satır (kumaş, renk, miktar, sevk, kalan…)"
    >
      <FileSpreadsheet className="h-3.5 w-3.5" />
      {progress ?? "Kalem bazında Excel"}
    </Button>
  );
}
