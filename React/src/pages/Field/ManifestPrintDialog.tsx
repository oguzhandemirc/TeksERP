import { useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { workOrderTypeLabels, type WorkOrderType } from "@/types/enums";

interface ManifestData {
  batchNumber: string;
  type: string;
  width?: number;
  recipeNo?: string;
  totalRolls: number;
  totalMeterage: number;
  totalWeight: number;
  destination?: {
    stationCode: string;
    stationName: string;
  };
  rolls: Array<{
    barcode: string;
    itemName: string;
    currentQty: number;
    weightKg?: number;
    status: string;
  }>;
  isSnapshot?: boolean;
  manifestNo?: string;
  printedAt?: string;
}

interface ManifestPrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifestData: Record<string, unknown>;
  workOrderId: string;
}

export default function ManifestPrintDialog({
  open,
  onOpenChange,
  manifestData,
  workOrderId,
}: ManifestPrintDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const data = manifestData as unknown as ManifestData;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Çeki Listesi - ${data.batchNumber}</title>
          <style>
            @media print {
              body { margin: 0; padding: 10px; font-family: Arial, sans-serif; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #ddd; padding: 6px; text-align: left; font-size: 12px; }
              th { background: #f5f5f5; }
              .header { margin-bottom: 20px; }
              .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
              .info-item { background: #f9f9f9; padding: 8px; border-radius: 4px; }
              .info-label { font-size: 10px; color: #666; }
              .info-value { font-size: 14px; font-weight: bold; }
              tfoot { font-weight: bold; background: #f5f5f5; }
            }
          </style>
        </head>
        <body>
          ${printRef.current?.innerHTML}
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Boyahane Çeki Listesi
          </DialogTitle>
        </DialogHeader>

        {/* Print Area */}
        <div
          ref={printRef}
          className="bg-white text-black border rounded-lg p-4"
        >
          {/* Header */}
          <div className="text-center mb-6 border-b pb-4">
            <h2 className="text-xl font-bold">BOYAHANE ÇEKI LİSTESİ</h2>
            <p className="text-sm text-gray-600 mt-1">
              Parti No: <strong>{data.batchNumber}</strong>
            </p>
            {data.isSnapshot && data.manifestNo && (
              <p className="text-xs text-gray-500 mt-1">
                Belge: <strong>{data.manifestNo}</strong>
                {data.printedAt && (
                  <> · {new Date(data.printedAt).toLocaleString("tr-TR")}</>
                )}
              </p>
            )}
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 p-3 rounded">
              <div className="text-xs text-gray-500">Tip</div>
              <div className="font-semibold">{workOrderTypeLabels[data.type as WorkOrderType] ?? data.type}</div>
            </div>
            {data.width && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">En (cm)</div>
                <div className="font-semibold">{data.width}</div>
              </div>
            )}
            {data.recipeNo && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Reçete No</div>
                <div className="font-semibold">{data.recipeNo}</div>
              </div>
            )}
            {data.destination && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-xs text-gray-500">Hedef İstasyon</div>
                <div className="font-semibold">
                  {data.destination.stationCode} - {data.destination.stationName}
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-blue-50 p-3 rounded text-center">
              <div className="text-2xl font-bold">{data.totalRolls}</div>
              <div className="text-xs text-gray-600">Top Sayısı</div>
            </div>
            <div className="bg-green-50 p-3 rounded text-center">
              <div className="text-2xl font-bold">{data.totalMeterage.toFixed(2)}</div>
              <div className="text-xs text-gray-600">Toplam Metre</div>
            </div>
            <div className="bg-orange-50 p-3 rounded text-center">
              <div className="text-2xl font-bold">{data.totalWeight.toFixed(2)}</div>
              <div className="text-xs text-gray-600">Toplam Kg</div>
            </div>
          </div>

          {/* Table */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2 text-left text-xs">Barkod</th>
                <th className="border p-2 text-left text-xs">Ürün</th>
                <th className="border p-2 text-right text-xs">Metraj (mt)</th>
                <th className="border p-2 text-right text-xs">Ağırlık (kg)</th>
              </tr>
            </thead>
            <tbody>
              {data.rolls?.map((roll, idx) => (
                <tr key={idx}>
                  <td className="border p-2 text-xs font-mono">{roll.barcode}</td>
                  <td className="border p-2 text-xs">{roll.itemName}</td>
                  <td className="border p-2 text-xs text-right">{roll.currentQty.toFixed(2)}</td>
                  <td className="border p-2 text-xs text-right">{roll.weightKg?.toFixed(2) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div className="mt-6 pt-4 border-t text-center text-xs text-gray-500">
            <p>Tarih: {new Date().toLocaleDateString("tr-TR")} - {new Date().toLocaleTimeString("tr-TR")}</p>
            <p className="mt-1">TeksERP - Otomatik Oluşturuldu</p>
          </div>
        </div>

        {/* Actions */}
        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            Kapat
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}