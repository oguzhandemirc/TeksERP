import { useEffect, useState } from "react";
import { Controller, useForm, type Control, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { TargetItemPicker } from "@/pages/Operations/WorkOrders/TargetItemPicker";
import { RouteEditor } from "@/pages/Operations/WorkOrders/RouteEditor";
import { useFoldValues } from "@/hooks/useFoldValues";
import { useDesignerSteps } from "@/pages/Operations/WorkOrders/useDesignerSteps";
import {
  routeStepsToCreatePayload,
  type RouteStepTargetPlan,
} from "@/pages/Operations/WorkOrders/workOrderPrefill";
import type { WorkOrderFormValues } from "@/pages/Operations/WorkOrders/schema";
import {
  recipeFormDefaults,
  recipeFormSchema,
  type RecipeFormValues,
} from "./schema";
import type { ProductRecipe } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ProductRecipe | null;
  onSubmit: (values: RecipeFormValues) => Promise<void>;
  isSubmitting?: boolean;
}

function buildDefaults(initial?: ProductRecipe | null): RecipeFormValues {
  if (!initial) return recipeFormDefaults;
  return {
    name: initial.name,
    targetItemId: initial.itemId,
    targetColorId: initial.colorId,
    targetPropertyIds: (initial.properties ?? []).map((p) => p.propertyId),
    routeTemplateId: initial.routeId ?? "",
    width: initial.width,
    foldType: initial.foldType ?? "",
    isActive: initial.isActive,
  };
}

