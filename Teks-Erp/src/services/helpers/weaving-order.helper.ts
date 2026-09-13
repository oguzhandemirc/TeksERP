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
import type { Prisma } from "@prisma/client";

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
