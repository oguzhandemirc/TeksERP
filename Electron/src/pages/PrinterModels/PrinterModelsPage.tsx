import { CrudPage } from "@/components/layout/CrudPage";
import { printerModelColumns } from "./columns";
import { printerModelService } from "./service";
import { PrinterModelFormDialog } from "./PrinterModelFormDialog";
import { buildPrinterModelPayload } from "./schema";
import type { PrinterModel } from "./types";

/**
 * Yazıcı Modelleri — termal yazıcı kataloğu (Argox OS 214 plus vb.): DPI, max
 * baskı genişliği, dil (HTML/PPLA) + varsayılan format profili. Makine donanımı
 * bunlara referans tutar; yazıcı değişse de tanımlar burada kalıcı kalır.
 */
export function PrinterModelsPage() {
  return (
    <CrudPage<PrinterModel>
      title="Yazıcı Modelleri"
      description="Termal yazıcı kataloğu — DPI, max genişlik, dil (HTML/PPLA), varsayılan format profili."
      entityName="Yazıcı Modeli"
      queryKey="printer-models"
      service={printerModelService}
      columns={printerModelColumns}
      writePermission="station:write"
      searchPlaceholder="Model/üretici ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <PrinterModelFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildPrinterModelPayload(values) as Partial<PrinterModel>)}
        />
      )}
    />
  );
}
