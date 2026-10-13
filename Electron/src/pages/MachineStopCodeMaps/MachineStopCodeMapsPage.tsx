// =============================================================================
// DURUŞ KODU EŞLEME — Tanımlar › Duruş Kodu Eşleme (`/definitions/machine-stop-codes`, makine duruşu D5)
// =============================================================================
// Kartın bildirdiği ham kod → duruş sebebi. Çözüm sırası: tezgah üst-yazımı > kart tipi geneli > sebepsiz
// (K4: sebepsiz alarm ayarı). Eşleme yalnız YENİ duruşu etkiler; geçmiş duruşun sebebi donmuştur.
// Pasife alma silme değildir. Kapı: route `loom:spec-manage` + `ROUTE_MODULE` (tezgah).
// =============================================================================
import { CrudPage } from "@/components/layout/CrudPage";
import { buildCodeMapPayload } from "./code-map-model";
import { CodeMapFormDialog } from "./CodeMapFormDialog";
import { codeMapColumns } from "./columns";
import { machineStopCodeMapService } from "./service";
import type { MachineStopCodeMap } from "./types";

export function MachineStopCodeMapsPage() {
  return (
    <CrudPage<MachineStopCodeMap>
      title="Duruş Kodu Eşleme"
      description="Kartın bildirdiği ham duruş kodu hangi sebebe çözülsün — kart tipi geneli ya da tezgah üst-yazımı. Yalnız yeni duruşları etkiler."
      entityName="Kod Eşlemesi"
      queryKey="machine-stop-code-maps"
      service={machineStopCodeMapService}
      columns={codeMapColumns}
      writePermission="loom:spec-manage"
      searchPlaceholder="Kart tipi veya ham kod ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <CodeMapFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) => onSubmit(buildCodeMapPayload(values, initial) as Partial<MachineStopCodeMap>)}
        />
      )}
    />
  );
}
