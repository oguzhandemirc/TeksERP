// Tezgâh tanımı > Tahar (T2/T3): takılı tahar (son takılan işten otomatik; burada elle düzeltilir — seçim ANINDA
// ayrı uçtan kaydedilir, form gövdesine girmez) + kaynak/kim/ne zaman + "tahar değiştirmeden girebilen kumaşlar".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rows3 } from "lucide-react";
import { FormField } from "@/components/forms/FormField";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { formatFactory } from "@/lib/factory-time";
import { toastServerSuccess } from "@/lib/serverNotes";
import { drawingInPlanService } from "@/pages/DrawingInPlans/service";
import type { DrawingInPlan } from "@/pages/DrawingInPlans/types";
import { machineDrawingInApi, SOURCE_LABEL, type MachineDrawingInFit } from "@/pages/DrawingInPlans/machine-fit";

/** "otomatik · Ayşe · 28.11 14:05" — iz satırı; hiç yazılmadıysa null. */
export function mountTrail(m: MachineDrawingInFit["machine"]): string | null {
  if (!m.mountedDrawingInSource) return null;
  return [SOURCE_LABEL[m.mountedDrawingInSource], m.mountedDrawingInBy?.fullName, m.mountedDrawingInAt ? formatFactory(m.mountedDrawingInAt, "dd.MM.yyyy HH:mm") : null]
    .filter(Boolean)
    .join(" · ");
}

function FitItems({ fit }: { fit: MachineDrawingInFit }) {
  if (!fit.machine.mountedDrawingInPlan) {
    return <p className="text-xs text-muted-foreground">Takılı tahar bilinmiyor — levent takıldığında ya da koşum açıldığında kendiliğinden dolar.</p>;
  }
  if (fit.items.length === 0) return <p className="text-xs text-muted-foreground">Bu taharı kullanan başka kumaş yok.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {fit.items.map((i) => (
        <li key={i.id} className="rounded-badge border px-1.5 py-0.5 text-xs" title={i.planCode ?? undefined}>
          <span className="font-mono">{i.code}</span> <span className="text-muted-foreground">{i.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function MachineDrawingInSection({ machineId }: { machineId: string }) {
  const qc = useQueryClient();
  const key = ["drawing-in-plans", "machine-fit", machineId];
  const q = useQuery({ queryKey: key, queryFn: () => machineDrawingInApi.fit(machineId) });
  const save = useMutation({
    mutationFn: (planId: string | null) => machineDrawingInApi.setMounted(machineId, planId),
    onSuccess: (res) => {
      toastServerSuccess(res, "Takılı tahar güncellendi.");
      void qc.invalidateQueries({ queryKey: ["drawing-in-plans"] });
    },
  });
  const fit = q.data;
  const trail = fit ? mountTrail(fit.machine) : null;
  return (
    <div className="space-y-3 border-t pt-4" data-testid="machine-drawing-in">
      <FormField
        label="Takılı tahar"
        info="Tezgâhta şu an takılı tahar planı. Yeni tahar ya da çerçeve değişimiyle levent takılınca veya koşum açılınca işin kumaşından kendiliğinden gelir; düğümle takma taharı değiştirmez. Yanlışsa buradan düzeltin."
      >
        <EntityPickerModal<DrawingInPlan>
          value={fit?.machine.mountedDrawingInPlan?.id ?? null}
          onChange={(id) => save.mutate(id ?? null)}
          service={drawingInPlanService}
          queryKey="drawing-in-plans-machine"
          getLabel={(r) => r.name}
          getSubLabel={(r) => `${r.code} · ${r.frameCount} çerçeve · ${r.notation}`}
          icon={Rows3}
          nullable
          noneLabel="Bilinmiyor"
          title="Takılı taharı seç"
          placeholder="Takılı tahar bilinmiyor"
          disabled={!fit || save.isPending}
        />
      </FormField>
      {trail && <p className="text-xs text-muted-foreground" data-testid="machine-drawing-in-trail">Kaynak: {trail}</p>}
      {fit && (
        <div data-testid="machine-fit-items">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Tahar değiştirmeden girebilen kumaşlar</p>
          <FitItems fit={fit} />
        </div>
      )}
    </div>
  );
}
