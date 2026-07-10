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
import { useKk1WeightEntryEnabled } from "@/hooks/usePricingEnabled";
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
  /**
   * Hangi sekmeden açıldı — hedef statüyü belirler. Backend `createInitialEntry`
   * `colorId != null → WAREHOUSE`, `null → STOCK` kuralıyla yönlendirir:
   * - "FINISHED_STOCK" (Bitmiş Depo): renk ZORUNLU → top WAREHOUSE (depo) doğar.
   * - "RAW_STOCK" (default, Ham Stok): renk opsiyonel; renksiz → STOCK.
   */
  target?: "RAW_STOCK" | "FINISHED_STOCK";
}

export function ManualEntryDialog({ open, onOpenChange, target = "RAW_STOCK" }: Props) {
  const qc = useQueryClient();
  const isWarehouse = target === "FINISHED_STOCK";
  // KK1 ağırlık girişi admin ayarıyla kapatılabilir (default kapalı). Kapalıyken
  // alan gizlenir ve payload'a weightKg konmaz — aksi halde backend guard'ı
  // (createInitialEntry) ağırlıklı girişi 400 ile reddeder.
  const weightEntryEnabled = useKk1WeightEntryEnabled();

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
      // Y1 fix: ["rolls:STOCK"] ölü key'di (STOCK sekmesi RAW/FINISHED'a bölündü)
      // — liste hiç tazelenmiyordu. ["rolls"] tüm sekme tablolarını + stats'ı kapsar.
      qc.invalidateQueries({ queryKey: ["rolls"] });
      form.reset(defaults);
      onOpenChange(false);
    },
  });

  const handleSubmit = form.handleSubmit((v) => {
    // Bitmiş Depo hedefi WAREHOUSE ister → backend bunu yalnız colorId ile üretir.
    // Renksiz gönderim STOCK'a düşer (Ham Stok'ta çıkar, kullanıcı depoda arar) →
    // erken engelle, net hata göster.
    if (isWarehouse && !v.colorId) {
      form.setError("colorId", { message: "Bitmiş depo girişi için renk zorunlu" });
      return;
    }
    mutation.mutate({
      itemId: v.itemId,
      colorId: v.colorId,
      initialQty: v.initialQty,
      weightKg: weightEntryEnabled ? v.weightKg ?? undefined : undefined,
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
          <DialogTitle>{isWarehouse ? "Depoya Manuel Top Ekle" : "Manuel Top Ekle"}</DialogTitle>
          <DialogDescription>
            {isWarehouse
              ? "Depodaki bitmiş (renkli) stoklar için yönetici girişi. Otomatik barkod basılır, top Bitmiş Depo (WAREHOUSE) statüsünde eklenir — renk zorunlu."
              : "Sistem dışından gelen veya geçmiş ham stoklar için yönetici girişi. Otomatik barkod basılır, top STOCK (Ham Stok) statüsünde envantere eklenir."}
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

          <FormField
            label={isWarehouse ? "Renk" : "Renk (opsiyonel)"}
            required={isWarehouse}
            error={form.formState.errors.colorId}
            hint={isWarehouse ? "Bitmiş depo topu renklidir — zorunlu (WAREHOUSE şartı)." : "Ham mal genelde boş — boyahanede kazanır."}
          >
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

          <div className={weightEntryEnabled ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
            <FormField label="Metraj (mt)" htmlFor="initialQty" error={form.formState.errors.initialQty} required>
              <Input
                id="initialQty"
                type="number"
                step="0.01"
                min="0"
                {...form.register("initialQty", { valueAsNumber: true })}
              />
            </FormField>
            {weightEntryEnabled && (
              <FormField label="Ağırlık (kg)" htmlFor="weightKg" error={form.formState.errors.weightKg}>
                <Input
                  id="weightKg"
                  type="number"
                  step="0.01"
                  min="0"
                  onChange={(e) => form.setValue("weightKg", numberOrNull(e.target.value))}
                />
              </FormField>
            )}
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
