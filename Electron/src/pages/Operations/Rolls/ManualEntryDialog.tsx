import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer } from "lucide-react";
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
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { PropertyPickerModal } from "@/components/forms/PropertyPickerModal";
import { itemService } from "@/pages/Items/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { customerService } from "@/pages/Customers/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useKk1WeightEntryEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import type { Item } from "@/pages/Items/types";
import type { Customer } from "@/pages/Customers/types";
import type { LabelCustomerContext } from "@/services/labelService";
import { rollService, type InitialEntryPayload } from "./service";

// Radix Select boş string value kabul etmez → "Belirsiz" için sentinel.
const QUALITY_NONE = "__none__";

const schema = z.object({
  itemId: z.string().uuid("Ürün seçilmeli"),
  colorId: z.string().uuid().nullable(),
  initialQty: z.number().positive("Miktar pozitif olmalı"),
  weightKg: z.number().positive("Ağırlık pozitif olmalı").nullable(),
  width: z.number().positive("En pozitif olmalı").nullable(),
  // Kalite opsiyonel — kaliteye bakılmamış manuel girişte "Belirsiz" (boş) kalır.
  qualityGrade: z.string(),
  propertyIds: z.array(z.string().uuid()).default([]),
  // Yalnız "Ekle ve Etiket Bas" akışında etiketin müşterisi. Topun kendisine
  // BAĞLANMAZ (gevşek model: top→müşteri bağı yok); create payload'ına gitmez.
  customerId: z.string().uuid().nullable(),
});

type FormValues = z.infer<typeof schema>;

const defaults: FormValues = {
  itemId: "",
  colorId: null,
  initialQty: 0,
  weightKg: null,
  width: null,
  qualityGrade: "",
  propertyIds: [],
  customerId: null,
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
  /**
   * "Ekle ve Etiket Bas" ile çağrılır: yeni topun id'si + (varsa) etiket müşteri
   * bağlamı. Üst sayfa RollLabelDialog'u bu topla açar (önizleme + Bas).
   */
  onCreatedForPrint?: (rollId: string, printContext?: LabelCustomerContext) => void;
}

