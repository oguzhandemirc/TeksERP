import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageSearch } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScanField } from "@/components/scanner/ScanField";
import { useScanSeed } from "@/hooks/useScanSeed";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { packingService } from "./service";
import { OrderSelectionPanel } from "./OrderSelectionPanel";
import { PackingWorkspace } from "./PackingWorkspace";

/**
 * Çuval Düzelt / Paketleme istasyonu (tabanca-öncelikli). İki faz: (1) sevkiyat
 * yok → sipariş seç & başlat / devam et / top-çuval okut → sevkiyatına atla;
 * (2) sevkiyat seçili → paketleme/düzeltme workspace'i. Scan-anywhere overlay
 * `editShipmentId`/`focusBarcode` ile buraya tohumlar (useScanSeed).
 */
export function SackContentEditPage() {
  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [scanValue, setScanValue] = useState("");

  useScanSeed("editShipmentId", (id) => setShipmentId(id));

  const locateMut = useMutation({
    mutationFn: async (code: string) => {
      const { kind } = classifyBarcode(code);
      if (kind === "ROLL") {
        const res = await packingService.locateRoll(code);
        return res.data?.shipment?.id ?? null;
      }
      // SACK / UNKNOWN (serbest çuval kodu) → çuval koduyla sevkiyatı bul.
      if (kind === "SACK" || kind === "UNKNOWN") {
        return packingService.findShipmentIdBySackCode(code);
      }
      return null;
    },
    onSuccess: (id, code) => {
      if (id) setShipmentId(id);
      else toast.warning(`"${code}" bir sevkiyatla eşleşmedi. Sipariş seçip sevkiyat açın.`);
    },
  });

  // Scan-anywhere "Çuval içeriğini düzelt" → top barkodunu burada çözüp sevkiyata atla.
  useScanSeed("focusBarcode", (code) => locateMut.mutate(code));

  const handleScan = (code: string) => {
    locateMut.mutate(code);
    setScanValue("");
  };

  if (shipmentId) {
    return <PackingWorkspace shipmentId={shipmentId} onExit={() => setShipmentId(null)} />;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Çuval Düzelt / Paketleme"
        description="Top/çuval okut → sevkiyatını aç, ya da sipariş seçip paketlemeye başla. Çuvala top ekle/çıkar/taşı/takasla, tart, sevke hazırla."
      />

      <ScanField
        className="border-b px-6 py-3"
        value={scanValue}
        onChange={setScanValue}
        onScan={handleScan}
        placeholder="Top veya çuval barkodu okut → sevkiyatını aç"
        autoFocus
        submitLabel="Aç"
        busy={locateMut.isPending}
        busyLabel="Aranıyor…"
        widthClassName="max-w-md"
      />

      <div className="flex items-center gap-2 border-b bg-muted/30 px-6 py-1.5 text-xs text-muted-foreground">
        <PackageSearch className="h-3.5 w-3.5" />
        Okutulan top/çuval bir sevkiyattaysa düzenleme açılır; değilse aşağıdan sipariş seçip yeni
        sevkiyat başlatın.
      </div>

      <div className="min-h-0 flex-1">
        <OrderSelectionPanel onStarted={setShipmentId} />
      </div>
    </div>
  );
}
