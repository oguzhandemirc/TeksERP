import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, ChevronRight, Palette, Ruler, Sparkles } from "lucide-react";
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
// `ItemType` DEĞER olarak da gerekli (denye alanı yalnız YARN'da çizilir),
// bu yüzden `type` import'u değil.
import { ItemType, itemTypeLabels, unitForItemType } from "@/types/enums";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { Item, ItemCreatePayload } from "./types";
import {
  itemFormDefaults,
  makeItemFormSchema,
  type ItemFormValues,
} from "./schema";
import { buildItemPayload, itemCarriesAllowedLists } from "./itemPayload.helper";
import { AllowedColorsDialog } from "./AllowedColorsDialog";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WarpSpec } from "@/pages/WarpSpecs/types";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { AllowedPropertiesDialog } from "./AllowedPropertiesDialog";

import { RecordInfoButton } from "@/components/RecordInfoButton";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { loadAllForPicker } from "@/lib/picker-loader";
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
  /** Stok kodunu elle yazma modu — varsayılan KAPALI, kutu hiç çizilmez. */
  const [manualCode, setManualCode] = useState(false);

  const defaults: ItemFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        itemType: initial.itemType,
        unit: initial.unit,
        isActive: initial.isActive,
        linearDensityDen: initial.linearDensityDen ?? "",
        warpSpecId: initial.warpSpecId ?? "",
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
    if (open) {
      form.reset(defaults);
      setManualCode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const itemType = form.watch("itemType");
  const devereEnabled = useDevereEnabled();
  const derivedUnit = unitForItemType[itemType] ?? "MT";

  useEffect(() => {
    form.setValue("unit", derivedUnit, { shouldDirty: true });
  }, [derivedUnit, form]);

  const allowedColorIds = form.watch("allowedColorIds");
  const allowedPropertyIds = form.watch("allowedPropertyIds");

  // İzinli renk/özellik YALNIZ kumaşta: tür iplik/sarfa çevrilince (create) değerler boşalır;
  // düzenlemede tür kilitli, eski iplik kartında kalmış liste NOTLA gösterilir, kaydedince payload `[]` ile kaldırır.
  const carriesLists = itemCarriesAllowedLists(itemType);
  useEffect(() => {
    if (carriesLists) return;
    if (form.getValues("allowedColorIds").length) form.setValue("allowedColorIds", [], { shouldDirty: true });
    if (form.getValues("allowedPropertyIds").length) form.setValue("allowedPropertyIds", [], { shouldDirty: true });
  }, [carriesLists, form]);
  const staleLists =
    isEdit && !carriesLists && ((initial?.allowedColors?.length ?? 0) > 0 || (initial?.allowedProperties?.length ?? 0) > 0);

  // Trigger önizlemesi için seçili kayıtların isim/swatch'ini getir.
  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      loadAllForPicker(colorService, {
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
      loadAllForPicker(fabricPropertyService, {
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
          <div className="flex items-center gap-1.5">
            <DialogTitle>{isEdit ? "Ürünü Düzenle" : "Yeni Ürün"}</DialogTitle>
            {/* ⓘ — kim oluşturdu / en son kim değiştirdi (2026-08-19).
                Kaynak: kaydın KENDİ künye kolonları (Plan A). Audit'ten
                okunmuyor — audit 6 ayda arşivlenir, künye kaybolmamalı. */}
            {isEdit && initial && (
              <RecordInfoButton
                table="ITEM"
                id={initial.id}
                createdAt={initial.createdAt}
                updatedAt={initial.updatedAt}
              />
            )}
            </div>
          <DialogDescription>
            Ürün tanımı (kumaş · iplik · sarf). Birim, seçilen tipe göre otomatik atanır.
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
          {/* Sıra bilinçli: ÖNCE ad. Stok kodu forma EN ALTA, kapalı bir satır
              olarak alındı (2026-08-17 saha geri bildirimi) — ilk alan olduğu
              sürece personel "boş bırakın" yazsa da oraya kumaşın ADINI
              yazmaya çalışıyordu. Kodu sistem veriyor; elle giriş çok nadir
              ve artık bilinçli bir tıklama istiyor. */}
          <div className="grid grid-cols-[1fr_180px_120px] gap-3">
            <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
              <Input id="name" placeholder="Patos" {...form.register("name")} />
              {/* Canlı veride "ACTIVO" ve "ACTİVO" iki ayrı kumaş olarak duruyordu
                  (i/İ tuzağı) — uyarı yazarken görünsün. */}
              <SimilarNamesWarning
                entity="items"
                name={form.watch("name") ?? ""}
                excludeId={initial?.id}
              />
            </FormField>
            <FormField
              label="Tip"
              error={form.formState.errors.itemType}
              required={!isEdit}
              hint={isEdit ? "Değiştirilemez." : undefined}
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
            <FormField label="Birim" hint="Otomatik">
              <Input
                value={derivedUnit}
                readOnly
                tabIndex={-1}
                className="bg-muted font-mono text-center cursor-not-allowed"
              />
            </FormField>
          </div>

          {/* Denye yalnız iplikte sorulur: kumaş/sarf kaleminde karşılığı yok.
              Zorunlu DEĞİL — mevcut iplik kayıtları bu alan olmadan doğdu ve
              zorunlu yapmak onların düzenlenmesini kilitlerdi; çözgü kartı
              açarken sunucu zaten anlaşılır bir 400 veriyor. */}
          {itemType === ItemType.YARN && (
            <FormField
              label="Denye (iplik inceliği)"
              htmlFor="linearDensityDen"
              error={form.formState.errors.linearDensityDen}
              hint="Çözgü kartı açmak için gerekli — kg = tel × denye × metre ÷ 9.000.000"
            >
              <Input
                id="linearDensityDen"
                inputMode="decimal"
                placeholder="150"
                {...form.register("linearDensityDen")}
              />
            </FormField>
          )}

          {/* E4 (2026-09-18): kumaşın varsayılan çözgü kartı — dokuma işi formu ve sunucu ön-dolumu buradan okur;
              yalnız KUMAŞ + devere açıkken çizilir (kapalıyken alan hiç yok = bugünkü form). */}
          {itemType === ItemType.FABRIC && devereEnabled && (
            <FormField label="Varsayılan çözgü kartı (opsiyonel)" error={form.formState.errors.warpSpecId} hint="Dokuma işi açarken çözgü kartı bundan ön-dolar; boş = her işte elle seçilir">
              <Controller
                control={form.control}
                name="warpSpecId"
                render={({ field }) => (
                  <EntityPickerModal<WarpSpec>
                    value={field.value || null}
                    onChange={(id) => field.onChange(id ?? "")}
                    service={warpSpecService}
                    queryKey="warp-specs-item-default"
                    getLabel={(w) => w.name}
                    getSubLabel={(w) => w.code}
                    icon={Ruler}
                    nullable
                    noneLabel="Çözgü kartı yok"
                    placeholder="Çözgü kartı seç"
                  />
                )}
              />
            </FormField>
          )}

          {carriesLists && (
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
          )}

          {carriesLists && (
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
          )}

          {staleLists && (
            <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
              {itemTypeLabels[itemType]} kartında renk/özellik listesi tutulmaz, kaydedince kaldırılır.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("isActive")} /> Aktif
          </label>

          <StockCodeRow
            isEdit={isEdit}
            code={initial?.code ?? null}
            manual={manualCode}
            onManualChange={(next) => {
              setManualCode(next);
              // Otomatiğe dönerken alanı TEMİZLE — yarım yazılmış bir kod
              // görünmez halde payload'a gidip 409/validasyon hatası üretirdi.
              if (!next) form.setValue("code", "", { shouldValidate: true });
            }}
            error={form.formState.errors.code}
            register={form.register}
          />

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

/**
 * Stok kodu satırı — formun EN ALTINDA ve varsayılan KAPALI.
 *
 * Gerekçe (2026-08-17): alan formun ilk kutusuydu ve "boş bırakın, sistem
 * versin" ipucuna rağmen personel oraya kumaşın adını yazıyordu. Kapalı
 * durumda `<input>` HİÇ render edilmez — gri/disabled bir kutu bırakmak
 * "buraya bir şey yazılabilir" izlenimini sürdürürdü ve sekme sırasına da
 * girerdi. Elle giriş bilinçli bir tıklama ister.
 */
function StockCodeRow({
  isEdit,
  code,
  manual,
  onManualChange,
  error,
  register,
}: {
  isEdit: boolean;
  code: string | null;
  manual: boolean;
  onManualChange: (next: boolean) => void;
  error?: { message?: string };
  register: ReturnType<typeof useForm<ItemFormValues>>["register"];
}) {
  if (isEdit) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>Stok Kodu</span>
        <span className="font-mono text-foreground">{code ?? "—"}</span>
        <span className="ml-auto">Oluşturulduktan sonra değiştirilemez.</span>
      </div>
    );
  }

  if (!manual) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Stok kodunu <strong className="text-foreground">sistem verecek</strong>{" "}
          <span className="font-mono">(STK-000123)</span>
        </span>
        <button
          type="button"
          onClick={() => onManualChange(true)}
          className="ml-auto rounded px-2 py-0.5 underline underline-offset-2 transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Elle gir
        </button>
      </div>
    );
  }

  return (
    <FormField
      label="Stok Kodu (elle)"
      htmlFor="code"
      error={error}
      hint="STK- öneki otomatik kodlara ayrılmıştır; kendi kodunuzu yazın."
    >
      <div className="flex items-center gap-2">
        <Input id="code" autoFocus placeholder="ÖRN-001" {...register("code")} />
        <Button type="button" variant="outline" size="sm" onClick={() => onManualChange(false)}>
          Otomatiğe dön
        </Button>
      </div>
    </FormField>
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
