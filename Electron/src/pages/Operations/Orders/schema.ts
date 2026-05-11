import { z } from "zod";

export const orderLineSchema = z.object({
  clientId: z.string(),
  itemId: z.string().min(1, "Ürün seç"),
  quantity: z.coerce.number().positive("Miktar pozitif olmalı"),
  width: z.union([z.coerce.number().positive(), z.literal("").transform(() => null), z.null()]).optional().nullable(),
  unitPrice: z.string().optional().or(z.literal("")),
  requiredPropertyIds: z.array(z.string()).optional().default([]),
});

export const orderFormSchema = z.object({
  customerId: z.string().min(1, "Müşteri seç"),
  branchId: z.string().nullable().optional(),
  currency: z.string().min(1).max(8),
  deadline: z.string().optional().or(z.literal("")),
  lines: z.array(orderLineSchema).min(1, "En az bir kalem gerekli"),
});

export type OrderLineFormValues = z.infer<typeof orderLineSchema>;
export type OrderFormValues = z.infer<typeof orderFormSchema>;

/** Otomatik sipariş no — submit sırasında üretilir, kullanıcı görmez. */
export function generateOrderNumber(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `ORD-${yy}${mm}${dd}-${hh}${min}${ss}`;
}

let lineCounter = 0;
export function newLineClientId(): string {
  lineCounter += 1;
  return `line-${Date.now()}-${lineCounter}`;
}

export const orderFormDefaults: OrderFormValues = {
  customerId: "",
  branchId: null,
  currency: "TRY",
  deadline: "",
  lines: [
    {
      clientId: newLineClientId(),
      itemId: "",
      quantity: 0,
      width: null,
      unitPrice: "",
      requiredPropertyIds: [],
    },
  ],
};
