import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { UserRound } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { customerService } from "@/pages/Customers/service";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { CustomerFormDialog } from "@/pages/Customers/CustomerFormDialog";
import type { Customer } from "@/pages/Customers/types";
import type { CustomerFormValues } from "@/pages/Customers/schema";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { usePulseSync } from "@/hooks/usePulseSync";
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
      cutNote: l.cutNote ?? "",
    })),
  };
}

export function OrderFormDialog({ open, onOpenChange, order, onSubmit, isSubmitting }: Props) {
  const qc = useQueryClient();
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  // Müşteri seçici, kalem alanları ve "Kalem Ekle" butonu aynı paylaşılan saatten
  // beslenir ([[usePulseSync]]) — hepsi aynı hız + aynı fazda yanıp söner.
  const dim = usePulseSync();

  const createCustomerMut = useMutation({
    mutationFn: (payload: Partial<Customer>) => customerService.create(payload),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["customers"] });
      const created = res.data;
      if (created?.id) {
        form.setValue("customerId", created.id);
        form.setValue("branchId", null);
        toast.success(`Müşteri oluşturuldu: ${created.name}`);
      }
      setCustomerFormOpen(false);
    },
  });

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
    <>
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
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Müşteri"
              error={form.formState.errors.customerId}
              required
            >
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <EntityPickerModal<Customer>
                    value={field.value || null}
                    onChange={(v) => {
                      field.onChange(v ?? "");
                      form.setValue("branchId", null);
                    }}
                    service={customerService}
                    queryKey="order-customer"
                    getLabel={(c) => c.name}
                    getSubLabel={(c) => (c.taxNumber ? `${c.code} · VKN ${c.taxNumber}` : c.code)}
                    icon={UserRound}
                    iconClassName="text-primary"
                    title="Müşteri Seç"
                    description="Müşteri seç veya aramayla daralt — tüm liste sunucuda aranır (ad, kod, vergi no)."
                    placeholder="Müşteri seç..."
                    disabled={headerLocked}
                    triggerClassName={!field.value ? `h-9 border-primary shadow-lg shadow-primary/50 ring-2 ring-primary/30 transition-all duration-700 ${dim ? "opacity-50" : "opacity-100"}` : "h-9"}
                    quickAddLabel="Yeni Müşteri Ekle"
                    onQuickAdd={() => setCustomerFormOpen(true)}
                    countLabel="müşteri"
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
            <FormField label="Termin" error={form.formState.errors.deadline}>
              <Controller
                control={form.control}
                name="deadline"
                render={({ field }) => (
                  <DatePickerInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    placeholder="Boş bırakılırsa varsayılan N gün"
                  />
                )}
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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    lineErrors={form.formState.errors.lines as any}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive">
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting} className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 hover:shadow-emerald-500/40 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150">
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

    <CustomerFormDialog
      open={customerFormOpen}
      onOpenChange={setCustomerFormOpen}
      isSubmitting={createCustomerMut.isPending}
      onSubmit={(v: CustomerFormValues) => {
        createCustomerMut.mutate({
          code: generateCode(CODE_PREFIXES.CUSTOMER),
          name: v.name,
          taxNumber: v.taxNumber || null,
          type: v.type,
          isActive: true,
        } as Partial<Customer>);
      }}
    />
    </>
  );
}
