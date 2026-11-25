import { CrudPage } from "@/components/layout/CrudPage";
import { warpSpecColumns } from "./columns";
import { warpSpecService } from "./service";
import { WarpSpecFormDialog } from "./WarpSpecFormDialog";
import { buildPayload, copyDraft } from "./payload";
import type { WarpSpec } from "./types";

export function WarpSpecsPage() {
  return (
    <CrudPage<WarpSpec>
      title="Çözgü Kartları"
      description="Çözgü tanımı: iplikler ve telleri · dizilim · tarak. Bir çözgü kartı birden çok deseni besler; levent bu karta göre sarılır."
      entityName="Çözgü kartı"
      queryKey="warp-specs"
      service={warpSpecService}
      columns={warpSpecColumns}
      writePermission="warpspec:write"
      searchHint="Kod veya ad"
      copyLabel="Örnek al (yeni kart)"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting, copyFrom }) => (
        <WarpSpecFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          draft={copyFrom ? copyDraft(copyFrom) : null}
          isSubmitting={isSubmitting}
          // `yarns` satır gövdesi WarpSpec tipinde yok (yazım sözleşmesi) — CrudPage Partial<T> bekler.
          onSubmit={(values) => onSubmit(buildPayload(values) as unknown as Partial<WarpSpec>)}
        />
      )}
    />
  );
}
