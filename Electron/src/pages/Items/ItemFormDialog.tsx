import { useEffect, useMemo } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { itemTypeLabels, type ItemType } from "@/types/enums";
import { itemService } from "./service";
import type { Item, ItemCreatePayload } from "./types";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import {
  itemFormDefaults,
  finalItemFormDefaults,
  itemFormSchema,
  previewDerivedCode,
  previewDerivedName,
  type ItemFormValues,
} from "./schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Item | null;
  /** Dışarıdan zorlanırsa mod seçici gizlenir (örn. sipariş kaleminden hızlı ekleme). */
  forcedMode?: "ham" | "final";
  onSubmit: (payload: ItemCreatePayload) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ItemFormDialog({
  open,
  onOpenChange,
  initial,
  forcedMode,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(initial);
  const initialMode: "ham" | "final" = initial?.isDerived ? "final" : forcedMode ?? "ham";

  const defaults: ItemFormValues = initial
    ? {
        mode: initial.isDerived ? "final" : "ham",
        code: initial.code,
        itemType: initial.itemType,
        baseItemId: initial.baseItemId,
        colorId: initial.colorId,
        allowedPropertyIds: initial.allowedProperties?.map((p) => p.propertyId) ?? [],
        name: initial.name,
        unit: initial.unit,
        isActive: initial.isActive,
      }
    : forcedMode === "final"
      ? finalItemFormDefaults
      : itemFormDefaults;

  const form = useForm<ItemFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(itemFormSchema as any) as unknown as Resolver<ItemFormValues>,
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const mode = useWatch({ control: form.control, name: "mode" }) ?? initialMode;

  const handleSubmit = form.handleSubmit(async (v) => {
    const payload: ItemCreatePayload =
      v.mode === "ham"
        ? {
            code: v.code?.trim(),
            name: v.name?.trim(),
            itemType: v.itemType!,
            unit: v.unit,
            isActive: v.isActive,
            isDerived: false,
          }
        : {
            // itemType backend'de baseItem'dan inherit; yine de gönder
            itemType: v.itemType!,
            unit: v.unit,
            isActive: v.isActive,
            isDerived: true,
            baseItemId: v.baseItemId ?? null,
            colorId: v.colorId ?? null,
            allowedPropertyIds: v.allowedPropertyIds ?? [],
            name: v.name?.trim() || undefined,
          };
    await onSubmit(payload);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Ürünü Düzenle" : "Yeni Ürün"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Sadece ad, birim ve aktiflik değiştirilebilir. Kombinasyon değişmez."
              : "Ham ürün stok girişi içindir; final ürün müşteri siparişinde kullanılır."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isEdit && !forcedMode && (
            <FormField label="Tip" required>
              <Controller
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <div className="flex gap-2">
                    <ModeButton
                      label="Ham Ürün"
                      hint="Stok girişi"
                      active={field.value === "ham"}
                      onClick={() => field.onChange("ham")}
                    />
                    <ModeButton
                      label="Final Ürün"
                      hint="Sipariş için"
                      active={field.value === "final"}
                      onClick={() => field.onChange("final")}
                    />
                  </div>
                )}
              />
            </FormField>
          )}

          {mode === "ham" ? (
            <HamFields form={form} disabled={isEdit} />
          ) : (
            <FinalFields form={form} disabled={isEdit} />
          )}

          <FormField label="Birim" htmlFor="unit" error={form.formState.errors.unit} required>
            <Input id="unit" placeholder="MT, KG, ADET" {...form.register("unit")} />
          </FormField>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : isEdit ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-md border px-3 py-2 text-left transition " +
        (active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-input hover:border-primary/50")
      }
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </button>
  );
}

function HamFields({
  form,
  disabled,
}: {
  form: ReturnType<typeof useForm<ItemFormValues>>;
  disabled: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Kod" htmlFor="code" error={form.formState.errors.code} required>
          <Input id="code" placeholder="PATOS" {...form.register("code")} disabled={disabled} />
        </FormField>
        <FormField label="Tip" error={form.formState.errors.itemType} required>
          <Controller
            control={form.control}
            name="itemType"
            render={({ field }) => (
              <EnumSelect<ItemType>
                value={(field.value ?? "RAW_FABRIC") as ItemType}
                onChange={field.onChange}
                labels={itemTypeLabels}
                disabled={disabled}
              />
            )}
          />
        </FormField>
      </div>
      <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
        <Input id="name" placeholder="Ham Patos" autoFocus {...form.register("name")} />
      </FormField>
    </>
  );
}

