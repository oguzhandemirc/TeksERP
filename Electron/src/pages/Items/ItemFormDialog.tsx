import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ChevronRight, Palette, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { cn } from "@/lib/utils";
import {
  itemTypeLabels,
  unitForItemType,
  type ItemType,
} from "@/types/enums";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { Item, ItemCreatePayload } from "./types";
import {
  itemFormDefaults,
  makeItemFormSchema,
  type ItemFormValues,
} from "./schema";
import { buildItemPayload } from "./itemPayload.helper";
import { AllowedColorsDialog } from "./AllowedColorsDialog";
import { AllowedPropertiesDialog } from "./AllowedPropertiesDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Item | null;
  onSubmit: (payload: ItemCreatePayload) => void | Promise<void>;
  isSubmitting?: boolean;
}

export function ItemFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(initial);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);

  const defaults: ItemFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        itemType: initial.itemType,
        unit: initial.unit,
        isActive: initial.isActive,
        allowedColorIds: initial.allowedColors?.map((c) => c.colorId) ?? [],
        allowedPropertyIds:
          initial.allowedProperties?.map((p) => p.propertyId) ?? [],
      }
    : itemFormDefaults;

  const schema = useMemo(() => makeItemFormSchema(isEdit), [isEdit]);
  const form = useForm<ItemFormValues>({
    resolver: zodResolver(schema) as Resolver<ItemFormValues>,
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const itemType = form.watch("itemType");
  const derivedUnit = unitForItemType[itemType] ?? "MT";

  useEffect(() => {
    form.setValue("unit", derivedUnit, { shouldDirty: true });
  }, [derivedUnit, form]);

  const allowedColorIds = form.watch("allowedColorIds");
  const allowedPropertyIds = form.watch("allowedPropertyIds");

  // Trigger önizlemesi için seçili kayıtların isim/swatch'ini getir.
  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all-active"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: open,
  });

  const selectedColors = useMemo(() => {
    const all = colorsQ.data?.data ?? [];
    return allowedColorIds
      .map((id) => all.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [allowedColorIds, colorsQ.data?.data]);

  const selectedProperties = useMemo(() => {
    const all = propsQ.data?.data ?? [];
    return allowedPropertyIds
      .map((id) => all.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }, [allowedPropertyIds, propsQ.data?.data]);

  const handleSubmit = form.handleSubmit(async (v) => {
    await onSubmit(buildItemPayload(v, isEdit));
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Kumaşı Düzenle" : "Yeni Kumaş"}</DialogTitle>
          <DialogDescription>
            Kumaş tanımı. Birim, seçilen tipe göre otomatik atanır.
          </DialogDescription>
        </DialogHeader>

        {initial?.pendingReview && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Bu desen sahada (ham giriş) oluşturuldu ve onay bekliyor. Bilgileri
              gözden geçirip <strong>Güncelle</strong>'ye bastığınızda onaylanmış
              sayılır.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Stok Kodu"
              htmlFor="code"
              error={form.formState.errors.code}
              hint={
                isEdit
                  ? "Kumaş oluşturulduktan sonra değiştirilemez."
                  : "Boş bırakın — sistem otomatik versin."
              }
            >
              <Input
                id="code"
                placeholder={isEdit ? undefined : "Otomatik (STK-000123)"}
                readOnly={isEdit}
                tabIndex={isEdit ? -1 : 0}
                className={isEdit ? "cursor-not-allowed bg-muted" : undefined}
                {...form.register("code")}
              />
            </FormField>
            <FormField
              label="Tip"
              error={form.formState.errors.itemType}
              required={!isEdit}
              hint={isEdit ? "Kumaş oluşturulduktan sonra değiştirilemez." : undefined}
            >
              <Controller
                control={form.control}
                name="itemType"
                render={({ field }) => (
                  <EnumSelect<ItemType>
                    value={field.value}
                    onChange={field.onChange}
                    labels={itemTypeLabels}
                    disabled={isEdit}
                  />
                )}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-3">
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" placeholder="Patos" {...form.register("name")} />
            </FormField>
            <FormField label="Birim" hint="Tipe göre otomatik">
              <Input
                value={derivedUnit}
                readOnly
                tabIndex={-1}
                className="bg-muted font-mono text-center cursor-not-allowed"
              />
            </FormField>
          </div>

          <FormField label="İzinli Renkler (opsiyonel)">
            <PickerTrigger
              icon={<Palette className="h-4 w-4 text-muted-foreground" />}
              count={allowedColorIds.length}
              emptyText="Tüm aktif renkler serbest"
              previews={selectedColors.slice(0, 6).map((c) => ({
                key: c.id,
                label: c.name,
                swatch: c.hex ?? null,
              }))}
              extra={selectedColors.length - 6}
              onClick={() => setColorsOpen(true)}
            />
          </FormField>

          <FormField label="İzinli Özellikler (opsiyonel)">
            <PickerTrigger
              icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
              count={allowedPropertyIds.length}
              emptyText="Tüm aktif özellikler serbest"
              previews={selectedProperties.slice(0, 6).map((p) => ({
                key: p.id,
                label: p.name,
                swatch: p.color ?? null,
              }))}
              extra={selectedProperties.length - 6}
              onClick={() => setPropsOpen(true)}
            />
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

        <Controller
          control={form.control}
          name="allowedColorIds"
          render={({ field }) => (
            <AllowedColorsDialog
              open={colorsOpen}
              onOpenChange={setColorsOpen}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Controller
          control={form.control}
          name="allowedPropertyIds"
          render={({ field }) => (
            <AllowedPropertiesDialog
              open={propsOpen}
              onOpenChange={setPropsOpen}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </DialogContent>
    </Dialog>
  );
}

interface PreviewChip {
  key: string;
  label: string;
  swatch: string | null;
}

function PickerTrigger({
  icon,
  count,
  emptyText,
  previews,
  extra,
  onClick,
}: {
  icon: React.ReactNode;
  count: number;
  emptyText: string;
  previews: PreviewChip[];
  extra: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm",
        "transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        {count === 0 ? (
          <span className="text-muted-foreground italic">{emptyText}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {previews.map((p) => (
              <Badge key={p.key} variant="muted" className="gap-1 text-[10px]">
                {p.swatch && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.swatch }}
                  />
                )}
                {p.label}
              </Badge>
            ))}
            {extra > 0 && (
              <Badge variant="muted" className="text-[10px]">
                +{extra}
              </Badge>
            )}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count > 0 ? `${count} seçili` : "Seç"}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
