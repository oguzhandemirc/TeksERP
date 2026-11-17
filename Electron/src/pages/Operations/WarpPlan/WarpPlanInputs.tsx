// Çözgü Hesabı girdi şeridi: kart (modal) · devereci (modal, isteğe bağlı) · levent adedi × boy · sabit fire.
import { Handshake, Layers } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Input } from "@/components/ui/input";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import { fmtM, type WarpPlanState } from "./warp-plan-model";

interface Props {
  s: WarpPlanState;
  up: (patch: Partial<WarpPlanState>) => void;
  /** Sunucunun kullandığı ayar değeri (`devere.warpFixedWasteM`); henüz hesap yoksa null. */
  defaultFixedWasteM: number | null;
}

export function WarpPlanInputs({ s, up, defaultFixedWasteM }: Props) {
  const beams = s.mode === "FROM_BEAMS";
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <FormField label="Çözgü kartı" required>
        <EntityPickerModal<WarpSpec>
          value={s.warpSpecId}
          onChange={(id) => up({ warpSpecId: id })}
          service={warpSpecService}
          queryKey="warp-specs-plan-picker"
          getLabel={(w) => `${w.code} — ${w.name}`}
          getSubLabel={(w) => `${w.endsCount} tel`}
          icon={Layers}
          title="Çözgü kartı seç"
          placeholder="Çözgü kartı seç"
        />
      </FormField>
      <FormField label="Devereci" hint="Seçilirse o deverecide duran iplik de sayılır.">
        <EntityPickerModal<Subcontractor>
          value={s.subcontractorId}
          onChange={(id) => up({ subcontractorId: id })}
          service={subcontractorService}
          queryKey="subcontractors-warp-plan"
          getLabel={(x) => x.name}
          icon={Handshake}
          title="Devereci seç"
          placeholder="Seçilmedi"
          nullable
          noneLabel="Devereci yok"
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Levent adedi" htmlFor="wp-beam-count" required={beams} hint={beams ? undefined : "Bu yönde kullanılmaz."}>
          <Input id="wp-beam-count" inputMode="numeric" value={s.beamCount} disabled={!beams} onChange={(e) => up({ beamCount: e.target.value })} />
        </FormField>
        <FormField label="Levent boyu (m)" htmlFor="wp-beam-length" required={beams} hint={beams ? undefined : "İsteğe bağlı: kaç tam levent çıkar."}>
          <Input id="wp-beam-length" inputMode="decimal" value={s.beamLengthM} onChange={(e) => up({ beamLengthM: e.target.value })} />
        </FormField>
      </div>
      <FormField
        label="Sabit fire (m)"
        htmlFor="wp-fixed-waste"
        hint={`Baş/son/düğüm payı, hesabın tamamına bir kez. Boşsa ayar: ${defaultFixedWasteM === null ? "—" : `${fmtM(defaultFixedWasteM)} m`}.`}
      >
        <Input id="wp-fixed-waste" inputMode="decimal" value={s.fixedWasteM} placeholder="ayardan" onChange={(e) => up({ fixedWasteM: e.target.value })} />
      </FormField>
    </div>
  );
}