function FinalFields({
  form,
  disabled,
}: {
  form: ReturnType<typeof useForm<ItemFormValues>>;
  disabled: boolean;
}) {
  const baseItemId = useWatch({ control: form.control, name: "baseItemId" });
  const colorId = useWatch({ control: form.control, name: "colorId" });
  const allowedPropertyIds = useWatch({ control: form.control, name: "allowedPropertyIds" }) ?? [];
  const overrideName = useWatch({ control: form.control, name: "name" });

  // Seçili ham + renk + özellik detayları → preview için
  const baseItemQ = useQuery({
    queryKey: ["item", baseItemId, "preview"],
    queryFn: () => itemService.getById(baseItemId as string),
    enabled: Boolean(baseItemId),
    staleTime: 60_000,
  });
  const colorQ = useQuery({
    queryKey: ["color", colorId, "preview"],
    queryFn: () => colorService.getById(colorId as string),
    enabled: Boolean(colorId),
    staleTime: 60_000,
  });
  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
  });

  const allProps = useMemo(() => propsQ.data?.data ?? [], [propsQ.data?.data]);

  const propMultiItems: MultiSelectItem[] = useMemo(
    () =>
      allProps.map((p) => ({
        id: p.id,
        label: p.name,
        group: p.category ?? undefined,
        hint: p.code,
        swatch: p.color ?? null,
      })),
    [allProps],
  );

  const baseItem = baseItemQ.data?.data;
  const color = colorQ.data?.data;
  const selectedAllowed = allProps.filter((p) => allowedPropertyIds.includes(p.id));

  const previewCode = previewDerivedCode(baseItem?.code, color?.code);
  const previewName = previewDerivedName(baseItem?.name, color?.name);

  return (
    <>
      <FormField label="Ham Ürün" error={form.formState.errors.baseItemId} required>
        <Controller
          control={form.control}
          name="baseItemId"
          render={({ field }) => (
            <ReferenceSelect<Item>
              value={field.value}
              onChange={field.onChange}
              service={itemService}
              queryKey="items-base"
              getLabel={(i) => `${i.code} — ${i.name}`}
              placeholder="Ham ürün seç..."
              extraFilters={{ isDerived: "false" }}
            />
          )}
        />
      </FormField>

      <FormField label="Renk" error={form.formState.errors.colorId} required>
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
            />
          )}
        />
      </FormField>

      <FormField label="Olası Özellikler (opsiyonel)">
        <div className="space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            Bu ürüne uygulanabilecek özellikler. Boş bırakılırsa tüm özellikler
            iş emrinde seçilebilir.
          </p>
          <Controller
            control={form.control}
            name="allowedPropertyIds"
            render={({ field }) => (
              <div className="h-40">
                <MultiSelectCheckboxList
                  items={propMultiItems}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Özellik ara..."
                  disabled={disabled}
                />
              </div>
            )}
          />
        </div>
      </FormField>

      <div className="rounded-md border bg-muted/30 p-3 text-xs">
        <div className="mb-2 font-medium uppercase tracking-wide text-muted-foreground">
          Önizleme
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 items-center">
          <div className="text-muted-foreground">Kod</div>
          <div className="font-mono text-sm">
            {previewCode || <span className="text-muted-foreground italic">— ham ürün ve renk seç</span>}
          </div>
          <div className="text-muted-foreground">İsim önerisi</div>
          <div className="text-sm">
            {previewName || <span className="text-muted-foreground italic">—</span>}
          </div>
          {color && (
            <>
              <div className="text-muted-foreground">Renk</div>
              <div>
                <Badge variant="muted" className="gap-1">
                  {color.hex && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color.hex }}
                    />
                  )}
                  {color.name}
                </Badge>
              </div>
            </>
          )}
          {selectedAllowed.length > 0 && (
            <>
              <div className="text-muted-foreground">Olası Özellikler</div>
              <div className="flex flex-wrap gap-1">
                {selectedAllowed.map((p) => (
                  <Badge key={p.id} variant="muted">
                    {p.name}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <FormField label="İsim (boş bırakılırsa otomatik)" htmlFor="name">
        <Input
          id="name"
          placeholder={previewName || "Otomatik üretilecek"}
          {...form.register("name")}
        />
      </FormField>

      {overrideName && overrideName.trim() && overrideName.trim() !== previewName && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          İsim manuel girildi: "{overrideName.trim()}" — varsayılan "{previewName}" yerine kullanılır.
        </div>
      )}
    </>
  );
}
