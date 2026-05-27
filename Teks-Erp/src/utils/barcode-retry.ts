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
  maxAttempts: number = MAX_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";
      if (!isCollision) throw err;
      // P2002 — barkod/kartNumarası sequence çakışması; bir sonraki denemede
      // findFirst yeniden çalışır ve büyümüş `lastSeq`'i okur. Son denemeye
      // kadar düşmediyse aşağıda 409 fırlatılır.
    }
  }
  throw AppError.conflict(
    `Barkod üretimi ${maxAttempts} denemede başarısız oldu, lütfen tekrar deneyin.`
  );
}
