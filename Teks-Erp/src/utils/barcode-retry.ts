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

/**
 * P2002'nin hedefi KOD kolonu mu — yalnız o retry'a değer (taze sıra no ile çözülür). Başka bir tekillik
 * (ör. `nameFold` canlı seddi, vergi no) retry ile ÇÖZÜLMEZ: beş deneme boşa döner ve operatör yanıltıcı
 * "Barkod üretimi 5 denemede başarısız" 409'u görür (ölçüldü 2026-09-18: kalıntı kart aynı adla ikinci
 * koşumda tam bunu üretti). Hedef Prisma'da dizi (`["code"]`) ya da index adı string'i olabilir.
 */
export function p2002TargetsCode(err: Prisma.PrismaClientKnownRequestError, codeField = "code"): boolean {
  const parts = p2002TargetParts(err);
  if (parts.length === 0) return true; // hedef bilinmiyor → geriye uyumlu: retry
  return parts.some((p) => p === codeField || p.toLowerCase().includes(`_${codeField.toLowerCase()}_`) || p.toLowerCase().endsWith(`_${codeField.toLowerCase()}_key`));
}

/**
 * P2002 hedefinin parçaları. ⚠️ pg sürücü adaptörü (Prisma 7) `meta.target` VERMEZ; hedef
 * `meta.driverAdapterError.cause.constraint.fields` ve `originalMessage`taki kısıt adındadır.
 * Yalnız `target`e bakan yüklem her çakışmayı "hedef bilinmiyor → retry" sayıyordu: içerik/ad
 * tekilliği beş kez denenip yanıltıcı 409'la bitiyordu (ölçüldü 2026-09-23, çeki listesi yarışı).
 */
function p2002TargetParts(err: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = (err.meta ?? {}) as { target?: unknown; driverAdapterError?: { cause?: { constraint?: unknown; originalMessage?: unknown } } };
  const t = meta.target;
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === "string") return [t];
  const cause = meta.driverAdapterError?.cause;
  const parts: string[] = [];
  const c = cause?.constraint as { fields?: unknown; index?: unknown } | string | undefined;
  if (typeof c === "string") parts.push(c);
  else if (c && Array.isArray(c.fields)) parts.push(...c.fields.map((f) => String(f).replace(/"/g, "")));
  else if (c && typeof c.index === "string") parts.push(c.index);
  const m = typeof cause?.originalMessage === "string" ? /constraint "([^"]+)"/.exec(cause.originalMessage) : null;
  if (m) parts.push(m[1]!);
  return parts;
}

export async function withBarcodeRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_ATTEMPTS,
  // Opsiyonel: hangi P2002'nin RETRY edileceğini seçer. Verilmezse TÜM P2002 retry
  // edilir (geriye uyumlu — barkod/kartNumarası sequence çakışması). Bir iş-anahtarı
  // partial unique'i (ör. WO başına tek-ACTIVE-kart) retry'a girmemeli — koleksiyon
  // kalıcıdır, retry boşa döner; predicate false dönerse o P2002 propagate olur ve
  // çağıran (print/reprint) onu anlamlı 409'a çevirir.
  isRetryable?: (err: Prisma.PrismaClientKnownRequestError) => boolean,
  // Tükenme mesajındaki NESNE — çağıran barkod üretmiyorsa ("İndirme kodu")
  // operatör yanlış şeyi aramasın. Verilmezse tarihsel metin.
  subject: string = "Barkod",
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
      //
      // ⚠️ JITTER'LI BEKLEME (2026-08-09 denetimi, F-URE-ESZ-001). Eskiden hiç
      // bekleme yoktu: çakışan iki istek BEKLEMEDEN yeniden koşuyor ve aynı
      // mikrosaniye penceresinde TEKRAR çarpışabiliyordu (livelock eğilimi) —
      // beş deneme de tükenirse kullanıcı "Barkod üretimi 5 denemede başarısız
      // oldu" 409'unu alır ve neyi yanlış yaptığını anlamaz. Rastgelelik ŞART:
      // sabit bekleme iki isteği aynı ritimde tutar, yani çarpışmayı çözmez,
      // erteler. Süre kasten küçük (5-30 ms) — tek kullanıcıya görünmez, ama
      // iki isteği birbirinden ayırmaya yeter.
      //
      // ⚠️ SON DENEMEDEN SONRA BEKLEME YOK: döngü bitiyorsa beklemek yalnız
      // hata mesajını geciktirir.
      if (attempt < maxAttempts) {
        const jitterMs = 5 + Math.floor(Math.random() * 25);
        await new Promise((resolve) => setTimeout(resolve, jitterMs));
      }
    }
  }
  throw AppError.conflict(
    `${subject} üretimi ${maxAttempts} denemede başarısız oldu, lütfen tekrar deneyin.`
  );
}
