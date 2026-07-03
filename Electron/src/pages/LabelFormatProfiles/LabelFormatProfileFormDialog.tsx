import { useState } from "react";
import { Controller } from "react-hook-form";
import { Printer } from "lucide-react";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TestPrintDialog } from "./TestPrintDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  labelFormatProfileFormDefaults,
  labelFormatProfileFormSchema,
  type LabelFormatProfileFormValues,
} from "./schema";
import type { LabelFormatProfile } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: LabelFormatProfile | null;
  onSubmit: (values: LabelFormatProfileFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function LabelFormatProfileFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  const [testId, setTestId] = useState<string | null>(null);
  const side = (v: string | number | null | undefined, fb: number) =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : fb;
  const defaults: LabelFormatProfileFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        widthMm: Number(initial.widthMm),
        heightMm: Number(initial.heightMm),
        marginTopMm: side(initial.marginTopMm, Number(initial.marginMm)),
        marginRightMm: side(initial.marginRightMm, Number(initial.marginMm)),
        marginBottomMm: side(initial.marginBottomMm, Number(initial.marginMm)),
        marginLeftMm: side(initial.marginLeftMm, Number(initial.marginMm)),
        gapMm: Number(initial.gapMm),
        dpi: initial.dpi,
        orientation: initial.orientation,
      }
    : labelFormatProfileFormDefaults;

  return (
    <>
    <EntityFormDialog<LabelFormatProfileFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Format Profilini Düzenle" : "Yeni Etiket Format Profili"}
      schema={labelFormatProfileFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => (
        <>
          {initial && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setTestId(initial.id)}>
                <Printer className="h-3.5 w-3.5" /> Test Baskısı
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kod" error={form.formState.errors.code} required>
              <Input className="font-mono" {...form.register("code")} placeholder="ARGOX_TOP_100x148" disabled={Boolean(initial)} />
            </FormField>
            <FormField label="Ad" error={form.formState.errors.name} required>
              <Input {...form.register("name")} placeholder="Argox 100×148 (3mm pay)" />
            </FormField>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Medya = fiziksel etiket ölçüsü (mm)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Genişlik (mm)" error={form.formState.errors.widthMm} required>
                <Input type="number" step="0.5" min="1" {...form.register("widthMm", { valueAsNumber: true })} />
              </FormField>
              <FormField label="Yükseklik (mm)" error={form.formState.errors.heightMm} required>
                <Input type="number" step="0.5" min="1" {...form.register("heightMm", { valueAsNumber: true })} />
              </FormField>
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Paylar — her kenardan içerik boşluğu (mm). Sol = içeriğin başlangıcı, Alt = alt barkod yeri.
            </div>
            <div className="grid grid-cols-4 gap-3">
              <FormField label="Üst" error={form.formState.errors.marginTopMm} required>
                <Input type="number" step="0.5" min="0" {...form.register("marginTopMm", { valueAsNumber: true })} />
              </FormField>
              <FormField label="Sağ" error={form.formState.errors.marginRightMm} required>
                <Input type="number" step="0.5" min="0" {...form.register("marginRightMm", { valueAsNumber: true })} />
              </FormField>
              <FormField label="Alt" error={form.formState.errors.marginBottomMm} required>
                <Input type="number" step="0.5" min="0" {...form.register("marginBottomMm", { valueAsNumber: true })} />
              </FormField>
              <FormField label="Sol" error={form.formState.errors.marginLeftMm} required>
                <Input type="number" step="0.5" min="0" {...form.register("marginLeftMm", { valueAsNumber: true })} />
              </FormField>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Etiket arası (mm)" error={form.formState.errors.gapMm}>
              <Input type="number" step="0.5" min="0" {...form.register("gapMm", { valueAsNumber: true })} />
            </FormField>
            <FormField label="DPI" error={form.formState.errors.dpi} required>
              <Input type="number" step="1" min="50" {...form.register("dpi", { valueAsNumber: true })} />
            </FormField>
            <FormField label="Yön" error={form.formState.errors.orientation} required>
              <Controller
                control={form.control}
                name="orientation"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PORTRAIT">Dikey</SelectItem>
                      <SelectItem value="LANDSCAPE">Yatay</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          {/* Aktiflik formdan YÖNETİLMEZ — yalnız listedeki Pasife Al / Aktifleştir /
              Kalıcı Sil aksiyonlarından (users kalıbı). */}
        </>
      )}
    </EntityFormDialog>
    <TestPrintDialog
      profileId={testId}
      profileName={initial?.name}
      onOpenChange={(o) => !o && setTestId(null)}
    />
    </>
  );
}
