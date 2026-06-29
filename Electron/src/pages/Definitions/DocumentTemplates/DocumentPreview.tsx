import { ShipmentFrozenSheet } from "@/pages/Operations/Shipments/ShipmentFrozenSheet";
import { PrintableSheet } from "@/pages/Operations/WorkOrders/FasonSevkSheet";
import { PrintableCeki } from "@/pages/Operations/Kartela/KartelaCekiPrintDialog";
import type { DocSheetPreview } from "@/components/print/print-helpers";
import { MOCK_SHIPMENT, MOCK_FASON, MOCK_KARTELA } from "./previewMocks";

/**
 * Belge Şablonları canlı önizlemesi — gerçek belge "sheet" bileşenini örnek
 * veriyle, taslak ayarı (preview override) ile render eder. Kaydetmeden, anlık.
 * Etiket önizlemesinin (iframe + backend HTML) belge eşi; ama client-side.
 */
export function DocumentPreview({
  docKey,
  preview,
}: {
  docKey: string;
  preview: DocSheetPreview;
}) {
  const sheet =
    docKey === "shipmentDispatch" ? (
      <ShipmentFrozenSheet doc={MOCK_SHIPMENT} preview={preview} />
    ) : docKey === "fasonSevk" ? (
      <PrintableSheet snap={MOCK_FASON} preview={preview} />
    ) : docKey === "kartelaCeki" ? (
      <PrintableCeki doc={MOCK_KARTELA} preview={preview} />
    ) : null;

  return (
    <div className="rounded-md border bg-muted/30">
      <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Önizleme — örnek veri
      </div>
      <div className="max-h-[70vh] overflow-auto p-4">
        {sheet ?? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Bu belge için önizleme yok.
          </div>
        )}
      </div>
    </div>
  );
}
