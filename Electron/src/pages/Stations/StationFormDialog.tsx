import { Controller } from "react-hook-form";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { stationTypeLabels, StationType, type StationKind } from "@/types/enums";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { SubcontractorCategory } from "@/pages/SubcontractorCategories/types";
import { useDevereEnabled, useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { stationFormDefaults, stationFormSchema, type StationFormValues } from "./schema";
import { visibleStationKindLabels } from "./stationKindVisibility";
import { inspectionHintForKind, suggestedCapabilities, valuesAfterKindChange } from "./stationKindDefaults";
import { StationLabelCopiesField } from "./StationLabelCopiesField";

const CAPABILITY_FIELDS = ["appliesColor", "appliesProperty", "appliesQuality", "inspectionEnabled", "producesWarpBeam", "consumesWarpBeam"] as const;
import type { Station } from "./types";

import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Station | null;
  onSubmit: (values: StationFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function StationFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  // WEAVING türü yalnız dokuma modülü açıkken seçilebilir (mevcut değer korunur).
  const dokumaEnabled = useDokumaEnabled();
  // Devere yetenek kutuları yalnız devere modülü açıkken çizilir (kapalıyken form BİREBİR eski).
  const devereEnabled = useDevereEnabled();
  const defaults: StationFormValues = initial
    ? {
        name: initial.name,
        type: initial.type,
        kind: initial.kind,
        department: initial.department ?? "",
        isActive: initial.isActive,
        appliesColor: initial.appliesColor ?? false,
        appliesProperty: initial.appliesProperty ?? true,
        appliesQuality: initial.appliesQuality ?? false,
        inspectionEnabled: initial.inspectionEnabled ?? false,
        producesWarpBeam: initial.producesWarpBeam ?? false,
        consumesWarpBeam: initial.consumesWarpBeam ?? false,
        capturesWidth: initial.capturesWidth ?? false,
        defaultLabelCopies: initial.defaultLabelCopies ?? null,
        defaultCategoryId: initial.defaultCategoryId ?? null,
      }
    : // Yeni kayıt: yetenek kutuları ön-seçili türün ÖNERİSİYLE açılır (`stationKindDefaults.ts`).
      { ...stationFormDefaults, ...suggestedCapabilities(stationFormDefaults.kind) };

  return (
    <EntityFormDialog<StationFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "İstasyonu Düzenle" : "Yeni İstasyon"}
      schema={stationFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}
          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus {...form.register("name")} />
            {/* Mükerreri REDDETMEK yerine ÖNLEMEK — yazarken benzerleri gösterir. */}
            <SimilarNamesWarning
              entity="stations"
              name={form.watch("name") ?? ""}
              excludeId={initial?.id}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tip" error={form.formState.errors.type} required>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <EnumSelect<StationType>
                    value={field.value}
                    onChange={field.onChange}
                    labels={stationTypeLabels}
                  />
                )}
              />
            </FormField>
            <FormField label="Görev Türü" error={form.formState.errors.kind} required>
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <EnumSelect<StationKind>
                    value={field.value}
                    onChange={(kind) => {
                      // Tür değişince yetenek kutuları o türün ÖNERİSİNE gelir — yalnız YENİ kayıtta;
                      // düzenlemede mevcut istasyonun yetenekleri sessizce ezilmez (öneri, kilit değil).
                      field.onChange(kind);
                      const next = valuesAfterKindChange(form.getValues(), kind, !!initial);
                      for (const k of CAPABILITY_FIELDS) form.setValue(k, next[k], { shouldDirty: true });
                    }}
                    labels={visibleStationKindLabels({ dokumaEnabled, devereEnabled }, field.value) as Record<StationKind, string>}
                  />
                )}
              />
            </FormField>
          </div>
          <FormField label="Departman" htmlFor="department" error={form.formState.errors.department}>
            <Input id="department" placeholder="DOKUMA, TERBIYE..." {...form.register("department")} />
          </FormField>
          {form.watch("type") === StationType.EXTERNAL && (
            <FormField
              label="Varsayılan Fason Kategorisi"
              error={form.formState.errors.defaultCategoryId}
              hint="Terbiye iş emri oluşturulurken fason planlama modalında otomatik önerilir."
            >
              <Controller
                control={form.control}
                name="defaultCategoryId"
                render={({ field }) => (
                  <ReferenceSelect<SubcontractorCategory>
                    value={field.value}
                    onChange={field.onChange}
                    service={subcontractorCategoryService}
                    queryKey="subcontractor-categories"
                    getLabel={(c) => c.name}
                    placeholder="Kategori seç..."
                    nullable
                    noneLabel="— Atanmadı"
                  />
                )}
              />
            </FormField>
          )}
          {/* YETENEKLER — HER TİPTE görünür (2026-08-10). Eskiden bu soruların
              cevabı yalnız fason kategorisinden türetiliyordu, dolayısıyla
              kategorisi olmayan bir İÇ istasyon tanım gereği "renk veremez"di.
              İç boyahane/iç zımpara senaryosunun önündeki engel buydu.
              ⚠️ Renk varsayılanı KAPALI: açık gelirse Tambur/Kurşun adımlarına
              renk atanabilir hale gelir (2026-08-06 uyarısı). */}
          <FormField
            label="Yetenekler"
            hint="Bu istasyondan geçen topa ne uygulanabilir? Renk/özellikte fason istasyonlarda KATEGORİ de verebilir — ikisinden biri yeterlidir. Muayenede ve kart akışında kategori karşılığı YOKTUR: yalnız bu kutular belirler."
          >
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("appliesColor")} /> Renk uygular
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("appliesProperty")} /> Özellik uygular
              </label>
              {/* ⚠️ Kutu HER görev türünde görünür — gizli kural icat edilmez; etkisi
                  türe göre ipucunda söylenir (KQ-D8). Akış kutusu (`appliesQuality`) ayrı soru. */}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("inspectionEnabled")} /> Kalite muayenesi (hata girişi)
              </label>
              <p className="-mt-1 pl-6 text-xs text-muted-foreground" data-testid="inspection-hint">
                {inspectionHintForKind(form.watch("kind") as StationKind)}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...form.register("appliesQuality")} /> Ara istasyon kart akışı
                (Kurşun/KK2 ekranı)
                <span className="text-xs text-muted-foreground">— Yalnız Ara istasyon türünde etkili</span>
              </label>
              {devereEnabled && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...form.register("producesWarpBeam")} /> Levent sarar (devere makineleri)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...form.register("consumesWarpBeam")} /> Levent tüketir (tezgah / raşel — levent yuvaya takılır)
                  </label>
                </>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid="station-captures-width" {...form.register("capturesWidth")} /> En ölçer
              </label>
              <p className="-mt-1 pl-6 text-xs text-muted-foreground">
                Tablette top bitişinde isteğe bağlı &quot;Ölçülen en (cm)&quot; alanı çıkar (ör. etek kesim). Boş bırakılırsa topun eni değişmez.
              </p>
            </div>
          </FormField>
          <StationLabelCopiesField form={form} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>
        </>
      )}
    </EntityFormDialog>
  );
}
