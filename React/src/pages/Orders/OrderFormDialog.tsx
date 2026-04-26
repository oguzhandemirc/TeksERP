import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Order } from "@/types/models";
import { customerService } from "@/services/customerService";
import { itemService } from "@/services/itemService";

const orderSchema = z.object({
  customerId: z.string().min(1, "Müşteri seçiniz"),
  currency:   z.string().min(1, "Para birimi zorunludur"),
  deadline:   z.string().optional(),
});

type OrderFormValues = z.infer<typeof orderSchema>;

interface OrderLineEntry {
  itemId:    string;
  variantId: string;
  quantity:  string;
  unitPrice: string;
  width:     string;   // En (cm)
}

interface OrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onSubmit: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}

const currencyOptions = [
  { value: "TRY", label: "TRY (₺)" },
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
];

function VariantSelect({ itemId, value, onChange }: { itemId: string; value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ["items", itemId, "variants"],
    queryFn: () => itemService.getVariants(itemId),
    enabled: !!itemId,
  });
  const opts = data?.data?.map((v) => ({ value: v.id, label: `${v.code} - ${v.name}` })) ?? [];
  
  // Eğer varyantlar varsa, bir "Varyant Yok" seçeneği ekleyelim ki seçimi temizleyebilsinler
  const finalOpts = opts.length > 0 ? [{ value: "", label: "--- Varyant Yok ---" }, ...opts] : opts;

  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={finalOpts}
      placeholder={itemId ? (opts.length > 0 ? "Varyant/Desen Seçiniz" : "Bu Ürünün Varyantı Yok") : "Önce Ürün Seçin"}
      disabled={!itemId || opts.length === 0}
    />
  );
}

