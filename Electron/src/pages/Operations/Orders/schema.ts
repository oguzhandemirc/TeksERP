import { z } from "zod";

export const orderLineSchema = z.object({
  clientId: z.string(),
  itemId: z.string().min(1, "Kumaş seçilmeli"),
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
    .max(200, "Müşterideki kumaş adı en fazla 200 karakter olabilir")
    .optional()
    .or(z.literal("")),
  customerColorName: z
    .string()
    .max(200, "Müşterideki renk adı en fazla 200 karakter olabilir")
    .optional()
    .or(z.literal("")),
  requiredPropertyIds: z.array(z.string()).optional().default([]),
  cutNote: z
    .string()
    .max(500, "Kesim notu en fazla 500 karakter olabilir")
    .optional()
    .or(z.literal("")),
});

export const orderFormSchema = z.object({
  // Saha #16: boş bırakılırsa backend otomatik üretir (SIP + GGAAYY + NNNN,
  // örn. SIP1307260001); elle girilirse o numara kullanılır (benzersizlik
  // backend'de doğrulanır).
  orderNumber: z
    .string()
    .trim()
    .max(40, "Sipariş numarası en fazla 40 karakter olabilir")
    .optional()
    .or(z.literal("")),
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

let lineCounter = 0;
export function newLineClientId(): string {
  lineCounter += 1;
  return `line-${Date.now()}-${lineCounter}`;
}

export const orderFormDefaults: OrderFormValues = {
  orderNumber: "",
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
      cutNote: "",
    },
  ],
};
