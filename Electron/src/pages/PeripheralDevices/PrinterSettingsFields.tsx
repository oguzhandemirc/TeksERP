import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Button } from "@/components/ui/button";
import { LabelFormatProfileFormDialog } from "@/pages/LabelFormatProfiles/LabelFormatProfileFormDialog";
import { buildLabelFormatProfilePayload } from "@/pages/LabelFormatProfiles/schema";
import { labelFormatProfileService } from "@/pages/LabelFormatProfiles/service";
import type { LabelFormatProfile } from "@/pages/LabelFormatProfiles/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { PRINTER_LANGUAGE_LABELS } from "@/services/featureFlagService";
import { labelTemplateService } from "@/services/labelTemplateService";
import { TemplateVariantHint } from "./TemplateVariantHint";
import type { PeripheralFormValues } from "./schema";
import type { RouteLabelKind } from "./types";

const SELECT_CLS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const LANGS = ["RASTER_HTML", "PPLA", "PPLB", "ZPL"] as const;

// Yönlendirme BAĞLAMLARI sabittir (ham/bitmiş/kartela) — ama şablon seçimi tek
// havuzun TAMAMINDAN yapılır (Etiket Stüdyosu v2; LabelTemplate.kind yalnız
// legacy bilgi, filtre değil). Boyut uyumu varyant hint'i ile gösterilir.
const ROUTE_KINDS: {
  key: RouteLabelKind;
  label: string;
  field: "templateRawId" | "templateFinishedId" | "templateSwatchId";
}[] = [
  { key: "ROLL_RAW", label: "Ham Top (KK1)", field: "templateRawId" },
  { key: "ROLL_FINISHED", label: "Bitmiş Top (Tambur)", field: "templateFinishedId" },
  { key: "SWATCH", label: "Kartela", field: "templateSwatchId" },
];

interface Props {
  form: UseFormReturn<PeripheralFormValues>;
}

/** Yazıcı-özel alanlar: dil (zorunlu) + format profili (hızlı ekle/düzenle) +
 *  bağlam→şablon yönlendirmesi. Yalnız kind=LABEL_PRINTER iken render edilir. */
export function PrinterSettingsFields({ form }: Props) {
  // Hızlı profil ekleme/düzenleme — formu terk etmeden oluştur (otomatik seç)
  // veya seçili profili düzenle. Edit için profil nesnesi listeden çözülür.
  const qc = useQueryClient();
  const [profileDialog, setProfileDialog] = useState<
    { mode: "create" } | { mode: "edit"; profile: LabelFormatProfile } | null
  >(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const profilesQuery = useQuery({
    queryKey: ["label-format-profiles", "device-form"],
    queryFn: () => loadAllForPicker(labelFormatProfileService),
  });
  const profiles = profilesQuery.data?.data ?? [];

  // Şablon yönlendirme select'leri için TEK HAVUZ — aktif şablonların tamamı.
  const templatesQuery = useQuery({
    queryKey: ["label-templates", "all"],
    queryFn: () => labelTemplateService.list(),
  });
  const templates = templatesQuery.data?.data ?? [];

  const selProfileId = form.watch("formatProfileId");
  const selProfile = profiles.find((pr) => pr.id === selProfileId) ?? null;
  // Varyant uyumsuzluk hint'i için profil medya boyutu (Decimal → Number).
  const profileSize = selProfile
    ? { widthMm: Number(selProfile.widthMm), heightMm: Number(selProfile.heightMm) }
    : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3">
        <FormField label="Dil" error={form.formState.errors.languageOverride} required>
          <select className={SELECT_CLS} {...form.register("languageOverride")}>
            <option value="">Dil seçin...</option>
            {LANGS.map((l) => (
              <option key={l} value={l}>{PRINTER_LANGUAGE_LABELS[l]}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Format Profili" hint="Boş bırak → sistem varsayılan profili.">
          <div className="flex gap-1.5">
            <div className="min-w-0 flex-1">
              <Controller
                control={form.control}
                name="formatProfileId"
                render={({ field }) => (
                  <ReferenceSelect<LabelFormatProfile>
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? "")}
                    service={labelFormatProfileService}
                    queryKey="label-format-profiles"
                    getLabel={(p) => `${p.code} — ${p.name}`}
                    placeholder="Profil seç..."
                    nullable
                    noneLabel="Varsayılan — sistem profili"
                  />
                )}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              title={selProfile ? `"${selProfile.code}" profilini düzenle` : "Önce bir profil seçin"}
              disabled={!selProfile}
              onClick={() => selProfile && setProfileDialog({ mode: "edit", profile: selProfile })}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="Yeni format profili ekle"
              onClick={() => setProfileDialog({ mode: "create" })}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </FormField>
      </div>

      {/* Hızlı profil ekle/düzenle — iç dialog portal'a taşınır ama React ağacında
          bu formun içinde: submit'i dış cihaz formuna SIZDIRMA (stopPropagation). */}
      <div onSubmit={(e) => e.stopPropagation()}>
        <LabelFormatProfileFormDialog
          open={Boolean(profileDialog)}
          onOpenChange={(o) => !o && setProfileDialog(null)}
          initial={profileDialog?.mode === "edit" ? profileDialog.profile : null}
          isSubmitting={savingProfile}
          onSubmit={async (values) => {
            setSavingProfile(true);
            try {
              const payload = buildLabelFormatProfilePayload(values) as Partial<LabelFormatProfile>;
              if (profileDialog?.mode === "edit") {
                await labelFormatProfileService.update(profileDialog.profile.id, payload);
                toast.success("Format profili güncellendi.");
              } else {
                const res = await labelFormatProfileService.create(payload);
                const id = (res.data as LabelFormatProfile | null)?.id;
                if (id) form.setValue("formatProfileId", id, { shouldDirty: true });
                toast.success("Format profili eklendi ve bu yazıcı için seçildi.");
              }
              await qc.invalidateQueries({ queryKey: ["label-format-profiles"] });
              setProfileDialog(null);
            } finally {
              setSavingProfile(false);
            }
          }}
        />
      </div>

      {/* Şablon yönlendirme (bağlam-başına; boş → bağlam varsayılanı). Her select
          havuzun TAMAMINI listeler; pasif şablon yalnız hâlâ seçiliyse görünür
          (eski kaydın round-trip'i bozulmasın). */}
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Şablon Yönlendirme (boş → bağlam varsayılanı)
        </div>
        <div className="grid grid-cols-1 gap-2">
          {ROUTE_KINDS.map((r) => {
            const selTemplateId = form.watch(r.field);
            return (
              <FormField key={r.key} label={r.label}>
                <select className={SELECT_CLS} {...form.register(r.field)}>
                  <option value="">— (varsayılan)</option>
                  {templates
                    .filter((t) => t.isActive || t.id === selTemplateId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
                <TemplateVariantHint templateId={selTemplateId} profile={profileSize} />
              </FormField>
            );
          })}
        </div>
      </div>
    </>
  );
}
