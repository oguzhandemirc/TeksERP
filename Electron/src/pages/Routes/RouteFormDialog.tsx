import { useEffect, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Star, Copy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { RouteStepEditor } from "./RouteStepEditor";
import { routeService } from "./service";
import {
  newClientId,
  routeFormDefaults,
  routeFormSchema,
  type RouteFormValues,
} from "./schema";
import type { ProductionRoute } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: ProductionRoute | null;
  onSubmit: (values: RouteFormValues) => Promise<void>;
  isSubmitting?: boolean;
}

// Rota adımını forma çevir — fason planlaması (Saha #14) dahil. EXTERNAL adımda
// kategori kayıtlı değilse istasyonun varsayılan kategorisine düşer.
function stepToForm(s: ProductionRoute["steps"][number]) {
  const isExternal = s.station?.type === "EXTERNAL";
  return {
    clientId: newClientId(),
    stationId: s.stationId,
    defaultNotes: s.defaultNotes ?? "",
    stationType: s.station?.type,
    requiredCategoryId: isExternal
      ? s.requiredCategoryId ?? s.station?.defaultCategoryId ?? null
      : null,
    plannedSubcontractorId: isExternal ? s.plannedSubcontractorId ?? null : null,
  };
}

function buildDefaults(initial?: ProductionRoute | null): RouteFormValues {
  if (!initial) return routeFormDefaults;
  return {
    name: initial.name,
    description: initial.description ?? "",
    customerId: initial.customerId,
    isFavorite: initial.isFavorite,
    isActive: initial.isActive,
    steps: [...initial.steps].sort((a, b) => a.sequence - b.sequence).map(stepToForm),
  };
}

function buildCopyValues(source: ProductionRoute): RouteFormValues {
  return {
    name: `${source.name} (kopya)`,
    description: source.description ?? "",
    customerId: source.customerId,
    isFavorite: false,
    isActive: true,
    steps: [...source.steps].sort((a, b) => a.sequence - b.sequence).map(stepToForm),
  };
}

export function RouteFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(initial);

  const form = useForm<RouteFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(routeFormSchema as any) as unknown as Resolver<RouteFormValues>,
    defaultValues: buildDefaults(initial),
  });

  const [stepsError, setStepsError] = useState<string | null>(null);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      form.reset(buildDefaults(initial));
      setStepsError(null);
      setCopySourceId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // "Şuradan kopyala" — yalnızca yeni rota oluştururken aktif.
  // Seçilen rotanın detayını çek, sonra formu reset et.
  const copySourceQuery = useQuery({
    queryKey: ["routes", "copy-source", copySourceId],
    queryFn: () => routeService.getById(copySourceId as string),
    enabled: !isEdit && !!copySourceId,
  });

  useEffect(() => {
    if (!copySourceId) return;
    const source = copySourceQuery.data?.data;
    if (!source) return;
    form.reset(buildCopyValues(source));
    setStepsError(null);
    toast.success(`"${source.name}" rotası kopyalandı — adı ve adımları düzenleyebilirsin.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copySourceQuery.data?.data, copySourceId]);

  const handleSubmit = form.handleSubmit(
    async (values) => {
      await onSubmit(values);
    },
    (errors) => {
      if (errors.steps) setStepsError(errors.steps.message ?? "Adımlarda hata var.");
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rotayı Düzenle" : "Yeni Üretim Rotası"}</DialogTitle>
          <DialogDescription>
            İş emrinde kullanılacak istasyon sırasını tanımla. Adımlar sürüklenip yeniden sıralanabilir.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isEdit && initial?.code && (
            <div className="text-xs text-muted-foreground">
              Kod: <span className="font-mono">{initial.code}</span>
            </div>
          )}

          {!isEdit && (
            <FormField
              label="Şuradan kopyala"
              hint="Mevcut bir rotayı seç — ad, açıklama, müşteri ve tüm adımlar forma yüklenir. İstediğin gibi düzenle, yeni kayıt olarak kaydet."
            >
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <ReferenceSelect<ProductionRoute>
                    value={copySourceId}
                    onChange={(id) => setCopySourceId(id)}
                    service={routeService}
                    queryKey="routes"
                    getLabel={(r) =>
                      r.customer ? `${r.name} — ${r.customer.name}` : r.name
                    }
                    placeholder={copySourceQuery.isFetching ? "Yükleniyor..." : "Sıfırdan başla"}
                    nullable
                    noneLabel="— Sıfırdan başla"
                  />
                </div>
              </div>
            </FormField>
          )}

          <FormField label="Ad" htmlFor="name" error={form.formState.errors.name} required>
            <Input id="name" autoFocus placeholder="Boyahane + Kurşun + Tambur" {...form.register("name")} />
          </FormField>

          <FormField label="Açıklama" htmlFor="description" error={form.formState.errors.description}>
            <Input id="description" placeholder="Opsiyonel" {...form.register("description")} />
          </FormField>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Müşteri (opsiyonel)" hint="Müşteriye özel default rota">
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <ReferenceSelect<Customer>
                    value={field.value}
                    onChange={field.onChange}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => `${c.code} — ${c.name}`}
                    placeholder="Müşteri seç..."
                    nullable
                    noneLabel="— Tüm müşteriler"
                  />
                )}
              />
            </FormField>
            <FormField label="Bayraklar">
              <div className="flex h-9 items-center gap-4">
                <Controller
                  control={form.control}
                  name="isFavorite"
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                      <Star
                        className={
                          field.value
                            ? "h-3.5 w-3.5 fill-yellow-400 text-yellow-400"
                            : "h-3.5 w-3.5 text-muted-foreground"
                        }
                      />
                      Favori
                    </label>
                  )}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" {...form.register("isActive")} />
                  Aktif
                </label>
              </div>
            </FormField>
          </div>

          <div className="border-t pt-4">
            <Controller
              control={form.control}
              name="steps"
              render={({ field, fieldState }) => (
                <RouteStepEditor
                  value={field.value}
                  onChange={(next) => {
                    field.onChange(next);
                    if (next.length > 0) setStepsError(null);
                  }}
                  error={stepsError ?? fieldState.error?.message}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
