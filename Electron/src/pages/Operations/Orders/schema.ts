import { z } from "zod";

export const orderLineSchema = z.object({
  clientId: z.string(),
  itemId: z.string().min(1, "Ürün seçilmeli"),
  colorId: z.string().nullable().optional(),
  quantity: z.coerce.number().positive("Miktar 0'dan büyük olmalı"),
  width: z
    .union([
      z.coerce.number().positive("En 0'dan büyük olmalı"),
      z.literal("").transform(() => null),
      z.null(),
    ])
    .optional()
    .nullable(),
  unitPrice: z.string().optional().or(z.literal("")),
  customerItemName: z
    .string()
    .max(200, "Müşterideki ürün adı en fazla 200 karakter olabilir")
    .optional()
    .or(z.literal("")),
  customerColorName: z
    .string()
    .max(200, "Müşterideki renk adı en fazla 200 karakter olabilir")
    .optional()
    .or(z.literal("")),
  requiredPropertyIds: z.array(z.string()).optional().default([]),
});

export const orderFormSchema = z.object({
  customerId: z.string().min(1, "Müşteri seçilmeli"),
  branchId: z.string().nullable().optional(),
  currency: z
    .string()
    .trim()
    .min(1, "Para birimi boş bırakılamaz")
    .max(8, "Para birimi en fazla 8 karakter olabilir"),
  deadline: z.string().optional().or(z.literal("")),
  lines: z
    .array(orderLineSchema)
    .min(1, "Sipariş en az bir kalem içermeli"),
});

export type OrderLineFormValues = z.infer<typeof orderLineSchema>;
export type OrderFormValues = z.infer<typeof orderFormSchema>;

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
      colorId: null,
      quantity: 0,
      width: null,
      unitPrice: "",
      customerItemName: "",
      customerColorName: "",
      requiredPropertyIds: [],
    },
  ],
};
