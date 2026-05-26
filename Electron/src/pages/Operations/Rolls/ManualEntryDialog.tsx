import { useMemo } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { PropertyChipsField } from "@/components/forms/PropertyChipsField";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import { rollService, type InitialEntryPayload } from "./service";

const schema = z.object({
  itemId: z.string().uuid("Ürün seçilmeli"),
  colorId: z.string().uuid().nullable(),
  initialQty: z.number().positive("Miktar pozitif olmalı"),
  weightKg: z.number().positive("Ağırlık pozitif olmalı").nullable(),
  width: z.number().positive("En pozitif olmalı").nullable(),
  qualityGrade: z.string().min(1, "Kalite sınıfı seçilmeli"),
  propertyIds: z.array(z.string().uuid()).default([]),
});

type FormValues = z.infer<typeof schema>;

const defaults: FormValues = {
  itemId: "",
  colorId: null,
  initialQty: 0,
  weightKg: null,
  width: null,
  qualityGrade: "1.KALITE",
  propertyIds: [],
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManualEntryDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: defaults,
  });

  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  const mutation = useMutation({
    mutationFn: (payload: InitialEntryPayload) => rollService.createInitialEntry(payload),
    onSuccess: (res) => {
      const barcode = res.data?.barcode ?? "-";
      toast.success(`Top oluşturuldu: ${barcode}`);
      qc.invalidateQueries({ queryKey: ["rolls:STOCK"] });
      form.reset(defaults);
      onOpenChange(false);
    },
  });

  const handleSubmit = form.handleSubmit((v) => {
    mutation.mutate({
      itemId: v.itemId,
      colorId: v.colorId,
      initialQty: v.initialQty,
      weightKg: v.weightKg ?? undefined,
      width: v.width,
      qualityGrade: v.qualityGrade,
      propertyIds: v.propertyIds,
    });
  });

  const watchedItemId = form.watch("itemId");

  const numberOrNull = (raw: string): number | null =>
    raw.trim() === "" ? null : Number(raw);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset(defaults);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Manuel Top Ekle</DialogTitle>
          <DialogDescription>
            Sistem dışından gelen veya geçmiş stoklar için yönetici girişi. Otomatik
            barkod basılır, top STOCK statüsünde envantere eklenir.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <FormField label="Ürün" error={form.formState.errors.itemId} required>
            <Controller
              control={form.control}
              name="itemId"
              render={({ field }) => (
                <ReferenceSelect<Item>
                  value={field.value || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  service={itemService}
                  queryKey="items"
                  getLabel={(it) => `${it.code} — ${it.name}`}
                  placeholder="Ürün ara..."
                />
              )}
            />
          </FormField>

          <FormField label="Renk (opsiyonel)" hint="Ham mal genelde boş — boyahanede kazanır.">
            <Controller
              control={form.control}
              name="colorId"
              render={({ field }) => (
                <ReferenceSelect<Color>
                  value={field.value}
                  onChange={field.onChange}
                  service={colorService}
                  queryKey="colors"
                  getLabel={(c) => c.name}
                  placeholder="Renk seç..."
                  nullable
                  noneLabel="— (renksiz)"
                />
              )}
            />
          </FormField>

          <FormField
            label="Özellikler (opsiyonel)"
            hint="Topun fiilen sahip olduğu özellikler — tıklayarak ekle/çıkar."
          >
            <Controller
              control={form.control}
              name="propertyIds"
              render={({ field }) => (
                <PropertyChipsField
                  itemId={watchedItemId}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Metraj (mt)" htmlFor="initialQty" error={form.formState.errors.initialQty} required>
              <Input
                id="initialQty"
                type="number"
                step="0.01"
                min="0"
                {...form.register("initialQty", { valueAsNumber: true })}
              />
            </FormField>
            <FormField label="Ağırlık (kg)" htmlFor="weightKg" error={form.formState.errors.weightKg}>
              <Input
                id="weightKg"
                type="number"
                step="0.01"
                min="0"
                onChange={(e) => form.setValue("weightKg", numberOrNull(e.target.value))}
              />
            </FormField>
            <FormField label="En (cm)" htmlFor="width" error={form.formState.errors.width}>
              <Input
                id="width"
                type="number"
                step="0.1"
                min="0"
                onChange={(e) => form.setValue("width", numberOrNull(e.target.value))}
              />
            </FormField>
          </div>

          <FormField label="Kalite Sınıfı" error={form.formState.errors.qualityGrade} required>
            <Controller
              control={form.control}
              name="qualityGrade"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kalite seç..." />
                  </SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => (
                      <SelectItem key={g.id} value={g.code}>
                        {g.name} ({g.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Ekleniyor..." : "Topu Ekle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
