// =============================================================================
// FATURA LİSTESİ SORGUSU — GET /api/finance/invoices (fail-closed, G3f 2026-11-01)
// =============================================================================
// Süzgeci ELLE okuyan uç: tanınmayan parametre (ör. `?shipmentId` desteklenmeden
// önce) sessizce yok sayılıp TÜM liste dönüyordu — yanlış süzülmüş liste hiç
// süzülmemişten kötüdür ⇒ `.strict()` → 400. Panel yalnız page · pageSize ·
// search · type · status · cariId gönderir; `limit` sayfalama sözlüğündeki adıdır.
// =============================================================================
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import { z } from "zod";
import { readFilterList } from "../utils/query-parser";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const toDate = (v: string | undefined) => (v ? new Date(v) : undefined);
const uuidMessage = "Geçersiz kimlik (UUID bekleniyor).";

export const invoiceListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, "Sayfa 1 ya da büyük olmalı.").optional(),
    pageSize: z.coerce.number().int().min(1).max(200, "Sayfa boyu en çok 200.").optional(),
    /** `pageSize` eşanlamlısı (sayfalama sözlüğü `limit`); ikisi birden gelirse `pageSize` kazanır. */
    limit: z.coerce.number().int().min(1).max(200, "Sayfa boyu en çok 200.").optional(),
    search: z.string().max(200).optional(),
    type: z.enum(InvoiceType).optional(),
    status: z.enum(InvoiceStatus).optional(),
    cariId: z.string().uuid(uuidMessage).optional(),
    goodsReceiptId: z.string().uuid(uuidMessage).optional(),
    /** Sevkiyata bağlı faturalar; virgüllü liste kabul (`readIdCondition` sözleşmesi). */
    shipmentId: z
      .string()
      .max(400)
      // Boş liste (`?shipmentId=` / `,`) süzgeçsizliğe düşüp TÜM listeyi verirdi ⇒ red.
      .refine((v) => {
        const ids = readFilterList(v);
        return ids.length > 0 && ids.every((id) => z.string().uuid().safeParse(id).success);
      }, uuidMessage)
      .optional(),
    from: isoDate.optional().transform(toDate),
    to: isoDate.optional().transform(toDate),
  })
  .strict();

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
