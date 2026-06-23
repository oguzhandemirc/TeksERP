// =============================================================================
// TeksERP - Barcode Sequence Collision Retry
// =============================================================================
// Refakat kartı ve kartela barkodları aylık sequence ile üretiliyor:
// `findFirst(orderBy desc) + 1`. İki paralel istek aynı `n`'i hesaplayıp
// ikinci INSERT'te @unique constraint (P2002) ile çakışabilir. Bu yardımcı
// verilen işlemi P2002 alındığında baştan çalıştırır — yeni sequence okunur.
// =============================================================================

import { Prisma } from "@prisma/client";
import { AppError } from "./app-error";

const MAX_ATTEMPTS = 5;

export async function withBarcodeRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_ATTEMPTS,
  // Opsiyonel: hangi P2002'nin RETRY edileceğini seçer. Verilmezse TÜM P2002 retry
  // edilir (geriye uyumlu — barkod/kartNumarası sequence çakışması). Bir iş-anahtarı
  // partial unique'i (ör. WO başına tek-ACTIVE-kart) retry'a girmemeli — koleksiyon
  // kalıcıdır, retry boşa döner; predicate false dönerse o P2002 propagate olur ve
  // çağıran (print/reprint) onu anlamlı 409'a çevirir.
  isRetryable?: (err: Prisma.PrismaClientKnownRequestError) => boolean
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isP2002 =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (!isP2002) throw err;
      if (isRetryable && !isRetryable(err)) throw err;
      // Retry edilebilir P2002 — bir sonraki denemede findFirst büyümüş `lastSeq`'i
      // okur. Son denemeye kadar düşmediyse aşağıda 409 fırlatılır.
    }
  }
  throw AppError.conflict(
    `Barkod üretimi ${maxAttempts} denemede başarısız oldu, lütfen tekrar deneyin.`
  );
}
