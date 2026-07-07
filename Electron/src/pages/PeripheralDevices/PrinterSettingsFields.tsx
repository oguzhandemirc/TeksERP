import { type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
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

/** Yazıcı-özel alanlar: dil (zorunlu) + medya boyutu (mm/dpi — cihazda) +
 *  bağlam→şablon yönlendirmesi. Yalnız kind=LABEL_PRINTER iken render edilir.
 *  "Boyutlar" (LabelFormatProfile) kataloğu emekli — medya artık doğrudan burada. */
export function PrinterSettingsFields({ form }: Props) {
  // Şablon yönlendirme select'leri için TEK HAVUZ — aktif şablonların tamamı.
  const templatesQuery = useQuery({
    queryKey: ["label-templates", "all"],
    queryFn: () => labelTemplateService.list(),
  });
  const templates = templatesQuery.data?.data ?? [];

  // Varyant uyumsuzluk hint'i için cihaz medya boyutu (form → Number; eksik → null).
  const wStr = form.watch("labelWidthMm");
  const hStr = form.watch("labelHeightMm");
  const mediaSize =
    wStr.trim() && hStr.trim()
      ? { widthMm: Number(wStr), heightMm: Number(hStr) }
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
      </div>

      {/* Yazıcı medyası — mm/dpi doğrudan cihazda (ayrı "Boyutlar" kataloğu yok).
          Boş bırak → sistem varsayılan medyası kullanılır. */}
      <div className="rounded-md border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Etiket Medyası (boş → sistem varsayılanı)
        </div>
        <div className="grid grid-cols-4 gap-3">
          <FormField label="Eni (mm)" error={form.formState.errors.labelWidthMm} hint="10-500">
            <Input type="number" step="0.1" {...form.register("labelWidthMm")} placeholder="100" />
          </FormField>
          <FormField label="Boyu (mm)" error={form.formState.errors.labelHeightMm} hint="10-500">
            <Input type="number" step="0.1" {...form.register("labelHeightMm")} placeholder="50" />
          </FormField>
          <FormField label="DPI" error={form.formState.errors.labelDpi} hint="tipik 203">
            <Input type="number" {...form.register("labelDpi")} placeholder="203" />
          </FormField>
          <FormField label="Boşluk (mm)" error={form.formState.errors.labelGapMm} hint="gap 2-3">
            <Input type="number" step="0.1" {...form.register("labelGapMm")} placeholder="2" />
          </FormField>
        </div>
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
                <TemplateVariantHint templateId={selTemplateId} media={mediaSize} />
              </FormField>
            );
          })}
        </div>
      </div>
    </>
  );
}