export function ManualEntryDialog({ open, onOpenChange, target = "RAW_STOCK", onCreatedForPrint }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canPrint = hasPermission("label:print");
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

  // İdempotency anahtarı — dialog açılışı bir form-oturumudur. Timeout sonrası
  // tekrar basış aynı token'ı gönderir → backend cached top döner (hayalet stok
  // önlenir). Dialog her açılışta + başarıda yenilenir (yeni oturum).
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (open) setClientToken(crypto.randomUUID());
  }, [open]);

  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  // printAfter + printCtx mutation değişkenlerinde taşınır → onSuccess (data, vars)
  // ile güvenilir okunur (ref/stale-closure yok); UI için mutation.variables.
  const mutation = useMutation({
    mutationFn: (args: {
      payload: InitialEntryPayload;
      printAfter: boolean;
      printCtx?: LabelCustomerContext;
    }) => rollService.createInitialEntry(args.payload),
    onSuccess: (res, vars) => {
      const roll = res.data;
      toast.success(`Top oluşturuldu: ${roll?.barcode ?? "-"}`);
      // Y1 fix: ["rolls:STOCK"] ölü key'di (STOCK sekmesi RAW/FINISHED'a bölündü)
      // — liste hiç tazelenmiyordu. ["rolls"] tüm sekme tablolarını + stats'ı kapsar.
      qc.invalidateQueries({ queryKey: ["rolls"] });
      form.reset(defaults);
      setClientToken(crypto.randomUUID()); // yeni giriş → yeni token
      onOpenChange(false);
      if (vars.printAfter && roll?.id) onCreatedForPrint?.(roll.id, vars.printCtx);
    },
  });

  const doSubmit = (printAfter: boolean) =>
    form.handleSubmit((v) => {
      // Bitmiş Depo hedefi WAREHOUSE ister → backend bunu yalnız colorId ile üretir.
      // Renksiz gönderim STOCK'a düşer (Ham Stok'ta çıkar, kullanıcı depoda arar) →
      // erken engelle, net hata göster.
      if (isWarehouse && !v.colorId) {
        form.setError("colorId", { message: "Bitmiş depo girişi için renk zorunlu" });
        return;
      }
      mutation.mutate({
        payload: {
          itemId: v.itemId,
          colorId: v.colorId,
          initialQty: v.initialQty,
          weightKg: weightEntryEnabled ? v.weightKg ?? undefined : undefined,
          width: v.width,
          // Boş = Belirsiz → payload'dan düş (backend null yazar).
          qualityGrade: v.qualityGrade || undefined,
          propertyIds: v.propertyIds,
          clientToken,
        },
        printAfter,
        // Müşteri seçildiyse serbest müşteri (orderLineId yok → master alias cascade);
        // seçilmezse undefined → taze topta snapshot yok → stok (müşterisiz) etiket.
        printCtx: v.customerId ? { customerId: v.customerId, orderLineId: null } : undefined,
      });
    });

  const pendingAdd = mutation.isPending && !mutation.variables?.printAfter;
  const pendingAddPrint = mutation.isPending && mutation.variables?.printAfter === true;

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
              ? "Bitmiş (renkli) stok girişi — renk zorunlu; top Bitmiş Depo (WAREHOUSE) statüsünde eklenir, barkodu otomatik atanır."
              : "Dışarıdan/geçmiş ham stok girişi — top Ham Stok (STOCK) statüsünde eklenir, barkodu otomatik atanır."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={doSubmit(false)} className="space-y-3">
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

          {/* Renk + Özellikler yan yana — ikisi de tıklayınca modal açar. */}
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label={isWarehouse ? "Renk" : "Renk (opsiyonel)"}
              required={isWarehouse}
              error={form.formState.errors.colorId}
              hint={isWarehouse ? "Bitmiş depo topu renklidir — zorunlu." : "Ham mal genelde boş."}
            >
              <Controller
                control={form.control}
                name="colorId"
                render={({ field }) => (
                  <ColorPickerModal
                    value={field.value}
                    onChange={field.onChange}
                    allowNone={!isWarehouse}
                    placeholder="Renk seç..."
                  />
                )}
              />
            </FormField>

            <FormField label="Özellikler (opsiyonel)" hint="Tıkla → modaldan seç.">
              <Controller
                control={form.control}
                name="propertyIds"
                render={({ field }) => (
                  <PropertyPickerModal
                    itemId={watchedItemId}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </FormField>
          </div>

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

          <FormField
            label="Kalite Sınıfı (opsiyonel)"
            error={form.formState.errors.qualityGrade}
            hint="Kaliteye bakılmadıysa boş bırak — top 'Belirsiz' kaydedilir, kalite istasyonunda belirlenir."
          >
            <Controller
              control={form.control}
              name="qualityGrade"
              render={({ field }) => (
                <Select
                  value={field.value || QUALITY_NONE}
                  onValueChange={(v) => field.onChange(v === QUALITY_NONE ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kalite seç..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={QUALITY_NONE}>Belirsiz (kalite yok)</SelectItem>
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

          {canPrint && (
            <FormField
              label="Etiket müşterisi (opsiyonel)"
              hint="Yalnız 'Ekle ve Etiket Bas' kullanır — seçilmezse stok (müşterisiz) etiket. Topun kendisi müşteriye bağlanmaz."
            >
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <EntityPickerModal<Customer>
                    value={field.value}
                    onChange={field.onChange}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    nullable
                  />
                )}
              />
            </FormField>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="destructive" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              {pendingAdd ? "Ekleniyor..." : "Ekle"}
            </Button>
            {canPrint && (
              <Button type="button" disabled={mutation.isPending} onClick={doSubmit(true)} className="gap-1.5">
                <Printer className="h-4 w-4" />
                {pendingAddPrint ? "Ekleniyor..." : "Ekle ve Etiket Bas"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
