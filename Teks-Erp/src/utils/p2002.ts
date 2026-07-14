import { Prisma } from "@prisma/client";

/**
 * P2002 (unique violation) hatasının HANGİ constraint'ten geldiğini ayırt etme
 * yardımcıları. Prisma v6/v7 + @prisma/adapter-pg kombinasyonunda constraint adı
 * üç farklı meta kaynağında gelebilir (F61 deseni, workorder.service create'ten
 * çıkarıldı): `meta.target`, `meta.driverAdapterError.cause.constraint`,
 * `...cause.originalMessage`. Üçü birleştirilip regex ile test edilir.
 */
export function p2002Mentions(err: unknown, re: RegExp): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false;
  }
  const meta = (err.meta ?? {}) as Record<string, unknown>;
  const target = JSON.stringify(meta.target ?? "");
  const driver = meta.driverAdapterError as
    | { cause?: { constraint?: unknown; originalMessage?: unknown } }
    | undefined;
  const constraint =
    typeof driver?.cause?.constraint === "string" ? driver.cause.constraint : "";
  const orig =
    typeof driver?.cause?.originalMessage === "string" ? driver.cause.originalMessage : "";
  return re.test(target + constraint + orig);
}

/**
 * P2002 clientToken unique'inden mi geldi? (orders/work_orders/swatch_stock_reductions
 * — constraint adlarının tümü "clientToken" içerir.)
 *
 * withBarcodeRetry ile etkileşim kuralı: clientToken P2002'si RETRY EDİLMEZ —
 * retry her denemede aynı token'ı yazacağından 5 tur boşa döner ve yanıltıcı
 * "Barkod üretimi 5 denemede başarısız" hatası üretirdi. Predicate'lerde
 * `!isClientTokenP2002(err)` ile dışarı propagate edilir; dış catch cached
 * (idempotent retry) yanıtına çevirir.
 */
export function isClientTokenP2002(err: unknown): boolean {
  return p2002Mentions(err, /clientToken/i);
}
