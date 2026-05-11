import { useEffect, useMemo } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import type { Customer } from "@/pages/Customers/types";
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
      quantity: l.quantity,
      width: l.width,
      unitPrice: l.unitPrice ?? "",
      requiredPropertyIds: (l.requiredProperties ?? []).map((p) => p.propertyId),
    })),
  };
}

export function OrderFormDialog({ open, onOpenChange, order, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(order);
  const partialShipped = order?.status === "PARTIAL_SHIPPED";
  const headerLocked = partialShipped;

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
    const totalQty = order.lines.reduce((acc, l) => acc + l.quantity, 0);
    return `${order.lines.length} kalem · toplam ${totalQty.toLocaleString("tr-TR")} m`;
  }, [order]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sipariş Düzenle" : "Yeni Sipariş"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? partialShipped
                ? "Sipariş kısmi sevk edilmiş — sadece termin güncellenebilir."
                : "Üst-düzey alanlar güncellenebilir. Kalemler için iptal + yeniden oluştur."
              : "Müşteri sipariş bilgisi + en az bir kalem. Sipariş numarası otomatik atanır."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(async (v) => {
            await onSubmit(v);
          })}
          className="space-y-3"
        >
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
              <Input id="deadline" type="date" {...form.register("deadline")} />
            </FormField>
            <FormField label="Para Birimi" htmlFor="currency" error={form.formState.errors.currency} required>
              <Input
                id="currency"
                {...form.register("currency")}
                disabled={headerLocked}
              />
            </FormField>
          </div>

          {isEdit ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Kalemler kilitli</span> · {lineSummary}.
              Değiştirmek için bu siparişi iptal edip yeniden oluştur.
            </div>
          ) : (
            <div className="border-t pt-3">
              <Controller
                control={form.control}
                name="lines"
                render={({ field, fieldState }) => (
                  <OrderLinesEditor
                    value={field.value}
                    onChange={field.onChange}
                    error={fieldState.error?.message}
                  />
                )}
              />
            </div>
          )}

          <DialogFooter>
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