export function ProductRecipeFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(initial);
  const qc = useQueryClient();
  const { values: foldValues, isEmpty: foldNotConfigured } = useFoldValues();
  const form = useForm<RecipeFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(recipeFormSchema as any) as unknown as Resolver<RecipeFormValues>,
    defaultValues: buildDefaults(initial),
  });

  // İş emri modalındaki aynı inline rota editörü.
  const {
    steps: routeSteps,
    reset: resetRouteSteps,
    addStep,
    removeStep,
    moveStep,
    reorder: reorderSteps,
    updateStep,
    seedFromRoute,
    handleStationPick,
  } = useDesignerSteps([]);
  const [seededRouteId, setSeededRouteId] = useState<string | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaults(initial));
    setRouteError(null);
    if (initial?.routeId) {
      void seedFromRoute(initial.routeId);
      setSeededRouteId(initial.routeId);
    } else {
      resetRouteSteps([]);
      setSeededRouteId(null);
    }
    setRouteDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Akış değişince rota validasyon hatasını temizle.
  useEffect(() => {
    setRouteError(null);
  }, [routeSteps]);

  // Hedef kumaş/renk picker'ları WorkOrderFormValues'a tipli — alan adları aynı.
  const woControl = form.control as unknown as Control<WorkOrderFormValues>;

  const createRouteFromSteps = async (
    name: string,
    stepTargets?: Map<string, RouteStepTargetPlan>,
  ): Promise<string> => {
    const res = await routeService.create({
      name: `${name} rotası`,
      // Kod backend'de üretilir (ROT+GGAAYY+NNNN) — istemci göndermez.
      isActive: true,
      isFavorite: false,
      // Saha #14: fason planlaması (kategori + firma) KORUNMALI. Eskiden buradaki
      // inline map yalnız stationId/sequence/defaultNotes gönderiyordu → İş Emri
      // Şablonu'na seçilen fason firma DÜŞÜYORDU (rota tekrar uygulanınca boş
      // geliyordu). routeStepsToCreatePayload = WO formuyla tek ortak kaynak.
      steps: routeStepsToCreatePayload(routeSteps, stepTargets),
    } as unknown as Partial<ProductionRoute>);
    return (res.data as { id: string }).id;
  };

  // "Rotayı Kaydet" — açıkça bir rota şablonu üretir, o yüzden şablon hedefi de
  // yazılır. Reçetenin KENDİ rotası (handleSubmit) hedefsiz kalır: hedef zaten
  // reçetede saklanıyor, rotaya da yazmak aynı bilgiyi iki yere kopyalardı.
  const saveTemplateMut = useMutation({
    mutationFn: (params: { name: string; stepTargets: Map<string, RouteStepTargetPlan> }) =>
      createRouteFromSteps(params.name, params.stepTargets),
    onSuccess: () => {
      toast.success("Rota şablonu kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  const handleSeedRoute = (routeId: string | null) => {
    if (routeId) {
      void seedFromRoute(routeId);
      setSeededRouteId(routeId);
    } else {
      resetRouteSteps([]);
      setSeededRouteId(null);
    }
    setRouteDirty(false);
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!values.targetItemId) {
      form.setError("targetItemId", { type: "manual", message: "Kumaş seçilmeli." });
      return;
    }
    if (routeSteps.length > 0 && routeSteps.some((s) => !s.stationId)) {
      setRouteError("Her adıma istasyon seç (ya da boş adımı sil).");
      return;
    }
    // Akış değişmemiş tohumsa mevcut rotayı referansla; değişmiş/yeni ise oluştur.
    let routeId: string | null = null;
    if (routeSteps.length > 0) {
      routeId =
        seededRouteId && !routeDirty
          ? seededRouteId
          : await createRouteFromSteps(values.name);
    }
    await onSubmit({ ...values, routeTemplateId: routeId ?? "" });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "İş Emri Şablonunu Düzenle" : "Yeni İş Emri Şablonu"}</DialogTitle>
          <DialogDescription>
            Kumaş + akış (renk/özellik istasyonlarda) + en'i tek isim altında topla.
            İş emri açılışında şablonu seçince hepsi otomatik dolar.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isEdit && initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" autoFocus placeholder="Patos Gri 038" {...form.register("name")} />
              {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir. */}
              <SimilarNamesWarning
                entity="product-recipes"
                name={form.watch("name") ?? ""}
                excludeId={initial?.id}
              />
            </FormField>
            <FormField label="Hedef Kumaş" required error={form.formState.errors.targetItemId}>
              <TargetItemPicker
                control={woControl}
                use="definition"
                onItemChange={() => {
                  form.setValue("targetColorId", null);
                  form.setValue("targetPropertyIds", []);
                }}
              />
            </FormField>
          </div>

          {/* İş emri modalındaki rota editörünün aynısı */}
          <RouteEditor
            steps={routeSteps}
            onAdd={() => {
              addStep();
              setRouteDirty(true);
            }}
            onRemove={(id) => {
              removeStep(id);
              setRouteDirty(true);
            }}
            onMove={(id, dir) => {
              moveStep(id, dir);
              setRouteDirty(true);
            }}
            onReorder={(a, b) => {
              reorderSteps(a, b);
              setRouteDirty(true);
            }}
            onPickStation={(id, sid) => {
              void handleStationPick(id, sid);
              setRouteDirty(true);
            }}
            onSetNotes={(id, notes) => {
              updateStep(id, { notes });
              setRouteDirty(true);
            }}
            onSetFirm={(id, patch) => updateStep(id, patch)}
            onSeed={handleSeedRoute}
            onSaveTemplate={(name, _forCustomer, stepTargets) =>
              saveTemplateMut.mutate({ name, stepTargets })
            }
            savePending={saveTemplateMut.isPending}
            customerId={null}
            target={{
              colorId: form.watch("targetColorId") ?? null,
              propertyIds: form.watch("targetPropertyIds") ?? [],
              onColor: (id) => form.setValue("targetColorId", id),
              onProperties: (ids) => form.setValue("targetPropertyIds", ids),
            }}
            error={routeError ?? undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField label="En (cm)" htmlFor="width" error={form.formState.errors.width}>
              <Input
                id="width"
                type="number"
                step="0.1"
                min={0}
                placeholder="150"
                {...form.register("width")}
              />
            </FormField>
            <FormField label="Kat Tipi (opsiyonel)">
              <Controller
                control={form.control}
                name="foldType"
                render={({ field }) => (
                  <div className="space-y-1.5">
                    {/* Seçenekler KATALOGDAN (2026-08-10) — sabit iki tuş, fabrikanın
                        panelden eklediği 6-KAT'ı sessizce yok sayardı. */}
                    <div className="flex flex-wrap gap-2">
                      {foldValues.map((opt) => {
                        const active = field.value === opt.code;
                        return (
                          <Button
                            key={opt.code}
                            type="button"
                            variant={active ? "default" : "outline"}
                            onClick={() => field.onChange(active ? "" : opt.code)}
                          >
                            {opt.name}
                          </Button>
                        );
                      })}
                    </div>
                    {foldNotConfigured && (
                      <p className="text-xs text-muted-foreground">
                        Kat değeri tanımlı değil (Tanımlar → Kumaş Özellikleri → KAT).
                      </p>
                    )}
                  </div>
                )}
              />
            </FormField>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