export default function OrderFormDialog({
  open,
  onOpenChange,
  order,
  onSubmit,
  isLoading,
}: OrderFormDialogProps) {
  const isEdit = !!order;
  const [lines, setLines] = useState<OrderLineEntry[]>([]);

  const { data: customersData } = useQuery({
    queryKey: ["customers", "all-active"],
    queryFn: () =>
      customerService.getAll({
        page: 1, pageSize: 500, sortBy: "name", sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  const { data: itemsData } = useQuery({
    queryKey: ["items", "all-active"],
    queryFn: () =>
      itemService.getAll({
        page: 1, pageSize: 500, sortBy: "code", sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  const customerOptions =
    customersData?.data?.map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })) ?? [];
  const itemOptions =
    itemsData?.data?.map((i) => ({ value: i.id, label: `${i.code} - ${i.name}` })) ?? [];

  const { register, handleSubmit, reset, formState: { errors } } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: { customerId: "", currency: "TRY", deadline: "" },
  });

  useEffect(() => {
    if (open) {
      if (order) {
        reset({
          customerId: order.customerId,
          currency:   order.currency,
          deadline:   order.deadline
            ? new Date(order.deadline).toISOString().slice(0, 10)
            : "",
        });
        setLines(
          order.lines?.map((l) => ({
            itemId:    l.itemId,
            variantId: l.variantId ?? "",
            quantity:  String(l.quantity),
            unitPrice: l.unitPrice != null ? String(l.unitPrice) : "",
            width:     l.width != null ? String(l.width) : "",
          })) ?? [],
        );
      } else {
        reset({ customerId: "", currency: "TRY", deadline: "" });
        setLines([]);
      }
    }
  }, [open, order, reset]);

  const addLine = () =>
    setLines((prev) => [...prev, { itemId: "", variantId: "", quantity: "", unitPrice: "", width: "" }]);

  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const updateLine = (index: number, field: keyof OrderLineEntry, value: string) =>
    setLines((prev) => prev.map((line, i) => {
      if (i === index) {
        if (field === "itemId" && line.itemId !== value) {
          return { ...line, [field]: value, variantId: "" };
        }
        return { ...line, [field]: value };
      }
      return line;
    }));

  const handleFormSubmit = (data: OrderFormValues) => {
    const validLines = lines
      .filter((l) => l.itemId && l.quantity)
      .map((l) => ({
        itemId:    l.itemId,
        variantId: l.variantId || undefined,
        quantity:  Number(l.quantity),
        unitPrice: l.unitPrice ? Number(l.unitPrice) : undefined,
        width:     l.width     ? Number(l.width)     : undefined,
      }));

    const deadline = data.deadline ? new Date(data.deadline).toISOString() : undefined;

    if (isEdit) {
      onSubmit({
        customerId: data.customerId,
        currency:   data.currency,
        deadline,
        lines: { deleteMany: {}, create: validLines },
      });
    } else {
      onSubmit({
        customerId: data.customerId,
        currency:   data.currency,
        deadline,
        ...(validLines.length > 0 && { lines: validLines }),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Sipariş Düzenle" : "Yeni Sipariş"}</DialogTitle>
          {isEdit && order && (
            <p className="text-sm text-muted-foreground">
              Sipariş No: <span className="font-medium">{order.orderNumber}</span>
            </p>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Müşteri */}
            <div className="space-y-2">
              <Label htmlFor="customerId" error={!!errors.customerId}>Müşteri</Label>
              <Select
                id="customerId"
                {...register("customerId")}
                options={customerOptions}
                placeholder="Müşteri seçiniz"
              />
              {errors.customerId && (
                <p className="text-sm text-destructive">{errors.customerId.message}</p>
              )}
            </div>

            {/* Para Birimi */}
            <div className="space-y-2">
              <Label htmlFor="currency" error={!!errors.currency}>Para Birimi</Label>
              <Select
                id="currency"
                {...register("currency")}
                options={currencyOptions}
              />
            </div>

            {/* Termin */}
            <div className="space-y-2">
              <Label htmlFor="deadline">Termin Tarihi</Label>
              <Input id="deadline" type="date" {...register("deadline")} />
            </div>
          </div>

          {/* ── Sipariş Kalemleri ──────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Sipariş Kalemleri</Label>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" />
                Kalem Ekle
              </Button>
            </div>

            {lines.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                Henüz kalem eklenmedi.
              </p>
            )}

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1fr_90px_80px_80px_36px] items-end gap-2 rounded-md border p-2"
                >
                  {/* Ürün */}
                  <div className="space-y-1">
                    {index === 0 && <span className="text-xs text-muted-foreground">Ürün</span>}
                    <Select
                      value={line.itemId}
                      onChange={(e) => updateLine(index, "itemId", e.target.value)}
                      options={itemOptions}
                      placeholder="Ürün"
                    />
                  </div>

                  {/* Varyant / Desen */}
                  <div className="space-y-1 min-w-0">
                    {index === 0 && <span className="text-xs text-muted-foreground">Varyant/Desen</span>}
                    <VariantSelect
                      itemId={line.itemId}
                      value={line.variantId}
                      onChange={(v) => updateLine(index, "variantId", v)}
                    />
                  </div>

                  {/* Miktar */}
                  <div className="space-y-1">
                    {index === 0 && <span className="text-xs text-muted-foreground">Miktar (mt)</span>}
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => updateLine(index, "quantity", e.target.value)}
                      placeholder="mt"
                    />
                  </div>

                  {/* En (cm) */}
                  <div className="space-y-1">
                    {index === 0 && <span className="text-xs text-muted-foreground">En (cm)</span>}
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={line.width}
                      onChange={(e) => updateLine(index, "width", e.target.value)}
                      placeholder="cm"
                    />
                  </div>

                  {/* Birim Fiyat */}
                  <div className="space-y-1">
                    {index === 0 && <span className="text-xs text-muted-foreground">B.Fiyat</span>}
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(index, "unitPrice", e.target.value)}
                      placeholder="₺"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(index)}
                    className="self-end"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" isLoading={isLoading}>
              {isEdit ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
