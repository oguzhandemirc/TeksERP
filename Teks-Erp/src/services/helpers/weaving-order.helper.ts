// =============================================================================
// DOKUMA İŞİ — numara sayacı kilidi (tek kaynak)
// =============================================================================
// `WeavingOrder.weavingOrderNumber` sıralı bir sayaçtır ve `workOrderNumber`
// emsalini izler: sequence okuma tx İÇİNDE, çakışmada `withBarcodeRetry`.
//
// ⚠️ ADVISORY KİLİT TX'İN İLK İFADESİDİR. Sonra alınan kilit hiçbir şey
// kazandırmaz (TOCTOU): sayaç okunduktan sonra kilitlemek, iki tx'in aynı
// numarayı okumasını engellemez — yalnız ikisinin sırayla YAZMASINI sağlar ve
// mükerrer numara yine doğar.
//
// ⚠️ UZAYIN TEK SAHİBİ BU DOSYADIR. Aynı numarayı başka bir alt sistemde
// kullanmak, birbirini hiç görmeyen iki alt sistemi sessizce serileştirir
// (envanter gerekçesi `period-guard.helper.ts` başlığında).
// =============================================================================
import { Prisma, WeavingOrderStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { formatSeriesCode, resolveSeriesFormat, seriesPrefix, seriesSeqFrom } from "../number-series.service";

/**
 * Dokuma işi numara sayacı uzayı.
 *
 * `: number` BİLEREK — literal tipe daralırsa bekçideki "namespace'ler farklı"
 * karşılaştırması TS2367 ile derlenmez (`SHIPMENT_LOCK_NS` emsali).
 */
export const WEAVING_ORDER_LOCK_NS: number = 8032;

/**
 * Dokuma işi numara sayacını tx ömrü boyunca kilitler.
 *
 * Çağıran TX'İN İLK İFADESİ olarak koşmalıdır; sayaç okuması bundan SONRA gelir.
 */
export async function lockWeavingOrderNumberTx(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WEAVING_ORDER_LOCK_NS}::int, 0::int)`;
}

/** Dokuma işi numarası ön eki — `DK` + GGAAYY + NNNN (`IE` iş emri emsali). */
export const WEAVING_ORDER_PREFIX = "DK";

/**
 * Sıradaki dokuma işi numarası — kilit bu fonksiyonun İLK ifadesidir, sayaç
 * okuması ondan sonra gelir. Çağıran tx'te bundan önce başka ifade koşturmaz.
 */
export async function nextWeavingOrderNumberTx(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<string> {
  await lockWeavingOrderNumberTx(tx);
  const fmt = resolveSeriesFormat("weavingOrder");
  const prefix = seriesPrefix(fmt, date);
  const todays = await tx.weavingOrder.findMany({
    where: { weavingOrderNumber: { gte: prefix, startsWith: prefix } },
    select: { weavingOrderNumber: true },
  });
  const seq = seriesSeqFrom(fmt, todays.map((w) => w.weavingOrderNumber), prefix);
  return formatSeriesCode(fmt, seq, date);
}

/** Kapanmış/iptal edilmiş iş için tek etiket sözlüğü (helper `ApiResponse` KURMAZ, yalnız hata). */
const KAPALI_ETIKET: Partial<Record<WeavingOrderStatus, string>> = {
  COMPLETED: "kapatılmış",
  CANCELLED: "iptal edilmiş",
};

/**
 * `PLANNED → IN_PROGRESS` — `WeavingOrder.status`un TEK YAZARI (1e hükmü 2026-09-13).
 * Tetikleyici KOŞUM-AÇMA ucudur (machine-run.service, AYNI tx'te çağırır); manuel
 * `start` ucu yoktur: "devam ediyor" demek koşum var demektir.
 *
 * İKİ ADIMLI CLAIM (ikiz yüklem): ① `PLANNED → IN_PROGRESS` atomik; ② düşerse
 * `status = IN_PROGRESS` satırına DOKUNMA (updateMany) — ikinci koşum meşrudur ama
 * satır KİLİDİ alınmalı ki eşzamanlı close/cancel claim'iyle serileşsin; o claim
 * commit ettiyse ② de 0 döner ve taze okuma 409 verir. Kilitsiz "oku → geç" yolu,
 * close'un koşum sayımıyla birbirini görmezdi.
 *
 * Audit ÇAĞIRANIN işidir (tx dışında): `transitioned` true ise durum değişti.
 */
export async function markWeavingOrderInProgressTx(
  tx: Prisma.TransactionClient,
  weavingOrderId: string,
  userId?: string,
): Promise<{ status: WeavingOrderStatus; transitioned: boolean }> {
  const claim = await tx.weavingOrder.updateMany({
    where: { id: weavingOrderId, status: WeavingOrderStatus.PLANNED },
    data: { status: WeavingOrderStatus.IN_PROGRESS, updatedById: userId ?? null },
  });
  if (claim.count === 1) return { status: WeavingOrderStatus.IN_PROGRESS, transitioned: true };

  const touch = await tx.weavingOrder.updateMany({
    where: { id: weavingOrderId, status: WeavingOrderStatus.IN_PROGRESS },
    data: { updatedById: userId ?? null },
  });
  if (touch.count === 1) return { status: WeavingOrderStatus.IN_PROGRESS, transitioned: false };

  const fresh = await tx.weavingOrder.findUnique({
    where: { id: weavingOrderId },
    select: { status: true, weavingOrderNumber: true },
  });
  if (!fresh) throw AppError.notFound("Dokuma işi bulunamadı");
  throw AppError.conflict(
    `${fresh.weavingOrderNumber} ${KAPALI_ETIKET[fresh.status] ?? fresh.status} — koşum açılamaz`,
    { code: "WEAVING_ORDER_NOT_OPEN", status: fresh.status },
  );
}
