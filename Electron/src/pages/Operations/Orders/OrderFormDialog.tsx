import { useEffect, useMemo } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import type { Customer } from "@/pages/Customers/types";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { currencyService } from "@/services/featureFlagService";
import { OrderLinesEditor } from "./OrderLinesEditor";
import type { Order } from "./types";
import {
  newLineClientId,
  orderFormDefaults,
  orderFormSchema,
  type OrderFormValues,
} from "./schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode: doluysa pre-fill + header-only update. Yoksa create. */
  order?: Order | null;
  onSubmit: (values: OrderFormValues) => Promise<void>;
  isSubmitting?: boolean;
}

function orderToFormValues(order: Order): OrderFormValues {
  return {
    customerId: order.customerId,
    branchId: order.branchId,
    currency: order.currency,
    deadline: order.deadline ? order.deadline.slice(0, 10) : "",
    lines: order.lines.map((l) => ({
      clientId: l.id ?? newLineClientId(),
      itemId: l.itemId,
      colorId: l.colorId,
      quantity: l.quantity,
      width: l.width,
      unitPrice: l.unitPrice ?? "",
      customerItemName: l.customerItemName ?? "",
      customerColorName: l.customerColorName ?? "",
      requiredPropertyIds: (l.requiredProperties ?? []).map((p) => p.propertyId),
    })),
  };
}

export function OrderFormDialog({ open, onOpenChange, order, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(order);
  const partialShipped = order?.status === "PARTIAL_SHIPPED";
  const headerLocked = partialShipped;
  // Kalem düzenleme: PARTIAL_SHIPPED değil + hiçbir kalem aktif (CANCELLED dışı)
  // bir WO'ya bağlı değil. Aksi halde kalemler kilitli — bilgi notu gösterilir.
  const linesEditable =
    !isEdit ||
    (!partialShipped &&
      (order?.lines ?? []).every((l) =>
        (l.workOrderLinks ?? []).every((link) => link.workOrder.status === "CANCELLED"),
      ));
  const pricingEnabled = usePricingEnabled();

  const currenciesQ = useQuery({
    queryKey: ["currencies"],
    queryFn: () => currencyService.list(),
    enabled: pricingEnabled,
    staleTime: 60 * 60 * 1000,
  });

  const form = useForm<OrderFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(orderFormSchema as any) as unknown as Resolver<OrderFormValues>,
    defaultValues: orderFormDefaults,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(order ? orderToFormValues(order) : orderFormDefaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const lineSummary = useMemo(() => {
    if (!order) return "";
    const totalQty = order.lines.reduce((acc, l) => acc + Number(l.quantity), 0);
    return `${order.lines.length} kalem · toplam ${totalQty.toLocaleString("tr-TR")} m`;
  }, [order]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`flex max-h-[85vh] flex-col ${pricingEnabled ? "max-w-5xl" : "max-w-3xl"}`}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? "Sipariş Düzenle" : "Yeni Sipariş"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? partialShipped
                ? "Sipariş kısmi sevk edilmiş — sadece termin güncellenebilir."
                : linesEditable
                  ? "İş emri açılmadığı için kalemler hâlâ düzenlenebilir."
                  : "İş emri açılmış — sadece üst-düzey alanlar güncellenebilir."
              : "Müşteri sipariş bilgisi + en az bir kalem. Sipariş numarası otomatik atanır."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(async (v) => {
            await onSubmit(v);
          })}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField
              label="Müşteri"
              error={form.formState.errors.customerId}
              required
              className="sm:col-span-2"
            >
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <ReferenceSelect<Customer>
                    value={field.value || undefined}
                    onChange={(v) => {
                      field.onChange(v ?? "");
                      form.setValue("branchId", null);
                    }}
                    service={customerService}
                    queryKey="customers"
                    getLabel={(c) => c.name}
                    placeholder="Müşteri seç..."
                    disabled={headerLocked}
                  />
                )}
              />
            </FormField>
            <FormField label="Şube" error={form.formState.errors.branchId}>
              <Controller
                control={form.control}
                name="branchId"
                render={({ field }) => (
                  <BranchSelect
                    customerId={form.watch("customerId") || null}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={headerLocked}
                  />
                )}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <FormField label="Termin" htmlFor="deadline" error={form.formState.errors.deadline}>
              <Input
                id="deadline"
                type="date"
                placeholder="Boş bırakılırsa varsayılan N gün"
                {...form.register("deadline")}
              />
            </FormField>
            {pricingEnabled && (
              <FormField
                label="Para Birimi"
                htmlFor="currency"
                error={form.formState.errors.currency}
                required
              >
                <Controller
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <select
                      id="currency"
                      value={field.value}
                      onChange={field.onChange}
                      disabled={headerLocked}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {(currenciesQ.data?.data ?? [{ code: "TRY", name: "TRY", symbol: "₺" }]).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </FormField>
            )}
          </div>

          {linesEditable ? (
            <div className="border-t pt-3">
              <Controller
                control={form.control}
                name="lines"
                render={({ field, fieldState }) => (
                  <OrderLinesEditor
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                    customerId={form.watch("customerId") || null}
                  />
                )}
              />
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Kalemler kilitli</span> · {lineSummary}.
              İş emri açılmış kalemleri değiştirmek için önce iş emrini iptal et.
            </div>
          )}
          </div>

          <DialogFooter className="shrink-0 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? isEdit
                  ? "Güncelleniyor..."
                  : "Oluşturuluyor..."
                : isEdit
                  ? "Güncelle"
                  : "Sipariş Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
