// Tahar planı formu (Tanımlar ekranı + ürün kartı seçicisi ortak): ad · çerçeve sayısı · tahar dizisi (düğme + metin)
// · kenar taharı · not; sağda canlı tel→çerçeve önizlemesi. Kod seriden doğar (THR-…), formda sorulmaz.
import { useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { DRAWING_IN_FRAMES_DEFAULT_MAX, parseDrawingInNotation } from "@/components/weave/drawing-in-plan";
import { DrawingInSequenceEditor } from "./DrawingInSequenceEditor";
import { DrawingInPreview } from "./DrawingInPreview";
import { drawingInPlanSchema, formDefaults, toPayload, type DrawingInPlanFormValues } from "./schema";
import type { DrawingInPlan, DrawingInPlanInput } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: DrawingInPlan | null;
  /** "Örnek al": kaynağın kimliksiz kopyası — kayıt OLUŞTURMA olarak gider, kaynak değişmez. */
  draft?: Partial<DrawingInPlan> | null;
  onSubmit: (body: DrawingInPlanInput) => void | Promise<void>;
  isSubmitting?: boolean;
}

function LivePreview({ form }: { form: UseFormReturn<DrawingInPlanFormValues> }) {
  const r = parseDrawingInNotation(form.watch("notation"));
  const frames = form.watch("frameCount");
  if (!r.ok) return <p className="text-sm text-muted-foreground">Tahar dizisi girildikçe çerçeve çizimi burada görünür.</p>;
  return <DrawingInPreview frameCount={frames} threading={r.sequence} />;
}

export function DrawingInPlanFormDialog({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }: Props) {
  const flags = useFeatureFlags();
  const maxFrames = flags.data?.data?.dokumaDrawingInMaxFrames ?? DRAWING_IN_FRAMES_DEFAULT_MAX;
  const schema = useMemo(() => drawingInPlanSchema(maxFrames), [maxFrames]);
  return (
    <EntityFormDialog<DrawingInPlanFormValues>
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title={initial ? `Tahar Planını Düzenle — ${initial.code}` : draft ? "Yeni Tahar Planı (örnekten)" : "Yeni Tahar Planı"}
      description="Çözgü tellerinin çerçevelerden geçiş sırası. Bir tahar planı birden çok kumaşta kullanılabilir."
      schema={schema}
      defaultValues={initial ? formDefaults(initial) : formDefaults(draft ?? null, !!draft)}
      onSubmit={(v) => onSubmit(toPayload(v))}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <FormField label="Tahar planı adı" required htmlFor="dip-name" error={form.formState.errors.name}>
                <Input id="dip-name" maxLength={100} placeholder="Düz 4 çerçeve" {...form.register("name")} />
              </FormField>
              <FormField
                label="Çerçeve sayısı"
                required
                htmlFor="dip-frames"
                error={form.formState.errors.frameCount}
                info={`Tezgâhta bu tahar için kullanılan çerçeve (gücü) sayısı. Firma ayarına göre en çok ${maxFrames}.`}
              >
                <Input id="dip-frames" type="number" min={1} max={maxFrames} {...form.register("frameCount", { valueAsNumber: true })} />
              </FormField>
            </div>
            <DrawingInSequenceEditor form={form} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Kenar taharı"
                htmlFor="dip-selvedge"
                error={form.formState.errors.selvedgeThreading}
                info="Kenar tellerinin çerçeve dizisi (isteğe bağlı). Zemin taharından ayrı tutulur; aynı kısaltma kullanılabilir."
              >
                <Input id="dip-selvedge" className="font-mono" maxLength={500} placeholder="2x(1-2)" {...form.register("selvedgeThreading")} />
              </FormField>
              <FormField label="Not" htmlFor="dip-notes" error={form.formState.errors.notes}>
                <Textarea id="dip-notes" rows={2} maxLength={500} {...form.register("notes")} />
              </FormField>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Önizleme</p>
            <LivePreview form={form} />
          </div>
        </div>
      )}
    </EntityFormDialog>
  );
}
